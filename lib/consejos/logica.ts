/**
 * Lógica PURA del tutorial de bienvenida (tarea #14): a qué consejo le toca
 * mostrarse, y si una postergación ("Ahora no") sigue vigente. Sin DOM, sin
 * `next/headers`, sin Supabase — probada sin mocks en
 * `tests/unit/consejos-logica.test.ts` (el proyecto corre los tests en
 * `environment: "node"`, ver `vitest.config.ts`).
 *
 * ## Por qué la usan TANTO el servidor COMO el cliente
 *
 * Las condiciones "¿está pendiente esta función?" se reparten en dos mundos
 * (`docs/tutorial-bienvenida.md` §2): las que el servidor puede calcular
 * (ficha SOS vacía, sin Gmail, sin permisos otorgados, un solo perfil) y las
 * que solo el navegador conoce (PWA instalada, permiso de notificaciones).
 * En vez de escribir DOS algoritmos de prioridad que tendrían que quedar
 * sincronizados a mano, hay UNO solo (`elegirConsejo`) que ambos lados
 * llaman con vistas distintas del mismo problema:
 *
 *   · el servidor lo llama con los cuatro consejos que sabe evaluar en
 *     `pendiente` real, y los dos que no puede (instalar_app,
 *     notificaciones) en `pendiente: false` — nunca ganan ahí, es
 *     literalmente "no sé, no propongas esto todavía";
 *   · el cliente, tras montar, lo vuelve a llamar con `pendiente` real para
 *     esos dos y con `pendiente: id === elegidoDelServidor` para los otros
 *     cuatro — no necesita repetir sus condiciones (evita una segunda
 *     consulta a la base desde el navegador), solo necesita saber CUÁL
 *     ganaba del lado servidor para que la comparación de prioridad global
 *     sea correcta.
 *
 * Las dos llamadas devuelven el mismo resultado cuando ningún consejo
 * client-conocible aplica (el caso más común), que es justamente lo que hace
 * que no haya parpadeo: el primer render del cliente coincide con el del
 * servidor, y el `useEffect` que reevalúa con datos reales del navegador no
 * cambia nada visible salvo en el caso -minoritario- en que sí aplica.
 */

import { CONSEJO_IDS, type ConsejoId, type EstadoFilaConsejo } from "@/lib/consejos/tipos"

export interface EstadoConsejo {
  id: ConsejoId
  /** ¿La función a la que refiere el consejo sigue pendiente? */
  pendiente: boolean
  /** "No mostrar más": descarte permanente. */
  descartado: boolean
  /** "Ahora no", y todavía no arrancó una sesión nueva desde que se tocó. */
  pospuestoActivo: boolean
}

/**
 * El consejo que corresponde mostrar, o `null` si ninguno aplica.
 *
 * Recorre `CONSEJO_IDS` **en su orden de prioridad** (el índice del array
 * ES la prioridad) y devuelve el primero que está pendiente, no descartado y
 * sin una postergación vigente. "Un consejo por visita, el de mayor
 * prioridad aplicable" (criterio de la tarea) es exactamente esto: el
 * primer `true` en un recorrido en orden fijo.
 *
 * Acepta la lista en cualquier orden -no asume que quien llama ya la ordenó-
 * y tolera que falte una entrada para algún id (se trata como "no
 * pendiente"), para que el servidor pueda pasar solo los cuatro que sabe
 * evaluar sin tener que inventar entradas vacías para los otros dos.
 */
export function elegirConsejo(estados: readonly EstadoConsejo[]): ConsejoId | null {
  const porId = new Map(estados.map((estado) => [estado.id, estado]))

  for (const id of CONSEJO_IDS) {
    const estado = porId.get(id)
    if (estado && estado.pendiente && !estado.descartado && !estado.pospuestoActivo) {
      return id
    }
  }

  return null
}

export interface FilaConsejo {
  estado: EstadoFilaConsejo
  /** `updated_at` de la fila, ISO 8601. */
  actualizadoEl: string
}

/** ¿Hay una fila y dice "descartado"? Trivial a propósito: ver `pospuestoSigueActivo` para el caso que sí tiene lógica. */
export function estaDescartado(fila: FilaConsejo | null): boolean {
  return fila?.estado === "descartado"
}

/**
 * ¿La postergación ("Ahora no") sigue vigente?
 *
 * Solo si la fila dice `'pospuesto'` **y** todavía no arrancó una sesión
 * nueva desde que se tocó: se compara `fila.actualizadoEl` (cuándo se
 * pospuso) contra `sesionIniciadaEn` (cuándo arrancó la sesión vigente del
 * navegador, `lib/consejos/sesion.ts`). Si la sesión arrancó DESPUÉS de la
 * postergación, la postergación quedó atrás y el consejo puede volver a
 * proponerse.
 *
 * Comparación por `Date.parse` (vía `new Date(...).getTime()`) y no
 * lexicográfica sobre los strings ISO: Postgres puede devolver el
 * `timestamptz` con `+00:00` y una cantidad de dígitos de fracción de
 * segundo distinta de la que arma `new Date().toISOString()` (que siempre
 * termina en `Z` con exactamente 3 decimales) para la cookie de sesión —dos
 * representaciones válidas del mismo instante que NO se comparan bien
 * carácter a carácter. `getTime()` no tiene esa trampa.
 */
export function pospuestoSigueActivo(fila: FilaConsejo | null, sesionIniciadaEn: string): boolean {
  if (fila?.estado !== "pospuesto") {
    return false
  }
  return new Date(fila.actualizadoEl).getTime() >= new Date(sesionIniciadaEn).getTime()
}
