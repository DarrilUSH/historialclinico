import "server-only"

/**
 * Armado PURO del contexto clínico que viaja a Gemini (Sprint 10, tarea 10.2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  **Este archivo es la lista blanca de datos personales del proyecto.**
 *  Todo lo que aparezca en `ContextoClinico` sale del servidor y llega a un
 *  tercero (Google). Todo lo que no esté en el tipo, no sale. El contrato
 *  completo -campo por campo, con el porqué clínico de cada inclusión y de
 *  cada exclusión- está escrito en `docs/minimizacion-datos.md`, y lo verifica
 *  `tests/unit/contexto-ficha.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Principio rector
 *
 * **Si no cambia una decisión clínica, no viaja.** Los datos de salud son
 * datos sensibles (Ley 25.326, arts. 2 y 7) y su tratamiento debe limitarse a
 * la finalidad declarada (art. 4 inc. 1). El nombre, el DNI, el teléfono, el
 * domicilio y el contacto de emergencia no ayudan a redactar un resumen de
 * antecedentes: mandarlos sería entregarle identificadores a un procesador
 * externo a cambio de cero valor. La misma regla ya está escrita en el
 * esquema (`profiles.national_id`, `profiles.phone`:
 * "se excluye del contexto que se envía a la IA (minimización, Ley 25.326)",
 * `supabase/migrations/20260812200000_schema_inicial.sql` §4.1) y en
 * `docs/modelo-permisos.md` §9.1.
 *
 * ## Por qué cada campo se copia A MANO
 *
 * No hay un solo `...spread` de una fila de la base en este archivo, ni
 * `Object.assign`, ni un `select("*")` del otro lado. Es deliberado y es la
 * única garantía que sobrevive al paso del tiempo: con un spread, la próxima
 * migración que agregue una columna a `profiles` o a `documents` la publicaría
 * sola en el próximo request a Gemini, sin que nadie lo decida ni lo note. Con
 * copia campo a campo, una columna nueva **no llega** hasta que alguien la
 * escriba acá, lea este encabezado y actualice `docs/minimizacion-datos.md`.
 *
 * ## Por qué NO viajan los uuid
 *
 * `documents.id`, `medications.id`, `vital_signs.id`: ninguno aporta al
 * resumen y todos son identificadores estables que permitirían correlacionar
 * dos requests distintos como "de la misma persona". Cuando la ficha necesita
 * referirse a un estudio, usa `DocumentoContexto.indice` -un ordinal 1..N
 * válido SOLO dentro de este contexto-, y quien lo consuma vuelve a la fila
 * por posición en el mismo arreglo con el que armó el pedido.
 *
 * ## Por qué el historial viaja AGRUPADO POR EPISODIO (versión 2)
 *
 * La versión 1 mandaba "los 5 documentos más nuevos", y eso producía dos
 * defectos que se vieron con un historial real de 47 documentos:
 *
 * 1. **Un episodio quedaba afuera entero.** Una internación de dieciséis días
 *    deja 18 archivos; cinco meses después, ninguno de esos 18 está entre los
 *    5 más nuevos y la ficha no mencionaba la internación en absoluto -el
 *    hecho clínico más importante de la persona, invisible-.
 * 2. **Cada archivo se leía como un evento suelto.** Dieciocho archivos de una
 *    misma internación son UNA internación, no dieciocho estudios.
 *
 * Desde la versión 2 el contexto manda `episodios`: los documentos agrupados
 * por cercanía de fecha (`DIAS_CORTE_EPISODIO`), sin recorte por antigüedad y
 * **sin los documentos que no aportan ningún hecho clínico** (las placas y
 * hojas de imágenes, cuyo resumen habla del archivo -"la imagen sola, sin
 * informe escrito"- y no de lo que se encontró). Esos no se describen: se
 * cuentan, en `adjuntosSinContenidoClinico`.
 *
 * Es MENOS ruido y MÁS señal para el mismo conjunto de columnas: la lista
 * blanca de campos no se tocó -sigue sin viajar `institution`, `doctor_name`,
 * `storage_path` ni `raw_ocr_text`-, cambió QUÉ FILAS entran y cómo se
 * ordenan. La justificación de por qué el historial entero es pertinente
 * -un absceso hepático de hace nueve meses cambia decisiones clínicas de hoy-
 * está en `docs/minimizacion-datos.md` §4.4.
 *
 * ## Puro, pero no isomórfico
 *
 * "Puro" acá significa **sin E/S**: no crea ni recibe un cliente de Supabase,
 * no toca la red y el reloj entra por parámetro (`generadoEn`). Eso es lo que
 * lo hace testeable sin mockear nada. Igual lleva `server-only`, por dos
 * motivos: reutiliza `agruparEnSeries` de `lib/laboratorio/series.ts` (que ya
 * lo tiene) y, sobre todo, porque ningún Client Component debería poder
 * importar por accidente el módulo que decide qué datos personales salen del
 * servidor. La lectura de la base vive aparte, en `lib/ficha/contexto.ts`
 * -misma separación que `lib/estudios/filtros.ts` vs. `consultas.ts`-.
 */

import { agruparEnSeries, type FilaLabMetrica } from "@/lib/laboratorio/series"
import { resumenUltimoValor, type DireccionVariacion } from "@/lib/laboratorio/ultimo-valor"
import { textoCantidadConUnidad } from "@/lib/medicacion/unidades"
import { calcularEdad } from "@/lib/perfiles/edad"
import type { ReglaAlerta } from "@/lib/signos/evaluar"
import {
  DB_A_TIPO,
  ETIQUETA_TIPO,
  TIPOS_SIGNO,
  UNIDAD_TIPO,
  type SignoTipo,
} from "@/lib/signos/tipos"
import type { CategoriaDocumento, FrecuenciaMedicacion, TipoSignoVital } from "@/types/dominio"

/**
 * Versión de la FORMA del contexto. Sube cuando cambia la estructura (o la
 * lista blanca), no cuando cambian los datos. La ficha generada se persiste
 * (tarea 10.5); saber con qué forma de contexto se produjo es lo que permite
 * releerla años después sin adivinar.
 */
export const VERSION_CONTEXTO_CLINICO = 2

/**
 * Cuántas filas de `documents` se leen de la base como mucho. NO es un
 * recorte de contenido -el recorte lo hace `MAXIMO_DOCUMENTOS_CONTEXTO`, ya
 * con los episodios armados-: es el tope defensivo de la CONSULTA, para que
 * un perfil con miles de archivos no traiga la tabla entera a memoria.
 */
export const MAXIMO_DOCUMENTOS_LEIDOS = 200

/**
 * Cuántos documentos CON contenido clínico entran al contexto. Si sobran, se
 * descartan episodios enteros desde el más VIEJO: es preferible que la ficha
 * no mencione una ecografía de 2009 a que mencione media internación.
 */
export const MAXIMO_DOCUMENTOS_CONTEXTO = 40

/**
 * Tope por episodio. Alto a propósito: una internación real deja más de diez
 * documentos con contenido y truncarla es exactamente el defecto que la
 * versión 2 vino a arreglar. Solo actúa ante un episodio anómalo.
 */
export const MAXIMO_DOCUMENTOS_POR_EPISODIO = 14

/**
 * Máxima distancia entre dos documentos CONSECUTIVOS para que sigan siendo el
 * mismo episodio. Treinta días cubre "internación + controles de las semanas
 * siguientes" -que es un solo relato clínico- sin fusionar dos controles
 * anuales.
 */
export const DIAS_CORTE_EPISODIO = 30

/**
 * Tope de duración total de un episodio. Sin él, alguien que se hace un
 * laboratorio cada 25 días encadenaría años enteros en un solo "episodio".
 */
export const DIAS_MAXIMOS_EPISODIO = 120

/** Cuántas mediciones por métrica de laboratorio y por tipo de signo vital entran. */
export const MEDICIONES_POR_TIPO = 3

/* ═══════════════════════════════════════════════════════════════════════════
   1. EL TIPO ES LA LISTA BLANCA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Datos basales de la persona. **Sin nombre, sin documento, sin fecha de
 * nacimiento y sin contacto de emergencia**: la edad es el único dato
 * demográfico que cambia una lectura clínica (dosis, rangos de referencia,
 * riesgo), y la fecha exacta de nacimiento no agrega nada a eso mientras que
 * sí es un identificador de manual.
 *
 * `sexo` no está porque **no existe en el esquema**. No se infiere ni se
 * inventa: un campo demográfico deducido del nombre sería a la vez un dato
 * inventado y un dato identificatorio.
 */
export interface PacienteContexto {
  /** Años cumplidos (`lib/perfiles/edad.ts`). `null` si no hay fecha cargada. */
  edadAnios: number | null
  /** `profiles.blood_type`. Clínico puro. */
  grupoSanguineo: string | null
  /** `profiles.allergies`. Contraindicaciones: el dato que más puede cambiar una indicación. */
  alergias: string[]
  /** `profiles.chronic_conditions`. Es la base de la sección de antecedentes. */
  condicionesCronicas: string[]
  /** `profiles.critical_medication`. Lo que no se puede suspender. */
  medicacionCritica: string[]
  /** `profiles.sos_notes`. Texto libre CLÍNICO ("Marcapasos colocado en 2019"). */
  notasSos: string | null
}

/** Una medicación que la persona está tomando hoy. */
export interface MedicacionContexto {
  /** `medications.name`: la marca comercial, que es lo que dice la caja. */
  nombre: string
  /** `medications.active_ingredient`: la droga, que es lo que entiende un médico. */
  droga: string | null
  /** `medications.presentation` ("Comprimidos 850 mg"): la concentración cambia la dosis. */
  presentacion: string | null
  /** Dosis por toma ya redactada ("1 comprimido"), vía `textoCantidadConUnidad`. */
  dosis: string
  /** Frecuencia en castellano, con los horarios si los tiene. */
  frecuencia: string
  /** `medications.start_date`: hace cuánto está en tratamiento. */
  desde: string | null
  /** `v_medicacion_estado.dias_restantes`: si hay que renovar la receta en la consulta. */
  diasRestantes: number | null
  /** `v_medicacion_estado.necesita_renovacion` (umbral de 5 días, definido en la vista). */
  necesitaRenovacion: boolean
  /** `medications.notes`: indicaciones de toma ("Tomar con las comidas"). */
  indicaciones: string | null
}

/**
 * Un documento del historial que SÍ aporta un hecho clínico, sin quién lo
 * firmó ni dónde se hizo.
 *
 * A diferencia de la versión 1, `resumenIa` no es opcional: un documento sin
 * resumen -o cuyo resumen habla del archivo y no de lo que se encontró- no
 * llega hasta acá, lo filtra `aportaHechoClinico`.
 */
export interface DocumentoContexto {
  /**
   * Ordinal 1..N **dentro de este contexto**, para que la ficha pueda decir
   * "ver estudio 2" sin que viaje ningún uuid. No es un identificador
   * persistente: cambia en cuanto se sube un estudio nuevo.
   */
  indice: number
  /** `documents.document_date`, `YYYY-MM-DD`. */
  fecha: string
  /** Etiqueta en castellano de `documents.category` ("Laboratorio", "Receta"…). */
  categoria: string
  /** `documents.title`. Ver "riesgo residual" en `docs/minimizacion-datos.md` §5. */
  titulo: string
  /** `documents.specialty` ("Cardiología"): el área, no la persona. */
  especialidad: string | null
  /** `documents.ai_summary`: el resumen en lenguaje claro que ya generó el Sprint 4. */
  resumenIa: string
}

/**
 * Un tramo del historial: los documentos que caen juntos en el tiempo y por
 * lo tanto cuentan UN mismo hecho -una internación, una tanda de estudios,
 * un control anual-.
 *
 * `desde` y `hasta` son las fechas de los DOCUMENTOS del tramo, no las de la
 * internación: la fecha exacta de lo que pasó la cuentan los resúmenes, y el
 * prompt le pide explícitamente a Gemini que use esas y no el rango de
 * archivos.
 */
export interface EpisodioContexto {
  /** Ordinal 1..N dentro de este contexto, del episodio más reciente al más viejo. */
  indice: number
  /** Fecha del documento más VIEJO del episodio, `YYYY-MM-DD`. */
  desde: string
  /** Fecha del documento más NUEVO del episodio, `YYYY-MM-DD`. */
  hasta: string
  /** Los documentos con contenido clínico, en orden cronológico ascendente. */
  documentos: DocumentoContexto[]
  /**
   * Cuántos archivos MÁS tiene el episodio que no aportan ningún hecho
   * clínico (placas, hojas de imágenes, hojas de firma). Viaja el NÚMERO para
   * que la ficha sepa que existen y no los confunda con estudios distintos —
   * nunca su texto, que es justamente el membrete que hay que dejar afuera.
   */
  adjuntosSinContenidoClinico: number
}

/** Una medición de una métrica de laboratorio. */
export interface MedicionMetricaContexto {
  /** `lab_metrics.measurement_date`, `YYYY-MM-DD`. */
  fecha: string
  valor: number
  /** Calculado contra el rango impreso en el estudio, no reinterpretado por la IA. */
  fueraDeRango: boolean
}

/** Una métrica de laboratorio con sus últimas mediciones y su tendencia. */
export interface MetricaContexto {
  /** Nombre canónico resuelto por `lib/laboratorio/diccionario.ts` ("Glucemia"). */
  metrica: string
  unidad: string | null
  /** Rango de referencia tal como venía impreso ("70-100", "<200"). */
  rangoReferencia: string | null
  /** Hasta `MEDICIONES_POR_TIPO`, **más reciente primero**. */
  ultimas: MedicionMetricaContexto[]
  /**
   * Dirección del último cambio respecto de la medición anterior. `null` con
   * una sola medición: no se inventa tendencia (mismo criterio que
   * `lib/laboratorio/ultimo-valor.ts`). Es informativa, nunca semántica: dice
   * "subió", no "empeoró".
   */
  tendencia: DireccionVariacion | null
}

/** Una medición de signo vital. */
export interface MedicionSignoContexto {
  /** `vital_signs.measured_at` en ISO: la hora del día cambia la lectura de una glucemia. */
  fecha: string
  /** Solo en tensión. */
  sistolica: number | null
  /** Solo en tensión. */
  diastolica: number | null
  /** Solo en tensión. */
  pulso: number | null
  /** Glucemia en mg/dL o peso en kg. */
  valor: number | null
  /** `vital_signs.notes` ("En ayunas"): cambia por completo cómo se lee una glucemia. */
  nota: string | null
}

/** Los últimos valores de un tipo de signo vital. */
export interface SignoContexto {
  /** Etiqueta en castellano ("Tensión arterial", "Glucemia", "Peso"). */
  signo: string
  unidad: string
  /** Hasta `MEDICIONES_POR_TIPO`, **más reciente primero**. */
  ultimas: MedicionSignoContexto[]
}

/** Una alerta de signos vitales todavía sin ver. */
export interface AlertaContexto {
  /** `vital_sign_alerts.created_at` en ISO. */
  fecha: string
  /** Etiqueta del tipo de signo que la disparó. */
  signo: string
  /** Qué se pasó de umbral, en castellano. */
  motivo: string
  valor: number
  umbral: number
  /** Solo en `peso_variacion`: la mediana de la ventana. `null` en el resto. */
  referencia: number | null
}

/**
 * **El payload completo que sale hacia Gemini.** Nada fuera de este tipo llega
 * a la API. Cualquier campo agregado acá es una decisión de privacidad que hay
 * que justificar en `docs/minimizacion-datos.md` y cubrir en
 * `tests/unit/contexto-ficha.test.ts`.
 */
export interface ContextoClinico {
  version: number
  /** Cuándo se armó ESTE contexto (ISO). Lo estampa el servidor, nunca el cliente. */
  generadoEn: string
  paciente: PacienteContexto
  /** Solo lo vigente hoy, ordenado por nombre. */
  medicacionActiva: MedicacionContexto[]
  /**
   * El historial agrupado por episodio, del más reciente al más viejo, sin
   * los documentos que no aportan ningún hecho clínico. Ver "Por qué el
   * historial viaja AGRUPADO POR EPISODIO" en el encabezado.
   */
  episodios: EpisodioContexto[]
  /**
   * Cuántos archivos del historial quedaron afuera por no aportar ningún
   * hecho clínico, en total. Es el número que hace auditable el filtro: si
   * una ficha "pierde" un estudio, este contador dice si fue por acá.
   */
  documentosSinContenidoClinico: number
  /** Una entrada por métrica, ordenadas alfabéticamente. */
  metricasLaboratorio: MetricaContexto[]
  /** Una entrada por tipo con mediciones, en el orden fijo de `TIPOS_SIGNO`. */
  signosVitales: SignoContexto[]
  /** Alertas sin ver, más reciente primero. */
  alertasActivas: AlertaContexto[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. LAS FILAS DE ENTRADA
   ═══════════════════════════════════════════════════════════════════════════

   Cada tipo declara SOLO las columnas que el armado lee. Como TypeScript
   permite pasar un objeto más ancho donde se espera uno más angosto (el
   chequeo de propiedades en exceso aplica a literales, no a variables), estos
   tipos aceptan la fila COMPLETA de la base -y eso es exactamente lo que hace
   el test del criterio: le pasa `Perfil` y `Documento` enteros, con DNI,
   teléfono, nombre y OCR crudo adentro, y verifica que nada de eso sobreviva
   al armado-.

   `lib/ficha/contexto.ts`, del otro lado, hace `select` solo de estas
   columnas: el DNI ni siquiera sale de la base. Son dos capas independientes
   para el mismo objetivo, y la de acá es la que un test puede probar.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Recorte de `profiles`. Ver `PacienteContexto` para el porqué de cada campo. */
export interface FilaPerfilFuente {
  date_of_birth: string | null
  blood_type: string | null
  allergies: string[] | null
  chronic_conditions: string[] | null
  critical_medication: string[] | null
  sos_notes: string | null
}

/** Recorte de `v_medicacion_estado` (la vista ya filtra `is_active`). */
export interface FilaMedicacionFuente {
  name: string | null
  active_ingredient: string | null
  presentation: string | null
  dose_amount: number | null
  dose_unit: string | null
  frequency: FrecuenciaMedicacion | null
  schedule_times: string[] | null
  interval_hours: number | null
  start_date: string | null
  notes: string | null
  dias_restantes: number | null
  necesita_renovacion: boolean | null
  vigente_hoy: boolean | null
}

/** Recorte de `documents`. */
export interface FilaDocumentoFuente {
  document_date: string
  category: CategoriaDocumento
  title: string
  specialty: string | null
  ai_summary: string | null
}

/** Recorte de `vital_signs`. */
export interface FilaSignoFuente {
  type: TipoSignoVital
  systolic: number | null
  diastolic: number | null
  pulse: number | null
  value: number | null
  measured_at: string
  notes: string | null
}

/** Recorte de `vital_sign_alerts` (solo las que siguen sin ver). */
export interface FilaAlertaFuente {
  tipo: TipoSignoVital
  regla: ReglaAlerta
  valor: number
  umbral: number
  referencia: number | null
  created_at: string
}

/** Todo lo que `lib/ficha/contexto.ts` leyó de la base, sin transformar. */
export interface FuentesClinicas {
  perfil: FilaPerfilFuente
  medicaciones: readonly FilaMedicacionFuente[]
  documentos: readonly FilaDocumentoFuente[]
  metricas: readonly FilaLabMetrica[]
  signos: readonly FilaSignoFuente[]
  alertas: readonly FilaAlertaFuente[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. TEXTOS AUXILIARES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Etiquetas en castellano de las cinco categorías de documento.
 *
 * Duplicadas a propósito de `lib/estudios/categorias.ts#INFO_CATEGORIA`, que
 * es metadata de PRESENTACIÓN: cada entrada de allá trae un componente de
 * `lucide-react` y clases de Tailwind. Importarlo acá arrastraría íconos de
 * React al módulo que decide qué datos personales salen del servidor, a
 * cambio de no repetir cinco strings. Si alguna vez se renombra una etiqueta
 * de cara al usuario, esta tabla puede seguir su propio camino sin problema:
 * lo que lee Gemini no tiene por qué cambiar porque cambió un rótulo de la
 * interfaz.
 */
const ETIQUETA_CATEGORIA: Record<CategoriaDocumento, string> = {
  laboratory: "Laboratorio",
  imaging: "Imágenes",
  prescription: "Receta",
  consultation: "Consulta",
  other: "Otro",
}

/** Qué se pasó de umbral, en castellano, para las cinco reglas del enum. */
const MOTIVO_ALERTA: Record<ReglaAlerta, string> = {
  sistolica_alta: "Presión sistólica por encima del umbral",
  diastolica_alta: "Presión diastólica por encima del umbral",
  glucemia_baja: "Glucemia por debajo del umbral",
  glucemia_alta: "Glucemia por encima del umbral",
  peso_variacion: "Variación de peso fuera de lo esperado",
}

/** `"08:00:00"` (columna `time` de Postgres) → `"08:00"`. */
function horaCorta(hora: string): string {
  return hora.slice(0, 5)
}

/**
 * Frecuencia en castellano. Superconjunto deliberado del `textoFrecuencia`
 * privado de `components/medicacion/tarjeta-medicacion.tsx`: ese muestra los
 * horarios aparte, en chips, y acá tienen que entrar en la misma línea porque
 * el destinatario es un modelo de lenguaje, no una pantalla. No se importa de
 * allá porque no está exportado y porque es un componente de interfaz.
 */
function textoFrecuencia(fila: FilaMedicacionFuente): string {
  if (fila.frequency === "interval_hours") {
    return fila.interval_hours !== null
      ? `Cada ${fila.interval_hours} horas`
      : "A intervalos"
  }
  if (fila.frequency === "as_needed") {
    return "Cuando lo necesite"
  }
  const horarios = fila.schedule_times ?? []
  return horarios.length > 0
    ? `Todos los días (${horarios.map(horaCorta).join(", ")})`
    : "Todos los días"
}

/** Texto opcional normalizado: `""` y `"   "` valen lo mismo que ausente. */
function textoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

/** Array siempre, nunca `null` -las tres columnas son `NOT NULL DEFAULT '{}'`, pero la ficha no puede romperse por un dato escrito por fuera de la app-. */
function arraySiempre(valor: string[] | null | undefined): string[] {
  return Array.isArray(valor) ? valor : []
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. ARMADO POR SECCIÓN
   ═══════════════════════════════════════════════════════════════════════════ */

function armarPaciente(perfil: FilaPerfilFuente, ahora: Date): PacienteContexto {
  return {
    edadAnios: calcularEdad(perfil.date_of_birth, ahora),
    grupoSanguineo: textoOpcional(perfil.blood_type),
    alergias: arraySiempre(perfil.allergies),
    condicionesCronicas: arraySiempre(perfil.chronic_conditions),
    medicacionCritica: arraySiempre(perfil.critical_medication),
    notasSos: textoOpcional(perfil.sos_notes),
  }
}

/**
 * Medicación que se está tomando HOY, ordenada por nombre.
 *
 * `vigente_hoy === false` queda afuera: una medicación activa cuyo curso ya
 * terminó -o que empieza el mes que viene- no es "lo que toma hoy", y la
 * sección de la ficha se llama justamente "medicación actual". `null` **no**
 * se descarta: la columna es `boolean` en la vista y solo llega nullable por
 * el tipo generado; ante la duda entra, porque omitir una medicación de la
 * hoja que se le muestra al médico es el peor error posible de esta sección.
 */
function armarMedicacion(filas: readonly FilaMedicacionFuente[]): MedicacionContexto[] {
  return filas
    .filter((fila) => fila.vigente_hoy !== false)
    .map((fila) => ({
      nombre: textoOpcional(fila.name) ?? "Medicación sin nombre",
      droga: textoOpcional(fila.active_ingredient),
      presentacion: textoOpcional(fila.presentation),
      dosis: textoCantidadConUnidad(fila.dose_amount, fila.dose_unit),
      frecuencia: textoFrecuencia(fila),
      desde: fila.start_date,
      diasRestantes: fila.dias_restantes,
      necesitaRenovacion: fila.necesita_renovacion === true,
      indicaciones: textoOpcional(fila.notes),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
}

/**
 * Frases con las que el propio resumen declara que el documento NO trae
 * hallazgos: es una placa, una hoja de imágenes o la hoja administrativa de
 * un informe que está cargado aparte.
 *
 * No es una lista de palabras "sospechosas" inventada acá: es el vocabulario
 * que produce `lib/gemini/prompt-documento.ts` cuando la página no tiene
 * contenido clínico -regla 5 de ese prompt, que le pide exactamente esas
 * fórmulas-. Las dos piezas son un contrato: si alguna vez se reescribe la
 * regla 5, hay que actualizar esta tabla, y `tests/unit/contexto-ficha.test.ts`
 * lo comprueba con los textos reales.
 *
 * Se comparan sobre el resumen NORMALIZADO (sin tildes, en minúsculas), así
 * "ecógrafo" y "ecografo" son la misma marca.
 */
export const MARCAS_SIN_CONTENIDO_CLINICO = [
  "sin informe",
  "no hay informe escrito",
  "sin hallazgos nuevos",
  "es la imagen sola",
  "la imagen en si",
  "son capturas del estudio",
  "captura del ecografo",
  "capturas del ecografo",
  "datos administrativos",
  "hoja de contacto",
  "cargado por separado",
  "cargada por separado",
  "no un hallazgo del informe",
  "es un documento aparte",
] as const

/** Sin tildes y en minúsculas, para que la comparación no dependa de la ortografía. */
function normalizarResumen(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

/**
 * ¿Este documento cuenta algo que le pasó a la persona?
 *
 * Es el filtro que evita el defecto que reportó el dueño del producto: que la
 * ficha diga "el 29/10/2025 se hizo un estudio en tal sanatorio" en vez de
 * "el 29/10/2025 se le encontró un absceso en el hígado". Ese membrete no lo
 * inventa la ficha: lo hereda de resúmenes de documentos que efectivamente no
 * tienen nada más que contar -una placa escaneada, la hoja de firmas de un
 * informe-. La ficha no puede mejorarlos; lo único correcto es no mostrarlos.
 *
 * Un documento sin resumen tampoco entra: sin `ai_summary` lo único que la
 * ficha podría decir de él es su fecha y su título, que es exactamente el
 * membrete que se quiere evitar.
 */
export function aportaHechoClinico(fila: FilaDocumentoFuente): boolean {
  const resumen = textoOpcional(fila.ai_summary)
  if (resumen === null) return false
  const normalizado = normalizarResumen(resumen)
  return !MARCAS_SIN_CONTENIDO_CLINICO.some((marca) => normalizado.includes(marca))
}

/** Días calendario entre dos fechas `YYYY-MM-DD`. Positivo si `a` es posterior a `b`. */
function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

/** Cuánto "pesa" un documento cuando hay que elegir cuáles entran. */
const PESO_CATEGORIA: Record<CategoriaDocumento, number> = {
  consultation: 5,
  other: 4,
  laboratory: 3,
  imaging: 3,
  prescription: 2,
}

/**
 * Puntaje de un documento, solo para DESEMPATAR cuando un episodio excede
 * `MAXIMO_DOCUMENTOS_POR_EPISODIO`. Una epicrisis o un parte quirúrgico pesan
 * más que una placa informada, y a igual categoría gana el resumen que más
 * cuenta. No cambia el orden de salida -que siempre es cronológico-, solo
 * quién sobrevive al recorte.
 */
function puntajeDocumento(fila: FilaDocumentoFuente): number {
  const peso = PESO_CATEGORIA[fila.category] ?? PESO_CATEGORIA.other
  const largo = Math.min((fila.ai_summary ?? "").trim().length, 999)
  return peso * 1000 + largo
}

/** Filas de un mismo episodio, todavía sin recortar ni mapear. */
interface GrupoEpisodio {
  desde: string
  hasta: string
  conContenido: FilaDocumentoFuente[]
  adjuntos: number
}

/**
 * Agrupa los documentos en episodios por cercanía de fecha.
 *
 * Se recorre de lo más nuevo a lo más viejo y se encadena mientras dos
 * documentos CONSECUTIVOS estén a menos de `DIAS_CORTE_EPISODIO` y el
 * episodio entero no supere `DIAS_MAXIMOS_EPISODIO`. La segunda condición es
 * la que impide que un control cada 25 días encadene años enteros.
 *
 * Los documentos sin contenido clínico **entran al grupo** (para que el
 * episodio los cuente en `adjuntosSinContenidoClinico`) pero no a la lista de
 * documentos: un episodio que solo tuviera placas no aparece en la ficha,
 * porque no habría nada que contar de él.
 */
function agruparEnEpisodios(filas: readonly FilaDocumentoFuente[]): GrupoEpisodio[] {
  const grupos: GrupoEpisodio[] = []

  for (const fila of [...filas].sort((a, b) => b.document_date.localeCompare(a.document_date))) {
    const ultimo = grupos[grupos.length - 1]
    const sigueElMismoEpisodio =
      ultimo !== undefined &&
      diasEntre(ultimo.desde, fila.document_date) <= DIAS_CORTE_EPISODIO &&
      diasEntre(ultimo.hasta, fila.document_date) <= DIAS_MAXIMOS_EPISODIO

    let grupo: GrupoEpisodio
    if (sigueElMismoEpisodio) {
      grupo = ultimo
    } else {
      grupo = {
        desde: fila.document_date,
        hasta: fila.document_date,
        conContenido: [],
        adjuntos: 0,
      }
      grupos.push(grupo)
    }

    grupo.desde = fila.document_date
    if (aportaHechoClinico(fila)) grupo.conContenido.push(fila)
    else grupo.adjuntos += 1
  }

  return grupos
}

/**
 * El historial agrupado por episodio, del más reciente al más viejo.
 *
 * El orden lo impone esta función y no la consulta: así el armado es correcto
 * aunque las filas lleguen en cualquier orden, y el test puede pasarlas
 * desordenadas a propósito. Dentro de cada episodio los documentos salen en
 * orden cronológico ASCENDENTE, que es como se lee un relato: primero la
 * consulta de guardia, después el estudio que encontró el problema, después
 * el procedimiento, después el alta.
 */
function armarEpisodios(filas: readonly FilaDocumentoFuente[]): {
  episodios: EpisodioContexto[]
  sinContenidoClinico: number
} {
  const grupos = agruparEnEpisodios(filas)
  const sinContenidoClinico = grupos.reduce((total, grupo) => total + grupo.adjuntos, 0)

  const episodios: EpisodioContexto[] = []
  let documentosUsados = 0
  let ordinalDocumento = 0

  for (const grupo of grupos) {
    if (grupo.conContenido.length === 0) continue
    if (documentosUsados >= MAXIMO_DOCUMENTOS_CONTEXTO) break

    const cupo = Math.min(
      MAXIMO_DOCUMENTOS_POR_EPISODIO,
      MAXIMO_DOCUMENTOS_CONTEXTO - documentosUsados,
    )

    const elegidos = [...grupo.conContenido]
      .sort((a, b) => puntajeDocumento(b) - puntajeDocumento(a))
      .slice(0, cupo)
      .sort((a, b) => a.document_date.localeCompare(b.document_date))

    documentosUsados += elegidos.length

    episodios.push({
      indice: episodios.length + 1,
      desde: grupo.desde,
      hasta: grupo.hasta,
      documentos: elegidos.map((fila) => ({
        indice: (ordinalDocumento += 1),
        fecha: fila.document_date,
        categoria: ETIQUETA_CATEGORIA[fila.category] ?? ETIQUETA_CATEGORIA.other,
        titulo: fila.title,
        especialidad: textoOpcional(fila.specialty),
        // `aportaHechoClinico` ya garantizó que hay texto: el `?? ""` es solo
        // para el verificador de tipos, nunca ocurre.
        resumenIa: textoOpcional(fila.ai_summary) ?? "",
      })),
      adjuntosSinContenidoClinico: grupo.adjuntos,
    })
  }

  return { episodios, sinContenidoClinico }
}

/**
 * Últimas `MEDICIONES_POR_TIPO` mediciones de cada métrica, con la dirección
 * del último cambio.
 *
 * La agrupación la hace `agruparEnSeries` (`lib/laboratorio/series.ts`), que
 * es la única del proyecto que resuelve el mismatch entre el `metric_canonical`
 * del seed y el que escribe el pipeline de confirmación. Reimplementarla acá
 * partiría "Glucemia" en dos series según de dónde vino el dato.
 *
 * La tendencia sale de `resumenUltimoValor` sobre la serie COMPLETA, no sobre
 * las tres últimas: es exactamente la misma comparación (último contra
 * penúltimo), y hacerla sobre la serie entera evita que el recorte cambie el
 * resultado.
 */
function armarMetricas(filas: readonly FilaLabMetrica[]): MetricaContexto[] {
  return agruparEnSeries(filas).map((serie) => {
    const resumen = resumenUltimoValor(
      serie.puntos.map((punto) => ({
        valor: punto.valor,
        fecha: punto.fecha,
        unidad: punto.unidad,
        min: punto.min,
        max: punto.max,
      })),
    )

    const ultimas = [...serie.puntos]
      .reverse()
      .slice(0, MEDICIONES_POR_TIPO)
      .map((punto) => ({
        fecha: punto.fecha,
        valor: punto.valor,
        fueraDeRango: punto.fueraDeRango,
      }))

    return {
      metrica: serie.etiqueta,
      unidad: serie.unidad,
      rangoReferencia: serie.puntos[serie.puntos.length - 1]?.rangoTexto ?? null,
      ultimas,
      tendencia: resumen.variacion?.direccion ?? null,
    }
  })
}

/**
 * Últimas `MEDICIONES_POR_TIPO` mediciones de cada tipo de signo, en el orden
 * fijo de `TIPOS_SIGNO` (tensión, glucemia, peso).
 *
 * Un tipo sin mediciones no aparece: una sección vacía en la hoja de consulta
 * no dice nada y le gasta contexto al modelo.
 */
function armarSignos(filas: readonly FilaSignoFuente[]): SignoContexto[] {
  const porTipo = new Map<SignoTipo, MedicionSignoContexto[]>()

  const ordenadas = [...filas].sort((a, b) => b.measured_at.localeCompare(a.measured_at))
  for (const fila of ordenadas) {
    const tipo = DB_A_TIPO[fila.type]
    if (!tipo) continue
    const acumuladas = porTipo.get(tipo) ?? []
    if (acumuladas.length >= MEDICIONES_POR_TIPO) continue
    acumuladas.push({
      fecha: fila.measured_at,
      sistolica: fila.systolic,
      diastolica: fila.diastolic,
      pulso: fila.pulse,
      valor: fila.value,
      nota: textoOpcional(fila.notes),
    })
    porTipo.set(tipo, acumuladas)
  }

  const signos: SignoContexto[] = []
  for (const tipo of TIPOS_SIGNO) {
    const ultimas = porTipo.get(tipo)
    if (!ultimas || ultimas.length === 0) continue
    signos.push({ signo: ETIQUETA_TIPO[tipo], unidad: UNIDAD_TIPO[tipo], ultimas })
  }
  return signos
}

/**
 * Alertas sin ver, más reciente primero.
 *
 * No viaja `vital_sign_alerts.mensaje` aunque no tenga nada identificatorio:
 * es texto ya redactado y derivable de `motivo`, `valor` y `umbral`, y su
 * descargo ("no reemplaza el criterio médico") le corresponde a la SALIDA de
 * la ficha (tarea 10.3), no a la entrada. Tampoco viaja el `id` de la alerta
 * ni el de la medición que la disparó -ver "Por qué NO viajan los uuid"-.
 */
function armarAlertas(filas: readonly FilaAlertaFuente[]): AlertaContexto[] {
  return [...filas]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((fila) => ({
      fecha: fila.created_at,
      signo: ETIQUETA_TIPO[DB_A_TIPO[fila.tipo]] ?? "Signo vital",
      motivo: MOTIVO_ALERTA[fila.regla] ?? "Valor fuera de umbral",
      valor: fila.valor,
      umbral: fila.umbral,
      referencia: fila.referencia,
    }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. ARMADO COMPLETO
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Arma el contexto clínico a partir de las filas ya leídas. **Función pura**:
 * sin E/S, sin reloj implícito, sin cliente de Supabase.
 *
 * @param fuentes Filas crudas de la base. Pueden ser las filas COMPLETAS: lo
 *   que sale es únicamente lo que declara `ContextoClinico`.
 * @param generadoEn Momento en que se arma el contexto. Lo pasa quien llama
 *   -siempre el servidor- para que sea inyectable en los tests y para dejar
 *   explícito que el reloj no entra por la puerta de atrás.
 */
export function armarContexto(fuentes: FuentesClinicas, generadoEn: Date): ContextoClinico {
  const historial = armarEpisodios(fuentes.documentos)

  return {
    version: VERSION_CONTEXTO_CLINICO,
    generadoEn: generadoEn.toISOString(),
    paciente: armarPaciente(fuentes.perfil, generadoEn),
    medicacionActiva: armarMedicacion(fuentes.medicaciones),
    episodios: historial.episodios,
    documentosSinContenidoClinico: historial.sinContenidoClinico,
    metricasLaboratorio: armarMetricas(fuentes.metricas),
    signosVitales: armarSignos(fuentes.signos),
    alertasActivas: armarAlertas(fuentes.alertas),
  }
}
