/**
 * Tests unitarios de `lib/documentos/sugerir-titulo.ts`.
 *
 *   npm run test -- sugerir-titulo
 */

import { describe, it, expect } from 'vitest'
import { sugerirTitulo, etiquetaCategoria } from '@/lib/documentos/sugerir-titulo'
import type { DocumentoMedicoExtraido } from '@/lib/gemini/schemas'

function extraccion(overrides: Partial<DocumentoMedicoExtraido> = {}): DocumentoMedicoExtraido {
  return {
    fecha: '2026-08-01',
    especialidad: '',
    institucion: '',
    medico: '',
    resumen: 'Resumen de prueba.',
    categoria: 'laboratory',
    metricas: [],
    ...overrides,
  }
}

describe('lib/documentos/sugerir-titulo.ts', () => {
  it('prioriza la institución sobre especialidad y médico', () => {
    const resultado = sugerirTitulo(
      extraccion({ institucion: 'Laboratorio Central', especialidad: 'Clínica médica', medico: 'Dr. Pérez' }),
    )
    expect(resultado.titulo).toBe('Análisis de laboratorio — Laboratorio Central')
    expect(resultado.detectado).toBe(true)
  })

  it('usa la especialidad si no hay institución', () => {
    const resultado = sugerirTitulo(extraccion({ especialidad: 'Cardiología', categoria: 'consultation' }))
    expect(resultado.titulo).toBe('Consulta — Cardiología')
    expect(resultado.detectado).toBe(true)
  })

  it('usa el médico si no hay institución ni especialidad', () => {
    const resultado = sugerirTitulo(extraccion({ medico: 'Dra. Gómez', categoria: 'prescription' }))
    expect(resultado.titulo).toBe('Receta — Dra. Gómez')
    expect(resultado.detectado).toBe(true)
  })

  it('cae a la etiqueta genérica de la categoría cuando no hay ningún dato de contexto', () => {
    const resultado = sugerirTitulo(extraccion({ categoria: 'imaging' }))
    expect(resultado.titulo).toBe('Estudio por imágenes')
    expect(resultado.detectado).toBe(false)
  })

  it('trata strings de solo espacios como ausentes', () => {
    const resultado = sugerirTitulo(
      extraccion({ institucion: '   ', especialidad: '  ', medico: '  ', categoria: 'other' }),
    )
    expect(resultado.titulo).toBe('Documento')
    expect(resultado.detectado).toBe(false)
  })

  it('etiquetaCategoria devuelve el texto en español de cada categoría', () => {
    expect(etiquetaCategoria('laboratory')).toBe('Análisis de laboratorio')
    expect(etiquetaCategoria('imaging')).toBe('Estudio por imágenes')
    expect(etiquetaCategoria('prescription')).toBe('Receta')
    expect(etiquetaCategoria('consultation')).toBe('Consulta')
    expect(etiquetaCategoria('other')).toBe('Documento')
  })
})
