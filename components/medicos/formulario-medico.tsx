"use client"

/**
 * Formulario de alta y edición de médicos (Sprint 10, tarea 10.1). Mismo
 * criterio que `components/medicacion/formulario-medicacion.tsx` y
 * `components/turnos/formulario-turno.tsx`: un solo componente para
 * `/medicos/nuevo` y `/medicos/[id]/editar`, `modo` decide la Server Action
 * (`crearMedico` vs. `actualizarMedico`) y si viaja `medicoId`.
 *
 * ## Coordenadas: mismo patrón "costo cero" que el formulario de turnos
 *
 * Nada de geocoding pago. Latitud/longitud son un campo AVANZADO, colapsado
 * por defecto, con un link que abre Google Maps con la dirección ya escrita
 * -una búsqueda pública sin API key- para que la persona copie las
 * coordenadas del pin a mano y las pegue acá (`docs`: "Podés copiar las
 * coordenadas desde Google Maps, mantener apretado el punto"). Las dos
 * `CampoNumero` usan `permiteNegativo`: Ushuaia, como el resto del hemisferio
 * sur y oeste, tiene latitud y longitud siempre negativas -mismo motivo que
 * documenta `campo-numero.tsx#permiteNegativo`-.
 */

import * as React from "react"
import { useActionState } from "react"

import { MapPinnedIcon, SaveIcon, UserPlusIcon } from "lucide-react"

import { actualizarMedico, crearMedico, type EstadoMedicoAccion } from "@/app/(app)/(con-nav)/medicos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoNumero } from "@/components/base/campo-numero"
import { CampoTexto } from "@/components/base/campo-texto"
import { CampoTextarea } from "@/components/base/campo-textarea"

export interface ValoresMedico {
  nombre: string
  especialidad: string
  matricula: string
  institucion: string
  telefono: string
  direccion: string
  latitud: string
  longitud: string
  notas: string
}

export interface FormularioMedicoProps {
  modo: "crear" | "editar"
  /** Obligatorio cuando `modo === "editar"`: viaja como campo oculto para que `actualizarMedico` sepa qué fila tocar. */
  medicoId?: string
  valoresIniciales?: Partial<ValoresMedico>
}

const ESTADO_INICIAL: EstadoMedicoAccion = { error: null }

export function FormularioMedico({ modo, medicoId, valoresIniciales }: FormularioMedicoProps) {
  const accion = modo === "crear" ? crearMedico : actualizarMedico
  const [estado, enviarAccion, pendiente] = useActionState(accion, ESTADO_INICIAL)

  const [direccion, setDireccion] = React.useState(valoresIniciales?.direccion ?? "")
  const [mostrarCoordenadas, setMostrarCoordenadas] = React.useState(
    Boolean(valoresIniciales?.latitud || valoresIniciales?.longitud),
  )

  const urlMaps =
    direccion.trim().length > 0
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion.trim())}`
      : "https://www.google.com/maps"

  return (
    <form action={enviarAccion} className="flex flex-col gap-5">
      {modo === "editar" && medicoId && <input type="hidden" name="medicoId" value={medicoId} />}

      {/*
        Chica (Sprint 13, tarea 13.5): "Nombre" + "Especialidad" y "Matrícula"
        + "Institución" pasan cada par a una grilla de 2 columnas -son pares
        de elementos consecutivos en el DOM, así que no hay reordenamiento,
        mismo criterio que la grilla de dosis de
        `formulario-medicacion.tsx`-.
      */}
      <div className="flex flex-col gap-5 chica:grid chica:grid-cols-2 chica:items-start chica:gap-3">
        <CampoTexto
          id="nombre"
          label="Nombre del médico"
          required
          maxLength={200}
          defaultValue={valoresIniciales?.nombre}
          ayuda='Con el tratamiento que uses. Ej: "Dr. Carlos Rodríguez".'
        />

        <CampoTexto
          id="especialidad"
          label="Especialidad"
          maxLength={150}
          defaultValue={valoresIniciales?.especialidad}
          ayuda='Opcional. Ej: "Cardiología", "Clínica médica".'
        />
      </div>

      <div className="flex flex-col gap-5 chica:grid chica:grid-cols-2 chica:items-start chica:gap-3">
        <CampoTexto
          id="matricula"
          label="Matrícula"
          maxLength={100}
          defaultValue={valoresIniciales?.matricula}
          ayuda='Opcional. MN o MP, tal como figura en el sello. Ej: "MN 45678".'
        />

        <CampoTexto
          id="institucion"
          label="Institución"
          maxLength={150}
          defaultValue={valoresIniciales?.institucion}
          ayuda='Opcional. Clínica, hospital o consultorio. Ej: "Clínica Ushuaia".'
        />
      </div>

      <CampoTexto
        id="telefono"
        label="Teléfono"
        type="tel"
        maxLength={50}
        defaultValue={valoresIniciales?.telefono}
        ayuda="Opcional. Con característica, para que el botón «Llamar» marque directo."
      />

      <CampoTexto
        id="direccion"
        label="Dirección"
        maxLength={300}
        value={direccion}
        onChange={(evento) => setDireccion(evento.target.value)}
        ayuda="Calle y altura (opcional)."
      />

      <div className="flex flex-col gap-3">
        <Boton
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMostrarCoordenadas((valor) => !valor)}
          aria-expanded={mostrarCoordenadas}
          className="w-fit"
        >
          {mostrarCoordenadas ? "Ocultar coordenadas" : "¿Tenés las coordenadas? Pegalas de Google Maps"}
        </Boton>

        {mostrarCoordenadas && (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4 chica:gap-2 chica:p-3">
            <a
              href={urlMaps}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
            >
              <MapPinnedIcon className="size-4 shrink-0" aria-hidden="true" />
              Abrir en Google Maps para copiarlas
            </a>
            <p className="text-sm text-muted-foreground chica:hidden">
              Podés copiar las coordenadas desde Google Maps: buscá el consultorio, mantené
              apretado el punto en el mapa hasta que aparezcan los números, y copialos acá abajo.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
              <CampoNumero
                id="latitud"
                label="Latitud"
                decimal
                permiteNegativo
                defaultValue={valoresIniciales?.latitud}
                ayuda="Ej: -54.8083"
              />
              <CampoNumero
                id="longitud"
                label="Longitud"
                decimal
                permiteNegativo
                defaultValue={valoresIniciales?.longitud}
                ayuda="Ej: -68.3000"
              />
            </div>
          </div>
        )}
      </div>

      <CampoTextarea
        id="notas"
        label="Notas"
        rows={3}
        maxLength={2000}
        conDictado
        defaultValue={valoresIniciales?.notas}
        ayuda="Cómo llegar, con quién coordinar el turno, lo que sirva recordar (opcional)."
      />

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <Boton type="submit" size="lg" cargando={pendiente}>
        {modo === "crear" ? <UserPlusIcon aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
        {modo === "crear" ? "Guardar médico" : "Guardar cambios"}
      </Boton>
    </form>
  )
}
