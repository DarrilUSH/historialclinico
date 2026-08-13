/**
 * Tests unitarios de `lib/validacion/confirmacion-documento.schema.ts`.
 *
 *   npm run test -- confirmacion-documento-schema
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  validarConfirmacionDocumento,
  validarDescarteDocumento,
} from '@/lib/validacion/confirmacion-documento.schema'

const DOC_ID = '11111111-1111-4111-8111-111111111111'

const base = {
  documentoId: DOC_ID,
  titulo: 'Análisis de sangre',
  categoria: 'laboratory',
  fecha: '2026-08-01',
  resumen: 'Todo normal.',
}

describe('lib/validacion/confirmacion-documento.schema.ts — confirmación', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('acepta datos válidos completos', () => {
    const resultado = validarConfirmacionDocumento(base)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.titulo).toBe('Análisis de sangre')
      expect(resultado.datos.categoria).toBe('laboratory')
      expect(resultado.datos.resumen).toBe('Todo normal.')
    }
  })

  it('acepta resumen vacío u omitido (se transforma a undefined)', () => {
    const resultado = validarConfirmacionDocumento({ ...base, resumen: '   ' })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.resumen).toBeUndefined()
    }
  })

  it('rechaza documentoId que no es uuid', () => {
    const resultado = validarConfirmacionDocumento({ ...base, documentoId: 'no-es-uuid' })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza título vacío', () => {
    const resultado = validarConfirmacionDocumento({ ...base, titulo: '   ' })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza título de más de 200 caracteres', () => {
    const resultado = validarConfirmacionDocumento({ ...base, titulo: 'a'.repeat(201) })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza categoría fuera del enum', () => {
    const resultado = validarConfirmacionDocumento({ ...base, categoria: 'inventada' })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza fecha con formato incorrecto', () => {
    const resultado = validarConfirmacionDocumento({ ...base, fecha: '01/08/2026' })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza fecha inexistente (30 de febrero)', () => {
    const resultado = validarConfirmacionDocumento({ ...base, fecha: '2026-02-30' })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza fecha anterior o igual a 1900', () => {
    const resultado = validarConfirmacionDocumento({ ...base, fecha: '1900-06-15' })
    expect(resultado.ok).toBe(false)
  })

  it('acepta 1901-01-01 (justo después del límite)', () => {
    const resultado = validarConfirmacionDocumento({ ...base, fecha: '1901-01-01' })
    expect(resultado.ok).toBe(true)
  })

  it('rechaza fecha futura', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-12T15:00:00Z'))
    const resultado = validarConfirmacionDocumento({ ...base, fecha: '2026-08-13' })
    expect(resultado.ok).toBe(false)
  })

  it('acepta la fecha de hoy exacta, sin importar la hora del momento de validación', () => {
    vi.useFakeTimers()
    // Hora avanzada del día (23:59 UTC): el clásico bug de "no puede ser
    // futura" que rompe casi todo el día si se compara mal.
    vi.setSystemTime(new Date('2026-08-12T23:59:00Z'))
    const resultado = validarConfirmacionDocumento({ ...base, fecha: '2026-08-12' })
    expect(resultado.ok).toBe(true)
  })

  it('recorta espacios del título y el resumen', () => {
    const resultado = validarConfirmacionDocumento({
      ...base,
      titulo: '  Análisis  ',
      resumen: '  Todo bien  ',
    })
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.titulo).toBe('Análisis')
      expect(resultado.datos.resumen).toBe('Todo bien')
    }
  })
})

describe('lib/validacion/confirmacion-documento.schema.ts — descarte', () => {
  it('acepta un documentoId válido', () => {
    const resultado = validarDescarteDocumento({ documentoId: DOC_ID })
    expect(resultado.ok).toBe(true)
  })

  it('rechaza un documentoId inválido', () => {
    const resultado = validarDescarteDocumento({ documentoId: 'x' })
    expect(resultado.ok).toBe(false)
  })

  it('rechaza cuando falta documentoId', () => {
    const resultado = validarDescarteDocumento({})
    expect(resultado.ok).toBe(false)
  })
})
