/**
 * `/offline`: la pantalla que el service worker devuelve cuando alguien pide
 * una pantalla que necesita conexión y no hay red (Sprint 8, tarea 8.4).
 * Estrategia completa en `docs/offline.md`.
 *
 * ## Tres condiciones que esta pantalla tiene que cumplir, y de dónde salen
 *
 * 1. **Cero datos de sesión.** El service worker la precarga en `install` y la
 *    guarda en un caché que sobrevive al logout: cualquier dato de una persona
 *    que se filtrara acá quedaría escrito en el disco del teléfono sin nadie
 *    que lo revise. Por eso la ruta es pública (`lib/auth/rutas.ts`), vive
 *    fuera de `app/(app)/` —no pasa por `obtenerPerfilActivo()`— y no consulta
 *    absolutamente nada.
 *
 * 2. **Estática de verdad, hasta el Sprint 13.** Este archivo no usa
 *    `cookies()`, `headers()` ni `searchParams` -ninguna de las tres cambió
 *    acá-, pero desde la tarea 13.1 el layout raíz (`app/layout.tsx`) SÍ lee
 *    la cookie de densidad para resolver `data-tamano`, y eso vuelve dinámico
 *    TODO el árbol, `/offline` incluida (`app/layout.tsx` lo declara "costo
 *    aceptado" con todas las letras). El worker la sigue pudiendo precachear
 *    igual -`fetch` de mismo origen manda las cookies por default, así que
 *    trae el HTML con el modo que tenía el dispositivo en ese momento-, pero
 *    ya no es una página que `next build` deje prerenderizada.
 *
 * 3. **Cero JavaScript.** Los enlaces son `<a>` nativos, no `<Link>`. Un
 *    `<Link>` necesita el router hidratado para navegar, y esta pantalla
 *    aparece exactamente cuando la red —y por lo tanto cualquier chunk que
 *    falte— no está disponible. Un `<a>` dispara una navegación completa, que
 *    es lo que hace falta para que el service worker la intercepte y sirva
 *    `/sos` desde el caché.
 *
 * ## Lo que dice y lo que no promete
 *
 * Ofrece la ficha SOS —destacada, porque es la única que el worker **precarga**
 * sola— y, desde el Sprint 11 (tarea 11.3), enlaces a las otras tres pantallas
 * que quedan guardadas al visitarlas con señal: Coberturas, Turnos y
 * Medicación. La diferencia se dice con todas las letras en el texto ("tal como
 * las viste la última vez que tuviste señal") en vez de esconderse: prometer
 * una lista al día sin conexión sería mentir, y una lista vieja presentada como
 * fresca es peor que no tener ninguna.
 *
 * **No ofrece "reintentar" como botón**: un botón que recarga sin red vuelve a
 * esta misma pantalla y se lee como que la app está rota. El texto explica qué
 * hacer (recuperar señal) y qué sí funciona mientras tanto.
 *
 * ## Modo chica (Sprint 13, tarea 13.6)
 *
 * Esta pantalla no lee `obtenerPerfilActivo()` ni ninguna sesión -es pública
 * a propósito, ver el punto 1 de arriba-, pero SÍ hereda `data-tamano` del
 * layout raíz (`app/layout.tsx`), que resuelve el modo desde la cookie
 * `tamano` sin necesitar sesión (`lib/densidad/servidor.ts`). Un dispositivo
 * que ya eligió letra chica ve esta pantalla compacta también sin conexión,
 * sin que este archivo tenga que saber nada de cuentas ni perfiles. Acá el
 * rediseño es puramente de espaciado -la pantalla ya era simple-, sin
 * reestructurar nada.
 */

import type { Metadata } from "next"

import { CalendarDaysIcon, HeartPulseIcon, PillIcon, WalletIcon, WifiOffIcon } from "lucide-react"

export const metadata: Metadata = {
  title: "Sin conexión — Historial Médico",
}

/**
 * Las tres pantallas que el Sprint 11 (tarea 11.3) sumó al caché, además de
 * `/sos`. **Tiene que decir lo mismo que `RUTAS_PAGINA_OFFLINE` en
 * `public/sw.js`**: ofrecer acá un enlace a una pantalla que el worker no
 * guarda lleva de vuelta a esta misma pantalla, que es la peor forma de
 * responder "no hay conexión".
 *
 * `tests/unit/sw-offline.test.ts` verifica que las dos listas coincidan.
 */
const PANTALLAS_GUARDADAS = [
  { href: "/coberturas", texto: "Coberturas", Icono: WalletIcon },
  { href: "/turnos", texto: "Turnos", Icono: CalendarDaysIcon },
  { href: "/medicacion", texto: "Medicación", Icono: PillIcon },
] as const

export default function PaginaOffline() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-10 text-center chica:gap-4 chica:px-4 chica:py-6">
      <WifiOffIcon
        className="size-16 text-muted-foreground chica:size-12"
        aria-hidden="true"
        strokeWidth={1.5}
      />

      <div className="flex max-w-md flex-col gap-3 chica:gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-foreground">
          Estás sin conexión
        </h1>
        <p className="text-lg text-pretty text-muted-foreground">
          Esta pantalla necesita internet para mostrarte información
          actualizada. Volvé a intentarlo cuando tengas señal o wifi.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left chica:gap-2 chica:p-4">
        <p className="text-base font-semibold text-card-foreground">
          Lo que sí podés ver sin conexión
        </p>
        <p className="text-base text-muted-foreground">
          Tu ficha de emergencia queda guardada en este teléfono: grupo
          sanguíneo, alergias, medicación, contacto de emergencia y la
          credencial de la cobertura.
        </p>
        <a
          href="/sos"
          className="flex min-h-tactil-amplio w-full items-center justify-center gap-3 rounded-xl bg-primary px-5 text-center text-xl leading-tight font-bold text-primary-foreground shadow-elevada transition-[transform,box-shadow] duration-(--duracion-media) ease-salida hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:translate-y-0"
        >
          <HeartPulseIcon className="size-7 shrink-0" aria-hidden="true" />
          Abrir mi ficha SOS
        </a>
        <p className="text-sm text-muted-foreground">
          Los datos que veas ahí son la última copia que se guardó en este
          teléfono. Al pie de la ficha figura cuándo se revisaron por última
          vez.
        </p>

        <p className="mt-2 text-base text-muted-foreground chica:mt-1">
          También quedan guardadas las últimas versiones de estas pantallas, tal
          como las viste la última vez que tuviste señal:
        </p>
        <ul className="flex flex-col gap-2 chica:gap-1.5">
          {PANTALLAS_GUARDADAS.map((pantalla) => (
            <li key={pantalla.href}>
              <a
                href={pantalla.href}
                className="flex min-h-tactil w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-base font-semibold text-foreground transition-colors duration-(--duracion-media) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none chica:gap-2 chica:px-3 chica:py-2"
              >
                <pantalla.Icono className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                {pantalla.texto}
              </a>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Las fotos de las credenciales solo se ven completas en la ficha SOS.
          En Coberturas vas a ver los datos (obra social, plan y número de
          afiliado) sin las miniaturas.
        </p>
      </div>
    </main>
  )
}
