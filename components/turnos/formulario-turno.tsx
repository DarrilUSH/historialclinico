"use client"

/**
 * Formulario de alta y edición de turnos (Sprint 6, tarea 6.1; vinculación
 * con el directorio de médicos en el Sprint 10, tarea 10.1). Un solo
 * componente para las dos pantallas -`/turnos/nuevo` y
 * `/turnos/[id]/editar`-, mismo criterio que separar `modo` en vez de
 * duplicar el JSX: los campos son idénticos, solo cambia la Server Action
 * que recibe el submit (`crearTurno` vs. `actualizarTurno`) y si hay que
 * mandar `turnoId`.
 *
 * ## Especialidad y médico
 *
 * `especialidad` y `médico` son siempre texto libre, editable a mano. Si el
 * perfil ya tiene médicos cargados en `doctors` (Sprint 10), aparece un
 * `<Select>` -"Médico (opcional)"- con los ACTIVOS del directorio más la
 * opción "Ninguno". El `<Select>` en sí no viaja en el `FormData` (no tiene
 * `name`): es pura ayuda de UI. Lo que sí viaja es:
 *
 * - `doctorId` (campo oculto): el `id` de `doctors` elegido, o `""` si es
 *   "Ninguno" o texto libre sin elegir nada. `crearTurno`/`actualizarTurno`
 *   lo persisten en `appointments.doctor_id`.
 * - Los campos de texto (`medico`, `especialidad`, `lugarNombre`,
 *   `lugarDireccion`, `latitud`, `longitud`), que siguen siendo la fuente de
 *   verdad del turno -`doctor_name` en la base es el texto tal como quedó
 *   guardado, no un `JOIN` contra `doctors`, mismo criterio que
 *   `documents.doctor_name` (`supabase/migrations/20260812200000_schema_inicial.sql`
 *   §4.4: "se conserva aunque exista doctor_id, porque es el dato textual").
 *
 * ## Autocompletado: SOLO lo que está vacío, nunca pisa lo tipeado
 *
 * Elegir un médico del `<Select>` completa `medico`, `especialidad`,
 * `lugarNombre` (institución), `lugarDireccion` y el par
 * `latitud`/`longitud` -si el médico las tiene cargadas-, pero cada campo
 * SOLO si está vacío en ese momento (`lib/turnos/autocompletar-medico.ts`,
 * que concentra el criterio y sus tests). Antes de esta tarea (Sprint 6) el
 * `<Select>` pisaba `medico`/`especialidad` sin condición; se corrige acá
 * porque un `<Select>` de conveniencia no debería borrar una corrección que
 * la persona ya hizo a mano -ej: escribió "Dr. Rodríguez (reemplaza a la Dra.
 * Torres esta semana)" y después elige a la Dra. Torres del directorio-.
 * Elegir "Ninguno" solo limpia el vínculo (`doctorId`); no toca ningún campo
 * de texto.
 *
 * ## Coordenadas: REGLA DE COSTO CERO del roadmap
 *
 * Nada de geocoding pago. Latitud/longitud son un campo AVANZADO, colapsado
 * por defecto, con un link que abre Google Maps con la dirección ya escrita
 * -`https://www.google.com/maps/search/...`, una búsqueda pública sin API
 * key- para que la persona copie las coordenadas del pin a mano y las pegue
 * acá. Desde el Sprint 16 (tarea 16.1) también hay un intento automático de
 * geocodificación con Nominatim del lado del servidor
 * (`lib/ubicacion/geocodificacion.ts`) cuando esta persona NO pega
 * coordenadas: el campo manual sigue siendo la fuente de verdad si se
 * completa, la automática es solo un mejor esfuerzo de respaldo.
 *
 * ## Ciudad y provincia (Sprint 16, tarea 16.1)
 *
 * Se suman como campos propios -no como parte de "Dirección"- para que la
 * geocodificación y el deep link de "Cómo llegar" puedan armar una consulta
 * real (calle + ciudad + provincia + Argentina) en vez de asumir una
 * localidad fija. Antes de esta tarea, sin estos campos, el link de "Cómo
 * llegar" completaba lo que faltaba pegando ", Ushuaia, Tierra del Fuego" a
 * cualquier dirección -el bug que reportó el usuario con turnos cargados en
 * La Plata, CABA, etc.-. "Ciudad" es texto libre; "Provincia" es un
 * `<Select>` con las 24 jurisdicciones argentinas
 * (`lib/ubicacion/provincias.ts`). Los dos llegan precargados desde
 * `/turnos/nuevo` con la última ciudad/provincia que el perfil haya usado
 * -`lib/ubicacion/ultima-usada.ts`-, nunca con un valor fijo: son una
 * sugerencia editable, no una imposición.
 *
 * ## Especialidad: autocompletar con el catálogo (Sprint 16, tarea 16.2)
 *
 * "Especialidad" usa `CampoAutocompletar` en vez de `CampoTexto`: sugiere del
 * catálogo curado (`lib/especialidades/catalogo.ts`) a medida que se tipea,
 * insensible a tildes/mayúsculas ("cardio" encuentra "Cardiología"), pero
 * sigue siendo texto libre -si nada matchea, lo tipeado vale igual, mismo
 * criterio que ya declaraba este campo antes de la tarea-. Elegir un médico
 * del directorio (más abajo) sigue completando este campo con SU
 * especialidad principal si está vacío, sin pisar lo ya tecleado -sin
 * cambios respecto de antes, ver `lib/turnos/autocompletar-medico.ts`-.
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
import { CampoAutocompletar } from "@/components/base/campo-autocompletar"
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
import { CATALOGO_ESPECIALIDADES } from "@/lib/especialidades/catalogo"
import {
  camposAutocompletadosDesdeMedico,
  type MedicoParaAutocompletar,
} from "@/lib/turnos/autocompletar-medico"
import { direccionCompleta } from "@/lib/ubicacion/formato"
import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"
import { cn } from "@/lib/utils"

export type { MedicoParaAutocompletar }

/** Valor del `<SelectItem>` "Ninguno": limpia `doctorId` sin tocar los campos de texto. Un `id` real de `doctors` es siempre un uuid, así que este sentinel nunca puede colisionar con uno. */
const SENTINEL_NINGUN_MEDICO = "ninguno"

/** Opciones del `<Select>` de provincia: "Sin especificar" (viaja como `""`, el schema la trata como no provista) + las 24 jurisdicciones. */
const OPCIONES_PROVINCIA: { value: string; label: string }[] = [
  { value: "", label: "Sin especificar" },
  ...PROVINCIAS_ARGENTINAS.map((provincia) => ({ value: provincia, label: provincia })),
]

export interface ValoresTurno {
  especialidad: string
  medico: string
  /** `YYYY-MM-DD`. */
  fecha: string
  /** `HH:mm`. */
  hora: string
  lugarNombre: string
  lugarDireccion: string
  /** Sprint 16, tarea 16.1. */
  lugarCiudad: string
  lugarProvincia: string
  latitud: string
  longitud: string
  notasPreparacion: string
  /** `id` de `doctors` vinculado, o `""` sin vínculo (Sprint 10, tarea 10.1). */
  doctorId: string
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
  const [lugarNombre, setLugarNombre] = React.useState(valoresIniciales?.lugarNombre ?? "")
  const [lugarDireccion, setLugarDireccion] = React.useState(valoresIniciales?.lugarDireccion ?? "")
  const [lugarCiudad, setLugarCiudad] = React.useState(valoresIniciales?.lugarCiudad ?? "")
  const [lugarProvincia, setLugarProvincia] = React.useState(valoresIniciales?.lugarProvincia ?? "")
  const [latitud, setLatitud] = React.useState(valoresIniciales?.latitud ?? "")
  const [longitud, setLongitud] = React.useState(valoresIniciales?.longitud ?? "")
  // El médico vinculado puede no estar entre los `medicos` ACTIVOS que recibe
  // este componente (fue dado de baja después de vincularse a este turno):
  // el `<Select>` entonces no lo muestra seleccionado, pero el campo oculto
  // conserva el vínculo igual, así que editar y guardar sin tocar el
  // selector no lo pierde.
  const [doctorId, setDoctorId] = React.useState(valoresIniciales?.doctorId ?? "")
  const [mostrarCoordenadas, setMostrarCoordenadas] = React.useState(
    Boolean(valoresIniciales?.latitud || valoresIniciales?.longitud),
  )

  // Calle + ciudad + provincia combinadas (Sprint 16, tarea 16.1): mismo
  // armado que usa el deep link de "Cómo llegar" en pantalla
  // (`lib/ubicacion/formato.ts#direccionCompleta`), para que la búsqueda que
  // se pre-carga en Google Maps apunte a la localidad correcta y no solo a la
  // calle.
  const direccionParaMaps = direccionCompleta({
    direccion: lugarDireccion,
    ciudad: lugarCiudad,
    provincia: lugarProvincia,
  })
  const urlMaps = direccionParaMaps
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionParaMaps)}`
    : "https://www.google.com/maps"

  function elegirMedicoDelDirectorio(valor: string | null) {
    if (!valor || valor === SENTINEL_NINGUN_MEDICO) {
      setDoctorId("")
      return
    }

    const doctor = medicos.find((candidato) => candidato.id === valor)
    if (!doctor) return

    setDoctorId(doctor.id)

    // Ver el criterio completo en el comentario de cabecera del archivo y en
    // `lib/turnos/autocompletar-medico.ts`: cada campo se completa SOLO si
    // está vacío en este momento, nunca pisa lo que la persona ya escribió.
    const cambios = camposAutocompletadosDesdeMedico(doctor, {
      medico,
      especialidad,
      lugarNombre,
      lugarDireccion,
      lugarCiudad,
      lugarProvincia,
      latitud,
      longitud,
    })

    if (cambios.medico !== undefined) setMedico(cambios.medico)
    if (cambios.especialidad !== undefined) setEspecialidad(cambios.especialidad)
    if (cambios.lugarNombre !== undefined) setLugarNombre(cambios.lugarNombre)
    if (cambios.lugarDireccion !== undefined) setLugarDireccion(cambios.lugarDireccion)
    if (cambios.lugarCiudad !== undefined) setLugarCiudad(cambios.lugarCiudad)
    if (cambios.lugarProvincia !== undefined) setLugarProvincia(cambios.lugarProvincia)
    if (cambios.latitud !== undefined && cambios.longitud !== undefined) {
      setLatitud(cambios.latitud)
      setLongitud(cambios.longitud)
      setMostrarCoordenadas(true)
    }
  }

  return (
    <form id={ID_FORMULARIO} action={enviarAccion} className="flex flex-col gap-5">
      {modo === "editar" && turnoId && <input type="hidden" name="turnoId" value={turnoId} />}
      <input type="hidden" name="doctorId" value={doctorId} />

      {/*
        Chica (Sprint 13, tarea 13.4): "Especialidad" y el `<Select>` de
        "Médico (opcional)" -cuando hay directorio cargado- pasan a una
        grilla de 2 columnas. Son DOS elementos consecutivos en el DOM (el
        `<Select>` ya venía justo después de "Especialidad"), así que
        ponerlos lado a lado con CSS Grid no reordena nada: el orden de
        lectura de un lector de pantalla sigue siendo el mismo que el orden
        visual (fila 1: especialidad, médico). El grid solo se activa cuando
        existe el `<Select>` -sin directorio, "Especialidad" sigue sola a
        ancho completo, en los dos modos-, y el campo "Médico" de texto
        libre (más abajo, para carga manual) se queda fuera de esta grilla:
        pairarlo también exigiría mover el `<Select>` de lugar, cosa que
        cambiaría el orden en TODOS los modos, no solo en chica.
      */}
      <div
        className={cn(
          "flex flex-col gap-5",
          medicos.length > 0 && "chica:grid chica:grid-cols-2 chica:items-start chica:gap-3",
        )}
      >
        <CampoAutocompletar
          id="especialidad"
          label="Especialidad"
          required
          maxLength={100}
          value={especialidad}
          onChange={setEspecialidad}
          opciones={CATALOGO_ESPECIALIDADES}
          ayuda="Empezá a escribir para ver sugerencias (ej: Cardiología, Clínica Médica, Oftalmología)."
        />

        {medicos.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="medico-directorio-trigger">Médico (opcional)</Label>
            <Select
              items={[
                { value: SENTINEL_NINGUN_MEDICO, label: "Ninguno" },
                ...medicos.map((doctor) => ({ value: doctor.id, label: doctor.full_name })),
              ]}
              value={doctorId || SENTINEL_NINGUN_MEDICO}
              onValueChange={elegirMedicoDelDirectorio}
            >
              <SelectTrigger id="medico-directorio-trigger" className="w-full">
                <SelectValue placeholder="Elegir un médico de tu directorio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SENTINEL_NINGUN_MEDICO}>Ninguno</SelectItem>
                {medicos.map((doctor) => (
                  <SelectItem key={doctor.id} value={doctor.id}>
                    {doctor.full_name}
                    {doctor.specialties.length > 0 ? ` — ${doctor.specialties.join(" · ")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground chica:hidden">
              Completa lo que esté vacío (nombre, especialidad, lugar y coordenadas si el médico las
              tiene cargadas). No pisa lo que ya escribiste.
            </p>
          </div>
        )}
      </div>

      <CampoTexto
        id="medico"
        label="Médico"
        maxLength={150}
        value={medico}
        onChange={(evento) => setMedico(evento.target.value)}
        ayuda="Opcional. Podés elegirlo de tu directorio arriba o escribirlo directo."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
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
        value={lugarNombre}
        onChange={(evento) => setLugarNombre(evento.target.value)}
        ayuda="Nombre de la clínica o el consultorio (opcional)."
      />

      <CampoTexto
        id="lugarDireccion"
        label="Dirección"
        maxLength={300}
        value={lugarDireccion}
        onChange={(evento) => setLugarDireccion(evento.target.value)}
        ayuda="Calle y altura (opcional)."
      />

      {/*
        Ciudad + provincia (Sprint 16, tarea 16.1): en una grilla de 2
        columnas, mismo criterio que fecha/hora de arriba -son dos campos
        cortos y relacionados-. Sin esto, la geocodificación y "Cómo llegar"
        no tenían de dónde sacar una localidad real y terminaban asumiendo
        Ushuaia (ver el comentario de cabecera del archivo).
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
        <CampoTexto
          id="lugarCiudad"
          label="Ciudad"
          maxLength={100}
          value={lugarCiudad}
          onChange={(evento) => setLugarCiudad(evento.target.value)}
          ayuda="Ej: La Plata, CABA, Ushuaia (opcional)."
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="lugarProvincia-trigger">Provincia</Label>
          <Select
            items={OPCIONES_PROVINCIA}
            value={lugarProvincia || ""}
            onValueChange={(valor) => setLugarProvincia(String(valor ?? ""))}
          >
            <SelectTrigger id="lugarProvincia-trigger" className="w-full">
              <SelectValue placeholder="Sin especificar" />
            </SelectTrigger>
            <SelectContent>
              {OPCIONES_PROVINCIA.map((opcion) => (
                <SelectItem key={opcion.value || "sin-especificar"} value={opcion.value}>
                  {opcion.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* El valor real que lee la Server Action: el `<Select>` es pura UI, mismo patrón que `doctorId` más arriba y que `formulario-sos.tsx#grupoSanguineo`. */}
          <input type="hidden" name="lugarProvincia" value={lugarProvincia} />
        </div>
      </div>

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
              Buscá el lugar, mantené el dedo (o el clic) sobre el punto en el mapa y copiá los
              números que aparecen. Pegalos acá abajo.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
              <CampoNumero
                id="latitud"
                label="Latitud"
                decimal
                permiteNegativo
                value={latitud}
                onChange={(evento) => setLatitud(evento.target.value)}
                ayuda="Ej: -54.8083"
              />
              <CampoNumero
                id="longitud"
                label="Longitud"
                decimal
                permiteNegativo
                value={longitud}
                onChange={(evento) => setLongitud(evento.target.value)}
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
