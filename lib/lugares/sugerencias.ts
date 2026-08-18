/**
 * Forma de una sugerencia del catálogo REFES para el campo "Lugar" del
 * formulario de turno (Sprint 16, tarea 16.3), y el criterio de qué campos
 * precarga elegir una.
 *
 * Vive en `lib/` y no adentro del componente ni de la Server Action porque lo
 * comparten las tres puntas: la acción de servidor que lo arma
 * (`app/(app)/(con-nav)/lugares/actions.ts`), el campo de cliente que lo
 * muestra (`components/lugares/campo-lugar.tsx`) y el test de la precarga
 * (`tests/unit/lugares-precarga.test.ts`). Lógica pura: sin React, sin
 * Supabase, sin `server-only`.
 */

import { direccionCompleta } from "@/lib/ubicacion/formato"

/** Un centro del catálogo, recortado a lo que el formulario de turno necesita. */
export interface CentroSugerido {
  refesId: string
  nombre: string
  direccion: string | null
  localidad: string | null
  departamento: string | null
  /** Provincia canónica (uno de `PROVINCIAS_ARGENTINAS`), o `null` si el REFES trajo una desconocida. */
  provincia: string | null
  /** Provincia tal como la publica el REFES, para poder mostrarla aunque no se haya podido normalizar. */
  provinciaRefes: string
  latitud: number | null
  longitud: number | null
  tipo: string | null
}

/** Los campos del formulario de turno que toca elegir un centro del catálogo. */
export interface PrecargaDesdeCentro {
  lugarNombre: string
  lugarDireccion: string
  lugarCiudad: string
  lugarProvincia: string
  latitud: string
  longitud: string
}

/**
 * Qué queda en el formulario al elegir un centro del catálogo.
 *
 * ## Acá SÍ se pisa lo que había, a diferencia del selector de médico
 *
 * `lib/turnos/autocompletar-medico.ts` completa **solo lo que está vacío**,
 * porque elegir un médico del directorio es una acción sobre OTRO campo
 * (el médico) que de paso ofrece completar el lugar: pisar ahí una dirección
 * corregida a mano sería una sorpresa desagradable.
 *
 * Elegir un centro en el campo "Lugar" es lo contrario: la persona está
 * diciendo, explícitamente y sobre ese campo, "el lugar es ESTE". Dejar la
 * dirección de otra clínica porque "ya había algo escrito" sería peor que
 * inútil: mandaría a la familia a la dirección equivocada el día del turno.
 * Así que las cinco partes del LUGAR (nombre, dirección, ciudad, provincia y
 * coordenadas) se reemplazan juntas, como una unidad — nunca mitad de un
 * centro y mitad de otro.
 *
 * ## Las coordenadas vienen del registro: cero geocodificación
 *
 * Si el centro las trae, van tal cual. Si no las trae, se BORRAN en vez de
 * conservarse: eran de otro lugar, y unas coordenadas viejas pegadas a una
 * dirección nueva son exactamente el bug de "Cómo llegar" que el Sprint 16
 * vino a corregir. Sin coordenadas, `linkComoLlegar` cae en la búsqueda por
 * dirección, que ahora es la dirección correcta.
 *
 * ## La provincia
 *
 * Va la CANÓNICA, la única que acepta el CHECK
 * `appointments_location_province_valida`. Si el REFES trajo una
 * jurisdicción que `provinciaCanonica` no reconoce, el campo queda vacío -y
 * la persona la elige del desplegable- en vez de guardarse un valor que la
 * base va a rechazar al enviar el formulario.
 */
export function precargaDesdeCentro(centro: CentroSugerido): PrecargaDesdeCentro {
  const tieneCoordenadas = centro.latitud !== null && centro.longitud !== null

  return {
    lugarNombre: centro.nombre,
    lugarDireccion: centro.direccion ?? "",
    lugarCiudad: centro.localidad ?? "",
    lugarProvincia: centro.provincia ?? "",
    latitud: tieneCoordenadas ? String(centro.latitud) : "",
    longitud: tieneCoordenadas ? String(centro.longitud) : "",
  }
}

/**
 * Segunda línea de cada sugerencia del desplegable: dónde queda el centro.
 * Usa el mismo armado que el resto de la app (`lib/ubicacion/formato.ts`),
 * así que una sugerencia se lee igual que la dirección que va a quedar
 * cargada en el turno.
 */
export function descripcionDeSugerencia(centro: CentroSugerido): string | null {
  return direccionCompleta({
    direccion: centro.direccion,
    ciudad: centro.localidad,
    provincia: centro.provincia ?? centro.provinciaRefes,
  })
}
