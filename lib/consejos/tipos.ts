/**
 * Vocabulario compartido del tutorial de bienvenida (tarea #14,
 * `docs/tutorial-bienvenida.md`).
 *
 * Sin ningún import de React ni de Next.js: este archivo lo consumen tres
 * mundos distintos que no pueden compartir nada más pesado —
 *
 *   · `proxy.ts` (el middleware, runtime Edge) vía `lib/consejos/sesion.ts`;
 *   · Server Components/Actions (runtime Node) vía `lib/consejos/servidor.ts`;
 *   · el Client Component de `/inicio` (runtime navegador) vía
 *     `components/inicio/consejo.tsx`;
 *
 * — y los tres necesitan el MISMO orden de prioridad y el MISMO nombre de
 * cookie sin arriesgarse a que diverjan.
 */

/**
 * Los seis consejos, **en su orden de prioridad**: el índice en este array
 * ES la prioridad (0 = más alta). `lib/consejos/logica.ts#elegirConsejo`
 * recorre este orden literal, así que agregar un consejo nuevo es agregarlo
 * en el lugar de la lista que le corresponda — no hace falta ningún otro
 * mapa de rangos.
 */
export const CONSEJO_IDS = [
  "instalar_app",
  "ficha_sos",
  "notificaciones",
  "gmail",
  "compartir_familia",
  "perfil_gestionado",
] as const

export type ConsejoId = (typeof CONSEJO_IDS)[number]

export function esConsejoId(valor: unknown): valor is ConsejoId {
  return typeof valor === "string" && (CONSEJO_IDS as readonly string[]).includes(valor)
}

/** Los dos estados posibles de una fila de `consejos_estado`. Ver esa migración para el significado de cada uno. */
export const ESTADOS_CONSEJO = ["pospuesto", "descartado"] as const

export type EstadoFilaConsejo = (typeof ESTADOS_CONSEJO)[number]

export function esEstadoFilaConsejo(valor: unknown): valor is EstadoFilaConsejo {
  return typeof valor === "string" && (ESTADOS_CONSEJO as readonly string[]).includes(valor)
}

/**
 * Cookie de SESIÓN del navegador (sin `maxAge`, se borra al cerrarlo) que
 * marca cuándo arrancó la sesión vigente. Es el mecanismo elegido para que
 * "Ahora no" reaparezca recién en la próxima sesión y no en la próxima
 * navegación: `lib/consejos/sesion.ts` la escribe (desde `proxy.ts`, la
 * única pieza que puede garantizar que exista en TODA request) y
 * `lib/consejos/servidor.ts` la lee para comparar contra `updated_at` de la
 * fila pospuesta (`lib/consejos/logica.ts#pospuestoSigueActivo`). El nombre
 * vive acá y no en `sesion.ts` para que `servidor.ts` no tenga que importar
 * nada de `next/server` (runtime Edge) solo por una constante de texto.
 */
export const COOKIE_SESION_CONSEJOS = "consejos_sesion"
