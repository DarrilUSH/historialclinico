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
import { caso } from '@/tests/fixtures/documentos-sinteticos/casos'

/**
 * La extracción de un caso del banco sintético, SIN el campo `paciente`.
 *
 * `paciente` solo existe en el schema del camino automático
 * (`schemaExtraccionDocumentoConPaciente`); el schema de siempre es `.strict()`
 * y lo rechazaría como campo de más, que es exactamente lo que tiene que hacer.
 */
function extraccionSinPaciente(id: string): Record<string, unknown> {
  const copia = { ...caso(id).extraccion }
  delete copia.paciente
  return copia
}

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

  it('RECORTA a 50 métricas en vez de tirar el documento entero', () => {
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
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.metricas).toHaveLength(50)
      // Se queda con las PRIMERAS, no con una selección arbitraria.
      expect(resultado.datos.metricas[0].nombre).toBe('Métrica 1')
      expect(resultado.datos.metricas[49].nombre).toBe('Métrica 50')
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Caso 10: texto_completo excesivamente largo
  // ─────────────────────────────────────────────────────────────────────────

  it('RECORTA texto_completo mayor a 500 caracteres en vez de rechazar', () => {
    const textoExcesivo = 'a'.repeat(501)
    const conTextoBad = {
      ...ejemploValido,
      texto_completo: textoExcesivo,
    }
    const resultado = validarExtraccion(conTextoBad)
    expect(resultado.ok).toBe(true)
    if (resultado.ok) {
      expect(resultado.datos.texto_completo).toHaveLength(500)
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

  // ─────────────────────────────────────────────────────────────────────────
  // SPRINT 18 — un campo descriptivo largo de más NUNCA tira el documento
  //
  // Los dos casos son REALES, medidos sobre los 47 documentos que el dueño
  // cargó de verdad, pero se reproducen acá con el banco SINTÉTICO
  // (`tests/fixtures/documentos-sinteticos/`): instituciones ficticias de
  // otras provincias, otros rótulos, otros formatos. Si la regla fuera un
  // ajuste al formato de una clínica puntual, acá se caería.
  // ─────────────────────────────────────────────────────────────────────────

  describe('Sprint 18 — recortar en vez de perder el documento', () => {
    it('EL CASO REAL DEL RANGO — 116 caracteres contra un tope de 100: se recorta y las métricas entran TODAS', () => {
      const extraccion = extraccionSinPaciente('12-laboratorio-rango-en-tres-renglones')
      const metricas = extraccion.metricas as { nombre: string; rango: string }[]
      const tsh = metricas.find((metrica) => metrica.nombre.includes('TSH'))

      // El fixture tiene que seguir midiendo 116: es el número que hizo caer
      // la extracción de 38 métricas del laboratorio más completo del
      // historial. Si alguien lo "arregla", este test avisa.
      expect(tsh?.rango).toHaveLength(116)

      const resultado = validarExtraccion(extraccion)
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        // Ninguna métrica se perdió por culpa del rango largo.
        expect(resultado.datos.metricas).toHaveLength(metricas.length)
        const tshValidada = resultado.datos.metricas.find((metrica) =>
          metrica.nombre.includes('TSH'),
        )
        expect(tshValidada?.rango).toHaveLength(100)
        // El rango se recortó; el VALOR clínico llegó intacto.
        expect(tshValidada?.valor).toBe(
          (metricas as unknown as { nombre: string; valor: number }[]).find((metrica) =>
            metrica.nombre.includes('TSH'),
          )?.valor,
        )
      }
    })

    it('EL CASO REAL DEL TEXTO — 507 caracteres contra un tope de 500: se recorta y el documento entra', () => {
      const extraccion = extraccionSinPaciente('13-consulta-texto-completo-507')

      // Siete caracteres de más tiraban TRES extracciones completas.
      expect(extraccion.texto_completo as string).toHaveLength(507)

      const resultado = validarExtraccion(extraccion)
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.texto_completo).toHaveLength(500)
        // Y lo importante: el documento llegó entero.
        expect(resultado.datos.fecha).toBe(extraccion.fecha)
        expect(resultado.datos.categoria).toBe(extraccion.categoria)
      }
    })

    it('recorta especialidad, institución, médico, resumen, nombre y unidad — ninguno rechaza', () => {
      const largo = (n: number) => 'x'.repeat(n)
      const resultado = validarExtraccion({
        ...ejemploValido,
        especialidad: largo(300),
        institucion: largo(400),
        medico: largo(300),
        resumen: largo(900),
        metricas: [{ nombre: largo(250), valor: 1, unidad: largo(120), rango: largo(400) }],
      })

      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.especialidad).toHaveLength(100)
        expect(resultado.datos.institucion).toHaveLength(150)
        expect(resultado.datos.medico).toHaveLength(100)
        expect(resultado.datos.resumen).toHaveLength(500)
        expect(resultado.datos.metricas[0].nombre).toHaveLength(100)
        expect(resultado.datos.metricas[0].unidad).toHaveLength(50)
        expect(resultado.datos.metricas[0].rango).toHaveLength(100)
      }
    })

    it('lo que está justo en el tope no se toca', () => {
      const resultado = validarExtraccion({
        ...ejemploValido,
        texto_completo: 'y'.repeat(500),
        especialidad: 'z'.repeat(100),
      })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.texto_completo).toHaveLength(500)
        expect(resultado.datos.especialidad).toHaveLength(100)
      }
    })

    it('LOS CAMPOS DE IDENTIDAD SIGUEN RECHAZANDO — nunca se recorta una fecha, una categoría ni un valor', () => {
      // Una fecha recortada sería una fecha INVENTADA, y el detector de
      // duplicados la usa como condición necesaria.
      expect(validarExtraccion({ ...ejemploValido, fecha: '2026-03-155' }).ok).toBe(false)
      expect(validarExtraccion({ ...ejemploValido, fecha: '2026-02-30' }).ok).toBe(false)
      // Una categoría fuera del enum no se puede "recortar" a una válida sin
      // elegir por el modelo.
      expect(validarExtraccion({ ...ejemploValido, categoria: 'radiologia' }).ok).toBe(false)
      // Un valor clínico no numérico es un dato falso, no un dato largo.
      expect(
        validarExtraccion({
          ...ejemploValido,
          metricas: [{ nombre: 'Glucemia', valor: 'noventa y cinco', unidad: 'mg/dl', rango: '' }],
        }).ok,
      ).toBe(false)
      // Vacíos que siguen siendo un rechazo.
      expect(validarExtraccion({ ...ejemploValido, resumen: '   ' }).ok).toBe(false)
      expect(
        validarExtraccion({
          ...ejemploValido,
          metricas: [{ nombre: '  ', valor: 1, unidad: 'mg/dl', rango: '' }],
        }).ok,
      ).toBe(false)
    })

    it('el banco sintético entero valida: 16 documentos de 16 instituciones ficticias distintas, ninguno se pierde', () => {
      for (const id of [
        '01-bioquimico-del-sur-protocolo',
        '02-centro-vega-orden-alfanumerica',
        '03-hospital-zonal-solicitud',
        '04-imagenes-vega-registro-dos-medicos',
        '05-radiografia-accesion-dicom',
        '06-columna-lumbar-frente',
        '07-columna-lumbar-perfil',
        '08-guardia-numero-de-internacion',
        '09-ecografia-codigo-de-equipo',
        '10-informe-sin-numero-de-orden',
        '11-laboratorio-dos-fechas-contradictorias',
        '12-laboratorio-rango-en-tres-renglones',
        '13-consulta-texto-completo-507',
        '14-laboratorio-apellido-truncado',
        '15-informe-paciente-codigo-interno',
        '16-radiografia-dni-mal-leido',
      ]) {
        const resultado = validarExtraccion(extraccionSinPaciente(id))
        expect(resultado.ok, `${id} no debería perderse`).toBe(true)
      }
    })

    it('el número de orden se SANEA al validar: la accesión DICOM no llega a la Capa 2', () => {
      const resultado = validarExtraccion(extraccionSinPaciente('05-radiografia-accesion-dicom'))
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.numero_orden).toBeUndefined()
      }
    })

    it('el número de orden acreditado por su rótulo SÍ llega a la Capa 2', () => {
      const resultado = validarExtraccion(
        extraccionSinPaciente('01-bioquimico-del-sur-protocolo'),
      )
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.numero_orden).toBe('24601')
      }
    })

    it('un número de orden larguísimo tampoco tira el documento: se descarta el número, no la extracción', () => {
      const resultado = validarExtraccion({ ...ejemploValido, numero_orden: 'N'.repeat(200) })
      expect(resultado.ok).toBe(true)
      if (resultado.ok) {
        expect(resultado.datos.numero_orden).toBeUndefined()
      }
    })
  })
})
