/**
 * Umbrales clínicos ORIENTATIVOS de signos vitales (Sprint 9, tarea 9.2 —
 * ROADMAP_SPRINTS.md).
 *
 * Dos cosas, y nada más: los defaults globales y la función pura que los
 * combina con la fila del perfil. Sin IO, sin reloj, sin Supabase — el motor
 * que los usa (`lib/signos/evaluar.ts`) también es puro, y quien los lee de la
 * base es `lib/signos/registrar-alertas.ts`.
 *
 * ## Los umbrales son orientativos, no diagnóstico
 *
 * Es la frase literal del ROADMAP y no es un descargo legal decorativo: estos
 * seis números son un disparador de "mirá esto", no una clasificación clínica.
 * Ninguna alerta del sistema afirma un diagnóstico, y el texto que produce
 * `evaluar.ts` lo dice siempre (`DESCARGO_CLINICO`), con una constraint de base
 * que lo hace cumplir (`vital_sign_alerts_mensaje_con_descargo`).
 *
 * ## De dónde salen los defaults
 *
 * | Umbral | Default | Por qué ese número |
 * |---|---|---|
 * | `sistolicaMax` | 160 mmHg | Hipertensión grado 2 en la clasificación ESC/ESH. Es el "16" del `16/10` del criterio de aceptación del ROADMAP. |
 * | `diastolicaMax` | 100 mmHg | El "10" del mismo par. |
 * | `glucemiaMin` | 70 mg/dL | El *alert value* de hipoglucemia de la ADA. |
 * | `glucemiaMax` | 250 mg/dL | Zona en la que la guía habitual ya indica control de cetonas. |
 * | `pesoVariacionKg` | 2,0 kg | Ver "la regla de peso", abajo. |
 * | `pesoVentanaDias` | 7 días | Ídem. |
 *
 * ## La regla de peso, argumentada
 *
 * El ROADMAP pide "variación de peso significativa" sin fijar la regla. La
 * elegida es: **|peso nuevo − mediana de los pesos de los últimos 7 días| ≥ 2
 * kg**. Las tres decisiones que la componen:
 *
 * 1. **2 kg y no 3 ni 5.** La referencia clínica más difundida para
 *    insuficiencia cardíaca descompensada es "2 a 3 kg en pocos días", y el
 *    criterio conservador manda quedarse en el borde bajo: en este producto un
 *    falso positivo cuesta una mirada, y un falso negativo puede costar una
 *    internación. Por debajo de 2 kg empieza a competir con el ruido real de
 *    una balanza doméstica y de la hora del día en que uno se pesa.
 * 2. **Contra la MEDIANA de la ventana, no contra la última medición.** Un solo
 *    error de tipeo (78,5 tecleado como 7,85) envenena la referencia si se
 *    compara contra la última: la siguiente medición correcta dispararía una
 *    alerta falsa y, peor, la anterior también. La mediana de la ventana
 *    aguanta un valor absurdo sin moverse. Con una sola medición previa la
 *    mediana ES esa medición, así que la regla degrada exactamente a "contra la
 *    última" y nunca queda sin definir.
 * 3. **Ventana de 7 días y en los DOS sentidos.** Siete días es el horizonte en
 *    el que una variación de 2 kg no puede explicarse por composición corporal:
 *    es líquido (retención → insuficiencia cardíaca) o es deshidratación /
 *    pérdida de masa. Las dos direcciones importan, así que la comparación es
 *    en valor absoluto. Sin ninguna medición en la ventana no hay regla: no se
 *    puede afirmar una variación sin referencia contra la cual variar.
 *
 * ## Contrato con la base
 *
 * `vital_sign_thresholds` (`supabase/migrations/20260814080000_signos_umbrales.sql`
 * §2) tiene las seis columnas `NOT NULL` con estos mismos valores como
 * `DEFAULT`, y la fila por perfil es OPCIONAL: sin fila rigen los defaults de
 * este módulo, y la base ni se consulta. Los números viven en dos lenguajes por
 * necesidad; que no diverjan lo verifica `scripts/test-rls.sql` BLOQUE 14, que
 * lee los `DEFAULT` reales del catálogo y los compara contra estos literales.
 */

/** Los seis umbrales que necesita `evaluarSigno`, ya resueltos (defaults + perfil). */
export interface UmbralesSignos {
  /** Sistólica (mmHg) a partir de la cual se alerta, INCLUSIVE. */
  sistolicaMax: number
  /** Diastólica (mmHg) a partir de la cual se alerta, INCLUSIVE. */
  diastolicaMax: number
  /** Glucemia (mg/dL) en o por debajo de la cual se alerta, INCLUSIVE. */
  glucemiaMin: number
  /** Glucemia (mg/dL) en o por encima de la cual se alerta, INCLUSIVE. */
  glucemiaMax: number
  /** Variación de peso en kg (valor absoluto) que dispara la alerta, INCLUSIVE. */
  pesoVariacionKg: number
  /** Días hacia atrás que forman la ventana de referencia del peso. */
  pesoVentanaDias: number
}

/**
 * Los umbrales que rigen cuando el perfil no tiene fila propia en
 * `vital_sign_thresholds`, que hoy es el caso de todos los perfiles.
 *
 * Cambiar un número de acá alcanza a todos los perfiles no personalizados de
 * inmediato y **no** toca los umbrales que un administrador ya ajustó a mano,
 * ni reescribe las alertas ya emitidas (`vital_sign_alerts.umbral` guarda el
 * umbral aplicado en su momento, a propósito).
 */
export const UMBRALES_POR_DEFECTO: UmbralesSignos = {
  sistolicaMax: 160,
  diastolicaMax: 100,
  glucemiaMin: 70,
  glucemiaMax: 250,
  pesoVariacionKg: 2,
  pesoVentanaDias: 7,
}

/**
 * La fila de `vital_sign_thresholds` tal como la devuelve Supabase. Todos los
 * campos se declaran tolerantes a `null` aunque las columnas sean `NOT NULL`:
 * el tipo generado los da no-nulos, pero esta función también recibe filas
 * parciales de una consulta con `select` acotado y no debe romperse por eso.
 */
export interface FilaUmbralesSignos {
  sistolica_max?: number | null
  diastolica_max?: number | null
  glucemia_min?: number | null
  glucemia_max?: number | null
  peso_variacion_kg?: number | null
  peso_ventana_dias?: number | null
}

/** Un umbral solo reemplaza al default si es un número finito y positivo — un 0, un NaN o el `"70"` de un driver mal tipado no son configuración, son un error. */
function umbralValido(valor: number | null | undefined): valor is number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
}

/**
 * Resuelve los umbrales efectivos de un perfil: los defaults globales, con
 * cada campo pisado por el de la fila cuando la fila existe y trae un valor
 * usable.
 *
 * El merge es **campo por campo** y no "la fila gana entera" aunque la base
 * garantice las seis columnas `NOT NULL`: así una fila legacy, una consulta con
 * `select` acotado o una columna futura agregada en otra migración degradan al
 * default en vez de producir un `undefined` que el motor compararía contra un
 * número (`170 >= undefined` es `false`, es decir: silencio, la peor falla
 * posible para una alerta clínica).
 */
export function combinarUmbrales(fila: FilaUmbralesSignos | null | undefined): UmbralesSignos {
  if (!fila) return { ...UMBRALES_POR_DEFECTO }

  return {
    sistolicaMax: umbralValido(fila.sistolica_max)
      ? fila.sistolica_max
      : UMBRALES_POR_DEFECTO.sistolicaMax,
    diastolicaMax: umbralValido(fila.diastolica_max)
      ? fila.diastolica_max
      : UMBRALES_POR_DEFECTO.diastolicaMax,
    glucemiaMin: umbralValido(fila.glucemia_min)
      ? fila.glucemia_min
      : UMBRALES_POR_DEFECTO.glucemiaMin,
    glucemiaMax: umbralValido(fila.glucemia_max)
      ? fila.glucemia_max
      : UMBRALES_POR_DEFECTO.glucemiaMax,
    pesoVariacionKg: umbralValido(fila.peso_variacion_kg)
      ? fila.peso_variacion_kg
      : UMBRALES_POR_DEFECTO.pesoVariacionKg,
    pesoVentanaDias: umbralValido(fila.peso_ventana_dias)
      ? fila.peso_ventana_dias
      : UMBRALES_POR_DEFECTO.pesoVentanaDias,
  }
}
