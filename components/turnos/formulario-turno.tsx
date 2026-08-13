"use client"

/**
 * Formulario de alta y edición de turnos (Sprint 6, tarea 6.1). Un solo
 * componente para las dos pantallas -`/turnos/nuevo` y
 * `/turnos/[id]/editar`-, mismo criterio que separar `modo` en vez de
 * duplicar el JSX: los campos son idénticos, solo cambia la Server Action
 * que recibe el submit (`crearTurno` vs. `actualizarTurno`) y si hay que
 * mandar `turnoId`.
 *
 * ## Especialidad y médico
 *
 * `especialidad` es obligatoria y siempre texto libre. `médico` también es
 * texto libre -el directorio completo de profesionales es el Sprint 10-,
 * pero si el perfil ya tiene médicos cargados en `doctors` (por ejemplo, el
 * Dr. Rodríguez del seed), aparece un `<Select>` que autocompleta el nombre
 * -y la especialidad, si el médico la tiene cargada- en los campos de texto
 * de abajo. El `<Select>` no viaja en el `FormData` (no tiene `name`): es
 * pura ayuda de UI, la fuente de verdad que se guarda siempre es el texto de
 * `medico`/`especialidad`, editable después de elegir.
 *
 * ## Coordenadas: REGLA DE COSTO CERO del roadmap
 *
 * Nada de geocoding pago. Latitud/longitud son un campo AVANZADO, colapsado
 * por defecto, con un link que abre Google Maps con la dirección ya escrita
 * -`https://www.google.com/maps/search/...`, una búsqueda pública sin API
 * key- para que la persona copie las coordenadas del pin a mano y las pegue
 * acá. Nominatim queda documentado en el roadmap como opción futura; esta
 * tarea no lo implementa.
 */

import * as React from "react"
import { useActionState } from "react"

import { CalendarPlusIcon, MapPinnedIcon, SaveIcon } from "lucide-react"

import {
  actualizarTurno,
  crearTurno,
  type EstadoTurnoAccion,
} from "@/app/(app)/(con-nav)/turnos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoNumero } from "@/components/base/campo-numero"
import { CampoTexto } from "@/components/base/campo-texto"
import { CampoTextarea } from "@/components/base/campo-textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface MedicoParaAutocompletar {
  id: string
  full_name: string
  specialty: string | null
}

export interface ValoresTurno {
  especialidad: string
  medico: string
  /** `YYYY-MM-DD`. */
  fecha: string
  /** `HH:mm`. */
  hora: string
  lugarNombre: string
  lugarDireccion: string
  latitud: string
  longitud: string
  notasPreparacion: string
}

export interface FormularioTurnoProps {
  modo: "crear" | "editar"
  /** Obligatorio cuando `modo === "editar"`: viaja como campo oculto para que `actualizarTurno` sepa qué fila tocar. */
  turnoId?: string
  valoresIniciales?: Partial<ValoresTurno>
  /** Médicos activos del directorio del perfil (`doctors`, `is_active = true`). Vacío si todavía no cargó ninguno: el `<Select>` de autocompletado no se renderiza. */
  medicos: MedicoParaAutocompletar[]
  /** Solo para `modo === "crear"`: tope inferior del `<input type="date">` (hoy, hora de Ushuaia). En edición no se restringe: un turno pasado se puede seguir corrigiendo. */
  fechaMinimaIso?: string
}

const ESTADO_INICIAL: EstadoTurnoAccion = { error: null }
const ID_FORMULARIO = "formulario-turno"

export function FormularioTurno({
  modo,
  turnoId,
  valoresIniciales,
  medicos,
  fechaMinimaIso,
}: FormularioTurnoProps) {
  const accion = modo === "crear" ? crearTurno : actualizarTurno
  const [estado, enviarAccion, pendiente] = useActionState(accion, ESTADO_INICIAL)

  const [especialidad, setEspecialidad] = React.useState(valoresIniciales?.especialidad ?? "")
  const [medico, setMedico] = React.useState(valoresIniciales?.medico ?? "")
  const [direccion, setDireccion] = React.useState(valoresIniciales?.lugarDireccion ?? "")
  const [mostrarCoordenadas, setMostrarCoordenadas] = React.useState(
    Boolean(valoresIniciales?.latitud || valoresIniciales?.longitud),
  )

  const urlMaps =
    direccion.trim().length > 0
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion.trim())}`
      : "https://www.google.com/maps"

  function elegirMedicoDelDirectorio(idMedico: string | null) {
    const doctor = medicos.find((candidato) => candidato.id === idMedico)
    if (!doctor) return
    setMedico(doctor.full_name)
    if (doctor.specialty) {
      setEspecialidad(doctor.specialty)
    }
  }

  return (
    <form id={ID_FORMULARIO} action={enviarAccion} className="flex flex-col gap-5">
      {modo === "editar" && turnoId && <input type="hidden" name="turnoId" value={turnoId} />}

      <CampoTexto
        id="especialidad"
        label="Especialidad"
        required
        maxLength={100}
        value={especialidad}
        onChange={(evento) => setEspecialidad(evento.target.value)}
        ayuda="Ej: Cardiología, Clínica médica, Oftalmología."
      />

      {medicos.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="medico-directorio-trigger">Elegir de tu directorio (opcional)</Label>
          <Select
            items={medicos.map((doctor) => ({ value: doctor.id, label: doctor.full_name }))}
            onValueChange={elegirMedicoDelDirectorio}
          >
            <SelectTrigger id="medico-directorio-trigger" className="w-full">
              <SelectValue placeholder="Elegir un médico ya cargado" />
            </SelectTrigger>
            <SelectContent>
              {medicos.map((doctor) => (
                <SelectItem key={doctor.id} value={doctor.id}>
                  {doctor.full_name}
                  {doctor.specialty ? ` — ${doctor.specialty}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Completa el nombre (y la especialidad) abajo. Podés corregirlo después de elegir.
          </p>
        </div>
      )}

      <CampoTexto
        id="medico"
        label="Médico"
        maxLength={150}
        value={medico}
        onChange={(evento) => setMedico(evento.target.value)}
        ayuda="Opcional. El directorio completo de médicos llega en un sprint futuro."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CampoTexto
          id="fecha"
          label="Fecha"
          type="date"
          required
          defaultValue={valoresIniciales?.fecha}
          min={modo === "crear" ? fechaMinimaIso : undefined}
        />
        <CampoTexto id="hora" label="Hora" type="time" required defaultValue={valoresIniciales?.hora} />
      </div>

      <CampoTexto
        id="lugarNombre"
        label="Lugar"
        maxLength={150}
        defaultValue={valoresIniciales?.lugarNombre}
        ayuda="Nombre de la clínica o el consultorio (opcional)."
      />

      <CampoTexto
        id="lugarDireccion"
        label="Dirección"
        maxLength={300}
        defaultValue={valoresIniciales?.lugarDireccion}
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
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
            <a
              href={urlMaps}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary underline underline-offset-2 hover:no-underline"
            >
              <MapPinnedIcon className="size-4 shrink-0" aria-hidden="true" />
              Abrir en Google Maps para copiarlas
            </a>
            <p className="text-sm text-muted-foreground">
              Buscá el lugar, mantené el dedo (o el clic) sobre el punto en el mapa y copiá los
              números que aparecen. Pegalos acá abajo.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        id="notasPreparacion"
        label="Notas de preparación"
        rows={4}
        maxLength={2000}
        conDictado
        defaultValue={valoresIniciales?.notasPreparacion}
        ayuda="Ayuno, llevar estudios previos, suspender alguna medicación, etc. (opcional)."
      />

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <Boton type="submit" size="lg" cargando={pendiente}>
        {modo === "crear" ? <CalendarPlusIcon aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
        {modo === "crear" ? "Guardar turno" : "Guardar cambios"}
      </Boton>
    </form>
  )
}
