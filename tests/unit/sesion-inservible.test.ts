/**
 * `esSesionInservible` — la frontera entre el ruido esperado y un error de
 * autenticación que hay que mirar (auditoría de seguridad 11.4, hallazgo
 * A-03; `lib/supabase/proxy.ts`).
 *
 * Por qué merece test propio: el predicado decide qué se degrada a una línea
 * de `info` y qué sigue subiendo como error. Ensancharlo de más —por ejemplo
 * aceptando `validation_failed` a secas, que GoTrue devuelve también ante un
 * cuerpo mal formado— convertiría el proxy en un silenciador de problemas
 * reales de Auth, y nada en la aplicación lo delataría: la request seguiría
 * respondiendo 401 igual. Los casos negativos de acá son el contrato.
 *
 * Los errores se construyen a mano en vez de importar `AuthApiError` de
 * `@supabase/auth-js` porque lo único que consume el predicado es la forma
 * (`code` + `message`), y fabricarla explícita deja a la vista qué campos
 * son los que deciden.
 */

import { describe, expect, it } from "vitest"

import type { AuthError } from "@supabase/supabase-js"

import { esSesionInservible } from "@/lib/supabase/proxy"

function errorDeAuth(code: string | undefined, message: string): AuthError {
  return { name: "AuthApiError", message, code, status: 400 } as AuthError
}

describe("esSesionInservible", () => {
  it("reconoce el refresh token revocado por un logout en otra pestaña", () => {
    expect(
      esSesionInservible(
        errorDeAuth("refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found"),
      ),
    ).toBe(true)
  })

  it("reconoce el refresh token que otra pestaña ya canjeó", () => {
    expect(
      esSesionInservible(errorDeAuth("refresh_token_already_used", "Already Used")),
    ).toBe(true)
  })

  it("reconoce la sesión caducada", () => {
    expect(esSesionInservible(errorDeAuth("session_expired", "Session Expired"))).toBe(true)
  })

  it("reconoce la cookie corrupta, que GoTrue reporta como validation_failed", () => {
    // Es lo que devuelve ante un `refresh_token` manipulado o truncado: el
    // código es genérico, pero el mensaje dice de qué se trata.
    expect(
      esSesionInservible(errorDeAuth("validation_failed", "Refresh token is not valid")),
    ).toBe(true)
  })

  it("NO se traga un validation_failed que no habla del refresh token", () => {
    expect(
      esSesionInservible(errorDeAuth("validation_failed", "Unable to validate email address")),
    ).toBe(false)
  })

  it("NO se traga un error de credenciales", () => {
    expect(
      esSesionInservible(errorDeAuth("invalid_credentials", "Invalid login credentials")),
    ).toBe(false)
  })

  it("NO se traga un rate limit de Auth", () => {
    expect(
      esSesionInservible(errorDeAuth("over_request_rate_limit", "Request rate limit reached")),
    ).toBe(false)
  })

  it("NO se traga un error sin código (AuthSessionMissingError, el visitante anónimo)", () => {
    expect(esSesionInservible(errorDeAuth(undefined, "Auth session missing!"))).toBe(false)
  })

  it("NO se traga un error inesperado del servidor de Auth", () => {
    expect(esSesionInservible(errorDeAuth("unexpected_failure", "Internal Server Error"))).toBe(
      false,
    )
  })
})
