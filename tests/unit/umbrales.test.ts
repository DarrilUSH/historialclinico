/**
 * Tests del motor de umbrales clínicos (Sprint 9, tarea 9.2).
 *
 * Cubre las dos piezas puras de la tarea:
 *   · `lib/signos/umbrales.ts`  — defaults y merge con la fila del perfil.
 *   · `lib/signos/evaluar.ts`   — qué medición viola qué regla, y qué dice.
 *
 * Lo que NO se prueba acá porque no vive en TypeScript: las políticas RLS de
 * `vital_sign_thresholds`/`vital_sign_alerts`, los CHECK de coherencia, el
 * sellado de `profile_id` y de `acknowledged_by`, y que los `DEFAULT` de la
 * tabla coincidan con `UMBRALES_POR_DEFECTO`. Todo eso es
 * `scripts/test-rls.sql` BLOQUE 14.
 *
 *   npm run test -- umbrales
 */

import { describe, it, expect } from "vitest"

import {
  DESCARGO_CLINICO,
  evaluarSigno,
  mediana,
  pesosEnVentana,
  type MedicionAEvaluar,
  type PesoPrevio,
} from "@/lib/signos/evaluar"
import { UMBRALES_POR_DEFECTO, combinarUmbrales } from "@/lib/signos/umbrales"
import { validarSigno } from "@/lib/validacion/signo.schema"

/** Instante fijo: los tests de peso comparan ventanas, nunca "ahora". */
const AHORA = "2026-08-14T12:00:00.000Z"

function hace(dias: number, horas = 0): string {
  return new Date(Date.parse(AHORA) - dias * 86_400_000 - horas * 3_600_000).toISOString()
}

function tension(systolic: number | null, diastolic: number | null): MedicionAEvaluar {
  return { tipo: "tension", systolic, diastolic, measuredAt: AHORA }
}

function glucemia(value: number): MedicionAEvaluar {
  return { tipo: "glucemia", value, measuredAt: AHORA }
}

function peso(value: number, measuredAt = AHORA): MedicionAEvaluar {
  return { tipo: "peso", value, measuredAt }
}

function pesosPrevios(...pares: [kilos: number, diasAtras: number][]): PesoPrevio[] {
  return pares.map(([kilos, diasAtras]) => ({ valor: kilos, measuredAt: hace(diasAtras) }))
}

const D = UMBRALES_POR_DEFECTO

describe("lib/signos/umbrales.ts — combinarUmbrales", () => {
  it("sin fila devuelve los defaults globales (el caso de todos los perfiles hoy)", () => {
    expect(combinarUmbrales(null)).toEqual({
      sistolicaMax: 160,
      diastolicaMax: 100,
      glucemiaMin: 70,
      glucemiaMax: 250,
      pesoVariacionKg: 2,
      pesoVentanaDias: 7,
    })
    expect(combinarUmbrales(undefined)).toEqual(combinarUmbrales(null))
  })

  it("una fila completa reemplaza los seis umbrales", () => {
    expect(
      combinarUmbrales({
        sistolica_max: 150,
        diastolica_max: 95,
        glucemia_min: 80,
        glucemia_max: 200,
        peso_variacion_kg: 1.5,
        peso_ventana_dias: 14,
      }),
    ).toEqual({
      sistolicaMax: 150,
      diastolicaMax: 95,
      glucemiaMin: 80,
      glucemiaMax: 200,
      pesoVariacionKg: 1.5,
      pesoVentanaDias: 14,
    })
  })

  it("el merge es campo por campo: lo que la fila no trae queda en el default", () => {
    // La base garantiza las seis columnas NOT NULL, pero una consulta con
    // `select` acotado o una fila legacy no deben producir `undefined`: un
    // `170 >= undefined` es `false`, es decir silencio, que es la peor falla
    // posible para una alerta clínica.
    const combinados = combinarUmbrales({ sistolica_max: 140 })
    expect(combinados.sistolicaMax).toBe(140)
    expect(combinados.diastolicaMax).toBe(D.diastolicaMax)
    expect(combinados.glucemiaMin).toBe(D.glucemiaMin)
    expect(combinados.pesoVentanaDias).toBe(D.pesoVentanaDias)
  })

  it("un umbral nulo, cero o no finito no es configuración: degrada al default", () => {
    const combinados = combinarUmbrales({
      sistolica_max: null,
      diastolica_max: 0,
      glucemia_min: Number.NaN,
      glucemia_max: -10,
    })
    expect(combinados.sistolicaMax).toBe(D.sistolicaMax)
    expect(combinados.diastolicaMax).toBe(D.diastolicaMax)
    expect(combinados.glucemiaMin).toBe(D.glucemiaMin)
    expect(combinados.glucemiaMax).toBe(D.glucemiaMax)
  })

  it("no muta UMBRALES_POR_DEFECTO (es una constante compartida por todo el proceso)", () => {
    const combinados = combinarUmbrales(null)
    combinados.sistolicaMax = 999
    expect(UMBRALES_POR_DEFECTO.sistolicaMax).toBe(160)
  })
})

describe("lib/signos/evaluar.ts — tensión arterial", () => {
  it("una presión normal no genera ninguna alerta", () => {
    expect(evaluarSigno(tension(120, 80), D)).toEqual([])
    expect(evaluarSigno(tension(138, 82), D)).toEqual([])
  })

  it("159/99 —justo por debajo del borde— NO dispara nada", () => {
    expect(evaluarSigno(tension(159, 99), D)).toEqual([])
  })

  it("160/100 EXACTO dispara las dos reglas: el umbral es INCLUSIVO (≥)  [CRITERIO DE ACEPTACIÓN]", () => {
    // El 16/10 del ROADMAP. La decisión está documentada en el encabezado de
    // `lib/signos/evaluar.ts`: el umbral pertenece al lado que alerta, de forma
    // uniforme en las cinco reglas. Un `>` en lugar de `>=` rompe este caso.
    const violadas = evaluarSigno(tension(160, 100), D)
    expect(violadas.map((v) => v.regla)).toEqual(["sistolica_alta", "diastolica_alta"])
    expect(violadas[0]).toMatchObject({ valor: 160, umbral: 160, referencia: null, tipo: "tension" })
    expect(violadas[1]).toMatchObject({ valor: 100, umbral: 100, referencia: null, tipo: "tension" })
  })

  it("160/99: dispara solo la sistólica", () => {
    expect(evaluarSigno(tension(160, 99), D).map((v) => v.regla)).toEqual(["sistolica_alta"])
  })

  it("159/100: dispara solo la diastólica", () => {
    expect(evaluarSigno(tension(159, 100), D).map((v) => v.regla)).toEqual(["diastolica_alta"])
  })

  it("170/110 —por encima de los dos umbrales— deja las dos reglas con el valor observado", () => {
    const violadas = evaluarSigno(tension(170, 110), D)
    expect(violadas).toHaveLength(2)
    expect(violadas[0]).toMatchObject({ regla: "sistolica_alta", valor: 170, umbral: 160 })
    expect(violadas[1]).toMatchObject({ regla: "diastolica_alta", valor: 110, umbral: 100 })
  })

  it("el umbral que se persiste es el del PERFIL, no el default", () => {
    const propios = combinarUmbrales({ sistolica_max: 150, diastolica_max: 95 })
    const violadas = evaluarSigno(tension(152, 96), propios)
    expect(violadas.map((v) => v.regla)).toEqual(["sistolica_alta", "diastolica_alta"])
    expect(violadas[0]!.umbral).toBe(150)
    // Con los umbrales por defecto esa misma medición no alerta: es la prueba
    // de que la configuración por perfil se aplica de verdad.
    expect(evaluarSigno(tension(152, 96), D)).toEqual([])
  })

  it("un umbral por perfil MÁS ALTO silencia una medición que el default alertaría", () => {
    const permisivos = combinarUmbrales({ sistolica_max: 180, diastolica_max: 110 })
    expect(evaluarSigno(tension(170, 105), permisivos)).toEqual([])
    expect(evaluarSigno(tension(170, 105), D)).toHaveLength(2)
  })

  it("el mensaje dice el valor, el umbral y SIEMPRE el descargo", () => {
    const [sistolica] = evaluarSigno(tension(170, 90), D)
    expect(sistolica!.mensaje).toBe(
      `Presión sistólica alta: 170 mmHg (umbral de alerta: 160). ${DESCARGO_CLINICO}`,
    )
    expect(sistolica!.mensaje).toContain("no reemplaza el criterio médico")
  })

  it("el extremo de lo que la base acepta (300/200) alerta como cualquier otro valor", () => {
    // `vital_signs_sistolica_plausible` corta en 300 y la diastólica en 200:
    // el motor no vuelve a validar plausibilidad, evalúa peligro.
    expect(evaluarSigno(tension(300, 200), D)).toHaveLength(2)
  })

  it("una tensión sin diastólica (imposible en la base) no lanza ni inventa una alerta", () => {
    // `vital_signs_campos_por_tipo` lo impide; si igual llegara, el motor
    // devuelve lo que puede evaluar y nada más.
    expect(evaluarSigno(tension(170, null), D).map((v) => v.regla)).toEqual(["sistolica_alta"])
    expect(evaluarSigno(tension(null, null), D)).toEqual([])
  })

  it("el VALOR IMPOSIBLE lo frenan Zod y los CHECK, no el motor  [CRITERIO DE ACEPTACIÓN]", () => {
    // Documenta dónde vive esa defensa: una sistólica de 500 nunca llega hasta
    // `evaluarSigno`, porque `lib/validacion/signo.schema.ts` la rechaza antes
    // del viaje de red y `vital_signs_sistolica_plausible` (50–300) la
    // rechazaría igual en la base. Plausibilidad y peligro son dos capas
    // distintas a propósito.
    const rechazado = validarSigno({
      tipo: "tension",
      sistolica: "500",
      diastolica: "90",
      pulso: "",
      valor: "",
      fecha: "2026-08-14",
      hora: "10:00",
    })
    expect(rechazado.ok).toBe(false)

    const negativo = validarSigno({
      tipo: "glucemia",
      sistolica: "",
      diastolica: "",
      pulso: "",
      valor: "-3",
      fecha: "2026-08-14",
      hora: "10:00",
    })
    expect(negativo.ok).toBe(false)
  })
})

describe("lib/signos/evaluar.ts — glucemia", () => {
  it("una glucemia normal no genera nada", () => {
    expect(evaluarSigno(glucemia(100), D)).toEqual([])
    expect(evaluarSigno(glucemia(148), D)).toEqual([])
  })

  it("71 y 249 —justo dentro— no disparan", () => {
    expect(evaluarSigno(glucemia(71), D)).toEqual([])
    expect(evaluarSigno(glucemia(249), D)).toEqual([])
  })

  it("70 EXACTO dispara glucemia_baja: mismo criterio inclusivo que la presión", () => {
    const violadas = evaluarSigno(glucemia(70), D)
    expect(violadas.map((v) => v.regla)).toEqual(["glucemia_baja"])
    expect(violadas[0]).toMatchObject({ valor: 70, umbral: 70, tipo: "glucemia", referencia: null })
  })

  it("250 EXACTO dispara glucemia_alta", () => {
    const violadas = evaluarSigno(glucemia(250), D)
    expect(violadas.map((v) => v.regla)).toEqual(["glucemia_alta"])
    expect(violadas[0]).toMatchObject({ valor: 250, umbral: 250 })
  })

  it("una hipoglucemia franca (65) alerta por debajo", () => {
    const [violada] = evaluarSigno(glucemia(65), D)
    expect(violada).toMatchObject({ regla: "glucemia_baja", valor: 65, umbral: 70 })
    expect(violada!.mensaje).toBe(
      `Glucemia baja: 65 mg/dL (umbral de alerta: 70). ${DESCARGO_CLINICO}`,
    )
  })

  it("una hiperglucemia franca (260) alerta por encima", () => {
    const [violada] = evaluarSigno(glucemia(260), D)
    expect(violada).toMatchObject({ regla: "glucemia_alta", valor: 260, umbral: 250 })
    expect(violada!.mensaje).toBe(
      `Glucemia alta: 260 mg/dL (umbral de alerta: 250). ${DESCARGO_CLINICO}`,
    )
  })

  it("una glucemia nunca produce las dos reglas a la vez", () => {
    for (const valor of [40, 69, 70, 100, 250, 400]) {
      expect(evaluarSigno(glucemia(valor), D).length).toBeLessThanOrEqual(1)
    }
  })

  it("los umbrales del perfil corren el borde en los dos sentidos", () => {
    const propios = combinarUmbrales({ glucemia_min: 80, glucemia_max: 180 })
    expect(evaluarSigno(glucemia(75), propios).map((v) => v.regla)).toEqual(["glucemia_baja"])
    expect(evaluarSigno(glucemia(200), propios).map((v) => v.regla)).toEqual(["glucemia_alta"])
    // Un `glucemia_min` de 69 reproduce el corte exclusivo "< 70" sin tocar código.
    expect(evaluarSigno(glucemia(70), combinarUmbrales({ glucemia_min: 69 }))).toEqual([])
  })

  it("un valor decimal cruza el borde correctamente", () => {
    expect(evaluarSigno(glucemia(69.9), D).map((v) => v.regla)).toEqual(["glucemia_baja"])
    expect(evaluarSigno(glucemia(70.1), D)).toEqual([])
  })
})

describe("lib/signos/evaluar.ts — peso", () => {
  it("la PRIMERA medición de peso no puede tener variación", () => {
    expect(evaluarSigno(peso(82), D, [])).toEqual([])
  })

  it("una referencia fuera de la ventana no cuenta: 10 días atrás no es «los últimos 7»", () => {
    expect(evaluarSigno(peso(85), D, pesosPrevios([78, 10]))).toEqual([])
  })

  it("una medición de HACE EXACTAMENTE 7 DÍAS entra en la ventana (borde izquierdo inclusivo)", () => {
    expect(evaluarSigno(peso(85), D, pesosPrevios([78, 7])).map((v) => v.regla)).toEqual([
      "peso_variacion",
    ])
  })

  it("un aumento de 2,5 kg contra la mediana dispara con el valor, el umbral y la referencia", () => {
    const violadas = evaluarSigno(peso(82.5), D, pesosPrevios([80, 1], [80, 3], [80, 5]))
    expect(violadas).toHaveLength(1)
    expect(violadas[0]).toMatchObject({
      regla: "peso_variacion",
      tipo: "peso",
      valor: 82.5,
      umbral: 2,
      referencia: 80,
    })
    expect(violadas[0]!.mensaje).toBe(
      "Peso 82,5 kg: 2,5 kg más que la referencia de los últimos 7 días " +
        `(80 kg; umbral de alerta: 2 kg). ${DESCARGO_CLINICO}`,
    )
  })

  it("1,9 kg no alcanza: el umbral es 2", () => {
    expect(evaluarSigno(peso(81.9), D, pesosPrevios([80, 1]))).toEqual([])
  })

  it("2 kg EXACTOS disparan (inclusivo, como el resto de las reglas)", () => {
    expect(evaluarSigno(peso(82), D, pesosPrevios([80, 1])).map((v) => v.regla)).toEqual([
      "peso_variacion",
    ])
  })

  it("2 kg exactos disparan también cuando la resta binaria se queda corta", () => {
    // 64,1 − 62,1 da 1.999999999999993 en coma flotante (el resultado cruza el
    // binade de 64). Sin la épsilon del motor, "2 kg exactos disparan" sería
    // verdad o mentira según en qué parte de la recta esté pesando la persona,
    // que es la peor forma posible de definir un umbral clínico.
    expect(64.1 - 62.1).toBeLessThan(2)
    expect(evaluarSigno(peso(64.1), D, pesosPrevios([62.1, 1])).map((v) => v.regla)).toEqual([
      "peso_variacion",
    ])
  })

  it("la BAJA de peso alerta igual que la suba: la comparación es en valor absoluto", () => {
    const [violada] = evaluarSigno(peso(78), D, pesosPrevios([80.5, 2]))
    expect(violada).toMatchObject({ regla: "peso_variacion", valor: 78, referencia: 80.5 })
    expect(violada!.mensaje).toContain("2,5 kg menos que la referencia")
  })

  it("la MEDIANA aguanta un error de tipeo en el historial; la última medición no lo haría", () => {
    // 7,85 es "78,5 mal tecleado". Comparado contra la última medición, 79
    // parecería una variación de 71 kg; contra la mediana (78,5) no varía nada.
    const historial = pesosPrevios([78.5, 1], [7.85, 2], [78.5, 3])
    expect(evaluarSigno(peso(79), D, historial)).toEqual([])
  })

  it("la propia medición no entra en su referencia aunque el llamador la incluya", () => {
    // Borde derecho exclusivo: si entrara, la mediana se contaminaría con el
    // valor que se está evaluando y una variación real quedaría diluida.
    const conSuPropioValor: PesoPrevio[] = [
      { valor: 83, measuredAt: AHORA },
      ...pesosPrevios([80, 1]),
    ]
    expect(evaluarSigno(peso(83, AHORA), D, conSuPropioValor).map((v) => v.regla)).toEqual([
      "peso_variacion",
    ])
  })

  it("la ventana es configurable por perfil", () => {
    const historial = pesosPrevios([80, 3])
    // Con la ventana por defecto (7 días) esa medición de hace 3 días cuenta…
    expect(evaluarSigno(peso(83), D, historial)).toHaveLength(1)
    // …y con una ventana de 1 día ya no hay referencia.
    expect(evaluarSigno(peso(83), combinarUmbrales({ peso_ventana_dias: 1 }), historial)).toEqual([])
  })

  it("un umbral de variación más estricto adelanta la alerta", () => {
    const estricto = combinarUmbrales({ peso_variacion_kg: 1 })
    expect(evaluarSigno(peso(81.2), D, pesosPrevios([80, 1]))).toEqual([])
    expect(evaluarSigno(peso(81.2), estricto, pesosPrevios([80, 1]))).toHaveLength(1)
  })

  it("el mensaje concuerda cuando la ventana es de un solo día", () => {
    const [violada] = evaluarSigno(
      peso(83),
      combinarUmbrales({ peso_ventana_dias: 1 }),
      [{ valor: 80, measuredAt: hace(0, 6) }],
    )
    expect(violada!.mensaje).toContain("la referencia del último día")
  })
})

describe("lib/signos/evaluar.ts — auxiliares de la ventana de peso", () => {
  it("mediana: impar toma el central, par promedia los dos del medio, vacía es null", () => {
    expect(mediana([80, 78, 82])).toBe(80)
    expect(mediana([78, 80, 82, 84])).toBe(81)
    expect(mediana([])).toBeNull()
    expect(mediana([79.5])).toBe(79.5)
  })

  it("pesosEnVentana descarta lo viejo, lo futuro, lo no numérico y lo no positivo", () => {
    const historial: PesoPrevio[] = [
      { valor: 80, measuredAt: hace(1) },
      { valor: 81, measuredAt: hace(30) },
      { valor: 0, measuredAt: hace(2) },
      { valor: Number.NaN, measuredAt: hace(2) },
      { valor: 82, measuredAt: "no es una fecha" },
      { valor: 83, measuredAt: hace(-1) },
    ]
    expect(pesosEnVentana(historial, AHORA, 7)).toEqual([80])
  })

  it("pesosEnVentana con un measured_at ilegible devuelve vacío en vez de romper", () => {
    expect(pesosEnVentana(pesosPrevios([80, 1]), "cualquier cosa", 7)).toEqual([])
  })
})

describe("el descargo clínico", () => {
  it("aparece en el mensaje de TODAS las reglas  [«los umbrales son orientativos, no diagnóstico»]", () => {
    const todas = [
      ...evaluarSigno(tension(180, 115), D),
      ...evaluarSigno(glucemia(60), D),
      ...evaluarSigno(glucemia(300), D),
      ...evaluarSigno(peso(85), D, pesosPrevios([80, 1])),
    ]
    expect(todas.map((v) => v.regla)).toEqual([
      "sistolica_alta",
      "diastolica_alta",
      "glucemia_baja",
      "glucemia_alta",
      "peso_variacion",
    ])
    for (const violada of todas) {
      expect(violada.mensaje.endsWith(DESCARGO_CLINICO)).toBe(true)
      // El fragmento exacto que exige el CHECK de la base
      // `vital_sign_alerts_mensaje_con_descargo`: si dejara de estar, la fila
      // no se podría ni insertar.
      expect(violada.mensaje).toContain("no reemplaza el criterio médico")
    }
  })
})
