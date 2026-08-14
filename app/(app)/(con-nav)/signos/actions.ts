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
 * Exige `upload` (`vital_signs_insert_puede_cargar`,
 * `docs/modelo-permisos.md` §6.1 y §4.2: "cargar un dato del día"). No hay
 * `actualizarSigno`/`suspenderSigno` en esta tarea -a diferencia de
 * medicación, una medición no se edita ni se suspende, corregirla es tarea
 * de `can_manage` en un sprint futuro si el producto lo pide-.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { registrarAlertasDeSigno } from "@/lib/signos/registrar-alertas"
import { esSignoTipo, TIPO_A_DB } from "@/lib/signos/tipos"
import { validarSigno } from "@/lib/validacion/signo.schema"

export interface EstadoSignoAccion {
  error: string | null
}

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando la medición."

const ERROR_TIPO_INVALIDO =
  "No pudimos identificar qué signo vital estás cargando. Volvé a intentarlo desde el inicio."

const ERROR_INESPERADO =
  "Ocurrió un problema y no pudimos guardar la medición. Probá de nuevo en unos minutos."

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
      await registrarAlertasDeSigno(guardado.id)
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
