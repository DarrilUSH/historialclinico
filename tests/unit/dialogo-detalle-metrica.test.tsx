// @vitest-environment jsdom

/**
 * Test de render de `components/estudios/dialogo-detalle-metrica.tsx`
 * (pedido en vivo del usuario, 2026-08-19: "si toco en la tarjeta me
 * aparezcan todas las mediciones de esa tarjeta con fecha y valor", y "si
 * solo existe una medición que aclare que es la única medición").
 *
 * Mismo criterio que `tests/unit/gmail-detalle-correo.test.tsx` -mismo
 * primitivo de diálogo (`components/ui/dialog.tsx`, Base UI)-:
 * `@vitest-environment jsdom` en la primera línea, sin
 * `@testing-library/jest-dom` (no está instalado), se afirma con la API del
 * DOM directamente.
 *
 *   npm run test -- dialogo-detalle-metrica
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DialogoDetalleMetrica } from "@/components/estudios/dialogo-detalle-metrica"
import type { SerieMetrica } from "@/lib/laboratorio/series"

afterEach(() => {
  cleanup()
})

const SERIE_PSA: SerieMetrica = {
  clave: "psa",
  etiqueta: "PSA",
  unidad: "ng/mL",
  // Ascendente, como llega de `agruparEnSeries`.
  puntos: [
    {
      fecha: "2025-12-02",
      valor: 3.2,
      unidad: "ng/mL",
      rangoTexto: "0 - 4",
      min: 0,
      max: 4,
      documentoId: "doc-viejo",
      fueraDeRango: false,
    },
    {
      fecha: "2026-06-02",
      valor: 5.1,
      unidad: "ng/mL",
      rangoTexto: "0 - 4",
      min: 0,
      max: 4,
      documentoId: "doc-nuevo",
      fueraDeRango: true,
    },
  ],
}

const SERIE_UNICA: SerieMetrica = {
  clave: "vitamina-d",
  etiqueta: "Vitamina D",
  unidad: "ng/mL",
  puntos: [
    {
      fecha: "2026-06-02",
      valor: 28,
      unidad: "ng/mL",
      rangoTexto: null,
      min: null,
      max: null,
      documentoId: null,
      fueraDeRango: false,
    },
  ],
}

describe("DialogoDetalleMetrica", () => {
  it("el disparador nombra la métrica (WCAG 2.5.3) y el diálogo arranca cerrado", () => {
    render(<DialogoDetalleMetrica serie={SERIE_PSA} periodo="6m" />)

    expect(screen.queryByRole("dialog")).toBeNull()
    const disparador = screen.getByRole("button", { name: /ver todas las mediciones de psa/i })
    expect(disparador).not.toBeNull()
  })

  it("al tocar la tarjeta, la lista muestra TODAS las mediciones, de la más reciente a la más vieja, con fecha y valor", () => {
    render(<DialogoDetalleMetrica serie={SERIE_PSA} periodo="6m" />)

    fireEvent.click(screen.getByRole("button", { name: /ver todas las mediciones de psa/i }))

    const dialogo = screen.getByRole("dialog")
    expect(dialogo.textContent).toContain("PSA")
    expect(dialogo.textContent).toContain("2 de junio de 2026")
    expect(dialogo.textContent).toContain("5.1")
    expect(dialogo.textContent).toContain("2 de diciembre de 2025")
    expect(dialogo.textContent).toContain("3.2")

    // Orden: la más reciente (2026-06-02) antes que la más vieja (2025-12-02).
    const indiceReciente = dialogo.textContent!.indexOf("2 de junio de 2026")
    const indiceVieja = dialogo.textContent!.indexOf("2 de diciembre de 2025")
    expect(indiceReciente).toBeGreaterThanOrEqual(0)
    expect(indiceVieja).toBeGreaterThan(indiceReciente)
  })

  it("marca fuera de rango con ícono + texto (nunca color solo) y en rango también lleva su propio texto", () => {
    render(<DialogoDetalleMetrica serie={SERIE_PSA} periodo="6m" />)
    fireEvent.click(screen.getByRole("button", { name: /ver todas las mediciones de psa/i }))

    const dialogo = screen.getByRole("dialog")
    expect(dialogo.textContent).toContain("Fuera de rango")
    expect(dialogo.textContent).toContain("En rango")
  })

  it("cada fila con documento asociado enlaza al estudio de origen", () => {
    render(<DialogoDetalleMetrica serie={SERIE_PSA} periodo="6m" />)
    fireEvent.click(screen.getByRole("button", { name: /ver todas las mediciones de psa/i }))

    const enlaces = screen.getByRole("dialog").querySelectorAll("a[href]")
    const hrefs = Array.from(enlaces).map((a) => a.getAttribute("href"))
    expect(hrefs).toContain("/estudios/doc-nuevo")
    expect(hrefs).toContain("/estudios/doc-viejo")
  })

  it("única medición: la tarjeta y el diálogo lo dicen con claridad, sin insinuar una tendencia", () => {
    render(<DialogoDetalleMetrica serie={SERIE_UNICA} periodo="6m" />)

    // En la tarjeta (antes de abrir el diálogo).
    expect(screen.getByText(/única medición en este período/i)).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /ver todas las mediciones de vitamina d/i }))
    const dialogo = screen.getByRole("dialog")
    expect(dialogo.textContent).toContain("Única medición en este período")
    // Sin rango de referencia: no debe aparecer ningún badge de rango.
    expect(dialogo.textContent).not.toContain("En rango")
    expect(dialogo.textContent).not.toContain("Fuera de rango")
    // Sin documento asociado: ninguna fila es un link.
    expect(dialogo.querySelectorAll("a[href]")).toHaveLength(0)
  })

  it("única medición con período 'todo': dice 'registrada', no 'en este período' (ya se está viendo todo)", () => {
    render(<DialogoDetalleMetrica serie={SERIE_UNICA} periodo="todo" />)

    expect(screen.getByText(/única medición registrada/i)).not.toBeNull()
    expect(screen.queryByText(/única medición en este período/i)).toBeNull()
  })
})
