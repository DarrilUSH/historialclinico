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
 */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Nombre canónico → sinónimos tal como aparecen en estudios reales
 * (mayúsculas, minúsculas, abreviaturas). No hace falta listar variantes de
 * tildes/mayúsculas acá: `normalizarTexto` las unifica al construir el mapa.
 */
const SINONIMOS_POR_CANONICO: Record<string, string[]> = {
  Glucosa: ['glucosa', 'glucemia', 'glucosa en ayunas', 'glucemia en ayunas', 'glu'],
  'Colesterol total': ['colesterol total', 'colesterol', 'ct', 'col total'],
  'Colesterol HDL': ['colesterol hdl', 'hdl', 'hdl colesterol'],
  'Colesterol LDL': ['colesterol ldl', 'ldl', 'ldl colesterol'],
  Triglicéridos: ['trigliceridos', 'tg'],
  Hemoglobina: ['hemoglobina', 'hb', 'hgb'],
  Hematocrito: ['hematocrito', 'hto', 'hct'],
  Leucocitos: ['leucocitos', 'globulos blancos', 'gb', 'wbc'],
  Plaquetas: ['plaquetas', 'plt'],
  Creatinina: ['creatinina'],
  Urea: ['urea'],
  TSH: ['tsh'],
  'Hemoglobina glicosilada': [
    'hemoglobina glicosilada',
    'hemoglobina glucosilada',
    'hba1c',
    'a1c',
  ],
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
 * Busca el nombre canónico de una métrica de laboratorio por sus sinónimos
 * conocidos. Una métrica desconocida no es un error: se devuelve
 * `canonico: null` y quien llama conserva el nombre original tal cual vino
 * del estudio (ver el encabezado del archivo).
 */
export function normalizarMetrica(nombre: string): ResultadoNormalizacionMetrica {
  const clave = normalizarTexto(nombre)
  const canonico = DICCIONARIO.get(clave) ?? null
  return { canonico }
}
