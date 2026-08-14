/**
 * Reexportación del registro del service worker para el código de push.
 *
 * **El módulo real es `lib/pwa/registrar-sw.ts`** desde el Sprint 8 (tarea
 * 8.4): cuando el worker pasó a servir también el caché offline de la ficha
 * SOS, dejó de tener sentido que su registro viviera bajo `lib/push/` —el push
 * es un consumidor del worker, no su dueño—.
 *
 * Este archivo existe para que las pantallas de notificaciones
 * (`components/notificaciones/activar-notificaciones.tsx`,
 * `lib/push/suscripcion.ts`) sigan importando desde donde siempre, sin un
 * renombre masivo que no aportaría nada. **No agregues nada acá**: cualquier
 * cosa nueva relacionada con el service worker va en `lib/pwa/registrar-sw.ts`,
 * que es el punto único.
 *
 * `haySoportePush` sigue siendo la comprobación correcta para las pantallas de
 * notificaciones: es más estricta que `haySoporteServiceWorker` porque además
 * exige `PushManager` y `Notification` (ver el comentario de las dos funciones
 * en el módulo real).
 */

export {
  haySoportePush,
  haySoporteServiceWorker,
  obtenerRegistroExistente,
  registrarServiceWorker,
} from "@/lib/pwa/registrar-sw"
