/**
 * Marca de "posible duplicado" entre correos PENDIENTES de la bandeja de
 * Gmail, por (nombre, tamaño) de sus adjuntos (hotfix de huella digital,
 * Sprint 17 en vivo — punto 5 del encargo).
 *
 * **Puro y sin red.** No baja ningún byte: usa la metadata que el barrido YA
 * registra en `gmail_messages.attachments` (`filename`, `size` —
 * `lib/gmail/mensaje.ts#AdjuntoGmail`, guardada desde
 * `20260818140000_gmail_mensajes.sql`—). Es un aviso DISCRETO y previo al
 * cotejo real: si la persona toca "Revisar este estudio" en el correo
 * marcado, ahí sí corre el cotejo por CONTENIDO (`lib/documentos/huella.ts`,
 * SHA-256 de los bytes) que puede confirmar o descartar la sospecha -dos
 * archivos con el mismo nombre y tamaño no son necesariamente el mismo
 * archivo, así que esto nunca bloquea nada, solo avisa-.
 */

export interface AdjuntoParaDeteccion {
  attachmentId: string
  filename: string
  size: number
  apto: boolean
}

export interface CorreoParaDeteccion {
  id: string
  adjuntos: readonly AdjuntoParaDeteccion[]
}

/**
 * Para cada adjunto APTO que comparte (nombre, tamaño) con un adjunto de OTRO
 * correo pendiente, arma la clave `"{correoId}:{attachmentId}"` -> id del
 * correo emparejado.
 *
 * Cuando hay más de dos correos con el mismo (nombre, tamaño), cada uno se
 * empareja con el SIGUIENTE de la lista, en rueda (el último vuelve al
 * primero): así todos quedan marcados sin tener que elegir uno "canónico", y
 * el texto que arma quien llama ("Posible duplicado del correo de las
 * {hora}") siempre apunta a un correo concreto y existente.
 */
export function emparejarPorNombreYTamano(
  correos: readonly CorreoParaDeteccion[],
): Map<string, string> {
  const porClave = new Map<string, { correoId: string; attachmentId: string }[]>()

  for (const correo of correos) {
    for (const adjunto of correo.adjuntos) {
      if (!adjunto.apto || adjunto.size <= 0) continue
      const clave = `${adjunto.filename}::${adjunto.size}`
      const lista = porClave.get(clave)
      const entrada = { correoId: correo.id, attachmentId: adjunto.attachmentId }
      if (lista) {
        lista.push(entrada)
      } else {
        porClave.set(clave, [entrada])
      }
    }
  }

  const resultado = new Map<string, string>()
  for (const lista of porClave.values()) {
    if (lista.length < 2) continue
    lista.forEach((actual, indice) => {
      const otro = lista[(indice + 1) % lista.length]
      resultado.set(`${actual.correoId}:${actual.attachmentId}`, otro.correoId)
    })
  }

  return resultado
}
