"use server"

/**
 * Server Actions de `/medicacion` (Sprint 7, tarea 7.2 — ROADMAP_SPRINTS.md).
 *
 * Cuatro acciones, todas operando sobre el PERFIL ACTIVO
 * (`obtenerPerfilActivo()`), nunca sobre un `perfilId` que mande el cliente
 * -mismo criterio que `turnos/actions.ts` y `estudios/actions.ts#subirDocumento`-:
 *
 * - `crearMedicacion` — alta. Exige `upload`
 *   (`medications_insert_puede_cargar`, `docs/modelo-permisos.md`). Además
 *   del `INSERT`, materializa las tomas de HOY llamando a
 *   `generar_tomas_del_dia()` con `service_role`
 *   (`lib/medicacion/generar-tomas-admin.ts`) — contrato de
 *   `docs/modelo-medicacion.md` §9 para esta tarea. Es best-effort: si falla,
 *   la medicación queda igual guardada y el job de `pg_cron` de las 00:05
 *   Ushuaia la alcanza esa misma madrugada.
 * - `actualizarMedicacion` — edición de los datos. Exige `manage`
 *   (`medications_update_administrador`). NO vuelve a llamar al generador:
 *   el contrato de la tarea lo reserva para el alta.
 * - `suspenderMedicacion` / `reactivarMedicacion` — transición de
 *   `is_active`. También exigen `manage`. Suspender NO borra: fija
 *   `is_active = false` Y `suspended_at = now()` en la misma escritura -el
 *   CHECK `medications_suspension_coherente` exige las dos juntas-, así que
 *   la medicación pasa al histórico sin perder ninguna fila de
 *   `medication_intakes` (que tiene `on delete cascade` desde `medication_id`,
 *   pero acá nunca se hace `DELETE`). Reactivar vuelve `is_active = true` y
 *   limpia `suspended_at`.
 *
 * Las dos transiciones validan el estado de ORIGEN con `.eq("is_active", ...)`
 * en la propia consulta -mismo patrón que las transiciones de turno-: un
 * `UPDATE` que no matchea ninguna fila (ya estaba en el estado pedido, o es
 * de otro perfil) no tira error, así que se usa `{ count: "exact" }` para
 * devolver un mensaje claro en vez de fingir éxito.
 *
 * - `registrarToma` / `revertirToma` (Sprint 7, tarea 7.3) — NO son
 *   `INSERT`/`UPDATE` sobre `medication_intakes`: llaman a los RPC
 *   `SECURITY DEFINER` `registrar_toma(intake_id)` / `revertir_toma(intake_id)`
 *   que entregó la tarea 7.1 (`supabase/migrations/20260813060000_medicacion_estado.sql`,
 *   contrato en `docs/modelo-medicacion.md` §4 y §6 — nota ⑨: descontar/restituir
 *   el stock es un `UPDATE` sobre `medications`, tabla donde `can_upload` no
 *   escribe por la vía directa). Exigen `upload` -registrar/deshacer una toma
 *   es cargar un dato del día, igual que confirmar un turno- como DEFENSA EN
 *   PROFUNDIDAD: el RPC ya valida `puede_cargar_en_perfil` por dentro, así que
 *   esta guarda de acá nunca debería ser la que rechace en el uso normal.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { generarTomasDelDiaComoServicio } from "@/lib/medicacion/generar-tomas-admin"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { validarMedicacion } from "@/lib/validacion/medicacion.schema"

export interface EstadoMedicacionAccion {
  error: string | null
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando la medicación."

const SIN_MEDICACION_ID =
  "No pudimos identificar la medicación. Volvé a intentarlo desde la lista."

const SIN_TOMA_ID = "No pudimos identificar la toma. Volvé a intentarlo desde la lista."

const ERROR_PERMISO_TOMA = "No tenés permiso para registrar tomas en este perfil."

const ERROR_INESPERADO_REGISTRAR_TOMA =
  "Ocurrió un problema y no pudimos registrar la toma. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_REVERTIR_TOMA =
  "Ocurrió un problema y no pudimos deshacer la toma. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_CREAR =
  "Ocurrió un problema y no pudimos guardar la medicación. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_EDITAR =
  "Ocurrió un problema y no pudimos guardar los cambios. Probá de nuevo en unos minutos."

const ERROR_MEDICACION_NO_ENCONTRADA = "No encontramos esa medicación, o ya no está disponible."

const ERROR_TRANSICION_NO_APLICADA =
  "No pudimos actualizar la medicación. Puede que su estado ya haya cambiado — recargá la página."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` (mismo criterio que `turnos/actions.ts#campo`). */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

function datosCrudosDelFormulario(formData: FormData) {
  return {
    nombre: campo(formData, "nombre"),
    droga: campo(formData, "droga"),
    presentacion: campo(formData, "presentacion"),
    dosisCantidad: campo(formData, "dosisCantidad"),
    dosisUnidad: campo(formData, "dosisUnidad"),
    frecuencia: campo(formData, "frecuencia"),
    // Cada chip de `CampoHorarios` viaja como su propio hidden
    // `name="horarios"`: `getAll` devuelve el array completo.
    horarios: formData.getAll("horarios").filter((valor): valor is string => typeof valor === "string"),
    intervaloHoras: campo(formData, "intervaloHoras"),
    fechaInicio: campo(formData, "fechaInicio"),
    fechaFin: campo(formData, "fechaFin"),
    stock: campo(formData, "stock"),
    notas: campo(formData, "notas"),
  }
}

/**
 * Alta de medicación. `FormData` trae los campos de
 * `components/medicacion/formulario-medicacion.tsx`; el perfil sale de la
 * cookie activa, no del formulario.
 */
export async function crearMedicacion(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarMedicacion(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const { datos } = validacion

    const { error } = await supabase.from("medications").insert({
      profile_id: activo.perfil.id,
      name: datos.nombre,
      active_ingredient: datos.droga ?? null,
      presentation: datos.presentacion ?? null,
      dose_amount: datos.dosisCantidad,
      dose_unit: datos.dosisUnidad,
      frequency: datos.frecuencia,
      schedule_times: datos.frecuencia === "daily" ? datos.horarios : null,
      interval_hours: datos.frecuencia === "interval_hours" ? (datos.intervaloHoras ?? null) : null,
      start_date: datos.fechaInicio,
      end_date: datos.fechaFin ?? null,
      stock_units: datos.stock ?? null,
      notes: datos.notas ?? null,
    })

    if (error) {
      console.error("[medicacion] Fallo al crear una medicación:", error)
      return { error: ERROR_INESPERADO_CREAR }
    }

    try {
      await generarTomasDelDiaComoServicio()
    } catch (errorTomas) {
      console.error(
        "[medicacion] La medicación se guardó pero no se pudieron generar las tomas de hoy (las genera el cron nocturno igual):",
        errorTomas,
      )
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al crear una medicación:", error)
    return { error: ERROR_INESPERADO_CREAR }
  }

  revalidatePath("/medicacion")
  redirect("/medicacion?creada=1")
}

/** Edición de los datos de una medicación YA cargada. No toca `is_active`/`suspended_at`: eso lo hacen `suspenderMedicacion`/`reactivarMedicacion`. */
export async function actualizarMedicacion(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const medicacionId = campo(formData, "medicacionId")
    if (!PATRON_UUID.test(medicacionId)) {
      return { error: SIN_MEDICACION_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarMedicacion(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const { datos } = validacion

    const { error, count } = await supabase
      .from("medications")
      .update(
        {
          name: datos.nombre,
          active_ingredient: datos.droga ?? null,
          presentation: datos.presentacion ?? null,
          dose_amount: datos.dosisCantidad,
          dose_unit: datos.dosisUnidad,
          frequency: datos.frecuencia,
          schedule_times: datos.frecuencia === "daily" ? datos.horarios : null,
          interval_hours:
            datos.frecuencia === "interval_hours" ? (datos.intervaloHoras ?? null) : null,
          start_date: datos.fechaInicio,
          end_date: datos.fechaFin ?? null,
          stock_units: datos.stock ?? null,
          notes: datos.notas ?? null,
        },
        { count: "exact" },
      )
      .eq("id", medicacionId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[medicacion] Fallo al actualizar la medicación ${medicacionId}:`, error)
      return { error: ERROR_INESPERADO_EDITAR }
    }
    if (!count) {
      return { error: ERROR_MEDICACION_NO_ENCONTRADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al editar una medicación:", error)
    return { error: ERROR_INESPERADO_EDITAR }
  }

  revalidatePath("/medicacion")
  redirect("/medicacion?editada=1")
}

/**
 * Núcleo compartido de las dos transiciones de `is_active`: valida sesión y
 * `manage` sobre el perfil activo, y aplica el `UPDATE` condicionado al
 * estado de origen.
 */
async function transicionarActivaMedicacion(
  formData: FormData,
  cambios: { is_active: boolean; suspended_at: string | null },
  estadoDeOrigen: boolean,
  redireccion: string,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const medicacionId = campo(formData, "medicacionId")
    if (!PATRON_UUID.test(medicacionId)) {
      return { error: SIN_MEDICACION_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const { error, count } = await supabase
      .from("medications")
      .update(cambios, { count: "exact" })
      .eq("id", medicacionId)
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", estadoDeOrigen)

    if (error) {
      console.error(`[medicacion] Fallo al cambiar el estado de ${medicacionId}:`, error)
      return { error: ERROR_TRANSICION_NO_APLICADA }
    }
    if (!count) {
      return { error: ERROR_TRANSICION_NO_APLICADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al cambiar el estado de una medicación:", error)
    return { error: ERROR_TRANSICION_NO_APLICADA }
  }

  revalidatePath("/medicacion")
  redirect(redireccion)
}

/** Activa → suspendida. NO borra: `medications_suspension_coherente` exige `is_active = false` y `suspended_at` juntos. Disparada desde `DialogoConfirmacion` (ver `components/medicacion/acciones-medicacion.tsx`). */
export async function suspenderMedicacion(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  return transicionarActivaMedicacion(
    formData,
    { is_active: false, suspended_at: new Date().toISOString() },
    true,
    "/medicacion?suspendida=1",
  )
}

/** Suspendida → activa. */
export async function reactivarMedicacion(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  return transicionarActivaMedicacion(
    formData,
    { is_active: true, suspended_at: null },
    false,
    "/medicacion?reactivada=1",
  )
}

/**
 * Traduce los SQLSTATE que devuelven `registrar_toma`/`revertir_toma`
 * (`docs/modelo-medicacion.md` §9, contrato de la tarea 7.3):
 *
 * - `42501` (`insufficient_privilege`) — sin `can_upload` sobre el perfil.
 *   Mensaje fijo: el RPC redacta uno distinto según sea registrar o
 *   revertir ("...para registrar/corregir tomas..."), pero el contrato de
 *   7.3 pide UN mensaje mostrable para este código, así que no se usa el del
 *   RPC acá.
 * - `22023` (`invalid_parameter_value`) — toma inexistente, ya registrada,
 *   fuera de la ventana de ±12hs, o (para revertir) de otro día. El RPC ya
 *   redacta el mensaje en castellano y es mostrable TAL CUAL (docs, misma
 *   sección) — nunca se reemplaza acá.
 * - Cualquier otro código: error inesperado, se loguea y se devuelve el
 *   mensaje genérico de quien llama.
 */
function mapearErrorToma(error: { code?: string; message?: string }, mensajeGenerico: string): string {
  if (error.code === "42501") {
    return ERROR_PERMISO_TOMA
  }
  if (error.code === "22023") {
    return error.message || mensajeGenerico
  }
  console.error("[medicacion] Error inesperado del RPC de tomas:", error)
  return mensajeGenerico
}

/**
 * Marca como tomada una toma programada de HOY y descuenta el stock, vía
 * `rpc("registrar_toma", { intake_id })` — NUNCA un `UPDATE` directo a
 * `medication_intakes`: perdería el descuento de stock y la atomicidad
 * (nota ⑨, `docs/modelo-medicacion.md` §4). El cliente es el de la SESIÓN
 * del usuario, no `service_role`: el RPC valida el permiso por dentro y las
 * dos escrituras (`medication_intakes` + `medications`) corren con la
 * identidad real de quien registra, para que quede en `created_by_profile_id`.
 */
export async function registrarToma(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const tomaId = campo(formData, "tomaId")
    if (!PATRON_UUID.test(tomaId)) {
      return { error: SIN_TOMA_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const { error } = await supabase.rpc("registrar_toma", { intake_id: tomaId })

    if (error) {
      console.error(`[medicacion] Fallo al registrar la toma ${tomaId}:`, error)
      return { error: mapearErrorToma(error, ERROR_INESPERADO_REGISTRAR_TOMA) }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al registrar una toma:", error)
    return { error: ERROR_INESPERADO_REGISTRAR_TOMA }
  }

  revalidatePath("/medicacion")
  revalidatePath("/inicio")
  redirect("/medicacion?tomaregistrada=1")
}

/**
 * Deshace una toma marcada por error HOY, vía
 * `rpc("revertir_toma", { intake_id })`: la vuelve a `pending` y restituye
 * EXACTAMENTE lo que `registrar_toma` había descontado
 * (`docs/modelo-medicacion.md` §6). El RPC ya rechaza una toma de otro día
 * calendario en Ushuaia -esta acción no repite ese chequeo de fecha antes de
 * llamarlo, sería duplicar la única fuente de verdad-; en el uso normal
 * nunca llega acá una toma vieja porque `components/medicacion/registro-toma.tsx`
 * solo ofrece este botón para tomas de la lista "de hoy".
 */
export async function revertirToma(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const tomaId = campo(formData, "tomaId")
    if (!PATRON_UUID.test(tomaId)) {
      return { error: SIN_TOMA_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const { error } = await supabase.rpc("revertir_toma", { intake_id: tomaId })

    if (error) {
      console.error(`[medicacion] Fallo al deshacer la toma ${tomaId}:`, error)
      return { error: mapearErrorToma(error, ERROR_INESPERADO_REVERTIR_TOMA) }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al deshacer una toma:", error)
    return { error: ERROR_INESPERADO_REVERTIR_TOMA }
  }

  revalidatePath("/medicacion")
  revalidatePath("/inicio")
  redirect("/medicacion?tomarevertida=1")
}

const SIN_DOCUMENTO_ID = "No pudimos identificar el documento. Volvé a intentarlo desde la edición."

const ERROR_DOCUMENTO_NO_ENCONTRADO =
  "No encontramos esa receta, o ya no está disponible para este perfil."

const ERROR_INESPERADO_ASOCIAR_RECETA =
  "Ocurrió un problema y no pudimos asociar la receta. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_DESASOCIAR_RECETA =
  "Ocurrió un problema y no pudimos desasociar la receta. Probá de nuevo en unos minutos."

/**
 * Asocia un documento categoría `prescription` ya confirmado a una medicación.
 * Valida que el documento pertenece al perfil activo y es de la categoría correcta.
 * Requiere permiso `manage`.
 */
export async function asociarReceta(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const medicacionId = campo(formData, "medicacionId")
    if (!PATRON_UUID.test(medicacionId)) {
      return { error: SIN_MEDICACION_ID }
    }

    const recetaId = campo(formData, "recetaId")
    if (!PATRON_UUID.test(recetaId)) {
      return { error: SIN_DOCUMENTO_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    // Verificar que el documento pertenece al perfil, es categoría prescription y está confirmado
    const { data: documento } = await supabase
      .from("documents")
      .select("id")
      .eq("id", recetaId)
      .eq("profile_id", activo.perfil.id)
      .eq("category", "prescription")
      .not("confirmed_at", "is", null)
      .maybeSingle()

    if (!documento) {
      return { error: ERROR_DOCUMENTO_NO_ENCONTRADO }
    }

    // Actualizar la medicación con la receta asociada
    const { error, count } = await supabase
      .from("medications")
      .update({ prescription_document_id: recetaId }, { count: "exact" })
      .eq("id", medicacionId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[medicacion] Fallo al asociar la receta ${recetaId} a ${medicacionId}:`, error)
      return { error: ERROR_INESPERADO_ASOCIAR_RECETA }
    }
    if (!count) {
      return { error: ERROR_MEDICACION_NO_ENCONTRADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al asociar una receta:", error)
    return { error: ERROR_INESPERADO_ASOCIAR_RECETA }
  }

  revalidatePath("/medicacion")
  redirect(`/medicacion/${campo(formData, "medicacionId")}/editar?receta=asociada`)
}

/**
 * Desasocia un documento de una medicación (NO borra el documento).
 * Requiere permiso `manage`.
 */
export async function desasociarReceta(
  _estadoPrevio: EstadoMedicacionAccion,
  formData: FormData,
): Promise<EstadoMedicacionAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const medicacionId = campo(formData, "medicacionId")
    if (!PATRON_UUID.test(medicacionId)) {
      return { error: SIN_MEDICACION_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    // Actualizar la medicación: prescription_document_id a NULL
    const { error, count } = await supabase
      .from("medications")
      .update({ prescription_document_id: null }, { count: "exact" })
      .eq("id", medicacionId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[medicacion] Fallo al desasociar la receta de ${medicacionId}:`, error)
      return { error: ERROR_INESPERADO_DESASOCIAR_RECETA }
    }
    if (!count) {
      return { error: ERROR_MEDICACION_NO_ENCONTRADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[medicacion] Fallo inesperado al desasociar una receta:", error)
    return { error: ERROR_INESPERADO_DESASOCIAR_RECETA }
  }

  revalidatePath("/medicacion")
  redirect(`/medicacion/${campo(formData, "medicacionId")}/editar?receta=quitada`)
}
