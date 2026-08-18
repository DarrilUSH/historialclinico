/**
 * Las 24 jurisdicciones argentinas (23 provincias + CABA), fuente única para
 * el `<Select>` de provincia de `components/turnos/formulario-turno.tsx` y
 * `components/medicos/formulario-medico.tsx`, y para el `z.enum()` de
 * `lib/validacion/turno.schema.ts`/`lib/validacion/medico.schema.ts` (Sprint
 * 16, tarea 16.1). El `CHECK` de
 * `supabase/migrations/20260817231000_ciudad_provincia_direcciones.sql`
 * (`appointments_location_province_valida`, `doctors_province_valida`) es una
 * copia manual de esta misma lista en el borde de la base — mismo patrón que
 * `GRUPOS_SANGUINEOS` en `lib/validacion/sos.schema.ts` para
 * `profiles_blood_type_valido`: un dominio cerrado del producto se valida con
 * texto + CHECK, no con un enum de Postgres, porque la fuente de verdad real
 * es esta constante TypeScript.
 *
 * CABA se lista como "Ciudad Autónoma de Buenos Aires" -el nombre completo,
 * no la sigla- porque es lo que se guarda en la base y lo que arma la
 * consulta de geocodificación (`lib/ubicacion/geocodificacion.ts`); la sigla
 * queda para la UI si algún día hace falta abreviar.
 *
 * Orden: alfabético, como cualquier desplegable largo que la persona tiene
 * que recorrer buscando un nombre — no el orden protocolar/territorial que
 * usan otras listas oficiales.
 */
export const PROVINCIAS_ARGENTINAS = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autónoma de Buenos Aires",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego, Antártida e Islas del Atlántico Sur",
  "Tucumán",
] as const

export type ProvinciaArgentina = (typeof PROVINCIAS_ARGENTINAS)[number]
