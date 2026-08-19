/**
 * Diccionario de sinónimos de laboratorio (Sprint 4, tarea 4.6).
 *
 * Un mismo análisis nombra la misma métrica de formas distintas según el
 * laboratorio que lo emitió ("Glucemia", "Glucosa en ayunas", "GLU"...). Sin
 * un nombre canónico, `lib/laboratorio/series.ts` (Sprint 5) no podría armar
 * UNA serie temporal por métrica: tendría tres series de un solo punto cada
 * una. Este módulo resuelve esa normalización — es puro, sin red ni
 * dependencias de Supabase, para poder testearlo sin mocks.
 *
 * El diccionario cubre las métricas de laboratorio argentino más comunes que
 * pide el roadmap. Una métrica que no matchea ningún sinónimo NO es un error:
 * `normalizarMetrica` devuelve `canonico: null` y quien la llama (
 * `lib/laboratorio/normalizacion.ts`) guarda igual el nombre original tal
 * como vino del estudio. Ampliar el diccionario más adelante no requiere
 * migrar datos: `metric_name` (el texto original) nunca se pierde.
 */

/**
 * Normaliza texto para comparar de forma tolerante a mayúsculas, tildes y
 * espacios repetidos: "Triglicéridos", "TRIGLICÉRIDOS" y "  triglicéridos  "
 * deben matchear la misma entrada del diccionario.
 *
 * `NFD` descompone cada letra acentuada en la letra base más su marca
 * diacrítica ("é" → "e" + U+0301), y el `replace` descarta esa marca
 * (rango Unicode U+0300–U+036F, "Combining Diacritical Marks"). Es el mismo
 * patrón que usan los slugifiers multibyte-aware en vez de un regex
 * byte-a-byte sobre UTF-8 (que rompería con ñ y vocales acentuadas).
 *
 * También saca los puntos de sigla ("P.C.R.", "T.S.H." → "pcr", "tsh"):
 * sumado en el Sprint 18 -otros laboratorios (no Clínica San Jorge, de ahí
 * que las siglas del diccionario original nunca lo necesitaron) puntúan las
 * siglas-. Sacar CUALQUIER punto es seguro acá porque esta función solo
 * normaliza NOMBRES de métrica para la clave de búsqueda, nunca un valor
 * numérico ni el texto que se muestra en pantalla: no hay separador decimal
 * que proteger.
 */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Nombre canónico → sinónimos tal como aparecen en estudios reales
 * (mayúsculas, minúsculas, abreviaturas). No hace falta listar variantes de
 * tildes/mayúsculas acá: `normalizarTexto` las unifica al construir el mapa.
 *
 * Ampliado en el Sprint 18 (tarea de normalización de nombres): el 15% de
 * cobertura original (38 de 257 métricas reales) tenía dos causas, no una
 * -ver `limpiarSufijoMetodo` más abajo para la primera-. Esta es la segunda:
 * faltaban sinónimos y canónicos ENTEROS que los laboratorios argentinos
 * imprimen todo el tiempo. Los trece originales (Sprint 4) quedan intactos;
 * lo nuevo son los sinónimos agregados a esas entradas y los canónicos desde
 * "TGO/AST" hacia abajo.
 */
const SINONIMOS_POR_CANONICO: Record<string, string[]> = {
  Glucosa: ['glucosa', 'glucemia', 'glucosa en ayunas', 'glucemia en ayunas', 'glu'],
  'Colesterol total': ['colesterol total', 'colesterol', 'ct', 'col total'],
  'Colesterol HDL': [
    'colesterol hdl',
    'hdl',
    'hdl colesterol',
    'hdl-colesterol',
    'colesterol-hdl',
    'hdl colesterol directo',
  ],
  'Colesterol LDL': [
    'colesterol ldl',
    'ldl',
    'ldl colesterol',
    'ldl-colesterol',
    'colesterol-ldl',
  ],
  Triglicéridos: ['trigliceridos', 'tg'],
  Hemoglobina: ['hemoglobina', 'hb', 'hgb'],
  Hematocrito: ['hematocrito', 'hto', 'hct'],
  Leucocitos: [
    'leucocitos',
    'globulos blancos',
    'gb',
    'wbc',
    'recuento de blancos',
    'recuento de globulos blancos',
    'recuento de leucocitos',
  ],
  Plaquetas: ['plaquetas', 'plt', 'recuento de plaquetas', 'recuento plaquetario'],

  // ── Hemograma completo (Sprint 19): el 70% de las fallas medidas sobre el
  // corpus real era ESTA familia entera -presente en todos los hemogramas,
  // o sea en casi todos los laboratorios de cualquier persona-. Sin nombre
  // canónico acá, Tendencias no puede armar la serie temporal de ninguna de
  // estas diez métricas. Sinónimos con las variantes que de verdad imprimen
  // los laboratorios argentinos (ver el pedido del sprint), más las siglas
  // en inglés (MCV/MCH/MCHC) que también aparecen en equipos importados.
  Hematíes: [
    'hematies',
    'eritrocitos',
    'globulos rojos',
    'recuento de hematies',
    'recuento de eritrocitos',
    'recuento de globulos rojos',
    'gr',
    'rbc',
  ],
  VCM: ['vcm', 'volumen corpuscular medio', 'mcv'],
  HCM: ['hcm', 'hemoglobina corpuscular media', 'mch'],
  CHCM: [
    'chcm',
    'concentracion de hemoglobina corpuscular media',
    'concentracion corpuscular media de hemoglobina',
    'mchc',
  ],
  RDW: [
    'rdw',
    'rdw-cv',
    'rdw cv',
    'ancho de distribucion eritrocitaria',
    'coeficiente de anisocitosis',
  ],

  // ── Fórmula leucocitaria (Sprint 19): mismo motivo que el hemograma de
  // arriba -son las cinco líneas que acompañan a todo recuento de blancos-.
  // "Neutrófilos segmentados" NO incluye a los "en cayado"/"en banda"
  // (abastonados): son una métrica DISTINTA del diferencial y fusionarlas
  // perdería la distinción clínica real entre las dos líneas.
  'Neutrófilos segmentados': [
    'neutrofilos segmentados',
    'neutrofilos',
    'segmentados',
    'neu',
    'neu%',
    'nse',
  ],
  Basófilos: ['basofilos', 'bas', 'baso'],
  Eosinófilos: ['eosinofilos', 'eos', 'eosino'],
  Linfocitos: ['linfocitos', 'linf', 'lymph', 'lym'],
  Monocitos: ['monocitos', 'mono'],

  Creatinina: ['creatinina', 'creatinina en sangre', 'creatinina serica', 'creatinina plasmatica'],
  Urea: ['urea', 'uremia', 'urea en sangre'],
  TSH: ['tsh', 'tirotrofina', 'hormona estimulante de la tiroides'],
  'Hemoglobina glicosilada': [
    'hemoglobina glicosilada',
    'hemoglobina glucosilada',
    'hba1c',
    'a1c',
    'hemoglobina a1c',
  ],

  // ── Nuevos (Sprint 18): faltaban enteros, pedidos explícitos del roadmap.
  'TGO/AST': [
    'tgo',
    'got',
    'ast',
    'tgo/ast',
    'got/ast',
    'tgo (ast)',
    'transaminasa glutamico oxalacetica',
    'aspartato aminotransferasa',
  ],
  'TGP/ALT': [
    'tgp',
    'gpt',
    'alt',
    'tgp/alt',
    'gpt/alt',
    'tgp (alt)',
    'transaminasa glutamico piruvica',
    'alanina aminotransferasa',
  ],
  'Fosfatasa alcalina': ['fal', 'falc', 'fosfatasa alcalina'],
  // Casi-acierto medido (Sprint 19): el diccionario solo tenía la variante
  // SIN espacios ("gammaglutamiltranspeptidasa"); "Gamma Glutamil
  // Transpeptidasa" -con espacios, y "transpeptidasa" y no "transferasa"- es
  // como la imprime el laboratorio real que motivó el sprint.
  GGT: [
    'ggt',
    'gamma gt',
    'gamma glutamil transferasa',
    'gamma glutamil transpeptidasa',
    'gammaglutamiltranspeptidasa',
  ],
  'Bilirrubina total': ['bilirrubina total', 'bt'],
  // "Conjugada"/"no conjugada" son sinónimos bioquímicos exactos de
  // "directa"/"indirecta" (casi-acierto medido, Sprint 19): mismo análisis,
  // otro nombre.
  'Bilirrubina directa': ['bilirrubina directa', 'bilirrubina conjugada', 'bd'],
  'Bilirrubina indirecta': ['bilirrubina indirecta', 'bilirrubina no conjugada', 'bi'],
  Sodio: ['sodio', 'na', 'natremia'],
  Potasio: ['potasio', 'k', 'kalemia'],
  Cloro: ['cloro', 'cl', 'cloremia'],
  Eritrosedimentación: [
    'eritrosedimentacion',
    'ves',
    'vsg',
    'velocidad de eritrosedimentacion',
    'velocidad de sedimentacion globular',
  ],
  PSA: ['psa', 'psa total', 'antigeno prostatico especifico'],
  'Vitamina D': [
    'vitamina d',
    '25 oh vitamina d',
    '25-oh vitamina d',
    'vitamina d total',
    '25-hidroxivitamina d',
    // Casi-acierto medido (Sprint 19): "Vitamina D 25 hidroxi (Vit D3)" tal
    // como lo imprime el laboratorio real -el "(Vit D3)" final ya lo saca
    // `limpiarSufijoMetodo` (paso 4, paréntesis al final), esto es lo que
    // queda después de esa limpieza.
    'vitamina d 25 hidroxi',
  ],
  'Vitamina B12': ['vitamina b12', 'vitamina b 12', 'b12'],
  Ferremia: ['ferremia', 'hierro serico', 'fe serico', 'hierro plasmatico'],
  Procalcitonina: ['procalcitonina', 'pct'],
  LDH: ['ldh', 'lactato deshidrogenasa', 'lacticodeshidrogenasa'],
  Amilasa: ['amilasa', 'amilasemia'],
  'Proteína C reactiva': [
    'pcr',
    'proteina c reactiva',
    'p.c.r.',
    // Casi-acierto medido (Sprint 19): el laboratorio real pide la variante
    // CUANTITATIVA, no la cualitativa -son dos técnicas distintas del mismo
    // análisis-. La errata real del documento ("Proteía", sin la "n") la
    // resuelve `buscarPorToleranciaErrata` a partir de ESTA entrada bien
    // escrita, no una entrada separada para el typo.
    'proteina c reactiva cuantitativa',
  ],

  // ── Nuevos (Sprint 19): pedidos explícitos, casi-aciertos medidos que
  // resultaron ser diccionario incompleto y no solo un sufijo mal recortado.
  'T4 libre': ['t4 libre', 'tiroxina libre', 'ft4', 't4l'],
  'T3 total': ['t3 total', 't3', 'triiodotironina total', 'triyodotironina total'],
  Insulina: ['insulina', 'insulinemia', 'insulina basal', 'insulina en ayunas'],
}

/**
 * Mapa `sinónimo normalizado → nombre canónico`, construido una sola vez al
 * cargar el módulo. Cada nombre canónico se agrega también como sinónimo de
 * sí mismo (normalizado), para que un estudio que ya trae el nombre canónico
 * ("Glucosa") matchee sin depender de que también figure en la lista.
 */
const DICCIONARIO: ReadonlyMap<string, string> = (() => {
  const mapa = new Map<string, string>()
  for (const [canonico, sinonimos] of Object.entries(SINONIMOS_POR_CANONICO)) {
    mapa.set(normalizarTexto(canonico), canonico)
    for (const sinonimo of sinonimos) {
      mapa.set(normalizarTexto(sinonimo), canonico)
    }
  }
  return mapa
})()

export interface ResultadoNormalizacionMetrica {
  /** Nombre canónico si el diccionario lo reconoce; `null` si es una métrica desconocida. */
  canonico: string | null
}

/**
 * Técnicas/métodos de laboratorio reconocidas, para el CUARTO paso de
 * `limpiarSufijoMetodo`. Lista abierta (Sprint 18): cada entrada es una
 * palabra que, cuando aparece SOLA como el segmento final después de un
 * " - ", identifica ese segmento como el MÉTODO del análisis y no como parte
 * del nombre -"TSH - Meia Ultrasensible" pierde "Meia Ultrasensible" porque
 * las dos palabras están acá, pero un nombre real con guion espaciado que no
 * matchee ninguna se conserva íntegro-. No hace falta que sea exhaustiva:
 * ampliarla es agregar una palabra, nunca migrar datos (mismo criterio que
 * el diccionario de sinónimos, ver el encabezado del archivo).
 */
const TECNICAS_DE_LABORATORIO =
  /\b(meia|cmia|elisa|eclia|ecl|ria|ifi|elfo|hplc|quimioluminiscencia|electroquimioluminiscencia|turbidimetria|inmunoturbidimetria|nefelometria|enzimatico|enzimatica|colorimetrico|colorimetrica|cinetico|cinetica|ultrasensible|inmunoensayo|aglutinacion|oxidasa|peroxidasa|espectrofotometria|potenciometria|potenciometrica|cromatografia|inmunofluorescencia|electroforesis|impedancia|impedanciometria|citometria|jaffe|westergren|directo|indirecto)\b/i

/**
 * Recorta el MÉTODO/TÉCNICA que un laboratorio imprime pegado al nombre de
 * la métrica -la causa principal de que el diccionario original solo
 * resolviera el 15% de un historial real (Sprint 18): "Glucemia - Método
 * Glucosa-oxidasa", "TSH - Meia Ultrasensible - Método CMIA", "PSA total -
 * Método CMIA", "Colesterol total - Método enzimático"-.
 *
 * General a propósito -NO ajustado al formato de un laboratorio puntual,
 * ver el principio rector del Sprint 18-: cinco pasos independientes, y
 * ninguno toca un guion SIN espacios alrededor ("17-OH-Progesterona",
 * "HDL-Colesterol") para no romper nombres legítimos que legítimamente usan
 * guion.
 *
 *   1. Paréntesis con "método", en cualquier posición: "Colesterol (método
 *      enzimático)".
 *   2. " - Método ..." hasta el final: "Glucemia - Método Glucosa-oxidasa".
 *   3. " por <técnica>" al final: "Urea por método ureasa".
 *   4. Paréntesis AL FINAL, sea cual sea su contenido: "Hemoglobina A1c
 *      (HbA1c)", "Sodio (ionograma)", "P.C.R. (Proteína C Reactiva)" -un
 *      laboratorio que aclara entre paréntesis al final casi siempre repite
 *      la sigla o una aclaración de método, nunca parte del nombre-.
 *   5. Segmento final tras " - " que sea una técnica CONOCIDA sin la palabra
 *      "método" explícita: "TSH - Meia Ultrasensible" (ver
 *      `TECNICAS_DE_LABORATORIO`).
 *
 * Los pasos 4 y 5 se repiten hasta que dejan de cambiar algo, porque pueden
 * venir encadenados: "Hemoglobina A1c (HbA1c) - HPLC" primero pierde el
 * segmento de técnica tras el guion (paso 5) y RECIÉN AHÍ el paréntesis
 * queda al final para que el paso 4 lo saque en la vuelta siguiente.
 *
 * Devuelve el nombre recortado para USAR COMO CLAVE DE BÚSQUEDA únicamente:
 * `metric_name` (el texto que se persiste y se muestra) nunca pasa por acá,
 * mismo criterio de "nunca perder el dato original" que el resto del
 * archivo.
 */
export function limpiarSufijoMetodo(nombre: string): string {
  let resultado = nombre

  // 1. Paréntesis con "método", en cualquier posición.
  resultado = resultado.replace(/\s*\(\s*m[eé]todo\b[^)]*\)\s*/gi, ' ').trim()

  // 2. " - Método ..." hasta el final.
  resultado = resultado.replace(/\s*-\s*m[eé]todo\b.*$/i, '').trim()

  // 3. " por <técnica>" al final.
  resultado = resultado.replace(/\s+por\s+[^-]+$/i, '').trim()

  // 4 y 5 se repiten hasta que no cambien más: un nombre puede traer los DOS
  // sufijos encadenados ("Hemoglobina A1c (HbA1c) - HPLC" -primero cae el
  // segmento de técnica tras el guion, y RECIÉN AHÍ el paréntesis queda al
  // final-), así que un solo pase no alcanza.
  let anterior: string
  do {
    anterior = resultado

    // 4. Paréntesis al final, cualquier contenido.
    resultado = resultado.replace(/\s*\([^()]*\)\s*$/, '').trim()

    // 5. Segmento(s) final(es) de técnica conocida tras " - " (requiere
    // espacio de los dos lados: no toca "HDL-Colesterol" ni
    // "17-OH-Progesterona").
    const partes = resultado.split(/\s+-\s+/)
    while (partes.length > 1 && TECNICAS_DE_LABORATORIO.test(partes[partes.length - 1])) {
      partes.pop()
    }
    resultado = partes.join(' - ').trim()
  } while (resultado !== anterior)

  return resultado
}

/**
 * Largo mínimo (ya normalizado: sin tildes, en minúsculas, con espacios
 * colapsados) para que `buscarPorToleranciaErrata` se anime a tolerar UNA
 * letra de diferencia. Por debajo de este largo, NO se intenta -es la guarda
 * de seguridad contra el peligro real: "T3"/"T4" (2 caracteres), "LDL"/"HDL"
 * y "TGO"/"TGP" (3 caracteres) son pares de siglas a distancia de edición 1
 * ENTRE SÍ que nombran análisis clínicamente distintos, y confundirlas sería
 * mucho peor que dejar una métrica sin canonizar. 12 caracteres deja afuera a
 * cualquier sigla corta pero adentro a los nombres largos donde una errata de
 * imprenta/OCR es plausible ("Proteía C Reactiva Cuantitativa", el caso real
 * medido que motivó este mecanismo -sin la "n" de "Proteína"-, normaliza a 31
 * caracteres).
 */
const LARGO_MINIMO_TOLERANCIA_ERRATA = 12

/**
 * Distancia de Levenshtein clásica (inserción/eliminación/sustitución, costo
 * 1 cada una). El diccionario tiene un puñado de decenas de entradas, así que
 * no hace falta ninguna optimización más allá del corte por largo de
 * `buscarPorToleranciaErrata`.
 */
function distanciaEdicion(a: string, b: string): number {
  const filas = a.length + 1
  const columnas = b.length + 1
  const fila = new Array<number>(columnas)
  let filaAnterior = Array.from({ length: columnas }, (_, j) => j)

  for (let i = 1; i < filas; i++) {
    fila[0] = i
    for (let j = 1; j < columnas; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      fila[j] = Math.min(
        filaAnterior[j] + 1, // eliminación
        fila[j - 1] + 1, // inserción
        filaAnterior[j - 1] + costo, // sustitución
      )
    }
    filaAnterior = [...fila]
  }

  return filaAnterior[columnas - 1]
}

/**
 * Tercer y último intento de `normalizarMetrica`: tolera UNA sola errata de
 * tipeo/OCR sobre un nombre YA LIMPIO que no matcheó ni directo ni tras
 * `limpiarSufijoMetodo` -el caso real medido: "Proteía C Reactiva
 * Cuantitativa", así impreso en el PDF original (falta la "n" de
 * "Proteína"), que el modelo copió fiel-.
 *
 * Dos guardas, ninguna opcional:
 *
 *   1. **Largo mínimo** (`LARGO_MINIMO_TOLERANCIA_ERRATA`): nombres cortos no
 *      entran a este camino. Ver su comentario para el porqué (T3/T4,
 *      LDL/HDL, TGO/TGP).
 *   2. **Sin ambigüedad**: si el nombre está a distancia 1 de claves de MÁS
 *      DE UN canónico distinto, no se adivina -se devuelve `null`, mismo
 *      criterio de "una métrica desconocida no es un error" que el resto del
 *      módulo-. Dos claves del MISMO canónico a distancia 1 (ej. el nombre
 *      completo y su propia sigla) no cuentan como ambigüedad real.
 */
function buscarPorToleranciaErrata(nombreNormalizado: string): string | null {
  if (nombreNormalizado.length < LARGO_MINIMO_TOLERANCIA_ERRATA) return null

  const canonicosADistancia1 = new Set<string>()
  for (const [clave, canonico] of DICCIONARIO) {
    // Corte rápido: a distancia de edición 1, el largo de las dos cadenas
    // difiere como mucho en 1 (una inserción o una eliminación).
    if (Math.abs(clave.length - nombreNormalizado.length) > 1) continue
    if (distanciaEdicion(nombreNormalizado, clave) === 1) {
      canonicosADistancia1.add(canonico)
    }
  }

  return canonicosADistancia1.size === 1 ? [...canonicosADistancia1][0] : null
}

/**
 * Busca el nombre canónico de una métrica de laboratorio por sus sinónimos
 * conocidos. Una métrica desconocida no es un error: se devuelve
 * `canonico: null` y quien llama conserva el nombre original tal cual vino
 * del estudio (ver el encabezado del archivo).
 *
 * Prueba primero el nombre TAL CUAL vino (para no regresionar ningún caso
 * que ya funcionaba), después reintenta con `limpiarSufijoMetodo` -el método
 * pegado es la causa #1 de cobertura baja (ver su comentario)- y, recién si
 * las dos fallan, tolera UNA errata de tipeo/OCR sobre el nombre limpio
 * (`buscarPorToleranciaErrata`, Sprint 19 -ver sus guardas de largo mínimo y
 * ambigüedad antes de asumir que esto "adivina" cualquier cosa-).
 */
export function normalizarMetrica(nombre: string): ResultadoNormalizacionMetrica {
  const claveDirecta = normalizarTexto(nombre)
  const directo = DICCIONARIO.get(claveDirecta)
  if (directo) return { canonico: directo }

  const claveLimpia = normalizarTexto(limpiarSufijoMetodo(nombre))
  const limpio = DICCIONARIO.get(claveLimpia)
  if (limpio) return { canonico: limpio }

  return { canonico: buscarPorToleranciaErrata(claveLimpia) }
}
