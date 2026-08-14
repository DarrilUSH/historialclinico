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
 * referirse a un estudio, usa `EstudioContexto.indice` -un ordinal 1..N válido
 * SOLO dentro de este contexto-, y quien lo consuma vuelve a la fila por
 * posición en el mismo arreglo con el que armó el pedido.
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
export const VERSION_CONTEXTO_CLINICO = 1

/** Cuántos estudios recientes entran. Fijado por el roadmap (tarea 10.2). */
export const MAXIMO_ESTUDIOS = 5

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

/** Un estudio reciente, sin quién lo firmó ni dónde se hizo. */
export interface EstudioContexto {
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
  resumenIa: string | null
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
  /** Hasta `MAXIMO_ESTUDIOS`, más reciente primero. */
  estudiosRecientes: EstudioContexto[]
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
 * Los últimos `MAXIMO_ESTUDIOS`, más reciente primero.
 *
 * El orden lo impone esta función y no la consulta: así el recorte a 5 es
 * correcto aunque las filas lleguen en cualquier orden, y el test puede
 * pasarlas desordenadas a propósito.
 */
function armarEstudios(filas: readonly FilaDocumentoFuente[]): EstudioContexto[] {
  return [...filas]
    .sort((a, b) => b.document_date.localeCompare(a.document_date))
    .slice(0, MAXIMO_ESTUDIOS)
    .map((fila, posicion) => ({
      indice: posicion + 1,
      fecha: fila.document_date,
      categoria: ETIQUETA_CATEGORIA[fila.category] ?? ETIQUETA_CATEGORIA.other,
      titulo: fila.title,
      especialidad: textoOpcional(fila.specialty),
      resumenIa: textoOpcional(fila.ai_summary),
    }))
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
  return {
    version: VERSION_CONTEXTO_CLINICO,
    generadoEn: generadoEn.toISOString(),
    paciente: armarPaciente(fuentes.perfil, generadoEn),
    medicacionActiva: armarMedicacion(fuentes.medicaciones),
    estudiosRecientes: armarEstudios(fuentes.documentos),
    metricasLaboratorio: armarMetricas(fuentes.metricas),
    signosVitales: armarSignos(fuentes.signos),
    alertasActivas: armarAlertas(fuentes.alertas),
  }
}
