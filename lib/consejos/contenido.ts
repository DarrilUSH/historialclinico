/**
 * Copy y CTA de los seis consejos del tutorial de bienvenida (tarea #14).
 * Texto en castellano rioplatense llano, pensado para el público mayor del
 * proyecto (Senior UX): oraciones cortas, sin jerga técnica, "vos".
 *
 * Vive separado de `lib/consejos/tipos.ts` (que no puede tener ningún import
 * pesado, lo usa el proxy en runtime Edge) porque acá SÍ hace falta
 * `lucide-react` para el ícono de cada tarjeta, y este archivo solo lo
 * importan el Server Component de `/inicio` y el Client Component de la
 * tarjeta — nunca `proxy.ts`.
 */

import {
  BellIcon,
  DownloadIcon,
  HeartPulseIcon,
  type LucideIcon,
  MailIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"

import type { ConsejoId } from "@/lib/consejos/tipos"

/**
 * Qué hace el botón principal de cada tarjeta. Tres formas, porque los seis
 * consejos no llevan a un mismo tipo de destino:
 *
 * - `enlace`: navegación directa, sin depender del perfil activo (la
 *   pantalla de destino ya es de la CUENTA, no de un perfil — `/perfil/gmail`
 *   — o ya funciona igual sea cual sea el perfil activo — el ancla de crear
 *   un perfil gestionado en `/familia`).
 * - `enlace_perfil_propio`: la pantalla de destino SÍ opera sobre el perfil
 *   ACTIVO (`/perfil/sos`, la sección "Invitar" de `/familia`), pero la
 *   condición del consejo habla siempre del perfil PROPIO de la cuenta — que
 *   puede no ser el que está activo en este momento (María viendo el
 *   historial de Roberto). `ruta` es el Route Handler que primero fija el
 *   perfil propio como activo y recién después redirige (mismo patrón que
 *   `/turnos/enlace`, `lib/perfil-activo.ts#cambiarPerfilDesdeParametro`).
 * - `activar_notificaciones`: no navega a ningún lado — dispara el mismo
 *   flujo de permiso que `components/notificaciones/activar-notificaciones.tsx`
 *   (`lib/push/activar.ts`), con un click real en el medio (exigencia del
 *   navegador para pedir el permiso).
 * - `null` (solo `instalar_app`): no hay ninguna pantalla a la que ir — el
 *   cuerpo de la tarjeta YA es la instrucción. Solo quedan "Ahora no" y "No
 *   mostrar más".
 */
export type CtaConsejo =
  | { tipo: "enlace"; texto: string; href: string }
  | { tipo: "enlace_perfil_propio"; texto: string; ruta: string }
  | { tipo: "activar_notificaciones"; texto: string }
  | null

export interface ContenidoConsejo {
  titulo: string
  cuerpo: string
  Icono: LucideIcon
  cta: CtaConsejo
}

/**
 * El destino del CTA, ya resuelto a una URL — o `null` cuando no hay
 * ninguna (`instalar_app`, sin CTA; `activar_notificaciones`, que no navega
 * a ningún lado). Función pura, compartida por `components/inicio/consejo.tsx`
 * (la tarjeta contextual de `/inicio`) y `components/ayuda/lista-pasos.tsx`
 * (la lista completa de `/ayuda`): las dos necesitan la MISMA regla -"si es
 * `enlace_perfil_propio`, sumale `?perfil=<propioId>`"- y escribirla dos
 * veces sería la clase de divergencia que ya evitó `lib/push/activar.ts`.
 */
export function hrefCta(cta: CtaConsejo, perfilPropioId: string | null): string | null {
  if (cta === null || cta.tipo === "activar_notificaciones") {
    return null
  }
  if (cta.tipo === "enlace") {
    return cta.href
  }
  // `enlace_perfil_propio`: ver el comentario del tipo, arriba, para el caso
  // (defensivo, no esperado en la práctica) de `perfilPropioId` nulo.
  return perfilPropioId ? `${cta.ruta}?perfil=${perfilPropioId}` : cta.ruta
}

export const CONTENIDO_CONSEJOS: Record<ConsejoId, ContenidoConsejo> = {
  instalar_app: {
    titulo: "Instalá la app en tu teléfono",
    cuerpo:
      "Así la abrís directo desde la pantalla de inicio, como cualquier otra aplicación, sin tener que buscarla en el navegador cada vez. Abrí el menú del navegador (los tres puntos) y tocá “Instalar aplicación” o “Agregar a pantalla de inicio”.",
    Icono: DownloadIcon,
    cta: null,
  },
  ficha_sos: {
    titulo: "Completá tu ficha de emergencia",
    cuerpo:
      "Si alguna vez necesitás ayuda urgente, quien te asista va a poder ver tu grupo sanguíneo, tus alergias y a quién llamar, sin tener que desbloquear el teléfono.",
    Icono: HeartPulseIcon,
    cta: { tipo: "enlace_perfil_propio", texto: "Completar ficha SOS", ruta: "/perfil/sos/enlace" },
  },
  notificaciones: {
    titulo: "Activá las notificaciones",
    cuerpo:
      "Te avisamos antes de cada turno médico y si algún signo vital sale de rango, sin que tengas que estar abriendo la aplicación todo el tiempo.",
    Icono: BellIcon,
    cta: { tipo: "activar_notificaciones", texto: "Activar notificaciones" },
  },
  gmail: {
    titulo: "Conectá tu Gmail",
    cuerpo:
      "La aplicación puede leer los turnos y los estudios que te llegan por correo y cargarlos por vos, sin que tengas que copiar nada a mano.",
    Icono: MailIcon,
    cta: { tipo: "enlace", texto: "Conectar Gmail", href: "/perfil/gmail" },
  },
  compartir_familia: {
    titulo: "Compartí con tu familia",
    cuerpo:
      "Elegí a alguien de confianza para que pueda ver o administrar tu historial, por si alguna vez lo necesitás.",
    Icono: UsersIcon,
    cta: {
      tipo: "enlace_perfil_propio",
      texto: "Compartir mi historial",
      ruta: "/familia/enlace",
    },
  },
  perfil_gestionado: {
    titulo: "¿Un hijo o un padre sin celular?",
    cuerpo:
      "Podés crearle un perfil y llevar su historial vos, aunque esa persona no tenga cuenta ni teléfono propio.",
    Icono: UserPlusIcon,
    cta: { tipo: "enlace", texto: "Crear un perfil", href: "/familia#crear-perfil-gestionado" },
  },
}
