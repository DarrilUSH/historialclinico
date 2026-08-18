"use server"

/**
 * Server Actions de `/medicos` (Sprint 10, tarea 10.1 — ROADMAP_SPRINTS.md).
 *
 * Cuatro acciones, todas operando sobre el PERFIL ACTIVO
 * (`obtenerPerfilActivo()`), nunca sobre un `perfilId` que mande el cliente
 * -mismo criterio que `medicacion/actions.ts` y `turnos/actions.ts`-:
 *
 * - `crearMedico` — alta. Exige `upload`
 *   (`doctors_insert_puede_cargar`, `docs/modelo-permisos.md` §6:
 *   "`doctors` | INSERT | dueño O can_upload O can_manage").
 * - `actualizarMedico` — edición de los datos. Exige `manage`
 *   (`doctors_update_administrador`).
 * - `darDeBajaMedico` / `reactivarMedico` — transición de `is_active`.
 *   También exigen `manage`. Dar de baja NO borra: fija `is_active = false`
 *   Y `deactivated_at = now()` en la misma escritura -el CHECK
 *   `doctors_baja_coherente` exige las dos juntas-, así que el médico pasa al
 *   histórico sin perder ninguna fila de `appointments`/`documents` que ya lo
 *   referencien (`doctor_id` tiene `ON DELETE SET NULL`, pero acá nunca se
 *   hace `DELETE`: la baja lógica ni siquiera dispara ese `SET NULL`, porque
 *   la fila de `doctors` sigue existiendo). Reactivar vuelve `is_active =
 *   true` y limpia `deactivated_at`.
 *
 * Las dos transiciones validan el estado de ORIGEN con `.eq("is_active", ...)`
 * en la propia consulta -mismo patrón que `medicacion/actions.ts`-: un
 * `UPDATE` que no matchea ninguna fila (ya estaba en el estado pedido, o es
 * de otro perfil) no tira error, así que se usa `{ count: "exact" }` para
 * devolver un mensaje claro en vez de fingir éxito.
 *
 * ## Ciudad/provincia y geocodificación automática (Sprint 16, tarea 16.1)
 *
 * `crearMedico`/`actualizarMedico` persisten `ciudad`/`provincia` en
 * `doctors.city`/`province`. Mismo criterio que `turnos/actions.ts`: si la
 * persona no cargó coordenadas a mano pero sí una dirección,
 * `resolverCoordenadas` intenta geocodificar con Nominatim
 * (`lib/ubicacion/geocodificacion.ts`), mejor esfuerzo, nunca bloquea el
 * guardado.
 *
 * ## Varias especialidades (Sprint 16, tarea 16.2)
 *
 * `doctors.specialty` (un solo valor) se reemplaza por `doctors.specialties`
 * (`text[]`, ver `supabase/migrations/20260818090000_especialidades_multiples.sql`).
 * `campoLista(formData, "especialidades")` lee TODOS los valores del campo
 * -cada chip de `components/medicos/formulario-medico.tsx` viaja como su
 * propio `<input type="hidden" name="especialidades">`, mismo mecanismo que
 * ya usa `formulario-sos.tsx` para sus tres listas-, y
 * `lib/validacion/medico.schema.ts` trimea/deduplica/valida antes de que
 * llegue acá.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import type { MedicoParaAutocompletar } from "@/lib/turnos/autocompletar-medico"
import { geocodificarDireccion } from "@/lib/ubicacion/geocodificacion"
import { validarMedico, type DatosMedicoValidado } from "@/lib/validacion/medico.schema"

export interface EstadoMedicoAccion {
  error: string | null
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando el médico."

const SIN_MEDICO_ID = "No pudimos identificar el médico. Volvé a intentarlo desde la lista."

const ERROR_INESPERADO_CREAR =
  "Ocurrió un problema y no pudimos guardar el médico. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_EDITAR =
  "Ocurrió un problema y no pudimos guardar los cambios. Probá de nuevo en unos minutos."

const ERROR_MEDICO_NO_ENCONTRADO = "No encontramos ese médico, o ya no está disponible."

const ERROR_TRANSICION_NO_APLICADA =
  "No pudimos actualizar el médico. Puede que su estado ya haya cambiado — recargá la página."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` (mismo criterio que `turnos/actions.ts#campo`). */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

/** `formData.getAll(nombre)` filtrado a strings -mismo criterio que `turnos/actions.ts#campo` para `File` sueltos, aplicado a un campo múltiple-. */
function campoLista(formData: FormData, nombre: string): string[] {
  return formData.getAll(nombre).filter((valor): valor is string => typeof valor === "string")
}

function datosCrudosDelFormulario(formData: FormData) {
  return {
    nombre: campo(formData, "nombre"),
    // Sprint 16, tarea 16.2: un médico puede tener varias, cada una viaja
    // como su propio valor de `especialidades` (ver
    // `components/medicos/formulario-medico.tsx#CampoEspecialidades`).
    especialidades: campoLista(formData, "especialidades"),
    matricula: campo(formData, "matricula"),
    institucion: campo(formData, "institucion"),
    telefono: campo(formData, "telefono"),
    direccion: campo(formData, "direccion"),
    ciudad: campo(formData, "ciudad"),
    provincia: campo(formData, "provincia"),
    latitud: campo(formData, "latitud"),
    longitud: campo(formData, "longitud"),
    notas: campo(formData, "notas"),
  }
}

/**
 * Coordenadas listas para `doctors.latitude`/`longitude`: calcado de
 * `turnos/actions.ts#resolverCoordenadas` (Sprint 16, tarea 16.1). Si la
 * persona cargó las dos a mano, ganan sin tocar la red. Si no, y hay
 * dirección, intenta geocodificar con Nominatim -mejor esfuerzo, nunca
 * lanza-. Sin dirección tampoco, quedan en `null`.
 */
async function resolverCoordenadas(
  datos: DatosMedicoValidado,
): Promise<{ latitud: number | null; longitud: number | null }> {
  if (datos.latitud !== undefined && datos.longitud !== undefined) {
    return { latitud: datos.latitud, longitud: datos.longitud }
  }

  if (!datos.direccion) {
    return { latitud: null, longitud: null }
  }

  const geocodificado = await geocodificarDireccion({
    calle: datos.direccion,
    ciudad: datos.ciudad,
    provincia: datos.provincia,
  })

  return geocodificado
    ? { latitud: geocodificado.latitud, longitud: geocodificado.longitud }
    : { latitud: null, longitud: null }
}

/** Columnas que necesita `MedicoParaAutocompletar` (`lib/turnos/autocompletar-medico.ts`) del médico recién insertado. */
const COLUMNAS_MEDICO_AUTOCOMPLETAR =
  "id, full_name, specialties, institution, address, city, province, latitude, longitude"

/**
 * Núcleo compartido del `INSERT` en `doctors`: lo usan `crearMedico` (el alta
 * de `/medicos/nuevo`, que redirige) y `crearMedicoDesdeCruce` (el alta desde
 * la franja "¿Agregar a tus médicos?" de un cruce inteligente, que NO puede
 * redirigir -perdería el turno o el documento que se está revisando-). Un
 * solo lugar que arma el `insert`, para que las dos rutas de alta nunca
 * puedan divergir en qué columnas escriben.
 */
async function insertarMedico(
  supabase: Awaited<ReturnType<typeof requerirPermiso>>["supabase"],
  perfilId: string,
  datos: DatosMedicoValidado,
): Promise<{ error: string | null; medico: MedicoParaAutocompletar | null }> {
  const { latitud, longitud } = await resolverCoordenadas(datos)

  const { data, error } = await supabase
    .from("doctors")
    .insert({
      profile_id: perfilId,
      full_name: datos.nombre,
      specialties: datos.especialidades,
      license_number: datos.matricula ?? null,
      institution: datos.institucion ?? null,
      phone: datos.telefono ?? null,
      address: datos.direccion ?? null,
      city: datos.ciudad ?? null,
      province: datos.provincia ?? null,
      latitude: latitud,
      longitude: longitud,
      notes: datos.notas ?? null,
    })
    .select(COLUMNAS_MEDICO_AUTOCOMPLETAR)
    .single()

  if (error || !data) {
    return { error: error?.message ?? "sin fila devuelta", medico: null }
  }

  return { error: null, medico: data }
}

/**
 * Alta de médico. `FormData` trae los campos de
 * `components/medicos/formulario-medico.tsx`; el perfil sale de la cookie
 * activa, no del formulario.
 */
export async function crearMedico(
  _estadoPrevio: EstadoMedicoAccion,
  formData: FormData,
): Promise<EstadoMedicoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarMedico(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const { error } = await insertarMedico(supabase, activo.perfil.id, validacion.datos)

    if (error) {
      console.error("[medicos] Fallo al crear un médico:", error)
      return { error: ERROR_INESPERADO_CREAR }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicos] Fallo inesperado al crear un médico:", error)
    return { error: ERROR_INESPERADO_CREAR }
  }

  revalidatePath("/medicos")
  revalidatePath("/turnos/nuevo")
  redirect("/medicos?creado=1")
}

export interface EstadoCrearMedicoDesdeCruce {
  error: string | null
  /** El médico recién creado, listo para vincular como si se hubiera elegido del `<Select>` de siempre. `null` en error. */
  medico: MedicoParaAutocompletar | null
}

/**
 * Alta de médico desde un CRUCE INTELIGENTE (franja "¿Agregar a tus
 * médicos?" de `components/medicos/franja-cotejo-medico.tsx`, usada por
 * `FormularioTurno` y `FormularioRevision`): mismo `INSERT`, mismo permiso
 * (`upload`) y mismo `validarMedico` que `crearMedico`, vía el núcleo
 * compartido `insertarMedico` -no se duplica la escritura-, pero SIN
 * `redirect()`: la persona está en medio de cargar un turno o revisar un
 * documento, y un alta que la mande a `/medicos` le tiraría ese trabajo a la
 * basura. Devuelve el médico recién creado para que quien llama lo vincule
 * en el acto, como si lo hubiera elegido del `<Select>` de siempre.
 */
export async function crearMedicoDesdeCruce(
  _estadoPrevio: EstadoCrearMedicoDesdeCruce,
  formData: FormData,
): Promise<EstadoCrearMedicoDesdeCruce> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO, medico: null }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarMedico(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error, medico: null }
    }

    const { error, medico } = await insertarMedico(supabase, activo.perfil.id, validacion.datos)

    if (error || !medico) {
      console.error("[medicos] Fallo al crear un médico desde un cruce inteligente:", error)
      return { error: ERROR_INESPERADO_CREAR, medico: null }
    }

    revalidatePath("/medicos")
    revalidatePath("/turnos/nuevo")
    return { error: null, medico }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message, medico: null }
    }
    console.error("[medicos] Fallo inesperado al crear un médico desde un cruce inteligente:", error)
    return { error: ERROR_INESPERADO_CREAR, medico: null }
  }
}

/** Edición de los datos de un médico YA cargado. No toca `is_active`/`deactivated_at`: eso lo hacen `darDeBajaMedico`/`reactivarMedico`. */
export async function actualizarMedico(
  _estadoPrevio: EstadoMedicoAccion,
  formData: FormData,
): Promise<EstadoMedicoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const medicoId = campo(formData, "medicoId")
    if (!PATRON_UUID.test(medicoId)) {
      return { error: SIN_MEDICO_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarMedico(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const { datos } = validacion
    const { latitud, longitud } = await resolverCoordenadas(datos)

    const { error, count } = await supabase
      .from("doctors")
      .update(
        {
          full_name: datos.nombre,
          specialties: datos.especialidades,
          license_number: datos.matricula ?? null,
          institution: datos.institucion ?? null,
          phone: datos.telefono ?? null,
          address: datos.direccion ?? null,
          city: datos.ciudad ?? null,
          province: datos.provincia ?? null,
          latitude: latitud,
          longitude: longitud,
          notes: datos.notas ?? null,
        },
        { count: "exact" },
      )
      .eq("id", medicoId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[medicos] Fallo al actualizar el médico ${medicoId}:`, error)
      return { error: ERROR_INESPERADO_EDITAR }
    }
    if (!count) {
      return { error: ERROR_MEDICO_NO_ENCONTRADO }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicos] Fallo inesperado al editar un médico:", error)
    return { error: ERROR_INESPERADO_EDITAR }
  }

  revalidatePath("/medicos")
  revalidatePath("/turnos/nuevo")
  redirect("/medicos?editado=1")
}

/**
 * Núcleo compartido de las dos transiciones de `is_active`: valida sesión y
 * `manage` sobre el perfil activo, y aplica el `UPDATE` condicionado al
 * estado de origen.
 */
async function transicionarActivoMedico(
  formData: FormData,
  cambios: { is_active: boolean; deactivated_at: string | null },
  estadoDeOrigen: boolean,
  redireccion: string,
): Promise<EstadoMedicoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const medicoId = campo(formData, "medicoId")
    if (!PATRON_UUID.test(medicoId)) {
      return { error: SIN_MEDICO_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const { error, count } = await supabase
      .from("doctors")
      .update(cambios, { count: "exact" })
      .eq("id", medicoId)
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", estadoDeOrigen)

    if (error) {
      console.error(`[medicos] Fallo al cambiar el estado de ${medicoId}:`, error)
      return { error: ERROR_TRANSICION_NO_APLICADA }
    }
    if (!count) {
      return { error: ERROR_TRANSICION_NO_APLICADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicos] Fallo inesperado al cambiar el estado de un médico:", error)
    return { error: ERROR_TRANSICION_NO_APLICADA }
  }

  revalidatePath("/medicos")
  revalidatePath("/turnos/nuevo")
  redirect(redireccion)
}

/** Activo → dado de baja. NO borra: `doctors_baja_coherente` exige `is_active = false` y `deactivated_at` juntos. Disparada desde `DialogoConfirmacion` (ver `components/medicos/acciones-medico.tsx`). */
export async function darDeBajaMedico(
  _estadoPrevio: EstadoMedicoAccion,
  formData: FormData,
): Promise<EstadoMedicoAccion> {
  return transicionarActivoMedico(
    formData,
    { is_active: false, deactivated_at: new Date().toISOString() },
    true,
    "/medicos?dadodebaja=1",
  )
}

/** Dado de baja → activo. */
export async function reactivarMedico(
  _estadoPrevio: EstadoMedicoAccion,
  formData: FormData,
): Promise<EstadoMedicoAccion> {
  return transicionarActivoMedico(
    formData,
    { is_active: true, deactivated_at: null },
    false,
    "/medicos?reactivado=1",
  )
}
