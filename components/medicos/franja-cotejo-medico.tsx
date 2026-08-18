"use client"

/**
 * Franja "¿Es este médico que ya tenés?" / "¿Agregar a tus médicos?" (cruces
 * inteligentes, agosto 2026): cuando la IA extrae un médico de un mensaje de
 * turno o de un documento, cruza ese nombre contra el directorio del perfil
 * activo (`lib/medicos/coincidencia-nombre.ts`, 100% en el cliente -el
 * directorio ya viaja como prop, no hace falta red-) y ofrece, de un toque:
 *
 * - **Hay uno parecido** ("Dr. Juárez" extraído, "Dr. Juárez" ya cargado, o
 *   con matices de tratamiento/orden): "¿Es **X** que ya tenés cargado?
 *   [Vincular]" -`onVincular` hace exactamente lo que elegirlo del `<Select>`
 *   de siempre-.
 * - **No hay nadie parecido**: "¿Agregar a **X** a tus médicos? [Agregar]"
 *   -crea vía la Server Action existente `crearMedicoDesdeCruce`
 *   (`app/(app)/(con-nav)/medicos/actions.ts`, mismo `INSERT` que
 *   `crearMedico`, sin el `redirect` que perdería lo que se estaba
 *   revisando) con nombre + especialidad + institución precargados, y
 *   `onAgregado` vincula el resultado exactamente igual que "Vincular"-.
 *
 * Reusada por `components/turnos/formulario-turno.tsx` (vincula vía
 * `doctorId`) y por `components/documentos/formulario-revision.tsx` (donde
 * "vincular" solo normaliza el texto del campo "Médico" al nombre del
 * directorio -los documentos no tienen un `doctor_id` cableado en ningún
 * flujo hoy, ver el comentario de `formulario-revision.tsx`-).
 *
 * ## "No" recuerda la decisión durante esta edición, nunca globalmente
 *
 * Mismo criterio que `components/lugares/franja-candidato-lugar.tsx`: un
 * `Set` de nombres descartados en estado de React (se pierde al desmontar el
 * formulario, no se persiste en ningún lado).
 *
 * ## Por qué NO es un `<form>` con `useActionState`
 *
 * Las dos pantallas que usan esta franja (`FormularioTurno`,
 * `FormularioRevision`) ya son, ellas mismas, un `<form>` -y esta franja se
 * renderiza EN MEDIO de sus campos-. Un `<form>` adentro de otro `<form>` es
 * HTML inválido (el navegador lo "aplana": el botón "Agregar" terminaría
 * mandando el `<form>` EXTERIOR completo, con nombres de campo que no tienen
 * nada que ver). Por eso "Agregar" arma su propio `FormData` a mano y llama
 * a `crearMedicoDesdeCruce` directo -las Server Actions son funciones
 * invocables como cualquier otra, `useActionState` es solo un ayudante para
 * cablearlas a un `<form>` real, no un requisito-, con `useTransition` para
 * el estado de pendiente/error en su lugar.
 *
 * ## Guardia anti doble-envío (mismo motivo que `formulario-crear-gestionado.tsx`)
 *
 * `crearMedicoDesdeCruce` NUNCA redirige -a propósito, para no perder el
 * turno o el documento que se está revisando (ver más arriba)-, así que esta
 * franja sigue montada cuando termina, exactamente el caso en el que el
 * commit "Blindaje anti doble-envío" documentó que un doble toque puede crear
 * DOS filas: acá no hay `<form action>` que React deduplique solo, es un
 * `onClick` común -React no encola clicks repetidos como sí hace con
 * `submit`-, y `doctors` no tiene ninguna restricción `UNIQUE` que frene un
 * "Dr. Juárez" cargado dos veces. `Boton`'s `disabled={cargando}` llega
 * recién en el próximo render -hay una ventana real entre el primer y el
 * segundo toque-, así que `agregandoRef` se fija SINCRÓNICAMENTE al principio
 * de `agregar()`, antes de tocar el estado o la red.
 */

import * as React from "react"

import { UserPlusIcon, XIcon } from "lucide-react"

import { crearMedicoDesdeCruce } from "@/app/(app)/(con-nav)/medicos/actions"
import { Boton } from "@/components/base/boton"
import { medicoParecidoEnDirectorio } from "@/lib/medicos/coincidencia-nombre"
import type { MedicoParaAutocompletar } from "@/lib/turnos/autocompletar-medico"

export interface ContextoAltaMedicoDesdeCruce {
  /** Ya mapeada al catálogo de especialidades si correspondía (`lib/especialidades/mapear-catalogo.ts`); "" si no hay ninguna. */
  especialidad: string
  institucion: string
  direccion: string
  ciudad: string
  provincia: string
}

export interface FranjaCotejoMedicoProps {
  /** Nombre de médico extraído a cotejar. `null` = nada que cotejar (no se renderiza nada). */
  nombreExtraido: string | null
  /** Directorio ACTIVO del perfil -mismo que ya recibe el `<Select>` de médico-. */
  directorio: readonly MedicoParaAutocompletar[]
  /** Con qué precargar el alta si no hay coincidencia. */
  contexto: ContextoAltaMedicoDesdeCruce
  /** La persona tocó "Vincular" sobre un médico YA cargado. */
  onVincular: (medico: MedicoParaAutocompletar) => void
  /** Se dio de alta un médico nuevo vía "Agregar". */
  onAgregado: (medico: MedicoParaAutocompletar) => void
}

const ERROR_INESPERADO =
  "Ocurrió un problema y no pudimos agregar el médico. Probá de nuevo en unos minutos, o cargalo desde /medicos."

export function FranjaCotejoMedico({
  nombreExtraido,
  directorio,
  contexto,
  onVincular,
  onAgregado,
}: FranjaCotejoMedicoProps) {
  const [descartados, setDescartados] = React.useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = React.useState<string | null>(null)
  const [agregando, iniciarTransicion] = React.useTransition()
  // Guardia anti doble-envío: ver el comentario de cabecera del archivo.
  const agregandoRef = React.useRef(false)

  const clave = (nombreExtraido ?? "").trim().toLocaleLowerCase("es-AR")

  const parecido = React.useMemo(
    () => (nombreExtraido ? medicoParecidoEnDirectorio(nombreExtraido, directorio) : null),
    [nombreExtraido, directorio],
  )

  if (!nombreExtraido || clave.length === 0) return null
  if (descartados.has(clave)) return null

  function descartar() {
    setDescartados((previo) => new Set(previo).add(clave))
  }

  function agregar() {
    if (!nombreExtraido) return
    // Chequeado y fijado ANTES de cualquier otra cosa -incluido `setError`-:
    // un segundo toque sincrónico (doble clic, doble tap) tiene que frenar
    // acá, no después de armar el `FormData` ni de entrar a la transición.
    if (agregandoRef.current) return
    agregandoRef.current = true
    setError(null)

    const formData = new FormData()
    formData.set("nombre", nombreExtraido)
    if (contexto.especialidad.length > 0) formData.append("especialidades", contexto.especialidad)
    formData.set("institucion", contexto.institucion)
    formData.set("direccion", contexto.direccion)
    formData.set("ciudad", contexto.ciudad)
    formData.set("provincia", contexto.provincia)

    iniciarTransicion(async () => {
      try {
        const resultado = await crearMedicoDesdeCruce({ error: null, medico: null }, formData)
        if (resultado.medico) {
          // Mismo tratamiento que "No": una vez agregado, esta franja no
          // vuelve a ofrecer nada para ESTE nombre -si más tarde llega un
          // médico DISTINTO extraído, ese es un `clave` nuevo y la franja se
          // muestra de nuevo-.
          setDescartados((previo) => new Set(previo).add(clave))
          onAgregado(resultado.medico)
        } else {
          setError(resultado.error ?? ERROR_INESPERADO)
        }
      } finally {
        // Libera la guardia pase lo que pase -éxito o error, acá no hay
        // `redirect()` que exima de este paso, mismo criterio que
        // `formulario-crear-gestionado.tsx`-.
        agregandoRef.current = false
      }
    })
  }

  if (parecido) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm chica:px-2.5 chica:py-1.5 chica:text-xs">
        <p className="min-w-0 flex-1 text-foreground">
          ¿Es <strong className="font-semibold">{parecido.full_name}</strong> que ya tenés cargado?
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Boton type="button" size="sm" onClick={() => onVincular(parecido)}>
            Vincular
          </Boton>
          <Boton type="button" variant="ghost" size="sm" onClick={descartar}>
            <XIcon aria-hidden="true" />
            No
          </Boton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm chica:px-2.5 chica:py-1.5 chica:text-xs">
      <p className="min-w-0 flex-1 text-foreground">
        ¿Agregar a <strong className="font-semibold">{nombreExtraido}</strong> a tus médicos?
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <Boton type="button" size="sm" cargando={agregando} onClick={agregar}>
          <UserPlusIcon aria-hidden="true" />
          Agregar
        </Boton>
        <Boton type="button" variant="ghost" size="sm" onClick={descartar}>
          <XIcon aria-hidden="true" />
          No
        </Boton>
      </div>
      {error && (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
