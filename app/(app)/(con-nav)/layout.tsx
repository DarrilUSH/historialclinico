/**
 * Shell de toda la sección autenticada CON perfil activo: header mínimo
 * (`EncabezadoPerfil`) + contenido + bottom nav fija de 4 accesos
 * (`BottomNav`). Envuelve `/inicio`, `/estudios`, `/turnos`, `/familia` (y
 * sus subrutas, como `/familia/accesos`).
 *
 * ## Por qué NO es literalmente `app/(app)/layout.tsx`
 *
 * `/perfiles` (el selector "estilo Netflix", Sprint 2) vive bajo `app/(app)/`
 * pero TODAVÍA no hay perfil activo elegido en ese punto -es la pantalla que
 * lo elige-. Una bottom nav ahí sería, en el mejor caso, prematura (4 accesos
 * a datos de un perfil que nadie fijó todavía) y en el peor, un salto directo
 * de vuelta al layout que reclama uno.
 *
 * La solución de menor superficie es un route group hermano: este shell vive
 * en `app/(app)/(con-nav)/` y el selector se movió a
 * `app/(app)/(sin-nav)/perfiles/`. Los paréntesis no agregan segmento de URL
 * (convención de Next.js), así que `/inicio`, `/estudios`, `/turnos`,
 * `/familia` y `/perfiles` conservan exactamente las mismas rutas que antes
 * del Sprint 3 -ver `tests/unit/rutas.test.ts`, que verifica la matriz de
 * rutas por pathname y no le importa dónde vive el archivo-.
 *
 * ## Perfil inválido nunca ve el shell con datos (garantía de revalidación)
 *
 * `obtenerPerfilActivo()` (`lib/perfil-activo.ts`) revalida el permiso contra
 * la base en cada llamada; acá se usa para decidir si este layout se
 * construye o si se redirige a `/perfiles`. La duda obvia es si un layout de
 * Next.js vuelve a ejecutar esa revalidación en CADA navegación client-side
 * (por ejemplo, al tocar "Estudios" en la bottom nav sin recargar la
 * página) o si un layout "compartido" queda cacheado y deja de revisar.
 *
 * Acá no hay ambigüedad porque `obtenerPerfilActivo` llama a `cookies()`
 * (a través de `requerirPermiso` → `lib/auth/guardas.ts`): eso marca este
 * segmento de ruta como **dinámico**, lo saca de cualquier optimización
 * estática, y en Next.js 15+ (vigente en 16.3) el Client Router Cache usa
 * `staleTimes.dynamic = 0` por defecto para segmentos dinámicos -es decir,
 * CERO cache: cada navegación, incluida la que solo cambia de pestaña dentro
 * de esta misma bottom nav, vuelve a pedir el RSC payload al servidor y
 * vuelve a ejecutar este layout entero desde cero. Un perfil revocado entre
 * medio se detecta en la navegación siguiente, no "eventualmente".
 *
 * Como estas páginas (`/inicio`, `/familia`, ahora `/estudios` y `/turnos`)
 * TAMBIÉN llaman a `obtenerPerfilActivo()` por su cuenta -la necesitan para
 * su propio contenido, y no hay forma de pasar props de un layout a su
 * página en App Router-, la función está envuelta en `cache()` de React
 * (ver el comentario en `lib/perfil-activo.ts`): layout y página comparten un
 * único resultado memoizado por request, así que esto no duplica la consulta
 * a la base ni corre el riesgo de que las dos vean perfiles distintos.
 */

import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { IndicadorConexion } from "@/components/base/indicador-conexion"
import { BottomNav } from "@/components/navegacion/bottom-nav"
import { EncabezadoPerfil } from "@/components/navegacion/encabezado-perfil"
import { RegistroServiceWorker } from "@/components/pwa/registro-service-worker"
import { Toaster } from "@/components/ui/sonner"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export default async function LayoutConNav({ children }: { children: ReactNode }) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = activo

  return (
    <div className="flex min-h-pantalla w-full flex-col bg-background">
      {/* Salto al contenido (WCAG 2.4.1 "Evitar bloques", Sprint 11: la
          auditoría de accesibilidad lo encontró ausente en toda la app).
          Invisible hasta que se lo enfoca con Tab, y entonces aparece arriba de
          todo: saltea el encabezado de perfil y la barra de conexión. `sr-only`
          con `focus:not-sr-only` es el patrón estándar -queda siempre en el
          árbol de accesibilidad, nunca `display:none`, que lo sacaría del orden
          de tabulación-.

          Va PRIMERO en el árbol, incluso antes de `RegistroServiceWorker`: un
          salto de contenido que no es la primera parada de teclado no sirve de
          nada. En la auditoría, con el aviso "Hay una versión nueva" en
          pantalla, ese botón se comía la primera Tab y el salto quedaba
          segundo. El aviso es `fixed` sobre la bottom nav, así que moverlo
          abajo en el árbol no cambia dónde se ve. */}
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:min-h-tactil focus:items-center focus:rounded-lg focus:bg-primary focus:px-5 focus:text-base focus:font-semibold focus:text-primary-foreground focus:shadow-elevada focus:ring-3 focus:ring-ring/50 focus:outline-none"
      >
        Saltar al contenido
      </a>

      {/* Registra el service worker y le pide precargar la ficha SOS de ESTE
          perfil (Sprint 8.4). Va acá y no en el layout raíz porque `/login` y
          `/registro` no tienen ninguna ficha que guardar. Ver
          `lib/pwa/registrar-sw.ts` para por qué el registro subió al arranque
          en ese sprint.

          Casi siempre devuelve `null`. Lo único que puede llegar a pintar es la
          barra "Hay una versión nueva" (Sprint 11.3,
          `components/pwa/aviso-actualizacion.tsx`), que se posiciona `fixed`
          sobre la bottom nav: por eso da igual dónde esté en el árbol. */}
      <RegistroServiceWorker perfilId={perfil.id} />

      <EncabezadoPerfil perfil={perfil} esPropio={permisos.esPropio} />

      {/* Indicador global de conexión: barra visible cuando el dispositivo
          está offline (Sprint 8, tarea 8.5). */}
      <IndicadorConexion />

      {/* `pb-[...]` reserva exactamente el alto de la bottom nav fija
          (`--spacing-bottom-nav`, app/globals.css) más su safe-area: sin esto,
          el último elemento de cada pantalla queda tapado por la nav. */}
      {/* `tabIndex={-1}` para que el salto de arriba pueda mover el foco de
          verdad: sin él, el navegador desplaza la página pero el foco de
          teclado se queda en el <a>, y el siguiente Tab vuelve al encabezado.
          -1 lo hace enfocable por script/ancla sin sumarlo al orden de Tab. */}
      <main
        id="contenido-principal"
        tabIndex={-1}
        className="flex flex-1 flex-col pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] focus:outline-none"
      >
        {children}
      </main>

      <BottomNav />

      {/* `top-center`: la bottom nav fija ya ocupa la franja inferior -la
          posición por defecto de sonner ("bottom-right") quedaría tapada por
          ella en mobile-, y arriba es donde alguien mirando la pantalla la ve
          primero. `richColors={false}`: los cuatro estilos ya salen de
          `--normal-*` (tokens del proyecto, ver `components/ui/sonner.tsx`),
          así un toast de éxito se lee como el mismo sistema que `Alerta`, no
          como un verde genérico de librería. */}
      <Toaster position="top-center" duration={5000} />
    </div>
  )
}
