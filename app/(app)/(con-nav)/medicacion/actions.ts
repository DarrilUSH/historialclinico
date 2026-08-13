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
