import { describe, it, expect } from "vitest"
import { linkComoLlegar, linkPedirViaje, linkGoogleCalendar } from "@/lib/logistica/deep-links"

describe("linkComoLlegar", () => {
  it("genera URL de Google Maps con lat/lng", () => {
    const url = linkComoLlegar({
      latitude: -54.8083,
      longitude: -68.3,
    })
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=-54.8083%2C-68.3")
  })

  it("genera URL de Google Maps con dirección sin coords, TAL COMO se cargó", () => {
    const url = linkComoLlegar({
      direccion: "Gob. Paz 150",
    })
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=Gob.%20Paz%20150")
  })

  /**
   * Sprint 20 (adenda) — NEUTRALIDAD GEOGRÁFICA.
   *
   * El Sprint 16 sacó la LOCALIDAD asumida pero dejó el PAÍS: agregaba
   * ", Argentina" a toda dirección sin coordenadas. Es el mismo error un nivel
   * más arriba, y rompe la app fuera de Argentina — una dirección de Madrid
   * terminaba buscándose en otro continente. Ahora no se le pega ningún lugar.
   */
  it("REGRESIÓN Sprint 20: no le pega NINGÚN país a la dirección", () => {
    const url = linkComoLlegar({ direccion: "Calle Gran Vía 28, Madrid" })
    expect(url).toContain("Madrid")
    expect(url).not.toContain("Argentina")
  })

  it("REGRESIÓN Sprint 16 (tarea 16.1): una dirección de OTRA provincia ya no queda pegada a Ushuaia", () => {
    // Bug reportado por el usuario con uso real: antes de esta tarea, la
    // rama "sin coords" agregaba ", Ushuaia, Tierra del Fuego" a CUALQUIER
    // dirección, incluida una de La Plata. El llamador (`tarjeta-turno.tsx`,
    // `tarjeta-medico.tsx`) le pasa acá la dirección YA combinada con
    // ciudad/provincia reales vía `lib/ubicacion/formato.ts#direccionCompleta`.
    const url = linkComoLlegar({
      direccion: "Avenida 51 Nº 315, La Plata, Buenos Aires",
    })
    expect(url).toContain("La%20Plata")
    expect(url).toContain("Buenos%20Aires")
    expect(url).not.toContain("Ushuaia")
    expect(url).not.toContain("Tierra")
  })

  it("codifica tildes y ñ en la dirección", () => {
    const url = linkComoLlegar({
      direccion: "Avenida Maipú",
    })
    expect(url).toContain("Avenida")
    // URL encoding de ú: %C3%BA
    expect(url).toContain("%C3%BA")
  })

  it("retorna null sin lat/lng ni dirección", () => {
    const url = linkComoLlegar({})
    expect(url).toBeNull()
  })

  it("retorna null si dirección está vacía", () => {
    const url = linkComoLlegar({
      direccion: "   ",
    })
    expect(url).toBeNull()
  })

  it("prioriza lat/lng sobre dirección", () => {
    const url = linkComoLlegar({
      latitude: -54.8083,
      longitude: -68.3,
      direccion: "Dirección ignorada",
    })
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=-54.8083%2C-68.3")
    expect(url).not.toContain("ignorada")
  })
})

describe("linkPedirViaje", () => {
  it("retorna null sin coordenadas", () => {
    expect(linkPedirViaje({})).toBeNull()
  })

  it("arma el atajo con coords y nombre del lugar", () => {
    const url = linkPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
      nombreLugar: "Clínica Ushuaia",
    })
    expect(url).toContain("https://m.uber.com/ul/")
    expect(url).toContain("dropoff[latitude]=-54.8083")
    expect(url).toContain("dropoff[longitude]=-68.3")
    expect(url).toContain("Cl%C3%ADnica%20Ushuaia")
  })

  it("usa coordenadas como fallback si no hay nombreLugar", () => {
    expect(linkPedirViaje({ latitude: -54.8083, longitude: -68.3 })).toContain("-54.8083,-68.3")
  })

  it("codifica caracteres especiales en nombreLugar (ñ, tildes)", () => {
    const url = linkPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
      nombreLugar: "Consultorio García Peña",
    })
    expect(url).toContain("%C3%AD") // í
    expect(url).toContain("%C3%B1") // ñ
  })

  /**
   * Sprint 20 (adenda) — NEUTRALIDAD GEOGRÁFICA.
   *
   * El atajo tiene que ser una URL HTTPS común, no un esquema `app://`. Un
   * esquema propio abre la app cuando está instalada y NO HACE NADA cuando no
   * lo está: un botón muerto, que es distinto según el país y el dispositivo de
   * cada persona. Este test es la guarda contra volver a sumar uno.
   */
  it("es una URL https, nunca un esquema propio de una app", () => {
    const url = linkPedirViaje({ latitude: -54.8083, longitude: -68.3 })
    expect(url?.startsWith("https://")).toBe(true)
    expect(url).not.toContain("://web/dispatch")
    expect(url).not.toContain("cabify://")
  })
})

describe("linkGoogleCalendar", () => {
  it("genera URL de Google Calendar con todos los datos", () => {
    const url = linkGoogleCalendar({
      especialidad: "Cardiología",
      nombreMedico: "Carlos",
      apellidoMedico: "Rodríguez",
      fechaHora: "2026-08-15T14:00:00Z",
      direccion: "Gob. Paz 150, Ushuaia",
      notas: "Llevar análisis recientes.",
    })
    expect(url).toContain("https://calendar.google.com/calendar/render")
    expect(url).toContain("action=TEMPLATE")
    expect(url).toContain("Cardiolog%C3%ADa") // ía codificado
    // URLSearchParams usa + para espacios
    expect(url).toContain("Carlos+Rodr%C3%ADguez")
    expect(url).toContain("Paz")
  })

  it("formatea las fechas en ISO 8601 compacto para Google Calendar", () => {
    const url = linkGoogleCalendar({
      especialidad: "Endocrinología",
      nombreMedico: "Marcela",
      apellidoMedico: "Torres",
      fechaHora: "2026-08-20T10:30:00Z",
    })
    // Debe tener formato YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ
    // Inicio: 2026-08-20T10:30:00Z → 20260820T103000Z
    // Fin (1h después): 2026-08-20T11:30:00Z → 20260820T113000Z
    expect(url).toContain("dates=20260820T103000Z%2F20260820T113000Z")
  })

  it("retorna null sin fechaHora", () => {
    const url = linkGoogleCalendar({
      especialidad: "Cardiología",
    })
    expect(url).toBeNull()
  })

  it("construye SUMMARY como 'Turno: {especialidad} — {médico}'", () => {
    const url = linkGoogleCalendar({
      especialidad: "Cardiología",
      nombreMedico: "Carlos",
      apellidoMedico: "Rodríguez",
      fechaHora: "2026-08-15T14:00:00Z",
    })
    // URLSearchParams usa + para espacios: Turno%3A+Cardiolog%C3%ADa
    expect(url).toContain("text=Turno%3A+Cardiolog%C3%ADa")
    expect(url).toContain("Carlos+Rodr%C3%ADguez")
  })

  it("incluye dirección en location y details", () => {
    const url = linkGoogleCalendar({
      especialidad: "Cardiología",
      fechaHora: "2026-08-15T14:00:00Z",
      direccion: "Gob. Paz 150, Ushuaia",
    })
    expect(url).toContain("location=Gob.")
    expect(url).toContain("Ushuaia")
  })

  it("codifica saltos de línea en detalles (preparación + dirección)", () => {
    const url = linkGoogleCalendar({
      especialidad: "Cardiología",
      fechaHora: "2026-08-15T14:00:00Z",
      direccion: "Gob. Paz 150",
      notas: "Ayuno de 8 horas.",
    })
    expect(url).toContain("Preparaci%C3%B3n")
    expect(url).toContain("Ayuno")
    expect(url).toContain("Direcci%C3%B3n")
  })

  it("maneja médico sin apellido", () => {
    const url = linkGoogleCalendar({
      especialidad: "Cardiología",
      nombreMedico: "Marcela",
      fechaHora: "2026-08-15T14:00:00Z",
    })
    expect(url).toContain("Marcela")
    expect(url).toContain("Cardiolog%C3%ADa")
  })
})
