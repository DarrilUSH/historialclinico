import { Skeleton } from "@/components/ui/skeleton"

/**
 * Esqueleto de carga para los gráficos de Recharts (Sprint 11, tarea 11.6:
 * `GraficoMetrica` en `/estudios/tendencias`, `GraficoSigno` en
 * `/signos/historial`). Las dos rutas los cargan con
 * `next/dynamic(..., { ssr: false })`: Recharts pesa ~130KB de JS que
 * ninguna de las tres rutas auditadas por Core Web Vitals (`/inicio`,
 * `/estudios`, `/turnos`) necesita, así que se difiere al cliente en vez de
 * ir en el First Load JS de esas dos pantallas.
 *
 * El alto replica -aproximado, no a el píxel- el de los tres bloques que
 * pinta el componente real una vez montado: la caja del gráfico
 * (`ALTURA_GRAFICO`, 260px, definida por separado en `grafico-metrica.tsx` y
 * `grafico-signo.tsx` -mantenerlos en sync si alguno cambia-, más el padding
 * de su contenedor), la `Tarjeta` de detalle del punto seleccionado y la
 * barra colapsada de "Ver como tabla". Sin este esqueleto, el salto entre
 * "nada" y "gráfico completo" correría el resto de la pantalla hacia abajo
 * (CLS) apenas termina de bajar el chunk.
 */
export function EsqueletoGrafico() {
  return (
    <div role="status" className="flex flex-col gap-4" aria-hidden="true">
      <span className="sr-only">Cargando gráfico…</span>
      <Skeleton className="h-[300px] w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  )
}
