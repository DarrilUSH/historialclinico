"use client"

/**
 * Campo de texto Senior UX: envuelve `components/ui/input.tsx` (que ya trae
 * 18px y alto táctil) con las reglas de formularios de
 * `docs/design-system.md` §8: etiqueta SIEMPRE visible arriba (nunca el
 * placeholder como etiqueta), ayuda opcional debajo, error asociado por
 * `aria-describedby` + `aria-invalid`, e ícono/sufijo opcionales.
 *
 * `campo-numero.tsx` se construye ENCIMA de este componente (mismo layout,
 * agrega `inputMode`/`pattern`), así que los dos comparten exactamente la
 * misma estructura visual y de accesibilidad.
 *
 * `conDictado` agrega `boton-dictado.tsx` a la derecha del campo (Sprint 3).
 * Deliberadamente NO existe en `campo-numero.tsx`: ver el comentario de la
 * prop más abajo para el porqué.
 *
 * ## El ojito de `type="password"` (hotfix UX, 2026-08-14)
 *
 * Se implementó como una CAPACIDAD de este componente, no como un
 * `CampoContrasena` aparte: `type === "password"` alcanza para activarlo,
 * sin ninguna prop nueva. Es la opción de menor superficie -los cinco campos
 * de contraseña de la app (login, registro ×2, recuperar/confirmar ×2) ya
 * pasan por acá vía `type: "password"` en `formulario-auth.tsx`, así que
 * cualquier pantalla futura que declare un campo de contraseña lo recibe
 * gratis, sin acordarse de envolver nada-. El campo alterna su propio
 * `type` entre `"password"` y `"text"` con un estado interno (`mostrarClave`):
 * el padre nunca se entera, porque no cambia el valor, solo cómo se ve.
 */

import * as React from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { BotonDictado } from "@/components/base/boton-dictado"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface CampoTextoProps
  extends Omit<React.ComponentProps<typeof Input>, "id"> {
  /** `id` del input, `htmlFor` del label y, si no se pasa `name`, también el `name`. */
  id: string
  /** Etiqueta SIEMPRE visible arriba del campo. Nunca se reemplaza por el placeholder. */
  label: string
  /** Texto de ayuda opcional debajo del campo. Se oculta mientras hay error. */
  ayuda?: string
  /** Mensaje de error propio de este campo: lo asocia con `aria-describedby` y marca `aria-invalid`. */
  error?: string
  /**
   * Marca el campo como inválido sin mostrar un mensaje propio -por ejemplo
   * cuando el error es compartido por todo el formulario y se muestra una
   * sola vez con `<Alerta>` (ver `components/auth/formulario-auth.tsx`)-. Si
   * se pasa `error`, este flag es redundante: `error` ya implica inválido.
   */
  invalido?: boolean
  /** ids extra para `aria-describedby` (por ejemplo el id de una `<Alerta>` compartida). */
  describedBy?: string
  /** Ícono opcional a la izquierda del campo. */
  icono?: React.ReactNode
  /** Unidad clínica opcional a la derecha del campo (mg/dl, kg, latidos/min, etc.). */
  sufijo?: string
  /** Clases para el contenedor (label + input + ayuda/error), no para el input. */
  contenedorClassName?: string
  /**
   * Agrega el botón de dictado por voz (`boton-dictado.tsx`) a la derecha
   * del campo, en `es-AR`. Si el navegador no soporta la Web Speech API el
   * botón simplemente no se renderiza y el campo sigue siendo 100%
   * escribible: nunca es un requisito.
   *
   * Deliberadamente NO se hereda en `campo-numero.tsx`. Un número dictado es
   * ambiguo de una forma que un texto libre no lo es: "dieciséis" puede
   * transcribirse "16" o "116", una coma decimal hablada rara vez se
   * reconoce como tal, y en esta app un número mal transcripto no es un
   * error de UX menor -es una dosis de medicación o una presión arterial
   * mal cargada-. El riesgo supera la ganancia, así que los campos
   * numéricos se siguen escribiendo a mano.
   */
  conDictado?: boolean
}

export function CampoTexto({
  id,
  label,
  ayuda,
  error,
  invalido = false,
  describedBy,
  icono,
  sufijo,
  conDictado = false,
  className,
  contenedorClassName,
  name,
  required,
  type = "text",
  ...props
}: CampoTextoProps) {
  const idAyuda = ayuda && !error ? `${id}-ayuda` : undefined
  const idError = error ? `${id}-error` : undefined
  const describedByFinal =
    [idAyuda, idError, describedBy].filter(Boolean).join(" ") || undefined

  const inputRef = React.useRef<HTMLInputElement | null>(null)

  // Ojito de mostrar/ocultar contraseña: arranca siempre oculta (nunca
  // "recordar" el último estado entre montajes -reabrir /login no debería
  // heredar el texto visible de una sesión anterior en el mismo navegador-).
  const esContrasena = type === "password"
  const [mostrarClave, setMostrarClave] = React.useState(false)
  const tipoEfectivo = esContrasena ? (mostrarClave ? "text" : "password") : type

  // Inserta el texto dictado en la posición del cursor (o al final si no
  // hay selección conocida) sin pisar lo ya escrito, y dispara el `onChange`
  // normal del campo: el formulario no distingue dictado de tipeo. Se hace
  // con el setter nativo de `<input>` + un evento `input` real (en vez de
  // llamar a `onChange` a mano) porque `Input` viene de `@base-ui/react` y
  // este camino funciona igual sea el campo controlado o no controlado.
  const manejarTranscripcion = React.useCallback((textoDictado: string) => {
    const input = inputRef.current
    if (!input || !textoDictado) return

    const valorPrevio = input.value
    let inicio = valorPrevio.length
    let fin = valorPrevio.length
    try {
      inicio = input.selectionStart ?? valorPrevio.length
      fin = input.selectionEnd ?? valorPrevio.length
    } catch {
      // Algunos `type` (number, email, date) no soportan selectionStart y
      // tiran InvalidStateError: se cae al comportamiento seguro de
      // insertar al final. En la práctica `conDictado` solo se usa con
      // campos de texto libre, así que esto casi nunca se ejecuta.
    }

    // Espacio de cortesía a los dos lados si hace falta, así dictar en medio
    // de una frase no pega las palabras ("...Antesmañanadespués...").
    const necesitaEspacioAntes = inicio > 0 && !/\s$/.test(valorPrevio.slice(0, inicio))
    const separadorAntes = necesitaEspacioAntes ? " " : ""
    const necesitaEspacioDespues = fin < valorPrevio.length && !/^\s/.test(valorPrevio.slice(fin))
    const separadorDespues = necesitaEspacioDespues ? " " : ""
    const nuevoValor =
      valorPrevio.slice(0, inicio) +
      separadorAntes +
      textoDictado +
      separadorDespues +
      valorPrevio.slice(fin)

    const descriptorNativo = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )
    if (descriptorNativo?.set) {
      descriptorNativo.set.call(input, nuevoValor)
    } else {
      input.value = nuevoValor
    }
    input.dispatchEvent(new Event("input", { bubbles: true }))

    const posicionCursor = inicio + separadorAntes.length + textoDictado.length
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(posicionCursor, posicionCursor)
    })
  }, [])

  return (
    <div className={cn("flex flex-col gap-2", contenedorClassName)}>
      <Label htmlFor={id}>{label}</Label>

      <div className="flex items-center gap-2">
        <div className="relative flex flex-1 items-center">
          {icono && (
            <span
              className="pointer-events-none absolute left-3.5 flex text-muted-foreground [&_svg]:size-5"
              aria-hidden="true"
            >
              {icono}
            </span>
          )}

          <Input
            {...props}
            ref={inputRef}
            id={id}
            name={name ?? id}
            type={tipoEfectivo}
            required={required}
            aria-invalid={error || invalido ? true : undefined}
            aria-describedby={describedByFinal}
            className={cn(icono && "pl-11", (sufijo || esContrasena) && "pr-14", className)}
          />

          {sufijo && (
            <span
              className="pointer-events-none absolute right-3.5 text-base text-muted-foreground"
              aria-hidden="true"
            >
              {sufijo}
            </span>
          )}

          {esContrasena && (
            <button
              type="button"
              onClick={() => setMostrarClave((valor) => !valor)}
              // Evita que el click le saque el foco al input: sin esto, un
              // toque en el ojito mueve el foco al botón y quien estaba
              // tipeando pierde el cursor en el campo. El teclado sigue
              // funcionando normal -Tab enfoca el botón como cualquier
              // otro, esto solo afecta el click/tap con puntero-.
              onMouseDown={(evento) => evento.preventDefault()}
              aria-label={mostrarClave ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={mostrarClave}
              className="absolute top-1/2 right-1 size-tactil shrink-0 -translate-y-1/2 inline-flex items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-salida outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {mostrarClave ? (
                <EyeOffIcon className="size-5" aria-hidden="true" />
              ) : (
                <EyeIcon className="size-5" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        {conDictado && <BotonDictado onTranscripcion={manejarTranscripcion} />}
      </div>

      {ayuda && !error && (
        <p id={idAyuda} className="text-sm text-muted-foreground">
          {ayuda}
        </p>
      )}

      {error && (
        <p id={idError} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
