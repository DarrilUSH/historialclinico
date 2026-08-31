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
 *
 * ## La lista no puede ofrecer lo que ella misma declara imposible
 *
 * Bug reportado con captura (agosto 2026): con un mensaje cuyas diez fechas no
 * se pudieron interpretar, las diez filas decían "Sin fecha — no lo podemos
 * crear" y las diez estaban TILDADAS, debajo de un botón que ofrecía "Crear
 * los 10 turnos". La pantalla prometía diez turnos que ya sabía que iban a
 * fallar.
 *
 * Ahora la casilla de una fila no creable está desmarcada y deshabilitada, el
 * botón cuenta SOLO lo creable y marcado (`indicesAEnviar`), y cuando no queda
 * nada que crear el botón se apaga con un texto que dice qué falta. El
 * veredicto de "creable" no se decide acá: lo calcula `motivoNoCreable`
 * (`lib/turnos/lote-propuestas.ts`), que espeja los requisitos reales de
 * `crearTurnosEnLote` y está probado aparte, como todo lo demás que esta
 * pantalla solo pinta.
 *
 * ## El único dato que se completa acá: la especialidad de la serie
 *
 * Medido con el mensaje real contra Gemini, tres corridas seguidas: el texto
 * del kinesiólogo dice "todas las sesiones pendientes de su tratamiento" y
 * nunca nombra la práctica, así que la especialidad sale vacía -y sale bien
 * vacía: no está escrita en ninguna parte, inventarla sería peor-. Pero sin
 * especialidad no se puede guardar NINGÚN turno (`lib/validacion/turno.schema.ts`),
 * o sea que la coherencia recién arreglada terminaba, en el caso real que la
 * motivó, en diez filas bloqueadas y un botón apagado.
 *
 * Por eso -y solo por eso- esta pantalla gana UN campo: la especialidad, que
 * es un dato COMÚN a toda la serie y se completa una vez para las diez. Es el
 * mismo `CampoAutocompletar` con el mismo catálogo que el formulario de abajo,
 * aparece únicamente cuando alguna propuesta llegó sin especialidad, y solo
 * RELLENA huecos: nunca pisa la especialidad que el mensaje sí traía. La fecha
 * y la hora no se editan acá a propósito -son propias de cada cita, no del
 * lote, y una lista de diez mini-formularios sería otra pantalla-.
 */

import * as React from "react"
import Link from "next/link"

import { CalendarPlusIcon, SparklesIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoAutocompletar } from "@/components/base/campo-autocompletar"
import { CampoTextarea } from "@/components/base/campo-textarea"
import { VeloEspera } from "@/components/base/velo-espera"
import { CATALOGO_ESPECIALIDADES } from "@/lib/especialidades/catalogo"
import {
  crearTurnosEnLote,
  type ResultadoLoteTurnos,
  type ResultadoTurnoDelLote,
} from "@/app/(app)/(con-nav)/turnos/actions"
import {
  AVISO_SIN_ESPECIALIDAD,
  propuestaACamposPrecargables,
  type PropuestaTurno,
  type ResultadoAnalisisMensaje,
} from "@/lib/turnos/construir-propuestas"
import { formatearFechaConDiaTurno } from "@/lib/turnos/formato"
import { combinarFechaHoraUshuaia } from "@/lib/turnos/fecha"
import {
  describirLoteDePropuestas,
  faltaParaCrearElLote,
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

/**
 * "martes 25 de agosto de 2026 · 11:00", o lo que se pueda con lo que haya.
 *
 * Solo dice CUÁNDO. La consecuencia de que falte un dato -que el turno no se
 * pueda crear- la dice `FilaDelLote.motivo`, en su propio renglón: mezclar las
 * dos cosas en esta línea era lo que producía el "Sin fecha — no lo podemos
 * crear" debajo de una casilla tildada.
 */
function cuandoTexto(fila: FilaDelLote): string {
  if (fila.fecha.length === 0) return "Sin fecha"

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
  /**
   * La especialidad que la persona completa para TODA la serie cuando el
   * mensaje no la dice (ver "El único dato que se completa acá" en el
   * encabezado). Solo rellena las propuestas que la tienen vacía.
   */
  const [especialidadDelLote, setEspecialidadDelLote] = React.useState("")
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
  const propuestasCrudas = React.useMemo(
    () => (resultado ? [resultado.propuestaPrincipal, ...resultado.otrasPropuestas] : []),
    [resultado],
  )

  /** `true` si al menos una propuesta llegó sin especialidad: el mensaje no la decía y nadie la puede adivinar. */
  const faltaEspecialidad = propuestasCrudas.some((propuesta) => propuesta.especialidad.trim().length === 0)

  /**
   * Las propuestas tal como se van a crear: con la especialidad que completó
   * la persona puesta en las que no traían ninguna. Nunca pisa una que el
   * mensaje sí traía — el criterio de "solo rellena huecos" es el mismo que
   * usa `heredarDatosComunes` para el resto de los datos del encabezado.
   */
  const propuestas = React.useMemo(() => {
    const completada = especialidadDelLote.trim()
    if (completada.length === 0) return propuestasCrudas
    return propuestasCrudas.map((propuesta) =>
      propuesta.especialidad.trim().length > 0
        ? propuesta
        : {
            ...propuesta,
            especialidad: completada,
            // El aviso de "no pudimos identificar la especialidad" deja de ser
            // cierto en cuanto la persona la escribe: dejarlo puesto sería
            // señalar como problema justo lo que se acaba de resolver.
            avisos: propuesta.avisos.filter((aviso) => aviso !== AVISO_SIN_ESPECIALIDAD),
          },
    )
  }, [propuestasCrudas, especialidadDelLote])
  // El "ahora" contra el que se decide si una cita ya pasó se fija al armar la
  // lista, no en cada render: así la pantalla no se le mueve debajo del dedo a
  // la persona mientras la lee. Lo que pase después de tocar el botón lo
  // resuelve la Server Action, que valida con su propio reloj.
  const { comunes, avisosComunes, filas } = React.useMemo(
    () => describirLoteDePropuestas(esLote ? propuestas : [], new Date()),
    [esLote, propuestas],
  )
  const hayAlgoComun =
    Boolean(comunes.especialidad || comunes.medico || comunes.lugarNombre || comunes.lugarDireccion) ||
    avisosComunes.length > 0

  /**
   * Los índices que se van a mandar: marcados Y creables. La intersección se
   * hace acá, no al marcar, para que la cuenta del botón nunca pueda incluir
   * una fila que la lista está mostrando como imposible.
   */
  const indicesAEnviar = React.useMemo(
    () => filas.filter((fila) => fila.creable && (marcados[fila.indice] ?? false)).map((fila) => fila.indice),
    [filas, marcados],
  )
  const cantidadMarcados = indicesAEnviar.length
  const faltaParaCrear = faltaParaCrearElLote(filas)

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
        setEspecialidadDelLote("")
        const cantidad = 1 + resultadoRecibido.otrasPropuestas.length
        // `marcados` guarda la ELECCIÓN de la persona, que arranca en "todos".
        // Que una fila sea creable o no es otra cosa, se recalcula en cada
        // render y se cruza con esto en `indicesAEnviar`: así una fila que
        // pasa a ser creable -porque se completó la especialidad de la serie-
        // no queda desmarcada por una decisión tomada antes de que existiera.
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
    // tabla de traducción entre el reporte (indexado 0..n-1 sobre lo enviado)
    // y las filas que ve la persona.
    const indicesEnviados = indicesAEnviar

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
    setEspecialidadDelLote("")
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

                {/* El mensaje no decía de qué son las sesiones, y sin
                    especialidad no se puede guardar ningún turno. Es un dato
                    COMÚN a toda la serie, así que se pide una sola vez acá en
                    vez de mandar a cargar diez turnos a mano — ver "El único
                    dato que se completa acá" en el encabezado. */}
                {faltaEspecialidad && (
                  <CampoAutocompletar
                    id="especialidad-del-lote"
                    label="¿De qué son estas sesiones?"
                    required
                    maxLength={100}
                    value={especialidadDelLote}
                    onChange={setEspecialidadDelLote}
                    opciones={CATALOGO_ESPECIALIDADES}
                    ayuda="El mensaje no lo decía. Escribilo una vez y vale para todas las sesiones de la lista (ej: Kinesiología, Fonoaudiología)."
                  />
                )}

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
                        <label
                          className={
                            fila.creable
                              ? "flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted chica:gap-2"
                              : "flex items-start gap-3 rounded-md p-2 chica:gap-2"
                          }
                        >
                          {/* Una fila que no se puede crear queda desmarcada y
                              sin poder marcarse: el motivo está justo debajo.
                              Antes se podía tildar igual y el botón la contaba,
                              prometiendo lo que la propia fila declaraba
                              imposible. */}
                          <input
                            type="checkbox"
                            checked={fila.creable && (marcados[fila.indice] ?? false)}
                            onChange={() => alternarMarcado(fila.indice)}
                            disabled={creando || !fila.creable || estado?.estado === "creado"}
                            className={
                              fila.creable
                                ? "mt-1 size-6 shrink-0 cursor-pointer accent-primary chica:size-5"
                                : "mt-1 size-6 shrink-0 accent-primary chica:size-5"
                            }
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-base font-medium text-foreground chica:text-sm">
                              {fila.titulo}
                            </span>
                            <span className="text-base text-foreground chica:text-sm">
                              {cuandoTexto(fila)}
                            </span>
                            {!fila.creable && (
                              <span className="text-sm font-medium text-advertencia-fuerte chica:text-xs">
                                {fila.motivo}
                              </span>
                            )}
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

              {/* Sin ninguna fila creable el botón queda apagado, y esto dice
                  qué falta y qué se puede hacer igual: un botón deshabilitado
                  y mudo se lee como que la app se rompió. */}
              {faltaParaCrear.length > 0 && (
                <Alerta variante="advertencia" titulo="No podemos crear estos turnos todavía">
                  {faltaParaCrear}
                </Alerta>
              )}

              {/* Quedan turnos creables pero la persona los desmarcó todos:
                  no es un problema de la app, así que no es una alerta. */}
              {cantidadMarcados === 0 && faltaParaCrear.length === 0 && (
                <p className="text-sm text-muted-foreground chica:text-xs">{MENSAJE_NINGUNO_MARCADO}</p>
              )}

              <Boton
                type="button"
                onClick={() => void crearMarcados()}
                cargando={creando}
                disabled={cantidadMarcados === 0}
                className="w-fit"
              >
                <CalendarPlusIcon aria-hidden="true" />
                {cantidadMarcados === 0
                  ? "Crear los turnos"
                  : cantidadMarcados === 1
                    ? "Crear 1 turno"
                    : `Crear los ${cantidadMarcados} turnos`}
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
