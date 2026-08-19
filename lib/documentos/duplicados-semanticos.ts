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
 * ## El umbral se adapta para IMAGEN cuando hay médico informante (Sprint 19)
 *
 * El costo "conocido y aceptado" de arriba se hizo carne con un caso real del
 * dueño: una **ecografía vesical** regenerada por la clínica (dos PDF, mismo
 * contenido, bytes distintos -exactamente el escenario que motiva todo este
 * módulo-) NO se detectó. `contarSustanciaCompartida` daba 2 (institución +
 * médico informante, ambos presentes e idénticos en las dos extracciones) y
 * `MIN_SUSTANCIA_CAPA_3` pide 3 -un estudio de imágenes, por naturaleza, no
 * tiene métricas ni casi nunca número de orden, así que institución + médico
 * ES el techo de sustancia alcanzable-.
 *
 * La opción descartada fue sumar una señal de similitud textual sobre
 * `resumen`/`texto_completo`: el propio encabezado de este módulo ya explica
 * por qué esos dos campos quedaron AFUERA de la Capa 3 desde el principio -son
 * texto libre generado por IA, nunca literalmente estable entre dos llamadas
 * aunque el documento sea idéntico- y meterlos por la puerta de atrás como
 * "similitud" reintroduce el mismo problema con más superficie de bugs
 * (¿qué umbral de similitud? ¿con qué distancia?) para resolver un caso que
 * institución + médico ya identifican sin ambigüedad.
 *
 * La solución elegida es un umbral MÁS BAJO, `MIN_SUSTANCIA_CAPA_3_IMAGING`,
 * que se usa en vez del general SOLO cuando **las tres condiciones dan
 * simultáneamente**:
 *
 *   1. `categoria === "imaging"`.
 *   2. La institución está presente y coincide en los dos (ya lo exige la
 *      Capa 3 más arriba, comparada como condición de corte).
 *   3. El médico está presente (no vacío) y coincide en los dos -también ya
 *      exigido arriba; acá solo se vuelve a preguntar si además NO está
 *      vacío-.
 *
 * Por qué esto NO reabre los dos falsos positivos del Sprint 18: los cuatro
 * casos sintéticos que los reproducen (`tests/fixtures/documentos-sinteticos/`,
 * ids `05`, `06`, `07`, `16`) tienen los CUATRO `medico: ""` -ninguna placa
 * trae médico informante legible, que es justamente parte de lo que los volvía
 * un falso positivo-. La condición 3 exige médico NO vacío, así que esos pares
 * siguen evaluándose contra `MIN_SUSTANCIA_CAPA_3` (3) sin bajar la guardia.
 * El caso real que motivó el cambio, en cambio, sí trae médico informante en
 * las dos extracciones -es lo que dice la ecografía-, así que institución +
 * médico (2) alcanza el umbral adaptado y se detecta.
 *
 * El otro caso real medido en el mismo sprint -una **radiografía de tórax**
 * regenerada cuyas dos lecturas de Gemini devolvieron FECHAS DISTINTAS (una
 * tomó la fecha del estudio, la otra la fecha de "Firmado" del informe)- NO
 * se arregla acá ni en ningún otro lado de este módulo: la fecha se compara
 * PRIMERO y es condición necesaria (regla 2 del dueño, textual, ver más
 * arriba), así que ninguna cantidad de sustancia compartida puede compensar
 * una fecha distinta. Es un límite del PIPELINE DE EXTRACCIÓN (no
 * determinismo de Gemini entre dos lecturas del mismo documento), fuera del
 * alcance de este módulo puro -queda declarado como deuda en el Resumen de
 * Entrega del Sprint 19-.
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

/**
 * Una métrica de laboratorio, en la forma mínima que hace falta para
 * comparar. `valor` es `null` para un resultado CUALITATIVO ("Negativo", "No
 * Reactivo") — espejo de `MetricaExtraida`/`lab_metrics.value` desde que ese
 * campo se volvió nullable (Sprint 18, cableado a la extracción en vivo en el
 * Sprint 19): ver `valorTexto`.
 */
export interface MetricaComparable {
  nombre: string
  valor: number | null
  /** Resultado cualitativo cuando `valor` es `null`. Ignorado si `valor` es numérico. */
  valorTexto?: string
  unidad: string
}

/**
 * Los datos de UN documento (nuevo o ya cargado), en la forma que este módulo
 * necesita para cotejar. `institucion`/`medico`/`numeroOrden` son cadena
 * vacía -no `null`- cuando el documento no trae el dato: mismo criterio que
 * `DocumentoMedicoExtraido` (Gemini nunca devuelve `null` para esos tres,
 * devuelve `""`).
 *
 * `fecha` SÍ es `string | null` (Sprint 19): un documento recién extraído
 * puede no traer fecha propia (`DocumentoMedicoExtraido.fecha`, ver su
 * comentario en `lib/gemini/schemas.ts` — el modelo ya no la inventa). Un
 * documento SIN fecha nunca puede declararse duplicado de nada: ver la guarda
 * al principio de `coincidenTodosLosDatos`.
 */
export interface DatosComparablesDocumento {
  /** `YYYY-MM-DD`, o `null` si el documento no trae fecha propia (todavía sin confirmar por una persona). */
  fecha: string | null
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

/**
 * Un documento YA CARGADO, candidato a ser el original de un duplicado.
 * `fecha` se redeclara SIN `null` (angosta el tipo heredado): un candidato
 * sale de `documents` filtrado por `confirmed_at is not null`
 * (`duplicados-semanticos-consulta.ts`/`duplicados-semanticos-admin.ts`), y
 * `documents.document_date` es `NOT NULL` en la base -la fecha puede quedar
 * sin confirmar mientras el documento es un BORRADOR, pero confirmar exige
 * una fecha real (ver el comentario de `fecha` en
 * `lib/gemini/schemas.ts#SCHEMA_DOCUMENTO_MEDICO`)-. Solo el lado `nuevo` de
 * una comparación (la extracción recién hecha, todavía sin confirmar) puede
 * tener `fecha: null`.
 */
export interface CandidatoDuplicado extends DatosComparablesDocumento {
  fecha: string
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

/**
 * Clave de comparación de UNA métrica: nombre canónico (o normalizado) +
 * valor + unidad normalizada. El valor es el numérico si lo hay; si no
 * (resultado CUALITATIVO, Sprint 19 — ver `MetricaComparable`), es el texto
 * normalizado con un prefijo (`texto:`) que evita que un resultado
 * cualitativo colisione por accidente con un resultado numérico que
 * casualmente tenga la misma representación de cadena.
 */
function claveMetrica(metrica: MetricaComparable): string {
  const { canonico } = normalizarMetrica(metrica.nombre)
  const nombreClave = normalizarTexto(canonico ?? metrica.nombre)
  const valorClave = metrica.valor !== null ? String(metrica.valor) : `texto:${normalizar(metrica.valorTexto)}`
  return `${nombreClave}::${valorClave}::${normalizar(metrica.unidad)}`
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
 * Umbral adaptado para documentos de IMAGEN cuando institución Y médico están
 * los dos presentes y coinciden (Sprint 19) — ver el bloque "El umbral se
 * adapta para IMAGEN cuando hay médico informante" en el encabezado del
 * archivo para el caso real y el porqué del número. Más bajo que
 * `MIN_SUSTANCIA_CAPA_3` porque para esa categoría institución + médico ES el
 * techo de sustancia alcanzable -no hay métricas y casi nunca número de
 * orden-, así que pedir 3 es pedir algo que ese tipo de estudio
 * estructuralmente no puede dar.
 */
export const MIN_SUSTANCIA_CAPA_3_IMAGING = 2

/**
 * ¿Corresponde relajar el umbral de sustancia de la Capa 3 para este par?
 *
 * Solo cuando los TRES se cumplen a la vez: categoría `imaging`, institución
 * presente (y ya coincidente -se llama después del corte por institución en
 * `coincidenTodosLosDatos`-), médico presente (ídem, ya coincidente) y NO
 * vacío. El tercer chequeo es el que de verdad decide acá: institución y
 * médico YA se compararon arriba y son iguales en los dos documentos si se
 * llegó hasta este punto; lo único que este helper agrega es preguntar si
 * además ninguno de los dos está vacío -que es la diferencia real entre el
 * caso real que motivó el cambio (ecografía con médico informante) y los dos
 * falsos positivos del Sprint 18 (radiografías sin médico informante
 * legible, ver el encabezado del archivo)-.
 */
function corresponUmbralImagen(
  nuevo: DatosComparablesDocumento,
  existente: DatosComparablesDocumento,
): boolean {
  if (nuevo.categoria !== "imaging") return false
  const institucionPresente = normalizar(nuevo.institucion).length > 0
  const medicoPresente = normalizar(nuevo.medico).length > 0
  return institucionPresente && medicoPresente && normalizar(existente.institucion).length > 0
}

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
  // Fecha DESCONOCIDA (Sprint 19: un documento recién extraído puede no
  // traer fecha propia, ver `DatosComparablesDocumento`): no hay con qué
  // evaluar la condición necesaria de abajo, así que nunca se declara
  // duplicado. Se chequea ANTES del `!==` a propósito -en JS `null === null`
  // es `true`, así que sin esta guarda dos documentos con fecha desconocida
  // pasarían la condición como si tuvieran "la misma fecha", que es
  // exactamente lo que esta regla existe para evitar.
  if (nuevo.fecha === null || existente.fecha === null) return false

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

  const umbral = corresponUmbralImagen(nuevo, existente)
    ? MIN_SUSTANCIA_CAPA_3_IMAGING
    : MIN_SUSTANCIA_CAPA_3
  return contarSustanciaCompartida(nuevo, existente) >= umbral
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
