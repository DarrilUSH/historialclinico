/**
 * Tests unitarios de `lib/estudios/agrupacion.ts`.
 *
 *   npm run test -- agrupacion-estudios
 */

import { describe, it, expect } from 'vitest'
import { agruparPorPeriodo, etiquetaDePeriodo } from '@/lib/estudios/agrupacion'

interface DocumentoDePrueba {
  id: string
  document_date: string
}

function doc(id: string, document_date: string): DocumentoDePrueba {
  return { id, document_date }
}

describe('lib/estudios/agrupacion.ts', () => {
  describe('etiquetaDePeriodo', () => {
    it('formatea "YYYY-MM" como "Mes Año" en español, sin "de"', () => {
      expect(etiquetaDePeriodo('2026-03')).toBe('Marzo 2026')
    })

    it('capitaliza meses de una sola palabra y meses largos por igual', () => {
      expect(etiquetaDePeriodo('2026-01')).toBe('Enero 2026')
      expect(etiquetaDePeriodo('2026-12')).toBe('Diciembre 2026')
    })

    it('no cruza el límite de mes por husos horarios (parseo en UTC)', () => {
      // Si esto se formateara en una zona horaria negativa (ej. Ushuaia,
      // UTC-3) en vez de UTC, "2026-03-01" podría leerse como el 28 de
      // febrero y el encabezado saldría "Febrero 2026" en vez de "Marzo
      // 2026" — exactamente el bug documentado en
      // `estudios/page.tsx` (Sprint 4) para `formatearFecha`.
      expect(etiquetaDePeriodo('2026-03')).toBe('Marzo 2026')
      expect(etiquetaDePeriodo('2026-01')).not.toBe('Diciembre 2025')
    })
  })

  describe('agruparPorPeriodo', () => {
    it('agrupa el seed de 5 documentos en 4 períodos, en orden descendente', () => {
      const documentos = [
        doc('consulta', '2026-08-05'),
        doc('laboratorio', '2026-08-01'),
        doc('receta', '2026-07-20'),
        doc('ecg', '2026-06-15'),
        doc('informe', '2026-05-10'),
      ]

      const grupos = agruparPorPeriodo(documentos)

      expect(grupos.map((g) => g.etiqueta)).toEqual([
        'Agosto 2026',
        'Julio 2026',
        'Junio 2026',
        'Mayo 2026',
      ])
      expect(grupos[0].documentos.map((d) => d.id)).toEqual(['consulta', 'laboratorio'])
      expect(grupos[1].documentos.map((d) => d.id)).toEqual(['receta'])
      expect(grupos[2].documentos.map((d) => d.id)).toEqual(['ecg'])
      expect(grupos[3].documentos.map((d) => d.id)).toEqual(['informe'])
    })

    it('devuelve una lista vacía para una lista vacía', () => {
      expect(agruparPorPeriodo([])).toEqual([])
    })

    it('agrupa todo en un solo período cuando todos los documentos son del mismo mes', () => {
      const documentos = [doc('a', '2026-03-20'), doc('a', '2026-03-10'), doc('a', '2026-03-01')]
      const grupos = agruparPorPeriodo(documentos)
      expect(grupos).toHaveLength(1)
      expect(grupos[0].etiqueta).toBe('Marzo 2026')
      expect(grupos[0].documentos).toHaveLength(3)
    })

    it('no re-abre un grupo de un mes ya cerrado (la fecha nunca crece)', () => {
      // Documentos ordenados desc: dos de agosto, uno de julio. Si la
      // implementación buscara por clave en vez de mirar solo el último
      // grupo, este caso seguiría dando el resultado correcto -pero es el
      // caso que ejercita la premisa documentada en el header del módulo.
      const documentos = [doc('a', '2026-08-15'), doc('b', '2026-08-01'), doc('c', '2026-07-28')]
      const grupos = agruparPorPeriodo(documentos)
      expect(grupos.map((g) => g.clave)).toEqual(['2026-08', '2026-07'])
      expect(grupos[0].documentos).toHaveLength(2)
    })

    it('cada grupo expone su clave "YYYY-MM"', () => {
      const grupos = agruparPorPeriodo([doc('a', '2026-11-05')])
      expect(grupos[0].clave).toBe('2026-11')
    })
  })
})
