/**
 * Tests unitarios del schema Zod de validación de extracción (`lib/validacion/documento.schema.ts`).
 *
 * Cubre:
 * - Respuesta válida completa y mínima
 * - Validación estricta de fechas (formato, existencia semántica)
 * - Límites de longitud de strings
 * - Enums y arrays
 * - Casos edge (campos faltantes, tipos incorrectos, arrays gigantes)
 *
 * Sin red, sin Supabase. Puro parsing y validación.
 *
 *   npm run test -- documento-schema
 */

import { describe, it, expect } from 'vitest'
import { validarExtraccion } from '@/lib/validacion/documento.schema'
import type { DocumentoMedicoExtraido } from '@/lib/gemini/schemas'

describe('lib/validacion/documento.schema.ts', () => {
  /**
   * Datos válidos de ejemplo: un resultado típico de Gemini tras leer un
   * análisis de laboratorio con varias métricas.
   */
  const ejemploValido: DocumentoMedicoExtraido = {
    fecha: '2026-03-15',
    especialidad: 'Clínica médica',
    institucion: 'Laboratorio Central SA',
    medico: 'Dr. Juan Pérez García',
    resumen:
      'Análisis de sangre completo sin anomalías. Glucemia y colesterol dentro de los valores normales.',
    categoria: 'laboratory',
    metricas: [
      {
        nombre: 'Glucemia en ayunas',
        valor: 95,
        unidad: 'mg/dl',
        rango: '70 - 110',
      },
      {
        nombre: 'Colesterol total',
        valor: 180,
        unidad: 'mg/dl',
        rango: '< 200',
      },
    ],
    texto_completo:
      'Valores dentro del rango de normalidad. No se observan anomalías significativas.',
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 1: Respuesta válida completa
  // ─────────────────────────────────────────────────────────────────────────

  it('acepta una extracción válida completa', () => {
    const resultado = validarExtraccion(ejemploValido)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.fecha).toBe('2026-03-15')
      expect(resultado.datos.categoria).toBe('laboratory')
      expect(resultado.datos.metricas).toHaveLength(2)
      expect(resultado.datos.texto_completo).toContain('normalidad')
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 2: Respuesta válida mínima (solo requeridos, sin texto_completo)
  // ─────────────────────────────────────────────────────────────────────────

  it('acepta una extracción válida mínima sin texto_completo', () => {
    const minimo = {
      fecha: '2025-12-01',
      especialidad: 'Cardiología',
      institucion: 'Centro de salud',
      medico: 'Dra. María',
      resumen: 'Consulta de seguimiento.',
      categoria: 'consultation',
      metricas: [],
      // texto_completo omitido deliberadamente
    }
    const resultado = validarExtraccion(minimo)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.texto_completo).toBeUndefined()
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 3: Campo requerido faltante
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza si falta el campo "resumen" (requerido)', () => {
    const incompleto = {
      fecha: '2026-03-15',
      especialidad: 'Endocrinología',
      institucion: 'Hospital',
      medico: 'Dr. X',
      // resumen FALTANTE
      categoria: 'imaging',
      metricas: [],
    }
    const resultado = validarExtraccion(incompleto)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('resumen'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 4: Fecha con formato incorrecto (DD/MM/YYYY en lugar de YYYY-MM-DD)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza fecha con formato incorrecto (ej: 15/03/2026)', () => {
    const conFechaIncorrecta = {
      ...ejemploValido,
      fecha: '15/03/2026',
    }
    const resultado = validarExtraccion(conFechaIncorrecta)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('YYYY-MM-DD'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 5: Fecha inexistente (29 de febrero en año no bisiesto, etc.)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza fecha inexistente como 2026-02-30', () => {
    const conFechaInexistente = {
      ...ejemploValido,
      fecha: '2026-02-30',
    }
    const resultado = validarExtraccion(conFechaInexistente)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('inexistente'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 6: Métrica con valor no numérico (string en lugar de number)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza métrica con valor de tipo string', () => {
    const conMetricaBad = {
      ...ejemploValido,
      metricas: [
        {
          nombre: 'Glucemia',
          valor: '95', // STRING, no number
          unidad: 'mg/dl',
          rango: '70 - 110',
        },
      ],
    }
    const resultado = validarExtraccion(conMetricaBad)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('número'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 7: Métrica sin nombre
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza métrica con nombre vacío', () => {
    const conMetricaSinNombre = {
      ...ejemploValido,
      metricas: [
        {
          nombre: '', // VACÍO
          valor: 95,
          unidad: 'mg/dl',
          rango: '70 - 110',
        },
      ],
    }
    const resultado = validarExtraccion(conMetricaSinNombre)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('nombre'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 8: Categoría fuera del enum permitido
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza categoría no permitida', () => {
    const conCategoriaIncorrect = {
      ...ejemploValido,
      categoria: 'resonancia', // NO está en enum
    }
    const resultado = validarExtraccion(conCategoriaIncorrect)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('categoría'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 9: Array de métricas demasiado grande (51 elementos, máx 50)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza más de 50 métricas', () => {
    const metricasGigantes = Array.from({ length: 51 }, (_, i) => ({
      nombre: `Métrica ${i + 1}`,
      valor: i + 1,
      unidad: 'unidad',
      rango: 'rango',
    }))
    const conMetricasExceso = {
      ...ejemploValido,
      metricas: metricasGigantes,
    }
    const resultado = validarExtraccion(conMetricasExceso)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('demasiadas'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 10: texto_completo excesivamente largo
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza texto_completo mayor a 500 caracteres', () => {
    const textoExcesivo = 'a'.repeat(501)
    const conTextoBad = {
      ...ejemploValido,
      texto_completo: textoExcesivo,
    }
    const resultado = validarExtraccion(conTextoBad)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('extracto'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 11: Entrada totalmente inválida (null)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza null', () => {
    const resultado = validarExtraccion(null)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.length).toBeGreaterThan(0)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 12: Entrada totalmente inválida (string)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza un string directo (no objeto)', () => {
    const resultado = validarExtraccion('esto no es un documento')
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.length).toBeGreaterThan(0)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 13: Campos adicionales desconocidos (strict mode)
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza campos desconocidos (strict mode)', () => {
    const conCampoExtra = {
      ...ejemploValido,
      campoDesconocido: 'valor',
    }
    const resultado = validarExtraccion(conCampoExtra)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('Unrecognized key'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 14: Fecha con espacios se trimea correctamente
  // ─────────────────────────────────────────────────────────────────────────

  it('acepta fecha con espacios previos/posteriores (se trimea)', () => {
    const conEspacios = {
      ...ejemploValido,
      fecha: '  2026-03-15  ',
    }
    const resultado = validarExtraccion(conEspacios)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.fecha).toBe('2026-03-15')
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 15: Valor infinito o NaN rechazados
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza valor Infinity en métrica', () => {
    const conInfinity = {
      ...ejemploValido,
      metricas: [
        {
          nombre: 'Métrica rota',
          valor: Infinity,
          unidad: 'unidad',
          rango: 'rango',
        },
      ],
    }
    const resultado = validarExtraccion(conInfinity)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('Infinity') || e.includes('número'))).toBe(
        true,
      )
    }
  })

  it('rechaza NaN en métrica', () => {
    const conNaN = {
      ...ejemploValido,
      metricas: [
        {
          nombre: 'Métrica rota',
          valor: NaN,
          unidad: 'unidad',
          rango: 'rango',
        },
      ],
    }
    const resultado = validarExtraccion(conNaN)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('NaN') || e.includes('número'))).toBe(true)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 16: Resumen vacío rechazado
  // ─────────────────────────────────────────────────────────────────────────

  it('rechaza resumen vacío', () => {
    const conResumenVacio = {
      ...ejemploValido,
      resumen: '',
    }
    const resultado = validarExtraccion(conResumenVacio)
    expect(resultado.ok).toBe(false)
    if (!resultado.ok) {
      expect(resultado.errores.some((e) => e.includes('resumen'))).toBe(true)
    }
  })
})
