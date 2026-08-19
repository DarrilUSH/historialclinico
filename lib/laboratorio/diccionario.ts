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
  Leucocitos: ['leucocitos', 'globulos blancos', 'gb', 'wbc'],
  Plaquetas: ['plaquetas', 'plt', 'recuento de plaquetas', 'recuento plaquetario'],
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
  GGT: ['ggt', 'gamma gt', 'gamma glutamil transferasa', 'gammaglutamiltranspeptidasa'],
  'Bilirrubina total': ['bilirrubina total', 'bt'],
  'Bilirrubina directa': ['bilirrubina directa', 'bd'],
  'Bilirrubina indirecta': ['bilirrubina indirecta', 'bi'],
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
  ],
  'Vitamina B12': ['vitamina b12', 'vitamina b 12', 'b12'],
  Ferremia: ['ferremia', 'hierro serico', 'fe serico', 'hierro plasmatico'],
  Procalcitonina: ['procalcitonina', 'pct'],
  LDH: ['ldh', 'lactato deshidrogenasa', 'lacticodeshidrogenasa'],
  Amilasa: ['amilasa', 'amilasemia'],
  'Proteína C reactiva': ['pcr', 'proteina c reactiva', 'p.c.r.'],
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
 * Busca el nombre canónico de una métrica de laboratorio por sus sinónimos
 * conocidos. Una métrica desconocida no es un error: se devuelve
 * `canonico: null` y quien llama conserva el nombre original tal cual vino
 * del estudio (ver el encabezado del archivo).
 *
 * Prueba primero el nombre TAL CUAL vino (para no regresionar ningún caso
 * que ya funcionaba) y, si no matchea, reintenta con `limpiarSufijoMetodo`
 * -el método pegado es la causa #1 de cobertura baja (ver su comentario)-.
 */
export function normalizarMetrica(nombre: string): ResultadoNormalizacionMetrica {
  const claveDirecta = normalizarTexto(nombre)
  const directo = DICCIONARIO.get(claveDirecta)
  if (directo) return { canonico: directo }

  const claveLimpia = normalizarTexto(limpiarSufijoMetodo(nombre))
  const canonico = DICCIONARIO.get(claveLimpia) ?? null
  return { canonico }
}
