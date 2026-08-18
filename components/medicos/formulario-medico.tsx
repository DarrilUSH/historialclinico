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
 * documenta `campo-numero.tsx#permiteNegativo`-. Desde el Sprint 16 (tarea
 * 16.1) también hay un intento automático de geocodificación con Nominatim
 * del lado del servidor si esta persona no pega coordenadas a mano
 * (`lib/ubicacion/geocodificacion.ts`).
 *
 * ## Ciudad y provincia (Sprint 16, tarea 16.1)
 *
 * Mismo criterio que `components/turnos/formulario-turno.tsx`: campos
 * propios -no parte de "Dirección"- para que la geocodificación y "Cómo
 * llegar" puedan armar calle + ciudad + provincia + Argentina en vez de
 * asumir una localidad fija (el bug de Ushuaia que reportó el usuario).
 * "Ciudad" es texto libre, "Provincia" un `<Select>` con las 24
 * jurisdicciones (`lib/ubicacion/provincias.ts`), precargados en
 * `/medicos/nuevo` con la última ciudad/provincia usada por el perfil
 * (`lib/ubicacion/ultima-usada.ts`) como sugerencia editable.
 *
 * ## Varias especialidades, como chips (Sprint 16, tarea 16.2)
 *
 * "Especialidad" (un solo texto) se reemplaza por "Especialidades": cero o
 * más, cargadas como chips -mismo patrón que las tres listas de
 * `components/sos/formulario-sos.tsx#CampoLista` (campo de "borrador" +
 * "Agregar", cada chip viaja como su propio `<input type="hidden"
 * name="especialidades">`, así que `formData.getAll("especialidades")` del
 * lado del servidor da directamente el array)-. La diferencia con
 * `CampoLista` es el campo de borrador: acá es un `CampoAutocompletar`
 * (`components/ui/autocomplete.tsx`) que sugiere del catálogo curado
 * (`lib/especialidades/catalogo.ts`) a medida que se tipea, insensible a
 * tildes/mayúsculas. Elegir una sugerencia (clic o flechas+Enter) agrega el
 * chip DE UNA -no hace falta un segundo toque en "Agregar"-: ver
 * `CampoEspecialidades` más abajo para el detalle de cómo se distingue
 * "elegí una sugerencia" de "tipeé texto libre y apreté Enter" sin pisar el
 * manejo de teclado propio de `@base-ui/react`.
 *
 * La PRIMERA especialidad de la lista es la "principal":
 * `lib/turnos/autocompletar-medico.ts` la usa para precargar
 * `appointments.specialty` al elegir este médico en un turno, y
 * `components/medicos/tarjeta-medico.tsx` las muestra todas en ese mismo
 * orden. No hay forma de reordenar los chips ya cargados -sin sobre-
 * ingeniería para una app familiar: si la principal cambió, es más simple
 * quitarla y volver a agregarla primero que sumar drag-and-drop-.
 */

import * as React from "react"
import { useActionState } from "react"

import { MapPinnedIcon, PlusIcon, SaveIcon, StethoscopeIcon, UserPlusIcon, XIcon } from "lucide-react"

import { actualizarMedico, crearMedico, type EstadoMedicoAccion } from "@/app/(app)/(con-nav)/medicos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoNumero } from "@/components/base/campo-numero"
import { CampoTexto } from "@/components/base/campo-texto"
import { CampoTextarea } from "@/components/base/campo-textarea"
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@/components/ui/autocomplete"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CATALOGO_ESPECIALIDADES,
  MAX_ESPECIALIDADES_POR_MEDICO,
  MAX_LARGO_ESPECIALIDAD,
} from "@/lib/especialidades/catalogo"
import { especialidadCoincide } from "@/lib/especialidades/coincidencias"
import { direccionCompleta } from "@/lib/ubicacion/formato"
import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"
import { cn } from "@/lib/utils"

/** Opciones del `<Select>` de provincia: calcado de `formulario-turno.tsx`. */
const OPCIONES_PROVINCIA: { value: string; label: string }[] = [
  { value: "", label: "Sin especificar" },
  ...PROVINCIAS_ARGENTINAS.map((provincia) => ({ value: provincia, label: provincia })),
]

export interface ValoresMedico {
  nombre: string
  /** Sprint 16, tarea 16.2: cero o más, la primera es la principal. */
  especialidades: string[]
  matricula: string
  institucion: string
  telefono: string
  direccion: string
  /** Sprint 16, tarea 16.1. */
  ciudad: string
  provincia: string
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

  const [especialidades, setEspecialidades] = React.useState(valoresIniciales?.especialidades ?? [])
  const [direccion, setDireccion] = React.useState(valoresIniciales?.direccion ?? "")
  const [ciudad, setCiudad] = React.useState(valoresIniciales?.ciudad ?? "")
  const [provincia, setProvincia] = React.useState(valoresIniciales?.provincia ?? "")
  const [mostrarCoordenadas, setMostrarCoordenadas] = React.useState(
    Boolean(valoresIniciales?.latitud || valoresIniciales?.longitud),
  )

  // Calle + ciudad + provincia combinadas (Sprint 16, tarea 16.1): mismo
  // armado que `formulario-turno.tsx` y que el deep link de "Cómo llegar" en
  // pantalla (`lib/ubicacion/formato.ts#direccionCompleta`).
  const direccionParaMaps = direccionCompleta({ direccion, ciudad, provincia })
  const urlMaps = direccionParaMaps
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccionParaMaps)}`
    : "https://www.google.com/maps"

  return (
    <form action={enviarAccion} className="flex flex-col gap-5">
      {modo === "editar" && medicoId && <input type="hidden" name="medicoId" value={medicoId} />}

      <CampoTexto
        id="nombre"
        label="Nombre del médico"
        required
        maxLength={200}
        defaultValue={valoresIniciales?.nombre}
        ayuda='Con el tratamiento que uses. Ej: "Dr. Carlos Rodríguez".'
      />

      <CampoEspecialidades valores={especialidades} onCambiar={setEspecialidades} />

      {/*
        Chica (Sprint 13, tarea 13.5): "Matrícula" + "Institución" pasan a
        una grilla de 2 columnas -son elementos consecutivos en el DOM, así
        que no hay reordenamiento, mismo criterio que la grilla de dosis de
        `formulario-medicacion.tsx`-.
      */}
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

      {/* Ciudad + provincia (Sprint 16, tarea 16.1): calcado de `formulario-turno.tsx`. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
        <CampoTexto
          id="ciudad"
          label="Ciudad"
          maxLength={100}
          value={ciudad}
          onChange={(evento) => setCiudad(evento.target.value)}
          ayuda="Ej: La Plata, CABA, Ushuaia (opcional)."
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="provincia-trigger">Provincia</Label>
          <Select
            items={OPCIONES_PROVINCIA}
            value={provincia || ""}
            onValueChange={(valor) => setProvincia(String(valor ?? ""))}
          >
            <SelectTrigger id="provincia-trigger" className="w-full">
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
          <input type="hidden" name="provincia" value={provincia} />
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

/**
 * Chips de especialidades con autocompletar (Sprint 16, tarea 16.2). Mismo
 * esqueleto que `CampoLista` de `components/sos/formulario-sos.tsx`: campo de
 * "borrador" + "Agregar" arma la lista, cada entrada es un chip removible,
 * cada chip viaja como su propio `<input type="hidden" name="especialidades">`.
 * El campo de borrador NO tiene `name` -si lo tuviera, lo tecleado sin
 * confirmar viajaría como un valor más-.
 *
 * ## Elegir una sugerencia agrega el chip DE UNA
 *
 * A diferencia de `CampoLista` (un `<input>` común), acá el borrador es un
 * `Autocomplete` de `components/ui/autocomplete.tsx`. Elegir una sugerencia
 * -clic, o flecha hasta resaltarla y Enter- dispara `onValueChange` con
 * `eventDetails.reason === "item-press"` (mismo motivo para las dos formas de
 * elegir: `@base-ui/react` simula un clic sobre el ítem resaltado al apretar
 * Enter, así que las dos rutas terminan en el mismo evento). Se aprovecha
 * ese `reason` para agregar el chip inmediatamente, sin depender de un
 * segundo toque en "Agregar" -mejor para dedos, criterio de la tarea-.
 *
 * ## El Enter "libre" NO se intercepta cuando hay una sugerencia resaltada
 *
 * Si nada está resaltado, Enter en el campo de borrador confirma lo tecleado
 * como chip -mismo comportamiento que `CampoLista`, con `preventDefault()`
 * para que no dispare el submit del formulario entero, que no tiene `name`
 * este campo así que sin este freno la persona perdería el borrador-. Si
 * SÍ hay una sugerencia resaltada, no se hace nada acá: `@base-ui/react` ya
 * previene el submit y resuelve la selección por su cuenta (que termina
 * agregando el chip por el camino de arriba). Cuál de los dos casos aplica
 * se sigue con un `ref` -no `state`- alimentado por `onItemHighlighted`,
 * así el valor está disponible de forma síncrona dentro del handler de
 * teclado sin esperar un re-render.
 */
function CampoEspecialidades({
  valores,
  onCambiar,
}: {
  valores: string[]
  onCambiar: (valores: string[]) => void
}) {
  const [borrador, setBorrador] = React.useState("")
  const resaltadaRef = React.useRef<string | undefined>(undefined)
  const campoRef = React.useRef<HTMLInputElement | null>(null)

  const limpio = borrador.trim()
  const yaEsta = valores.some(
    (valor) => valor.toLocaleLowerCase("es-AR") === limpio.toLocaleLowerCase("es-AR"),
  )
  const lleno = valores.length >= MAX_ESPECIALIDADES_POR_MEDICO
  const puedeAgregar = limpio.length > 0 && !yaEsta && !lleno

  function agregar(valor: string) {
    const texto = valor.trim()
    if (texto.length === 0 || valores.length >= MAX_ESPECIALIDADES_POR_MEDICO) {
      return
    }
    if (valores.some((v) => v.toLocaleLowerCase("es-AR") === texto.toLocaleLowerCase("es-AR"))) {
      // Ya estaba cargada: no duplica, pero igual limpia el borrador -mismo
      // resultado que la persona espera al "confirmar" una especialidad ya
      // agregada-.
      setBorrador("")
      return
    }
    onCambiar([...valores, texto])
    setBorrador("")
    campoRef.current?.focus()
  }

  function quitar(valor: string) {
    onCambiar(valores.filter((v) => v !== valor))
    campoRef.current?.focus()
  }

  return (
    <div className="flex flex-col gap-2 chica:gap-1.5">
      <Label htmlFor="especialidades-nuevo">Especialidades</Label>

      <div className="flex items-center gap-2 chica:gap-1.5">
        <div className="flex-1">
          <Autocomplete
            items={CATALOGO_ESPECIALIDADES}
            value={borrador}
            onValueChange={(valor, detalles) => {
              setBorrador(valor)
              if (detalles.reason === "item-press") {
                agregar(valor)
              }
            }}
            onItemHighlighted={(valor) => {
              resaltadaRef.current = valor
            }}
            filter={especialidadCoincide}
            openOnInputClick
          >
            <AutocompleteInputGroup>
              <AutocompleteInput
                id="especialidades-nuevo"
                ref={campoRef}
                maxLength={MAX_LARGO_ESPECIALIDAD}
                placeholder='Ej: "Cardiología"'
                autoComplete="off"
                aria-describedby="especialidades-ayuda"
                onKeyDown={(evento) => {
                  if (evento.key === "Enter" && resaltadaRef.current === undefined) {
                    evento.preventDefault()
                    agregar(borrador)
                  }
                }}
              />
            </AutocompleteInputGroup>
            <AutocompletePopup>
              <AutocompleteEmpty>
                Sin coincidencias en el catálogo — &quot;Agregar&quot; la carga igual.
              </AutocompleteEmpty>
              <AutocompleteList>
                {(opcion: string) => (
                  <AutocompleteItem key={opcion} value={opcion}>
                    {opcion}
                  </AutocompleteItem>
                )}
              </AutocompleteList>
            </AutocompletePopup>
          </Autocomplete>
        </div>
        <Boton type="button" variant="outline" size="lg" onClick={() => agregar(borrador)} disabled={!puedeAgregar}>
          <PlusIcon aria-hidden="true" />
          Agregar
        </Boton>
      </div>

      {/* La ayuda pura se oculta en chica (regla del rediseño compacto); el
          aviso de "llegaste al máximo" NO -es la explicación de por qué
          "Agregar" está deshabilitado, no una guía de contexto-, mismo
          criterio que `CampoLista` en `formulario-sos.tsx`. */}
      <p
        id="especialidades-ayuda"
        className={cn("text-sm text-muted-foreground", !lleno && "chica:hidden")}
      >
        {lleno
          ? `Llegaste al máximo de ${MAX_ESPECIALIDADES_POR_MEDICO} especialidades.`
          : "Opcional. La primera que cargues queda como principal."}
      </p>

      {valores.length > 0 ? (
        <ul className="flex flex-wrap gap-2 chica:gap-1.5">
          {valores.map((valor) => (
            <li key={valor}>
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1.5 pr-1.5 pl-3.5 text-base font-medium text-primary chica:py-1 chica:pl-3 chica:text-sm">
                <span className="min-w-0 break-words">{valor}</span>
                <input type="hidden" name="especialidades" value={valor} />
                {/* `size-9` (40px en grande) en vez de `size-6`: mismo
                    criterio que los chips de `formulario-sos.tsx`. Chica:
                    `size-9` computa por debajo del piso táctil con la escala
                    compacta, así que se fija en `chica:size-10` (40px
                    exacto). */}
                <button
                  type="button"
                  onClick={() => quitar(valor)}
                  aria-label={`Quitar ${valor} de especialidades`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none chica:size-10"
                >
                  <XIcon className="size-4.5 chica:size-4" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <StethoscopeIcon className="size-4 shrink-0" aria-hidden="true" />
          Sin especialidades cargadas todavía.
        </p>
      )}
    </div>
  )
}
