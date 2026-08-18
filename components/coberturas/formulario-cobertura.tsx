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

import { useRouter } from "next/navigation"
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
  const router = useRouter()
  const [estado, setEstado] = React.useState<EstadoCoberturaAccion>(ESTADO_INICIAL)
  const [enviando, setEnviando] = React.useState(false)
  const [esPrincipal, setEsPrincipal] = React.useState(valoresIniciales?.esPrincipal ?? false)
  const [frente, setFrente] = React.useState<ArchivoCredencialListo | null>(null)
  const [dorso, setDorso] = React.useState<ArchivoCredencialListo | null>(null)

  // Guardia SÍNCRONA contra el doble envío (hotfix, error fugaz al guardar).
  // `enviando` (estado de React) recién deshabilita el botón después de un
  // ciclo de render — y en ese margen un segundo disparo del `submit` (doble
  // toque en pantalla táctil, o Enter en un campo de texto casi a la vez que
  // un toque en el botón) puede arrancar un segundo `manejarSubmit` antes de
  // que el primero llegue a deshabilitar nada. Reproducido de punta a punta:
  // dos invocaciones concurrentes de `crearCobertura` con `esPrincipal`
  // marcado compiten por el índice único parcial
  // `insurance_cards_una_principal_idx`; la que pierde devuelve
  // `ERROR_UNA_PRINCIPAL` y este componente lo pinta un instante antes de que
  // la que ganó complete su `redirect()` y se lleve puesta la pantalla —el
  // "error que aparece y desaparece solo, con la cobertura guardada igual"
  // reportado desde producción. Un `ref`, no estado: tiene que estar
  // disponible en la MISMA pasada síncrona en la que corre este handler,
  // antes de que React tenga oportunidad de re-renderizar y deshabilitar el
  // botón.
  const enviandoRef = React.useRef(false)

  async function manejarSubmit(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enviandoRef.current) return
    enviandoRef.current = true
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
      const resultado = await accion(formData)

      if (resultado.ok) {
        // La acción YA NO redirige: devuelve a dónde ir y navegamos acá. Ver el
        // bloque de `ResultadoGuardadoCobertura` en
        // `app/(app)/(con-nav)/coberturas/actions.ts` para el porqué completo —
        // en resumen, un `redirect()` de Server Action RECHAZA la promesa de
        // quien la invoca a mano, y ese rechazo caía en el `catch` de abajo
        // haciendo pasar un guardado exitoso por una caída de red.
        //
        // El guardia NO se libera y `enviando` queda en `true` a propósito: el
        // botón tiene que seguir deshabilitado hasta que la navegación se lleve
        // puesta la pantalla, no volver a habilitarse por un instante.
        router.push(resultado.destino)
        return
      }

      setEstado({ error: resultado.error })
      setEnviando(false)
      enviandoRef.current = false
    } catch {
      // Ahora sí: acá SOLO llegan fallas de verdad de la request (red caída,
      // request abortada). El camino feliz resuelve por el `if` de arriba.
      setEstado({ error: ERROR_RED })
      setEnviando(false)
      enviandoRef.current = false
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
