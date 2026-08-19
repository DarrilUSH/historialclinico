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

import { limpiarSufijoMetodo, normalizarMetrica, normalizarTexto } from '@/lib/laboratorio/diccionario'
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

    // Sprint 18 — recorte de método pegado al nombre (causa #1 de la
    // cobertura baja original: 38/257, 15%). Los cuatro ejemplos son
    // literales del historial real que motivó el sprint.
    it('recorta el método pegado con "- Método ..." (ejemplos reales del Sprint 18)', () => {
      expect(normalizarMetrica('Glucemia - Método Glucosa-oxidasa').canonico).toBe('Glucosa')
      expect(normalizarMetrica('TSH - Meia Ultrasensible - Método CMIA').canonico).toBe('TSH')
      expect(normalizarMetrica('PSA total - Método CMIA').canonico).toBe('PSA')
      expect(normalizarMetrica('Colesterol total - Método enzimático').canonico).toBe(
        'Colesterol total',
      )
    })

    it('recorta un paréntesis con "método" en cualquier posición', () => {
      expect(normalizarMetrica('Colesterol total (método enzimático)').canonico).toBe(
        'Colesterol total',
      )
    })

    it('recorta " por <técnica>" al final', () => {
      expect(normalizarMetrica('Urea por método ureasa').canonico).toBe('Urea')
    })

    it('recorta un paréntesis al final aunque no diga "método" (sigla, aclaración)', () => {
      expect(normalizarMetrica('Hemoglobina A1c (HbA1c)').canonico).toBe('Hemoglobina glicosilada')
      expect(normalizarMetrica('Sodio (ionograma)').canonico).toBe('Sodio')
      expect(normalizarMetrica('P.C.R. (Proteína C Reactiva)').canonico).toBe('Proteína C reactiva')
    })

    it('encadena paréntesis final + técnica tras guion, en cualquier orden', () => {
      // El paréntesis queda "al final" recién después de sacar la técnica
      // tras el guion -ver el comentario de `limpiarSufijoMetodo`-.
      expect(normalizarMetrica('Hemoglobina A1c (HbA1c) - HPLC').canonico).toBe(
        'Hemoglobina glicosilada',
      )
    })

    it('NO recorta un guion sin espacios alrededor (nombre legítimo, no método)', () => {
      // "HDL-Colesterol" es un nombre real, no "HDL" + método "Colesterol".
      expect(normalizarMetrica('HDL-Colesterol').canonico).toBe('Colesterol HDL')
      expect(limpiarSufijoMetodo('17-OH-Progesterona')).toBe('17-OH-Progesterona')
    })

    it('reconoce siglas con puntos como las mismas siglas sin puntos', () => {
      expect(normalizarMetrica('P.C.R.').canonico).toBe('Proteína C reactiva')
      expect(normalizarMetrica('T.S.H.').canonico).toBe('TSH')
    })

    it('reconoce los sinónimos nuevos pedidos por el roadmap del Sprint 18', () => {
      expect(normalizarMetrica('Uremia').canonico).toBe('Urea')
      expect(normalizarMetrica('Creatinina en sangre').canonico).toBe('Creatinina')
      expect(normalizarMetrica('Recuento de plaquetas').canonico).toBe('Plaquetas')
      expect(normalizarMetrica('HDL-Colesterol').canonico).toBe('Colesterol HDL')
      expect(normalizarMetrica('Colesterol HDL').canonico).toBe('Colesterol HDL')
      expect(normalizarMetrica('GOT/AST').canonico).toBe('TGO/AST')
      expect(normalizarMetrica('GPT/ALT').canonico).toBe('TGP/ALT')
      expect(normalizarMetrica('Eritrosedimentación').canonico).toBe('Eritrosedimentación')
      expect(normalizarMetrica('VES').canonico).toBe('Eritrosedimentación')
      expect(normalizarMetrica('VSG').canonico).toBe('Eritrosedimentación')
    })

    it('reconoce los dieciséis canónicos NUEVOS del Sprint 18, con y sin método pegado', () => {
      expect(normalizarMetrica('PCR - Método turbidimetría').canonico).toBe('Proteína C reactiva')
      expect(normalizarMetrica('TGO - Método cinético UV').canonico).toBe('TGO/AST')
      expect(normalizarMetrica('TGP - Método cinético UV').canonico).toBe('TGP/ALT')
      expect(normalizarMetrica('FAL - Método cinético').canonico).toBe('Fosfatasa alcalina')
      expect(normalizarMetrica('GGT').canonico).toBe('GGT')
      expect(normalizarMetrica('Bilirrubina total').canonico).toBe('Bilirrubina total')
      expect(normalizarMetrica('Bilirrubina directa').canonico).toBe('Bilirrubina directa')
      expect(normalizarMetrica('Bilirrubina indirecta').canonico).toBe('Bilirrubina indirecta')
      expect(normalizarMetrica('Sodio - Método potenciometría indirecta').canonico).toBe('Sodio')
      expect(normalizarMetrica('Potasio').canonico).toBe('Potasio')
      expect(normalizarMetrica('Cloro').canonico).toBe('Cloro')
      expect(normalizarMetrica('PSA - Método CMIA').canonico).toBe('PSA')
      expect(normalizarMetrica('Vitamina D - Método CMIA').canonico).toBe('Vitamina D')
      expect(normalizarMetrica('25-OH Vitamina D').canonico).toBe('Vitamina D')
      expect(normalizarMetrica('Vitamina B12').canonico).toBe('Vitamina B12')
      expect(normalizarMetrica('Hierro sérico').canonico).toBe('Ferremia')
      expect(normalizarMetrica('Procalcitonina').canonico).toBe('Procalcitonina')
      expect(normalizarMetrica('LDH').canonico).toBe('LDH')
      expect(normalizarMetrica('Amilasa').canonico).toBe('Amilasa')
    })
  })

  /* ------------------------------------------------------------------ *
   *  SPRINT 19 — hemograma completo (70% de las fallas medidas sobre el
   *  corpus real: 30 de 43) + casi-aciertos + tolerancia a UNA errata.
   * ------------------------------------------------------------------ */

  describe('Sprint 19 — hemograma completo y fórmula leucocitaria', () => {
    it('reconoce Hematíes por sus variantes argentinas (Hematíes/Eritrocitos/Glóbulos rojos)', () => {
      expect(normalizarMetrica('Hematíes').canonico).toBe('Hematíes')
      expect(normalizarMetrica('Eritrocitos').canonico).toBe('Hematíes')
      expect(normalizarMetrica('Glóbulos rojos').canonico).toBe('Hematíes')
      expect(normalizarMetrica('Recuento de eritrocitos').canonico).toBe('Hematíes')
      expect(normalizarMetrica('GR').canonico).toBe('Hematíes')
      expect(normalizarMetrica('RBC').canonico).toBe('Hematíes')
    })

    it('reconoce los cuatro índices hematimétricos (VCM, HCM, CHCM, RDW) y sus siglas en inglés', () => {
      expect(normalizarMetrica('VCM').canonico).toBe('VCM')
      expect(normalizarMetrica('Volumen Corpuscular Medio').canonico).toBe('VCM')
      expect(normalizarMetrica('MCV').canonico).toBe('VCM')
      expect(normalizarMetrica('HCM').canonico).toBe('HCM')
      expect(normalizarMetrica('Hemoglobina Corpuscular Media').canonico).toBe('HCM')
      expect(normalizarMetrica('MCH').canonico).toBe('HCM')
      expect(normalizarMetrica('CHCM').canonico).toBe('CHCM')
      expect(normalizarMetrica('Concentración de Hemoglobina Corpuscular Media').canonico).toBe('CHCM')
      expect(normalizarMetrica('MCHC').canonico).toBe('CHCM')
      expect(normalizarMetrica('RDW').canonico).toBe('RDW')
      expect(normalizarMetrica('RDW-CV').canonico).toBe('RDW')
      expect(normalizarMetrica('Ancho de Distribución Eritrocitaria').canonico).toBe('RDW')
    })

    it('reconoce la fórmula leucocitaria completa (Neutrófilos, Basófilos, Eosinófilos, Linfocitos, Monocitos)', () => {
      expect(normalizarMetrica('Neutrófilos segmentados').canonico).toBe('Neutrófilos segmentados')
      expect(normalizarMetrica('Neutrófilos').canonico).toBe('Neutrófilos segmentados')
      expect(normalizarMetrica('Segmentados').canonico).toBe('Neutrófilos segmentados')
      expect(normalizarMetrica('Basófilos').canonico).toBe('Basófilos')
      expect(normalizarMetrica('Eosinófilos').canonico).toBe('Eosinófilos')
      expect(normalizarMetrica('Linfocitos').canonico).toBe('Linfocitos')
      expect(normalizarMetrica('Monocitos').canonico).toBe('Monocitos')
    })

    it('reconoce Leucocitos y Plaquetas por las variantes argentinas pedidas ("Recuento de blancos", "Recuento plaquetario")', () => {
      expect(normalizarMetrica('Recuento de blancos').canonico).toBe('Leucocitos')
      expect(normalizarMetrica('Leucocitos').canonico).toBe('Leucocitos')
      expect(normalizarMetrica('Recuento plaquetario').canonico).toBe('Plaquetas')
      expect(normalizarMetrica('Plaquetas').canonico).toBe('Plaquetas')
    })

    it('el hemograma completo, junta: las diez métricas de un panel real canonizan todas', () => {
      const panel = [
        'Hematíes',
        'Hemoglobina',
        'Hematocrito',
        'VCM',
        'HCM',
        'CHCM',
        'RDW',
        'Leucocitos',
        'Neutrófilos segmentados',
        'Basófilos',
        'Eosinófilos',
        'Linfocitos',
        'Monocitos',
        'Plaquetas',
      ]
      for (const nombre of panel) {
        expect(normalizarMetrica(nombre).canonico, `"${nombre}" debería canonizar`).not.toBeNull()
      }
    })

    it('CASI-ACIERTOS medidos: una línea de sinónimo arregla cada uno', () => {
      expect(normalizarMetrica('Gamma Glutamil Transpeptidasa').canonico).toBe('GGT')
      expect(normalizarMetrica('Bilirrubina Conjugada').canonico).toBe('Bilirrubina directa')
      expect(normalizarMetrica('Bilirrubina No Conjugada').canonico).toBe('Bilirrubina indirecta')
      expect(normalizarMetrica('Vitamina D 25 hidroxi (Vit D3)').canonico).toBe('Vitamina D')
      expect(normalizarMetrica('T4 libre').canonico).toBe('T4 libre')
      expect(normalizarMetrica('T3 total').canonico).toBe('T3 total')
      expect(normalizarMetrica('Insulina').canonico).toBe('Insulina')
    })

    it('ERRATA REAL DEL DUEÑO — "Proteía C Reactiva Cuantitativa" (falta la "n" de Proteína, así impreso en el PDF) canoniza por tolerancia a UNA errata', () => {
      expect(normalizarMetrica('Proteía C Reactiva Cuantitativa').canonico).toBe('Proteína C reactiva')
      // La forma bien escrita, control: tiene que funcionar igual (matchea directo, sin pasar por la tolerancia).
      expect(normalizarMetrica('Proteína C Reactiva Cuantitativa').canonico).toBe('Proteína C reactiva')
    })

    describe('tolerancia a errata — guardas de seguridad', () => {
      it('nombres CORTOS no entran a la tolerancia: no confunde T3 con T4', () => {
        // "T3" y "T4" están a distancia de edición 1 entre sí (una sola
        // letra), pero los dos son demasiado cortos para pasar la guarda de
        // largo mínimo (`LARGO_MINIMO_TOLERANCIA_ERRATA`): cada uno resuelve
        // SOLO por matcheo exacto, nunca por parecido con el otro. "T4" a
        // secas no tiene sinónimo propio -deliberado: sin calificar,
        // "T4" casi siempre se lee como Total, no Libre, y no se agregó esa
        // suposición- así que da `null`, y el punto es justo ese: NUNCA cae
        // en "T3 total" por parecido de una letra.
        expect(normalizarMetrica('T3').canonico).toBe('T3 total')
        expect(normalizarMetrica('T4').canonico).toBeNull()
        expect(normalizarMetrica('T4').canonico).not.toBe('T3 total')
        expect(normalizarMetrica('T4 libre').canonico).toBe('T4 libre')
        expect(normalizarMetrica('T4 libre').canonico).not.toBe('T3 total')
      })

      it('nombres CORTOS no entran a la tolerancia: no confunde LDL con HDL', () => {
        expect(normalizarMetrica('LDL').canonico).toBe('Colesterol LDL')
        expect(normalizarMetrica('HDL').canonico).toBe('Colesterol HDL')
        expect(normalizarMetrica('LDL').canonico).not.toBe(normalizarMetrica('HDL').canonico)
      })

      it('nombres CORTOS no entran a la tolerancia: no confunde TGO con TGP', () => {
        expect(normalizarMetrica('TGO').canonico).toBe('TGO/AST')
        expect(normalizarMetrica('TGP').canonico).toBe('TGP/ALT')
        expect(normalizarMetrica('TGO').canonico).not.toBe(normalizarMetrica('TGP').canonico)
      })

      it('una métrica realmente desconocida (sin sinónimo cercano) sigue devolviendo null, no adivina', () => {
        expect(normalizarMetrica('Ácido úrico').canonico).toBeNull()
        expect(normalizarMetrica('Ferritina').canonico).toBeNull()
        expect(normalizarMetrica('Magnesio serico total en sangre venosa').canonico).toBeNull()
      })

      it('dos erratas de una sola letra sobre nombres largos NO confunde pares peligrosos de nombre largo', () => {
        // "Colesterol ldl" y "Colesterol hdl" están a distancia de edición 1
        // ENTRE SÍ, pero cada uno ya matchea EXACTO por su propia entrada del
        // diccionario -la tolerancia a errata es el tercer intento, nunca se
        // llega a necesitar acá-.
        expect(normalizarMetrica('Colesterol ldl').canonico).toBe('Colesterol LDL')
        expect(normalizarMetrica('Colesterol hdl').canonico).toBe('Colesterol HDL')
      })
    })
  })

  describe('limpiarSufijoMetodo', () => {
    it('es idempotente: aplicarla dos veces da el mismo resultado que una', () => {
      const nombre = 'TSH - Meia Ultrasensible - Método CMIA'
      const unaVez = limpiarSufijoMetodo(nombre)
      expect(limpiarSufijoMetodo(unaVez)).toBe(unaVez)
    })

    it('no toca un nombre que ya viene limpio', () => {
      expect(limpiarSufijoMetodo('Glucosa')).toBe('Glucosa')
      expect(limpiarSufijoMetodo('Colesterol total')).toBe('Colesterol total')
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

    // Sprint 18 — formas reales que traen los laboratorios argentinos y que
    // el parser original (32%, 81/257) no entendía.
    it('parsea un techo en palabras: "menor a"/"menor de"', () => {
      expect(parsearRangoReferencia('Menor a 45 UI/L')).toMatchObject({
        reference_min: null,
        reference_max: 45,
      })
      expect(parsearRangoReferencia('menor de 200')).toMatchObject({
        reference_min: null,
        reference_max: 200,
      })
    })

    it('parsea un piso en palabras: "mayor a"/"mayor de"', () => {
      expect(parsearRangoReferencia('Mayor a 40')).toMatchObject({ reference_min: 40, reference_max: null })
    })

    it('parsea "hasta" con coma decimal', () => {
      expect(parsearRangoReferencia('hasta 4,00')).toMatchObject({ reference_min: null, reference_max: 4 })
    })

    it('ignora una palabra cualitativa suelta antes del umbral ("Negativo < 5.0")', () => {
      expect(parsearRangoReferencia('Negativo < 5.0')).toMatchObject({
        reference_min: null,
        reference_max: 5,
      })
    })

    it('quita un prefijo de etiqueta cualitativa con dos puntos', () => {
      expect(parsearRangoReferencia('Valor óptimo: menor a 100')).toMatchObject({
        reference_min: null,
        reference_max: 100,
      })
      expect(parsearRangoReferencia('Deseable: menor de 200')).toMatchObject({
        reference_min: null,
        reference_max: 200,
      })
    })

    it('parsea un intervalo en palabras "de X a Y" con coma decimal', () => {
      expect(parsearRangoReferencia('de 13,5 a 17,0')).toMatchObject({
        reference_min: 13.5,
        reference_max: 17,
      })
    })

    it('un intervalo con guion y coma decimal ya andaba, sigue andando', () => {
      expect(parsearRangoReferencia('41,0 - 52,0 %')).toMatchObject({ reference_min: 41, reference_max: 52 })
    })

    it('rango multilínea con etiquetas: usa el segmento de NORMALIDAD y descarta el resto', () => {
      const texto =
        'Deficiencia: menor a 10.0 / Insuficiencia: menor a 30.0 / Suficiencia: de 30.00 a 100.0'
      const resultado = parsearRangoReferencia(texto)
      expect(resultado.reference_min).toBe(30)
      expect(resultado.reference_max).toBe(100)
      // El texto ORIGINAL completo se conserva para mostrarlo en pantalla,
      // no solo el segmento "Suficiencia".
      expect(resultado.reference_range).toBe(texto)
    })

    it('rango multilínea sin etiqueta de normalidad reconocible: prueba desde el último segmento', () => {
      const resultado = parsearRangoReferencia('Bajo: menor a 10 / Alto: mayor a 50')
      // Ningún segmento dice "normal"/"suficiencia"/"deseable"/etc.: se
      // prueba de atrás para adelante y el ÚLTIMO que parsea gana.
      expect(resultado).toMatchObject({ reference_min: 50, reference_max: null })
    })

    it('salto de línea real también separa segmentos (no solo " / ")', () => {
      const resultado = parsearRangoReferencia('Deficiencia: menor a 10.0\nSuficiencia: de 30.0 a 100.0')
      expect(resultado).toMatchObject({ reference_min: 30, reference_max: 100 })
    })

    it('"insuficiencia" no matchea la palabra clave "suficiencia" (límite de palabra)', () => {
      // Si matcheara por substring, "Insuficiencia: menor a 30.0" y
      // "Suficiencia: de 30 a 100" empatarían como "ambiguo" en vez de
      // elegir el segundo sin ambigüedad.
      const resultado = parsearRangoReferencia(
        'Insuficiencia: menor a 30.0 / Suficiencia: de 30.0 a 100.0',
      )
      expect(resultado).toMatchObject({ reference_min: 30, reference_max: 100 })
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

    // Sprint 18 — resultados CUALITATIVOS ("Strep A: Negativo", "No se
    // observan espermatozoides"): antes se descartaban en silencio por no
    // tener `valor` numérico.
    describe('resultados cualitativos (value_text)', () => {
      it('acepta una métrica SIN valor numérico pero CON valorTexto', () => {
        const { filas } = prepararMetricas(
          [{ nombre: 'Strep A', valorTexto: 'Negativo', unidad: '', rango: '' }],
          '2026-08-01',
        )
        expect(filas).toHaveLength(1)
        expect(filas[0]).toMatchObject({
          metric_name: 'Strep A',
          value: null,
          value_text: 'Negativo',
        })
      })

      it('recorta espacios de valorTexto y descarta un valorTexto vacío/solo-espacios', () => {
        const { filas } = prepararMetricas(
          [
            { nombre: 'HIV', valorTexto: '  No reactivo  ', unidad: '', rango: '' },
            { nombre: 'Sin nada', valorTexto: '   ', unidad: '', rango: '' },
          ],
          '2026-08-01',
        )
        expect(filas).toHaveLength(1)
        expect(filas[0].value_text).toBe('No reactivo')
      })

      it('descarta en silencio una métrica sin valor numérico NI valorTexto (mismo criterio que antes)', () => {
        const { filas } = prepararMetricas(
          [{ nombre: 'Sin ningún valor', unidad: '', rango: '' }],
          '2026-08-01',
        )
        expect(filas).toHaveLength(0)
      })

      it('un resultado cualitativo también resuelve nombre canónico, rango y deduplica', () => {
        const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const { filas, duplicadas } = prepararMetricas(
          [
            { nombre: 'VDRL', valorTexto: 'No reactivo', unidad: '', rango: '' },
            { nombre: 'VDRL', valorTexto: 'Repetido', unidad: '', rango: '' },
          ],
          '2026-08-01',
        )
        expect(filas).toHaveLength(1)
        expect(filas[0].value_text).toBe('No reactivo')
        expect(duplicadas).toHaveLength(1)

        avisos.mockRestore()
      })

      it('conserva value numérico Y value_text cuando las dos vienen juntas', () => {
        const { filas } = prepararMetricas(
          [{ nombre: 'Plaquetas', valor: 450000, valorTexto: 'Aumentadas', unidad: '/mm3', rango: '' }],
          '2026-08-01',
        )
        expect(filas[0]).toMatchObject({ value: 450000, value_text: 'Aumentadas' })
      })
    })
  })
})
