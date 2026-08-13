/**
 * Formateo puro de una toma de `medication_intakes` para
 * `components/medicacion/registro-toma.tsx` (Sprint 7, tarea 7.3 —
 * ROADMAP_SPRINTS.md).
 *
 * Deliberadamente SIN `server-only`: son funciones puras de texto (hora y
 * estado), sin acceso a red ni a `cookies()`, para poder testearlas directo
 * (`tests/unit/formato-toma.test.ts`) sin mockear Supabase — mismo criterio
 * que `lib/documentos/sugerir-titulo.ts`.
 *
 * La hora se ancla a `America/Argentina/Ushuaia`, la misma zona que
 * `lib/turnos/fecha.ts` y que `generar_tomas_del_dia()`
 * (`docs/modelo-medicacion.md` §7.1): un `scheduled_at`/`taken_at` en UTC
 * mostrado con la zona del proceso del servidor rendiría una hora distinta a
 * la que la persona programó.
 */

const ZONA_HORARIA_MEDICACION = "America/Argentina/Ushuaia"

const FORMATO_HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_MEDICACION,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** `HH:mm` de hora de pared de Ushuaia a partir de un instante ISO (`scheduled_at` o `taken_at`). */
export function formatearHoraToma(iso: string): string {
  return FORMATO_HORA.format(new Date(iso))
}

/**
 * Los cuatro valores de `medication_intake_status`
 * (`types/database.types.ts`). `missed` no lo genera nada todavía
 * (`docs/modelo-medicacion.md` §11, límite conocido 1) pero está en el enum
 * de la base, así que esta función lo cubre para no romper ante un dato que
 * hoy no existe pero que la base ya permite.
 */
export type EstadoIntakeToma = "pending" | "taken" | "skipped" | "missed"

/** Texto de estado para la fila de una toma, en castellano y mostrable tal cual. */
export function textoEstadoToma(status: EstadoIntakeToma, takenAt: string | null): string {
  switch (status) {
    case "taken":
      return takenAt ? `Tomada a las ${formatearHoraToma(takenAt)}` : "Tomada"
    case "skipped":
      return "No tomada"
    case "missed":
      return "No registrada"
    default:
      return "Pendiente"
  }
}
