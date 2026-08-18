"use server"

/**
 * Server Actions del ABM de permisos familiares (Sprint 2,
 * `app/(app)/(con-nav)/familia/`). Tres operaciones sobre `family_permissions`:
 * invitar (INSERT), editar flags (UPDATE) y revocar (DELETE).
 *
 * Los tres `insert`/`update`/`delete` van con el cliente del USUARIO -nunca
 * `service_role`- así que las políticas RLS de
 * `supabase/migrations/20260812220000_rls.sql` son quien decide en última
 * instancia si la fila se toca. La guarda de acá abajo
 * (`requerirAutoridadDeOtorgamiento`) no reemplaza esa decisión: existe para
 * no ofrecerle a alguien sin autoridad un formulario que la base va a
 * rechazar, y para traducir el rechazo en un mensaje en español en vez de un
 * código de error de Postgres.
 *
 * Autoridad de otorgamiento (docs/modelo-permisos.md §4.4): si el perfil
 * TIENE cuenta, solo su titular puede otorgar/editar/revocar -ni siquiera un
 * `can_manage`-; si es GESTIONADO (`user_id IS NULL`), cualquier `can_manage`
 * sobre él puede hacerlo, porque el titular no puede iniciar sesión.
 * `VerboPermiso` (lib/auth/guardas.ts) no tiene un cuarto verbo "grant" -se
 * limita a los tres flags de la tabla-, así que la guarda combina dos pasos:
 * `requerirPermiso(..., "manage")` (cubre "titular O can_manage", revalidado
 * contra la base) más el chequeo de `profiles.user_id` que reduce ese OR al
 * predicado exacto de la sección 4.4.
 */

import { revalidatePath } from "next/cache"

import { headers } from "next/headers"

import { normalizarIp } from "@/lib/auditoria"
import {
  ErrorPerfilInvalido,
  ErrorPermisoDenegado,
  esErrorDeGuarda,
  requerirPermiso,
  requerirSesion,
} from "@/lib/auth/guardas"
import { registrarConsentimiento, VERSION_LEGALES } from "@/lib/legales"
import { hoyIsoUshuaia } from "@/lib/turnos/fecha"

export type EstadoFamilia = {
  error: string | null
  mensaje: string | null
}

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Fecha pura `YYYY-MM-DD`, mismo patrón que `lib/validacion/signo.schema.ts`. */
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Mensaje NEUTRO a propósito: lo mismo si el email no tiene cuenta, si no
 * tiene perfil todavía, o si el `INSERT` falló por una razón que no es ni
 * autorreferencia ni acceso duplicado (ambas SÍ tienen mensaje propio, más
 * abajo). Es la mitigación del riesgo de enumeración que documenta
 * `supabase/migrations/20260812240000_rpc_permisos.sql`: la respuesta de la
 * UI nunca deja adivinar, probando emails, cuáles tienen cuenta.
 */
const MENSAJE_NO_SE_PUDO_AGREGAR =
  "No pudimos agregar a esa persona. Puede que el email esté mal escrito o que todavía no tenga una cuenta creada en Historial Médico."

function normalizarTexto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : ""
}

function esCasillaMarcada(valor: FormDataEntryValue | null): boolean {
  return valor === "on" || valor === "true"
}

/**
 * Confirma la autoridad de otorgamiento sobre `perfilId` y devuelve la
 * sesión ya validada. Lanza `ErrorGuarda` (capturable con `esErrorDeGuarda`)
 * si no hay sesión o no hay autoridad.
 */
async function requerirAutoridadDeOtorgamiento(perfilId: string) {
  // Paso 1: al menos "manage" -titular O can_manage-, revalidado contra la
  // base con la misma función SECURITY DEFINER que usa RLS
  // (puede_administrar_perfil).
  const concedido = await requerirPermiso(perfilId, "manage", {
    siNoHaySesion: "lanzar",
  })

  // Paso 2: el chequeo de user_id que reduce ese OR al predicado exacto de
  // la sección 4.4 (equivalente en TypeScript a puede_otorgar_permisos, sin
  // reimplementarla: solo se lee profiles.user_id, no se recalcula ningún
  // permiso).
  const { data: perfil, error } = await concedido.supabase
    .from("profiles")
    .select("user_id")
    .eq("id", perfilId)
    .maybeSingle()

  if (error || !perfil) {
    throw new ErrorPerfilInvalido()
  }

  const esTitular = perfil.user_id === concedido.usuario.id
  const esGestionado = perfil.user_id === null

  if (!esTitular && !esGestionado) {
    // can_manage sobre un perfil CON cuenta: administra contenido, pero la
    // autoridad de otorgar/editar/revocar accesos es exclusiva del titular.
    throw new ErrorPermisoDenegado("manage", perfilId)
  }

  return concedido
}

/** Traduce los códigos de error de Postgres relevantes a este ABM. */
function mapearErrorPostgres(error: { code?: string; message?: string }): string {
  switch (error.code) {
    case "23505": // unique_violation — family_permissions_par_unico
      return "Esa persona ya tiene acceso a este perfil."
    case "23514": // check_violation — family_permissions_sin_autoreferencia
      return "No podés otorgarte acceso a tu propio perfil."
    case "23001": // restrict_violation — trigger family_permissions_evitar_huerfano (deuda D4)
      return "No podés dejar este perfil sin ningún administrador. Transferí la administración a otra persona antes de continuar, o eliminá el perfil."
    case "42501": // insufficient_privilege — RLS
      return "No tenés autoridad para hacer esto sobre este perfil."
    default:
      return "Ocurrió un problema y no pudimos completar la acción. Probá de nuevo en unos minutos."
  }
}

/**
 * Invitar por email. Otorga SIEMPRE `can_view = true` (minimización,
 * docs/modelo-permisos.md §9.1); `can_upload` y `can_manage` son opcionales y
 * llegan sin marcar por defecto -el formulario no los pre-marca-.
 */
export async function invitarFamiliar(
  _estadoPrevio: EstadoFamilia,
  formData: FormData,
): Promise<EstadoFamilia> {
  const perfilId = normalizarTexto(formData.get("perfilId"))
  const email = normalizarTexto(formData.get("email")).toLowerCase()
  const canUpload = esCasillaMarcada(formData.get("canUpload"))
  const canManage = esCasillaMarcada(formData.get("canManage"))
  const confirmoAcceso = esCasillaMarcada(formData.get("confirmoAcceso"))

  if (!PATRON_UUID.test(perfilId)) {
    return { error: "El perfil indicado no es válido.", mensaje: null }
  }
  if (!PATRON_EMAIL.test(email)) {
    return { error: "Ingresá un correo electrónico válido.", mensaje: null }
  }
  // Sprint 12, tarea 12.1 (Ley 25.326): mismo criterio que el checkbox de
  // `/registro` -sin marcar por defecto, revalidado acá porque el `formData`
  // se puede alterar-. `FormularioInvitar` ya lo exige del lado del cliente
  // con `required` y el texto explícito de a quién se le está dando acceso.
  if (!confirmoAcceso) {
    return {
      error: "Tenés que confirmar que querés otorgar este acceso para continuar.",
      mensaje: null,
    }
  }

  let concedido: Awaited<ReturnType<typeof requerirAutoridadDeOtorgamiento>>
  try {
    concedido = await requerirAutoridadDeOtorgamiento(perfilId)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message, mensaje: null }
    }
    throw error
  }

  const { supabase } = concedido

  // No hace falta ni conviene una versión "buscar por patrón": el email es
  // exacto (supabase/migrations/20260812240000_rpc_permisos.sql).
  const { data: perfilInvitadoId, error: errorBusqueda } = await supabase.rpc(
    "perfil_id_por_email",
    { email_buscado: email },
  )

  if (errorBusqueda) {
    return { error: MENSAJE_NO_SE_PUDO_AGREGAR, mensaje: null }
  }
  if (!perfilInvitadoId) {
    return { error: MENSAJE_NO_SE_PUDO_AGREGAR, mensaje: null }
  }

  // Autoinvitación: se detecta antes del INSERT para dar un mensaje propio.
  // Es un caso determinístico (cualquiera sabe su propio email) y no agrega
  // riesgo de enumeración, a diferencia del "no existe" de arriba.
  if (perfilInvitadoId === perfilId) {
    return {
      error: "No podés otorgarte acceso a tu propio perfil.",
      mensaje: null,
    }
  }

  // Deuda D7 (docs/modelo-permisos.md): el autorizado debe tener cuenta.
  // `perfil_id_por_email` ya solo resuelve perfiles CON cuenta (hace JOIN
  // contra auth.users), así que este caso no puede darse desde este flujo.

  const { error: errorInsert } = await supabase.from("family_permissions").insert({
    owner_profile_id: perfilId,
    granted_profile_id: perfilInvitadoId,
    can_view: true,
    can_upload: canUpload,
    can_manage: canManage,
  })

  if (errorInsert) {
    return { error: mapearErrorPostgres(errorInsert), mensaje: null }
  }

  // Sprint 12, tarea 12.1: el otorgamiento ya ocurrió (el INSERT de arriba
  // tuvo éxito) — esta fila es CONSTANCIA de esa decisión, no su condición.
  // Por eso `registrarConsentimiento` nunca lanza: un fallo de red acá no debe
  // dejar a quien otorgó el acceso pensando que el otorgamiento en sí no
  // funcionó. Ver el porqué completo en `lib/legales.ts`.
  await registrarConsentimiento(supabase, concedido.usuario.id, "acceso_familiar")

  revalidatePath("/familia")
  return { error: null, mensaje: "Acceso otorgado correctamente." }
}

/** Edita `can_upload` / `can_manage` de una fila existente. `can_view` no se toca: es la base fija del acceso. */
export async function actualizarPermiso(
  _estadoPrevio: EstadoFamilia,
  formData: FormData,
): Promise<EstadoFamilia> {
  const perfilId = normalizarTexto(formData.get("perfilId"))
  const permisoId = normalizarTexto(formData.get("permisoId"))
  const canUpload = esCasillaMarcada(formData.get("canUpload"))
  const canManage = esCasillaMarcada(formData.get("canManage"))

  if (!PATRON_UUID.test(perfilId) || !PATRON_UUID.test(permisoId)) {
    return { error: "El acceso indicado no es válido.", mensaje: null }
  }

  let concedido: Awaited<ReturnType<typeof requerirAutoridadDeOtorgamiento>>
  try {
    concedido = await requerirAutoridadDeOtorgamiento(perfilId)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message, mensaje: null }
    }
    throw error
  }

  const { data, error } = await concedido.supabase
    .from("family_permissions")
    .update({ can_upload: canUpload, can_manage: canManage })
    .eq("id", permisoId)
    .eq("owner_profile_id", perfilId)
    .select("id")

  if (error) {
    return { error: mapearErrorPostgres(error), mensaje: null }
  }
  if (!data || data.length === 0) {
    // 0 filas sin error: RLS filtró la fila (nota ⑥, no se puede tocar la
    // fila can_manage de OTRO administrador) o ya no existe.
    return {
      error:
        "No se pudo actualizar ese acceso: puede ser el de otro administrador, o puede que ya no exista.",
      mensaje: null,
    }
  }

  revalidatePath("/familia")
  return { error: null, mensaje: "Cambios guardados." }
}

/** Revoca (borra) una fila de `family_permissions`. */
export async function revocarPermiso(
  _estadoPrevio: EstadoFamilia,
  formData: FormData,
): Promise<EstadoFamilia> {
  const perfilId = normalizarTexto(formData.get("perfilId"))
  const permisoId = normalizarTexto(formData.get("permisoId"))

  if (!PATRON_UUID.test(perfilId) || !PATRON_UUID.test(permisoId)) {
    return { error: "El acceso indicado no es válido.", mensaje: null }
  }

  let concedido: Awaited<ReturnType<typeof requerirAutoridadDeOtorgamiento>>
  try {
    concedido = await requerirAutoridadDeOtorgamiento(perfilId)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message, mensaje: null }
    }
    throw error
  }

  const { data, error } = await concedido.supabase
    .from("family_permissions")
    .delete()
    .eq("id", permisoId)
    .eq("owner_profile_id", perfilId)
    .select("id")

  if (error) {
    return { error: mapearErrorPostgres(error), mensaje: null }
  }
  if (!data || data.length === 0) {
    return {
      error:
        "No se pudo revocar ese acceso: puede ser el de otro administrador, o puede que ya no exista.",
      mensaje: null,
    }
  }

  revalidatePath("/familia")
  return { error: null, mensaje: "Acceso revocado." }
}

/**
 * Crear un perfil gestionado (Sprint 15, tarea 15.1): "Crear un perfil para
 * un familiar sin cuenta" en `/familia`. Sirve para dos casos con el mismo
 * mecanismo -un chico, o una persona mayor sin email-: el texto de la UI es
 * deliberadamente neutro (docs/modelo-permisos.md §8.4: el modelo no
 * distingue por edad, ninguna política lee `date_of_birth`).
 *
 * A diferencia de `invitarFamiliar` -que hace UN `insert` porque
 * `family_permissions_insert_autoridad` ya autoriza esa fila sola-, acá hay
 * TRES escrituras relacionadas (perfil, fila de arranque, consentimiento del
 * representante) y perderlas a mitad de camino dejaría un perfil gestionado
 * sin ningún `can_manage` -el estado prohibido por la sección 8.2-. Por eso
 * se llama al RPC transaccional `crear_perfil_gestionado`
 * (`supabase/migrations/20260817220000_perfiles_gestionados.sql`) en vez de
 * tres `insert` sueltos desde acá.
 */
export type EstadoCrearGestionado = {
  error: string | null
  mensaje: string | null
}

/** Traduce los códigos de error del RPC `crear_perfil_gestionado`. */
function mapearErrorCrearGestionado(error: { code?: string; message?: string }): string {
  if (error.code === "22023") {
    // invalid_parameter_value: el RPC ya redactó el mensaje en español
    // (nombre vacío, fecha faltante o futura, versión de legales faltante).
    return error.message || "Revisá los datos del formulario e intentá de nuevo."
  }
  if (error.code === "42501") {
    return "No pudimos crear el perfil: tu cuenta todavía no tiene su propio perfil."
  }
  console.error("[familia] Error inesperado al crear un perfil gestionado:", error)
  return "Ocurrió un problema y no pudimos crear el perfil. Probá de nuevo en unos minutos."
}

export async function crearPerfilGestionado(
  _estadoPrevio: EstadoCrearGestionado,
  formData: FormData,
): Promise<EstadoCrearGestionado> {
  const nombre = normalizarTexto(formData.get("fullName"))
  const fechaNacimiento = normalizarTexto(formData.get("dateOfBirth"))
  const confirmoRepresentante = esCasillaMarcada(formData.get("confirmoRepresentante"))

  if (!nombre) {
    return { error: "Ingresá el nombre completo.", mensaje: null }
  }
  if (!PATRON_FECHA.test(fechaNacimiento)) {
    return { error: "Ingresá la fecha de nacimiento.", mensaje: null }
  }
  // Fechas puras (YYYY-MM-DD): comparar como STRINGS contra hoyIsoUshuaia()
  // es el equivalente TypeScript del bang `!Y-m-d` de la regla global -acá
  // ni siquiera hace falta construir un `Date`, así que no hay instante de
  // por medio que pueda arrastrar la hora del proceso (mismo criterio que
  // lib/perfiles/edad.ts, que documenta el paralelo completo con la regla
  // PHP)-.
  if (fechaNacimiento > hoyIsoUshuaia()) {
    return { error: "La fecha de nacimiento no puede ser futura.", mensaje: null }
  }
  if (!confirmoRepresentante) {
    return {
      error: "Tenés que confirmar que actuás como representante para continuar.",
      mensaje: null,
    }
  }

  let sesion: Awaited<ReturnType<typeof requerirSesion>>
  try {
    sesion = await requerirSesion({ siNoHaySesion: "lanzar" })
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message, mensaje: null }
    }
    throw error
  }

  const { supabase } = sesion

  const encabezados = await headers()
  const ip =
    normalizarIp(encabezados.get("x-forwarded-for")) ??
    normalizarIp(encabezados.get("x-real-ip"))

  const { data: perfilCreado, error } = await supabase.rpc("crear_perfil_gestionado", {
    p_full_name: nombre,
    p_date_of_birth: fechaNacimiento,
    p_legales_version: VERSION_LEGALES,
    p_ip: ip,
  })

  if (error) {
    return { error: mapearErrorCrearGestionado(error), mensaje: null }
  }

  revalidatePath("/familia")
  revalidatePath("/perfiles")
  return {
    error: null,
    mensaje: `Creaste el perfil de ${perfilCreado.full_name}. Ya aparece en tu selector de perfiles, marcado como gestionado por vos.`,
  }
}
