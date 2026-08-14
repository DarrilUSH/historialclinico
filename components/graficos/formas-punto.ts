/**
 * Geometría SVG de las dos formas que este proyecto usa para marcar un punto
 * "fuera de lo esperado" en un gráfico de línea -triángulo hacia arriba,
 * rombo hacia abajo-, sin depender NUNCA solo del color (criterio de
 * accesibilidad de `docs/design-system.md`).
 *
 * Extraído de `components/estudios/grafico-metrica.tsx` (Sprint 5, tarea 5.4)
 * a este módulo compartido para que `components/signos/grafico-signo.tsx`
 * (Sprint 9, tarea 9.4) lo reuse sin duplicar la matemática: son las dos
 * únicas piezas de ese componente sin ningún acoplamiento a `PuntoSerie` de
 * laboratorio -reciben centro y radio, nada más-, así que la extracción no
 * cambia un solo píxel de `/estudios/tendencias` (mismo código, otro
 * archivo). Lo que sí sigue siendo propio de cada gráfico es CUÁNDO usar cada
 * forma -en laboratorio depende de `valor` contra `min`/`max`; en signos
 * vitales depende de qué regla clínica violó la medición-, así que esa
 * decisión se queda en cada componente y no se generalizó acá.
 */

/** Triángulo apuntando hacia arriba, centrado en `(cx, cy)` con "radio" `r`. */
export function puntosTriangulo(cx: number, cy: number, r: number): string {
  const alto = r * 1.7
  return `${cx},${cy - alto * 0.62} ${cx - r},${cy + alto * 0.38} ${cx + r},${cy + alto * 0.38}`
}

/** Rombo centrado en `(cx, cy)` con "radio" `r`. */
export function puntosRombo(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}
