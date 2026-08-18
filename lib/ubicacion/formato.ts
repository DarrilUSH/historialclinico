/**
 * Arma una dirección completa (calle + ciudad + provincia) a partir de las
 * columnas separadas que suma el Sprint 16, tarea 16.1
 * (`appointments.location_city`/`location_province`,
 * `doctors.city`/`province`). Lógica pura, sin React ni Supabase, para poder
 * testearla sin montar nada (`tests/unit/direccion-completa.test.ts`) y para
 * que la usen por igual el deep link de "Cómo llegar"
 * (`lib/logistica/deep-links.ts`), el LOCATION del .ics
 * (`app/api/turnos/[id]/ics/route.ts`), el link de Google Calendar y las
 * tarjetas que muestran la dirección en pantalla
 * (`components/turnos/tarjeta-turno.tsx`, `components/medicos/tarjeta-medico.tsx`).
 *
 * Un solo lugar donde decidir CÓMO se combinan las tres partes evita que cada
 * consumidor arme su propio `.join(", ")` con un criterio de "vacío" distinto
 * -la fuente real del bug que corrige esta tarea era, en el fondo, que
 * `linkComoLlegar` tenía su propio criterio (agregar ", Ushuaia, Tierra del
 * Fuego" a mano) sin que ningún otro archivo lo supiera-.
 */

export interface PartesDireccion {
  direccion?: string | null
  ciudad?: string | null
  provincia?: string | null
}

/**
 * Combina calle, ciudad y provincia en una sola línea ("Avenida 51 Nº 315, La
 * Plata, Buenos Aires"), salteando las partes ausentes o vacías. Devuelve
 * `null` si las tres vienen vacías -no hay nada que mostrar ni que
 * geocodificar-.
 */
export function direccionCompleta(partes: PartesDireccion): string | null {
  const combinada = [partes.direccion, partes.ciudad, partes.provincia]
    .map((parte) => parte?.trim())
    .filter((parte): parte is string => Boolean(parte && parte.length > 0))
    .join(", ")

  return combinada.length > 0 ? combinada : null
}
