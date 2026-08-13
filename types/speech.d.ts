/**
 * Tipos de la Web Speech API (reconocimiento de voz) que faltan en
 * `lib.dom.d.ts`.
 *
 * TypeScript 5.9 ya declara `SpeechRecognitionAlternative`,
 * `SpeechRecognitionResult` y `SpeechRecognitionResultList` (ver
 * `node_modules/typescript/lib/lib.dom.d.ts`), pero NO declara la interfaz
 * `SpeechRecognition` en sí, sus eventos (`SpeechRecognitionEvent`,
 * `SpeechRecognitionErrorEvent`) ni las propiedades `SpeechRecognition` /
 * `webkitSpeechRecognition` de `Window` -el prefijo `webkit` sigue siendo
 * necesario en Chrome/Edge/Safari en 2026-. Este archivo completa
 * EXACTAMENTE lo que falta. Ojo si se actualiza TypeScript: si una futura
 * versión agrega alguna de estas declaraciones, hay que borrar el
 * duplicado de acá (da error "Duplicate identifier").
 *
 * Sin `import`/`export`: es un script ambiental global a propósito, así
 * `interface Window` se fusiona con la global sin necesitar `declare global`.
 */

type SpeechRecognitionErrorCode =
  | "no-speech"
  | "aborted"
  | "audio-capture"
  | "network"
  | "not-allowed"
  | "service-not-allowed"
  | "bad-grammar"
  | "language-not-supported"

interface SpeechRecognitionEventMap {
  audiostart: Event
  audioend: Event
  end: Event
  error: SpeechRecognitionErrorEvent
  nomatch: SpeechRecognitionEvent
  result: SpeechRecognitionEvent
  soundstart: Event
  soundend: Event
  speechstart: Event
  speechend: Event
  start: Event
}

interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number

  onaudiostart: ((this: SpeechRecognition, ev: Event) => void) | null
  onaudioend: ((this: SpeechRecognition, ev: Event) => void) | null
  onend: ((this: SpeechRecognition, ev: Event) => void) | null
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
  onnomatch: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
  onsoundstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onsoundend: ((this: SpeechRecognition, ev: Event) => void) | null
  onspeechstart: ((this: SpeechRecognition, ev: Event) => void) | null
  onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null
  onstart: ((this: SpeechRecognition, ev: Event) => void) | null

  abort(): void
  start(): void
  stop(): void

  addEventListener<K extends keyof SpeechRecognitionEventMap>(
    type: K,
    listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener<K extends keyof SpeechRecognitionEventMap>(
    type: K,
    listener: (this: SpeechRecognition, ev: SpeechRecognitionEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void
}

declare const SpeechRecognition: {
  prototype: SpeechRecognition
  new (): SpeechRecognition
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

declare const SpeechRecognitionEvent: {
  prototype: SpeechRecognitionEvent
  new (
    type: string,
    eventInitDict?: { resultIndex?: number; results?: SpeechRecognitionResultList },
  ): SpeechRecognitionEvent
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode
  readonly message: string
}

declare const SpeechRecognitionErrorEvent: {
  prototype: SpeechRecognitionErrorEvent
  new (
    type: string,
    eventInitDict?: { error?: SpeechRecognitionErrorCode; message?: string },
  ): SpeechRecognitionErrorEvent
}

interface Window {
  SpeechRecognition?: typeof SpeechRecognition
  webkitSpeechRecognition?: typeof SpeechRecognition
}
