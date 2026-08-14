/**
 * Texto de la alerta preventiva de renovación de receta (Sprint 7, tarea 7.4).
 *
 * Módulo **puro**, con la misma forma y el mismo motivo que
 * `lib/turnos/recordatorios.ts`: no lee la base, no manda nada, no mira el
 * reloj. Todo lo que decide es qué va a leer una persona en la pantalla
 * bloqueada del celular, que es la única salida observable de esta tarea. Por
 * eso está separado del barrido
 * (`app/api/push/procesar-alertas-medicacion/route.ts`) y cubierto por
 * `tests/unit/alertas-medicacion.test.ts`.
 *
 * ## El umbral no está acá
 *
 * "Menos de 5 días" vive en `v_medicacion_estado.necesita_renovacion`
 * (`docs/modelo-medicacion.md` §2.5: "el umbral se define UNA vez, en la
 * vista"). Este módulo recibe una medicación que **ya** fue seleccionada por la
 * base y solo decide cómo se cuenta. Un `< 5` acá sería la segunda copia del
 * umbral y la primera fuente de desincronización.
 *
 * ## Por qué el nombre de la persona va en el título
 *
 * El recordatorio de turno puede decir "Turno de Cardiología en 3 horas" sin
 * nombrar a nadie: quien lo recibe tiene, casi siempre, un solo turno en juego.
 * Acá no: una cuidadora puede administrar dos o tres perfiles con varias
 * medicaciones cada uno, y "Quedan 4 días de Enalapril" la obliga a abrir la
 * app para saber de quién. El nombre de pila resuelve eso en tres caracteres y
 * es como la familia se refiere a la persona.
 *
 * Se usa el **primer nombre** y no el completo por el ancho de la notificación:
 * Android corta el título en una línea, y "A Roberto Gómez le quedan 4 días de
 * Enalapril" pierde justamente el final, que es el nombre del remedio.
 *
 * ## Por qué no dice "~4 días"
 *
 * `dias_restantes` ya es `floor()` —el redondeo conservador, ver
 * `docs/modelo-medicacion.md` §2.2—, así que "4" significa "al menos 4 días
 * completos". El "~" sugeriría una imprecisión que no existe y agrega un
 * símbolo que un lector mayor tiene que descifrar.
 */

import { pluralizarUnidad, textoCantidadConUnidad } from "@/lib/medicacion/unidades"

/** Lo que el barrido necesita para escribir la alerta. Sale de `reclamar_alertas_medicacion()`. */
export interface MedicacionParaAlerta {
  /** `medications.id`. Solo se usa para el `tag`. */
  medicationId: string
  /** `medications.profile_id`: de QUIÉN es la medicación (deep link + nombre). */
  profileId: string
  /** `profiles.full_name` del dueño de la medicación. */
  nombrePerfil: string
  /** `medications.name` — el nombre comercial, que es el que dice la caja. */
  nombre: string
  /** `v_medicacion_estado.dias_restantes`, releído en el momento del barrido. */
  diasRestantes: number
  /** `medications.stock_units`. */
  stockUnits: number | null
  /** `medications.dose_unit` (singular, texto libre). */
  doseUnit: string | null
}

/** Payload listo para `enviarPushAUsuario()` (`lib/push/servidor.ts`). */
export interface AlertaRenovacionPush {
  titulo: string
  cuerpo: string
  url: string
  tag: string
}

/**
 * Ruta que abre la notificación: el listado de medicación.
 *
 * Es la lista y no el detalle porque `/medicacion/{id}` no existe (el proyecto
 * tiene `page.tsx`, `nuevo/` y `[id]/editar/`), y mandar a una pantalla de
 * edición a alguien que solo quiere ver cuánto queda es peor que mandarlo a la
 * lista, donde la tarjeta ya muestra la advertencia y el acceso a la receta.
 */
export const RUTA_ALERTA_RENOVACION = "/medicacion"

/**
 * Primer nombre, para el título.
 *
 * Si `full_name` viniera vacío —no puede: `profiles.full_name` es NOT NULL con
 * CHECK de no vacío— devuelve cadena vacía y el título cae en su variante sin
 * nombre, que sigue siendo una frase correcta.
 */
function primerNombre(nombreCompleto: string): string {
  return nombreCompleto.trim().split(/\s+/)[0] ?? ""
}

/**
 * Url del payload: `/medicacion?perfil={profileId}`.
 *
 * Sprint 6.6 aplicado a esta tarea (`docs/recordatorios.md` §10, que anticipa
 * textualmente el caso "Sprint 7 (medicación)"). Sin el parámetro, María
 * tocando el aviso de la medicación de Roberto aterriza en SU propia
 * medicación, que es una lista sin el remedio del que le acaban de avisar.
 * `/medicacion/enlace` cambia el perfil activo revalidando el permiso contra la
 * base antes de mostrar nada.
 *
 * `encodeURIComponent` es defensivo —un uuid no tiene nada que escapar—, no una
 * validación: la validación de verdad la hace `requerirPermiso` del lado del
 * enlace, nunca este módulo, que es puro y no puede preguntarle nada a la base.
 */
function urlDeAlerta(profileId: string): string {
  return `${RUTA_ALERTA_RENOVACION}?perfil=${encodeURIComponent(profileId)}`
}

/**
 * Título: quién, cuánto le queda y de qué.
 *
 * Los tres casos existen porque `dias_restantes` tiene un significado propio en
 * el borde: **0 no es "no queda nada"**, es "no alcanza ni para el día de hoy"
 * (`docs/modelo-medicacion.md` §2.2). Puede haber un comprimido suelto con una
 * dosis de dos. Decir "se acabó" sería impreciso justo en el caso más urgente,
 * y "quedan 0 días" no es una frase que nadie diga.
 */
export function tituloAlertaRenovacion(medicacion: MedicacionParaAlerta): string {
  const nombre = primerNombre(medicacion.nombrePerfil)
  const remedio = medicacion.nombre.trim()
  const dias = medicacion.diasRestantes

  if (dias <= 0) {
    return nombre
      ? `A ${nombre} no le queda ${remedio} para hoy`
      : `No queda ${remedio} para hoy`
  }

  const cuenta = dias === 1 ? "1 día" : `${dias} días`
  const verbo = dias === 1 ? "queda" : "quedan"

  return nombre
    ? `A ${nombre} le ${verbo} ${cuenta} de ${remedio}`
    : `${verbo === "queda" ? "Queda" : "Quedan"} ${cuenta} de ${remedio}`
}

/**
 * "quedan 4 días" / "queda 1 día" / "no alcanza para hoy".
 *
 * Es la frase que usa el **banner** de `/medicacion`
 * (`components/medicacion/banner-renovacion.tsx`), donde el nombre de la
 * persona sobra —quien mira la pantalla ya eligió de quién es el perfil— y lo
 * único que falta decir es cuánto queda.
 *
 * Vive en este módulo y no en el componente para que la forma de contar los
 * días sea la misma en la notificación y en la pantalla: si el push dice
 * "quedan 4 días" y el banner dijera "quedan 5", la persona no sabe a cuál
 * creerle. `dias <= 0` no es "no queda nada" sino "no alcanza ni para el día de
 * hoy" (`docs/modelo-medicacion.md` §2.2), y la frase lo dice literal.
 */
export function fraseDeStockRestante(diasRestantes: number): string {
  if (diasRestantes <= 0) return "no alcanza para hoy"
  if (diasRestantes === 1) return "queda 1 día"
  return `quedan ${diasRestantes} días`
}

/**
 * Cuerpo: el stock concreto y qué conviene hacer.
 *
 * El número de unidades va porque es lo que se verifica de un vistazo abriendo
 * el frasco —"¿me quedan 4 comprimidos? sí"— y porque es lo que se lleva a la
 * farmacia. Sin stock cargado (`stock_units IS NULL`) no se puede llegar acá:
 * `necesita_renovacion` es `false` cuando no hay stock (§2.2 del modelo), pero
 * la rama existe igual para no imprimir "null comprimidos" si alguna vez se
 * llama a mano.
 *
 * "Conviene pedir la renovación de la receta" y no "renová la receta ya": el
 * aviso es preventivo, quedan días, y una app que le grita a una persona mayor
 * por algo que puede resolver mañana es una app que se termina silenciando.
 */
export function cuerpoAlertaRenovacion(medicacion: MedicacionParaAlerta): string {
  const partes: string[] = []

  if (medicacion.stockUnits !== null) {
    const unidades = medicacion.stockUnits

    if (unidades <= 0) {
      partes.push(`Ya no quedan ${pluralizarUnidad(0, medicacion.doseUnit) || "unidades"}`)
    } else {
      // El verbo concuerda con la cantidad igual que la unidad: "Queda 1
      // comprimido", "Quedan 4 comprimidos". Lo detectó un test — la primera
      // versión decía "Quedan 1 comprimido" justo en el caso más urgente.
      const verbo = unidades === 1 ? "Queda" : "Quedan"
      partes.push(`${verbo} ${textoCantidadConUnidad(unidades, medicacion.doseUnit)}`)
    }
  }

  partes.push("Conviene pedir la renovación de la receta.")

  return partes.join(" · ")
}

/**
 * Arma la alerta completa.
 *
 * `tag` sigue la convención ya declarada en `lib/push/servidor.ts`
 * (`medicacion-{id}`): es la antiduplicación **del lado del dispositivo**, la
 * última red si el barrido llegara a repetir un envío tras un lease vencido —el
 * segundo aviso reemplaza al primero en la pantalla en vez de apilarse—. La
 * antiduplicación real, la de 48 horas, la garantiza la base
 * (`generar_alertas_medicacion()` + el índice `medication_renewal_alerts_una_viva`).
 */
export function construirAlertaRenovacion(
  medicacion: MedicacionParaAlerta,
): AlertaRenovacionPush {
  return {
    titulo: tituloAlertaRenovacion(medicacion),
    cuerpo: cuerpoAlertaRenovacion(medicacion),
    url: urlDeAlerta(medicacion.profileId),
    tag: `medicacion-${medicacion.medicationId}`,
  }
}
