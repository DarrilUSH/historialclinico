/**
 * ¿Ese número que el lector devolvió como "número de orden" ES un número de
 * orden? (Sprint 18, robustez de la extracción.)
 *
 * **Puro, sin red, sin `server-only`.** Recibe la extracción cruda de Gemini y
 * devuelve el número acreditado o `null`. Se prueba con literales y con el
 * banco sintético (`tests/unit/numero-orden.test.ts`,
 * `tests/fixtures/documentos-sinteticos/`).
 *
 * ## Por qué esto existe, contado con la evidencia real
 *
 * En los 47 documentos que el dueño cargó de verdad, el lector devolvió un
 * `numero_orden` en 15 casos donde el número NO era un número de orden:
 *
 * - `15570342.01`, `15569667.01` — **números de accesión DICOM**, quemados por
 *   el equipo en el encabezado de la placa. Terminan en `.NN` porque el
 *   sufijo numera la SERIE dentro del estudio.
 * - `11021738` — otra accesión, esta vez sin sufijo. Las **cuatro vistas** de
 *   una misma columna lumbar la comparten, porque una accesión identifica al
 *   pedido de imágenes, no al archivo: si ese número se toma como identidad
 *   del estudio, el detector marca las cuatro placas como duplicadas entre sí.
 *   Ese daño ya está medido, no es hipotético.
 * - `00176828` — el **N° de internado** de una epicrisis de guardia.
 *
 * La Capa 2 del detector de duplicados (`coincideNumeroOrden`,
 * `lib/documentos/duplicados-semanticos.ts`) usa este campo como IDENTIDAD del
 * estudio. Un número equivocado ahí no produce un dato feo: produce que un
 * estudio que la persona SÍ tiene desaparezca detrás de un aviso de
 * "duplicado". Por eso este módulo es deliberadamente desconfiado.
 *
 * ## La regla, en una frase
 *
 * **Un número solo se acepta si está ACREDITADO.** Está acreditado si viene
 * con un rótulo explícito de orden / protocolo / solicitud / pedido /
 * registro -en el propio valor, o en el texto del documento, pegado al
 * número-, o si su FORMA solo puede ser la de un código de estudio (trae
 * letras, o un guion/barra entre grupos: `OP-3391`, `R-2026-0447`,
 * `887-2026`). **Cualquier tira de dígitos corridos sin rótulo se rechaza**,
 * sin importar cuántos dígitos tenga: es indistinguible de un DNI, de un N° de
 * historia clínica, de una internación o de una accesión.
 *
 * Y ante la duda, `null`. Que la Capa 2 no se pronuncie sobre un documento no
 * cuesta nada -la Capa 1 (huella byte a byte) y la Capa 3 (todos los datos
 * iguales) siguen mirando-; que se pronuncie MAL cuesta un estudio escondido.
 *
 * ## Qué se pierde con esto, dicho de frente
 *
 * El caso que estrenó la Capa 2 -Sanatorio San Jorge, `1446188` impreso como
 * "N° ORDEN"- deja de acreditarse cuando el lector devuelve el número pelado y
 * el rótulo no quedó en `texto_completo`: siete dígitos corridos son
 * exactamente la forma de un DNI argentino, y este módulo no tiene manera
 * HONESTA de distinguirlos. Ese par igual se detecta, por la Capa 3: son dos
 * PDF con el mismo contenido, misma fecha, misma institución y las mismas
 * métricas. El aviso cambia de frase, no de existencia.
 *
 * La forma de recuperar la Capa 2 para esos casos es que el lector devuelva el
 * rótulo junto al número (o un campo aparte con el rótulo), y eso vive en
 * `lib/gemini/prompt-documento.ts` — fuera del alcance de este módulo. Queda
 * anotado como deuda.
 *
 * ## Por qué las reglas son GENERALES y no del formato de una clínica
 *
 * Ninguna de las tres capas de este módulo nombra a una institución:
 *
 * 1. Las formas PROHIBIDAS son estándares o convenciones universales: la
 *    accesión DICOM con sufijo de serie (`\d{6,}\.\d{1,2}`) sale del propio
 *    estándar DICOM, no de un proveedor; el CUIT y las fechas tienen forma
 *    fija en todo el país; un contador administrativo rellenado con ceros a la
 *    izquierda (`00176828`) es lo que hace un sistema de gestión, no una
 *    imprenta de laboratorio.
 * 2. Los rótulos son los sinónimos castellanos del concepto -orden, protocolo,
 *    solicitud, pedido, registro-, no los de un membrete puntual, y se
 *    comparan normalizados (sin tildes, sin mayúsculas, sin puntuación).
 * 3. La forma acreditante ("tiene letras o separador") describe qué NO puede
 *    ser un identificador de persona ni de imagen, no qué imprime tal
 *    laboratorio.
 */

import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"

/**
 * Tope de la columna `documents.numero_orden` (CHECK
 * `documents_numero_orden_valido`, `20260818180000_duplicados_semanticos.sql`).
 * Un valor más largo no se recorta -recortar un identificador lo convierte en
 * OTRO identificador, y este campo decide identidad-: se descarta.
 */
export const MAX_LARGO_NUMERO_ORDEN = 60

/**
 * Rótulos que ACREDITAN al número como identificador del estudio. Se comparan
 * ya normalizados (sin tildes, en minúsculas), así que alcanza con la raíz:
 * "protocolo", "protoc.", "prot" y "PROTOCOLO N°" caen todos en `prot`.
 */
const RAICES_ROTULO_DE_ORDEN = [
  "orden",
  "ordenes",
  "protocolo",
  "protoc",
  "prot",
  "solicitud",
  "pedido",
  "registro",
  "peticion",
  "requerimiento",
  "comprobante",
  "practica",
] as const

/**
 * Rótulos que DESACREDITAN al número: si alguno acompaña al valor, el número
 * es de otra cosa (de la persona, del episodio, de la placa o del aparato) y
 * no se usa jamás como identidad del estudio.
 */
const RAICES_ROTULO_AJENO = [
  "dni",
  "documento",
  "doc",
  "cuil",
  "cuit",
  "afiliado",
  "afiliada",
  "socio",
  "credencial",
  "beneficiario",
  "obra",
  "plan",
  "historia",
  "hc",
  "hcl",
  "internacion",
  "internado",
  "internada",
  "cama",
  "episodio",
  "legajo",
  "matricula",
  "mp",
  "mn",
  "accesion",
  "acceso",
  "acc",
  "accession",
  "serie",
  "series",
  "instancia",
  "imagen",
  "estudio_uid",
  "uid",
  "equipo",
  "serial",
  "sn",
  "telefono",
  "tel",
  "cp",
  "factura",
  "recibo",
  "expediente",
] as const

/** Marcas diacríticas combinantes que deja el `normalize("NFD")`. */
const DIACRITICOS = /[̀-ͯ]/g

/** Texto → palabras normalizadas (sin tildes, minúsculas, sin puntuación). */
function palabrasNormalizadas(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((palabra) => palabra.length > 0)
}

/**
 * ¿Alguna de estas palabras es un rótulo de la lista?
 *
 * Se ignoran las palabras de relleno que las clínicas meten entre el rótulo y
 * el número ("n", "nro", "numero", "de", "del", "la"): están en TODOS los
 * membretes y no aportan ni desacreditan.
 */
const RELLENO = new Set(["n", "nro", "nº", "no", "num", "numero", "de", "del", "la", "el", "y"])

function contieneRotulo(palabras: readonly string[], raices: readonly string[]): boolean {
  return palabras.some((palabra) => {
    if (RELLENO.has(palabra)) return false
    return raices.includes(palabra)
  })
}

/**
 * Parte `"N° de Orden: 1446188"` en `{ rotulo: "N° de Orden", valor: "1446188" }`.
 *
 * Dos caminos, en orden: lo que está antes de los dos puntos es rótulo; sin
 * dos puntos, son rótulo las palabras iniciales que no traen ningún dígito. Un
 * valor pelado (`"1446188"`, `"OP-3391"`) sale con rótulo vacío, que es
 * justamente lo que este módulo necesita saber.
 */
function separarRotulo(bruto: string): { rotulo: string; valor: string } {
  const dosPuntos = bruto.lastIndexOf(":")
  if (dosPuntos >= 0) {
    return { rotulo: bruto.slice(0, dosPuntos), valor: bruto.slice(dosPuntos + 1).trim() }
  }

  const palabras = bruto.split(/\s+/).filter((palabra) => palabra.length > 0)
  let corte = 0
  while (corte < palabras.length - 1 && !/\d/.test(palabras[corte])) corte += 1
  if (corte === 0) return { rotulo: "", valor: bruto.trim() }

  return { rotulo: palabras.slice(0, corte).join(" "), valor: palabras.slice(corte).join(" ") }
}

/** Accesión DICOM: la del estándar, con el sufijo que numera la serie. */
const ACCESION_DICOM = /^\d{6,}\.\d{1,2}$/

/** Fecha escrita como número: `02/05/2026`, `2-5-26`, `20260502`. */
const FECHA_CON_SEPARADOR = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/

/** CUIT/CUIL, con o sin guiones. */
const CUIT = /^\d{2}-?\d{8}-?\d$/

/** Contador administrativo rellenado con ceros a la izquierda (internación, HC, cama). */
const RELLENADO_CON_CEROS = /^0\d{5,}$/

/** Solo dígitos, de punta a punta. */
const SOLO_DIGITOS = /^\d+$/

/** Caracteres que puede tener un código de estudio impreso. Cualquier otro lo descalifica. */
const CARACTERES_DE_CODIGO = /^[A-Za-z0-9][A-Za-z0-9./_-]*$/

/** ¿`\d{8}` que además es una fecha creíble (`YYYYMMDD`)? */
function pareceFechaCompacta(valor: string): boolean {
  if (!/^\d{8}$/.test(valor)) return false
  const anio = Number(valor.slice(0, 4))
  const mes = Number(valor.slice(4, 6))
  const dia = Number(valor.slice(6, 8))
  return anio >= 1900 && anio <= 2100 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31
}

/**
 * ¿La FORMA del valor solo puede ser la de un código de estudio?
 *
 * Sí cuando trae letras, o cuando tiene un guion/barra entre grupos
 * alfanuméricos. Ni un DNI, ni un N° de historia clínica, ni una internación,
 * ni una accesión DICOM se imprimen así: son dígitos corridos (la accesión,
 * dígitos corridos más un `.NN`). Es la única puerta que este módulo abre sin
 * rótulo, y abre solo para formas que un identificador de persona no tiene.
 */
function tieneFormaDeCodigoDeEstudio(valor: string): boolean {
  if (/[A-Za-z]/.test(valor)) return true
  return /^[0-9]+[/-][0-9]+([/-][0-9]+)*$/.test(valor)
}

/**
 * ¿El texto del documento menciona `valor` pegado a un rótulo de `raices`?
 *
 * "Pegado" = con hasta `VENTANA` palabras de por medio, para tolerar el
 * relleno de los membretes ("Protocolo Nro. 24601", "Orden N ° 887-2026").
 * Se recorre el texto ya normalizado, así que tildes, mayúsculas, dos puntos y
 * el símbolo `°` no cambian nada.
 */
const VENTANA_ROTULO = 4

function textoRotulaEl(
  texto: string,
  valor: string,
  raices: readonly string[],
): boolean {
  const palabrasTexto = palabrasNormalizadas(texto)
  if (palabrasTexto.length === 0) return false

  // El valor se normaliza igual que el texto: `R-2026-0447` queda como
  // `["r","2026","0447"]` y se busca esa secuencia.
  const palabrasValor = palabrasNormalizadas(valor)
  if (palabrasValor.length === 0) return false

  for (let inicio = 0; inicio + palabrasValor.length <= palabrasTexto.length; inicio += 1) {
    let calza = true
    for (let offset = 0; offset < palabrasValor.length; offset += 1) {
      if (palabrasTexto[inicio + offset] !== palabrasValor[offset]) {
        calza = false
        break
      }
    }
    if (!calza) continue

    const desde = Math.max(0, inicio - VENTANA_ROTULO)
    const previas = palabrasTexto.slice(desde, inicio)
    if (contieneRotulo(previas, raices)) return true
  }

  return false
}

/** Lo que hace falta saber del documento para decidir si el número está acreditado. */
export interface ContextoNumeroOrden {
  /** La categoría que devolvió el lector. */
  categoria: CategoriaDocumentoExtraida
  /**
   * Texto del documento donde buscar el rótulo: típicamente `texto_completo`
   * y `resumen` concatenados. Vacío o ausente = no hay dónde corroborar, y
   * entonces solo decide la forma del valor.
   */
  textoDelDocumento?: string
}

/**
 * El número de orden acreditado, o `null`.
 *
 * `null` NO significa "este documento no está duplicado": significa "este
 * número no sirve para decidir identidad". La Capa 2 simplemente no se
 * pronuncia, y la Capa 3 sigue su camino.
 */
export function sanearNumeroOrden(
  crudo: string | null | undefined,
  contexto: ContextoNumeroOrden,
): string | null {
  const bruto = (crudo ?? "").trim()
  if (bruto.length === 0) return null
  if (bruto.length > MAX_LARGO_NUMERO_ORDEN) return null

  const { rotulo, valor } = separarRotulo(bruto)
  if (valor.length === 0 || valor.length > MAX_LARGO_NUMERO_ORDEN) return null

  // ── Formas PROHIBIDAS: se rechazan aunque vengan rotuladas como orden. Un
  // documento que rotula "Orden: 15570342.01" está rotulando mal una accesión,
  // y creerle sería importar el error tal cual.
  if (!CARACTERES_DE_CODIGO.test(valor)) return null
  if (!/\d/.test(valor)) return null
  if (ACCESION_DICOM.test(valor)) return null
  if (FECHA_CON_SEPARADOR.test(valor)) return null
  if (pareceFechaCompacta(valor)) return null
  if (CUIT.test(valor)) return null
  if (RELLENADO_CON_CEROS.test(valor)) return null

  const palabrasRotulo = palabrasNormalizadas(rotulo)
  // ── Rótulo AJENO pegado al número: es de otra cosa. Corta acá.
  if (contieneRotulo(palabrasRotulo, RAICES_ROTULO_AJENO)) return null

  const texto = (contexto.textoDelDocumento ?? "").trim()
  if (texto.length > 0 && textoRotulaEl(texto, valor, RAICES_ROTULO_AJENO)) return null

  // ── Acreditación por rótulo, en el valor o en el texto del documento.
  const acreditadoPorRotulo =
    contieneRotulo(palabrasRotulo, RAICES_ROTULO_DE_ORDEN) ||
    (texto.length > 0 && textoRotulaEl(texto, valor, RAICES_ROTULO_DE_ORDEN))

  if (acreditadoPorRotulo) return valor

  // ── Sin rótulo: solo pasa lo que no puede ser un identificador de persona
  // ni de imagen. En particular, NINGUNA tira de dígitos corridos pasa —
  // tenga 7 (un DNI), 8 (un DNI o una accesión) o los que sean.
  if (SOLO_DIGITOS.test(valor)) return null

  // En un informe de imágenes, el número sin rótulo que hay a mano es el que
  // el equipo quemó en el encabezado de la placa. Ahí ni la forma alcanza.
  if (contexto.categoria === "imaging") return null

  if (tieneFormaDeCodigoDeEstudio(valor)) return valor

  return null
}
