/**
 * Qué le OFRECE la pantalla de revisión a quien acaba de fotografiar un papel
 * (Sprint 20 — "una foto, el lugar correcto").
 *
 * Lógica pura, sin React: decide si además del formulario de siempre hay que
 * mostrar un cartel de ruteo, cuál, y con qué palabras. La pinta
 * `components/documentos/banner-ruteo-documento.tsx` y la ejercita
 * `tests/unit/documento-ruteo.test.ts`.
 *
 * ## Se OFRECE, nunca se impone
 *
 * La regla de oro del flujo de ingesta no cambia ni un poco: el único botón que
 * guarda algo sigue siendo "Confirmar y guardar", y el formulario de abajo
 * sigue completo y editable. Si la persona ignora el cartel y confirma el papel
 * como un documento común, funciona exactamente como antes de este sprint —
 * cero fricción agregada al camino que ya andaba. El cartel es una puerta más,
 * no un peaje.
 *
 * ## Los DOS motivos por los que aparece
 *
 * 1. **`intencion`**: el clasificador dijo que el papel es una receta, un turno
 *    o una orden. Es el caso principal y el que motivó el sprint.
 *
 * 2. **`fecha_futura`**: el modelo leyó una fecha que todavía no llegó. Esto
 *    ANTES era un callejón sin salida, y es una queja textual del usuario que
 *    pidió la función: la pantalla rechazaba con "la fecha no puede ser futura"
 *    y no ofrecía ninguna salida, sobre papeles que son futuros por naturaleza.
 *    *"Si es solo para guardar cosas que pasaron, es un archivo, no una ayuda
 *    médica."* La regla en sí es CORRECTA -un estudio realizado no puede
 *    haberse hecho mañana- y no se afloja: lo que se agrega es la salida. Ahora
 *    el campo queda vacío (como cualquier fecha que no se pudo leer) y el
 *    cartel pregunta si eso era un turno.
 *
 * La intención tiene prioridad sobre la fecha: si el clasificador ya dijo
 * "receta", el cartel habla de medicación aunque además la fecha sea futura.
 * Dos carteles a la vez serían dos preguntas para una sola foto.
 */

import type { IntencionDocumentoExtraida } from "@/lib/gemini/schemas"

/** Adónde lleva el botón del cartel. */
export type DestinoRuteo = "medicacion" | "turnos"

/** Por qué se ofreció. Ver el encabezado. */
export type MotivoRuteo = "intencion" | "fecha_futura"

export interface SenalesRuteo {
  intencion: IntencionDocumentoExtraida
  /** `true` si la fecha que leyó el modelo es POSTERIOR a hoy (ya resuelto por quien llama, que es el único que sabe qué día es hoy en Ushuaia). */
  fechaFutura: boolean
  /** Cuántos medicamentos trajo la extracción. Cambia el texto, nunca el destino. */
  cantidadMedicamentos: number
}

export interface OfertaRuteo {
  destino: DestinoRuteo
  motivo: MotivoRuteo
  /** Título del cartel. Describe lo que la app CREE, en primera persona del plural y sin certezas falsas. */
  titulo: string
  /** Una o dos oraciones: qué va a pasar si toca el botón, y que el documento se puede guardar igual. */
  cuerpo: string
  /** Texto del botón. Verbo primero, como el resto de la app. */
  textoBoton: string
}

/** "1 medicamento" / "3 medicamentos" / "" cuando no hay ninguno. */
function frasePluralMedicamentos(cantidad: number): string {
  if (cantidad <= 0) return ""
  return cantidad === 1 ? "1 medicamento" : `${cantidad} medicamentos`
}

/**
 * El cartel a mostrar, o `null` si no hay ninguno que ofrecer (el caso normal:
 * un estudio realizado con su fecha en el pasado).
 */
export function ofrecerRuteo(senales: SenalesRuteo): OfertaRuteo | null {
  if (senales.intencion === "receta_o_medicacion") {
    const cuantos = frasePluralMedicamentos(senales.cantidadMedicamentos)
    return {
      destino: "medicacion",
      motivo: "intencion",
      titulo: "Esto parece una lista de medicamentos",
      cuerpo:
        cuantos.length > 0
          ? `Leímos ${cuantos}. Podés cargarlos en tu medicación para que te avisemos cuando se estén por acabar. Lo que el papel no diga -la dosis, cada cuánto- lo completás vos: no lo inventamos.`
          : "No pudimos leer los nombres de los remedios, pero podés cargarlos a mano en tu medicación. El papel se guarda igual como documento.",
      textoBoton: "Cargar en Medicación",
    }
  }

  if (senales.intencion === "turno_o_cita") {
    return {
      destino: "turnos",
      motivo: "intencion",
      titulo: "Esto parece un turno",
      cuerpo:
        "Podemos leer el día, la hora y el lugar, y proponerte el turno con su recordatorio. Si la foto trae más de uno, los vas a poder crear todos juntos.",
      textoBoton: "Cargar en Turnos",
    }
  }

  if (senales.intencion === "orden_de_practica") {
    return {
      destino: "turnos",
      motivo: "intencion",
      titulo: "Esto es un pedido de estudio a realizar",
      cuerpo:
        "Todavía no tiene día ni hora: te abrimos un turno nuevo con la práctica y quién la pidió ya cargados, y vos le ponés la fecha cuando lo saques. El papel se guarda igual como documento, con su fecha de emisión.",
      textoBoton: "Sacar turno para esto",
    }
  }

  // El rescate de la fecha futura. Llega acá solo con `estudio_realizado` u
  // `otro`: las tres intenciones con destino propio ya devolvieron arriba.
  if (senales.fechaFutura) {
    return {
      destino: "turnos",
      motivo: "fecha_futura",
      titulo: "La fecha que leímos todavía no llegó",
      cuerpo:
        "Un estudio ya realizado no puede tener fecha futura. Si esto es un turno o una orden para hacerte, cargalo ahí. Si no, escribí abajo la fecha en la que se hizo y guardalo como documento.",
      textoBoton: "Cargarlo como turno",
    }
  }

  return null
}

/**
 * El `href` del botón del cartel.
 *
 * Las dos pantallas de destino reciben el id del documento y leen su
 * `ai_extraction` del lado del servidor, con el cliente del USUARIO: RLS decide
 * si esa fila se puede ver, exactamente igual que en la pantalla de revisión.
 * Nada de la extracción viaja por la URL — ni un nombre de medicamento, ni una
 * dirección, ni una fecha (`docs/minimizacion-datos.md`: los datos de salud no
 * van en la barra del navegador, que queda en el historial y en los logs de
 * cualquier proxy).
 *
 * `indicesMedicamentos` es la excepción, y no es un dato de salud: son
 * posiciones dentro de una lista que solo tiene sentido con la fila delante.
 */
export function hrefRuteo(
  oferta: OfertaRuteo,
  documentoId: string,
  indicesMedicamentos: readonly number[] = [],
): string {
  if (oferta.destino === "medicacion") {
    const base = `/medicacion/nuevo?doc=${encodeURIComponent(documentoId)}`
    return indicesMedicamentos.length > 0 ? `${base}&med=${indicesMedicamentos.join(",")}` : base
  }
  return `/turnos/nuevo?doc=${encodeURIComponent(documentoId)}`
}

/**
 * Adónde va la persona DESPUÉS de guardar un medicamento cargado desde un
 * documento (Sprint 20).
 *
 * ## Por qué esto es una función pura y no una URL que viaja en el formulario
 *
 * La alternativa obvia -un campo oculto `redirigirA` con la URL ya armada- es
 * un redirect abierto de manual: cualquiera puede postear la Server Action con
 * el campo apuntando a donde quiera. Acá viajan solo un uuid, una lista de
 * números y un contador; la URL la arma ESTA función, así que por construcción
 * no puede apuntar afuera de estas dos pantallas.
 *
 * Dos destinos:
 *
 * - **Quedan medicamentos**: el siguiente de la cola, con lo que resta y el
 *   contador de los ya hechos. La cola vive entera en la URL y no en una sesión
 *   ni en `sessionStorage`: si la persona cierra la pantalla en el medio, lo
 *   que ya guardó quedó guardado y lo que faltaba sigue estando en el documento,
 *   que todavía está esperando revisión.
 * - **No queda ninguno**: de vuelta a la pantalla de revisión del documento,
 *   que es donde queda la decisión que falta -guardar también el papel, o
 *   descartarlo si solo se querían los remedios-.
 */
export function siguientePasoDeCargaDeMedicamentos(paso: {
  documentoId: string
  /** Índices que todavía no se cargaron, ya saneados. */
  pendientes: readonly number[]
  /** Cuántos se cargaron ya, contando el que se acaba de guardar. */
  hechos: number
}): string {
  const doc = encodeURIComponent(paso.documentoId)

  if (paso.pendientes.length > 0) {
    return `/medicacion/nuevo?doc=${doc}&med=${paso.pendientes.join(",")}&hechos=${paso.hechos}`
  }

  return `/estudios/nuevo/procesando?doc=${doc}&medicamentos=${paso.hechos}`
}

/**
 * Los índices que viajan en `?med=`, parseados y saneados.
 *
 * Devuelve solo posiciones que EXISTEN en la lista, sin repetidos y en orden
 * ascendente: la pantalla de destino no tiene que defenderse de un
 * `?med=99,99,-1` escrito a mano. Lista vacía = no hay nada que precargar, y la
 * pantalla se comporta como el alta manual de siempre.
 */
export function parsearIndicesMedicamentos(
  crudo: string | undefined,
  cantidadDisponible: number,
): number[] {
  if (!crudo || cantidadDisponible <= 0) return []

  const vistos = new Set<number>()
  for (const parte of crudo.split(",")) {
    const limpio = parte.trim()
    if (!/^\d{1,3}$/.test(limpio)) continue
    const indice = Number(limpio)
    if (indice >= 0 && indice < cantidadDisponible) vistos.add(indice)
  }

  return [...vistos].sort((a, b) => a - b)
}
