/**
 * GET /perfil/sos/enlace — deep link a `/perfil/sos` que primero fija el
 * perfil PROPIO de la cuenta como activo (Sprint 8.2 la pantalla, tarea #14
 * del tutorial de bienvenida el motivo de este archivo).
 *
 * ## Por qué hace falta
 *
 * `/perfil/sos` edita la ficha SOS del perfil ACTIVO. El consejo "Completá
 * tu ficha de emergencia" (`lib/consejos/servidor.ts`) evalúa, en cambio, la
 * ficha del perfil PROPIO de la cuenta -nunca la del activo-, porque los
 * consejos son de la cuenta y no dependen de a quién se esté mirando (mismo
 * criterio que la card de Gmail en `/inicio`). Si María está viendo el
 * historial de Roberto y toca el CTA de ese consejo, un `<Link
 * href="/perfil/sos">` pelado la dejaría editando la ficha SOS de ROBERTO,
 * no la suya -exactamente lo contrario de lo que el consejo prometía-.
 *
 * Mismo patrón que `/turnos/enlace` (Sprint 6.6): el cambio de perfil
 * necesita escribir una cookie, y eso solo se puede hacer en un Route
 * Handler o una Server Action, nunca durante el render de un Server
 * Component (`lib/perfil-activo.ts`). `cambiarPerfilDesdeParametro` ya hace
 * todo el trabajo -incluido el silencio total si el uuid no tiene permiso,
 * ver su encabezado-, así que este archivo es, a propósito, tan chico como
 * su gemelo.
 */

import { responderEnlaceDePerfil } from "@/lib/perfil-activo"

export async function GET(request: Request) {
  return responderEnlaceDePerfil(request, "/perfil/sos")
}
