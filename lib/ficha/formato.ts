/**
 * Formato de fecha de la ficha de resumen para consulta (Sprint 10, tarea
 * 10.4): la fecha de generación que se imprime en el encabezado de
 * `components/ficha/hoja-consulta.tsx` y que arma `lib/ficha/texto-plano.ts`
 * para "Compartir".
 *
 * Función PURA, sin `server-only`: la llama un Client Component
 * (`app/(app)/(sin-nav)/ficha/pantalla-ficha.tsx`) apenas llega la respuesta
 * de `POST /api/ficha/generar`, así que tiene que poder importarse en el
 * navegador -mismo criterio de "código compartido, sin riesgo" que ya declara
 * `lib/gemini/schemas.ts` para sus tipos-.
 *
 * Mismo patrón de zona horaria que el resto de la app (`lib/perfiles/edad.ts`,
 * `lib/turnos/formato.ts`): todas las fechas "grandes" para leer se muestran
 * en `America/Argentina/Ushuaia`. A diferencia de `edad.ts`, acá no hace falta
 * ningún parseo manual de calendario -`fechaGeneracion` es un instante real
 * (`new Date()` del momento en que el navegador recibió la respuesta), no una
 * columna `date` sin hora-, así que alcanza con pedirle a `Intl` que lo
 * muestre en la zona del proyecto.
 */

const ZONA_HORARIA_FICHA = "America/Argentina/Ushuaia"

/** "14 de agosto de 2026". Mismo patrón que `formatearFechaLargaTurno` (`lib/turnos/formato.ts`). */
const FORMATO_FECHA_GENERACION = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA_FICHA,
  day: "numeric",
  month: "long",
  year: "numeric",
})

export function formatearFechaGeneracionFicha(fecha: Date): string {
  return FORMATO_FECHA_GENERACION.format(fecha)
}
