/**
 * Duplicados SEMÁNTICOS: el mismo estudio no entra dos veces aunque el PDF
 * venga regenerado (hotfix de producto, sobre la huella byte-a-byte de
 * `20260818150000`).
 *
 * ## Por qué esto existe, contado con la evidencia real del usuario
 *
 * La huella SHA-256 (`lib/documentos/huella.ts`) detecta archivos BYTE A BYTE
 * idénticos. El primer día real mostró su límite: las clínicas argentinas
 * REGENERAN los PDF -mismo estudio, mismo contenido visible, pero el motor
 * que arma el archivo le cambia algo (metadatos de generación, compresión) y
 * los bytes ya no matchean-. El caso concreto: un par de PDF del Sanatorio
 * San Jorge con el MISMO N° DE ORDEN (1446188), contenido idéntico, 2 bytes
 * de diferencia. La huella no los ve como duplicados; este módulo sí.
 *
 * ## Las reglas del usuario, textuales (son ley, no una interpretación)
 *
 * 1. "Si TODOS los datos son EXACTAMENTE iguales a otro que ya cargué en el
 *    PDF entonces es duplicado — me tiene que avisar para que no lo vuelva a
 *    cargar." → Capa 3, `coincidenTodosLosDatos`.
 * 2. "Si es otro archivo (de otro estudio con otra fecha) y tiene un análisis
 *    con el mismo valor, NO significa que está duplicando — significa que en
 *    otro momento se volvió a realizar el mismo análisis y obtuvo el mismo
 *    resultado. Solo cuando todo el PDF tiene los mismos datos adentro es
 *    duplicado." → la FECHA es condición NECESARIA y se compara PRIMERO: fecha
 *    distinta = jamás duplicado, sin importar cuántas métricas coincidan (un
 *    estudio repetido legítimo es un dato valioso para Tendencias, no un
 *    duplicado).
 * 3. "Mismo N° ORDEN, contenido idéntico, bytes distintos — los laboratorios
 *    imprimen su número de orden/protocolo y ES la identidad del estudio."
 *    → Capa 2, `coincideNumeroOrden`.
 *
 * ## Qué compara la Capa 3 y qué NO (decisión declarada)
 *
 * El usuario enumeró explícitamente: fecha, categoría, institución, médico y
 * "CADA métrica con su valor y unidad". Este módulo compara exactamente esos
 * campos — ni uno más. Deliberadamente NO entran en la Capa 3:
 *
 * - `especialidad`: es un dato INFERIDO por Gemini cuando no está impreso
 *   ("si no hay ninguna pista razonable, dejala vacía" — el prompt admite que
 *   el modelo adivine). Dos extracciones separadas del mismo estudio podrían
 *   inferir especialidades ligeramente distintas sin que eso signifique que
 *   son estudios diferentes; incluirla arriesgaría FALSOS NEGATIVOS -el caso
 *   que más le costó al usuario- por una razón ajena al contenido del estudio.
 * - `resumen`/`texto_completo`: son texto generado por IA en lenguaje libre,
 *   nunca literalmente estable entre dos llamadas a Gemini aunque el
 *   documento sea IDÉNTICO. Compararlos haría que la Capa 3 casi nunca
 *   dispare, exactamente el problema que se busca resolver.
 *
 * ## La Capa 3 exige SUSTANCIA mínima (Sprint 18)
 *
 * La primera versión de la Capa 3 tenía un agujero medido con documentos
 * reales: cuando los dos documentos no traen NINGUNA métrica -toda la
 * radiología, las recetas, muchas consultas- y no hay número de orden, "todos
 * los datos idénticos" se degrada a "misma fecha + misma categoría (+ la
 * institución, que es la misma para todo el historial de una persona)". Con
 * eso alcanzaba para dos falsos positivos reales:
 *
 * - una **radiografía de abdomen** marcada como duplicada de una **ecografía**
 *   del mismo día en la misma clínica (las dos son `imaging`, ninguna trae
 *   métricas, ninguna trae médico informante legible);
 * - **dos hojas distintas del mismo estudio** de imágenes, que son dos
 *   documentos diferentes y los dos hacen falta.
 *
 * Los dos comparten causa: una persona se hace VARIOS estudios el mismo día en
 * el mismo lugar, y eso es lo normal, no una repetición. Así que a partir del
 * Sprint 18 la Capa 3 pide, además de que todo coincida, **al menos
 * `MIN_SUSTANCIA_CAPA_3` unidades de sustancia COMPARTIDA**
 * (`contarSustanciaCompartida`): cada métrica en común cuenta una, y la
 * institución, el médico y el número de orden cuentan una cada uno cuando
 * están presentes en LOS DOS y coinciden.
 *
 * Fecha y categoría NO cuentan como sustancia -son los ejes por los que se
 * agrupa el historial, no contenido del estudio-: si contaran, los dos falsos
 * positivos de arriba llegarían a tres solo con la institución y el problema
 * seguiría igual.
 *
 * El costo es conocido y aceptado: un estudio de imágenes REALMENTE duplicado,
 * regenerado con otros bytes y sin número de orden, con menos de tres datos de
 * contexto, ya no se detecta por esta capa. Es un falso NEGATIVO -la persona
 * ve dos veces el mismo estudio y borra uno-, mientras que el falso positivo
 * escondía un estudio que sí tenía. El error barato se elige a propósito.
 *
 * ## Puro, sin red, sin `server-only`
 *
 * Recibe datos ya extraídos (de Gemini o de la base) y devuelve un veredicto.
 * Se prueba con literales (`tests/unit/duplicados-semanticos.test.ts`), mismo
 * criterio que `lib/gmail/deteccion-duplicados.ts` y
 * `lib/gmail/coincidencia-nombre.ts`. Quien necesita datos de la base (el
 * candidato con quien comparar) los trae ANTES de llamar a este módulo:
 * `lib/documentos/duplicados-semanticos-consulta.ts` (tres puertas humanas,
 * cliente del usuario) y `lib/gmail/duplicados-semanticos-admin.ts` (carga
 * automática, sin sesión).
 */

import { normalizarMetrica, normalizarTexto } from "@/lib/laboratorio/diccionario"
import type { CategoriaDocumentoExtraida } from "@/lib/gemini/schemas"

/** Una métrica de laboratorio, en la forma mínima que hace falta para comparar. */
export interface MetricaComparable {
  nombre: string
  valor: number
  unidad: string
}

/**
 * Los datos de UN documento (nuevo o ya cargado), en la forma que este módulo
 * necesita para cotejar. `institucion`/`medico`/`numeroOrden` son cadena
 * vacía -no `null`- cuando el documento no trae el dato: mismo criterio que
 * `DocumentoMedicoExtraido` (Gemini nunca devuelve `null`, devuelve `""`).
 */
export interface DatosComparablesDocumento {
  /** `YYYY-MM-DD`. */
  fecha: string
  categoria: CategoriaDocumentoExtraida
  institucion: string
  medico: string
  numeroOrden: string
  metricas: readonly MetricaComparable[]
}

/** Por qué motivo se encontró el duplicado semántico. */
export type MotivoDuplicadoSemantico = "mismo_numero_orden" | "datos_identicos"

/** Frase corta para la franja de aviso, una por motivo. */
export const TEXTO_MOTIVO_DUPLICADO_SEMANTICO: Record<MotivoDuplicadoSemantico, string> = {
  mismo_numero_orden: "mismo laboratorio y mismo número de orden",
  datos_identicos: "misma fecha, categoría, institución, médico y valores de laboratorio",
}

/** Un documento YA CARGADO, candidato a ser el original de un duplicado. */
export interface CandidatoDuplicado extends DatosComparablesDocumento {
  documentoId: string
  titulo: string
}

/**
 * Lo que necesita el CLIENTE (`FormularioRevision`) para mostrar la franja de
 * duplicado semántico. Vive en este módulo puro -y no en
 * `lib/documentos/duplicados-semanticos-consulta.ts`, que tiene
 * `server-only`- para que un Client Component lo pueda importar con `import
 * type` sin ninguna ambigüedad sobre si el módulo de origen es seguro de
 * referenciar: es el mismo criterio que ya usa
 * `lib/documentos/sugerir-titulo.ts` con los tipos de `lib/gemini/schemas.ts`.
 * `fechaTexto` ya viene FORMATEADA por el servidor (`formatearFechaDuplicado`,
 * `lib/documentos/huella.ts`), mismo criterio que `EstadoSubida.duplicado.fechaTexto`
 * (`app/(app)/(con-nav)/estudios/actions.ts`).
 */
export interface DuplicadoSemanticoParaCliente {
  documentoId: string
  titulo: string
  fechaTexto: string
  motivo: MotivoDuplicadoSemantico
}

/** Lo que devuelve `buscarDuplicadoSemanticoEntreCandidatos` cuando encuentra uno. */
export interface DuplicadoSemanticoEncontrado {
  candidato: CandidatoDuplicado
  motivo: MotivoDuplicadoSemantico
}

/** Normaliza texto libre para comparar tolerando tildes/mayúsculas/espacios — mismo criterio que `lib/laboratorio/diccionario.ts`. */
function normalizar(valor: string | null | undefined): string {
  return normalizarTexto((valor ?? "").trim())
}

/** Clave de comparación de UNA métrica: nombre canónico (o normalizado) + valor + unidad normalizada. */
function claveMetrica(metrica: MetricaComparable): string {
  const { canonico } = normalizarMetrica(metrica.nombre)
  const nombreClave = normalizarTexto(canonico ?? metrica.nombre)
  return `${nombreClave}::${metrica.valor}::${normalizar(metrica.unidad)}`
}

/**
 * ¿Los dos documentos tienen exactamente el mismo CONJUNTO de métricas?
 *
 * Se compara como CONJUNTO (no como lista) a propósito: `lab_metrics` tiene
 * `UNIQUE (document_id, metric_name)`, así que un documento ya confirmado
 * nunca repite una métrica, pero la extracción CRUDA de Gemini (todavía sin
 * confirmar) sí podría traer una entrada dos veces — deduplicar acá evita que
 * eso baje artificialmente la comparación por una razón ajena al contenido
 * real del estudio.
 */
function mismasMetricas(
  a: readonly MetricaComparable[],
  b: readonly MetricaComparable[],
): boolean {
  const clavesA = new Set(a.map(claveMetrica))
  const clavesB = new Set(b.map(claveMetrica))

  if (clavesA.size !== clavesB.size) return false
  for (const clave of clavesA) {
    if (!clavesB.has(clave)) return false
  }
  return true
}

/**
 * Capa 2: ¿mismo laboratorio/institución + mismo N° de orden?
 *
 * Las dos condiciones son necesarias: un número de orden sin institución (o
 * viceversa) no alcanza -distintos laboratorios pueden reciclar la misma
 * numeración de protocolo-. Si a cualquiera de los dos documentos le falta el
 * dato, esta capa no se pronuncia (`false`): no es evidencia de que NO sean
 * duplicados, es simplemente que esta capa no tiene con qué comparar -la
 * Capa 3 puede igual encontrarlos por otro camino-.
 */
export function coincideNumeroOrden(
  nuevo: DatosComparablesDocumento,
  existente: DatosComparablesDocumento,
): boolean {
  const ordenNuevo = normalizar(nuevo.numeroOrden)
  const ordenExistente = normalizar(existente.numeroOrden)
  if (ordenNuevo.length === 0 || ordenExistente.length === 0) return false
  if (ordenNuevo !== ordenExistente) return false

  const institucionNueva = normalizar(nuevo.institucion)
  const institucionExistente = normalizar(existente.institucion)
  if (institucionNueva.length === 0 || institucionExistente.length === 0) return false

  return institucionNueva === institucionExistente
}

/**
 * Cuántas unidades de SUSTANCIA comparten los dos documentos.
 *
 * Cuenta uno por cada métrica en común -deduplicada, mismo criterio que
 * `mismasMetricas`- y uno por cada dato de contexto que esté presente en LOS
 * DOS y coincida: institución, médico, número de orden.
 *
 * Deliberadamente NO cuentan la fecha ni la categoría: son los ejes por los
 * que se agrupa un historial -cualquier par de estudios del mismo día en la
 * misma clínica los comparte- y no dicen nada sobre si el CONTENIDO es el
 * mismo. Ver el bloque "La Capa 3 exige SUSTANCIA mínima" del encabezado.
 *
 * Se exporta para poder probarla sola y para que el número que decide sea
 * inspeccionable, no un efecto lateral escondido dentro del `if`.
 */
export function contarSustanciaCompartida(
  nuevo: DatosComparablesDocumento,
  existente: DatosComparablesDocumento,
): number {
  let sustancia = 0

  const clavesNuevo = new Set(nuevo.metricas.map(claveMetrica))
  const clavesExistente = new Set(existente.metricas.map(claveMetrica))
  for (const clave of clavesNuevo) {
    if (clavesExistente.has(clave)) sustancia += 1
  }

  for (const campo of ["institucion", "medico", "numeroOrden"] as const) {
    const valorNuevo = normalizar(nuevo[campo])
    const valorExistente = normalizar(existente[campo])
    if (valorNuevo.length > 0 && valorNuevo === valorExistente) sustancia += 1
  }

  return sustancia
}

/**
 * Mínimo de unidades de sustancia compartida para que la Capa 3 se anime a
 * declarar duplicado. Tres es lo que dejaba afuera a los dos falsos positivos
 * reales -una institución sola, o una institución más un médico, no alcanzan-
 * sin tocar ningún verdadero positivo de los medidos: un laboratorio duplicado
 * llega a tres con dos métricas y la institución.
 */
export const MIN_SUSTANCIA_CAPA_3 = 3

/**
 * Capa 3: ¿son EXACTAMENTE el mismo documento en todos los datos extraídos?
 *
 * La fecha se compara PRIMERO y es condición NECESARIA -regla 2 del usuario,
 * ver el encabezado del archivo-: `return false` inmediato ante fechas
 * distintas, sin mirar ningún otro campo. El resto (categoría, institución,
 * médico, métricas) se normaliza antes de comparar: espacios repetidos,
 * mayúsculas y tildes NO cuentan como diferencia.
 *
 * Y aunque todo coincida, hace falta SUSTANCIA: al menos
 * `MIN_SUSTANCIA_CAPA_3` datos de contenido compartidos. Sin eso, "todos los
 * datos iguales" no significa "el mismo estudio", significa "dos estudios del
 * mismo día en el mismo lugar", que es lo que le pasa a cualquiera que se hace
 * una radiografía y una ecografía en la misma visita.
 */
export function coincidenTodosLosDatos(
  nuevo: DatosComparablesDocumento,
  existente: DatosComparablesDocumento,
): boolean {
  // Condición NECESARIA, comparada primero: fecha distinta = jamás duplicado.
  if (nuevo.fecha !== existente.fecha) return false

  if (nuevo.categoria !== existente.categoria) return false
  if (normalizar(nuevo.institucion) !== normalizar(existente.institucion)) return false
  if (normalizar(nuevo.medico) !== normalizar(existente.medico)) return false

  // Dos números de orden DISTINTOS son la propia institución diciendo que son
  // dos estudios distintos. Que uno lo traiga y el otro no, en cambio, no dice
  // nada -el lector puede no haberlo leído en una de las dos copias- y no
  // corta acá; simplemente no suma sustancia.
  const ordenNuevo = normalizar(nuevo.numeroOrden)
  const ordenExistente = normalizar(existente.numeroOrden)
  if (ordenNuevo.length > 0 && ordenExistente.length > 0 && ordenNuevo !== ordenExistente) {
    return false
  }

  if (!mismasMetricas(nuevo.metricas, existente.metricas)) return false

  return contarSustanciaCompartida(nuevo, existente) >= MIN_SUSTANCIA_CAPA_3
}

/**
 * Busca un duplicado semántico de `nuevo` entre `candidatos` (documentos que
 * el perfil YA tiene, típicamente ya confirmados — ver el módulo de consulta
 * correspondiente para el porqué).
 *
 * La Capa 2 se evalúa ANTES que la Capa 3 a propósito: es la evidencia más
 * fuerte (un número de orden compartido es una coincidencia administrativa
 * deliberada del laboratorio, no un parecido de contenido), así que si
 * encuentra algo, se prefiere su motivo por sobre el de la Capa 3 aunque el
 * mismo candidato también matcheara por "todos los datos". Devuelve el
 * PRIMER candidato que coincide por cualquiera de las dos capas, o `null` si
 * ninguno coincide.
 */
export function buscarDuplicadoSemanticoEntreCandidatos(
  nuevo: DatosComparablesDocumento,
  candidatos: readonly CandidatoDuplicado[],
): DuplicadoSemanticoEncontrado | null {
  for (const candidato of candidatos) {
    if (coincideNumeroOrden(nuevo, candidato)) {
      return { candidato, motivo: "mismo_numero_orden" }
    }
  }

  for (const candidato of candidatos) {
    if (coincidenTodosLosDatos(nuevo, candidato)) {
      return { candidato, motivo: "datos_identicos" }
    }
  }

  return null
}
