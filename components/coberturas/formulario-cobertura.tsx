"use client"

/**
 * Formulario de alta y edición de cobertura (Sprint 8, tarea 8.1). Mismo
 * criterio de `modo` que `components/medicacion/formulario-medicacion.tsx`:
 * un solo componente para `/coberturas/nuevo` y `/coberturas/[id]/editar`.
 *
 * ## Por qué NO usa `useActionState` (a diferencia de `formulario-medicacion.tsx`)
 *
 * Este formulario sube archivos ya comprimidos en el cliente
 * (`components/coberturas/campo-imagen-credencial.tsx` entrega un `Blob`,
 * no un `<input type="file">` con `name` que el navegador pueda serializar
 * solo). Un `<form action={fn}>` nativo arma el `FormData` él mismo a partir
 * de los campos con `name`, y no hay forma de inyectarle un blob que vive en
 * estado de React. La solución -mismo patrón que
 * `app/(app)/(con-nav)/estudios/nuevo/pantalla-carga.tsx` para
 * `subirDocumento`- es interceptar el submit, armar el `FormData` a mano con
 * `new FormData(formulario)` (que sí junta los campos de texto normales) y
 * pisar/agregar `frente`/`dorso` con los blobs comprimidos antes de llamar a
 * la Server Action directamente.
 */

import * as React from "react"

import { CreditCardIcon, SaveIcon } from "lucide-react"

import {
  actualizarCobertura,
  crearCobertura,
  type EstadoCoberturaAccion,
} from "@/app/(app)/(con-nav)/coberturas/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import {
  CampoImagenCredencial,
  type ArchivoCredencialListo,
} from "@/components/coberturas/campo-imagen-credencial"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

export interface ValoresCobertura {
  proveedor: string
  plan: string
  numeroAfiliado: string
  esPrincipal: boolean
}

export interface FormularioCoberturaProps {
  modo: "crear" | "editar"
  /** Obligatorio cuando `modo === "editar"`: viaja como campo oculto para que `actualizarCobertura` sepa qué fila tocar. */
  coberturaId?: string
  valoresIniciales?: Partial<ValoresCobertura>
  tieneFrenteExistente?: boolean
  tieneDorsoExistente?: boolean
}

const ESTADO_INICIAL: EstadoCoberturaAccion = { error: null }

const ERROR_RED = "No pudimos guardar la cobertura. Revisá tu conexión y probá de nuevo."

export function FormularioCobertura({
  modo,
  coberturaId,
  valoresIniciales,
  tieneFrenteExistente = false,
  tieneDorsoExistente = false,
}: FormularioCoberturaProps) {
  const [estado, setEstado] = React.useState<EstadoCoberturaAccion>(ESTADO_INICIAL)
  const [enviando, setEnviando] = React.useState(false)
  const [esPrincipal, setEsPrincipal] = React.useState(valoresIniciales?.esPrincipal ?? false)
  const [frente, setFrente] = React.useState<ArchivoCredencialListo | null>(null)
  const [dorso, setDorso] = React.useState<ArchivoCredencialListo | null>(null)

  async function manejarSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setEstado(ESTADO_INICIAL)
    setEnviando(true)

    // Campos de texto normales (`proveedor`, `plan`, `numeroAfiliado`, y en
    // modo editar `coberturaId`) los junta el propio `FormData` a partir del
    // `name` de cada input. El checkbox de "principal" no viaja por `name`
    // -es un componente de Base UI, no un `<input>` nativo con `name`
    // garantizado- así que se fija a mano desde el estado de React.
    const formData = new FormData(evento.currentTarget)
    formData.set("esPrincipal", esPrincipal ? "on" : "")
    if (frente) formData.set("frente", frente.blob, "frente.jpg")
    if (dorso) formData.set("dorso", dorso.blob, "dorso.jpg")

    try {
      const accion = modo === "crear" ? crearCobertura : actualizarCobertura
      // En éxito esta llamada no vuelve: la acción redirige a `/coberturas`.
      const resultado = await accion(formData)

      if (resultado?.error) {
        setEstado({ error: resultado.error })
        setEnviando(false)
      }
    } catch {
      // Red caída, request abortada. Un `redirect()` de la Server Action NO
      // cae acá: lo intercepta el runtime de React antes.
      setEstado({ error: ERROR_RED })
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="flex flex-col gap-5">
      {modo === "editar" && coberturaId && (
        <input type="hidden" name="coberturaId" value={coberturaId} />
      )}

      {/*
        Chica (Sprint 13, tarea 13.5): "Obra social o prepaga" y "Plan" pasan
        a una grilla de 2 columnas -son dos elementos consecutivos en el DOM,
        así que no hay reordenamiento-. "Número de afiliado" se queda fuera
        de la grilla, a ancho completo en los dos modos: es el dato más largo
        de los tres (puede tener 15+ caracteres) y partirlo a la mitad del
        ancho lo volvería ilegible.
      */}
      <div className="flex flex-col gap-5 chica:grid chica:grid-cols-2 chica:items-start chica:gap-3">
        <CampoTexto
          id="proveedor"
          label="Obra social o prepaga"
          required
          maxLength={200}
          defaultValue={valoresIniciales?.proveedor}
          icono={<CreditCardIcon />}
          ayuda='Tal como figura en la credencial. Ej: "OSDE", "PAMI", "IOMA".'
        />

        <CampoTexto
          id="plan"
          label="Plan"
          maxLength={150}
          defaultValue={valoresIniciales?.plan}
          ayuda='Opcional. Ej: "210", "Plan Oro".'
        />
      </div>

      <CampoTexto
        id="numeroAfiliado"
        label="Número de afiliado"
        maxLength={100}
        defaultValue={valoresIniciales?.numeroAfiliado}
        ayuda="Opcional, tal como figura en la credencial."
      />

      <div className="flex items-center gap-3">
        <Checkbox
          id="esPrincipal"
          checked={esPrincipal}
          onCheckedChange={(valor) => setEsPrincipal(valor === true)}
        />
        <Label htmlFor="esPrincipal" className="text-base font-normal">
          Marcar como cobertura principal
        </Label>
      </div>

      {/*
        Frente/Dorso NO pasan a `chica:grid-cols-2`: cada `CampoImagenCredencial`
        ya arma su propia grilla interna de 2 columnas para "Sacar foto" /
        "Galería" (`campo-imagen-credencial.tsx`), y anidar esa grilla dentro
        de otra de 2 columnas deja 4 columnas en un ancho de celular -los
        botones internos se solapan-. Se quedan apiladas en los dos modos,
        igual que en grande.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CampoImagenCredencial
          label="Frente"
          tieneExistente={tieneFrenteExistente}
          onCambio={setFrente}
        />
        <CampoImagenCredencial
          label="Dorso"
          tieneExistente={tieneDorsoExistente}
          onCambio={setDorso}
        />
      </div>

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <Boton type="submit" size="lg" cargando={enviando}>
        <SaveIcon aria-hidden="true" />
        {modo === "crear" ? "Guardar cobertura" : "Guardar cambios"}
      </Boton>
    </form>
  )
}
