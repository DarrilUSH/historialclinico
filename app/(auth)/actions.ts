"use server"

/**
 * Server Actions de autenticación: alta, login, logout y recupero de
 * contraseña con `@supabase/ssr`.
 *
 * Todas usan `lib/supabase/server.ts` (cliente de servidor, cookies vía
 * `next/headers`) — nunca el cliente de navegador ni un `supabase-js` a
 * pelo, porque necesitamos que la sesión que arma `signUp`/`signInWithPassword`
 * quede escrita en las cookies de ESTA request para que la llamada siguiente
 * (el `insert` en `profiles`) ya viaje autenticada.
 *
 * Punto crítico de `registrarse`: la política `profiles_insert_propio_o_gestionado`
 * (supabase/migrations/20260812220000_rls.sql) exige `user_id = auth.uid()`
 * en el INSERT. En local, `supabase/config.toml` tiene
 * `[auth.email] enable_confirmations = false`, así que `signUp` autoconfirma
 * y devuelve `session` en el mismo response — el cliente de servidor que
 * llamó a `signUp` queda autenticado para el resto de la request, y el
 * `insert` de `profiles` corre como el usuario recién creado. Si algún día
 * se habilita confirmación de correo, `data.session` viene `null` y esta
 * función lo contempla: no intenta el insert (fallaría por RLS) y le pide a
 * la persona que confirme el correo antes de entrar.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type { AuthError } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"
import { ACCION, registrarAcceso } from "@/lib/auditoria"
import {
  limpiarCookieTamano,
  sincronizarCookieTamano,
} from "@/lib/densidad/servidor"
import { registrarConsentimientosDeAlta } from "@/lib/legales"
import {
  PARAM_DESDE,
  RUTA_LOGIN,
  RUTA_POST_LOGIN,
  destinoSeguro,
} from "@/lib/auth/rutas"
import { limpiarPerfilActivo } from "@/lib/perfil-activo"

export type EstadoAuth = {
  error: string | null
  mensaje?: string | null
}

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/
const LARGO_MINIMO_CONTRASENA = 8

function normalizarTexto(valor: FormDataEntryValue | null): string {
  return typeof valor === "string" ? valor.trim() : ""
}

/** Mismo criterio que `esCasillaMarcada` de `familia/actions.ts`: un checkbox HTML sin marcar ni siquiera manda su campo en el `FormData`. */
function esCasillaMarcada(valor: FormDataEntryValue | null): boolean {
  return valor === "on" || valor === "true"
}

function esEmailValido(email: string): boolean {
  return PATRON_EMAIL.test(email)
}

/**
 * Arma el origin (protocolo + host) de la request actual a partir de los
 * headers, para construir el `redirectTo` del correo de recupero sin
 * depender de una variable de entorno que todavía no existe en el proyecto.
 * En local coincide con `site_url` de `supabase/config.toml`
 * (`http://127.0.0.1:3000`) siempre que se navegue por `127.0.0.1` y no por
 * `localhost` — Supabase valida el `redirectTo` contra esa lista exacta.
 */
async function obtenerUrlBase(): Promise<string> {
  const encabezados = await headers()
  const host = encabezados.get("host") ?? "127.0.0.1:3000"
  const protocoloForzado = encabezados.get("x-forwarded-proto")
  const esLocal = host.startsWith("127.0.0.1") || host.startsWith("localhost")
  const protocolo = protocoloForzado ?? (esLocal ? "http" : "https")
  return `${protocolo}://${host}`
}

/**
 * Traduce los códigos de error de `@supabase/auth-js` a mensajes en español
 * claro, sin jerga técnica ni detalles internos (nada de stack traces ni
 * "Invalid login credentials" tal cual).
 */
function mapearErrorAuth(error: AuthError): string {
  switch (error.code) {
    case "email_exists":
    case "user_already_exists":
      return "Ya existe una cuenta registrada con ese correo electrónico."
    case "weak_password":
      return `La contraseña es demasiado débil. Usá al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`
    case "invalid_credentials":
      return "La contraseña no es correcta."
    case "email_not_confirmed":
      return "Todavía no confirmaste tu correo electrónico. Revisá tu bandeja de entrada."
    case "email_address_invalid":
      return "El correo electrónico no es válido."
    case "over_email_send_rate_limit":
      return "Se enviaron demasiados correos en poco tiempo. Esperá unos minutos y probá de nuevo."
    case "same_password":
      return "La nueva contraseña tiene que ser distinta de la anterior."
    case "bad_code_verifier":
    case "otp_expired":
    case "flow_state_not_found":
    case "flow_state_expired":
      return 'El enlace no es válido o ya expiró. Pedí uno nuevo desde "Olvidé mi contraseña".'
    case "user_banned":
      return "Esta cuenta está inhabilitada. Escribinos si necesitás ayuda."
    default:
      return "Ocurrió un problema y no pudimos completar la acción. Probá de nuevo en unos minutos."
  }
}

/**
 * Alta de cuenta: crea el usuario en Supabase Auth y su fila en `profiles`.
 * `role` se guarda como `admin` porque quien se registra con cuenta propia
 * es, por definición del modelo de permisos (docs/modelo-permisos.md §3.1),
 * titular y administrador de su propio perfil.
 */
export async function registrarse(
  _estadoPrevio: EstadoAuth,
  formData: FormData,
): Promise<EstadoAuth> {
  const nombreCompleto = normalizarTexto(formData.get("fullName"))
  const email = normalizarTexto(formData.get("email")).toLowerCase()
  const password = normalizarTexto(formData.get("password"))
  const confirmarPassword = normalizarTexto(formData.get("confirmarPassword"))
  const aceptaLegales = esCasillaMarcada(formData.get("aceptaLegales"))

  if (!nombreCompleto) {
    return { error: "Ingresá tu nombre completo." }
  }
  if (!esEmailValido(email)) {
    return { error: "Ingresá un correo electrónico válido." }
  }
  if (password.length < LARGO_MINIMO_CONTRASENA) {
    return {
      error: `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`,
    }
  }
  if (password !== confirmarPassword) {
    return { error: "Las contraseñas no coinciden." }
  }
  // Sprint 12, tarea 12.1 (Ley 25.326): sin este checkbox no hay
  // consentimiento libre, expreso e informado, y por lo tanto no hay base
  // legal para crear la cuenta. `<ConsentimientoLegal />`
  // (components/legal/consentimiento.tsx) ya lo exige del lado del cliente
  // con `required`, pero un `formData` se puede alterar: esta es la
  // revalidación que de verdad importa, igual que `destinoSeguro` en
  // `iniciarSesion`.
  if (!aceptaLegales) {
    return {
      error:
        "Tenés que aceptar la Política de Privacidad y los Términos y Condiciones para crear tu cuenta.",
    }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: nombreCompleto } },
  })

  if (error) {
    return { error: mapearErrorAuth(error) }
  }
  if (!data.user) {
    return { error: "No pudimos crear la cuenta. Probá de nuevo." }
  }

  if (!data.session) {
    return {
      error: null,
      mensaje:
        "Te enviamos un correo para confirmar tu cuenta. Confirmalo y después iniciá sesión.",
    }
  }

  const { error: errorPerfil } = await supabase.from("profiles").insert({
    user_id: data.user.id,
    full_name: nombreCompleto,
    role: "admin",
  })

  if (errorPerfil) {
    return {
      error:
        "Tu cuenta se creó, pero hubo un problema al guardar tu perfil. Iniciá sesión y probá de nuevo, o escribinos si el problema sigue.",
    }
  }

  // Sprint 12, tarea 12.1: el consentimiento a Privacidad y Términos queda
  // registrado con versión y timestamp (criterio de aceptación del
  // ROADMAP). A diferencia de `registrarAcceso` (auditoría de conveniencia),
  // acá el registro ES la prueba de la base legal que habilitó crear la
  // cuenta -por eso `registrarConsentimientosDeAlta` propaga el error en vez
  // de tragarlo, ver el porqué en `lib/legales.ts`-.
  const { error: errorConsentimiento } = await registrarConsentimientosDeAlta(
    supabase,
    data.user.id,
  )

  if (errorConsentimiento) {
    return {
      error:
        "Tu cuenta se creó, pero hubo un problema al registrar tu consentimiento. Iniciá sesión y probá de nuevo, o escribinos si el problema sigue.",
    }
  }

  // Ídem `iniciarSesion`: el perfil recién creado nace en `grande` (el DEFAULT
  // de la columna), pero la cookie que haya en este navegador puede ser de
  // otra cuenta. Sincronizar acá la deja diciendo la verdad desde el primer
  // render, en vez de heredar el modo del último que usó el equipo.
  await sincronizarCookieTamano()

  redirect(RUTA_POST_LOGIN)
}

/**
 * Login. Si el formulario trae el campo oculto `desde` —lo pone la pantalla
 * de login cuando `proxy.ts` interceptó una ruta privada—, se vuelve a esa
 * ruta en vez de ir al selector de perfiles.
 *
 * El valor se revalida acá con `destinoSeguro` aunque la pantalla ya lo haya
 * validado: el `formData` lo manda el navegador y se puede alterar. Sin esta
 * segunda pasada, el login propio sería un open redirect.
 */
export async function iniciarSesion(
  _estadoPrevio: EstadoAuth,
  formData: FormData,
): Promise<EstadoAuth> {
  const email = normalizarTexto(formData.get("email")).toLowerCase()
  const password = normalizarTexto(formData.get("password"))
  const destino = destinoSeguro(normalizarTexto(formData.get(PARAM_DESDE)))

  if (!esEmailValido(email)) {
    return { error: "Ingresá un correo electrónico válido." }
  }
  if (!password) {
    return { error: "Ingresá tu contraseña." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: mapearErrorAuth(error) }
  }

  // Auditoría (lib/auditoria.ts): SIN `perfilId`, porque iniciar sesión no es
  // un acceso a los datos de un tercero. La fila queda a nombre del perfil
  // propio -o sin perfil, si la cuenta todavía no creó el suyo-. Va después
  // del `signInWithPassword` exitoso: un login FALLIDO no genera fila (no hay
  // sesión, y la política de INSERT lo rechazaría igual). `registrarAcceso`
  // no lanza, así que esto no puede dejar a nadie afuera de su historial.
  await registrarAcceso({ accion: ACCION.login })

  // Modo de letra (Sprint 13): iniciar sesión es el momento en que una cuenta
  // empieza a usar ESTE navegador, y por lo tanto el único en que se puede
  // volcar su preferencia guardada a la cookie espejo. Es lo que hace que el
  // modo "viaje entre dispositivos": María entrando por primera vez desde la
  // tablet ve la letra chica que eligió en el celular, sin tocar nada.
  //
  // Pisa la cookie SIEMPRE, incluso si ya había una: en un navegador
  // compartido cuya sesión anterior venció sin logout, la cookie que quedó es
  // de otra persona. Ver `sincronizarCookieTamano` en lib/densidad/servidor.ts.
  await sincronizarCookieTamano()

  redirect(destino ?? RUTA_POST_LOGIN)
}

export async function cerrarSesion(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // El perfil activo es contexto de esta sesión, no debe sobrevivir a un
  // logout: en un navegador compartido, la próxima persona que inicie
  // sesión no tiene por qué heredar (ni siquiera transitoriamente, antes de
  // la primera revalidación) el perfil que dejó la anterior.
  await limpiarPerfilActivo()
  // El modo de letra es preferencia de la CUENTA, no del dispositivo: mismo
  // argumento, misma conclusión. Sin este borrado, la letra chica de María
  // sería el único resto de su sesión que sobrevive al logout y lo primero que
  // vería Roberto al entrar en el mismo navegador.
  await limpiarCookieTamano()
  redirect(RUTA_LOGIN)
}

/**
 * Recupero de contraseña. El mensaje de éxito es idéntico exista o no el
 * correo en la base: distinguirlo dejaría averiguar qué emails están
 * registrados con solo probar este formulario.
 */
export async function recuperarContrasena(
  _estadoPrevio: EstadoAuth,
  formData: FormData,
): Promise<EstadoAuth> {
  const email = normalizarTexto(formData.get("email")).toLowerCase()

  if (!esEmailValido(email)) {
    return { error: "Ingresá un correo electrónico válido." }
  }

  const supabase = await createClient()
  const urlBase = await obtenerUrlBase()

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${urlBase}/recuperar/confirmar`,
  })

  if (error && error.code === "over_email_send_rate_limit") {
    return { error: mapearErrorAuth(error) }
  }

  return {
    error: null,
    mensaje:
      "Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña. Revisá tu bandeja de entrada (y la carpeta de spam).",
  }
}

/**
 * Confirmación del recupero: recibe el `code` (PKCE) que Supabase agrega al
 * `redirectTo` cuando la persona toca el enlace del correo — `@supabase/ssr`
 * fuerza `flowType: "pkce"` en el cliente de servidor, así que el link llega
 * con `?code=...` en vez de un fragmento `#access_token=...` (que el
 * servidor no podría leer). El código se intercambia por sesión recién acá,
 * en esta Server Action, porque es el único lugar de este flujo que puede
 * escribir cookies.
 */
export async function actualizarContrasena(
  _estadoPrevio: EstadoAuth,
  formData: FormData,
): Promise<EstadoAuth> {
  const codigo = normalizarTexto(formData.get("code"))
  const password = normalizarTexto(formData.get("password"))
  const confirmarPassword = normalizarTexto(formData.get("confirmarPassword"))

  if (!codigo) {
    return {
      error:
        'El enlace no es válido o ya expiró. Pedí uno nuevo desde "Olvidé mi contraseña".',
    }
  }
  if (password.length < LARGO_MINIMO_CONTRASENA) {
    return {
      error: `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`,
    }
  }
  if (password !== confirmarPassword) {
    return { error: "Las contraseñas no coinciden." }
  }

  const supabase = await createClient()

  const { error: errorCodigo } = await supabase.auth.exchangeCodeForSession(codigo)
  if (errorCodigo) {
    return {
      error:
        'El enlace no es válido o ya expiró. Pedí uno nuevo desde "Olvidé mi contraseña".',
    }
  }

  const { error: errorActualizacion } = await supabase.auth.updateUser({ password })
  if (errorActualizacion) {
    return { error: mapearErrorAuth(errorActualizacion) }
  }

  redirect(`${RUTA_LOGIN}?recuperada=1`)
}
