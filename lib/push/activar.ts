/**
 * Orquestación de "activar las notificaciones", extraída para que la
 * compartan `components/notificaciones/activar-notificaciones.tsx` (el
 * banner de siempre, Sprint 6.3) y el consejo `notificaciones` del tutorial
 * de bienvenida (`components/inicio/consejo.tsx`, tarea #14): las dos
 * pantallas ofrecen el MISMO botón ("CTA → el flujo de activación de push
 * existente", pedido explícito de la tarea), y escribir la secuencia dos
 * veces sería la clase de duplicación que este proyecto factoriza siempre
 * que aparece (mismo criterio que `TarjetaAcceso` en `/inicio`).
 *
 * Encadena exactamente lo mismo que hacía el `activar()` inline de
 * `ActivarNotificaciones` antes de esta extracción: pedir permiso y
 * suscribirse (`lib/push/suscripcion.ts`, que exige un click real en el
 * medio — ver su encabezado), y si el guardado en la base falla, deshacer la
 * suscripción del navegador para que las dos puntas no queden
 * desincronizadas.
 *
 * **Llamar SIEMPRE desde el manejador de un click** — mismo requisito que
 * `pedirPermisoYSuscribir`, que es quien de verdad lo exige.
 */

import { guardarSuscripcion } from "@/app/(app)/(con-nav)/inicio/actions"
import { cancelarSuscripcion, pedirPermisoYSuscribir } from "@/lib/push/suscripcion"

/**
 * Instrucción para revertir un permiso `"denied"` -Chrome no vuelve a
 * preguntar solo, hay que ir a buscarlo a la configuración del sitio-.
 * Compartida entre `ActivarNotificaciones` (el banner) y el consejo
 * `notificaciones` del tutorial de bienvenida: es el mismo texto en los dos
 * lugares, y que un día cambie en uno y no en el otro sería el tipo de
 * divergencia que esta extracción evita.
 */
export const MENSAJE_NOTIFICACIONES_DENEGADAS =
  "Bloqueaste las notificaciones para este sitio. Para reactivarlas, tocá el candado (o el ícono de ajustes) a la izquierda de la dirección web y permití las notificaciones."

export type ResultadoActivacionPush =
  | { estado: "activo" }
  /** La persona dijo que no (o ya lo había dicho antes). No es un error. */
  | { estado: "denegado" }
  /** Cerró el prompt sin decidir. No se insiste ni se muestra un error. */
  | { estado: "sin_respuesta" }
  /** Algo falló de verdad: sin soporte, guardado en la base, etc. */
  | { estado: "error"; mensaje: string }

export async function activarNotificacionesPush(): Promise<ResultadoActivacionPush> {
  const resultado = await pedirPermisoYSuscribir(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "")

  if (resultado.estado === "denegado") {
    return { estado: "denegado" }
  }
  if (resultado.estado === "sin_respuesta") {
    return { estado: "sin_respuesta" }
  }
  if (resultado.estado === "error") {
    return { estado: "error", mensaje: resultado.mensaje }
  }

  const guardado = await guardarSuscripcion(resultado.datos)
  if (!guardado.ok) {
    // La suscripción quedó viva en el navegador pero no en nuestra base: se
    // deshace para que el estado de las dos puntas coincida (ver el
    // encabezado del archivo).
    await cancelarSuscripcion()
    return {
      estado: "error",
      mensaje: guardado.error ?? "No pudimos activar las notificaciones.",
    }
  }

  return { estado: "activo" }
}
