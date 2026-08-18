// @vitest-environment jsdom

/**
 * Test de render de los diálogos de detalle de la bandeja de Gmail
 * (`components/gmail/detalle-correo.tsx`), ampliación de alcance en vivo
 * pedida por el usuario en producción (2026-08-18): "Correos que ya
 * revisaste" mostraba asunto y remitente RECORTADOS por la densidad chica
 * (`truncate`) y no había forma de ver el resto. Cada ítem de la bandeja
 * -pendiente o ya revisado- ahora es tocable y abre esta información
 * completa.
 *
 * Mismo criterio que `tests/unit/base/velo-espera.test.tsx` -primer par de
 * tests de render de este archivo-: `@vitest-environment jsdom` en la
 * primera línea, sin `@testing-library/jest-dom` (no está instalado), se
 * afirma con la API del DOM directamente.
 *
 *   npm run test
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DialogoDetallePendiente,
  DialogoDetalleProcesado,
} from "@/components/gmail/detalle-correo"
import type { CorreoParaBandeja, CorreoProcesadoParaBandeja } from "@/components/gmail/bandeja-gmail"

afterEach(() => {
  cleanup()
})

const ASUNTO_LARGO =
  "Resultado de tu análisis de sangre completo del Laboratorio Central de Ushuaia, listo para retirar"

const CORREO_PROCESADO: CorreoProcesadoParaBandeja = {
  id: "correo-1",
  asunto: ASUNTO_LARGO,
  remitente: "Laboratorio Central",
  remitenteEmail: "resultados@laboratorio-central.com.ar",
  fechaTexto: "18/08/2026 09:15",
  destinoTexto: "se sumó como estudio",
  documentoId: "doc-1",
  appointmentId: null,
  adjuntos: [
    {
      id: "att-1",
      nombre: "resultado-completo-analisis-sangre.pdf",
      tamanoTexto: "1,2 MB",
      apto: true,
      motivoTexto: null,
      posibleDuplicadoTexto: null,
    },
  ],
  pareceTurno: false,
  puedeReabrir: false,
}

describe("DialogoDetalleProcesado", () => {
  it("el disparador muestra el asunto truncado, pero el diálogo lo muestra ENTERO", () => {
    render(<DialogoDetalleProcesado correo={CORREO_PROCESADO} accionReabrir={vi.fn()} />)

    // Antes de abrir: el diálogo todavía no está en el DOM.
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: new RegExp(ASUNTO_LARGO) }))

    const dialogo = screen.getByRole("dialog")
    expect(dialogo.textContent).toContain(ASUNTO_LARGO)
    expect(dialogo.textContent).toContain("resultados@laboratorio-central.com.ar")
    expect(dialogo.textContent).toContain("resultado-completo-analisis-sangre.pdf")
    expect(dialogo.textContent).toContain("se sumó como estudio")
  })

  it("el nombre accesible del disparador lleva el asunto completo (Label in Name, WCAG 2.5.3)", () => {
    render(<DialogoDetalleProcesado correo={CORREO_PROCESADO} accionReabrir={vi.fn()} />)

    const disparador = screen.getByRole("button")
    expect(disparador.getAttribute("aria-label")).toContain(ASUNTO_LARGO)
  })

  it("con documentoId, ofrece el link al estudio", () => {
    render(<DialogoDetalleProcesado correo={CORREO_PROCESADO} accionReabrir={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ASUNTO_LARGO) }))

    // `Boton` con `render={<a .../>}` pone `role="button"` en el `<a>` -mismo
    // patrón que "Ver ese estudio" en `pantalla-carga.tsx"-, así que se
    // busca por rol "button", no "link"; el `href` real sigue siendo el del
    // `<a>` subyacente.
    const enlace = screen.getByRole("button", { name: /ver el estudio/i })
    expect(enlace.tagName).toBe("A")
    expect(enlace.getAttribute("href")).toBe("/estudios/doc-1")
  })

  it("con appointmentId, ofrece el link al turno", () => {
    const correoConTurno: CorreoProcesadoParaBandeja = {
      ...CORREO_PROCESADO,
      documentoId: null,
      appointmentId: "turno-1",
      destinoTexto: "se cargó como turno",
    }
    render(<DialogoDetalleProcesado correo={correoConTurno} accionReabrir={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ASUNTO_LARGO) }))

    const enlace = screen.getByRole("button", { name: /ver el turno/i })
    expect(enlace.tagName).toBe("A")
    expect(enlace.getAttribute("href")).toBe("/turnos/turno-1/editar")
  })

  it("sin documento ni turno (se descartó), no ofrece ningún link, pero si puede reabrirse sí muestra el botón", () => {
    const correoDescartado: CorreoProcesadoParaBandeja = {
      ...CORREO_PROCESADO,
      documentoId: null,
      appointmentId: null,
      destinoTexto: "lo trajiste, pero después se descartó",
      puedeReabrir: true,
    }
    render(<DialogoDetalleProcesado correo={correoDescartado} accionReabrir={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: new RegExp(ASUNTO_LARGO) }))

    expect(screen.getByRole("dialog").querySelector("a[href]")).toBeNull()
    expect(screen.getByRole("button", { name: /volver a la lista/i })).not.toBeNull()
  })
})

const CORREO_PENDIENTE: CorreoParaBandeja = {
  // Sprint 17: la carga automática está apagada en este fixture, así que nadie
  // evaluó nada y no hay motivo que explicar.
  motivoRevision: null,
  id: "correo-2",
  asunto: ASUNTO_LARGO,
  remitente: "Laboratorio Central",
  remitenteEmail: "resultados@laboratorio-central.com.ar",
  fechaTexto: "18/08/2026 09:15",
  adjuntos: [
    {
      id: "att-1",
      nombre: "resultado.pdf",
      tamanoTexto: "1,2 MB",
      apto: true,
      motivoTexto: null,
      posibleDuplicadoTexto: "Posible duplicado del correo de las 09:10.",
    },
  ],
  pareceTurno: false,
  tieneFiltro: false,
}

describe("DialogoDetallePendiente", () => {
  it("muestra el asunto completo, el adjunto y ofrece 'Revisar este estudio' cuando puede cargar", () => {
    render(
      <DialogoDetallePendiente
        correo={CORREO_PENDIENTE}
        puedeCargar
        accionIngerir={vi.fn()}
        accionDescartar={vi.fn()}
        accionAprender={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: new RegExp(ASUNTO_LARGO) }))

    const dialogo = screen.getByRole("dialog")
    expect(dialogo.textContent).toContain(ASUNTO_LARGO)
    expect(dialogo.textContent).toContain("resultado.pdf")
    expect(screen.getByRole("button", { name: /revisar este estudio/i })).not.toBeNull()
    expect(screen.getByRole("button", { name: /no me sirve/i })).not.toBeNull()
  })

  it("sin permiso de carga, no ofrece 'Revisar este estudio' (pero sigue mostrando la info)", () => {
    render(
      <DialogoDetallePendiente
        correo={CORREO_PENDIENTE}
        puedeCargar={false}
        accionIngerir={vi.fn()}
        accionDescartar={vi.fn()}
        accionAprender={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: new RegExp(ASUNTO_LARGO) }))

    expect(screen.queryByRole("button", { name: /revisar este estudio/i })).toBeNull()
    expect(screen.getByRole("dialog").textContent).toContain("resultado.pdf")
  })
})
