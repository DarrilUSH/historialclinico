"use server"

/**
 * Server Actions de `/turnos` (Sprint 6, tarea 6.1 — ROADMAP_SPRINTS.md).
 *
 * Cinco acciones, todas operando sobre el PERFIL ACTIVO (`obtenerPerfilActivo()`),
 * nunca sobre un `perfilId` que mande el cliente -mismo criterio que
 * `estudios/actions.ts#subirDocumento`-:
 *
 * - `crearTurno` — alta. Exige `upload` (docs/modelo-permisos.md §6.1:
 *   "INSERT | dueño O (can_upload O can_manage)"). Fecha futura obligatoria.
 * - `actualizarTurno` — edición de los datos del turno. Exige `manage`
 *   (§6.1: "UPDATE / DELETE | dueño O can_manage"). Fecha futura NO
 *   obligatoria: se puede corregir un turno con fecha pasada.
 * - `confirmarTurno`, `completarTurno`, `cancelarTurno` — transiciones de
 *   `status`. También exigen `manage`: la nota ⑬ de
 *   `docs/modelo-permisos.md` deja explícito que "confirmar o cancelar un
 *   turno es HOY can_manage" y que ampliarlo a `can_upload` (una excepción
 *   análoga a la ⑩ de `medication_intakes`) es una decisión a tomar "al
 *   implementar el CRUD de turnos" -esta tarea-. Se mantiene en `can_manage`:
 *   la matriz vigente y la política ya aplicada
 *   (`appointments_update_administrador`,
 *   `supabase/migrations/20260812220000_rls.sql`) ya usan
 *   `puede_administrar_perfil`, así que no hace falta tocar RLS para cumplir
 *   el criterio de aceptación del roadmap ("un `status` inválido es
 *   rechazado por el enum a nivel base"); ampliar el permiso queda abierto
 *   para cuando el producto lo pida explícitamente.
 *
 * Las tres transiciones de estado, además, validan la transición ACTUAL con
 * `.eq("status", ...)` / `.in("status", [...])` en la propia consulta: un
 * `UPDATE` que no matchea ninguna fila (turno ya en otro estado, o de otro
 * perfil) no tira error -es "cero filas", el mismo principio 3 de
 * docs/modelo-permisos.md-, así que se usa `{ count: "exact" }` para
 * distinguir ese caso y devolver un mensaje claro en vez de fingir éxito.
 *
 * ## `doctorId`: vinculación con el directorio (Sprint 10, tarea 10.1)
 *
 * `crearTurno` y `actualizarTurno` reciben además un `doctorId` opcional
 * (`components/turnos/formulario-turno.tsx`, campo oculto detrás del
 * `<Select>` "Médico (opcional)"). Antes de persistirlo en
 * `appointments.doctor_id`, `resolverDoctorId` verifica que ese `id`
 * pertenezca a un médico de `doctors` **del mismo perfil activo** -mismo
 * criterio de ownership que `medicacion/actions.ts#asociarReceta` con
 * `documents`-: el `<Select>` del cliente solo ofrece médicos del perfil
 * activo, pero el campo oculto viaja en el `FormData` como cualquier otro
 * input, y nada impide que alguien lo edite a mano antes de enviar. Sin este
 * chequeo, un `doctorId` de OTRO perfil (ajeno al actor) pasaría el `INSERT`
 * igual -`appointments_doctor_id_fkey` solo exige que la fila exista en
 * `doctors`, no que sea del mismo `profile_id`- y dejaría un turno vinculado
 * a un médico que la persona nunca cargó.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { type ClienteSupabaseServidor, esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { validarTurno } from "@/lib/validacion/turno.schema"
import type { EstadoTurno } from "@/types/dominio"

export interface EstadoTurnoAccion {
  error: string | null
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando el turno."

const SIN_TURNO_ID = "No pudimos identificar el turno. Volvé a intentarlo desde la lista."

const ERROR_INESPERADO_CREAR =
  "Ocurrió un problema y no pudimos guardar el turno. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_EDITAR =
  "Ocurrió un problema y no pudimos guardar los cambios. Probá de nuevo en unos minutos."

const ERROR_TURNO_NO_ENCONTRADO =
  "No encontramos ese turno, o ya no está disponible para editar."

const ERROR_MEDICO_NO_VALIDO =
  "El médico elegido no es válido, o no pertenece a este directorio. Volvé a elegirlo de la lista."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` -un campo colapsado (coordenadas avanzadas) puede no llegar en el `FormData` y no tiene que romper la validación con un error de tipo. */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

function datosCrudosDelFormulario(formData: FormData) {
  return {
    especialidad: campo(formData, "especialidad"),
    medico: campo(formData, "medico"),
    fecha: campo(formData, "fecha"),
    hora: campo(formData, "hora"),
    lugarNombre: campo(formData, "lugarNombre"),
    lugarDireccion: campo(formData, "lugarDireccion"),
    latitud: campo(formData, "latitud"),
    longitud: campo(formData, "longitud"),
    notasPreparacion: campo(formData, "notasPreparacion"),
  }
}

/**
 * Resuelve el `doctorId` opcional del `FormData` a un valor listo para
 * `appointments.doctor_id`: `null` si viene vacío (sin vínculo, o "Ninguno"
 * en el `<Select>`), o el `id` verificado si viene cargado. Ver el
 * comentario de cabecera del archivo para el motivo del chequeo de
 * ownership -nunca se confía en que el `FormData` solo pudo traer un `id`
 * del perfil activo-.
 */
async function resolverDoctorId(
  supabase: ClienteSupabaseServidor,
  formData: FormData,
  perfilId: string,
): Promise<{ ok: true; doctorId: string | null } | { ok: false; error: string }> {
  const valor = campo(formData, "doctorId")
  if (valor.length === 0) {
    return { ok: true, doctorId: null }
  }
  if (!PATRON_UUID.test(valor)) {
    return { ok: false, error: ERROR_MEDICO_NO_VALIDO }
  }

  const { data: medico } = await supabase
    .from("doctors")
    .select("id")
    .eq("id", valor)
    .eq("profile_id", perfilId)
    .maybeSingle()

  if (!medico) {
    return { ok: false, error: ERROR_MEDICO_NO_VALIDO }
  }

  return { ok: true, doctorId: medico.id }
}

/**
 * Alta de turno. `FormData` trae los campos del formulario -ver
 * `components/turnos/formulario-turno.tsx`-; el perfil sale de la cookie
 * activa, no del formulario (mismo motivo que documenta
 * `estudios/actions.ts#subirDocumento`: aceptar un `perfilId` del cliente
 * permitiría cargarle un turno a un perfil distinto del que la persona está
 * viendo en pantalla).
 */
export async function crearTurno(
  _estadoPrevio: EstadoTurnoAccion,
  formData: FormData,
): Promise<EstadoTurnoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarTurno(datosCrudosDelFormulario(formData), {
      exigirFechaFutura: true,
    })
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const resueltoDoctorId = await resolverDoctorId(supabase, formData, activo.perfil.id)
    if (!resueltoDoctorId.ok) {
      return { error: resueltoDoctorId.error }
    }

    const { datos } = validacion

    const { error } = await supabase.from("appointments").insert({
      profile_id: activo.perfil.id,
      specialty: datos.especialidad,
      doctor_name: datos.medico ?? null,
      doctor_id: resueltoDoctorId.doctorId,
      appointment_date: datos.fechaHoraIso,
      location_name: datos.lugarNombre ?? null,
      location_address: datos.lugarDireccion ?? null,
      latitude: datos.latitud ?? null,
      longitude: datos.longitud ?? null,
      preparation_notes: datos.notasPreparacion ?? null,
    })

    if (error) {
      console.error("[turnos] Fallo al crear un turno:", error)
      return { error: ERROR_INESPERADO_CREAR }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[turnos] Fallo inesperado al crear un turno:", error)
    return { error: ERROR_INESPERADO_CREAR }
  }

  revalidatePath("/turnos")
  redirect("/turnos?creado=1")
}

/**
 * Edición de los datos de un turno YA cargado. Fecha futura NO obligatoria
 * (ver el comentario de cabecera): se puede corregir la dirección o las
 * notas de preparación de un turno que ya pasó sin que la validación lo
 * bloquee por estar en el pasado.
 */
export async function actualizarTurno(
  _estadoPrevio: EstadoTurnoAccion,
  formData: FormData,
): Promise<EstadoTurnoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const turnoId = campo(formData, "turnoId")
    if (!PATRON_UUID.test(turnoId)) {
      return { error: SIN_TURNO_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarTurno(datosCrudosDelFormulario(formData), {
      exigirFechaFutura: false,
    })
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const resueltoDoctorId = await resolverDoctorId(supabase, formData, activo.perfil.id)
    if (!resueltoDoctorId.ok) {
      return { error: resueltoDoctorId.error }
    }

    const { datos } = validacion

    const { error, count } = await supabase
      .from("appointments")
      .update(
        {
          specialty: datos.especialidad,
          doctor_name: datos.medico ?? null,
          doctor_id: resueltoDoctorId.doctorId,
          appointment_date: datos.fechaHoraIso,
          location_name: datos.lugarNombre ?? null,
          location_address: datos.lugarDireccion ?? null,
          latitude: datos.latitud ?? null,
          longitude: datos.longitud ?? null,
          preparation_notes: datos.notasPreparacion ?? null,
        },
        { count: "exact" },
      )
      .eq("id", turnoId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[turnos] Fallo al actualizar el turno ${turnoId}:`, error)
      return { error: ERROR_INESPERADO_EDITAR }
    }
    if (!count) {
      return { error: ERROR_TURNO_NO_ENCONTRADO }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[turnos] Fallo inesperado al editar un turno:", error)
    return { error: ERROR_INESPERADO_EDITAR }
  }

  revalidatePath("/turnos")
  redirect("/turnos?editado=1")
}

/** Mensaje compartido por las tres transiciones cuando el `UPDATE` no matchea ninguna fila. */
const ERROR_TRANSICION_NO_APLICADA =
  "No pudimos actualizar el turno. Puede que su estado ya haya cambiado — recargá la página."

type EstadoTurnoTransicionable = Exclude<EstadoTurno, "pending">

/**
 * Núcleo compartido de las tres transiciones de estado: valida sesión y
 * `manage` sobre el perfil activo, y aplica el `UPDATE` condicionado al
 * estado de origen. Las tres Server Actions públicas quedan de una línea
 * cada una.
 */
async function transicionarEstadoTurno(
  formData: FormData,
  nuevoEstado: EstadoTurnoTransicionable,
  estadosDeOrigenValidos: readonly EstadoTurno[],
): Promise<EstadoTurnoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const turnoId = campo(formData, "turnoId")
    if (!PATRON_UUID.test(turnoId)) {
      return { error: SIN_TURNO_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const { error, count } = await supabase
      .from("appointments")
      .update({ status: nuevoEstado }, { count: "exact" })
      .eq("id", turnoId)
      .eq("profile_id", activo.perfil.id)
      .in("status", estadosDeOrigenValidos)

    if (error) {
      console.error(`[turnos] Fallo al pasar el turno ${turnoId} a "${nuevoEstado}":`, error)
      return { error: ERROR_TRANSICION_NO_APLICADA }
    }
    if (!count) {
      return { error: ERROR_TRANSICION_NO_APLICADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error(`[turnos] Fallo inesperado al pasar un turno a "${nuevoEstado}":`, error)
    return { error: ERROR_TRANSICION_NO_APLICADA }
  }

  revalidatePath("/turnos")
  redirect(`/turnos?${nuevoEstado === "confirmed" ? "confirmado" : nuevoEstado === "completed" ? "completado" : "cancelado"}=1`)
}

/** pendiente → confirmado. */
export async function confirmarTurno(
  _estadoPrevio: EstadoTurnoAccion,
  formData: FormData,
): Promise<EstadoTurnoAccion> {
  return transicionarEstadoTurno(formData, "confirmed", ["pending"])
}

/** pendiente | confirmado → completado. */
export async function completarTurno(
  _estadoPrevio: EstadoTurnoAccion,
  formData: FormData,
): Promise<EstadoTurnoAccion> {
  return transicionarEstadoTurno(formData, "completed", ["pending", "confirmed"])
}

/** pendiente | confirmado → cancelado. Disparada desde `DialogoConfirmacion` (ver `components/turnos/acciones-estado-turno.tsx`). */
export async function cancelarTurno(
  _estadoPrevio: EstadoTurnoAccion,
  formData: FormData,
): Promise<EstadoTurnoAccion> {
  return transicionarEstadoTurno(formData, "cancelled", ["pending", "confirmed"])
}
