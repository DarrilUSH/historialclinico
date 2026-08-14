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
 * 2. **Estática de verdad.** No usa `cookies()`, `headers()` ni `searchParams`,
 *    así que Next la prerrenderiza en el build y el worker la puede bajar con
 *    un `fetch` sin sesión durante la instalación.
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
 * Ofrece la ficha SOS porque es lo único que de verdad está guardado en el
 * teléfono. **No ofrece "reintentar" como botón**: un botón que recarga sin
 * red vuelve a esta misma pantalla y se lee como que la app está rota. El
 * texto explica qué hacer (recuperar señal) y qué sí funciona mientras tanto.
 */

import type { Metadata } from "next"

import { HeartPulseIcon, WifiOffIcon } from "lucide-react"

export const metadata: Metadata = {
  title: "Sin conexión — Historial Médico",
}

export default function PaginaOffline() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-background px-6 py-10 text-center">
      <WifiOffIcon
        className="size-16 text-muted-foreground"
        aria-hidden="true"
        strokeWidth={1.5}
      />

      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-balance text-foreground">
          Estás sin conexión
        </h1>
        <p className="text-lg text-pretty text-muted-foreground">
          Esta pantalla necesita internet para mostrarte información
          actualizada. Volvé a intentarlo cuando tengas señal o wifi.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left">
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
      </div>
    </main>
  )
}
