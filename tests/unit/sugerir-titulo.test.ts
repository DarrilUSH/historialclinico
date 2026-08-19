/**
 * Tests unitarios de `lib/documentos/sugerir-titulo.ts`.
 *
 * El Sprint 19 cambió el contrato de este módulo -y el significado de
 * `detectado`- con evidencia medida detrás: componiendo
 * `<categoría> — <institución>`, 0 de 19 títulos acertaban y 15 de 25
 * documentos compartían título con otro. Ahora el nombre del estudio lo trae
 * el modelo y el genérico es el ÚLTIMO recurso, marcado como NO detectado
 * para que la pantalla de revisión pida que lo complete una persona.
 *
 *   npm run test -- sugerir-titulo
 */

import { describe, it, expect } from 'vitest'
import {
  sugerirTitulo,
  etiquetaCategoria,
  normalizarTituloParaCotejo,
  tituloYaUsado,
} from '@/lib/documentos/sugerir-titulo'
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

describe('sugerirTitulo — el título que trae el modelo', () => {
  it('usa el nombre del estudio que devolvió el modelo, y lo marca como detectado', () => {
    const resultado = sugerirTitulo(
      extraccion({
        titulo: 'Ecografía abdominal',
        categoria: 'imaging',
        institucion: 'SANATORIO SAN JORGE S.R.L.',
      }),
    )
    expect(resultado.titulo).toBe('Ecografía abdominal')
    expect(resultado.origen).toBe('modelo')
    expect(resultado.detectado).toBe(true)
  })

  it('el título del modelo GANA sobre la institución: es el defecto que el sprint vino a arreglar', () => {
    // El caso real: cinco documentos distintos se llamaban todos "Estudio por
    // imágenes — SANATORIO SAN JORGE S.R.L.".
    const colangio = sugerirTitulo(
      extraccion({
        titulo: 'Colangio-RMN de abdomen',
        categoria: 'imaging',
        institucion: 'SANATORIO SAN JORGE S.R.L.',
      }),
    )
    const radiografia = sugerirTitulo(
      extraccion({
        titulo: 'Radiografía de tórax',
        categoria: 'imaging',
        institucion: 'SANATORIO SAN JORGE S.R.L.',
      }),
    )
    expect(colangio.titulo).not.toBe(radiografia.titulo)
  })

  it('recorta el título del modelo al tope del campo, sin dejar espacio colgando', () => {
    const largo = `${'A'.repeat(199)} sobrante`
    const resultado = sugerirTitulo(extraccion({ titulo: largo }))
    expect(resultado.titulo).toHaveLength(199)
    expect(resultado.detectado).toBe(true)
  })

  it('un título que repite la etiqueta genérica de la categoría NO cuenta como detectado', () => {
    // "Estudio por imágenes" no dice qué estudio es: es exactamente el título
    // inútil que este sprint eliminó. Cae al fallback y se marca sin detectar.
    const resultado = sugerirTitulo(
      extraccion({ titulo: 'Estudio por imágenes', categoria: 'imaging', institucion: 'Clínica X' }),
    )
    expect(resultado.titulo).toBe('Estudio por imágenes — Clínica X')
    expect(resultado.origen).toBe('compuesto')
    expect(resultado.detectado).toBe(false)
  })
})

describe('sugerirTitulo — el genérico compuesto, ahora como ÚLTIMO recurso', () => {
  it('sin título del modelo, compone con la institución pero NO lo marca como detectado', () => {
    const resultado = sugerirTitulo(
      extraccion({ institucion: 'Laboratorio Central', especialidad: 'Clínica médica', medico: 'Dr. Pérez' }),
    )
    expect(resultado.titulo).toBe('Análisis de laboratorio — Laboratorio Central')
    expect(resultado.origen).toBe('compuesto')
    expect(resultado.detectado).toBe(false)
  })

  it('usa la especialidad si no hay institución', () => {
    const resultado = sugerirTitulo(extraccion({ especialidad: 'Cardiología', categoria: 'consultation' }))
    expect(resultado.titulo).toBe('Consulta — Cardiología')
    expect(resultado.origen).toBe('compuesto')
    expect(resultado.detectado).toBe(false)
  })

  it('usa el médico si no hay institución ni especialidad', () => {
    const resultado = sugerirTitulo(extraccion({ medico: 'Dra. Gómez', categoria: 'prescription' }))
    expect(resultado.titulo).toBe('Receta — Dra. Gómez')
    expect(resultado.origen).toBe('compuesto')
    expect(resultado.detectado).toBe(false)
  })

  it('cae a la etiqueta genérica de la categoría cuando no hay ningún dato de contexto', () => {
    const resultado = sugerirTitulo(extraccion({ categoria: 'imaging' }))
    expect(resultado.titulo).toBe('Estudio por imágenes')
    expect(resultado.origen).toBe('categoria')
    expect(resultado.detectado).toBe(false)
  })

  it('trata strings de solo espacios como ausentes, también en el título del modelo', () => {
    const resultado = sugerirTitulo(
      extraccion({ titulo: '   ', institucion: '   ', especialidad: '  ', medico: '  ', categoria: 'other' }),
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

describe('tituloYaUsado — el aviso de título repetido en la revisión', () => {
  it('reconoce el mismo título aunque cambien tildes, mayúsculas y puntuación', () => {
    expect(normalizarTituloParaCotejo('Ecografía Abdominal.')).toBe('ecografia abdominal')
    expect(tituloYaUsado('Ecografía Abdominal.', ['ecografia abdominal'])).toBe(true)
  })

  it('no marca como repetido un título distinto', () => {
    expect(tituloYaUsado('Radiografía de tórax', ['Ecografía abdominal'])).toBe(false)
  })

  it('un título vacío nunca cuenta como repetido', () => {
    expect(tituloYaUsado('', ['Ecografía abdominal', ''])).toBe(false)
    expect(tituloYaUsado('   ', [''])).toBe(false)
  })

  it('sin historial no hay nada que avisar', () => {
    expect(tituloYaUsado('Ecografía abdominal', [])).toBe(false)
  })
})
