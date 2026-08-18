import "server-only"

/**
 * Credenciales del cliente OAuth de Google (Sprint 17, tarea 17.1).
 *
 * `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` son del cliente web del proyecto
 * `gen-lang-client-0873820464` (pantalla de consentimiento "Historial Médico").
 * Ya están cargadas en `.env.local` y en Vercel (Production + Preview) — este
 * módulo solo las lee.
 *
 * ## `server-only` no es decorativo
 *
 * El `client_id` es público por definición (viaja en la URL de consentimiento,
 * lo ve cualquiera). El `client_secret` NO: con él y un `refresh_token` se
 * consiguen access tokens a la casilla de cualquier persona conectada. Están
 * en el mismo módulo porque siempre se usan juntos, y el `import "server-only"`
 * de arriba hace que el build FALLE si algún día alguien importa esto desde un
 * Client Component — el mismo cinturón que `lib/storage-admin.ts` y
 * `lib/auth/cuentas-admin.ts`.
 *
 * ## Falta = 503, no 500
 *
 * Si las variables no están, la aplicación no está rota: está *sin configurar*.
 * `obtenerCredencialesGoogle()` devuelve `null` en vez de lanzar, y quien
 * llama muestra "la conexión con Gmail todavía no está configurada" — que es
 * lo que de verdad pasa, y es accionable (cargar las variables) a diferencia
 * de un error genérico.
 */

export interface CredencialesGoogle {
  clientId: string
  clientSecret: string
}

/** Las credenciales, o `null` si el entorno no las tiene cargadas. */
export function obtenerCredencialesGoogle(): CredencialesGoogle | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (typeof clientId !== "string" || clientId.length === 0) return null
  if (typeof clientSecret !== "string" || clientSecret.length === 0) return null

  return { clientId, clientSecret }
}
