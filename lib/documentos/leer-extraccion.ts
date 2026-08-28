import "server-only"

/**
 * Leer la extracción de un documento que TODAVÍA está esperando revisión
 * (Sprint 20 — "una foto, el lugar correcto").
 *
 * Lo usan las dos pantallas de destino del ruteo -`/medicacion/nuevo?doc=…` y
 * `/turnos/nuevo?doc=…`- para precargarse con lo que la IA ya leyó, sin volver
 * a pedirle nada a Gemini y sin que ningún dato de salud viaje por la URL.
 *
 * ## Tres guardas, y ninguna es decorativa
 *
 * 1. **El cliente es el del USUARIO, nunca `service_role`.** Si RLS no devuelve
 *    la fila, la función devuelve `null` y la pantalla se comporta como el alta
 *    manual de siempre. No se distingue "no existe" de "no tenés permiso"
 *    (principio 3 de `docs/modelo-permisos.md`).
 *
 * 2. **`confirmed_at` tiene que ser NULL.** `ai_extraction` se limpia en la
 *    misma transacción que confirma el documento, así que un documento
 *    confirmado no tiene nada que dar; pedirlo explícito deja escrito que este
 *    camino solo existe en la ventana entre la lectura y la confirmación, que
 *    es exactamente cuando la intención sirve para algo.
 *
 * 3. **El jsonb se REVALIDA con Zod.** Ya pasó por `validarExtraccion` cuando
 *    se guardó, pero entre aquel momento y este hay una columna `jsonb` de por
 *    medio, y el tipo generado de Supabase para eso es `Json` -es decir,
 *    cualquier cosa-. Volver a validarlo cuesta microsegundos y es lo que hace
 *    que el resto del camino pueda tratar el resultado como
 *    `DocumentoMedicoExtraido` de verdad y no como una promesa.
 */

import type { ClienteSupabaseServidor } from "@/lib/auth/guardas"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import { validarExtraccion } from "@/lib/validacion/documento.schema"

export interface ExtraccionDeDocumento {
  documentoId: string
  /** Perfil DUEÑO del documento, que puede no ser el activo (Web Share Target). */
  perfilId: string
  extraccion: DocumentoMedicoExtraido
}

/** Forma de uuid, la misma que usan las demás pantallas antes de consultar. */
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La extracción del documento `documentoId`, o `null` si no hay ninguna
 * utilizable (id mal formado, documento inexistente o sin permiso, ya
 * confirmado, o un jsonb que no valida).
 *
 * `null` NUNCA es un error para quien llama: significa "seguí como el alta
 * manual de siempre". Ninguna de las dos pantallas de destino depende de esto
 * para funcionar.
 */
export async function leerExtraccionDeDocumento(
  supabase: ClienteSupabaseServidor,
  documentoId: string | undefined,
): Promise<ExtraccionDeDocumento | null> {
  if (!documentoId || !PATRON_UUID.test(documentoId)) return null

  const { data: fila } = await supabase
    .from("documents")
    .select("id, profile_id, ai_extraction")
    .eq("id", documentoId)
    .is("confirmed_at", null)
    .maybeSingle()

  if (!fila || fila.ai_extraction === null) return null

  const validacion = validarExtraccion(fila.ai_extraction)
  if (!validacion.ok) return null

  return {
    documentoId: fila.id,
    perfilId: fila.profile_id,
    extraccion: validacion.datos,
  }
}
