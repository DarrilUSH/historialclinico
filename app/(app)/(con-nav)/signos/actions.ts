"use server"

/**
 * Server Action de `/signos` (Sprint 9, tarea 9.1 — ROADMAP_SPRINTS.md).
 *
 * Una sola acción, `registrarSigno`, para los tres tipos: `tipo` (español,
 * `lib/signos/tipos.ts`) decide qué campos exige `validarSigno`
 * (`lib/validacion/signo.schema.ts`) y qué columnas de `vital_signs` recibe
 * el `INSERT`. Igual que `medicacion/actions.ts#crearMedicacion` y
 * `turnos/actions.ts#crearTurno`, opera SIEMPRE sobre el PERFIL ACTIVO
 * (`obtenerPerfilActivo()`), nunca sobre un `perfilId` que mande el cliente.
 *
 * Después del `INSERT` exitoso corre el motor de umbrales clínicos de la
 * tarea 9.2 (`lib/signos/registrar-alertas.ts`), que evalúa la medición contra
 * `vital_sign_thresholds` y deja una fila de `vital_sign_alerts` por cada regla
 * violada. Es **best-effort**: la carga nunca falla porque la evaluación falle.
 *
 * Si esa evaluación creó alguna alerta, se notifica de inmediato
 * (`lib/signos/notificar.ts`, Sprint 9.3): sin esperar a ningún cron, dentro
 * de esta misma cadena síncrona, que es lo que garantiza el "menos de 30
 * segundos" del criterio de aceptación del ROADMAP. También best-effort: un
 * push que falla no deshace la medición ni la alerta ya guardadas, y el
 * banner persistente de `/signos` sigue siendo la red de contención.
 *
 * También vive acá `marcarAlertaVista` (Sprint 9.3): el `UPDATE` de UNA
 * columna (`acknowledged_at`) que cierra el banner. La política y el trigger
 * de sellado ya existen (`docs/modelo-signos.md` §3.3); esta acción es la
 * puerta de entrada desde la interfaz.
 *
 * Exige `upload` (`vital_signs_insert_puede_cargar`,
 * `docs/modelo-permisos.md` §6.1 y §4.2: "cargar un dato del día") para
 * `registrarSigno`. `marcarAlertaVista` exige `manage`
 * (`vital_sign_alerts_update_visto_administrador` = titular o `can_manage`,
 * el mismo conjunto que recibe el push). No hay `actualizarSigno`/
 * `suspenderSigno` en esta tarea -a diferencia de medicación, una medición no
 * se edita ni se suspende, corregirla es tarea de `can_manage` en un sprint
 * futuro si el producto lo pide-.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { notificarAlertasDeSigno } from "@/lib/signos/notificar"
import { registrarAlertasDeSigno } from "@/lib/signos/registrar-alertas"
import { esSignoTipo, TIPO_A_DB } from "@/lib/signos/tipos"
import { validarSigno } from "@/lib/validacion/signo.schema"

export interface EstadoSignoAccion {
  error: string | null
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando la medición."

const ERROR_TIPO_INVALIDO =
  "No pudimos identificar qué signo vital estás cargando. Volvé a intentarlo desde el inicio."

const ERROR_INESPERADO =
  "Ocurrió un problema y no pudimos guardar la medición. Probá de nuevo en unos minutos."

const SIN_ALERTA_ID = "No pudimos identificar la alerta. Volvé a intentarlo desde la lista."

const ERROR_ALERTA_NO_ENCONTRADA =
  "No encontramos esa alerta, o ya no tenés permiso para administrarla."

const ERROR_INESPERADO_ALERTA =
  "Ocurrió un problema y no pudimos marcar la alerta como vista. Probá de nuevo en unos minutos."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` (mismo criterio que `medicacion/actions.ts#campo`). */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

/**
 * Alta de una medición. `FormData` trae los campos de
 * `components/signos/formulario-signo.tsx` -incluido el `tipo`, que viaja
 * como hidden fijado por la página según `?tipo=` (nunca un `<select>`,
 * criterio Senior UX del roadmap)-; el perfil sale de la cookie activa.
 */
export async function registrarSigno(
  _estadoPrevio: EstadoSignoAccion,
  formData: FormData,
): Promise<EstadoSignoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const tipoCrudo = campo(formData, "tipo")
    if (!esSignoTipo(tipoCrudo)) {
      return { error: ERROR_TIPO_INVALIDO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarSigno({
      tipo: tipoCrudo,
      sistolica: campo(formData, "sistolica"),
      diastolica: campo(formData, "diastolica"),
      pulso: campo(formData, "pulso"),
      valor: campo(formData, "valor"),
      fecha: campo(formData, "fecha"),
      hora: campo(formData, "hora"),
    })
    if (!validacion.ok) {
      return { error: validacion.error }
    }

    const { datos } = validacion

    // `.select("id")` no es cosmético: es lo que el motor de umbrales (9.2)
    // necesita para releer la fila persistida y evaluarla. La política
    // `vital_signs_select_puede_ver` es monótona, así que quien acaba de
    // cargar con `can_upload` siempre puede leer lo que cargó.
    const { data: guardado, error } = await supabase
      .from("vital_signs")
      .insert({
        profile_id: activo.perfil.id,
        type: TIPO_A_DB[datos.tipo],
        systolic: datos.systolic ?? null,
        diastolic: datos.diastolic ?? null,
        pulse: datos.pulse ?? null,
        value: datos.value ?? null,
        measured_at: datos.measuredAtIso,
      })
      .select("id")
      .single()

    if (error || !guardado) {
      console.error(`[signos] Fallo al registrar una medición de ${datos.tipo}:`, error)
      return { error: ERROR_INESPERADO }
    }

    // Umbrales clínicos (tarea 9.2). BEST-EFFORT, como
    // `generarTomasDelDiaComoServicio()` en `crearMedicacion`: la medición ya
    // está guardada y **la carga nunca falla porque la evaluación falle**. Si
    // esto revienta, queda el log y el dato; devolverle un error a quien acaba
    // de cargar bien haría que reintente y termine sin la medición.
    try {
      const alertasCreadas = await registrarAlertasDeSigno(guardado.id)

      // Notificación inmediata (tarea 9.3): SIN esperar a ningún cron, en la
      // misma cadena síncrona — es lo que garantiza el "menos de 30 segundos"
      // del ROADMAP. Try/catch propio: un push que falla no puede deshacer ni
      // la medición ni las alertas, que ya quedaron guardadas arriba.
      if (alertasCreadas.length > 0) {
        try {
          await notificarAlertasDeSigno({
            profileId: activo.perfil.id,
            nombrePerfil: activo.perfil.full_name,
            vitalSignId: guardado.id,
            alertas: alertasCreadas,
          })
        } catch (errorNotificacion) {
          console.error(
            `[signos] Las alertas de ${datos.tipo} se guardaron pero no se pudo notificar al administrador:`,
            errorNotificacion,
          )
        }
      }
    } catch (errorAlertas) {
      console.error(
        `[signos] La medición de ${datos.tipo} se guardó pero no se pudieron evaluar los umbrales:`,
        errorAlertas,
      )
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[signos] Fallo inesperado al registrar una medición:", error)
    return { error: ERROR_INESPERADO }
  }

  revalidatePath("/signos")
  revalidatePath("/inicio")
  redirect("/signos?cargado=1")
}

/**
 * Marca UNA alerta como vista (Sprint 9, tarea 9.3). Es el único `UPDATE` que
 * el cliente puede hacer sobre `vital_sign_alerts`: el privilegio de columna
 * de la migración 20260814080000 §3.3 solo concede `UPDATE (acknowledged_at)`
 * a `authenticated` -tocar `mensaje`, `umbral` o `acknowledged_by` a mano
 * devuelve `42501` aunque la política de fila lo autorice-, y el trigger
 * `vital_sign_alerts_sellar_visto` reemplaza lo que se mande por `now()` y
 * sella el autor con `perfil_actor()`: **el cliente solo pone el timestamp,
 * el trigger firma** (contrato de `docs/modelo-signos.md` §9).
 *
 * Exige `manage` (`vital_sign_alerts_update_visto_administrador` = titular o
 * `can_manage`): son exactamente los mismos que reciben el push
 * (`destinatarios_de_avisos`), la misma regla que ya aplica la política de
 * `SELECT` sobre esta tabla. No hay redirect: a diferencia de `registrarSigno`,
 * esta acción no navega a ningún lado -el banner que la dispara puede estar en
 * `/signos` o en `/inicio`
 * (`components/signos/banner-alerta.tsx`), y redirigir siempre a una de las
 * dos rompería la otra-. Revalidar las dos rutas alcanza para que la lista de
 * alertas sin ver se actualice en cualquiera de las dos donde el banner viva.
 *
 * Idempotente por diseño de la base, no de esta acción: un segundo `UPDATE`
 * sobre una alerta ya vista no falla -el trigger conserva
 * `acknowledged_at`/`acknowledged_by` viejos en silencio-, así que un doble
 * click no puede "robarle" el sellado a quien la vio primero.
 */
export async function marcarAlertaVista(
  _estadoPrevio: EstadoSignoAccion,
  formData: FormData,
): Promise<EstadoSignoAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const alertaId = campo(formData, "alertaId")
    if (!PATRON_UUID.test(alertaId)) {
      return { error: SIN_ALERTA_ID }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const { error, count } = await supabase
      .from("vital_sign_alerts")
      .update({ acknowledged_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", alertaId)
      .eq("profile_id", activo.perfil.id)

    if (error) {
      console.error(`[signos] Fallo al marcar vista la alerta ${alertaId}:`, error)
      return { error: ERROR_INESPERADO_ALERTA }
    }
    // RLS devuelve cero filas (no un error) cuando el permiso se perdió entre
    // que se pintó el banner y se apretó el botón, o cuando el id no existe o
    // es de otro perfil — mismo criterio que `perfil/sos/actions.ts`.
    if (!count) {
      return { error: ERROR_ALERTA_NO_ENCONTRADA }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[signos] Fallo inesperado al marcar una alerta como vista:", error)
    return { error: ERROR_INESPERADO_ALERTA }
  }

  revalidatePath("/signos")
  revalidatePath("/inicio")
  return { error: null }
}
