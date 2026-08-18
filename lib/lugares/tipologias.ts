/**
 * Categorías de tipología del REFES, agrupadas para que el filtro de
 * `/lugares` sea legible por una persona (Sprint 16, tarea 16.3). Lógica
 * pura, testeada en `tests/unit/lugares-tipologias.test.ts`.
 *
 * ## El problema que resuelve
 *
 * El REFES clasifica cada establecimiento con un `tipologia_id` numérico, una
 * sigla y un nombre largo. Sobre la edición de diciembre de 2025 hay **15 ids
 * distintos y 61 combinaciones sigla+nombre**, con etiquetas que son jerga
 * registral pura: "ESCIETE · Mediano riesgo con internación con cuidados
 * especiales", "ESSIDT · Sin atención médica en forma periódica (menor a 3
 * veces por semana)". Ofrecerle esas 61 opciones a la familia del usuario
 * -público mayor, docs/densidad.md- sería un desplegable inservible.
 *
 * Acá se agrupan los 15 ids en **seis categorías** con nombre en castellano.
 * El agrupamiento es por `tipologia_id` y no por el nombre largo a propósito:
 * el id es un número estable que se filtra en SQL con un `in (...)` y un
 * índice (`health_centers_typology_idx`), mientras que filtrar por textos
 * largos con tildes y paréntesis sería frágil y lento.
 *
 * ## Qué se muestra por defecto
 *
 * Las cinco primeras categorías son LUGARES DE ATENCIÓN: sitios donde una
 * persona saca un turno, se hace un estudio o recibe un tratamiento. La
 * sexta ("Residencias y otros") junta lo que el REFES registra como
 * establecimiento de salud pero no es un lugar al que se va a una consulta:
 * residencias para personas mayores (2.622 filas), dispositivos de inclusión
 * sociolaboral y establecimientos no asistenciales.
 *
 * **Nada se borra de la base**: el catálogo guarda las 36.046 filas completas
 * y la categoría "Residencias y otros" es una opción más del filtro. Lo único
 * que cambia es qué se muestra sin pedirlo -el criterio de la tarea:
 * "tipologías no relevantes para pacientes FILTRABLES", no ausentes-.
 */

/**
 * Valor de "Tipo" que NO filtra nada: incluye también residencias y
 * establecimientos no asistenciales.
 *
 * Vive acá y no en `lib/lugares/consulta.ts` -donde se usa para armar la
 * consulta- porque el desplegable que lo ofrece
 * (`components/lugares/filtros-catalogo.tsx`) es un componente de CLIENTE, y
 * `consulta.ts` empieza con `import "server-only"`: importar una constante
 * desde ahí arrastraría el módulo entero al bundle del navegador y Next lo
 * rechaza en el build (comprobado: `/lugares` respondía 500 con "You're
 * importing a module that depends on server-only").
 */
export const CATEGORIA_TODAS = "todas"

export type CategoriaTipologia =
  | "internacion"
  | "consultorios"
  | "diagnostico"
  | "tratamiento"
  | "complementarios"
  | "residencias"

export interface DefinicionCategoria {
  id: CategoriaTipologia
  /** Etiqueta del filtro, en castellano llano. */
  etiqueta: string
  /** `tipologia_id` del REFES que caen en esta categoría. */
  tipologias: readonly number[]
  /**
   * `true` si es un lugar donde una persona va a atenderse. Las que no lo son
   * quedan fuera del listado por defecto (ver el encabezado).
   */
  esLugarDeAtencion: boolean
}

export const CATEGORIAS_TIPOLOGIA: readonly DefinicionCategoria[] = [
  {
    id: "internacion",
    etiqueta: "Hospitales, clínicas y sanatorios",
    // 10 ESCIG (general) · 11 ESCIEP (pediátrico) · 12 ESCIEM (materno)
    // 13 ESCIESM (salud mental) · 14 ESCIE (especializado) · 15 ESCIETE
    // (tercera edad con internación). Todos "con internación".
    tipologias: [10, 11, 12, 13, 14, 15],
    esLugarDeAtencion: true,
  },
  {
    id: "consultorios",
    etiqueta: "Consultorios y centros de salud",
    // 50 ESSIDT: sin internación, con atención médica (la categoría más
    // numerosa del registro — 17.185 filas).
    tipologias: [50],
    esLugarDeAtencion: true,
  },
  {
    id: "diagnostico",
    etiqueta: "Laboratorios y diagnóstico por imágenes",
    // 51 ESSID: análisis clínicos, imágenes, anatomía patológica.
    tipologias: [51],
    esLugarDeAtencion: true,
  },
  {
    id: "tratamiento",
    etiqueta: "Rehabilitación, diálisis y centros de día",
    // 52 ESSIT: rehabilitación motora, diálisis, oncológicos, salud mental,
    // centros educativos terapéuticos.
    tipologias: [52],
    esLugarDeAtencion: true,
  },
  {
    id: "complementarios",
    etiqueta: "Ópticas, vacunatorios y otros servicios",
    // 53 ESCL: óptica, vacunatorios, ortopedia, bancos de sangre, podología,
    // internación domiciliaria, traslados.
    tipologias: [53],
    esLugarDeAtencion: true,
  },
  {
    id: "residencias",
    etiqueta: "Residencias para personas mayores y otros",
    // 17 ESCIRES (viviendas para personas mayores) · 55 ESIAIS (inclusión
    // sociolaboral) · 80 ESNOASIST (no asistencial).
    tipologias: [17, 55, 80],
    esLugarDeAtencion: false,
  },
] as const

/** Los `tipologia_id` de las categorías que son lugares de atención. */
export const TIPOLOGIAS_DE_ATENCION: readonly number[] = CATEGORIAS_TIPOLOGIA.filter(
  (categoria) => categoria.esLugarDeAtencion,
).flatMap((categoria) => categoria.tipologias)

/** Definición de una categoría por su id, o `undefined` si el id no existe. */
export function categoriaPorId(id: string | null | undefined): DefinicionCategoria | undefined {
  if (!id) return undefined
  return CATEGORIAS_TIPOLOGIA.find((categoria) => categoria.id === id)
}

/**
 * Los `tipologia_id` que hay que pedirle a la base para una elección del
 * filtro.
 *
 * - Una categoría concreta → sus ids.
 * - `null`/desconocida → los ids de las categorías de atención (el default:
 *   todo menos residencias y no asistenciales).
 *
 * Nunca devuelve una lista vacía: un `in ()` vacío en PostgREST devolvería
 * cero filas y la pantalla parecería rota.
 */
export function tipologiasDelFiltro(categoria: string | null | undefined): readonly number[] {
  const definicion = categoriaPorId(categoria)
  return definicion ? definicion.tipologias : TIPOLOGIAS_DE_ATENCION
}

/**
 * Todos los `tipologia_id` conocidos. Se usa para la opción "Todos" del
 * filtro, que sí incluye residencias.
 */
export const TODAS_LAS_TIPOLOGIAS: readonly number[] = CATEGORIAS_TIPOLOGIA.flatMap(
  (categoria) => categoria.tipologias,
)
