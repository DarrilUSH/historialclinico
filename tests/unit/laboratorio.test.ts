/**
 * Tests unitarios de `lib/laboratorio/` (Sprint 4, tarea 4.6).
 *
 * Cubre:
 * - Diccionario de sinónimos: variantes con tildes/mayúsculas/espacios,
 *   métricas desconocidas.
 * - Parser de rangos de referencia: las cuatro formas numéricas + el caso no
 *   parseable.
 * - `prepararMetricas`: normalización, parseo de rango, deduplicación por
 *   documento y descarte silencioso de items con forma inválida.
 *
 *   npm run test -- laboratorio
 */

import { describe, it, expect, vi } from 'vitest'

import { normalizarMetrica, normalizarTexto } from '@/lib/laboratorio/diccionario'
import { parsearRangoReferencia, prepararMetricas } from '@/lib/laboratorio/normalizacion'

describe('lib/laboratorio/diccionario.ts', () => {
  describe('normalizarTexto', () => {
    it('quita tildes, pasa a minúsculas y recorta espacios repetidos', () => {
      expect(normalizarTexto('  Triglicéridos  ')).toBe('trigliceridos')
      expect(normalizarTexto('HEMOGLOBINA   GLICOSILADA')).toBe('hemoglobina glicosilada')
    })
  })

  describe('normalizarMetrica', () => {
    it('reconoce sinónimos de Glucosa con distintas mayúsculas y variantes', () => {
      expect(normalizarMetrica('Glucemia').canonico).toBe('Glucosa')
      expect(normalizarMetrica('glucosa en ayunas').canonico).toBe('Glucosa')
      expect(normalizarMetrica('GLU').canonico).toBe('Glucosa')
    })

    it('reconoce Colesterol total por sus abreviaturas', () => {
      expect(normalizarMetrica('COL TOTAL').canonico).toBe('Colesterol total')
      expect(normalizarMetrica('ct').canonico).toBe('Colesterol total')
      expect(normalizarMetrica('Colesterol Total').canonico).toBe('Colesterol total')
    })

    it('distingue Colesterol HDL de Colesterol LDL', () => {
      expect(normalizarMetrica('HDL').canonico).toBe('Colesterol HDL')
      expect(normalizarMetrica('colesterol hdl').canonico).toBe('Colesterol HDL')
      expect(normalizarMetrica('LDL').canonico).toBe('Colesterol LDL')
    })

    it('reconoce Hemoglobina, Hematocrito y Hemoglobina glicosilada sin confundirlas', () => {
      expect(normalizarMetrica('Hb').canonico).toBe('Hemoglobina')
      expect(normalizarMetrica('HGB').canonico).toBe('Hemoglobina')
      expect(normalizarMetrica('HTO').canonico).toBe('Hematocrito')
      expect(normalizarMetrica('HCT').canonico).toBe('Hematocrito')
      expect(normalizarMetrica('HbA1c').canonico).toBe('Hemoglobina glicosilada')
      expect(normalizarMetrica('A1C').canonico).toBe('Hemoglobina glicosilada')
    })

    it('reconoce Triglicéridos, Leucocitos, Plaquetas, Creatinina, Urea y TSH', () => {
      expect(normalizarMetrica('trigliceridos').canonico).toBe('Triglicéridos')
      expect(normalizarMetrica('TG').canonico).toBe('Triglicéridos')
      expect(normalizarMetrica('glóbulos blancos').canonico).toBe('Leucocitos')
      expect(normalizarMetrica('WBC').canonico).toBe('Leucocitos')
      expect(normalizarMetrica('PLT').canonico).toBe('Plaquetas')
      expect(normalizarMetrica('creatinina').canonico).toBe('Creatinina')
      expect(normalizarMetrica('urea').canonico).toBe('Urea')
      expect(normalizarMetrica('tsh').canonico).toBe('TSH')
    })

    it('devuelve canonico null para una métrica que no está en el diccionario', () => {
      expect(normalizarMetrica('Ácido úrico').canonico).toBeNull()
      expect(normalizarMetrica('Ferritina').canonico).toBeNull()
    })
  })
})

describe('lib/laboratorio/normalizacion.ts', () => {
  describe('parsearRangoReferencia', () => {
    it('parsea un intervalo "min - max"', () => {
      const resultado = parsearRangoReferencia('70 - 110')
      expect(resultado.reference_min).toBe(70)
      expect(resultado.reference_max).toBe(110)
      expect(resultado.reference_range).toBe('70 - 110')
    })

    it('parsea un intervalo con coma decimal y unidad pegada', () => {
      const resultado = parsearRangoReferencia('4,5 - 5,5 mg/dl')
      expect(resultado.reference_min).toBe(4.5)
      expect(resultado.reference_max).toBe(5.5)
    })

    it('parsea un techo con "<"', () => {
      const resultado = parsearRangoReferencia('< 200')
      expect(resultado.reference_min).toBeNull()
      expect(resultado.reference_max).toBe(200)
    })

    it('parsea un techo escrito como "hasta N"', () => {
      const resultado = parsearRangoReferencia('hasta 200')
      expect(resultado.reference_min).toBeNull()
      expect(resultado.reference_max).toBe(200)
    })

    it('parsea un piso con ">="', () => {
      const resultado = parsearRangoReferencia('>= 40')
      expect(resultado.reference_min).toBe(40)
      expect(resultado.reference_max).toBeNull()
    })

    it('conserva el texto pero deja los límites en null cuando no es parseable', () => {
      const resultado = parsearRangoReferencia('según método de laboratorio')
      expect(resultado.reference_min).toBeNull()
      expect(resultado.reference_max).toBeNull()
      expect(resultado.reference_range).toBe('según método de laboratorio')
    })

    it('devuelve todo null para un rango vacío o ausente', () => {
      expect(parsearRangoReferencia('')).toEqual({
        reference_range: null,
        reference_min: null,
        reference_max: null,
      })
      expect(parsearRangoReferencia(null)).toEqual({
        reference_range: null,
        reference_min: null,
        reference_max: null,
      })
      expect(parsearRangoReferencia(undefined)).toEqual({
        reference_range: null,
        reference_min: null,
        reference_max: null,
      })
    })
  })

  describe('prepararMetricas', () => {
    it('resuelve el nombre canónico y parsea el rango de cada métrica', () => {
      const { filas } = prepararMetricas(
        [
          { nombre: 'Glucemia', valor: 95, unidad: 'mg/dl', rango: '70 - 110' },
          { nombre: 'COL TOTAL', valor: 180, unidad: 'mg/dl', rango: '< 200' },
          { nombre: 'Hb', valor: 14.2, unidad: 'g/dl', rango: '13 - 17' },
        ],
        '2026-08-01',
      )

      expect(filas).toHaveLength(3)
      expect(filas[0]).toMatchObject({
        metric_name: 'Glucemia',
        metric_canonical: 'Glucosa',
        value: 95,
        unit: 'mg/dl',
        reference_min: 70,
        reference_max: 110,
        measurement_date: '2026-08-01',
      })
      expect(filas[1].metric_canonical).toBe('Colesterol total')
      expect(filas[2].metric_canonical).toBe('Hemoglobina')
    })

    it('deduplica por nombre canónico dentro del mismo documento: gana la primera aparición', () => {
      const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { filas, duplicadas } = prepararMetricas(
        [
          { nombre: 'Glucemia', valor: 95, unidad: 'mg/dl', rango: '70 - 110' },
          { nombre: 'Glucosa en ayunas', valor: 999, unidad: 'mg/dl', rango: '' },
        ],
        '2026-08-01',
      )

      expect(filas).toHaveLength(1)
      expect(filas[0].value).toBe(95)
      expect(duplicadas).toHaveLength(1)
      expect(duplicadas[0].nombre).toBe('Glucosa en ayunas')
      expect(avisos).toHaveBeenCalledTimes(1)

      avisos.mockRestore()
    })

    it('deduplica también métricas sin nombre canónico, por el nombre limpio normalizado', () => {
      const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { filas } = prepararMetricas(
        [
          { nombre: 'Ferritina', valor: 50, unidad: 'ng/ml', rango: '' },
          { nombre: '  FERRITINA  ', valor: 60, unidad: 'ng/ml', rango: '' },
        ],
        '2026-08-01',
      )

      expect(filas).toHaveLength(1)
      expect(filas[0].value).toBe(50)
      expect(filas[0].metric_canonical).toBeNull()

      avisos.mockRestore()
    })

    it('conserva el nombre original y canonical null para una métrica desconocida', () => {
      const { filas } = prepararMetricas(
        [{ nombre: 'Ácido úrico', valor: 5.2, unidad: 'mg/dl', rango: '3,5 - 7,2' }],
        '2026-08-01',
      )

      expect(filas[0].metric_name).toBe('Ácido úrico')
      expect(filas[0].metric_canonical).toBeNull()
      expect(filas[0].reference_min).toBe(3.5)
      expect(filas[0].reference_max).toBe(7.2)
    })

    it('descarta en silencio items sin nombre o con valor no numérico, sin romper el resto', () => {
      const { filas } = prepararMetricas(
        [
          { nombre: '   ', valor: 10, unidad: '', rango: '' },
          { nombre: 'Urea', valor: Number.NaN, unidad: 'mg/dl', rango: '' },
          { nombre: 'Urea', valor: 30, unidad: 'mg/dl', rango: '10 - 50' },
        ],
        '2026-08-01',
      )

      expect(filas).toHaveLength(1)
      expect(filas[0].metric_canonical).toBe('Urea')
      expect(filas[0].value).toBe(30)
    })

    it('usa unit y reference_range null cuando vienen vacíos', () => {
      const { filas } = prepararMetricas(
        [{ nombre: 'Plaquetas', valor: 250000, unidad: '', rango: '' }],
        '2026-08-01',
      )

      expect(filas[0].unit).toBeNull()
      expect(filas[0].reference_range).toBeNull()
      expect(filas[0].reference_min).toBeNull()
      expect(filas[0].reference_max).toBeNull()
    })

    it('devuelve una lista vacía sin lanzar cuando no hay métricas', () => {
      expect(prepararMetricas([], '2026-08-01')).toEqual({ filas: [], duplicadas: [] })
      expect(prepararMetricas(null, '2026-08-01')).toEqual({ filas: [], duplicadas: [] })
      expect(prepararMetricas(undefined, '2026-08-01')).toEqual({ filas: [], duplicadas: [] })
    })
  })
})
