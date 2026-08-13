/**
 * Tests unitarios de `lib/medicacion/formato-toma.ts` (Sprint 7, tarea 7.3).
 *
 *   npm run test -- formato-toma
 */

import { describe, it, expect } from 'vitest'
import { formatearHoraToma, textoEstadoToma } from '@/lib/medicacion/formato-toma'

describe('lib/medicacion/formato-toma.ts', () => {
  describe('formatearHoraToma', () => {
    it('formatea un instante UTC como hora de pared de Ushuaia (UTC-3)', () => {
      // 11:00 UTC == 08:00 en Ushuaia.
      expect(formatearHoraToma('2026-08-13T11:00:00.000Z')).toBe('08:00')
    })

    it('cruza la medianoche local correctamente', () => {
      // 23:30 UTC == 20:30 en Ushuaia, mismo día calendario local.
      expect(formatearHoraToma('2026-08-13T23:30:00.000Z')).toBe('20:30')
      // 02:15 UTC == 23:15 del día anterior en Ushuaia.
      expect(formatearHoraToma('2026-08-14T02:15:00.000Z')).toBe('23:15')
    })
  })

  describe('textoEstadoToma', () => {
    it('pending devuelve "Pendiente"', () => {
      expect(textoEstadoToma('pending', null)).toBe('Pendiente')
    })

    it('taken con taken_at incluye la hora formateada', () => {
      expect(textoEstadoToma('taken', '2026-08-13T11:05:00.000Z')).toBe('Tomada a las 08:05')
    })

    it('taken sin taken_at (dato inconsistente) no revienta', () => {
      expect(textoEstadoToma('taken', null)).toBe('Tomada')
    })

    it('skipped devuelve "No tomada"', () => {
      expect(textoEstadoToma('skipped', null)).toBe('No tomada')
    })

    it('missed devuelve "No registrada"', () => {
      expect(textoEstadoToma('missed', null)).toBe('No registrada')
    })
  })
})
