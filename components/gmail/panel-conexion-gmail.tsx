"use client"

/**
 * Panel de la conexión de Gmail (Sprint 17, tarea 17.1).
 *
 * Tres estados y ninguno más: **desconectado**, **conectado** y **vencido**.
 * El tercero existe porque mientras la pantalla de consentimiento de Google
 * siga "En prueba", los refresh tokens caducan a los 7 días: sin un estado
 * propio, la persona vería un día "no tenés nada conectado" después de haber
 * conectado, sin ninguna explicación y sin saber que tiene que rehacerlo.
 *
 * ## La explicación va ANTES del botón, y en castellano llano
 *
 * Lo que se le pide a la persona es acceso a su correo. La pantalla tiene que
 * decir, con palabras que se entiendan sin saber qué es una API, qué se va a
 * leer (solo lo de la etiqueta), qué NO (el resto de la casilla) y que puede
 * cortar cuando quiera. Nada de "scopes", "OAuth" ni "tokens": esos son
 * detalles nuestros, no de quien decide.
 *
 * ## Por qué el botón de conectar es un enlace y no un `fetch`
 *
 * `/api/gmail/conectar` termina en una redirección a `accounts.google.com`.
 * Eso es una navegación de nivel superior: tiene que salir del navegador como
 * tal, no como una petición de fondo (un `fetch` seguiría el redirect y
 * traería el HTML de Google a la nada). El velo de espera se enciende al
 * tocarlo porque el salto a Google, en un teléfono con datos móviles, tarda lo
 * suficiente como para que el silencio se lea como "no pasó nada".
 */

import * as React from "react"
import { useActionState } from "react"

import {
  CheckCircle2Icon,
  LinkIcon,
  MailIcon,
  RefreshCwIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import { Tarjeta } from "@/components/base/tarjeta"
import { VeloEspera } from "@/components/base/velo-espera"
import { desconectarGmail } from "@/app/(app)/(con-nav)/perfil/gmail/actions"
import {
  ESTADO_GMAIL_INICIAL,
  type EstadoGmailAccion,
  type ResultadoConexion,
} from "@/lib/gmail/conexion"

/** Ruta que arranca el consentimiento. Es un Route Handler, no una pantalla. */
const RUTA_CONECTAR = "/api/gmail/conectar"

/** Dónde saca la persona el permiso desde su propia cuenta de Google. */
const URL_PERMISOS_GOOGLE = "https://myaccount.google.com/connections"

export interface ConexionParaPanel {
  email: string
  estado: "conectada" | "vencida"
  /** Nombre visible de la etiqueta en la casilla. */
  labelName: string
  /** `false` si la etiqueta no se pudo crear al conectar. */
  tieneEtiqueta: boolean
  /** Ya formateado en el servidor, para que no haya dos husos horarios en juego. */
  conectadaElTexto: string
  ultimoOkTexto: string | null
  vencidaElTexto: string | null
}

export interface PanelConexionGmailProps {
  conexion: ConexionParaPanel | null
  /** Motivo con el que volvió el callback, si esta carga viene de ahí. */
  resultado: ResultadoConexion | null
}

/**
 * Una frase por cada final posible del circuito. Es un `Record` completo sobre
 * el dominio cerrado `ResultadoConexion`: si mañana se agrega un motivo, el
 * compilador marca este mapa incompleto en vez de dejarlo caer en un genérico.
 */
const AVISO_POR_RESULTADO: Record<
  ResultadoConexion,
  { variante: "exito" | "info" | "error" | "advertencia"; texto: string }
> = {
  conectada: {
    variante: "exito",
    texto: "Listo: tu Gmail quedó conectado.",
  },
  desconectada: {
    variante: "info",
    texto: "Desconectamos tu Gmail. La app ya no puede leer ningún correo tuyo.",
  },
  cancelada: {
    variante: "info",
    texto:
      "No conectamos nada: cancelaste en la pantalla de Google. Podés hacerlo cuando quieras, no perdiste nada.",
  },
  estado_invalido: {
    variante: "error",
    texto:
      "No pudimos comprobar que el pedido hubiera salido de esta pantalla, así que lo cortamos por seguridad. Volvé a tocar «Conectar mi Gmail».",
  },
  sin_refresh_token: {
    variante: "error",
    texto:
      "Google nos dio un permiso que dura una sola hora. Volvé a intentarlo y, en la pantalla de Google, aceptá todos los permisos que te muestre.",
  },
  fallo_google: {
    variante: "error",
    texto: "Google no pudo completar la conexión. Probá de nuevo en un rato.",
  },
  sin_configurar: {
    variante: "error",
    texto:
      "La conexión con Gmail todavía no está configurada en este servidor. No es algo que puedas resolver desde acá.",
  },
  origen_no_registrado: {
    variante: "error",
    texto:
      "Desde esta dirección web no se puede conectar Gmail. Entrá a historialmedico.com.ar y probá de nuevo.",
  },
}

export function PanelConexionGmail({ conexion, resultado }: PanelConexionGmailProps) {
  const [estadoAccion, enviarDesconexion, desconectando] = useActionState<
    EstadoGmailAccion,
    FormData
  >(desconectarGmail, ESTADO_GMAIL_INICIAL)

  const [conectando, setConectando] = React.useState(false)

  // El aviso del `?resultado=` se calla en cuanto la desconexión deja el suyo:
  // dos alertas contradictorias en pantalla ("conectado" arriba, "desconectado"
  // abajo) es peor que ninguna.
  const avisoDeVuelta =
    resultado && !estadoAccion.mensaje && !estadoAccion.error
      ? AVISO_POR_RESULTADO[resultado]
      : null

  return (
    <div className="flex flex-col gap-4 chica:gap-3">
      {avisoDeVuelta && <Alerta variante={avisoDeVuelta.variante}>{avisoDeVuelta.texto}</Alerta>}

      {estadoAccion.mensaje && <Alerta variante="exito">{estadoAccion.mensaje}</Alerta>}
      {estadoAccion.error && <Alerta variante="error">{estadoAccion.error}</Alerta>}

      {estadoAccion.revocacionPendiente && (
        <Alerta variante="advertencia">
          <span className="block">
            Sacamos la conexión de la app, pero Google no nos confirmó que el permiso quedara
            anulado de su lado. Para asegurarte, quitá «Historial Médico» desde tu cuenta de
            Google.
          </span>
          <a
            className="mt-2 inline-block font-medium text-primary underline underline-offset-2"
            href={URL_PERMISOS_GOOGLE}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir los permisos de mi cuenta de Google
          </a>
        </Alerta>
      )}

      {conexion === null ? (
        <PanelDesconectado onConectar={() => setConectando(true)} />
      ) : conexion.estado === "vencida" ? (
        <PanelVencido
          conexion={conexion}
          onConectar={() => setConectando(true)}
          accionDesconectar={enviarDesconexion}
          errorDesconexion={estadoAccion.error}
        />
      ) : (
        <PanelConectado
          conexion={conexion}
          onReconectar={() => setConectando(true)}
          accionDesconectar={enviarDesconexion}
          errorDesconexion={estadoAccion.error}
        />
      )}

      <VeloEspera
        visible={conectando}
        mensaje="Te estamos llevando a Google"
        submensaje="Ahí vas a elegir tu cuenta y aceptar los permisos. Después volvés solo a esta pantalla."
      />
      <VeloEspera
        visible={desconectando}
        mensaje="Desconectando tu Gmail"
        submensaje="Le estamos avisando a Google que anule el permiso."
      />
    </div>
  )
}

/** El botón grande que sale hacia Google. Idéntico en los tres estados, con distinta etiqueta. */
function BotonConectar({ texto, onConectar }: { texto: string; onConectar: () => void }) {
  return (
    <Boton
      render={<a href={RUTA_CONECTAR} />}
      nativeButton={false}
      size="lg"
      onClick={onConectar}
    >
      <LinkIcon aria-hidden="true" />
      {texto}
    </Boton>
  )
}

function PanelDesconectado({ onConectar }: { onConectar: () => void }) {
  return (
    <Tarjeta className="flex flex-col gap-4 p-5 chica:gap-3 chica:p-4">
      <div className="flex items-start gap-3">
        <MailIcon className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold chica:text-lg">Todavía no conectaste tu Gmail</h2>
          <p className="text-base text-muted-foreground chica:text-sm">
            Las clínicas y los laboratorios suelen avisar los turnos y mandar los estudios por
            correo. Si conectás tu Gmail, la app puede ir a buscarlos sola.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-4 chica:gap-1.5 chica:p-3">
        <p className="text-base font-medium chica:text-sm">Qué vamos a leer, exactamente</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-base text-muted-foreground chica:gap-1 chica:text-sm">
          <li>
            <strong className="font-medium text-foreground">
              Solo los correos de la etiqueta <span className="font-mono">historialmedico</span>
            </strong>
            . Los que vos le pongas, o los que entren ahí solos.
          </li>
          <li>
            Al conectar, <strong className="font-medium text-foreground">creamos esa etiqueta</strong>{" "}
            en tu Gmail si todavía no la tenés. No hace falta que la escribas.
          </li>
          <li>
            <strong className="font-medium text-foreground">Nada más de tu casilla</strong>: ni tus
            correos personales, ni los del trabajo, ni los de nadie más.
          </li>
          <li>
            Nunca mandamos, respondemos ni borramos correos. Y{" "}
            <strong className="font-medium text-foreground">
              nada se guarda en el historial sin que vos lo revises
            </strong>
            .
          </li>
          <li>Podés desconectarlo cuando quieras, desde esta misma pantalla.</li>
        </ul>
      </div>

      <BotonConectar texto="Conectar mi Gmail" onConectar={onConectar} />
    </Tarjeta>
  )
}

/** Ficha de datos de la conexión, compartida por el estado conectado y el vencido. */
function DatosDeLaConexion({ conexion }: { conexion: ConexionParaPanel }) {
  return (
    <dl className="flex flex-col gap-3 text-base chica:gap-2 chica:text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm text-muted-foreground chica:text-xs">Casilla conectada</dt>
        <dd className="font-medium break-all">{conexion.email}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm text-muted-foreground chica:text-xs">Conectada desde</dt>
        <dd className="font-medium">{conexion.conectadaElTexto}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm text-muted-foreground chica:text-xs">Etiqueta que leemos</dt>
        <dd className="flex items-center gap-2 font-medium">
          {conexion.tieneEtiqueta ? (
            <>
              <TagIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="font-mono">{conexion.labelName}</span>
              <CheckCircle2Icon className="size-4 shrink-0 text-exito" aria-hidden="true" />
            </>
          ) : (
            <span className="text-advertencia-fuerte">
              No pudimos crearla. Tocá «Volver a conectar» para reintentarlo.
            </span>
          )}
        </dd>
      </div>
      {conexion.ultimoOkTexto && (
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-muted-foreground chica:text-xs">Última revisión</dt>
          <dd className="font-medium">{conexion.ultimoOkTexto}</dd>
        </div>
      )}
    </dl>
  )
}

function BotonDesconectar({
  email,
  accion,
  error,
}: {
  email: string
  accion: (formData: FormData) => void
  error: string | null
}) {
  return (
    <DialogoConfirmacion
      disparador={<Boton variant="destructivo" size="lg" />}
      titulo="¿Desconectar tu Gmail?"
      consecuencia={`La app deja de leer los correos de ${email} ahora mismo y le pedimos a Google que anule el permiso. Lo que ya importaste queda en el historial.`}
      accion={accion}
      error={error}
      textoConfirmar="Sí, desconectar"
    >
      <Trash2Icon aria-hidden="true" />
      Desconectar
    </DialogoConfirmacion>
  )
}

function PanelConectado({
  conexion,
  onReconectar,
  accionDesconectar,
  errorDesconexion,
}: {
  conexion: ConexionParaPanel
  onReconectar: () => void
  accionDesconectar: (formData: FormData) => void
  errorDesconexion: string | null
}) {
  return (
    <Tarjeta className="flex flex-col gap-4 p-5 chica:gap-3 chica:p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2Icon className="mt-0.5 size-6 shrink-0 text-exito" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold chica:text-lg">Tu Gmail está conectado</h2>
          <p className="text-base text-muted-foreground chica:text-sm">
            Leemos únicamente los correos que estén en la etiqueta{" "}
            <span className="font-mono">{conexion.labelName}</span>. Nada más.
          </p>
        </div>
      </div>

      <DatosDeLaConexion conexion={conexion} />

      <div className="flex flex-wrap gap-2">
        <BotonDesconectar
          email={conexion.email}
          accion={accionDesconectar}
          error={errorDesconexion}
        />
        {!conexion.tieneEtiqueta && (
          <Boton
            render={<a href={RUTA_CONECTAR} />}
            nativeButton={false}
            variant="outline"
            size="lg"
            onClick={onReconectar}
          >
            <RefreshCwIcon aria-hidden="true" />
            Volver a conectar
          </Boton>
        )}
      </div>
    </Tarjeta>
  )
}

function PanelVencido({
  conexion,
  onConectar,
  accionDesconectar,
  errorDesconexion,
}: {
  conexion: ConexionParaPanel
  onConectar: () => void
  accionDesconectar: (formData: FormData) => void
  errorDesconexion: string | null
}) {
  return (
    <Tarjeta className="flex flex-col gap-4 p-5 chica:gap-3 chica:p-4">
      <div className="flex items-start gap-3">
        <TriangleAlertIcon
          className="mt-0.5 size-6 shrink-0 text-advertencia-fuerte"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold chica:text-lg">Se venció el permiso</h2>
          <p className="text-base text-muted-foreground chica:text-sm">
            Google dejó de darnos acceso a {conexion.email}
            {conexion.vencidaElTexto ? ` el ${conexion.vencidaElTexto}` : ""}. No se perdió nada de
            lo que ya habías importado: solo hay que volver a dar el permiso.
          </p>
        </div>
      </div>

      <DatosDeLaConexion conexion={conexion} />

      <div className="flex flex-wrap gap-2">
        <BotonConectar texto="Volver a conectar" onConectar={onConectar} />
        <BotonDesconectar
          email={conexion.email}
          accion={accionDesconectar}
          error={errorDesconexion}
        />
      </div>
    </Tarjeta>
  )
}
