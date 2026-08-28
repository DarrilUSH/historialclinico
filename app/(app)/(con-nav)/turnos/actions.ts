"use server"

/**
 * Server Actions de `/turnos` (Sprint 6, tarea 6.1 — ROADMAP_SPRINTS.md).
 *
 * Seis acciones, todas operando sobre el PERFIL ACTIVO (`obtenerPerfilActivo()`),
 * nunca sobre un `perfilId` que mande el cliente -mismo criterio que
 * `estudios/actions.ts#subirDocumento`-:
 *
 * - `crearTurno` — alta. Exige `upload` (docs/modelo-permisos.md §6.1:
 *   "INSERT | dueño O (can_upload O can_manage)"). Fecha futura obligatoria.
 *   Desde el Sprint 17 (tarea 17.2) acepta además un campo oculto
 *   `mensajeGmailId`: si el turno salió de un correo de la bandeja de Gmail,
 *   ese correo queda marcado como ingresado y apuntando al turno creado. Es
 *   best-effort y nunca hace fallar el alta — ver el comentario en el cuerpo.
 * - `crearTurnosEnLote` — alta de N turnos de una vez, desde un mensaje que
 *   asigna una serie de sesiones (agosto 2026). Mismo permiso `upload` y
 *   mismas reglas de validación que `crearTurno`, pero devuelve un reporte
 *   fila por fila en lugar de redirigir. Ver el bloque "Creación EN LOTE"
 *   más abajo para las decisiones de atomicidad, duplicados y geocodificación.
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
 * ## Ciudad/provincia y geocodificación automática (Sprint 16, tarea 16.1)
 *
 * `crearTurno`/`actualizarTurno` persisten `lugarCiudad`/`lugarProvincia` en
 * `appointments.location_city`/`location_province`. Si la persona NO cargó
 * coordenadas a mano pero sí cargó una dirección, `resolverCoordenadas`
 * intenta geocodificar automáticamente con Nominatim
 * (`lib/ubicacion/geocodificacion.ts`) usando calle+ciudad+provincia. Es
 * "mejor esfuerzo": cualquier fallo (sin resultados, timeout, red) deja
 * `latitude`/`longitude` en `NULL`, exactamente como pasaba antes de esta
 * tarea -nunca bloquea el guardado del turno-.
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
import { marcarMensajeResuelto } from "@/lib/gmail/mensajes-admin"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { detectarRepeticiones, type TurnoComparable } from "@/lib/turnos/duplicados"
import { geocodificarDireccion } from "@/lib/ubicacion/geocodificacion"
import { validarTurno, type DatosTurnoValidado } from "@/lib/validacion/turno.schema"
import { validarLoteTurnos, type TurnoDelLote } from "@/lib/validacion/turnos-lote.schema"
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
    lugarCiudad: campo(formData, "lugarCiudad"),
    lugarProvincia: campo(formData, "lugarProvincia"),
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
 * Coordenadas listas para `appointments.latitude`/`longitude`: si la persona
 * cargó las dos a mano, esas ganan sin tocar la red -el flujo manual de
 * copiar el pin de Google Maps sigue siendo la fuente de verdad-. Si no cargó
 * ninguna pero sí hay una dirección, intenta geocodificar automáticamente
 * (Sprint 16, tarea 16.1: `lib/ubicacion/geocodificacion.ts`, mejor esfuerzo,
 * nunca lanza). Sin dirección tampoco, quedan las dos en `null`, igual que
 * siempre.
 */
async function resolverCoordenadas(
  datos: DatosTurnoValidado,
): Promise<{ latitud: number | null; longitud: number | null }> {
  if (datos.latitud !== undefined && datos.longitud !== undefined) {
    return { latitud: datos.latitud, longitud: datos.longitud }
  }

  if (!datos.lugarDireccion) {
    return { latitud: null, longitud: null }
  }

  const geocodificado = await geocodificarDireccion({
    calle: datos.lugarDireccion,
    ciudad: datos.lugarCiudad,
    provincia: datos.lugarProvincia,
  })

  return geocodificado
    ? { latitud: geocodificado.latitud, longitud: geocodificado.longitud }
    : { latitud: null, longitud: null }
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

    const { supabase, usuario } = await requerirPermiso(activo.perfil.id, "upload", {
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
    const { latitud, longitud } = await resolverCoordenadas(datos)

    const { data: creado, error } = await supabase
      .from("appointments")
      .insert({
        profile_id: activo.perfil.id,
        specialty: datos.especialidad,
        doctor_name: datos.medico ?? null,
        doctor_id: resueltoDoctorId.doctorId,
        appointment_date: datos.fechaHoraIso,
        location_name: datos.lugarNombre ?? null,
        location_address: datos.lugarDireccion ?? null,
        location_city: datos.lugarCiudad ?? null,
        location_province: datos.lugarProvincia ?? null,
        latitude: latitud,
        longitude: longitud,
        preparation_notes: datos.notasPreparacion ?? null,
      })
      .select("id")
      .single()

    if (error || !creado) {
      console.error("[turnos] Fallo al crear un turno:", error)
      return { error: ERROR_INESPERADO_CREAR }
    }

    // Sprint 17, tarea 17.2: si este turno salió de un correo de la bandeja de
    // Gmail, el correo queda marcado como ingresado y apuntando al turno. Es
    // BEST-EFFORT y va al final a propósito: el turno ya está guardado, y que
    // no se pueda actualizar el registro del correo -que como mucho deja un
    // pendiente de más en una lista- no puede hacerle devolver un error a
    // alguien que acaba de cargar bien su turno. El `userId` sale de la
    // sesión, nunca del formulario: el campo oculto solo dice CUÁL correo.
    const correoGmailId = campo(formData, "mensajeGmailId")
    if (PATRON_UUID.test(correoGmailId)) {
      try {
        await marcarMensajeResuelto(usuario.id, correoGmailId, {
          estado: "ingresado",
          appointmentId: creado.id,
        })
      } catch (errorCorreo) {
        console.error(
          "[turnos] el turno se creó pero no se pudo marcar el correo de Gmail:",
          errorCorreo instanceof Error ? errorCorreo.message : errorCorreo,
        )
      }
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

/* ═══════════════════════════════════════════════════════════════════════════
 *  Creación EN LOTE (agosto 2026) — "un mensaje con diez sesiones"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un mensaje de WhatsApp puede asignar una serie entera de sesiones
 * ("Sesión 1/10 … Sesión 10/10"). El analizador ya devuelve las diez
 * propuestas; esta acción es la que las convierte en diez turnos de VERDAD de
 * un solo toque, sin obligar a la persona a repetir el formulario diez veces.
 *
 * ## Atomicidad: inserciones individuales con reporte honesto, NO un RPC "todo o nada"
 *
 * La alternativa era una función SQL que insertara las N filas en una sola
 * transacción. Se descartó, con tres motivos y en este orden:
 *
 * 1. **Todo-o-nada es la política PEOR para este caso.** El error más probable
 *    de una serie no es un fallo de base: es que la primera sesión ya pasó
 *    (la persona pega el jueves un mensaje que arrancaba el lunes) y
 *    `exigirFechaFutura` la rechaza. Con una transacción, esa única fecha
 *    vencida tiraría abajo las otras nueve, que son perfectamente válidas y
 *    son justo las que la persona necesita. El encargo pide exactamente lo
 *    contrario: "si el turno 7 falla, decir cuáles entraron y cuáles no".
 * 2. **El lote NO es atómico en la realidad de todos modos.** Los turnos que
 *    ya existían se SALTEAN (ver duplicados abajo), así que un resultado
 *    parcial es el caso normal, no la excepción — un `BEGIN/COMMIT` no lo
 *    volvería "todo o nada", solo escondería el reporte.
 * 3. **Hay red adentro del alta.** `resolverCoordenadas` llama a Nominatim.
 *    Meter llamadas HTTP dentro de una transacción de Postgres es sostener
 *    locks mientras se espera a un tercero. Y un RPC nuevo además exigiría
 *    migración, política RLS propia y dos corridas del arnés, todo para
 *    empeorar el comportamiento observable.
 *
 * Cada fila entra por su cuenta, en orden, y el resultado dice fila por fila
 * qué pasó: `creado`, `duplicado` o `error` con su motivo. La persona ve
 * "Creamos 9 de 10" y CUÁL falta.
 *
 * ## Duplicados: se saltean, no se rechazan
 *
 * Pegar el mismo mensaje dos veces no puede dejar veinte turnos y cuarenta
 * recordatorios. Antes de insertar nada se leen los turnos que el perfil ya
 * tiene en el rango de fechas del lote y `detectarRepeticiones`
 * (`lib/turnos/duplicados.ts`, puro y testeado) marca los que ya están —
 * mismo instante + mismo profesional + misma especialidad. Esos NO se
 * insertan y se reportan como `duplicado`, que no es un error: es la
 * respuesta correcta. `crearTurno` (el alta de a uno, el camino común) queda
 * INTACTO a propósito -no se le agrega esta guarda- para no cambiarle el
 * comportamiento a un flujo que la gente ya conoce.
 *
 * ## Una sola geocodificación por dirección
 *
 * Las diez sesiones comparten la dirección del centro. Geocodificar diez
 * veces la misma calle sería, además de inútil, una violación de la política
 * de Nominatim ("nada de geocodificación masiva",
 * `lib/ubicacion/geocodificacion.ts`) y diez segundos de espera serializada
 * por su semáforo de 1 req/s. Se resuelve UNA vez por dirección distinta y se
 * reusa el resultado -incluido el `null` de un fallo, para no reintentar diez
 * veces algo que ya falló-.
 */

/** Qué pasó con UN turno del lote. `indice` es la posición en el array que mandó el cliente, para que la pantalla sepa qué fila marcar. */
export interface ResultadoTurnoDelLote {
  indice: number
  estado: "creado" | "duplicado" | "error"
  /** Motivo en castellano, solo cuando `estado === "error"`. */
  error: string | null
}

export interface ResultadoLoteTurnos {
  /** Error GLOBAL que impidió intentar siquiera (sin perfil, sin permiso, payload inválido). `null` si se procesó el lote. */
  error: string | null
  resultados: ResultadoTurnoDelLote[]
  creados: number
  duplicados: number
  fallidos: number
}

const ERROR_INESPERADO_LOTE =
  "Ocurrió un problema y no pudimos crear los turnos. Probá de nuevo en unos minutos."

const ERROR_FILA_INESPERADO = "No pudimos guardarlo. Probá cargándolo a mano."

function loteSoloConError(error: string): ResultadoLoteTurnos {
  return { error, resultados: [], creados: 0, duplicados: 0, fallidos: 0 }
}

/** Clave de agrupación para geocodificar una sola vez por dirección distinta del lote. */
function claveDeDireccion(datos: DatosTurnoValidado): string {
  return [datos.lugarDireccion ?? "", datos.lugarCiudad ?? "", datos.lugarProvincia ?? ""].join("|")
}

/**
 * Crea de una sola vez los turnos que la persona marcó en la lista de
 * confirmación del analizador (`components/turnos/analizador-mensaje-turno.tsx`).
 *
 * Recibe un objeto JSON, no un `FormData`: el llamador es un Client Component
 * que tiene N turnos en estado de React, no un `<form>` (mismo patrón que
 * `candidatosLugarAction` y `guardarSuscripcion`). Por eso el parámetro es
 * `unknown` y lo primero que pasa es la validación de forma —nunca se confía
 * en que el cliente mandó lo que dice mandar—, y el perfil sale de la cookie
 * activa, jamás del payload.
 *
 * No redirige ni lanza: devuelve el reporte para que la pantalla lo muestre.
 * Ver el bloque de arriba para las decisiones de atomicidad y duplicados.
 */
export async function crearTurnosEnLote(datos: unknown): Promise<ResultadoLoteTurnos> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return loteSoloConError(SIN_PERFIL_ACTIVO)
    }

    const validacionLote = validarLoteTurnos(datos)
    if (!validacionLote.ok) {
      return loteSoloConError(validacionLote.error)
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    // 1. Validar TODAS las filas primero, con las mismas reglas que el alta de
    //    a uno. Las que no pasan quedan con su motivo y no se vuelven a mirar.
    const validados = validacionLote.turnos.map((turno: TurnoDelLote) =>
      validarTurno(turno, { exigirFechaFutura: true }),
    )

    // 2. Duplicados. Una sola consulta para todo el lote, acotada al rango de
    //    fechas de los turnos válidos —no se lee la agenda entera del perfil—.
    const comparables = new Map<number, TurnoComparable>()
    validados.forEach((validacion, indice) => {
      if (validacion.ok) {
        comparables.set(indice, {
          fechaHoraIso: validacion.datos.fechaHoraIso,
          especialidad: validacion.datos.especialidad,
          medico: validacion.datos.medico ?? null,
        })
      }
    })

    let existentes: TurnoComparable[] = []
    const instantes = [...comparables.values()].map((turno) => turno.fechaHoraIso).sort()
    if (instantes.length > 0) {
      const { data, error } = await supabase
        .from("appointments")
        .select("appointment_date, specialty, doctor_name")
        .eq("profile_id", activo.perfil.id)
        .gte("appointment_date", instantes[0])
        .lte("appointment_date", instantes[instantes.length - 1])

      if (error) {
        // No poder LEER la agenda no puede impedir crear los turnos: se sigue
        // sin la guarda de duplicados (el peor caso es un turno repetido, que
        // la persona borra) en vez de dejarla sin ninguno.
        console.error("[turnos] No se pudieron leer los turnos existentes para detectar repetidos:", error)
      } else {
        existentes = (data ?? []).map((fila) => ({
          fechaHoraIso: fila.appointment_date,
          especialidad: fila.specialty,
          medico: fila.doctor_name,
        }))
      }
    }

    // `detectarRepeticiones` razona sobre posiciones de SU array, que solo
    // tiene los turnos válidos: `indicesComparables` traduce esas posiciones
    // de vuelta al índice original que espera el cliente.
    const indicesComparables = [...comparables.keys()]
    const { yaExistian, repetidosEnElLote } = detectarRepeticiones(
      indicesComparables.map((indice) => comparables.get(indice)!),
      existentes,
    )
    const duplicadosPorIndice = new Set(
      indicesComparables.filter(
        (_indiceOriginal, posicion) => yaExistian.has(posicion) || repetidosEnElLote.has(posicion),
      ),
    )

    // 3. Insertar. Una fila por vez, en orden, sin abortar por un fallo.
    const coordenadasPorDireccion = new Map<string, { latitud: number | null; longitud: number | null }>()
    const resultados: ResultadoTurnoDelLote[] = []

    for (let indice = 0; indice < validados.length; indice += 1) {
      const validacion = validados[indice]

      if (!validacion.ok) {
        resultados.push({ indice, estado: "error", error: validacion.error })
        continue
      }
      if (duplicadosPorIndice.has(indice)) {
        resultados.push({ indice, estado: "duplicado", error: null })
        continue
      }

      const { datos } = validacion
      const clave = claveDeDireccion(datos)
      let coordenadas = coordenadasPorDireccion.get(clave)
      if (!coordenadas) {
        coordenadas = await resolverCoordenadas(datos)
        coordenadasPorDireccion.set(clave, coordenadas)
      }

      const { error } = await supabase.from("appointments").insert({
        profile_id: activo.perfil.id,
        specialty: datos.especialidad,
        doctor_name: datos.medico ?? null,
        // El lote nunca vincula un médico del directorio: la propuesta de la
        // IA no elige uno, y adivinarlo diez veces seguidas es exactamente el
        // tipo de decisión que esta app deja en manos de la persona.
        doctor_id: null,
        appointment_date: datos.fechaHoraIso,
        location_name: datos.lugarNombre ?? null,
        location_address: datos.lugarDireccion ?? null,
        location_city: datos.lugarCiudad ?? null,
        location_province: datos.lugarProvincia ?? null,
        latitude: coordenadas.latitud,
        longitude: coordenadas.longitud,
        preparation_notes: datos.notasPreparacion ?? null,
      })

      if (error) {
        console.error(`[turnos] Fallo al crear el turno ${indice + 1} del lote:`, error)
        resultados.push({ indice, estado: "error", error: ERROR_FILA_INESPERADO })
        continue
      }

      resultados.push({ indice, estado: "creado", error: null })
    }

    const creados = resultados.filter((fila) => fila.estado === "creado").length
    if (creados > 0) {
      revalidatePath("/turnos")
      revalidatePath("/inicio")
    }

    return {
      error: null,
      resultados,
      creados,
      duplicados: resultados.filter((fila) => fila.estado === "duplicado").length,
      fallidos: resultados.filter((fila) => fila.estado === "error").length,
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return loteSoloConError(error.message)
    }
    console.error("[turnos] Fallo inesperado al crear turnos en lote:", error)
    return loteSoloConError(ERROR_INESPERADO_LOTE)
  }
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
    const { latitud, longitud } = await resolverCoordenadas(datos)

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
          location_city: datos.lugarCiudad ?? null,
          location_province: datos.lugarProvincia ?? null,
          latitude: latitud,
          longitude: longitud,
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
