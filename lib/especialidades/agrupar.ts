/**
 * Agrupa los médicos del perfil activo por especialidad (Sprint 16, tarea
 * 16.3, pantalla `/especialidades`). Lógica pura, testeada en
 * `tests/unit/agrupar-especialidades.test.ts`.
 *
 * ## Un médico puede aparecer en varios grupos, y está bien
 *
 * Desde la tarea 16.2 `doctors.specialties` es un `text[]`: la médica de
 * cabecera del usuario es clínica Y cardióloga. En esta pantalla aparece bajo
 * las dos, porque la pregunta que la pantalla contesta es "¿a quién tengo
 * para cardiología?", y esconderla bajo su primera especialidad sería
 * contestar mal.
 *
 * ## Por qué se agrupa por clave NORMALIZADA
 *
 * El campo es texto libre a propósito (el catálogo de
 * `lib/especialidades/catalogo.ts` solo sugiere, nunca obliga), así que la
 * misma especialidad puede haberse cargado como "Cardiología", "cardiologia"
 * o "CARDIOLOGÍA" en médicos distintos. Agrupar por el texto crudo mostraría
 * tres secciones con un médico cada una, que es exactamente lo que esta
 * pantalla existe para evitar. La clave se arma con
 * `lib/lugares/normalizar.ts#normalizarBusqueda` -la misma función que
 * normaliza el catálogo REFES y lo que la persona teclea: un solo criterio de
 * "estos dos textos son el mismo" en todo el proyecto-.
 *
 * La ETIQUETA que se muestra es la primera forma encontrada al recorrer los
 * médicos ya ordenados por nombre: determinística, y en la práctica la
 * escritura que la persona usó en el médico que cargó primero.
 */

import { normalizarBusqueda } from "@/lib/lugares/normalizar"

/** Lo mínimo que necesita el agrupador de una fila de `doctors`. */
export interface MedicoAgrupable {
  id: string
  full_name: string
  specialties: string[]
}

export interface GrupoDeEspecialidad<T extends MedicoAgrupable> {
  /** Clave normalizada. `""` para el grupo de los que no tienen ninguna cargada. */
  clave: string
  /** Etiqueta a mostrar, tal como se cargó. */
  etiqueta: string
  medicos: T[]
}

const COLLATOR = new Intl.Collator("es-AR", { sensitivity: "base", numeric: true })

/**
 * Devuelve los grupos ordenados alfabéticamente, con el grupo "sin
 * especialidad cargada" SIEMPRE al final -es el cajón de lo pendiente, no una
 * especialidad más, y encabezar la lista con él sería empezar la pantalla por
 * lo que falta en vez de por lo que hay-.
 *
 * `medicos` se recorre en el orden en que llega: la página ya los pide
 * ordenados por nombre, así que dentro de cada grupo el orden es alfabético
 * sin volver a ordenar acá.
 */
export function agruparPorEspecialidad<T extends MedicoAgrupable>(
  medicos: readonly T[],
): GrupoDeEspecialidad<T>[] {
  const grupos = new Map<string, GrupoDeEspecialidad<T>>()

  const agregar = (clave: string, etiqueta: string, medico: T) => {
    const existente = grupos.get(clave)
    if (existente) {
      existente.medicos.push(medico)
      return
    }
    grupos.set(clave, { clave, etiqueta, medicos: [medico] })
  }

  for (const medico of medicos) {
    const especialidades = medico.specialties.filter(
      (especialidad) => especialidad.trim().length > 0,
    )

    if (especialidades.length === 0) {
      agregar("", "Sin especialidad cargada", medico)
      continue
    }

    // Un médico con la misma especialidad repetida (dos escrituras distintas
    // de lo mismo) tiene que aparecer UNA vez en su grupo, no dos.
    const vistas = new Set<string>()
    for (const especialidad of especialidades) {
      const clave = normalizarBusqueda(especialidad)
      if (clave.length === 0 || vistas.has(clave)) continue
      vistas.add(clave)
      agregar(clave, especialidad.trim(), medico)
    }
  }

  return [...grupos.values()].sort((a, b) => {
    if (a.clave === "") return 1
    if (b.clave === "") return -1
    return COLLATOR.compare(a.etiqueta, b.etiqueta)
  })
}
