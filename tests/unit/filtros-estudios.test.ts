/**
 * Tests unitarios de `lib/estudios/filtros.ts` (Sprint 5, tarea 5.2):
 * parseo/validación de los `searchParams` de filtro, saneo del texto de
 * búsqueda contra `ILIKE`/`.or()`, y el armado puro de query strings que
 * usan los chips removibles, "Limpiar todo" y el link "Ver más".
 *
 * Módulo isomórfico (sin `server-only`): estas funciones corren tanto en el
 * Client Component `filtros-estudios.tsx` como en los Server Components de
 * la galería, así que se testean sin ningún mock de Supabase ni de sesión
 * -las funciones que sí tocan la base viven aparte, en
 * `lib/estudios/consultas.ts`, marcado `server-only`-.
 *
 *   npm run test -- filtros-estudios
 */

import { describe, it, expect } from 'vitest'

import {
  aplicarCambiosUrlFiltros,
  contarFiltrosActivos,
  hayFiltrosActivos,
  limpiarUrlFiltros,
  parsearFiltrosEstudios,
  saneaTextoBusqueda,
  serializarFiltrosEstudios,
} from '@/lib/estudios/filtros'

describe('lib/estudios/consultas.ts', () => {
  describe('parsearFiltrosEstudios', () => {
    it('acepta una categoría válida del enum', () => {
      expect(parsearFiltrosEstudios({ categoria: 'laboratory' }).categoria).toBe('laboratory')
    })

    it('descarta una categoría que no existe en el enum, sin lanzar', () => {
      expect(parsearFiltrosEstudios({ categoria: 'cardiologia' }).categoria).toBeUndefined()
    })

    it('recorta espacios y el largo de la institución', () => {
      const filtros = parsearFiltrosEstudios({ institucion: '  Laboratorio Central Ushuaia  ' })
      expect(filtros.institucion).toBe('Laboratorio Central Ushuaia')

      const institucionLarga = 'x'.repeat(300)
      expect(parsearFiltrosEstudios({ institucion: institucionLarga }).institucion).toHaveLength(150)
    })

    it('trata una institución vacía o solo espacios como ausente', () => {
      expect(parsearFiltrosEstudios({ institucion: '   ' }).institucion).toBeUndefined()
    })

    it('acepta fechas ISO válidas para desde/hasta_fecha', () => {
      const filtros = parsearFiltrosEstudios({ desde: '2026-06-01', hasta_fecha: '2026-08-01' })
      expect(filtros.desde).toBe('2026-06-01')
      expect(filtros.hastaFecha).toBe('2026-08-01')
    })

    it('descarta una fecha con formato inválido', () => {
      expect(parsearFiltrosEstudios({ desde: '01/06/2026' }).desde).toBeUndefined()
    })

    it('descarta una fecha que no existe (30 de febrero)', () => {
      expect(parsearFiltrosEstudios({ desde: '2026-02-30' }).desde).toBeUndefined()
    })

    it('intercambia desde/hasta_fecha si llegan invertidos en vez de dar un rango vacío', () => {
      const filtros = parsearFiltrosEstudios({ desde: '2026-08-01', hasta_fecha: '2026-06-01' })
      expect(filtros.desde).toBe('2026-06-01')
      expect(filtros.hastaFecha).toBe('2026-08-01')
    })

    it('recorta el texto de búsqueda a 100 caracteres', () => {
      const largo = 'a'.repeat(150)
      expect(parsearFiltrosEstudios({ q: largo }).q).toHaveLength(100)
    })

    it('no confunde un searchParams vacío con filtros activos', () => {
      const filtros = parsearFiltrosEstudios({})
      expect(filtros).toEqual({
        categoria: undefined,
        institucion: undefined,
        desde: undefined,
        hastaFecha: undefined,
        q: undefined,
      })
    })
  })

  describe('hayFiltrosActivos / contarFiltrosActivos', () => {
    it('sin ningún filtro, devuelve false y 0', () => {
      const filtros = parsearFiltrosEstudios({})
      expect(hayFiltrosActivos(filtros)).toBe(false)
      expect(contarFiltrosActivos(filtros)).toBe(0)
    })

    it('cuenta cada filtro activo por separado (categoría + rango de fechas = 3)', () => {
      const filtros = parsearFiltrosEstudios({
        categoria: 'imaging',
        desde: '2026-01-01',
        hasta_fecha: '2026-12-31',
      })
      expect(hayFiltrosActivos(filtros)).toBe(true)
      expect(contarFiltrosActivos(filtros)).toBe(3)
    })

    it('con los cinco filtros activos, cuenta 5', () => {
      const filtros = parsearFiltrosEstudios({
        categoria: 'laboratory',
        institucion: 'Laboratorio Central Ushuaia',
        desde: '2026-01-01',
        hasta_fecha: '2026-12-31',
        q: 'glucemia',
      })
      expect(contarFiltrosActivos(filtros)).toBe(5)
    })
  })

  describe('saneaTextoBusqueda', () => {
    it('escapa % y _ para que ILIKE los busque literal, no como comodín', () => {
      expect(saneaTextoBusqueda('50%')).toBe('50\\%')
      expect(saneaTextoBusqueda('glucemia_basal')).toBe('glucemia\\_basal')
    })

    it('neutraliza comas y paréntesis para no romper el parseo de .or()', () => {
      expect(saneaTextoBusqueda('Hospital, Central')).toBe('Hospital  Central')
      expect(saneaTextoBusqueda('Dr. Pérez (cardiología)')).toBe('Dr. Pérez  cardiología ')
    })

    it('preserva tildes y ñ sin tocarlas', () => {
      expect(saneaTextoBusqueda('análisis de laboratorio')).toBe('análisis de laboratorio')
    })
  })

  describe('aplicarCambiosUrlFiltros', () => {
    it('agrega un filtro nuevo a un query string vacío', () => {
      expect(aplicarCambiosUrlFiltros('', { categoria: 'laboratory' })).toBe('categoria=laboratory')
    })

    it('borra una clave cuando el valor es null', () => {
      const resultado = aplicarCambiosUrlFiltros('categoria=laboratory&q=glucemia', { categoria: null })
      expect(new URLSearchParams(resultado).get('categoria')).toBeNull()
      expect(new URLSearchParams(resultado).get('q')).toBe('glucemia')
    })

    it('borra la paginación (?hasta=) ante cualquier cambio de filtro', () => {
      const resultado = aplicarCambiosUrlFiltros('hasta=45&categoria=laboratory', {
        institucion: 'Laboratorio Central Ushuaia',
      })
      expect(new URLSearchParams(resultado).get('hasta')).toBeNull()
    })

    it('preserva search params que no son parte del cambio', () => {
      const resultado = aplicarCambiosUrlFiltros('confirmado=1', { q: 'ecg' })
      const params = new URLSearchParams(resultado)
      expect(params.get('confirmado')).toBe('1')
      expect(params.get('q')).toBe('ecg')
    })
  })

  describe('limpiarUrlFiltros', () => {
    it('borra los cinco filtros y la paginación, preservando lo demás', () => {
      const resultado = limpiarUrlFiltros(
        'categoria=laboratory&institucion=x&desde=2026-01-01&hasta_fecha=2026-12-31&q=ecg&hasta=45&confirmado=1',
      )
      const params = new URLSearchParams(resultado)
      expect(params.get('categoria')).toBeNull()
      expect(params.get('institucion')).toBeNull()
      expect(params.get('desde')).toBeNull()
      expect(params.get('hasta_fecha')).toBeNull()
      expect(params.get('q')).toBeNull()
      expect(params.get('hasta')).toBeNull()
      expect(params.get('confirmado')).toBe('1')
    })

    it('sobre un query string vacío devuelve string vacío', () => {
      expect(limpiarUrlFiltros('')).toBe('')
    })
  })

  describe('serializarFiltrosEstudios', () => {
    it('serializa solo los filtros activos con los nombres exactos de la URL', () => {
      const filtros = parsearFiltrosEstudios({ categoria: 'imaging', hasta_fecha: '2026-08-01' })
      const query = serializarFiltrosEstudios(filtros)
      const params = new URLSearchParams(query)
      expect(params.get('categoria')).toBe('imaging')
      expect(params.get('hasta_fecha')).toBe('2026-08-01')
      expect(params.has('institucion')).toBe(false)
      expect(params.has('desde')).toBe(false)
      expect(params.has('q')).toBe(false)
    })

    it('agrega params extra (usado por "Ver más" para la paginación siguiente)', () => {
      const filtros = parsearFiltrosEstudios({ categoria: 'laboratory' })
      const query = serializarFiltrosEstudios(filtros, { hasta: '30' })
      const params = new URLSearchParams(query)
      expect(params.get('categoria')).toBe('laboratory')
      expect(params.get('hasta')).toBe('30')
    })
  })
})
