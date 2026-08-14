/**
 * Tests del contexto clínico que viaja a Gemini (`lib/ficha/armado.ts`,
 * Sprint 10, tarea 10.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  El primer `describe` es **el criterio de aceptación del roadmap**: "el
 *  payload generado para el perfil del seed no contiene DNI, dirección,
 *  teléfono ni email (verificable con un test que busca esos campos)".
 *
 *  La técnica: se le pasan al armado las filas **COMPLETAS** de la base -el
 *  `profiles` entero con DNI, teléfono y contacto de emergencia; los
 *  `documents` enteros con nombre del médico, institución, ruta de Storage y
 *  el OCR crudo, que es donde de verdad aparecen el domicilio y el email de un
 *  informe- y se busca cada uno de esos textos en `JSON.stringify` del
 *  resultado. Es una prueba de AUSENCIA, y por eso vale más que comparar
 *  contra un objeto esperado: si mañana alguien agrega un `...spread` de la
 *  fila, ningún `toEqual` lo detecta -habría que acordarse de actualizarlo-
 *  mientras que esta búsqueda falla sola.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El segundo `describe` cubre la otra mitad del criterio ("contiene medicación
 * activa y las 3 últimas métricas por tipo") y el orden de cada sección.
 */

import { describe, expect, it } from "vitest"

import {
  armarContexto,
  MAXIMO_ESTUDIOS,
  MEDICIONES_POR_TIPO,
  VERSION_CONTEXTO_CLINICO,
  type FuentesClinicas,
} from "@/lib/ficha/armado"
import type { FilaLabMetrica } from "@/lib/laboratorio/series"
import type { Tables } from "@/types/database.types"
import type { Documento, Perfil } from "@/types/dominio"

/** Fijo: la edad y `generadoEn` no pueden depender del día en que corran los tests. */
const GENERADO_EN = new Date("2026-08-14T12:00:00.000Z")

const PERFIL_ID = "660e8400-e29b-41d4-a716-446655440003"
const DOCUMENTO_ID = "770e8400-e29b-41d4-a716-446655440001"
const MEDICACION_ID = "880e8400-e29b-41d4-a716-446655440001"

/**
 * Todo lo que **no** puede aparecer en el JSON que sale hacia Gemini. Las
 * claves son los nombres que se imprimen si el test falla, así el mensaje dice
 * QUÉ se filtró y no solo que algo se filtró.
 *
 * Se corresponden uno a uno con la tabla de exclusiones de
 * `docs/minimizacion-datos.md` §4.
 */
const PROHIBIDOS: Record<string, string> = {
  "nombre completo": "Roberto Gómez",
  DNI: "20345678",
  "teléfono del titular": "+54 9 2901 445566",
  email: "roberto@ejemplo.com.ar",
  domicilio: "Gob. Paz 150",
  ciudad: "Ushuaia",
  "contacto de emergencia": "Gabriela Gómez",
  "teléfono del contacto": "+54 9 2901 234567",
  "vínculo del contacto": "Hija",
  "médico tratante": "Dr. Carlos Rodríguez",
  institución: "Centro Cardiovascular",
  "ruta en Storage": "660e8400/2026/analisis.pdf",
  "foto de perfil": "660e8400/avatar.jpg",
  "fecha de nacimiento exacta": "1945-11-03",
  "uuid del perfil": PERFIL_ID,
  "uuid del documento": DOCUMENTO_ID,
  "uuid de la medicación": MEDICACION_ID,
}

/** El OCR crudo de un informe real: ahí adentro está TODO lo identificatorio junto. */
const OCR_CRUDO = [
  "LABORATORIO CENTRAL USHUAIA — Gob. Paz 150, Ushuaia, Tierra del Fuego",
  "Paciente: Roberto Gómez  DNI 20345678  Tel. +54 9 2901 445566",
  "Correo: roberto@ejemplo.com.ar",
  "Solicitó: Dr. Carlos Rodríguez (MN 45678)",
  "Glucemia 145 mg/dL (VR 70-100)",
].join("\n")

/** Fila COMPLETA de `profiles`, con todo lo identificatorio cargado. */
const PERFIL: Perfil = {
  id: PERFIL_ID,
  user_id: null,
  full_name: "Roberto Gómez",
  national_id: "20345678",
  phone: "+54 9 2901 445566",
  date_of_birth: "1945-11-03",
  role: "elder",
  avatar_storage_path: "660e8400/avatar.jpg",
  blood_type: "O+",
  allergies: ["Penicilina", "Ibuprofeno"],
  chronic_conditions: ["Hipertensión arterial", "Diabetes tipo 2"],
  critical_medication: ["Enalapril 10 mg"],
  emergency_contact: "Gabriela Gómez",
  emergency_contact_phone: "+54 9 2901 234567",
  emergency_contact_relationship: "Hija",
  sos_notes: "Marcapasos colocado en 2019. Usa lentes.",
  sos_updated_at: "2026-08-14T09:25:36.003593+00:00",
  created_at: "2026-08-14T09:25:36.003593+00:00",
  updated_at: "2026-08-14T09:25:36.003593+00:00",
  created_by_profile_id: "660e8400-e29b-41d4-a716-446655440001",
}

/** Fila COMPLETA de `documents`, con médico, institución, ruta de Storage y OCR. */
function documentoDe(parcial: Partial<Documento>): Documento {
  return {
    id: DOCUMENTO_ID,
    profile_id: PERFIL_ID,
    title: "Análisis de sangre completo",
    category: "laboratory",
    document_date: "2026-08-01",
    ai_summary: "Glucemia elevada (145 mg/dL). Hemoglobina normal.",
    ai_confidence: 0.92,
    confirmed_at: "2026-08-02T10:00:00.000Z",
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T10:00:00.000Z",
    created_by_profile_id: "660e8400-e29b-41d4-a716-446655440001",
    doctor_id: "990e8400-e29b-41d4-a716-446655440001",
    doctor_name: "Dr. Carlos Rodríguez",
    institution: "Centro Cardiovascular Ushuaia",
    specialty: "Hematología",
    file_size_bytes: 184320,
    mime_type: "application/pdf",
    raw_ocr_text: OCR_CRUDO,
    storage_path: "660e8400/2026/analisis.pdf",
    ...parcial,
  }
}

/** Seis documentos: uno más que `MAXIMO_ESTUDIOS`, y en desorden a propósito. */
const DOCUMENTOS: Documento[] = [
  documentoDe({ id: DOCUMENTO_ID, document_date: "2026-08-01" }),
  documentoDe({
    document_date: "2026-08-05",
    category: "consultation",
    title: "Consulta — Control de diabetes y presión",
    ai_summary: null,
    specialty: "Medicina General",
  }),
  documentoDe({ document_date: "2026-06-15", category: "imaging", title: "Electrocardiograma" }),
  documentoDe({ document_date: "2026-07-20", category: "prescription", title: "Receta — Metformina 850 mg" }),
  documentoDe({ document_date: "2026-05-10", category: "other", title: "Informe administrativo" }),
  documentoDe({ document_date: "2025-11-02", category: "laboratory", title: "Análisis viejo (sexto, no entra)" }),
]

/** Fila COMPLETA de `v_medicacion_estado`. */
function medicacionDe(parcial: Partial<Tables<"v_medicacion_estado">>): Tables<"v_medicacion_estado"> {
  return {
    medication_id: MEDICACION_ID,
    profile_id: PERFIL_ID,
    name: "Glucophage",
    active_ingredient: "Metformina",
    presentation: "Comprimidos 850 mg",
    dose_amount: 1,
    dose_unit: "comprimido",
    frequency: "daily",
    schedule_times: ["08:00:00", "20:00:00"],
    interval_hours: null,
    start_date: "2026-06-01",
    end_date: null,
    stock_units: 120,
    prescription_document_id: DOCUMENTO_ID,
    notes: "Tomar con las comidas.",
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-06-01T10:00:00.000Z",
    tomas_por_dia: 2,
    dosis_diaria_total: 2,
    dias_restantes: 60,
    fecha_estimada_fin: "2026-10-13",
    necesita_renovacion: false,
    vigente_hoy: true,
    ...parcial,
  }
}

const MEDICACIONES: Tables<"v_medicacion_estado">[] = [
  medicacionDe({}),
  medicacionDe({
    name: "Enalapril",
    active_ingredient: "Enalapril",
    presentation: "Comprimidos 10 mg",
    frequency: "interval_hours",
    schedule_times: null,
    interval_hours: 24,
    start_date: "2026-04-15",
    dias_restantes: 3,
    necesita_renovacion: true,
    notes: "Tomar por la mañana.",
  }),
  // Curso terminado: `vigente_hoy = false` no es "medicación actual".
  medicacionDe({
    name: "Amoxicilina",
    active_ingredient: "Amoxicilina",
    start_date: "2026-03-01",
    end_date: "2026-03-10",
    vigente_hoy: false,
  }),
]

/** Cuatro mediciones de cada métrica: una más que `MEDICIONES_POR_TIPO`. */
function metricaDe(
  nombre: string,
  canonico: string,
  fecha: string,
  valor: number,
  rango: { texto: string; min: number | null; max: number | null },
): FilaLabMetrica {
  return {
    metric_name: nombre,
    metric_canonical: canonico,
    value: valor,
    unit: nombre === "Hemoglobina" ? "g/dL" : "mg/dL",
    reference_range: rango.texto,
    reference_min: rango.min,
    reference_max: rango.max,
    measurement_date: fecha,
    document_id: DOCUMENTO_ID,
  }
}

const RANGO_GLUCEMIA = { texto: "70-100", min: 70, max: 100 }
const RANGO_HEMOGLOBINA = { texto: "13.5-17.5", min: 13.5, max: 17.5 }

/** Deliberadamente desordenadas: el orden lo tiene que imponer el armado. */
const METRICAS: FilaLabMetrica[] = [
  metricaDe("Glucemia", "glucosa", "2026-07-11", 135, RANGO_GLUCEMIA),
  metricaDe("Hemoglobina", "hemoglobina", "2026-08-01", 13.6, RANGO_HEMOGLOBINA),
  metricaDe("Glucemia", "glucosa", "2026-08-01", 145, RANGO_GLUCEMIA),
  metricaDe("Hemoglobina", "hemoglobina", "2026-06-28", 14.1, RANGO_HEMOGLOBINA),
  metricaDe("Glucemia", "glucosa", "2026-06-28", 148, RANGO_GLUCEMIA),
  metricaDe("Hemoglobina", "hemoglobina", "2026-07-25", 13.9, RANGO_HEMOGLOBINA),
  metricaDe("Glucemia", "glucosa", "2026-07-25", 138, RANGO_GLUCEMIA),
  metricaDe("Hemoglobina", "hemoglobina", "2026-07-11", 13.8, RANGO_HEMOGLOBINA),
]

/** Fila COMPLETA de `vital_signs`. */
function signoDe(parcial: Partial<Tables<"vital_signs">>): Tables<"vital_signs"> {
  return {
    id: "aa0e8400-e29b-41d4-a716-446655440001",
    profile_id: PERFIL_ID,
    created_by_profile_id: "660e8400-e29b-41d4-a716-446655440001",
    type: "blood_pressure",
    systolic: null,
    diastolic: null,
    pulse: null,
    value: null,
    unit: null,
    notes: null,
    measured_at: "2026-08-14T07:25:00.000Z",
    created_at: "2026-08-14T07:25:00.000Z",
    updated_at: "2026-08-14T07:25:00.000Z",
    ...parcial,
  }
}

/** Cuatro tensiones (una más que el corte), dos glucemias y un peso. */
const SIGNOS: Tables<"vital_signs">[] = [
  signoDe({ systolic: 139, diastolic: 81, pulse: 75, measured_at: "2026-08-14T07:25:00.000Z" }),
  signoDe({ systolic: 140, diastolic: 83, pulse: 74, measured_at: "2026-08-13T00:55:00.000Z" }),
  signoDe({ systolic: 135, diastolic: 80, pulse: 72, measured_at: "2026-08-12T00:40:00.000Z" }),
  signoDe({ systolic: 165, diastolic: 102, pulse: 88, measured_at: "2026-08-11T01:25:00.000Z" }),
  signoDe({ type: "glucose", value: 156, notes: "En ayunas", measured_at: "2026-08-13T02:10:00.000Z" }),
  signoDe({ type: "glucose", value: 148, notes: "En ayunas", measured_at: "2026-08-11T01:55:00.000Z" }),
  signoDe({ type: "weight", value: 79.2, measured_at: "2026-08-13T00:10:00.000Z" }),
]

/** Fila COMPLETA de `vital_sign_alerts`. */
function alertaDe(parcial: Partial<Tables<"vital_sign_alerts">>): Tables<"vital_sign_alerts"> {
  return {
    id: "bb0e8400-e29b-41d4-a716-446655440001",
    profile_id: PERFIL_ID,
    vital_sign_id: "aa0e8400-e29b-41d4-a716-446655440001",
    tipo: "blood_pressure",
    regla: "sistolica_alta",
    valor: 165,
    umbral: 160,
    referencia: null,
    mensaje: "Presión sistólica alta: 165 mmHg (umbral de alerta: 160).",
    acknowledged_at: null,
    acknowledged_by: null,
    created_at: "2026-08-11T01:25:00.000Z",
    ...parcial,
  }
}

const ALERTAS: Tables<"vital_sign_alerts">[] = [
  alertaDe({}),
  alertaDe({
    id: "bb0e8400-e29b-41d4-a716-446655440002",
    regla: "diastolica_alta",
    valor: 102,
    umbral: 100,
    mensaje: "Presión diastólica alta: 102 mmHg (umbral de alerta: 100).",
    created_at: "2026-08-11T01:26:00.000Z",
  }),
]

/**
 * Las filas completas, tal como salen de la base. Cada arreglo se pasa con su
 * tipo de fila REAL (`Perfil`, `Documento`, `Tables<"vital_signs">`…), más
 * ancho que el que declara `FuentesClinicas`: eso es justamente lo que hace
 * honesto al test de fuga.
 */
const FUENTES: FuentesClinicas = {
  perfil: PERFIL,
  medicaciones: MEDICACIONES,
  documentos: DOCUMENTOS,
  metricas: METRICAS,
  signos: SIGNOS,
  alertas: ALERTAS,
}

const CONTEXTO = armarContexto(FUENTES, GENERADO_EN)
const JSON_CONTEXTO = JSON.stringify(CONTEXTO)

describe("contexto de la ficha — minimización (criterio de aceptación 10.2)", () => {
  for (const [que, valor] of Object.entries(PROHIBIDOS)) {
    it(`no filtra ${que}`, () => {
      expect(
        JSON_CONTEXTO.includes(valor),
        `El contexto que viaja a Gemini contiene ${que} ("${valor}"). Ver docs/minimizacion-datos.md.`,
      ).toBe(false)
    })
  }

  it("no filtra nada del OCR crudo del documento", () => {
    // El OCR es la fuga más grave posible: trae el encabezado completo del
    // informe. Se verifica frase por frase, no solo el bloque entero.
    for (const linea of OCR_CRUDO.split("\n")) {
      expect(JSON_CONTEXTO.includes(linea)).toBe(false)
    }
  })

  it("no contiene ningún uuid", () => {
    // Red de seguridad genérica: cualquier uuid, aunque sea de una tabla que
    // hoy no se lee. Ver "Por qué NO viajan los uuid" en lib/ficha/armado.ts.
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    expect(uuid.test(JSON_CONTEXTO)).toBe(false)
  })

  it("las claves de primer nivel son exactamente la lista blanca", () => {
    expect(Object.keys(CONTEXTO).sort()).toEqual([
      "alertasActivas",
      "estudiosRecientes",
      "generadoEn",
      "medicacionActiva",
      "metricasLaboratorio",
      "paciente",
      "signosVitales",
      "version",
    ])
  })

  it("del paciente solo viajan edad y datos clínicos, nunca la fecha de nacimiento", () => {
    expect(CONTEXTO.paciente).toEqual({
      edadAnios: 80,
      grupoSanguineo: "O+",
      alergias: ["Penicilina", "Ibuprofeno"],
      condicionesCronicas: ["Hipertensión arterial", "Diabetes tipo 2"],
      medicacionCritica: ["Enalapril 10 mg"],
      notasSos: "Marcapasos colocado en 2019. Usa lentes.",
    })
  })

  it("de cada estudio no viaja el médico ni la institución", () => {
    for (const estudio of CONTEXTO.estudiosRecientes) {
      expect(Object.keys(estudio).sort()).toEqual([
        "categoria",
        "especialidad",
        "fecha",
        "indice",
        "resumenIa",
        "titulo",
      ])
    }
  })

  it("de cada alerta no viaja el mensaje ya redactado ni el id", () => {
    for (const alerta of CONTEXTO.alertasActivas) {
      expect(Object.keys(alerta).sort()).toEqual([
        "fecha",
        "motivo",
        "referencia",
        "signo",
        "umbral",
        "valor",
      ])
    }
  })

  it("estampa la versión de la forma del contexto y el momento del armado", () => {
    expect(CONTEXTO.version).toBe(VERSION_CONTEXTO_CLINICO)
    expect(CONTEXTO.generadoEn).toBe("2026-08-14T12:00:00.000Z")
  })
})

describe("contexto de la ficha — contenido clínico", () => {
  it("incluye la medicación vigente hoy, ordenada por nombre", () => {
    expect(CONTEXTO.medicacionActiva.map((m) => m.nombre)).toEqual(["Enalapril", "Glucophage"])
  })

  it("deja afuera la medicación cuyo curso ya terminó", () => {
    expect(CONTEXTO.medicacionActiva.some((m) => m.nombre === "Amoxicilina")).toBe(false)
  })

  it("de cada medicación trae droga, dosis, frecuencia y días restantes", () => {
    expect(CONTEXTO.medicacionActiva[1]).toEqual({
      nombre: "Glucophage",
      droga: "Metformina",
      presentacion: "Comprimidos 850 mg",
      dosis: "1 comprimido",
      frecuencia: "Todos los días (08:00, 20:00)",
      desde: "2026-06-01",
      diasRestantes: 60,
      necesitaRenovacion: false,
      indicaciones: "Tomar con las comidas.",
    })
  })

  it("redacta la frecuencia por intervalo y marca la renovación pendiente", () => {
    expect(CONTEXTO.medicacionActiva[0]?.frecuencia).toBe("Cada 24 horas")
    expect(CONTEXTO.medicacionActiva[0]?.necesitaRenovacion).toBe(true)
  })

  it("trae como mucho 5 estudios, del más nuevo al más viejo, numerados desde 1", () => {
    expect(CONTEXTO.estudiosRecientes).toHaveLength(MAXIMO_ESTUDIOS)
    expect(CONTEXTO.estudiosRecientes.map((e) => e.fecha)).toEqual([
      "2026-08-05",
      "2026-08-01",
      "2026-07-20",
      "2026-06-15",
      "2026-05-10",
    ])
    expect(CONTEXTO.estudiosRecientes.map((e) => e.indice)).toEqual([1, 2, 3, 4, 5])
  })

  it("traduce la categoría del estudio al castellano", () => {
    expect(CONTEXTO.estudiosRecientes.map((e) => e.categoria)).toEqual([
      "Consulta",
      "Laboratorio",
      "Receta",
      "Imágenes",
      "Otro",
    ])
  })

  it("trae las 3 últimas mediciones de CADA métrica, más reciente primero", () => {
    expect(CONTEXTO.metricasLaboratorio.map((m) => m.metrica)).toEqual(["Glucosa", "Hemoglobina"])

    for (const metrica of CONTEXTO.metricasLaboratorio) {
      expect(metrica.ultimas).toHaveLength(MEDICIONES_POR_TIPO)
    }

    expect(CONTEXTO.metricasLaboratorio[0]?.ultimas).toEqual([
      { fecha: "2026-08-01", valor: 145, fueraDeRango: true },
      { fecha: "2026-07-25", valor: 138, fueraDeRango: true },
      { fecha: "2026-07-11", valor: 135, fueraDeRango: true },
    ])
  })

  it("calcula la tendencia contra la medición anterior, sin inventar semántica", () => {
    expect(CONTEXTO.metricasLaboratorio[0]?.tendencia).toBe("subio")
    expect(CONTEXTO.metricasLaboratorio[1]?.tendencia).toBe("bajo")
  })

  it("conserva el rango de referencia impreso y la unidad", () => {
    expect(CONTEXTO.metricasLaboratorio[0]?.unidad).toBe("mg/dL")
    expect(CONTEXTO.metricasLaboratorio[0]?.rangoReferencia).toBe("70-100")
  })

  it("trae las 3 últimas mediciones de cada signo, en el orden tensión / glucemia / peso", () => {
    expect(CONTEXTO.signosVitales.map((s) => s.signo)).toEqual([
      "Tensión arterial",
      "Glucemia",
      "Peso",
    ])
    expect(CONTEXTO.signosVitales[0]?.ultimas).toHaveLength(MEDICIONES_POR_TIPO)
    expect(CONTEXTO.signosVitales[0]?.ultimas.map((m) => m.sistolica)).toEqual([139, 140, 135])
    expect(CONTEXTO.signosVitales[2]?.ultimas).toHaveLength(1)
  })

  it("conserva la nota de la medición, que cambia cómo se lee el valor", () => {
    expect(CONTEXTO.signosVitales[1]?.ultimas[0]?.nota).toBe("En ayunas")
  })

  it("trae las alertas sin ver, más reciente primero, con motivo en castellano", () => {
    expect(CONTEXTO.alertasActivas.map((a) => a.motivo)).toEqual([
      "Presión diastólica por encima del umbral",
      "Presión sistólica por encima del umbral",
    ])
    expect(CONTEXTO.alertasActivas[0]).toMatchObject({ valor: 102, umbral: 100, signo: "Tensión arterial" })
  })
})

describe("contexto de la ficha — datos faltantes", () => {
  it("un perfil sin ningún dato clínico igual produce un contexto válido", () => {
    const vacio = armarContexto(
      {
        perfil: {
          date_of_birth: null,
          blood_type: null,
          allergies: null,
          chronic_conditions: null,
          critical_medication: null,
          sos_notes: "   ",
        },
        medicaciones: [],
        documentos: [],
        metricas: [],
        signos: [],
        alertas: [],
      },
      GENERADO_EN,
    )

    expect(vacio.paciente).toEqual({
      edadAnios: null,
      grupoSanguineo: null,
      alergias: [],
      condicionesCronicas: [],
      medicacionCritica: [],
      notasSos: null,
    })
    expect(vacio.medicacionActiva).toEqual([])
    expect(vacio.estudiosRecientes).toEqual([])
    expect(vacio.metricasLaboratorio).toEqual([])
    expect(vacio.signosVitales).toEqual([])
    expect(vacio.alertasActivas).toEqual([])
  })

  it("una métrica con una sola medición no inventa tendencia", () => {
    const unaSola = armarContexto(
      {
        perfil: PERFIL,
        medicaciones: [],
        documentos: [],
        metricas: [metricaDe("Glucemia", "glucosa", "2026-08-01", 145, RANGO_GLUCEMIA)],
        signos: [],
        alertas: [],
      },
      GENERADO_EN,
    )
    expect(unaSola.metricasLaboratorio[0]?.tendencia).toBeNull()
    expect(unaSola.metricasLaboratorio[0]?.ultimas).toHaveLength(1)
  })
})
