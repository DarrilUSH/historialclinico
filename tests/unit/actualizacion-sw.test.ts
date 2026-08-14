/**
 * Test de la regla pura del ciclo de actualización del service worker
 * (`lib/pwa/registrar-sw.ts`, Sprint 11 tarea 11.3). Sin DOM:
 * `environment: "node"` en `vitest.config.ts`.
 *
 *   npm run test -- actualizacion-sw
 *
 * ## Qué se prueba acá y qué se prueba en el teléfono
 *
 * `vigilarActualizacion` y `aplicarActualizacion` son cableado sobre APIs del
 * navegador (`registration.waiting`, `updatefound`, `statechange`,
 * `controllerchange`, `postMessage`). Falsearlas probaría que el falso
 * funciona — el mismo criterio con el que `sw-offline.test.ts` deja las
 * estrategias con efectos fuera de unit.
 *
 * Lo que sí se puede aislar, y es donde está el error caro, es la DECISIÓN:
 * cuándo corresponde avisar. Equivocarse ahí no rompe nada visible en
 * desarrollo —donde siempre hay un worker previo— y en cambio le muestra a
 * cualquiera que abre la app por primera vez un aviso de "hay una versión
 * nueva" seguido de una recarga sorpresa. Por eso vive en una función pura.
 *
 * El resto del ciclo se verifica en el dispositivo real:
 * `docs/capturas/dispositivo-real/README.md`, sección del Sprint 11.3.
 */

import { describe, expect, it } from "vitest"

import { debeAvisarActualizacion } from "@/lib/pwa/registrar-sw"

describe("lib/pwa/registrar-sw.ts — debeAvisarActualizacion", () => {
  it("avisa cuando hay un worker en espera y esta pestaña ya estaba controlada", () => {
    expect(debeAvisarActualizacion({ hayEnEspera: true, hayControlador: true })).toBe(true)
  })

  it("NO avisa en la primera instalación, aunque el worker llegue a `installed`", () => {
    // Sin controlador previo no hay "versión nueva": el worker se activa solo,
    // sin desplazar a nadie. Avisar acá sería pedirle a alguien que actualice
    // una app que acaba de abrir por primera vez, y la recarga posterior sería
    // una recarga sorpresa en la primera visita.
    expect(debeAvisarActualizacion({ hayEnEspera: true, hayControlador: false })).toBe(false)
  })

  it("NO avisa sin nadie en espera: el botón no tendría a quién mandarle el mensaje", () => {
    expect(debeAvisarActualizacion({ hayEnEspera: false, hayControlador: true })).toBe(false)
  })

  it("NO avisa en el caso corriente: app al día, sin worker esperando", () => {
    expect(debeAvisarActualizacion({ hayEnEspera: false, hayControlador: false })).toBe(false)
  })
})
