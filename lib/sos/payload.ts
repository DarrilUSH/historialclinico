/**
 * Payload offline de la ficha SOS (Sprint 8, tarea 8.4).
 *
 * **El contrato es `docs/modelo-sos.md` §7 y los nombres son parte de él.** No
 * es una opinión de estilo: el service worker va a leer este JSON de una copia
 * guardada en el disco de un teléfono, posiblemente semanas después de un
 * deploy que cambió el código del servidor. Renombrar un campo sin subir
 * `VERSION_PAYLOAD_SOS` deja fichas viejas que la app no sabe interpretar.
 *
 * Este módulo es **lógica pura**: recibe filas ya leídas y devuelve el objeto.
 * No importa Supabase, no toca la red y no valida permisos —de eso se encarga
 * `app/api/sos/[perfilId]/route.ts`, que es quien lo llama—. Por eso se puede
 * probar entero sin levantar nada (`tests/unit/sos-payload.test.ts`).
 */

import type { Perfil } from "@/types/dominio"

/**
 * Versión de la FORMA del payload. Sube cuando cambia la estructura, no cuando
 * cambian los datos. El consumidor descarta lo que no entiende: es preferible
 * "no hay copia offline" a una ficha renderizada a medias con campos que
 * cambiaron de significado.
 */
export const VERSION_PAYLOAD_SOS = 1

export interface PerfilPayloadSos {
  id: string
  nombre_completo: string
  /** `profiles.national_id`. Entra a la ficha: `docs/modelo-sos.md` §4.2. */
  documento: string | null
  /** `profiles.date_of_birth`. La edad orienta una dosis. */
  fecha_nacimiento: string | null
}

export interface VitalesPayloadSos {
  grupo_sanguineo: string | null
  /** Siempre array, nunca `null` (regla dura 2 del contrato). */
  alergias: string[]
  condiciones_cronicas: string[]
  medicacion_critica: string[]
  observaciones: string | null
  /** `profiles.sos_updated_at`: cuándo un humano revisó los datos. `null` si nunca. */
  actualizado_at: string | null
}

export interface ContactoPayloadSos {
  nombre: string | null
  telefono: string | null
  vinculo: string | null
}

export interface CoberturaPayloadSos {
  proveedor: string
  plan: string | null
  numero_afiliado: string | null
  /**
   * URL **estable** de cada cara, o `null` si esa cara no tiene foto.
   *
   * Estable, no firmada: es la regla dura 1 del contrato. Una signed URL vive
   * 300 segundos y este JSON tiene que seguir sirviendo en modo avión dentro
   * de una semana. La imagen la sirve `/api/credenciales/{id}/imagen`, que
   * revalida sesión y permiso en cada request que llega al servidor.
   */
  imagen_frente: string | null
  imagen_dorso: string | null
}

export interface PayloadSos {
  version: number
  /** Cuándo se armó ESTA copia. Lo estampa el servidor (§6.1 y regla dura 3). */
  generado_at: string
  perfil: PerfilPayloadSos
  vitales: VitalesPayloadSos
  /** `null` entero si no hay ningún dato de contacto cargado. */
  contacto_emergencia: ContactoPayloadSos | null
  /** `null` si el perfil no tiene ninguna cobertura con `is_primary`. */
  cobertura_principal: CoberturaPayloadSos | null
}

/** Recorte de `insurance_cards` que necesita el payload. */
export interface CoberturaPrincipalCruda {
  id: string
  provider: string
  plan: string | null
  member_number: string | null
  front_storage_path: string | null
  back_storage_path: string | null
}

/**
 * URL estable de una cara de la credencial. **Única definición del proyecto**:
 * la usan el payload, la ficha SOS (`components/sos/ficha-sos.tsx`) y, por
 * consecuencia, el patrón de rutas del service worker.
 */
export function urlImagenCredencial(coberturaId: string, lado: "front" | "back"): string {
  return `/api/credenciales/${coberturaId}/imagen?lado=${lado}`
}

/**
 * Normaliza un texto opcional: `""` y `"   "` valen lo mismo que ausente.
 *
 * Importa más de lo que parece. `emergency_contact` vacío contra `null` decide
 * si el payload trae un `contacto_emergencia` con tres `null` adentro —que el
 * consumidor tendría que aprender a distinguir de "hay contacto"— o
 * directamente `null`, que es lo que dice el contrato.
 */
function textoOpcional(valor: string | null | undefined): string | null {
  if (typeof valor !== "string") return null
  const limpio = valor.trim()
  return limpio.length > 0 ? limpio : null
}

/**
 * Un array de la base tal como lo espera el contrato: siempre array.
 *
 * Las tres columnas son `NOT NULL DEFAULT '{}'`, así que en teoría esto nunca
 * hace falta. En la práctica el payload se sirve a un dispositivo que lo va a
 * leer sin red y sin posibilidad de reintentar: un `.map` sobre `null` en esa
 * pantalla no tiene recuperación posible, y el costo de la garantía es esta
 * línea (`docs/modelo-sos.md` §2.1).
 */
function arraySiempre(valor: string[] | null | undefined): string[] {
  return Array.isArray(valor) ? valor : []
}

/**
 * Arma el payload offline de un perfil.
 *
 * @param perfil Fila completa de `profiles`, ya filtrada por RLS.
 * @param cobertura Cobertura con `is_primary = true`, o `null` si no hay.
 * @param generadoAt Momento en que se arma la copia. Lo pasa quien llama
 *   —siempre el servidor— para que el valor sea inyectable en los tests y,
 *   sobre todo, para que quede explícito que **no lo pone el cliente**: si
 *   dependiera del reloj del teléfono, "hace cuánto bajé esto" mentiría en
 *   cuanto alguien tuviera la hora mal puesta.
 */
export function construirPayloadSos(
  perfil: Perfil,
  cobertura: CoberturaPrincipalCruda | null,
  generadoAt: Date,
): PayloadSos {
  const nombre = textoOpcional(perfil.emergency_contact)
  const telefono = textoOpcional(perfil.emergency_contact_phone)
  const vinculo = textoOpcional(perfil.emergency_contact_relationship)
  const hayContacto = nombre !== null || telefono !== null || vinculo !== null

  return {
    version: VERSION_PAYLOAD_SOS,
    generado_at: generadoAt.toISOString(),
    perfil: {
      id: perfil.id,
      nombre_completo: perfil.full_name,
      documento: textoOpcional(perfil.national_id),
      fecha_nacimiento: perfil.date_of_birth ?? null,
    },
    vitales: {
      grupo_sanguineo: textoOpcional(perfil.blood_type),
      alergias: arraySiempre(perfil.allergies),
      condiciones_cronicas: arraySiempre(perfil.chronic_conditions),
      medicacion_critica: arraySiempre(perfil.critical_medication),
      observaciones: textoOpcional(perfil.sos_notes),
      actualizado_at: perfil.sos_updated_at ?? null,
    },
    // El bloque entero es `null` si no hay ni un dato: ver `textoOpcional`.
    contacto_emergencia: hayContacto ? { nombre, telefono, vinculo } : null,
    cobertura_principal: cobertura
      ? {
          proveedor: cobertura.provider,
          plan: textoOpcional(cobertura.plan),
          numero_afiliado: textoOpcional(cobertura.member_number),
          imagen_frente: cobertura.front_storage_path
            ? urlImagenCredencial(cobertura.id, "front")
            : null,
          imagen_dorso: cobertura.back_storage_path
            ? urlImagenCredencial(cobertura.id, "back")
            : null,
        }
      : null,
  }
}
