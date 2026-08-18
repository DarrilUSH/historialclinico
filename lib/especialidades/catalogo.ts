/**
 * Catálogo curado de especialidades médicas reconocidas en Argentina (Sprint
 * 16, tarea 16.2 — ROADMAP_SPRINTS.md). Alimenta el autocompletar de
 * "Especialidad" en `components/turnos/formulario-turno.tsx` y
 * `components/medicos/formulario-medico.tsx`.
 *
 * ## Constante TS, NO un `CHECK` cerrado — a propósito
 *
 * A diferencia de `lib/ubicacion/provincias.ts` (dominio CERRADO: 24
 * jurisdicciones, ni una más, con su propio `CHECK` en la base), acá el
 * catálogo es solo una lista de SUGERENCIAS. "Especialidad" sigue siendo
 * texto libre en `doctors.specialties`/`appointments.specialty` -sin ningún
 * `CHECK` que la limite-: una especialidad rara, una subespecialidad muy
 * puntual o el nombre con el que un médico real se identifica no puede
 * bloquear la carga de un turno o de un médico. El catálogo mejora la carga
 * (sugiere, corrige errores de tipeo, evita "Cardiologia" vs "Cardiología"
 * vs "cardiologa" como tres valores distintos) pero nunca la restringe.
 * `lib/validacion/medico.schema.ts` y `lib/validacion/turno.schema.ts` lo
 * documentan explícitamente en sus propios encabezados.
 *
 * ## Selección: ~60 especialidades, sin inventar
 *
 * Basado en el nomenclador de especialidades médicas reconocidas por el
 * Ministerio de Salud/SISA (Sistema Integrado de Información Sanitaria
 * Argentino) y los colegios médicos provinciales: las especialidades
 * clínicas y quirúrgicas de mayor uso real en un directorio familiar, más
 * las disciplinas de diagnóstico y las no médicas que igual figuran en
 * `doctors` de esta app (odontología, psicología, kinesiología, nutrición,
 * fonoaudiología). No es un listado oficial exhaustivo -el nomenclador real
 * tiene más de 90 entradas, muchas subespecialidades quirúrgicas o de
 * investigación que un usuario de esta app nunca va a tipear-: es un
 * subconjunto curado para que el autocompletar sea útil sin ser abrumador.
 *
 * Orden alfabético, mismo criterio que `PROVINCIAS_ARGENTINAS`: es la forma
 * más fácil de ubicar un nombre a simple vista si alguna vez hay que leer la
 * lista entera (por ejemplo para agregar una entrada nueva).
 */
export const CATALOGO_ESPECIALIDADES = [
  "Alergia e Inmunología",
  "Anatomía Patológica",
  "Andrología",
  "Anestesiología",
  "Cardiología",
  "Cirugía Cardiovascular",
  "Cirugía General",
  "Cirugía Pediátrica",
  "Cirugía Plástica y Reparadora",
  "Cirugía Torácica",
  "Cirugía Vascular Periférica",
  "Clínica Médica",
  "Coloproctología",
  "Cuidados Paliativos",
  "Dermatología",
  "Diabetología",
  "Diagnóstico por Imágenes",
  "Ecografía",
  "Endocrinología",
  "Fonoaudiología",
  "Gastroenterología",
  "Genética Médica",
  "Geriatría",
  "Ginecología",
  "Hematología",
  "Hepatología",
  "Infectología",
  "Kinesiología y Fisiatría",
  "Laboratorio y Análisis Clínicos",
  "Medicina del Deporte",
  "Medicina del Trabajo",
  "Medicina de Emergencias",
  "Medicina Familiar y General",
  "Medicina Legal",
  "Medicina Nuclear",
  "Nefrología",
  "Neonatología",
  "Neumonología",
  "Neurocirugía",
  "Neurología",
  "Nutrición y Dietética",
  "Obstetricia",
  "Odontología",
  "Odontopediatría",
  "Oftalmología",
  "Oncología",
  "Ortodoncia",
  "Otorrinolaringología",
  "Pediatría",
  "Podología",
  "Psicología",
  "Psiquiatría",
  "Radiología",
  "Reumatología",
  "Terapia Intensiva",
  "Terapia Ocupacional",
  "Toxicología",
  "Traumatología y Ortopedia",
  "Urología",
] as const

export type EspecialidadCatalogo = (typeof CATALOGO_ESPECIALIDADES)[number]

/**
 * Tope de especialidades por médico. Calcado en el `CHECK`
 * `doctors_specialties_cantidad_razonable`
 * (`supabase/migrations/20260818090000_especialidades_multiples.sql`): un
 * médico con más de diez especialidades cargadas ya no es un dato real de
 * una app familiar, es carga basura o un error de tipeo con el botón
 * "Agregar" pegado.
 */
export const MAX_ESPECIALIDADES_POR_MEDICO = 10

/** Largo máximo de cada especialidad cargada, mismo tope que ya tenía el campo `especialidad` de texto libre desde el Sprint 10. */
export const MAX_LARGO_ESPECIALIDAD = 150
