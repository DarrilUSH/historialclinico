/**
 * Transformación PURA de filas de `vital_signs` a la serie que pinta
 * `components/signos/grafico-signo.tsx` (Sprint 9, tarea 9.4 —
 * ROADMAP_SPRINTS.md). Sin IO, sin Supabase, sin reloj salvo el parámetro
 * `ahora` del corte de período -mismo criterio "puro y testeable" que
 * `lib/signos/evaluar.ts` y `lib/laboratorio/series.ts#agruparEnSeries`-.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  QUÉ CUENTA COMO "FUERA DE UMBRAL": LAS ALERTAS PERSISTIDAS, NO RECALCULAR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `docs/modelo-signos.md` §11 -el contrato que las tareas 9.2/9.3 dejaron
 * escrito explícitamente para esta tarea- ya decidió esto: la marca de
 * "fuera de umbral" de cada punto sale de `vital_sign_alerts` por
 * `vital_sign_id` -las alertas que `lib/signos/registrar-alertas.ts` generó
 * en el momento de la carga, contra el umbral QUE REGÍA ESE DÍA-, no de
 * recalcular con `evaluarSigno()` contra los umbrales de HOY. Cita textual
 * del modelo: *"Una medición vieja marcada contra el umbral de hoy contaría
 * una historia que no pasó"* -si mañana un médico sube `sistolica_max` a
 * 170, la medición de 165 de la semana pasada tiene que seguir mostrándose
 * como lo que fue ese día: fuera de umbral-.
 *
 * La banda de referencia sombreada es la otra mitad de la misma frase del
 * modelo: *"ahí sí van los umbrales ACTUALES, porque la banda describe el
 * criterio vigente, no el pasado"*. Por eso `construirSerieSigno` recibe
 * `umbrales` (resueltos con `combinarUmbrales` sobre la fila de HOY del
 * perfil, `lib/signos/consultas.ts#obtenerUmbralesDelPerfil`) para la banda,
 * pero nunca los usa para decidir qué punto se marca -esa decisión ya la
 * tomó `registrarAlertasDeSigno` en su momento, y vive en `alertas`-.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ TENSIÓN DEVUELVE DOS ARREGLOS DE PUNTOS, NO UNA SERIE CON DOS CAMPOS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `evaluarSigno` puede violar `sistolica_alta` y `diastolica_alta` a la vez
 * -165/102 del seed viola las dos- o una sola de las dos -una sistólica alta
 * con diastólica normal no es el mismo hecho clínico, `docs/modelo-signos.md`
 * §6-, así que cada línea necesita SU PROPIO marcado independiente. Separar
 * en `sistolica`/`diastolica` desde acá -en vez de que
 * `components/signos/grafico-signo.tsx` tenga que desarmar un array de
 * pares- es lo que permite tratar tensión como "dos líneas simples", cada
 * una con su propia forma de punto (triángulo) y su propio umbral (160/100).
 * Las dos quedan siempre alineadas índice a índice porque
 * `vital_signs_campos_por_tipo` exige sistólica Y diastólica juntas para
 * `blood_pressure`: nunca hay una sin la otra en la misma fila.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  LA BANDA DE PESO: NINGUNA, A PROPÓSITO (decisión de la 9.4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El umbral de peso (`peso_variacion_kg`) no es un rango fijo del eje Y como
 * sistólica/diastólica/glucemia: es una distancia contra la MEDIANA MÓVIL de
 * los `peso_ventana_dias` días anteriores a CADA medición
 * (`lib/signos/evaluar.ts#mediana` + `#pesosEnVentana`), así que "la banda"
 * cambiaría de lugar en cada punto -no es una `ReferenceArea` de Recharts,
 * que pinta un rectángulo fijo entre dos números constantes-. Pintar esa
 * referencia de verdad exigiría una segunda línea recalculada punto por
 * punto, una pieza nueva que ningún componente de gráfico de este proyecto
 * sabe pintar todavía. Se decidió NO construirla para esta tarea: el peso se
 * grafica como línea simple SIN banda sombreada, y el punto fuera de umbral
 * se marca igual que los otros dos tipos -con la marca visual y el texto de
 * la alerta persistida, que ya trae `referencia` (la mediana que se usó ese
 * día) y permite mostrar el delta exacto-. `components/signos/grafico-signo.tsx`
 * muestra además una nota visible explicando la ausencia de banda, para que
 * la decisión no quede solo en un comentario de código que nadie que use la
 * app llega a leer.
 */

import type { ReglaAlerta } from "@/lib/signos/evaluar"
import { calcularCorteSignos, type PeriodoSignos } from "@/lib/signos/periodo"
import type { SignoTipo } from "@/lib/signos/tipos"
import type { UmbralesSignos } from "@/lib/signos/umbrales"

/** Fila mínima de `vital_signs` que necesita este módulo -nunca la fila cruda de Supabase, arma esta forma `lib/signos/consultas.ts#obtenerHistorialSigno`-. */
export interface FilaVitalSignParaSerie {
  id: string
  /** `measured_at`, ISO con offset. */
  measuredAt: string
  systolic: number | null
  diastolic: number | null
  value: number | null
}

/**
 * Fila mínima de `vital_sign_alerts` que necesita este módulo -TODAS las del
 * perfil, vistas o no: una alerta ya marcada como vista en el banner sigue
 * siendo un hecho clínico pasado que el historial tiene que seguir
 * mostrando, a diferencia de `lib/signos/alertas-sin-ver.ts` que sí filtra
 * por `acknowledged_at is null` porque ese módulo es del banner, no del
 * historial-.
 */
export interface FilaAlertaParaSerie {
  vitalSignId: string
  regla: ReglaAlerta
  valor: number
  umbral: number
  referencia: number | null
}

/** Un punto ya resuelto para el gráfico: valor, si está fuera de umbral, y el texto corto para el panel de detalle. */
export interface PuntoSerieSigno {
  vitalSignId: string
  /** `measured_at`, ISO con offset. */
  fecha: string
  valor: number
  fueraDeUmbral: boolean
  /** "arriba" pinta triángulo, "abajo" pinta rombo -mismo lenguaje visual que `components/estudios/grafico-metrica.tsx` usa para "por encima del máximo"/"por debajo del mínimo"-. `null` cuando el punto no está fuera de umbral. */
  direccion: "arriba" | "abajo" | null
  /** Texto corto para el panel de detalle, p. ej. "Por encima del umbral (160)". Distinto del `mensaje` largo de `vital_sign_alerts` -ese lleva el descargo clínico completo y es el texto del BANNER (`components/signos/banner-alerta.tsx`), no el del historial-. `null` cuando el punto no está fuera de umbral. */
  etiquetaUmbral: string | null
}

export interface SerieSignoTension {
  tipo: "tension"
  sistolica: PuntoSerieSigno[]
  diastolica: PuntoSerieSigno[]
  /** Umbral ACTUAL del perfil (no el que regía cuando se cargó cada punto): la banda describe el criterio vigente. */
  umbralSistolica: number
  umbralDiastolica: number
}

export interface SerieSignoGlucemia {
  tipo: "glucemia"
  puntos: PuntoSerieSigno[]
  umbralMin: number
  umbralMax: number
}

export interface SerieSignoPeso {
  tipo: "peso"
  puntos: PuntoSerieSigno[]
}

export type SerieSigno = SerieSignoTension | SerieSignoGlucemia | SerieSignoPeso

const FORMATO = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 })

/** Coma decimal y sin ceros de relleno: "160", "82,5" -mismo formato que usa `lib/signos/evaluar.ts#n` para que el número del historial se vea igual que el del mensaje de alerta-. */
function n(valor: number): string {
  return FORMATO.format(valor)
}

/**
 * Texto corto del panel de detalle para una regla violada. Deliberadamente
 * MÁS CORTO que `mensaje` de `vital_sign_alerts` (que lleva "Presión
 * sistólica alta: 165 mmHg (umbral de alerta: 160). Valor orientativo — no
 * reemplaza el criterio médico."): acá alcanza con la frase mínima que pide
 * el criterio de aceptación del ROADMAP, "Por encima del umbral (160)" — el
 * historial ya muestra el valor exacto al lado, en el propio punto.
 */
export function etiquetaFueraDeUmbral(
  alerta: Pick<FilaAlertaParaSerie, "regla" | "umbral" | "valor" | "referencia">,
): string {
  switch (alerta.regla) {
    case "sistolica_alta":
    case "diastolica_alta":
    case "glucemia_alta":
      return `Por encima del umbral (${n(alerta.umbral)})`
    case "glucemia_baja":
      return `Por debajo del umbral (${n(alerta.umbral)})`
    case "peso_variacion": {
      if (alerta.referencia === null) {
        return `Variación de peso ≥ ${n(alerta.umbral)} kg respecto de la referencia`
      }
      const delta = alerta.valor - alerta.referencia
      const direccion = delta >= 0 ? "más" : "menos"
      return `${n(Math.abs(delta))} kg ${direccion} que la referencia (${n(alerta.referencia)} kg)`
    }
    default:
      return "Fuera del umbral orientativo"
  }
}

/** "arriba" (triángulo) salvo `glucemia_baja` (siempre por debajo) y `peso_variacion` cuando el valor nuevo quedó por debajo de la referencia -las dos únicas reglas con un lado "hacia abajo" posible-. */
function direccionDe(alerta: FilaAlertaParaSerie): "arriba" | "abajo" {
  if (alerta.regla === "glucemia_baja") return "abajo"
  if (alerta.regla === "peso_variacion") {
    return alerta.referencia !== null && alerta.valor < alerta.referencia ? "abajo" : "arriba"
  }
  return "arriba"
}

/**
 * Filas dentro del período, ordenadas por fecha ascendente. No asume que
 * `filas` venga ordenada ni recortada -mismo criterio que `agruparEnSeries`
 * de laboratorio-, así se puede testear con arreglos armados a mano en
 * cualquier orden.
 *
 * Compara por INSTANTE (`Date.parse`), no por orden lexicográfico del string
 * -a diferencia de `measurement_date` (un `date` puro, siempre
 * `YYYY-MM-DD`, donde `localeCompare` alcanza), `measured_at` es un
 * `timestamptz` y dos representaciones ISO válidas del mismo instante
 * pueden no ordenar igual como texto (`"...Z"` vs. `"...+00:00"`)-.
 */
function filasEnPeriodo(
  filas: readonly FilaVitalSignParaSerie[],
  periodo: PeriodoSignos,
  ahora: Date,
): FilaVitalSignParaSerie[] {
  const corte = calcularCorteSignos(periodo, ahora)
  const corteMs = corte === null ? null : Date.parse(corte)

  const filtradas =
    corteMs === null ? [...filas] : filas.filter((fila) => Date.parse(fila.measuredAt) >= corteMs)

  return filtradas.sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt))
}

/** La alerta de una medición para alguna de `reglas`, o `null` si no violó ninguna. El índice único `(vital_sign_id, regla)` de la base garantiza a lo sumo una por regla. */
function buscarAlerta(
  alertas: readonly FilaAlertaParaSerie[],
  vitalSignId: string,
  reglas: readonly ReglaAlerta[],
): FilaAlertaParaSerie | null {
  return alertas.find((alerta) => alerta.vitalSignId === vitalSignId && reglas.includes(alerta.regla)) ?? null
}

function puntoDe(fila: FilaVitalSignParaSerie, valor: number, alerta: FilaAlertaParaSerie | null): PuntoSerieSigno {
  return {
    vitalSignId: fila.id,
    fecha: fila.measuredAt,
    valor,
    fueraDeUmbral: alerta !== null,
    direccion: alerta ? direccionDe(alerta) : null,
    etiquetaUmbral: alerta ? etiquetaFueraDeUmbral(alerta) : null,
  }
}

/**
 * Arma la serie de UN tipo de signo, ya recortada al período, ordenada, y con
 * cada punto marcado fuera-de-umbral usando las alertas persistidas (ver el
 * encabezado del archivo).
 *
 * `filas` tiene que venir YA filtrada al tipo -`obtenerHistorialSigno` trae
 * un solo tipo por consulta, mismo criterio que
 * `obtenerUltimasMedicionesPorTipo`-; `alertas` puede traer las de TODO el
 * perfil sin filtrar por tipo: se cruzan acá por `vitalSignId`, así que una
 * alerta de otro tipo simplemente no matchea ningún punto de esta serie.
 */
export function construirSerieSigno(
  tipo: SignoTipo,
  filas: readonly FilaVitalSignParaSerie[],
  alertas: readonly FilaAlertaParaSerie[],
  umbrales: UmbralesSignos,
  periodo: PeriodoSignos,
  ahora: Date = new Date(),
): SerieSigno {
  const enPeriodo = filasEnPeriodo(filas, periodo, ahora)

  if (tipo === "tension") {
    const sistolica: PuntoSerieSigno[] = []
    const diastolica: PuntoSerieSigno[] = []
    for (const fila of enPeriodo) {
      if (fila.systolic != null && fila.diastolic != null) {
        sistolica.push(puntoDe(fila, fila.systolic, buscarAlerta(alertas, fila.id, ["sistolica_alta"])))
        diastolica.push(puntoDe(fila, fila.diastolic, buscarAlerta(alertas, fila.id, ["diastolica_alta"])))
      }
    }
    return {
      tipo: "tension",
      sistolica,
      diastolica,
      umbralSistolica: umbrales.sistolicaMax,
      umbralDiastolica: umbrales.diastolicaMax,
    }
  }

  if (tipo === "glucemia") {
    const puntos: PuntoSerieSigno[] = []
    for (const fila of enPeriodo) {
      if (fila.value != null) {
        puntos.push(puntoDe(fila, fila.value, buscarAlerta(alertas, fila.id, ["glucemia_baja", "glucemia_alta"])))
      }
    }
    return { tipo: "glucemia", puntos, umbralMin: umbrales.glucemiaMin, umbralMax: umbrales.glucemiaMax }
  }

  const puntos: PuntoSerieSigno[] = []
  for (const fila of enPeriodo) {
    if (fila.value != null) {
      puntos.push(puntoDe(fila, fila.value, buscarAlerta(alertas, fila.id, ["peso_variacion"])))
    }
  }
  return { tipo: "peso", puntos }
}
