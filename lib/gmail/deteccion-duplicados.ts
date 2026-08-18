/**
 * Marca de "posible duplicado" entre correos PENDIENTES de la bandeja de
 * Gmail, por (nombre, tamaño ±2%) de sus adjuntos (hotfix de huella digital,
 * Sprint 17 en vivo — punto 5 del encargo; tolerancia de tamaño agregada por
 * el detector de duplicados semánticos).
 *
 * **Puro y sin red.** No baja ningún byte: usa la metadata que el barrido YA
 * registra en `gmail_messages.attachments` (`filename`, `size` —
 * `lib/gmail/mensaje.ts#AdjuntoGmail`, guardada desde
 * `20260818140000_gmail_mensajes.sql`—). Es un aviso DISCRETO y previo al
 * cotejo real: si la persona toca "Revisar este estudio" en el correo
 * marcado, ahí sí corren los cotejos reales -huella SHA-256 (Capa 1) y
 * duplicados semánticos (Capas 2 y 3, `lib/documentos/duplicados-semanticos.ts`)-
 * que pueden confirmar o descartar la sospecha. Nunca bloquea nada, solo
 * avisa.
 *
 * ## Por qué el tamaño se compara con TOLERANCIA y no con igualdad exacta
 *
 * Un PDF que la clínica REGENERA -el mismo motivo por el que existen las
 * Capas 2 y 3- puede pesar un puñado de bytes distinto del original (otra
 * fecha de generación en los metadatos, compresión ligeramente distinta), sin
 * dejar de ser, para cualquier persona que lo mire, "el mismo archivo". Exigir
 * el tamaño EXACTO -como hacía esta marca antes del detector semántico- deja
 * afuera justo el caso que más le costó al usuario: mismo nombre de adjunto,
 * 2 bytes de diferencia. El ±2% es generoso para variaciones de metadatos de
 * PDF (unos pocos bytes a unos pocos KB, según el tamaño del archivo) sin
 * llegar a confundir dos archivos genuinamente distintos que por azar
 * comparten nombre -algo que además esta marca nunca decide sola: es un aviso
 * previo, el cotejo real sigue siendo por CONTENIDO-.
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

/** Tolerancia de tamaño: 2%, ver el porqué en el encabezado del archivo. */
const TOLERANCIA_TAMANO = 0.02

/** ¿`a` y `b` están dentro del ±2% uno del otro? Cualquiera de los dos en 0 (o negativo) nunca matchea. */
function dentroDeTolerancia(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false
  return Math.abs(a - b) <= TOLERANCIA_TAMANO * Math.max(a, b)
}

interface AdjuntoConCorreo {
  correoId: string
  attachmentId: string
  size: number
}

/**
 * Para cada adjunto APTO que comparte NOMBRE con un adjunto de OTRO correo
 * pendiente y cuyo tamaño está dentro del ±2%, arma la clave
 * `"{correoId}:{attachmentId}"` -> id del correo emparejado.
 *
 * Primero se agrupa por NOMBRE (comparación exacta: dos archivos con nombres
 * distintos nunca se emparejan, tolerancia o no) y, dentro de cada grupo, se
 * arman componentes conexas por tamaño con Union-Find: si A está a ±2% de B,
 * y B está a ±2% de C, los tres quedan en el mismo grupo aunque A y C solos
 * no matchearan entre sí. Es una decisión deliberada -y aceptable-: esta
 * marca es un AVISO discreto y nunca bloquea nada (ver el cotejo real por
 * contenido/datos, Capas 1 a 3), así que agrupar de más cuesta, como mucho,
 * un aviso de más que la persona descarta con un vistazo.
 *
 * Dentro de cada grupo con 2 o más elementos, cada uno se empareja con el
 * SIGUIENTE en rueda (el último vuelve al primero) -mismo criterio que la
 * versión anterior, ahora aplicado por grupo en vez de por clave exacta-: así
 * todos quedan marcados sin tener que elegir uno "canónico", y el texto que
 * arma quien llama ("Posible duplicado del correo de las {hora}") siempre
 * apunta a un correo concreto y existente.
 */
export function emparejarPorNombreYTamano(
  correos: readonly CorreoParaDeteccion[],
): Map<string, string> {
  const porNombre = new Map<string, AdjuntoConCorreo[]>()

  for (const correo of correos) {
    for (const adjunto of correo.adjuntos) {
      if (!adjunto.apto || adjunto.size <= 0) continue
      const lista = porNombre.get(adjunto.filename)
      const entrada = { correoId: correo.id, attachmentId: adjunto.attachmentId, size: adjunto.size }
      if (lista) {
        lista.push(entrada)
      } else {
        porNombre.set(adjunto.filename, [entrada])
      }
    }
  }

  const resultado = new Map<string, string>()

  for (const items of porNombre.values()) {
    if (items.length < 2) continue

    // Union-Find sobre los índices del grupo, por tolerancia de tamaño.
    const padre = items.map((_, indice) => indice)
    function encontrar(indice: number): number {
      while (padre[indice] !== indice) {
        padre[indice] = padre[padre[indice]]
        indice = padre[indice]
      }
      return indice
    }
    function unir(a: number, b: number): void {
      const raizA = encontrar(a)
      const raizB = encontrar(b)
      if (raizA !== raizB) padre[raizA] = raizB
    }

    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        if (dentroDeTolerancia(items[i].size, items[j].size)) unir(i, j)
      }
    }

    const grupos = new Map<number, number[]>()
    items.forEach((_, indice) => {
      const raiz = encontrar(indice)
      const lista = grupos.get(raiz)
      if (lista) {
        lista.push(indice)
      } else {
        grupos.set(raiz, [indice])
      }
    })

    for (const indices of grupos.values()) {
      if (indices.length < 2) continue
      indices.forEach((indiceActual, posicion) => {
        const actual = items[indiceActual]
        const otro = items[indices[(posicion + 1) % indices.length]]
        resultado.set(`${actual.correoId}:${actual.attachmentId}`, otro.correoId)
      })
    }
  }

  return resultado
}
