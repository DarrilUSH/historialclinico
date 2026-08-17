"use client"

/**
 * Hook client-side sobre la Web Speech API (`SpeechRecognition` /
 * `webkitSpeechRecognition`) para dictado por voz en `es-AR`.
 *
 * Decisiones deliberadas (Sprint 3, Senior UX):
 * - `continuous: false`: una frase por gesto. La persona toca el micrófono,
 *   dice una frase y listo -nada de "modo conversación" abierto, que es más
 *   difícil de controlar para alguien que no está familiarizado con esta
 *   clase de interacción-. Para dictar más, vuelve a tocar el botón.
 * - `interimResults: true`: feedback en vivo mientras habla, para que la
 *   persona vea que el micrófono la está escuchando (confianza), aunque solo
 *   el resultado `isFinal` dispara la inserción real de texto.
 * - `lang: "es-AR"`: español rioplatense.
 * - El objeto `SpeechRecognition` se crea recién dentro de `iniciar()`, que
 *   solo se llama por gesto del usuario (clic del botón). Nunca se
 *   instancia ni se llama `.start()` al montar: eso es lo que dispara el
 *   pedido de permiso de micrófono en el navegador, y ese pedido tiene que
 *   ser siempre una consecuencia directa de un clic.
 */

import * as React from "react"

export type EstadoReconocimientoVoz = "inactivo" | "escuchando" | "procesando" | "error"

/** Mensajes en español, sin jerga técnica, para cada código de error de la API. */
const MENSAJES_ERROR: Partial<Record<SpeechRecognitionErrorCode, string>> = {
  "not-allowed":
    "No se puede dictar sin permiso de micrófono. Habilitalo en la configuración del navegador y volvé a intentar.",
  "service-not-allowed":
    "No se puede dictar sin permiso de micrófono. Habilitalo en la configuración del navegador y volvé a intentar.",
  "no-speech": "No se escuchó ninguna voz. Acercate al micrófono y probá de nuevo.",
  network: "No hay conexión para reconocer la voz. Revisá tu internet y probá de nuevo.",
  aborted: "El dictado se interrumpió. Tocá el micrófono para intentar de nuevo.",
  "audio-capture": "No se encontró un micrófono disponible en este dispositivo.",
}
const MENSAJE_ERROR_DEFAULT = "No se pudo usar el micrófono. Probá de nuevo o escribí el texto."

function obtenerConstructor(): typeof SpeechRecognition | undefined {
  if (typeof window === "undefined") return undefined
  return window.SpeechRecognition ?? window.webkitSpeechRecognition
}

export interface UseReconocimientoVozResultado {
  /** `false` si el navegador no expone `SpeechRecognition`/`webkitSpeechRecognition`. */
  soportado: boolean
  estado: EstadoReconocimientoVoz
  /** Última transcripción reconocida (parcial mientras escucha, final al terminar). */
  transcripcion: string
  /** Mensaje de error en español, o `null` si no hay error activo. */
  error: string | null
  /** Pide permiso (si hace falta) y arranca a escuchar. Llamar SOLO desde un gesto del usuario. */
  iniciar: () => void
  /** Corta la escucha manualmente antes de que termine la frase. */
  detener: () => void
}

export function useReconocimientoVoz(): UseReconocimientoVozResultado {
  // Sprint 14 (tanda A): ANTES esto era `React.useState(() =>
  // Boolean(obtenerConstructor()))`, un lazy initializer que igual corre en
  // cada render inicial -también el PRIMER render del cliente, antes de
  // hidratar-. `obtenerConstructor()` mira `typeof window`, así que en SSR
  // daba `false` (sin `window`) y en el primer render del cliente daba `true`
  // en cualquier navegador con la API -Chrome Android, el del Galaxy real-:
  // el árbol que manda React en el HTML difería del que el cliente calculaba
  // apenas hidrataba, así que React lo descartaba y reconstruía
  // `BotonDictado` (que devuelve `null` cuando `!soportado`) en cada pantalla
  // que usa `campo-texto.tsx` -el error de hydration mismatch en consola,
  // reproducible en `/estudios` por su buscador con dictado-.
  //
  // El arreglo: arrancar SIEMPRE en `false` (server y primer render del
  // cliente coinciden, cero mismatch) y recién detectar soporte real en un
  // `useEffect` -que por definición solo corre en el cliente, después de
  // hidratar-. El botón aparece un instante después del pintado inicial en
  // vez de estar-o-no desde el primer render, pero eso es invisible en la
  // práctica (mismo patrón que `activar-notificaciones.tsx`) y el dictado en
  // sí no cambia: `iniciar()` sigue sin llamarse hasta el `onClick`.
  const [soportado, setSoportado] = React.useState(false)
  const [estado, setEstado] = React.useState<EstadoReconocimientoVoz>("inactivo")
  const [transcripcion, setTranscripcion] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const reconocimientoRef = React.useRef<SpeechRecognition | null>(null)

  // Corre una sola vez, después de hidratar: recién ahí es seguro mirar
  // `window` sin arriesgar un mismatch contra el HTML que mandó el servidor.
  // La función interna (mismo patrón que `activar-notificaciones.tsx#comprobar`)
  // es lo que evita que `react-hooks/set-state-in-effect` marque el
  // `setSoportado` como un `setState` síncrono directo del cuerpo del efecto.
  React.useEffect(() => {
    function comprobarSoporte() {
      setSoportado(Boolean(obtenerConstructor()))
    }
    comprobarSoporte()
  }, [])

  const detener = React.useCallback(() => {
    reconocimientoRef.current?.stop()
  }, [])

  const iniciar = React.useCallback(() => {
    const ConstructorReconocimiento = obtenerConstructor()
    if (!ConstructorReconocimiento) {
      return
    }

    // Si había una instancia previa colgada (doble clic rápido), la cortamos.
    reconocimientoRef.current?.abort()

    setError(null)
    setTranscripcion("")

    const reconocimiento = new ConstructorReconocimiento()
    reconocimiento.lang = "es-AR"
    reconocimiento.interimResults = true
    reconocimiento.continuous = false
    reconocimiento.maxAlternatives = 1

    // El estado pasa a "escuchando" recién cuando el navegador confirma que
    // el micrófono arrancó -no antes-, así un permiso denegado va directo
    // de "inactivo" a "error" sin parpadear "escuchando" primero.
    reconocimiento.onstart = () => {
      setEstado("escuchando")
    }

    reconocimiento.onresult = (evento: SpeechRecognitionEvent) => {
      let textoFinal = ""
      let textoParcial = ""

      for (let i = evento.resultIndex; i < evento.results.length; i++) {
        const resultado = evento.results[i]
        const texto = resultado[0]?.transcript ?? ""
        if (resultado.isFinal) {
          textoFinal += texto
        } else {
          textoParcial += texto
        }
      }

      if (textoFinal) {
        // Frase reconocida: se apaga el micrófono lógicamente (queda
        // esperando el `onend` del navegador) mientras se termina de
        // procesar el resultado.
        setEstado("procesando")
        setTranscripcion(textoFinal.trim())
      } else if (textoParcial) {
        setTranscripcion(textoParcial)
      }
    }

    // Señal temprana de que la persona dejó de hablar: todavía no hay
    // resultado final, pero ya no tiene sentido seguir mostrando "escuchando".
    reconocimiento.onspeechend = () => {
      setEstado((estadoActual) => (estadoActual === "escuchando" ? "procesando" : estadoActual))
    }

    reconocimiento.onerror = (evento: SpeechRecognitionErrorEvent) => {
      setEstado("error")
      setError(MENSAJES_ERROR[evento.error] ?? MENSAJE_ERROR_DEFAULT)
    }

    reconocimiento.onend = () => {
      reconocimientoRef.current = null
      // Si terminó en error, el mensaje de error se queda visible: no lo
      // pisa la vuelta a "inactivo".
      setEstado((estadoActual) => (estadoActual === "error" ? "error" : "inactivo"))
    }

    reconocimientoRef.current = reconocimiento
    reconocimiento.start()
  }, [])

  // Si el componente se desmonta mientras escucha (navegación, etc.), corta
  // el reconocimiento en vez de dejarlo vivo de fondo.
  React.useEffect(() => {
    return () => {
      reconocimientoRef.current?.abort()
    }
  }, [])

  return { soportado, estado, transcripcion, error, iniciar, detener }
}
