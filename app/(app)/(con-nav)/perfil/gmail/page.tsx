/**
 * `/perfil/gmail`: conectar y desconectar la casilla de Gmail de la CUENTA
 * (Sprint 17, tarea 17.1) y la bandeja "Llegaron por Gmail" (tarea 17.2).
 *
 * ## Dos secciones, una pantalla
 *
 * Arriba, el estado de la conexión (`PanelConexionGmail`). Abajo, lo que el
 * barrido encontró (`BandejaGmail`), que solo se renderiza si alguna vez hubo
 * conexión. Se resolvió acá y no en una pantalla nueva por el mismo motivo por
 * el que esta pantalla existe en vez de un menú de configuración: el público
 * de esta app no busca en submenús, y "mi Gmail" es un solo lugar mental —el
 * permiso y lo que llegó por él—.
 *
 * Las tres consultas de la bandeja van con el cliente del USUARIO, por RLS
 * (`lib/gmail/mensajes.ts`), y en el mismo `Promise.all` que el estado de la
 * conexión: son independientes entre sí y encadenarlas costaría cuatro viajes
 * a la base en vez de uno.
 *
 * ## Por qué acá y no en una pantalla de perfil
 *
 * El proyecto todavía no tiene una pantalla de configuración de cuenta —el
 * comentario del pie legal en `app/(app)/(con-nav)/layout.tsx` lo dice con
 * todas las letras—, así que se sigue el patrón que ya existe: `/perfil/sos`
 * es una pantalla propia a la que se llega por una card de `/inicio`, y esta
 * es su hermana. Inventar una pantalla de "Configuración" con dos ítems sería
 * más superficie de la que pide la tarea, y esconder la conexión de Gmail
 * dentro de un menú la volvería imposible de encontrar para el público de
 * esta app.
 *
 * ## Es de la CUENTA, no del perfil activo
 *
 * La card de `/inicio` no está gateada por permiso y la pantalla no pide
 * ninguno: lo que se conecta es la casilla de quien inició sesión, la misma
 * esté mirando el historial de quien esté. Mismo caso que las notificaciones
 * push (nota ⑰ de la migración de RLS) y que el modo de letra: cambiar de
 * perfil no cambia de quién es el correo. La pantalla lo dice explícitamente,
 * porque en una app donde uno pasa el día "viendo a Roberto" la ambigüedad es
 * real.
 *
 * ## Las fechas se formatean en el servidor
 *
 * `Intl.DateTimeFormat` anclado a `America/Argentina/Ushuaia`, igual que el
 * resto del proyecto, y el resultado viaja como texto ya armado. Formatearlas
 * en el cliente funcionaría —la zona está fijada, así que no habría desajuste
 * de hidratación— pero obligaría a mandar los ISO crudos a un Client Component
 * para volver a resolver ahí lo mismo.
 */

import type { Metadata } from "next"
import Link from "next/link"

import { ArrowLeftIcon, MailIcon } from "lucide-react"

import {
  BandejaGmail,
  type CorreoParaBandeja,
  type CorreoProcesadoParaBandeja,
} from "@/components/gmail/bandeja-gmail"
import { PanelConexionGmail } from "@/components/gmail/panel-conexion-gmail"
import { formatearBytes } from "@/lib/archivos/validacion"
import { requerirSesion } from "@/lib/auth/guardas"
import { esResultadoConexion, obtenerConexionGmail } from "@/lib/gmail/conexion"
import { emparejarPorNombreYTamano } from "@/lib/gmail/deteccion-duplicados"
import {
  listarCorreosPendientes,
  listarCorreosResueltos,
  listarFiltrosAprendidos,
  type CorreoDeGmail,
} from "@/lib/gmail/mensajes"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Conectar Gmail — Historial Médico",
}

/** Toda la app opera en la hora de Ushuaia (mismo criterio que `lib/sos/frescura.ts`). */
const ZONA_HORARIA = "America/Argentina/Ushuaia"

/** "18 de agosto de 2026". Fecha para leer, no un sello técnico: acá no hace falta la hora. */
const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  day: "numeric",
  month: "long",
  year: "numeric",
})

/** "18/08/2026 14:30". Sello de frescura de la última revisión. */
const FORMATO_SELLO = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/**
 * "14:30", sin fecha — para el aviso "Posible duplicado del correo de las
 * {hora}" (hotfix de huella digital, Sprint 17 en vivo): el caso real que lo
 * motivó son dos correos del MISMO DÍA con segundos de diferencia (un
 * reenvío "RV:"), así que la hora sola alcanza para que la persona reconozca
 * cuál es el otro.
 */
const FORMATO_HORA = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** Espacios que ICU intercala y que hay que normalizar (mismo criterio que `lib/sos/frescura.ts`). */
const ESPACIOS_INVISIBLES = /[  ]/g

function formatear(iso: string | null, formato: Intl.DateTimeFormat): string | null {
  if (!iso) return null
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  return formato.format(fecha).replace(ESPACIOS_INVISIBLES, " ")
}

/** Motivo por el que un adjunto no se puede importar, dicho sin jerga. */
function motivoDeAdjunto(motivo: string | null): string {
  if (motivo === "demasiado_grande") {
    return "es demasiado grande para importarlo (el límite es 25 MB). Podés abrirlo desde tu Gmail."
  }
  if (motivo === "tipo_no_soportado") {
    return "no es un PDF ni una foto, así que no lo podemos leer."
  }
  return "no se puede importar."
}

/**
 * Un adjunto → lo que necesita la bandeja, en el mismo formato para
 * pendientes y ya revisados (`AdjuntoParaBandeja`). `posibleDuplicadoTexto`
 * solo aplica a pendientes -pasado por quien llama-; en un correo ya
 * revisado siempre es `null`.
 */
function aAdjunto(adjunto: CorreoDeGmail["adjuntos"][number], posibleDuplicadoTexto: string | null) {
  return {
    id: adjunto.attachmentId,
    nombre: adjunto.filename,
    tamanoTexto: formatearBytes(adjunto.size),
    apto: adjunto.apto,
    motivoTexto: adjunto.apto ? null : motivoDeAdjunto(adjunto.motivo),
    posibleDuplicadoTexto,
  }
}

/**
 * Correo pendiente → lo que necesita la bandeja, con todo ya formateado en el
 * servidor.
 *
 * `emparejados`/`horaPorCorreoId` vienen de `emparejarPorNombreYTamano`
 * (hotfix de huella digital, Sprint 17 en vivo): arman el texto discreto
 * "Posible duplicado del correo de las {hora}" en cada adjunto que comparte
 * nombre y tamaño con el de OTRO correo pendiente, sin bajar ningún byte.
 */
function aPendiente(
  correo: CorreoDeGmail,
  remitentesConFiltro: Set<string>,
  emparejados: Map<string, string>,
  horaPorCorreoId: Map<string, string>,
): CorreoParaBandeja {
  return {
    id: correo.id,
    asunto: correo.asunto ?? "(sin asunto)",
    remitente: correo.remitenteNombre ?? correo.remitenteEmail,
    remitenteEmail: correo.remitenteEmail,
    fechaTexto: formatear(correo.fechaIso, FORMATO_SELLO) ?? "sin fecha",
    adjuntos: correo.adjuntos.map((adjunto) => {
      const otroCorreoId = emparejados.get(`${correo.id}:${adjunto.attachmentId}`)
      const horaDelOtro = otroCorreoId ? horaPorCorreoId.get(otroCorreoId) : null

      return aAdjunto(
        adjunto,
        horaDelOtro ? `Posible duplicado del correo de las ${horaDelOtro}.` : null,
      )
    }),
    pareceTurno: correo.pareceTurno,
    tieneFiltro: remitentesConFiltro.has(correo.remitenteEmail),
  }
}

/** Correo ya resuelto → una línea que diga en qué terminó. */
function aProcesado(correo: CorreoDeGmail): CorreoProcesadoParaBandeja {
  const teniaAdjuntoApto = correo.adjuntos.some((adjunto) => adjunto.apto)

  let destinoTexto: string
  if (correo.estado === "descartado") {
    destinoTexto = correo.clase === "nada" ? "no traía nada para sumar" : "lo descartaste"
  } else if (correo.documentId) {
    destinoTexto = "se sumó como estudio"
  } else if (correo.appointmentId) {
    destinoTexto = "se cargó como turno"
  } else {
    // `ingresado` sin puntero: el documento o el turno se borraron después
    // (ON DELETE SET NULL), típicamente porque se descartó en la pantalla de
    // revisión.
    destinoTexto = "lo trajiste, pero después se descartó"
  }

  return {
    id: correo.id,
    asunto: correo.asunto ?? "(sin asunto)",
    remitente: correo.remitenteNombre ?? correo.remitenteEmail,
    remitenteEmail: correo.remitenteEmail,
    fechaTexto: formatear(correo.fechaIso, FORMATO_SELLO) ?? "sin fecha",
    destinoTexto,
    documentoId: correo.documentId,
    appointmentId: correo.appointmentId,
    adjuntos: correo.adjuntos.map((adjunto) => aAdjunto(adjunto, null)),
    pareceTurno: correo.pareceTurno,
    puedeReabrir:
      correo.estado === "ingresado" &&
      correo.documentId === null &&
      correo.appointmentId === null &&
      teniaAdjuntoApto,
  }
}

export default async function PaginaGmail({
  searchParams,
}: {
  searchParams: Promise<{ resultado?: string }>
}) {
  const { usuario, supabase } = await requerirSesion({ desde: "/perfil/gmail" })

  const [conexion, parametros, pendientes, procesados, filtros, activo] = await Promise.all([
    obtenerConexionGmail(supabase, usuario.id),
    searchParams,
    listarCorreosPendientes(supabase),
    listarCorreosResueltos(supabase),
    listarFiltrosAprendidos(supabase),
    obtenerPerfilActivo(),
  ])

  const resultado = esResultadoConexion(parametros.resultado) ? parametros.resultado : null
  const remitentesConFiltro = new Set(filtros.map((filtro) => filtro.remitente))

  // "Posible duplicado" (hotfix de huella digital, Sprint 17 en vivo): puro,
  // sin red, solo con la metadata (nombre, tamaño) que el barrido ya
  // registró en cada correo pendiente.
  const emparejados = emparejarPorNombreYTamano(
    pendientes.map((correo) => ({ id: correo.id, adjuntos: correo.adjuntos })),
  )
  const horaPorCorreoId = new Map(
    pendientes.map((correo) => [correo.id, formatear(correo.fechaIso, FORMATO_HORA) ?? ""]),
  )

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-3 chica:py-3">
      <Link
        href="/inicio"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver al inicio
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          <MailIcon className="size-6 shrink-0 text-primary" aria-hidden="true" />
          Tu Gmail
        </h1>
        <p className="text-base text-muted-foreground">
          Traer solos los turnos y los estudios que las clínicas te mandan por correo.
        </p>
        <p className="text-sm text-muted-foreground">
          Esta conexión es de tu cuenta: vale para todos los perfiles que administrás, no solo para
          el que estás viendo ahora.
        </p>
      </div>

      <PanelConexionGmail
        resultado={resultado}
        conexion={
          conexion === null
            ? null
            : {
                email: conexion.email,
                estado: conexion.estado,
                labelName: conexion.labelName,
                tieneEtiqueta: conexion.labelId !== null,
                conectadaElTexto:
                  formatear(conexion.conectadaEl, FORMATO_FECHA) ?? "hace un rato",
                ultimoOkTexto: formatear(conexion.ultimoOk, FORMATO_SELLO),
                vencidaElTexto: formatear(conexion.vencidaEl, FORMATO_FECHA),
              }
        }
      />

      {/*
        La bandeja solo aparece si alguna vez hubo conexión. Sin ella no hay
        nada que listar, y mostrar una sección vacía debajo del panel de
        "conectá tu Gmail" sería ruido antes de tiempo. Si la conexión venció
        SÍ se muestra: los correos que ya habían llegado siguen esperando y hay
        que poder revisarlos aunque el permiso haya caducado.
      */}
      {conexion !== null && (
        <BandejaGmail
          pendientes={pendientes.map((correo) =>
            aPendiente(correo, remitentesConFiltro, emparejados, horaPorCorreoId),
          )}
          procesados={procesados.map(aProcesado)}
          filtros={filtros.map((filtro) => ({
            id: filtro.id,
            remitente: filtro.remitente,
            creadoTexto: formatear(filtro.creadoEl, FORMATO_FECHA) ?? "hace un rato",
          }))}
          perfilActivoNombre={activo?.perfil.full_name ?? null}
          puedeCargar={activo?.permisos.canUpload ?? false}
          conexionViva={conexion.estado === "conectada"}
        />
      )}
    </div>
  )
}
