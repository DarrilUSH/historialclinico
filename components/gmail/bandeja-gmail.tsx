"use client"

/**
 * "Llegaron por Gmail": la bandeja de lo que el barrido encontró en la
 * etiqueta (Sprint 17, tarea 17.2).
 *
 * ## Qué es y qué no es
 *
 * **No es una pantalla de revisión.** Acá no se corrige nada, no se completa
 * nada y no se guarda nada en el historial: cada ítem tiene un botón que lleva
 * a la pantalla de revisión que YA EXISTE —la del estudio recién subido para
 * los adjuntos, `/turnos/nuevo` con la propuesta precargada para los turnos—.
 * Esta lista es un vestíbulo: dice qué llegó y adónde ir con cada cosa.
 *
 * Esa decisión es la que hace que la ingesta desde Gmail no tenga UNA SOLA
 * pantalla de revisión propia: la persona termina siempre en la misma pantalla
 * que ya conoce de subir un estudio a mano o de cargar un turno, con los
 * mismos botones en los mismos lugares.
 *
 * ## Un `useActionState` por acción, no por ítem
 *
 * Las cinco acciones (revisar, descartar, reabrir, aprender remitente, sacar
 * filtro) se declaran una vez arriba y cada ítem las invoca con un `<form>`
 * con campos ocultos. Con un estado por ítem habría tantos hooks como correos
 * -imposible, la cantidad es dinámica- y la única ventaja sería mostrar el
 * error al lado del ítem exacto. Se prefiere una sola franja de aviso arriba,
 * que además es donde una persona mayor la va a ver sin buscarla.
 *
 * ## Denso en chica
 *
 * `docs/densidad.md` regla 5: la densidad achica el aire, no saca contenido.
 * En modo chica se reducen paddings, gaps y tamaños de texto, pero siguen
 * estando el asunto, el remitente, la fecha, los adjuntos y todos los botones.
 */

import * as React from "react"
import { useActionState } from "react"

import {
  CalendarPlusIcon,
  FileTextIcon,
  FilterIcon,
  InboxIcon,
  MailOpenIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { VeloEspera } from "@/components/base/velo-espera"
import { DialogoDetallePendiente, DialogoDetalleProcesado } from "@/components/gmail/detalle-correo"
import {
  aprenderRemitente,
  buscarCorreosAhora,
  descartarCorreo,
  ingerirAdjuntoDeCorreo,
  reabrirCorreo,
  sacarFiltroAprendido,
} from "@/app/(app)/(con-nav)/perfil/gmail/actions"
import {
  ESTADO_BUSQUEDA_INICIAL,
  ESTADO_CORREO_INICIAL,
  type EstadoBusquedaGmail,
  type EstadoCorreoGmail,
} from "@/lib/gmail/acciones"

export interface AdjuntoParaBandeja {
  /** `attachmentId` de Gmail. */
  id: string
  nombre: string
  /** "1,2 MB", ya formateado en el servidor. */
  tamanoTexto: string
  apto: boolean
  /** Por qué no se puede importar, en castellano. `null` si es apto. */
  motivoTexto: string | null
  /**
   * Heurística de bandeja (hotfix de huella digital, Sprint 17 en vivo): otro
   * correo PENDIENTE trae un adjunto con el mismo nombre y tamaño -sin bajar
   * ningún byte, solo con la metadata que el barrido ya registró-. Texto
   * discreto, no bloquea nada; `null` si no hay coincidencia. El cotejo real
   * por contenido pasa recién al tocar "Revisar este estudio"
   * (`lib/documentos/huella.ts`).
   */
  posibleDuplicadoTexto: string | null
}

export interface CorreoParaBandeja {
  id: string
  asunto: string
  /** Nombre visible del remitente si lo había; si no, la dirección. */
  remitente: string
  remitenteEmail: string
  fechaTexto: string
  adjuntos: AdjuntoParaBandeja[]
  /** El cuerpo tenía pinta de aviso de turno. */
  pareceTurno: boolean
  /** Ya hay una regla para este remitente: no se vuelve a ofrecer. */
  tieneFiltro: boolean
}

export interface CorreoProcesadoParaBandeja {
  id: string
  asunto: string
  /** Nombre visible del remitente si lo había; si no, la dirección. */
  remitente: string
  /**
   * La dirección, siempre. Ampliación en vivo (diálogo de detalle, 2026-08-18):
   * cuando `remitente` es el nombre visible, el diálogo muestra las dos —el
   * resumen de la tarjeta solo tenía lugar para una.
   */
  remitenteEmail: string
  fechaTexto: string
  /** Qué terminó pasando, en una frase corta. */
  destinoTexto: string
  /** El estudio que salió de acá, si sigue existiendo. */
  documentoId: string | null
  /** El turno que salió de acá, si sigue existiendo (ampliación en vivo, diálogo de detalle). */
  appointmentId: string | null
  /** Los adjuntos que traía (ampliación en vivo, diálogo de detalle: "qué contenía"). */
  adjuntos: AdjuntoParaBandeja[]
  /** El cuerpo tenía pinta de aviso de turno (ampliación en vivo, diálogo de detalle). */
  pareceTurno: boolean
  /** `true` si se puede volver a poner en la lista (quedó sin destino y tenía un adjunto). */
  puedeReabrir: boolean
}

export interface FiltroParaBandeja {
  id: string
  remitente: string
  creadoTexto: string
}

export interface BandejaGmailProps {
  pendientes: CorreoParaBandeja[]
  procesados: CorreoProcesadoParaBandeja[]
  filtros: FiltroParaBandeja[]
  /** Nombre del perfil activo: a quién se le van a sumar los estudios que se importen. */
  perfilActivoNombre: string | null
  /** `false` si el perfil activo no admite cargas de esta cuenta (`can_view` puro). */
  puedeCargar: boolean
  /** `false` si la conexión está vencida o no existe: no tiene sentido ofrecer "Buscar ahora". */
  conexionViva: boolean
}

export function BandejaGmail({
  pendientes,
  procesados,
  filtros,
  perfilActivoNombre,
  puedeCargar,
  conexionViva,
}: BandejaGmailProps) {
  const [busqueda, buscar, buscando] = useActionState<EstadoBusquedaGmail, FormData>(
    buscarCorreosAhora,
    ESTADO_BUSQUEDA_INICIAL,
  )
  const [ingesta, ingerir, ingiriendo] = useActionState<EstadoCorreoGmail, FormData>(
    ingerirAdjuntoDeCorreo,
    ESTADO_CORREO_INICIAL,
  )
  const [descarte, descartar, descartando] = useActionState<EstadoCorreoGmail, FormData>(
    descartarCorreo,
    ESTADO_CORREO_INICIAL,
  )
  const [reapertura, reabrir, reabriendo] = useActionState<EstadoCorreoGmail, FormData>(
    reabrirCorreo,
    ESTADO_CORREO_INICIAL,
  )
  const [aprendizaje, aprender, aprendiendo] = useActionState<EstadoCorreoGmail, FormData>(
    aprenderRemitente,
    ESTADO_CORREO_INICIAL,
  )
  const [olvido, olvidar, olvidando] = useActionState<EstadoCorreoGmail, FormData>(
    sacarFiltroAprendido,
    ESTADO_CORREO_INICIAL,
  )

  const avisos = [descarte, reapertura, aprendizaje, olvido, ingesta]
  const error = busqueda.error ?? avisos.find((estado) => estado.error)?.error ?? null
  const exito = busqueda.mensaje ?? avisos.find((estado) => estado.mensaje)?.mensaje ?? null
  // Solo `ingesta` lo llena (ver `EstadoCorreoGmail.duplicado`). `?? null`
  // porque el tipo lo declara opcional para las otras cuatro acciones.
  const duplicado = ingesta.duplicado ?? null

  return (
    <section className="flex flex-col gap-4 chica:gap-3" aria-labelledby="titulo-bandeja-gmail">
      <div className="flex flex-wrap items-center justify-between gap-3 chica:gap-2">
        <h2
          id="titulo-bandeja-gmail"
          className="flex items-center gap-2 text-xl font-semibold chica:text-lg"
        >
          <InboxIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
          Llegaron por Gmail
          {pendientes.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">
              {pendientes.length}
            </span>
          )}
        </h2>

        {conexionViva && (
          <form action={buscar}>
            <Boton type="submit" variant="outline" cargando={buscando}>
              <SearchIcon aria-hidden="true" />
              Buscar ahora
            </Boton>
          </form>
        )}
      </div>

      {error && <Alerta variante="error">{error}</Alerta>}
      {!error && exito && <Alerta variante="exito">{exito}</Alerta>}

      {!error && duplicado && (
        <div className="flex flex-col gap-3">
          <Alerta variante="advertencia">
            Este archivo es idéntico a «{duplicado.titulo}» cargado el {duplicado.fechaTexto}.
          </Alerta>
          <div className="flex flex-wrap gap-2">
            <Boton
              render={<a href={`/estudios/${duplicado.documentoId}`} />}
              nativeButton={false}
              size="sm"
            >
              Ver ese estudio
            </Boton>
            <form action={ingerir}>
              <input type="hidden" name="correoId" value={duplicado.correoId} />
              <input type="hidden" name="adjuntoId" value={duplicado.adjuntoId} />
              <input type="hidden" name="forzar" value="1" />
              <Boton type="submit" variant="outline" size="sm" cargando={ingiriendo}>
                Cargar igual
              </Boton>
            </form>
          </div>
        </div>
      )}

      {pendientes.length === 0 ? (
        <Tarjeta className="flex flex-col gap-2 p-5 chica:gap-1.5 chica:p-4">
          <p className="text-base font-medium chica:text-sm">No hay correos esperando.</p>
          <p className="text-base text-muted-foreground chica:text-sm">
            Cuando llegue algo a la etiqueta lo vas a ver acá. Revisamos tu Gmail cada media hora, y
            podés adelantarlo con «Buscar ahora».
          </p>
        </Tarjeta>
      ) : (
        <>
          {perfilActivoNombre && puedeCargar && (
            <p className="text-sm text-muted-foreground chica:text-xs">
              Los estudios que traigas se van a sumar al historial de{" "}
              <strong className="font-medium text-foreground">{perfilActivoNombre}</strong>. Si es de
              otra persona, cambiá de perfil antes.
            </p>
          )}
          {!puedeCargar && (
            <Alerta variante="advertencia">
              Con el perfil que estás viendo no podés sumar estudios ni turnos. Cambiá a un perfil
              tuyo o pedile permiso a quien lo administra.
            </Alerta>
          )}

          <ul className="flex flex-col gap-3 chica:gap-2">
            {pendientes.map((correo) => (
              <li key={correo.id}>
                <CorreoPendiente
                  correo={correo}
                  puedeCargar={puedeCargar}
                  accionIngerir={ingerir}
                  accionDescartar={descartar}
                  accionAprender={aprender}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {procesados.length > 0 && (
        <details className="rounded-lg border border-border p-4 chica:p-3">
          <summary className="cursor-pointer text-base font-medium chica:text-sm">
            Correos que ya revisaste ({procesados.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2 chica:mt-2 chica:gap-1.5">
            {procesados.map((correo) => (
              <li
                key={correo.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
              >
                <DialogoDetalleProcesado correo={correo} accionReabrir={reabrir} />
                {correo.puedeReabrir && (
                  <form action={reabrir}>
                    <input type="hidden" name="correoId" value={correo.id} />
                    <Boton type="submit" variant="outline" size="sm" cargando={reabriendo}>
                      <RotateCcwIcon aria-hidden="true" />
                      Volver a la lista
                    </Boton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {filtros.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-4 chica:gap-1.5 chica:p-3">
          <h3 className="flex items-center gap-2 text-base font-medium chica:text-sm">
            <FilterIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Remitentes que entran solos
          </h3>
          <p className="text-sm text-muted-foreground chica:text-xs">
            Estas reglas están en tu Gmail: los correos de estas direcciones se etiquetan solos.
            Siguen llegando a tu bandeja de entrada como siempre.
          </p>
          <ul className="flex flex-col gap-2 chica:gap-1.5">
            {filtros.map((filtro) => (
              <li key={filtro.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 truncate text-base chica:text-sm">
                  <span className="font-medium break-all">{filtro.remitente}</span>{" "}
                  <span className="text-muted-foreground">· desde el {filtro.creadoTexto}</span>
                </span>
                <form action={olvidar}>
                  <input type="hidden" name="filtroId" value={filtro.id} />
                  <Boton type="submit" variant="outline" size="sm" cargando={olvidando}>
                    <XIcon aria-hidden="true" />
                    Sacar
                  </Boton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <VeloEspera
        visible={buscando}
        mensaje="Estamos mirando tu Gmail…"
        submensaje="Solo los correos de la etiqueta. Esto puede tardar unos segundos."
      />
      <VeloEspera
        visible={ingiriendo}
        mensaje="Trayendo el archivo desde tu correo…"
        submensaje="Después vas a poder revisarlo antes de guardarlo."
      />
      <VeloEspera visible={descartando || reabriendo} mensaje="Un momento…" />
      <VeloEspera
        visible={aprendiendo}
        mensaje="Creando la regla en tu Gmail…"
        submensaje="Los próximos correos de esa dirección se van a etiquetar solos."
      />
    </section>
  )
}

function CorreoPendiente({
  correo,
  puedeCargar,
  accionIngerir,
  accionDescartar,
  accionAprender,
}: {
  correo: CorreoParaBandeja
  puedeCargar: boolean
  accionIngerir: (formData: FormData) => void
  accionDescartar: (formData: FormData) => void
  accionAprender: (formData: FormData) => void
}) {
  const aptos = correo.adjuntos.filter((adjunto) => adjunto.apto)
  const rechazados = correo.adjuntos.filter((adjunto) => !adjunto.apto)

  return (
    <Tarjeta className="flex flex-col gap-3 p-4 chica:gap-2 chica:p-3">
      <DialogoDetallePendiente
        correo={correo}
        puedeCargar={puedeCargar}
        accionIngerir={accionIngerir}
        accionDescartar={accionDescartar}
        accionAprender={accionAprender}
      />

      {aptos.length > 0 && (
        <ul className="flex flex-col gap-2 chica:gap-1.5">
          {aptos.map((adjunto) => (
            <li key={adjunto.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-base chica:text-sm">
                  <FileTextIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate">{adjunto.nombre}</span>
                  <span className="shrink-0 text-muted-foreground">{adjunto.tamanoTexto}</span>
                </span>
                {puedeCargar && (
                  <form action={accionIngerir}>
                    <input type="hidden" name="correoId" value={correo.id} />
                    <input type="hidden" name="adjuntoId" value={adjunto.id} />
                    <Boton type="submit" size="sm">
                      <MailOpenIcon aria-hidden="true" />
                      Revisar este estudio
                    </Boton>
                  </form>
                )}
              </div>
              {adjunto.posibleDuplicadoTexto && (
                <p className="text-sm text-muted-foreground chica:text-xs">
                  {adjunto.posibleDuplicadoTexto}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {rechazados.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground chica:text-xs">
          {rechazados.map((adjunto) => (
            <li key={adjunto.id}>
              <span className="font-medium">{adjunto.nombre}</span>: {adjunto.motivoTexto}
            </li>
          ))}
        </ul>
      )}

      {correo.pareceTurno && puedeCargar && (
        <div className="flex flex-col gap-1">
          <Boton
            render={<a href={`/turnos/nuevo?gmail=${correo.id}`} />}
            nativeButton={false}
            variant={aptos.length > 0 ? "outline" : "default"}
            size="sm"
            className="w-fit"
          >
            <CalendarPlusIcon aria-hidden="true" />
            Revisar este turno
          </Boton>
          <p className="text-sm text-muted-foreground chica:text-xs">
            Parece un aviso de turno. Al abrirlo, la inteligencia artificial lo lee y te precarga el
            formulario para que revises.
          </p>
        </div>
      )}

      {aptos.length === 0 && !correo.pareceTurno && (
        <p className="text-sm text-muted-foreground chica:text-xs">
          No encontramos ni un estudio ni un turno acá adentro. Podés abrirlo en tu Gmail.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={accionDescartar}>
          <input type="hidden" name="correoId" value={correo.id} />
          <Boton type="submit" variant="outline" size="sm">
            <Trash2Icon aria-hidden="true" />
            No me sirve
          </Boton>
        </form>

        {!correo.tieneFiltro && (
          <form action={accionAprender}>
            <input type="hidden" name="correoId" value={correo.id} />
            <Boton type="submit" variant="outline" size="sm">
              <RefreshCwIcon aria-hidden="true" />
              Traer solos los de {correo.remitenteEmail}
            </Boton>
          </form>
        )}
      </div>
    </Tarjeta>
  )
}
