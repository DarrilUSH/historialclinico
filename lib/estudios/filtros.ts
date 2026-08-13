/**
 * Filtros de la galería de `/estudios` (Sprint 5, tarea 5.2): tipos, parseo
 * y validación de los `searchParams` crudos, y el armado puro de query
 * strings (chips removibles, "Limpiar todo", link "Ver más").
 *
 * Módulo ISOMÓRFICO a propósito -sin `server-only`, mismo criterio que
 * `lib/documentos/sugerir-titulo.ts`-: `components/estudios/filtros-estudios.tsx`
 * (Client Component) necesita `parsearFiltrosEstudios` y las funciones de
 * URL para leer/escribir la URL desde el navegador, y
 * `components/estudios/lista-estudios.tsx` / `app/(app)/(con-nav)/estudios/page.tsx`
 * (Server Components) las necesitan igual para armar la consulta y el link
 * "Ver más". Lo único que SÍ es server-only -porque toca un cliente de
 * Supabase real- es `construirConsultaEstudios` y
 * `obtenerInstitucionesDistintas`, que viven en `lib/estudios/consultas.ts`.
 *
 * ## Nombres de los search params (decisión de la tarea)
 *
 * La galería (tarea 5.1, `components/estudios/lista-estudios.tsx`) ya usaba
 * `?hasta=` como límite ACUMULATIVO de paginación ("mostrar hasta N
 * documentos"). El roadmap pide un filtro de rango de fechas con un
 * "hasta" propio (la fecha tope del rango) -mismo nombre, significado
 * completamente distinto-. En vez de renombrar la paginación (rompería los
 * enlaces "Ver más" ya haseados en cualquier sesión con esa URL guardada,
 * sin ganar nada a cambio), el campo de fecha se llama `hasta_fecha`:
 *
 *   ?categoria=laboratory&institucion=...&desde=2026-01-01&hasta_fecha=2026-12-31&q=...&hasta=30
 *
 * `hasta` sigue siendo SIEMPRE la paginación; `hasta_fecha` es SIEMPRE el
 * rango de fechas. Cualquier cambio de filtro (`aplicarCambiosUrlFiltros`)
 * borra `hasta` de la URL a propósito: la cantidad de documentos que ya se
 * venían mostrando no tiene sentido para un conjunto de resultados distinto.
 *
 * ## Por qué el parseo es tolerante, no estricto
 *
 * Un `searchParams` de Next.js es texto que **cualquiera** puede escribir a
 * mano en la barra de direcciones -no viene de un formulario propio con
 * validación previa-. `parsearFiltrosEstudios` nunca lanza ni devuelve un
 * error: un valor con forma inválida (`categoria=x`, `desde=no-es-fecha`)
 * simplemente se descarta y el filtro queda inactivo, mismo criterio que
 * `normalizarHasta` ya aplicaba a la paginación en
 * `app/(app)/(con-nav)/estudios/page.tsx`.
 */

import type { CategoriaDocumento } from "@/types/dominio"

/** Filtros ya validados, listos para armar la consulta y pintar los chips. */
export interface FiltrosEstudios {
  categoria?: CategoriaDocumento
  institucion?: string
  /** Fecha ISO `YYYY-MM-DD`, límite inferior inclusive de `document_date`. */
  desde?: string
  /** Fecha ISO `YYYY-MM-DD`, límite superior inclusive de `document_date`. */
  hastaFecha?: string
  /** Texto de búsqueda libre, SIN escapar todavía (para mostrar en un chip). */
  q?: string
}

/** `searchParams` crudos de la página, tal como los entrega Next.js. */
export interface SearchParamsFiltrosEstudios {
  categoria?: string
  institucion?: string
  desde?: string
  hasta_fecha?: string
  q?: string
}

const CATEGORIAS_VALIDAS = new Set<string>([
  "laboratory",
  "imaging",
  "prescription",
  "consultation",
  "other",
])

const PATRON_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/

const LARGO_MAXIMO_INSTITUCION = 150
const LARGO_MAXIMO_BUSQUEDA = 100

function esCategoriaValida(valor: string): valor is CategoriaDocumento {
  return CATEGORIAS_VALIDAS.has(valor)
}

/**
 * Normaliza una fecha `YYYY-MM-DD` cruda: `undefined` si no vino, si el
 * formato no calza, o si la fecha no existe de verdad (`"2026-02-30"`) -el
 * mismo chequeo de "round-trip" contra `Date.UTC` que ya usa
 * `lib/validacion/documento.schema.ts#validarFecha"-. Parseo en UTC a
 * propósito: es una fecha pura, sin hora, y no tiene que viajar por ningún
 * huso horario (mismo motivo que documenta `lib/estudios/agrupacion.ts`).
 */
function normalizarFechaIso(cruda: string | undefined): string | undefined {
  if (!cruda) return undefined
  const recortada = cruda.trim()
  const coincidencia = PATRON_FECHA_ISO.exec(recortada)
  if (!coincidencia) return undefined

  const [, anioStr, mesStr, diaStr] = coincidencia
  const anio = Number(anioStr)
  const mes = Number(mesStr)
  const dia = Number(diaStr)

  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  const esValida =
    fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
  return esValida ? recortada : undefined
}

/**
 * Parsea y valida los `searchParams` crudos de `/estudios` en un
 * `FiltrosEstudios` seguro de usar en la consulta.
 *
 * Si `desde` y `hasta_fecha` llegan invertidos (la persona tocó los dos
 * inputs de fecha nativos en cualquier orden, o alguien armó la URL a
 * mano), se intercambian en vez de devolver un rango vacío sin explicación:
 * las fechas ISO son comparables como string sin parsear de nuevo.
 */
export function parsearFiltrosEstudios(crudo: SearchParamsFiltrosEstudios): FiltrosEstudios {
  const categoria =
    crudo.categoria && esCategoriaValida(crudo.categoria) ? crudo.categoria : undefined

  const institucionRecortada = crudo.institucion?.trim()
  const institucion = institucionRecortada
    ? institucionRecortada.slice(0, LARGO_MAXIMO_INSTITUCION)
    : undefined

  let desde = normalizarFechaIso(crudo.desde)
  let hastaFecha = normalizarFechaIso(crudo.hasta_fecha)
  if (desde && hastaFecha && desde > hastaFecha) {
    ;[desde, hastaFecha] = [hastaFecha, desde]
  }

  const qRecortado = crudo.q?.trim()
  const q = qRecortado ? qRecortado.slice(0, LARGO_MAXIMO_BUSQUEDA) : undefined

  return { categoria, institucion, desde, hastaFecha, q }
}

/** ¿Hay al menos un filtro activo (cualquiera de los cinco)? */
export function hayFiltrosActivos(filtros: FiltrosEstudios): boolean {
  return Boolean(filtros.categoria || filtros.institucion || filtros.desde || filtros.hastaFecha || filtros.q)
}

/**
 * Cuenta cuántos filtros están activos -uno por chip renderizado en
 * `filtros-estudios.tsx`-, para el badge de "Filtrar" y para decidir si
 * mostrar "Limpiar todo" (roadmap: solo con 2 o más).
 */
export function contarFiltrosActivos(filtros: FiltrosEstudios): number {
  return [filtros.categoria, filtros.institucion, filtros.desde, filtros.hastaFecha, filtros.q].filter(
    Boolean,
  ).length
}

/**
 * Sanea texto de búsqueda libre antes de usarlo en un patrón `ILIKE`:
 *
 * 1. Recorta a `LARGO_MAXIMO_BUSQUEDA` -ya lo hace `parsearFiltrosEstudios`
 *    para el valor que viaja en la URL, pero esta función es la barrera real
 *    contra la consulta, así que vuelve a aplicarlo por las dudas de que se
 *    la llame directo-.
 * 2. Neutraliza `,` `(` `)` -los caracteres que el mini-lenguaje de
 *    PostgREST usa para separar y agrupar condiciones dentro de `.or()`-
 *    reemplazándolos por un espacio. Sin esto, buscar "Hospital, Central"
 *    rompería el parseo de `.or()` del lado de la base en vez de buscar ese
 *    texto.
 * 3. Escapa `\`, `%` y `_` -los comodines de `ILIKE`- así el texto se busca
 *    SIEMPRE literal: alguien buscando "50%" (un resultado real de una
 *    métrica) no debe activar el comodín de `LIKE`.
 */
export function saneaTextoBusqueda(crudo: string): string {
  const recortado = crudo.trim().slice(0, LARGO_MAXIMO_BUSQUEDA)
  const sinCaracteresReservados = recortado.replace(/[,()]/g, " ")
  return sinCaracteresReservados.replace(/[\\%_]/g, (caracter) => `\\${caracter}`)
}

/**
 * Aplica cambios de filtros a un `URLSearchParams` existente y devuelve el
 * nuevo query string, sin el `?`. Pura y sin dependencias de Next.js a
 * propósito -es la pieza que arma cada chip removible, el botón "Limpiar
 * todo" y cada `<Select>`/input de fecha de `filtros-estudios.tsx"-, así se
 * puede testear con un `URLSearchParams` de Node sin montar ningún componente.
 *
 * `valor: null` (o `""`) borra esa clave; cualquier otro string la fija.
 * Borra `hasta` (paginación) siempre: ver el comentario de cabecera del
 * archivo sobre por qué cualquier cambio de filtro la reinicia.
 */
export function aplicarCambiosUrlFiltros(
  searchParamsActuales: URLSearchParams | string,
  cambios: Record<string, string | null | undefined>,
): string {
  const params = new URLSearchParams(
    typeof searchParamsActuales === "string" ? searchParamsActuales : searchParamsActuales.toString(),
  )

  for (const [clave, valor] of Object.entries(cambios)) {
    if (!valor) {
      params.delete(clave)
    } else {
      params.set(clave, valor)
    }
  }

  params.delete("hasta")
  return params.toString()
}

/**
 * Serializa un `FiltrosEstudios` a los mismos nombres de search param que
 * usa la URL (`categoria`, `institucion`, `desde`, `hasta_fecha`, `q`). La
 * usa el link "Ver más" de `lista-estudios.tsx`: paginación y filtros
 * comparten la misma URL, así que avanzar de página tiene que arrastrar los
 * filtros activos, no solo el `hasta` de la página siguiente.
 */
export function serializarFiltrosEstudios(
  filtros: FiltrosEstudios,
  paramsExtra: Record<string, string> = {},
): string {
  const params = new URLSearchParams()
  if (filtros.categoria) params.set("categoria", filtros.categoria)
  if (filtros.institucion) params.set("institucion", filtros.institucion)
  if (filtros.desde) params.set("desde", filtros.desde)
  if (filtros.hastaFecha) params.set("hasta_fecha", filtros.hastaFecha)
  if (filtros.q) params.set("q", filtros.q)
  for (const [clave, valor] of Object.entries(paramsExtra)) {
    params.set(clave, valor)
  }
  return params.toString()
}

/** Query string sin ningún filtro (ni paginación): lo que arma "Limpiar todo". */
export function limpiarUrlFiltros(searchParamsActuales: URLSearchParams | string): string {
  return aplicarCambiosUrlFiltros(searchParamsActuales, {
    categoria: null,
    institucion: null,
    desde: null,
    hasta_fecha: null,
    q: null,
  })
}
