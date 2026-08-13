import { describe, it, expect } from "vitest"
import { linkComoLlegar, linksPedirViaje, linkGoogleCalendar } from "@/lib/logistica/deep-links"

describe("linkComoLlegar", () => {
  it("genera URL de Google Maps con lat/lng", () => {
    const url = linkComoLlegar({
      latitude: -54.8083,
      longitude: -68.3,
    })
    expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=-54.8083%2C-68.3")
  })

  it("genera URL de Google Maps con dirección sin coords", () => {
    const url = linkComoLlegar({
      direccion: "Gob. Paz 150",
    })
    expect(url).toContain("https://www.google.com/maps/dir/?api=1&destination=")
    expect(url).toContain("Gob.%20Paz%20150")
    expect(url).toContain("Ushuaia")
    expect(url).toContain("Tierra%20del%20Fuego")
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

describe("linksPedirViaje", () => {
  it("retorna todos null sin coordenadas", () => {
    const links = linksPedirViaje({})
    expect(links.uber).toBeNull()
    expect(links.didi).toBeNull()
    expect(links.cabify).toBeNull()
  })

  it("genera deep link de Uber con coords y lugar", () => {
    const links = linksPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
      nombreLugar: "Clínica Ushuaia",
    })
    expect(links.uber).toContain("https://m.uber.com/ul/")
    expect(links.uber).toContain("dropoff[latitude]=-54.8083")
    expect(links.uber).toContain("dropoff[longitude]=-68.3")
    expect(links.uber).toContain("Cl%C3%ADnica%20Ushuaia") // Codificación de "ínica"
  })

  it("genera deep link de DiDi con coords", () => {
    const links = linksPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
      nombreLugar: "Consultorio Torres",
    })
    expect(links.didi).toContain("didisdk://web/dispatch")
    expect(links.didi).toContain("targetLat=-54.8083")
    expect(links.didi).toContain("targetLng=-68.3")
    expect(links.didi).toContain("Consultorio%20Torres")
  })

  it("genera deep link de Cabify con coords", () => {
    const links = linksPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
      nombreLugar: "Centro de Salud",
    })
    expect(links.cabify).toContain("cabify://book")
    expect(links.cabify).toContain("destinationLat=-54.8083")
    expect(links.cabify).toContain("destinationLng=-68.3")
    expect(links.cabify).toContain("Centro%20de%20Salud")
  })

  it("usa coordenadas como fallback si no hay nombreLugar", () => {
    const links = linksPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
    })
    expect(links.uber).toContain("-54.8083,-68.3")
    expect(links.didi).toContain("-54.8083,-68.3")
    expect(links.cabify).toContain("-54.8083,-68.3")
  })

  it("codifica caracteres especiales en nombreLugar (ñ, tildes)", () => {
    const links = linksPedirViaje({
      latitude: -54.8083,
      longitude: -68.3,
      nombreLugar: "Consultorio García Peña",
    })
    // García → Garc%C3%ADa, Peña → Pe%C3%B1a
    expect(links.uber).toContain("%C3%AD") // í
    expect(links.uber).toContain("%C3%B1") // ñ
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
