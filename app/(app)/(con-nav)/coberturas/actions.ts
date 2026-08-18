"use server"

/**
 * Server Actions de `/coberturas` (Sprint 8, tarea 8.1 — ROADMAP_SPRINTS.md).
 *
 * `crearCobertura` / `actualizarCobertura` tienen firma `(formData) => Promise<Estado>`
 * -NO `(prevState, formData)`- porque suben archivos: mismo motivo que
 * `subirDocumento` (`app/(app)/(con-nav)/estudios/actions.ts`), un
 * `<form action={fn}>` nativo no puede llevar los blobs YA COMPRIMIDOS en el
 * cliente (`components/coberturas/campo-imagen-credencial.tsx`), así que
 * `components/coberturas/formulario-cobertura.tsx` arma el `FormData` a mano
 * y llama a la acción directamente. `marcarPrincipal` / `eliminarCobertura`
 * no cargan archivos, así que sí usan `(prevState, formData)` para
 * `useActionState` -mismo patrón que `suspenderMedicacion`/`reactivarMedicacion`
 * en `medicacion/actions.ts`-.
 *
 * ## Permisos (docs/modelo-permisos.md §6, fila `insurance_cards`)
 *
 * | Operación | Permiso |
 * |---|---|
 * | `crearCobertura` (INSERT) | `upload` |
 * | `actualizarCobertura` / `marcarPrincipal` / `eliminarCobertura` (UPDATE/DELETE) | `manage` |
 *
 * ## El path de Storage es SIEMPRE `{profile_id}/{card_id}/{lado}.jpg`
 *
 * Literal, con `.jpg` fijo -no la extensión real del MIME comprimido, que
 * puede terminar en JPEG o WebP según `lib/archivos/compresion.ts`-. Es la
 * convención exacta de `supabase/migrations/20260812230000_storage.sql`
 * (comentario de cabecera), y fijarla así (en vez de derivarla del MIME,
 * como hace `lib/documentos/ingesta.ts` para `documentos-medicos`) tiene una
 * ventaja concreta para este bucket: el path de un lado NUNCA cambia al
 * reemplazar la foto en una edición, así que reemplazar es un `upsert` al
 * MISMO objeto y nunca deja un huérfano con la extensión vieja. El
 * `Content-Type` real lo fija el parámetro `contentType` del upload -eso es
 * lo que gobierna cómo el navegador interpreta el archivo al abrirlo con la
 * signed URL, no el nombre del path-.
 *
 * ## Una sola cobertura principal: índice parcial + traducción del conflicto
 *
 * `insurance_cards_una_principal_idx` (índice único parcial `WHERE is_primary`)
 * es la única fuente de verdad de "una sola principal por perfil" — no se
 * reimplementa esa regla acá. Antes de insertar/actualizar una fila con
 * `is_primary = true` se desmarca la que hubiera (`desmarcarPrincipal`, un
 * `UPDATE` aparte, no la misma sentencia: swapear un booleano único con una
 * sola sentencia sobre varias filas depende del orden en que Postgres
 * procese las filas y puede violar el índice a mitad de camino). Si de
 * todos modos el índice rechaza el `INSERT`/`UPDATE` -otra pestaña, otro
 * dispositivo, la misma persona mandando el formulario dos veces- el 23505
 * se traduce a un mensaje mostrable (`mapearErrorEscrituraCobertura`).
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import {
  type ClienteSupabaseServidor,
  esErrorDeGuarda,
  requerirPermiso,
} from "@/lib/auth/guardas"
import { validarImagenCredencial } from "@/lib/archivos/validacion"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { BUCKETS, borrarObjeto } from "@/lib/storage-admin"
import { validarCobertura } from "@/lib/validacion/cobertura.schema"
import type { Database } from "@/types/database.types"

type CambiosCobertura = Database["public"]["Tables"]["insurance_cards"]["Update"]

export interface EstadoCoberturaAccion {
  error: string | null
}

/**
 * Resultado de las DOS acciones que el formulario invoca a mano
 * (`crearCobertura` / `actualizarCobertura`). **No redirigen: devuelven a
 * dónde ir** y el cliente navega con `router.push`.
 *
 * ## Por qué no un `redirect()`, como el resto de las acciones de este archivo
 *
 * Hotfix del "error de red fantasma". En Next 16 una Server Action que hace
 * `redirect()` **rechaza la promesa** que ve quien la invocó -es el mecanismo
 * por el que el runtime propaga la orden de navegar-. Con `<form action>` o
 * `useActionState` eso es invisible: la promesa la espera React, que reconoce
 * ese rechazo y navega. Pero cuando la acción se llama a mano
 * (`const r = await crearCobertura(fd)`, obligatorio acá porque el formulario
 * arma los blobs de las fotos, ver `components/coberturas/formulario-cobertura.tsx`)
 * el rechazo cae en el `try/catch` de quien llamó, y un `catch` genérico lo
 * confunde con una red caída. Verificado en el Galaxy A71 contra un build de
 * producción: el POST vuelve `200` con `x-action-redirect: /coberturas?creada=1;push`,
 * la fila YA está insertada, y aun así el formulario pintaba
 * "No pudimos guardar la cobertura. Revisá tu conexión y probá de nuevo.".
 *
 * Devolver el destino en vez de redirigir corta el problema de raíz: en el
 * camino feliz la promesa **resuelve**, y el `catch` del cliente vuelve a
 * significar lo único que debería significar -que la request no llegó-.
 *
 * `marcarPrincipal` y `eliminarCobertura` NO cambian: se usan con
 * `useActionState`, donde el `redirect()` es el patrón correcto.
 */
export type ResultadoGuardadoCobertura =
  | { ok: true; destino: string }
  | { ok: false; error: string }

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando la cobertura."

const SIN_COBERTURA_ID = "No pudimos identificar la cobertura. Volvé a intentarlo desde la lista."

const ERROR_INESPERADO_CREAR =
  "Ocurrió un problema y no pudimos guardar la cobertura. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_EDITAR =
  "Ocurrió un problema y no pudimos guardar los cambios. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_PRINCIPAL =
  "Ocurrió un problema y no pudimos marcarla como principal. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_ELIMINAR =
  "Ocurrió un problema y no pudimos eliminar la cobertura. Probá de nuevo en unos minutos."

const ERROR_COBERTURA_NO_ENCONTRADA =
  "No encontramos esa cobertura, o ya no está disponible."

const ERROR_UNA_PRINCIPAL =
  "Ya hay otra cobertura marcada como principal — puede que se haya marcado justo ahora desde otra pantalla. Volvé a intentarlo."

const ERROR_COBERTURA_DUPLICADA =
  "Ya cargaste una cobertura con ese mismo proveedor y número de afiliado."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` (mismo criterio que `medicacion/actions.ts#campo`). */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

function datosCrudosDelFormulario(formData: FormData) {
  return {
    proveedor: campo(formData, "proveedor"),
    plan: campo(formData, "plan"),
    numeroAfiliado: campo(formData, "numeroAfiliado"),
    esPrincipal: formData.get("esPrincipal") === "on",
  }
}

/** Path determinístico del objeto: ver el bloque del encabezado sobre por qué es `.jpg` fijo. */
function construirPathCredencial(
  perfilId: string,
  coberturaId: string,
  lado: "front" | "back",
): string {
  return `${perfilId}/${coberturaId}/${lado}.jpg`
}

/** Sube UNA cara ya comprimida por el cliente. Revalida tamaño y MIME real en el servidor -el cliente ya lo hizo, pero eso es UX, no la única barrera-. Lanza con un mensaje en español ante cualquier fallo. */
async function subirLadoCredencial(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
  coberturaId: string,
  lado: "front" | "back",
  archivo: File,
  upsert: boolean,
): Promise<string> {
  const validacion = await validarImagenCredencial(archivo)
  if (!validacion.valido || !validacion.tipo) {
    throw new Error(validacion.error ?? "La foto no es válida.")
  }

  const path = construirPathCredencial(perfilId, coberturaId, lado)

  const { error } = await supabase.storage
    .from(BUCKETS.credenciales)
    .upload(path, archivo, { contentType: validacion.tipo, upsert })

  if (error) {
    throw new Error("No pudimos guardar la foto. Revisá tu conexión y probá de nuevo.")
  }

  return path
}

/** Compensación: borra los objetos que sí llegaron a subirse cuando el resto de la operación falla después (mismo patrón que `lib/documentos/ingesta.ts`). Nunca lanza: es best-effort, y el objeto huérfano queda logueado. */
async function limpiarObjetosSubidos(paths: (string | null)[]): Promise<void> {
  for (const path of paths) {
    if (!path) continue
    try {
      await borrarObjeto(BUCKETS.credenciales, path)
    } catch (errorBorrado) {
      console.error(
        `[coberturas] Quedó un objeto huérfano en ${BUCKETS.credenciales}/${path}:`,
        errorBorrado,
      )
    }
  }
}

/** Desmarca la cobertura principal actual del perfil, si hay una. Ver el bloque del encabezado sobre por qué es una sentencia APARTE. Best-effort: si falla, el INSERT/UPDATE siguiente puede toparse igual con el índice parcial y ahí se traduce el 23505. */
async function desmarcarPrincipal(
  supabase: ClienteSupabaseServidor,
  perfilId: string,
): Promise<void> {
  const { error } = await supabase
    .from("insurance_cards")
    .update({ is_primary: false })
    .eq("profile_id", perfilId)
    .eq("is_primary", true)

  if (error) {
    console.error(
      `[coberturas] No se pudo desmarcar la cobertura principal previa de ${perfilId}:`,
      error,
    )
  }
}

/** Traduce el 23505 de los dos UNIQUE de `insurance_cards` a un mensaje mostrable. Cualquier otro código es un error inesperado: se loguea y se devuelve el mensaje genérico de quien llama. */
function mapearErrorEscrituraCobertura(
  error: { code?: string; message?: string },
  mensajeGenerico: string,
): string {
  if (error.code === "23505") {
    if (error.message?.includes("insurance_cards_una_principal_idx")) {
      return ERROR_UNA_PRINCIPAL
    }
    if (error.message?.includes("insurance_cards_cobertura_unica")) {
      return ERROR_COBERTURA_DUPLICADA
    }
  }
  console.error("[coberturas] Error inesperado al guardar la cobertura:", error)
  return mensajeGenerico
}

/**
 * Alta de cobertura. `FormData` trae los campos de texto de
 * `components/coberturas/formulario-cobertura.tsx` más, opcionalmente, los
 * blobs ya comprimidos `frente`/`dorso`.
 */
export async function crearCobertura(formData: FormData): Promise<ResultadoGuardadoCobertura> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { ok: false, error: SIN_PERFIL_ACTIVO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarCobertura(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { ok: false, error: validacion.error }
    }
    const { datos } = validacion

    const archivoFrente = formData.get("frente")
    const archivoDorso = formData.get("dorso")
    const frenteFile = archivoFrente instanceof File && archivoFrente.size > 0 ? archivoFrente : null
    const dorsoFile = archivoDorso instanceof File && archivoDorso.size > 0 ? archivoDorso : null

    // El id se genera ACÁ, antes de subir nada: el path de Storage lo
    // necesita, y el path nunca debe depender de algo que mande el cliente
    // (mismo criterio que `construirStoragePath` en `lib/documentos/ingesta.ts`).
    const coberturaId = crypto.randomUUID()

    let frontPath: string | null = null
    let backPath: string | null = null

    try {
      if (frenteFile) {
        frontPath = await subirLadoCredencial(
          supabase,
          activo.perfil.id,
          coberturaId,
          "front",
          frenteFile,
          false,
        )
      }
      if (dorsoFile) {
        backPath = await subirLadoCredencial(
          supabase,
          activo.perfil.id,
          coberturaId,
          "back",
          dorsoFile,
          false,
        )
      }
    } catch (errorSubida) {
      await limpiarObjetosSubidos([frontPath, backPath])
      return {
        ok: false,
        error: errorSubida instanceof Error ? errorSubida.message : ERROR_INESPERADO_CREAR,
      }
    }

    if (datos.esPrincipal) {
      await desmarcarPrincipal(supabase, activo.perfil.id)
    }

    const { error } = await supabase.from("insurance_cards").insert({
      id: coberturaId,
      profile_id: activo.perfil.id,
      provider: datos.proveedor,
      plan: datos.plan ?? null,
      member_number: datos.numeroAfiliado ?? null,
      is_primary: datos.esPrincipal,
      front_storage_path: frontPath,
      back_storage_path: backPath,
    })

    if (error) {
      // Compensación: la fila no quedó, así que las fotos recién subidas
      // quedarían huérfanas -mismo motivo que `lib/documentos/ingesta.ts`-.
      await limpiarObjetosSubidos([frontPath, backPath])
      return { ok: false, error: mapearErrorEscrituraCobertura(error, ERROR_INESPERADO_CREAR) }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { ok: false, error: error.message }
    }
    console.error("[coberturas] Fallo inesperado al crear una cobertura:", error)
    return { ok: false, error: ERROR_INESPERADO_CREAR }
  }

  // `revalidatePath` sigue siendo necesario aunque acá ya no haya `redirect()`:
  // viaja en la respuesta de la acción (`x-action-revalidated`) y es lo que
  // hace que el `router.push` del cliente traiga la lista CON la cobertura
  // nueva en vez de la copia que el router ya tenía.
  revalidatePath("/coberturas")
  return { ok: true, destino: "/coberturas?creada=1" }
}

/** Edición de una cobertura ya cargada: datos, y opcionalmente reemplazo de frente/dorso. */
export async function actualizarCobertura(
  formData: FormData,
): Promise<ResultadoGuardadoCobertura> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { ok: false, error: SIN_PERFIL_ACTIVO }
    }

    const coberturaId = campo(formData, "coberturaId")
    if (!PATRON_UUID.test(coberturaId)) {
      return { ok: false, error: SIN_COBERTURA_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarCobertura(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { ok: false, error: validacion.error }
    }
    const { datos } = validacion

    const archivoFrente = formData.get("frente")
    const archivoDorso = formData.get("dorso")
    const frenteFile = archivoFrente instanceof File && archivoFrente.size > 0 ? archivoFrente : null
    const dorsoFile = archivoDorso instanceof File && archivoDorso.size > 0 ? archivoDorso : null

    let frontPathNuevo: string | null = null
    let backPathNuevo: string | null = null

    try {
      if (frenteFile) {
        frontPathNuevo = await subirLadoCredencial(
          supabase,
          activo.perfil.id,
          coberturaId,
          "front",
          frenteFile,
          true,
        )
      }
      if (dorsoFile) {
        backPathNuevo = await subirLadoCredencial(
          supabase,
          activo.perfil.id,
          coberturaId,
          "back",
          dorsoFile,
          true,
        )
      }
    } catch (errorSubida) {
      return {
        ok: false,
        error: errorSubida instanceof Error ? errorSubida.message : ERROR_INESPERADO_EDITAR,
      }
    }

    if (datos.esPrincipal) {
      await desmarcarPrincipal(supabase, activo.perfil.id)
    }

    const cambios: CambiosCobertura = {
      provider: datos.proveedor,
      plan: datos.plan ?? null,
      member_number: datos.numeroAfiliado ?? null,
      is_primary: datos.esPrincipal,
    }
    // El path solo se toca si de verdad hay una foto nueva: sin esto, editar
    // solo el proveedor (sin tocar las fotos) pisaría las columnas existentes
    // con `null`.
    if (frontPathNuevo) cambios.front_storage_path = frontPathNuevo
    if (backPathNuevo) cambios.back_storage_path = backPathNuevo

    const { error, count } = await supabase
      .from("insurance_cards")
      .update(cambios, { count: "exact" })
      .eq("id", coberturaId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      return { ok: false, error: mapearErrorEscrituraCobertura(error, ERROR_INESPERADO_EDITAR) }
    }
    if (!count) {
      return { ok: false, error: ERROR_COBERTURA_NO_ENCONTRADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { ok: false, error: error.message }
    }
    console.error("[coberturas] Fallo inesperado al editar una cobertura:", error)
    return { ok: false, error: ERROR_INESPERADO_EDITAR }
  }

  // Ver la nota de `crearCobertura`: revalidar sigue haciendo falta sin redirect.
  revalidatePath("/coberturas")
  return { ok: true, destino: "/coberturas?editada=1" }
}

/** Marca una cobertura existente como principal (desde la billetera, sin pasar por el formulario de edición completo). */
export async function marcarPrincipal(
  _estadoPrevio: EstadoCoberturaAccion,
  formData: FormData,
): Promise<EstadoCoberturaAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const coberturaId = campo(formData, "coberturaId")
    if (!PATRON_UUID.test(coberturaId)) {
      return { error: SIN_COBERTURA_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    await desmarcarPrincipal(supabase, activo.perfil.id)

    const { error, count } = await supabase
      .from("insurance_cards")
      .update({ is_primary: true }, { count: "exact" })
      .eq("id", coberturaId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      return { error: mapearErrorEscrituraCobertura(error, ERROR_INESPERADO_PRINCIPAL) }
    }
    if (!count) {
      return { error: ERROR_COBERTURA_NO_ENCONTRADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[coberturas] Fallo inesperado al marcar una cobertura como principal:", error)
    return { error: ERROR_INESPERADO_PRINCIPAL }
  }

  revalidatePath("/coberturas")
  redirect("/coberturas?principal=1")
}

/**
 * Elimina una cobertura. `DELETE` real, no baja lógica: a diferencia de
 * `medications`/`doctors` (nota ⑭ de `docs/modelo-permisos.md`),
 * `insurance_cards` no tiene columna de baja lógica y el trigger
 * `insurance_cards_encolar_purga_storage` (`20260812210000_ajustes_modelo.sql`)
 * es un `AFTER DELETE`: solo encola la purga de las fotos si la fila se
 * borra de verdad. El borrado inmediato de los objetos de acá es
 * belt-and-suspenders, igual que `descartarDocumento`
 * (`estudios/actions.ts`): si falla, la cola los alcanza igual más tarde.
 */
export async function eliminarCobertura(
  _estadoPrevio: EstadoCoberturaAccion,
  formData: FormData,
): Promise<EstadoCoberturaAccion> {
  let paths: (string | null)[] = []

  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const coberturaId = campo(formData, "coberturaId")
    if (!PATRON_UUID.test(coberturaId)) {
      return { error: SIN_COBERTURA_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const { data: fila, error: errorLectura } = await supabase
      .from("insurance_cards")
      .select("front_storage_path, back_storage_path")
      .eq("id", coberturaId)
      .eq("profile_id", activo.perfil.id)
      .maybeSingle()

    if (errorLectura) {
      console.error(
        `[coberturas] Fallo al leer la cobertura ${coberturaId} antes de borrarla:`,
        errorLectura,
      )
      return { error: ERROR_INESPERADO_ELIMINAR }
    }
    if (!fila) {
      return { error: ERROR_COBERTURA_NO_ENCONTRADA }
    }
    paths = [fila.front_storage_path, fila.back_storage_path]

    const { error, count } = await supabase
      .from("insurance_cards")
      .delete({ count: "exact" })
      .eq("id", coberturaId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[coberturas] Fallo al borrar la cobertura ${coberturaId}:`, error)
      return { error: ERROR_INESPERADO_ELIMINAR }
    }
    if (!count) {
      return { error: ERROR_COBERTURA_NO_ENCONTRADA }
    }

    await limpiarObjetosSubidos(paths)
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[coberturas] Fallo inesperado al eliminar una cobertura:", error)
    return { error: ERROR_INESPERADO_ELIMINAR }
  }

  revalidatePath("/coberturas")
  redirect("/coberturas?eliminada=1")
}
