"use client"

/**
 * "¿Te llegó el turno por WhatsApp? Pegalo acá" (Sprint 16, tarea 16.4):
 * sección colapsable arriba de `FormularioTurno` que manda el texto pegado a
 * `POST /api/turnos/analizar-mensaje` y, con el resultado, PRECARGA el
 * formulario para que la persona lo revise y corrija — la IA nunca guarda
 * nada, `onAplicarPropuesta` solo cambia estado de React en el padre.
 *
 * Colapsada por defecto (mismo criterio que el panel de coordenadas
 * avanzadas de `formulario-turno.tsx`): la carga manual sigue siendo el
 * camino principal, esto es una ayuda opcional.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  Los DOS caminos, y por qué son distintos (agosto 2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **UN turno (`relacion` "unico" o "turno_mas_confirmacion") — el camino de
 * siempre, intacto.** La propuesta precarga el formulario de abajo, la persona
 * la revisa y guarda con "Guardar turno". Es el caso común y no cambió nada.
 *
 * **VARIOS turnos (`relacion === "varios_turnos"`) — la lista de confirmación.**
 * El caso real que la motivó: un mensaje que asigna DIEZ sesiones de
 * kinesiología, cada una con su fecha y hora. El analizador devolvía las diez
 * propuestas desde el principio, pero la pantalla solo sabía volcar UNA en el
 * formulario y ofrecía "Cargar este turno" para ir pisándola de a una; como
 * "Guardar turno" termina en `redirect("/turnos")`, la pantalla -y con ella
 * las otras nueve propuestas- desaparecía apenas se guardaba la primera. Diez
 * sesiones entraban como UN turno, y las nueve restantes no existían para
 * ningún recordatorio.
 *
 * Ahora ese caso no toca el formulario: muestra las N propuestas como una
 * lista de casillas -todas marcadas, se desmarca la que sobre- y UN botón que
 * las crea todas juntas con `crearTurnosEnLote`
 * (`app/(app)/(con-nav)/turnos/actions.ts`).
 *
 * Que el formulario NO se precargue en este camino es deliberado: si además
 * quedara precargado con la sesión 1, tocar "Guardar turno" después de haber
 * creado el lote agregaría una undécima fila repetida. Con la lista, el único
 * botón que crea turnos en esta pantalla es el de la lista.
 *
 * ## Qué hace y qué no hace este componente
 *
 * - Dispara el análisis y muestra `VeloEspera` mientras está en curso.
 * - Muestra la "franja de revisión": qué encontró y qué faltó, con los
 *   avisos que ya vienen armados en `PropuestaTurno.avisos`
 *   (`lib/turnos/construir-propuestas.ts`) — nunca decide por sí mismo qué
 *   avisar, eso ya lo resolvió la capa pura. Lo mismo vale para CÓMO se
 *   describe la lista (qué datos son comunes a todas las sesiones y cuáles
 *   son propios de cada una): eso lo resuelve `describirLoteDePropuestas`
 *   (`lib/turnos/lote-propuestas.ts`), también puro y testeado aparte.
 * - En el camino de un turno NUNCA guarda nada: solo llama a
 *   `onAplicarPropuesta`. En el camino del lote, guardar es explícito y de un
 *   solo botón, con el reporte fila por fila que devuelve la Server Action
 *   -incluidos los turnos que ya existían, que se saltean en vez de
 *   duplicarse-.
 */

import * as React from "react"
import Link from "next/link"

import { CalendarPlusIcon, SparklesIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTextarea } from "@/components/base/campo-textarea"
import { VeloEspera } from "@/components/base/velo-espera"
import {
  crearTurnosEnLote,
  type ResultadoLoteTurnos,
  type ResultadoTurnoDelLote,
} from "@/app/(app)/(con-nav)/turnos/actions"
import {
  propuestaACamposPrecargables,
  type PropuestaTurno,
  type ResultadoAnalisisMensaje,
} from "@/lib/turnos/construir-propuestas"
import { formatearFechaConDiaTurno } from "@/lib/turnos/formato"
import { combinarFechaHoraUshuaia } from "@/lib/turnos/fecha"
import {
  describirLoteDePropuestas,
  frasesDelResultadoDelLote,
  tituloDelResultadoDelLote,
  type FilaDelLote,
} from "@/lib/turnos/lote-propuestas"

export interface AnalizadorMensajeTurnoProps {
  /** Se llama con la propuesta cuando el mensaje trae UN solo turno. En el camino de varios turnos no se llama: ese camino crea los turnos por su cuenta (ver el encabezado). */
  onAplicarPropuesta: (propuesta: PropuestaTurno) => void
  /**
   * Texto con el que arrancar el campo, en vez de vacío (Sprint 20). Lo usa el
   * ruteo desde un documento: la persona fotografió la captura de la agenda de
   * su clínica y `/turnos/nuevo?doc=…` le pasa acá la transcripción que ya hizo
   * el lector de documentos.
   *
   * Con texto inicial la sección arranca ABIERTA y se analiza sola apenas
   * monta: la persona ya tomó la decisión de venir acá desde el cartel de
   * ruteo, hacerle tocar "Analizar" de nuevo sería preguntarle dos veces lo
   * mismo. El resto del componente no cambia en nada — los mismos dos caminos,
   * los mismos avisos, el mismo lote.
   */
  textoInicial?: string
}

const MENSAJE_SIN_TEXTO = "Pegá el mensaje antes de analizarlo."
const MENSAJE_ERROR_RED =
  "No pudimos conectarnos para analizar el mensaje. Revisá tu conexión, o cargá el turno a mano."
const MENSAJE_ERROR_LOTE_RED =
  "No pudimos conectarnos para crear los turnos. Revisá tu conexión y probá de nuevo."
const MENSAJE_NINGUNO_MARCADO = "Marcá al menos un turno antes de confirmar."
const MAX_LARGO_MENSAJE = 8000

function extraerMensajeError(cuerpo: unknown): string {
  if (
    cuerpo &&
    typeof cuerpo === "object" &&
    "error" in cuerpo &&
    typeof (cuerpo as { error: unknown }).error === "string"
  ) {
    return (cuerpo as { error: string }).error
  }
  return MENSAJE_ERROR_RED
}

function extraerResultado(cuerpo: unknown): ResultadoAnalisisMensaje | null {
  if (cuerpo && typeof cuerpo === "object" && "resultado" in cuerpo) {
    return (cuerpo as { resultado: ResultadoAnalisisMensaje }).resultado
  }
  return null
}

/** "martes 25 de agosto de 2026 · 11:00", o lo que se pueda con lo que haya. */
function cuandoTexto(fila: FilaDelLote): string {
  if (fila.fecha.length === 0) return "Sin fecha — no lo podemos crear"

  const instante = combinarFechaHoraUshuaia(fila.fecha, fila.hora || "00:00")
  const fechaTexto = instante ? formatearFechaConDiaTurno(instante.toISOString()) : fila.fecha
  return fila.hora.length > 0 ? `${fechaTexto} · ${fila.hora}` : `${fechaTexto} — sin hora`
}

/** `/turnos` con el toast que corresponda: sin creados no hay nada que anunciar. */
function destinoVerMisTurnos(reporte: ResultadoLoteTurnos): string {
  return reporte.creados > 0 ? `/turnos?creados=${reporte.creados}` : "/turnos"
}

export function AnalizadorMensajeTurno({
  onAplicarPropuesta,
  textoInicial = "",
}: AnalizadorMensajeTurnoProps) {
  const [abierto, setAbierto] = React.useState(textoInicial.length > 0)
  const [mensaje, setMensaje] = React.useState(textoInicial)
  const [analizando, setAnalizando] = React.useState(false)
  const [errorAnalisis, setErrorAnalisis] = React.useState<string | null>(null)
  const [resultado, setResultado] = React.useState<ResultadoAnalisisMensaje | null>(null)

  // Estado exclusivo del camino de varios turnos.
  const [marcados, setMarcados] = React.useState<boolean[]>([])
  const [creando, setCreando] = React.useState(false)
  const [errorLote, setErrorLote] = React.useState<string | null>(null)
  const [reporte, setReporte] = React.useState<ResultadoLoteTurnos | null>(null)
  /**
   * Qué le pasó a CADA fila de la lista completa, indexado por su posición en
   * `propuestas`. Se arma en el momento del envío, no al renderizar: el
   * reporte de la Server Action viene indexado sobre las propuestas MARCADAS,
   * y si la persona desmarca algo después de ver el reporte, recalcular esa
   * traducción movería los carteles a las filas equivocadas.
   */
  const [estadoPorIndice, setEstadoPorIndice] = React.useState<Map<number, ResultadoTurnoDelLote>>(
    () => new Map(),
  )

  const esLote = resultado?.relacion === "varios_turnos" && resultado.otrasPropuestas.length > 0
  const propuestas = React.useMemo(
    () => (resultado ? [resultado.propuestaPrincipal, ...resultado.otrasPropuestas] : []),
    [resultado],
  )
  const { comunes, avisosComunes, filas } = React.useMemo(
    () => describirLoteDePropuestas(esLote ? propuestas : []),
    [esLote, propuestas],
  )
  const hayAlgoComun =
    Boolean(comunes.especialidad || comunes.medico || comunes.lugarNombre || comunes.lugarDireccion) ||
    avisosComunes.length > 0

  async function analizar() {
    if (mensaje.trim().length === 0) {
      setErrorAnalisis(MENSAJE_SIN_TEXTO)
      return
    }

    setAnalizando(true)
    setErrorAnalisis(null)
    setErrorLote(null)
    setReporte(null)
    setEstadoPorIndice(new Map())

    try {
      const respuesta = await fetch("/api/turnos/analizar-mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje }),
      })

      const cuerpo: unknown = await respuesta.json().catch(() => null)
      const resultadoRecibido = respuesta.ok ? extraerResultado(cuerpo) : null

      if (resultadoRecibido) {
        setResultado(resultadoRecibido)
        const cantidad = 1 + resultadoRecibido.otrasPropuestas.length
        setMarcados(Array.from({ length: cantidad }, () => true))
        // Solo el camino de UN turno toca el formulario de abajo — ver el
        // encabezado del archivo para por qué el lote no lo precarga.
        if (!(resultadoRecibido.relacion === "varios_turnos" && cantidad > 1)) {
          onAplicarPropuesta(resultadoRecibido.propuestaPrincipal)
        }
      } else {
        setResultado(null)
        setMarcados([])
        setErrorAnalisis(extraerMensajeError(cuerpo))
      }
    } catch {
      setResultado(null)
      setMarcados([])
      setErrorAnalisis(MENSAJE_ERROR_RED)
    } finally {
      setAnalizando(false)
    }
  }

  /**
   * Auto-análisis cuando el texto vino de afuera (Sprint 20, ruteo desde un
   * documento).
   *
   * Mismo patrón que `components/turnos/precarga-gmail.tsx`: un `useRef` de "ya
   * disparé" -no un `useState`, que provocaría un render de más- y el trabajo
   * en un `void` para que el efecto no quede esperando una promesa. `analizar`
   * viaja por ref porque se redeclara en cada render, y meterla en las
   * dependencias volvería a disparar el análisis con cada tecleo.
   *
   * Sin `textoInicial` esto no hace absolutamente nada: el camino de siempre
   * -pegar un WhatsApp a mano y tocar "Analizar"- queda intacto.
   */
  const analizarRef = React.useRef(analizar)
  React.useEffect(() => {
    analizarRef.current = analizar
  })
  const autoDisparado = React.useRef(false)

  React.useEffect(() => {
    if (textoInicial.trim().length === 0 || autoDisparado.current) return
    autoDisparado.current = true
    void analizarRef.current()
  }, [textoInicial])

  function alternarMarcado(indice: number) {
    setMarcados((previos) => previos.map((marcado, i) => (i === indice ? !marcado : marcado)))
  }

  const cantidadMarcados = marcados.filter(Boolean).length

  /**
   * Crea de una vez los turnos marcados. Reintentar después de un resultado
   * parcial es seguro: la Server Action saltea los que ya existen, así que un
   * segundo toque no puede duplicar los que sí entraron.
   */
  async function crearMarcados() {
    if (creando) return
    if (cantidadMarcados === 0) {
      setErrorLote(MENSAJE_NINGUNO_MARCADO)
      return
    }

    setCreando(true)
    setErrorLote(null)
    setReporte(null)

    // Índices de la lista completa que se están mandando, EN ORDEN: es la
    // tabla de traducción entre el reporte (indexado 0..n-1 sobre lo marcado)
    // y las filas que ve la persona.
    const indicesEnviados = marcados.flatMap((marcado, indice) => (marcado ? [indice] : []))

    try {
      const respuesta = await crearTurnosEnLote({
        turnos: indicesEnviados.map((indice) => propuestaACamposPrecargables(propuestas[indice])),
      })

      if (respuesta.error) {
        setErrorLote(respuesta.error)
        return
      }

      // Pase lo que pase, el lote TERMINA acá: `reporte` deja de ser un cartel
      // más debajo del formulario y pasa a ser la pantalla entera (ver
      // `ResumenDelLote`). Antes solo se navegaba a `/turnos` cuando todo salía
      // perfecto, y con un solo turno saltado -el caso normal- la persona
      // quedaba mirando la lista con el botón de crear todavía disponible. Eso
      // le costó un turno duplicado a una usuaria real: ver el bloque "CÓMO
      // TERMINA EL LOTE" en `lib/turnos/lote-propuestas.ts`.
      setReporte(respuesta)
      setEstadoPorIndice(
        new Map(
          respuesta.resultados.map(
            (fila) => [indicesEnviados[fila.indice] ?? fila.indice, fila] as const,
          ),
        ),
      )
    } catch {
      setErrorLote(MENSAJE_ERROR_LOTE_RED)
    } finally {
      setCreando(false)
    }
  }

  const avisosDelUnico = !esLote ? (resultado?.propuestaPrincipal.avisos ?? []) : []

  /** Vuelve al punto de partida, con el campo vacío: "cargar otro mensaje". */
  function empezarDeNuevo() {
    setMensaje("")
    setResultado(null)
    setMarcados([])
    setReporte(null)
    setEstadoPorIndice(new Map())
    setErrorAnalisis(null)
    setErrorLote(null)
  }

  // El lote terminó: la pantalla deja de ser un formulario y pasa a ser el
  // acuse de recibo. Ver el bloque "CÓMO TERMINA EL LOTE" de
  // `lib/turnos/lote-propuestas.ts` para el reporte de la usuaria que lo pidió
  // y el duplicado real que costó no tenerlo.
  if (reporte) {
    return (
      <ResumenDelLote
        reporte={reporte}
        filas={filas}
        estadoPorIndice={estadoPorIndice}
        onEmpezarDeNuevo={empezarDeNuevo}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4 chica:gap-2 chica:p-3">
      <Boton
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAbierto((valor) => !valor)}
        aria-expanded={abierto}
        className="w-fit"
      >
        <SparklesIcon className="size-4 shrink-0" aria-hidden="true" />
        {abierto
          ? "Ocultar"
          : textoInicial.trim().length > 0
            ? "Ver lo que leímos de la foto"
            : "¿Te llegó el turno por WhatsApp? Pegalo acá"}
      </Boton>

      {abierto && (
        <div className="flex flex-col gap-3">
          <CampoTextarea
            id="mensaje-turno-whatsapp"
            label="Mensaje de la clínica"
            rows={6}
            maxLength={MAX_LARGO_MENSAJE}
            value={mensaje}
            onChange={(evento) => setMensaje(evento.target.value)}
            placeholder="Pegá acá el mensaje tal como te llegó (ej: «Clinica San Jorge: Se asigna turno para ecografía vesical...»)"
            ayuda="Se lo mandamos a una inteligencia artificial (Gemini) solo para leerlo — no se guarda. Si trae nombre o DNI del paciente, se ignoran: no se cargan en ningún campo. Si el mensaje trae varias sesiones, las vas a poder crear todas juntas."
          />

          <Boton type="button" onClick={() => void analizar()} cargando={analizando} className="w-fit">
            <SparklesIcon aria-hidden="true" />
            Analizar
          </Boton>

          {errorAnalisis && <Alerta variante="error">{errorAnalisis}</Alerta>}

          {resultado && !esLote && (
            <div className="flex flex-col gap-3">
              {resultado.relacion === "turno_mas_confirmacion" && (
                <Alerta variante="info" titulo="El mensaje traía una confirmación — fusionamos los datos">
                  {resultado.explicacion}
                </Alerta>
              )}

              {resultado.contradiccion && (
                <Alerta variante="advertencia" titulo="Hay una contradicción entre los dos mensajes">
                  {resultado.contradiccion}
                </Alerta>
              )}

              <Alerta
                variante={avisosDelUnico.length > 0 ? "advertencia" : "exito"}
                titulo="Esto entendimos del mensaje"
              >
                {avisosDelUnico.length > 0 ? (
                  <ul className="list-disc pl-5">
                    {avisosDelUnico.map((aviso, indice) => (
                      <li key={indice}>{aviso}</li>
                    ))}
                  </ul>
                ) : (
                  <p>El formulario de abajo quedó precargado. Revisalo y guardá cuando esté correcto.</p>
                )}
              </Alerta>
            </div>
          )}

          {resultado && esLote && (
            <div className="flex flex-col gap-3">
              <Alerta variante="info" titulo={`Encontramos ${filas.length} turnos en el mensaje`}>
                {resultado.explicacion}
              </Alerta>

              <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <legend className="px-1 text-base font-medium text-foreground chica:text-sm">
                  Elegí cuáles crear
                </legend>

                {hayAlgoComun && (
                  <dl className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2 text-sm chica:text-xs">
                    <p className="font-medium text-foreground">Todos comparten:</p>
                    {comunes.especialidad && (
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Especialidad:</dt>
                        <dd className="text-foreground">{comunes.especialidad}</dd>
                      </div>
                    )}
                    {comunes.medico && (
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Profesional:</dt>
                        <dd className="text-foreground">{comunes.medico}</dd>
                      </div>
                    )}
                    {comunes.lugarNombre && (
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Lugar:</dt>
                        <dd className="text-foreground">{comunes.lugarNombre}</dd>
                      </div>
                    )}
                    {comunes.lugarDireccion && (
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Dirección:</dt>
                        <dd className="text-foreground">{comunes.lugarDireccion}</dd>
                      </div>
                    )}

                    {/* Los avisos que valen para TODAS las sesiones, una sola
                        vez (Sprint 20). Antes se repetían debajo de cada una de
                        las diez filas -verificado en producción-, enterrando
                        las diez fechas, que es lo único que hay que revisar de
                        un vistazo. La separación la hace
                        `describirLoteDePropuestas`, que es pura y está
                        probada; acá solo se pinta donde corresponde. */}
                    {avisosComunes.map((aviso) => (
                      <p key={aviso} className="text-advertencia-fuerte">
                        {aviso}
                      </p>
                    ))}
                  </dl>
                )}

                <ul className="flex flex-col gap-2">
                  {filas.map((fila) => {
                    const estado = estadoPorIndice.get(fila.indice)
                    return (
                      <li key={fila.indice}>
                        <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted chica:gap-2">
                          <input
                            type="checkbox"
                            checked={marcados[fila.indice] ?? false}
                            onChange={() => alternarMarcado(fila.indice)}
                            disabled={creando || estado?.estado === "creado"}
                            className="mt-1 size-6 shrink-0 cursor-pointer accent-primary chica:size-5"
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-base font-medium text-foreground chica:text-sm">
                              {fila.titulo}
                            </span>
                            <span className="text-base text-foreground chica:text-sm">
                              {cuandoTexto(fila)}
                            </span>
                            {fila.propios.map((dato) => (
                              <span key={dato.etiqueta} className="text-sm text-muted-foreground chica:text-xs">
                                {dato.etiqueta}: {dato.valor}
                              </span>
                            ))}
                            {fila.avisos.map((aviso, indice) => (
                              <span key={indice} className="text-sm text-advertencia-fuerte chica:text-xs">
                                {aviso}
                              </span>
                            ))}
                            {estado?.estado === "creado" && (
                              <span className="text-sm font-medium text-exito-fuerte chica:text-xs">
                                Creado
                              </span>
                            )}
                            {estado?.estado === "duplicado" && (
                              <span className="text-sm font-medium text-muted-foreground chica:text-xs">
                                Ya estaba cargado — no lo repetimos
                              </span>
                            )}
                            {estado?.estado === "error" && (
                              <span className="text-sm font-medium text-destructive chica:text-xs">
                                No se pudo crear: {estado.error}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>

              {errorLote && <Alerta variante="error">{errorLote}</Alerta>}

              <Boton
                type="button"
                onClick={() => void crearMarcados()}
                cargando={creando}
                disabled={cantidadMarcados === 0}
                className="w-fit"
              >
                <CalendarPlusIcon aria-hidden="true" />
                {cantidadMarcados === 1 ? "Crear 1 turno" : `Crear los ${cantidadMarcados} turnos`}
              </Boton>
            </div>
          )}
        </div>
      )}

      <VeloEspera
        visible={analizando}
        mensaje="La inteligencia artificial está leyendo el mensaje…"
        submensaje="Esto puede tardar unos segundos."
      />
      <VeloEspera
        visible={creando}
        mensaje="Creando los turnos…"
        submensaje="No cierres la pantalla, tarda unos segundos."
      />
    </div>
  )
}

/**
 * El final del lote: qué pasó con cada sesión y adónde ir ahora.
 *
 * REEMPLAZA al formulario en vez de agregarse debajo, y ése es todo el punto.
 * El reporte antes convivía con la lista de casillas y con el botón "Crear los
 * N turnos", así que la pantalla seguía pareciendo un formulario a medio
 * llenar; una usuaria real volvió a intentar y se quedó con un turno duplicado.
 * Acá no queda ningún control que pueda volver a escribir en la agenda: solo
 * "Ver mis turnos" y "Cargar otro mensaje", que arranca de cero.
 *
 * El detalle fila por fila se conserva entero -y con los mismos textos- porque
 * es lo que la misma usuaria celebró: *"los turnos que ya pasaron me los
 * corrigió y me dijo: no te los pongo porque ya pasaron"*. Lo único que cambia
 * es que ahora las casillas son estáticas: la decisión ya se tomó.
 */
function ResumenDelLote({
  reporte,
  filas,
  estadoPorIndice,
  onEmpezarDeNuevo,
}: {
  reporte: ResultadoLoteTurnos
  filas: readonly FilaDelLote[]
  estadoPorIndice: Map<number, ResultadoTurnoDelLote>
  onEmpezarDeNuevo: () => void
}) {
  const conteo = {
    creados: reporte.creados,
    duplicados: reporte.duplicados,
    fallidos: reporte.fallidos,
  }

  // Solo las filas que efectivamente se mandaron tienen algo que contar: las
  // desmarcadas no se intentaron y listarlas acá haría parecer que fallaron.
  const filasConDesenlace = filas.filter((fila) => estadoPorIndice.has(fila.indice))

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4 chica:gap-2 chica:p-3">
      <Alerta
        variante={reporte.creados > 0 && reporte.fallidos === 0 ? "exito" : "advertencia"}
        titulo={tituloDelResultadoDelLote(conteo)}
      >
        {frasesDelResultadoDelLote(conteo).join(" ")}
      </Alerta>

      {filasConDesenlace.length > 0 && (
        <ul className="flex flex-col gap-2">
          {filasConDesenlace.map((fila) => {
            const estado = estadoPorIndice.get(fila.indice)
            return (
              <li key={fila.indice} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0 last:pb-0">
                <span className="text-base font-medium text-foreground chica:text-sm">
                  {fila.titulo}
                </span>
                <span className="text-base text-foreground chica:text-sm">{cuandoTexto(fila)}</span>
                {estado?.estado === "creado" && (
                  <span className="text-sm font-medium text-exito-fuerte chica:text-xs">
                    Creado
                  </span>
                )}
                {estado?.estado === "duplicado" && (
                  <span className="text-sm font-medium text-muted-foreground chica:text-xs">
                    Ya estaba cargado — no lo repetimos
                  </span>
                )}
                {estado?.estado === "error" && (
                  <span className="text-sm font-medium text-destructive chica:text-xs">
                    No lo cargamos: {estado.error}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Boton
          render={<Link href={destinoVerMisTurnos(reporte)} />}
          nativeButton={false}
          size="lg"
          className="sm:flex-1"
        >
          <CalendarPlusIcon aria-hidden="true" />
          Ver mis turnos
        </Boton>
        <Boton type="button" variant="outline" size="lg" className="sm:flex-1" onClick={onEmpezarDeNuevo}>
          <SparklesIcon aria-hidden="true" />
          Cargar otro mensaje
        </Boton>
      </div>
    </div>
  )
}
