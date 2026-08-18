/**
 * Autocompletado de `components/turnos/formulario-turno.tsx` al elegir un
 * médico del directorio (Sprint 10, tarea 10.1 — ROADMAP_SPRINTS.md,
 * vinculación con turnos).
 *
 * Lógica pura, sin React ni DOM: separada del componente para poder
 * testearla sin montar el formulario (`tests/unit/autocompletar-medico.test.ts`).
 *
 * ## Criterio: solo se completa lo que está VACÍO
 *
 * Elegir un médico del `<Select>` es una AYUDA, no una imposición: nunca pisa
 * un campo que la persona ya escribió a mano, sea porque lo tipeó antes de
 * abrir el selector o porque lo corrigió después de una elección anterior.
 * Cada campo del turno (`medico`, `especialidad`, `lugarNombre`,
 * `lugarDireccion`, y el par `latitud`/`longitud`) se completa
 * independientemente, solo si está vacío (`trim().length === 0`) en el
 * momento de la elección.
 *
 * Las coordenadas son la única excepción agrupada: se completan JUNTAS o
 * ninguna. Si cualquiera de las dos ya tiene un valor -aunque sea uno tipeado
 * a mano que no coincide con el consultorio del médico elegido- no se toca
 * ninguna, para no dejar un par incoherente (una mitad del médico, la otra
 * mitad de lo que la persona ya había puesto).
 *
 * Antes de esta tarea, `elegirMedicoDelDirectorio` pisaba `medico` y
 * `especialidad` sin condición al elegir de la lista (Sprint 6, tarea 6.1).
 * Se cambia acá a "solo si está vacío" para los cinco campos por igual, y
 * queda documentado como el criterio nuevo: elegir un médico ya cargado no
 * debe borrar una corrección que la persona ya hizo a mano.
 *
 * ## Ciudad y provincia se suman al mismo criterio (Sprint 16, tarea 16.1)
 *
 * `lugarCiudad`/`lugarProvincia` siguen exactamente la misma regla que
 * `lugarDireccion`: se completan solo si el campo está vacío en el momento de
 * la elección, cada uno de forma independiente -a diferencia de
 * latitud/longitud, que se completan JUNTAS o ninguna-.
 */

export interface MedicoParaAutocompletar {
  id: string
  full_name: string
  specialty: string | null
  institution: string | null
  address: string | null
  city: string | null
  province: string | null
  latitude: number | null
  longitude: number | null
}

export interface CamposAutocompletablesTurno {
  medico: string
  especialidad: string
  lugarNombre: string
  lugarDireccion: string
  lugarCiudad: string
  lugarProvincia: string
  latitud: string
  longitud: string
}

function estaVacio(valor: string): boolean {
  return valor.trim().length === 0
}

/**
 * Devuelve SOLO los campos que corresponde completar tras elegir `doctor`
 * del directorio, según `actuales` (el estado del formulario en el momento
 * de la elección). Las claves ausentes del resultado son campos que NO hay
 * que tocar -ni el llamador debe pisarlos-.
 */
export function camposAutocompletadosDesdeMedico(
  doctor: MedicoParaAutocompletar,
  actuales: CamposAutocompletablesTurno,
): Partial<CamposAutocompletablesTurno> {
  const cambios: Partial<CamposAutocompletablesTurno> = {}

  if (estaVacio(actuales.medico)) {
    cambios.medico = doctor.full_name
  }

  if (doctor.specialty && estaVacio(actuales.especialidad)) {
    cambios.especialidad = doctor.specialty
  }

  if (doctor.institution && estaVacio(actuales.lugarNombre)) {
    cambios.lugarNombre = doctor.institution
  }

  if (doctor.address && estaVacio(actuales.lugarDireccion)) {
    cambios.lugarDireccion = doctor.address
  }

  if (doctor.city && estaVacio(actuales.lugarCiudad)) {
    cambios.lugarCiudad = doctor.city
  }

  if (doctor.province && estaVacio(actuales.lugarProvincia)) {
    cambios.lugarProvincia = doctor.province
  }

  if (
    doctor.latitude !== null &&
    doctor.longitude !== null &&
    estaVacio(actuales.latitud) &&
    estaVacio(actuales.longitud)
  ) {
    cambios.latitud = String(doctor.latitude)
    cambios.longitud = String(doctor.longitude)
  }

  return cambios
}
