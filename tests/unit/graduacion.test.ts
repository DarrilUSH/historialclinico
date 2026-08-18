/**
 * Tests de la GRADUACIÓN de perfiles gestionados (Sprint 15, tarea 15.2:
 * `lib/auth/cuentas-admin.ts` + `supabase/migrations/20260817230000_graduacion.sql`).
 *
 * ## Qué se prueba acá y qué no
 *
 * El COMPORTAMIENTO de la graduación —que el perfil quede vinculado, que no
 * se pueda robar uno ajeno, que la cuenta nazca sin consentimientos, que la
 * autoridad se transfiera— vive en la base y lo cubre el BLOQUE 21 de
 * `scripts/test-rls.sql`, con 34 casos contra sesiones simuladas. Duplicarlo
 * en Vitest sería reimplementar la base con mocks y probar los mocks.
 *
 * Lo que sí puede fallar del lado del código, y por eso está acá, son dos
 * cosas que ningún test de SQL puede ver:
 *
 * 1. **Qué le manda exactamente la aplicación a la Admin API.** El claim
 *    `perfil_existente` tiene que viajar en `app_metadata` y NUNCA en
 *    `user_metadata`. La diferencia no es de estilo: `user_metadata` es lo
 *    que escribe cualquiera desde el navegador con la clave anónima
 *    (`options.data` de `signUp`), así que si el claim viajara ahí, un
 *    `signUp` preparado con el uuid de un perfil gestionado ajeno bastaría
 *    para adueñarse de su historial médico. Es el caso hostil que el BLOQUE
 *    21 prueba del lado de la base; estos tests lo cierran del lado del
 *    emisor, para que nadie "simplifique" el payload sin enterarse.
 * 2. **Que la migración viva siga leyendo de donde corresponde.** Un test de
 *    texto sobre el SQL, del mismo tipo que el espejo de `VERSION_LEGALES` en
 *    `alta-de-cuenta.test.ts`: barato, y delata un cambio que de otro modo
 *    solo se notaría en una auditoría de seguridad.
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockCreateUser } = vi.hoisted(() => ({ mockCreateUser: vi.fn() }))

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { createUser: mockCreateUser } },
  })),
}))

import { graduarPerfilConCuentaNueva } from "@/lib/auth/cuentas-admin"

const DATOS = {
  email: "tomas@ejemplo.com.ar",
  password: "contrasena-larga",
  nombre: "Tomás Gómez",
  perfilId: "3f2b1c9e-1111-4111-8111-111111111111",
}

/** Forma mínima de un `AuthError` de GoTrue: lo que el módulo mira son `code` y `status`. */
function errorDeAuth(code: string | undefined, status: number, message = "error") {
  return { code, status, message, name: "AuthApiError" }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-servicio-de-prueba"
  mockCreateUser.mockResolvedValue({ data: { user: { id: "cuenta-nueva-1" } }, error: null })
})

describe("graduarPerfilConCuentaNueva — qué viaja a la Admin API", () => {
  it("manda perfil_existente en app_metadata (la metadata que el usuario NO puede escribir)", async () => {
    await graduarPerfilConCuentaNueva(DATOS)

    const payload = mockCreateUser.mock.calls[0][0]
    expect(payload.app_metadata).toEqual({ perfil_existente: DATOS.perfilId })
  })

  it("[SEGURIDAD] NO manda perfil_existente en user_metadata", async () => {
    await graduarPerfilConCuentaNueva(DATOS)

    const payload = mockCreateUser.mock.calls[0][0]
    // `user_metadata` es `options.data` de `signUp`: la escribe cualquiera con
    // la clave anónima. Un claim de titularidad ahí sería una puerta abierta.
    expect(payload.user_metadata).not.toHaveProperty("perfil_existente")
    expect(payload.user_metadata).toEqual({ full_name: DATOS.nombre })
  })

  it("[LEGAL] no manda legales_version: los documentos los acepta el nuevo titular", async () => {
    await graduarPerfilConCuentaNueva(DATOS)

    const payload = mockCreateUser.mock.calls[0][0]
    // Guardar la versión "vigente al graduar" dejaría a mano un dato con el
    // que sellar un consentimiento que su titular nunca dio.
    expect(payload.user_metadata).not.toHaveProperty("legales_version")
    expect(payload.app_metadata).not.toHaveProperty("legales_version")
  })

  it("crea la cuenta con el correo ya confirmado (local y producción se comportan igual)", async () => {
    await graduarPerfilConCuentaNueva(DATOS)

    const payload = mockCreateUser.mock.calls[0][0]
    expect(payload.email_confirm).toBe(true)
    expect(payload.email).toBe(DATOS.email)
    expect(payload.password).toBe(DATOS.password)
  })

  it("devuelve el id de la cuenta creada cuando sale bien", async () => {
    const resultado = await graduarPerfilConCuentaNueva(DATOS)

    expect(resultado).toEqual({ fallo: null, userId: "cuenta-nueva-1" })
  })

  it("NO hace ninguna escritura extra después del alta (la vinculación es del trigger)", async () => {
    await graduarPerfilConCuentaNueva(DATOS)

    // Una segunda llamada -un `update` de profiles, por ejemplo- abriría una
    // ventana en la que la cuenta existe y el perfil todavía no está
    // vinculado. El módulo no expone nada más que `createUser` justamente
    // para que eso no se pueda escribir por descuido.
    expect(mockCreateUser).toHaveBeenCalledTimes(1)
  })
})

describe("graduarPerfilConCuentaNueva — traducción de los fallos", () => {
  it.each([
    ["email_exists", 422, "email_en_uso"],
    ["user_already_exists", 422, "email_en_uso"],
    ["email_address_invalid", 400, "email_invalido"],
    ["weak_password", 422, "contrasena_debil"],
  ])("%s → %s", async (code, status, esperado) => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: errorDeAuth(code, status),
    })

    const resultado = await graduarPerfilConCuentaNueva(DATOS)

    expect(resultado).toEqual({ fallo: esperado, userId: null })
  })

  it("un error 500 de la base es la vinculación rechazada por el trigger", async () => {
    // GoTrue no propaga el SQLSTATE ni el mensaje de Postgres: contesta un 500
    // genérico. Es la única señal disponible de que el trigger abortó el alta.
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: errorDeAuth(undefined, 500, "Database error creating new user"),
    })

    const resultado = await graduarPerfilConCuentaNueva(DATOS)

    expect(resultado.fallo).toBe("vinculacion_rechazada")
  })

  it("cualquier otra cosa cae en desconocido, nunca en un éxito silencioso", async () => {
    mockCreateUser.mockResolvedValue({
      data: { user: null },
      error: errorDeAuth("over_request_rate_limit", 429),
    })

    expect((await graduarPerfilConCuentaNueva(DATOS)).fallo).toBe("desconocido")
  })

  it("una respuesta sin error pero sin usuario tampoco se reporta como éxito", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: null }, error: null })

    const resultado = await graduarPerfilConCuentaNueva(DATOS)

    expect(resultado).toEqual({ fallo: "desconocido", userId: null })
  })
})

describe("la migración de graduación lee el claim de donde corresponde", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../../supabase/migrations/20260817230000_graduacion.sql"),
    "utf8",
  )

  /** El SQL sin sus comentarios de línea: el encabezado NOMBRA las dos metadatas para explicar la diferencia. */
  const codigo = sql
    .split("\n")
    .filter((linea) => !linea.trimStart().startsWith("--"))
    .join("\n")

  it("lee perfil_existente de raw_app_meta_data", () => {
    expect(codigo).toContain("raw_app_meta_data ->> 'perfil_existente'")
  })

  it("[SEGURIDAD] NO lee perfil_existente de raw_user_meta_data", () => {
    expect(codigo).not.toContain("raw_user_meta_data ->> 'perfil_existente'")
  })

  it("la vinculación exige que el perfil no tenga dueño, en el propio UPDATE", () => {
    // Atómico y no "consultar antes, decidir después": dos graduaciones
    // simultáneas del mismo perfil no pueden ganar las dos.
    expect(codigo).toMatch(
      /update public\.profiles\s+set user_id = p_user_id\s+where id = v_perfil_id\s+and user_id is null;/,
    )
  })

  it("solo deshace el alta automática de LA MISMA transacción (created_at = now())", () => {
    // `now()` es `transaction_timestamp()`: la igualdad se cumple si y solo si
    // la fila nació en esta transacción. Es lo que impide que estamparle el
    // claim a una cuenta vieja le borre su perfil real. Si alguien la
    // relajara a una ventana de tiempo, este caso lo delata.
    const borrados = codigo.match(/delete from public\.profiles[\s\S]*?;/g) ?? []
    expect(borrados.length).toBeGreaterThan(0)
    for (const borrado of borrados) {
      expect(borrado).toContain("p.created_at = now()")
      expect(borrado).toContain("p.created_by_profile_id is null")
    }
  })

  it("engancha la graduación en un trigger de UPDATE de raw_app_meta_data", () => {
    // GoTrue escribe el app_metadata propio DESPUÉS del INSERT (medido). Si
    // alguien volviera a colgar la graduación solo del AFTER INSERT, la
    // vinculación dejaría de ocurrir en silencio — el bug que se encontró
    // probando en el teléfono.
    expect(codigo).toContain("after update of raw_app_meta_data on auth.users")
  })

  it("no dropea ni comenta el trigger de alta (auth.users no es nuestra)", () => {
    // `auth.users` la tiene `supabase_auth_admin`: DROP TRIGGER y
    // COMMENT ON TRIGGER fallan con 42501. Lección documentada en
    // docs/estado-proyecto.md.
    expect(codigo).not.toMatch(/drop trigger[\s\S]*auth\.users/i)
    expect(codigo).not.toMatch(/comment on trigger/i)
  })
})
