/**
 * Tests de la lógica pura del tutorial de bienvenida (tarea #14): prioridad
 * (`lib/consejos/logica.ts`), condiciones client-conocibles
 * (`lib/consejos/condiciones-cliente.ts`) y los guardas de
 * `lib/consejos/tipos.ts`. Sin DOM: `environment: "node"` en
 * `vitest.config.ts`.
 *
 *   npm run test
 */

import { describe, expect, it } from "vitest"

import {
  instalarAppPendiente,
  notificacionesPendiente,
} from "@/lib/consejos/condiciones-cliente.ts"
import {
  elegirConsejo,
  estaDescartado,
  pospuestoSigueActivo,
  type EstadoConsejo,
} from "@/lib/consejos/logica.ts"
import { CONSEJO_IDS, esConsejoId, esEstadoFilaConsejo } from "@/lib/consejos/tipos.ts"

/** Estado "no aplica" para los cinco consejos que un caso no menciona explícitamente. */
function estadoBase(id: (typeof CONSEJO_IDS)[number]): EstadoConsejo {
  return { id, pendiente: false, descartado: false, pospuestoActivo: false }
}

function estados(parciales: Partial<Record<(typeof CONSEJO_IDS)[number], Partial<EstadoConsejo>>>) {
  return CONSEJO_IDS.map((id) => ({ ...estadoBase(id), ...parciales[id] }))
}

describe("lib/consejos/tipos.ts", () => {
  it("CONSEJO_IDS tiene los seis ids, en el orden de prioridad acordado", () => {
    expect(CONSEJO_IDS).toEqual([
      "instalar_app",
      "ficha_sos",
      "notificaciones",
      "gmail",
      "compartir_familia",
      "perfil_gestionado",
    ])
  })

  it("esConsejoId acepta los seis ids y rechaza cualquier otra cosa", () => {
    for (const id of CONSEJO_IDS) {
      expect(esConsejoId(id)).toBe(true)
    }
    expect(esConsejoId("no_existe")).toBe(false)
    expect(esConsejoId("")).toBe(false)
    expect(esConsejoId(null)).toBe(false)
    expect(esConsejoId(undefined)).toBe(false)
    expect(esConsejoId(42)).toBe(false)
    // Inyección de SQL clásica: si esto alguna vez colara, terminaría en un
    // .upsert() con un consejo_id arbitrario -el CHECK de la tabla lo pararía
    // igual, pero la Server Action tiene que rechazarlo antes de llegar ahí.
    expect(esConsejoId("gmail'; drop table consejos_estado; --")).toBe(false)
  })

  it("esEstadoFilaConsejo acepta solo 'pospuesto' y 'descartado'", () => {
    expect(esEstadoFilaConsejo("pospuesto")).toBe(true)
    expect(esEstadoFilaConsejo("descartado")).toBe(true)
    expect(esEstadoFilaConsejo("activo")).toBe(false)
    expect(esEstadoFilaConsejo("")).toBe(false)
    expect(esEstadoFilaConsejo(null)).toBe(false)
  })
})

describe("lib/consejos/logica.ts#elegirConsejo — prioridad", () => {
  it("sin ningún consejo pendiente, no elige ninguno", () => {
    expect(elegirConsejo(estados({}))).toBeNull()
  })

  it("con un solo consejo pendiente, lo elige", () => {
    const resultado = elegirConsejo(estados({ gmail: { pendiente: true } }))
    expect(resultado).toBe("gmail")
  })

  it("con varios pendientes, gana el de mayor prioridad (menor índice en CONSEJO_IDS)", () => {
    // instalar_app (índice 0) le gana a los otros cinco, sin importar el
    // orden en que se los pasa al array.
    const resultado = elegirConsejo(
      estados({
        perfil_gestionado: { pendiente: true },
        instalar_app: { pendiente: true },
        gmail: { pendiente: true },
      }),
    )
    expect(resultado).toBe("instalar_app")
  })

  it("respeta el orden completo: ficha_sos > notificaciones > gmail > compartir_familia > perfil_gestionado", () => {
    const todosMenosInstalar = estados({
      ficha_sos: { pendiente: true },
      notificaciones: { pendiente: true },
      gmail: { pendiente: true },
      compartir_familia: { pendiente: true },
      perfil_gestionado: { pendiente: true },
    })
    expect(elegirConsejo(todosMenosInstalar)).toBe("ficha_sos")

    const sinFichaSos = estados({
      notificaciones: { pendiente: true },
      gmail: { pendiente: true },
      compartir_familia: { pendiente: true },
      perfil_gestionado: { pendiente: true },
    })
    expect(elegirConsejo(sinFichaSos)).toBe("notificaciones")

    const soloGmailYDespues = estados({
      gmail: { pendiente: true },
      compartir_familia: { pendiente: true },
      perfil_gestionado: { pendiente: true },
    })
    expect(elegirConsejo(soloGmailYDespues)).toBe("gmail")

    const soloCompartirYGestionado = estados({
      compartir_familia: { pendiente: true },
      perfil_gestionado: { pendiente: true },
    })
    expect(elegirConsejo(soloCompartirYGestionado)).toBe("compartir_familia")

    const soloGestionado = estados({ perfil_gestionado: { pendiente: true } })
    expect(elegirConsejo(soloGestionado)).toBe("perfil_gestionado")
  })

  it("un consejo descartado NUNCA gana, aunque esté pendiente y sea el de mayor prioridad", () => {
    const resultado = elegirConsejo(
      estados({
        instalar_app: { pendiente: true, descartado: true },
        gmail: { pendiente: true },
      }),
    )
    expect(resultado).toBe("gmail")
  })

  it("un consejo con postergación vigente no gana; el siguiente pendiente sí", () => {
    const resultado = elegirConsejo(
      estados({
        ficha_sos: { pendiente: true, pospuestoActivo: true },
        notificaciones: { pendiente: true },
      }),
    )
    expect(resultado).toBe("notificaciones")
  })

  it("descartado Y pospuesto a la vez sigue sin ganar (caso degenerado, no debería pasar en la práctica)", () => {
    const resultado = elegirConsejo(
      estados({ gmail: { pendiente: true, descartado: true, pospuestoActivo: true } }),
    )
    expect(resultado).toBeNull()
  })

  it("tolera una lista incompleta (el servidor solo manda los ids que sabe evaluar)", () => {
    const soloDos: EstadoConsejo[] = [
      { id: "gmail", pendiente: true, descartado: false, pospuestoActivo: false },
      { id: "perfil_gestionado", pendiente: true, descartado: false, pospuestoActivo: false },
    ]
    expect(elegirConsejo(soloDos)).toBe("gmail")
  })

  it("con la lista vacía, no elige nada", () => {
    expect(elegirConsejo([])).toBeNull()
  })

  it("no le importa el orden en que llegan los estados en el array de entrada", () => {
    const enOrdenInverso = [...estados({ ficha_sos: { pendiente: true }, gmail: { pendiente: true } })].reverse()
    expect(elegirConsejo(enOrdenInverso)).toBe("ficha_sos")
  })
})

describe("lib/consejos/logica.ts#estaDescartado", () => {
  it("null (sin fila) no está descartado", () => {
    expect(estaDescartado(null)).toBe(false)
  })

  it("una fila 'pospuesto' no cuenta como descartada", () => {
    expect(estaDescartado({ estado: "pospuesto", actualizadoEl: "2026-08-18T10:00:00.000Z" })).toBe(
      false,
    )
  })

  it("una fila 'descartado' sí lo está", () => {
    expect(estaDescartado({ estado: "descartado", actualizadoEl: "2026-08-18T10:00:00.000Z" })).toBe(
      true,
    )
  })
})

describe("lib/consejos/logica.ts#pospuestoSigueActivo — el corazón del mecanismo de sesión", () => {
  it("null (sin fila) nunca está pospuesto", () => {
    expect(pospuestoSigueActivo(null, "2026-08-18T10:00:00.000Z")).toBe(false)
  })

  it("una fila 'descartado' no es una postergación (aunque tenga fecha)", () => {
    expect(
      pospuestoSigueActivo(
        { estado: "descartado", actualizadoEl: "2026-08-18T10:00:00.000Z" },
        "2026-08-18T09:00:00.000Z",
      ),
    ).toBe(false)
  })

  it("pospuesto DESPUÉS de que arrancó la sesión: sigue activo (misma visita, no reaparece)", () => {
    const sesionArranco = "2026-08-18T09:00:00.000Z"
    const seSpuso = "2026-08-18T09:05:00.000Z" // 5 minutos más tarde, misma sesión
    expect(
      pospuestoSigueActivo({ estado: "pospuesto", actualizadoEl: seSpuso }, sesionArranco),
    ).toBe(true)
  })

  it("pospuesto ANTES de que arrancara la sesión vigente: ya no está activo (sesión nueva, reaparece)", () => {
    const sePospusoAyer = "2026-08-17T09:00:00.000Z"
    const sesionArrancoHoy = "2026-08-18T08:00:00.000Z"
    expect(
      pospuestoSigueActivo({ estado: "pospuesto", actualizadoEl: sePospusoAyer }, sesionArrancoHoy),
    ).toBe(false)
  })

  it("empate exacto (mismo instante) cuenta como sigue activo (>=, borde inclusivo)", () => {
    const instante = "2026-08-18T09:00:00.000Z"
    expect(pospuestoSigueActivo({ estado: "pospuesto", actualizadoEl: instante }, instante)).toBe(
      true,
    )
  })

  it("compara por instante real, no lexicográficamente: distintas representaciones ISO del mismo momento", () => {
    // Mismo instante exacto, dos formatos válidos de timestamptz de Postgres.
    // Una comparación de strings a secas rompería acá: "999999+00:00" > "000Z"
    // en orden de caracteres aunque el instante sea idéntico.
    const conOffset = "2026-08-18T09:00:00.000000+00:00"
    const conZ = "2026-08-18T09:00:00.000Z"
    expect(pospuestoSigueActivo({ estado: "pospuesto", actualizadoEl: conOffset }, conZ)).toBe(true)
  })

  it("un timestamp con más precisión de fracción de segundo compara bien igual", () => {
    const sesionArranco = "2026-08-18T09:00:00.499999+00:00" // Postgres, microsegundos
    const sePospusoUnPocoAntes = "2026-08-18T09:00:00.400Z" // navegador, milisegundos
    expect(
      pospuestoSigueActivo(
        { estado: "pospuesto", actualizadoEl: sePospusoUnPocoAntes },
        sesionArranco,
      ),
    ).toBe(false)

    const sePospusoUnPocoDespues = "2026-08-18T09:00:00.600Z"
    expect(
      pospuestoSigueActivo(
        { estado: "pospuesto", actualizadoEl: sePospusoUnPocoDespues },
        sesionArranco,
      ),
    ).toBe(true)
  })
})

describe("lib/consejos/condiciones-cliente.ts#notificacionesPendiente", () => {
  it("'default' (nunca se le preguntó) está pendiente", () => {
    expect(notificacionesPendiente("default")).toBe(true)
  })

  it("'denied' está pendiente (consigna literal de la tarea: !== 'granted')", () => {
    expect(notificacionesPendiente("denied")).toBe(true)
  })

  it("'granted' NO está pendiente", () => {
    expect(notificacionesPendiente("granted")).toBe(false)
  })

  it("'sin_soporte' (el navegador no tiene la API) NO está pendiente: no hay nada que ofrecer", () => {
    expect(notificacionesPendiente("sin_soporte")).toBe(false)
  })
})

describe("lib/consejos/condiciones-cliente.ts#instalarAppPendiente", () => {
  it("celular, sin instalar: pendiente", () => {
    expect(instalarAppPendiente({ enModoStandalone: false, esViewportMovil: true })).toBe(true)
  })

  it("celular, ya instalada: no pendiente", () => {
    expect(instalarAppPendiente({ enModoStandalone: true, esViewportMovil: true })).toBe(false)
  })

  it("desktop/tablet ancha, sin instalar: no pendiente (el consejo es específicamente de celular)", () => {
    expect(instalarAppPendiente({ enModoStandalone: false, esViewportMovil: false })).toBe(false)
  })

  it("desktop, instalada: no pendiente", () => {
    expect(instalarAppPendiente({ enModoStandalone: true, esViewportMovil: false })).toBe(false)
  })
})
