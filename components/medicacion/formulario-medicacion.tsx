"use client"

/**
 * Formulario de alta y edición de medicación (Sprint 7, tarea 7.2). Mismo
 * criterio que `components/turnos/formulario-turno.tsx`: un solo componente
 * para `/medicacion/nuevo` y `/medicacion/[id]/editar`, `modo` decide la
 * Server Action (`crearMedicacion` vs. `actualizarMedicacion`) y si viaja
 * `medicacionId`.
 *
 * ## Horarios: chips, no free text
 *
 * Criterio de aceptación del ROADMAP: "horarios múltiples (chips de hora, no
 * un free text)". `CampoHorarios` de abajo junta un `<input type="time">`
 * nativo (teclado/selector propio del sistema operativo, sin ambigüedad de
 * formato) + botón "Agregar", y cada horario agregado es un chip removible.
 * Cada chip viaja como su propio `<input type="hidden" name="horarios">`, así
 * que del lado del servidor `formData.getAll("horarios")` da directamente el
 * array que espera `lib/validacion/medicacion.schema.ts`.
 *
 * ## Frecuencia: tres campos condicionales, un solo esquema válido
 *
 * `frecuencia` decide qué se muestra -horarios para `daily`, un intervalo en
 * horas para `interval_hours`, nada para `as_needed`- calcando el CHECK
 * `medications_esquema_coherente` de la base (ver el schema Zod). Cambiar de
 * frecuencia limpia lo que ya no aplica para no arrastrar un valor viejo que
 * el servidor tendría que rechazar.
 *
 * ## `presentacion` y `dosisUnidad`: texto libre, no un `<Select>`
 *
 * `medications.presentation` y `.dose_unit` son columnas `text` sin `CHECK`
 * de valores (ver el comentario de la tabla en
 * `supabase/migrations/20260812200000_schema_inicial.sql` §4.7: "las
 * presentaciones reales... cambian más rápido de lo que conviene migrar un
 * tipo"). Un `<Select>` fijo perdería presentaciones reales como
 * "Comprimidos 850 mg" (concentración incluida, como carga el seed) o
 * "unidades de insulina". Se dejan como campos de texto con ejemplos en la
 * ayuda, mismo criterio que `especialidad`/`médico` en el formulario de
 * turnos.
 */

import * as React from "react"
import { useActionState } from "react"

import { CalendarPlusIcon, PlusIcon, PillIcon, SaveIcon, XIcon } from "lucide-react"

import {
  actualizarMedicacion,
  crearMedicacion,
  type EstadoMedicacionAccion,
} from "@/app/(app)/(con-nav)/medicacion/actions"
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

export type FrecuenciaMedicacion = "daily" | "interval_hours" | "as_needed"

const OPCIONES_FRECUENCIA: { value: FrecuenciaMedicacion; label: string }[] = [
  { value: "daily", label: "Todos los días, a horarios fijos" },
  { value: "interval_hours", label: "Cada N horas" },
  { value: "as_needed", label: "Cuando lo necesite (a demanda)" },
]

export interface ValoresMedicacion {
  nombre: string
  droga: string
  presentacion: string
  dosisCantidad: string
  dosisUnidad: string
  frecuencia: FrecuenciaMedicacion
  horarios: string[]
  intervaloHoras: string
  fechaInicio: string
  fechaFin: string
  stock: string
  notas: string
}

export interface FormularioMedicacionProps {
  modo: "crear" | "editar"
  /** Obligatorio cuando `modo === "editar"`: viaja como campo oculto para que `actualizarMedicacion` sepa qué fila tocar. */
  medicacionId?: string
  valoresIniciales?: Partial<ValoresMedicacion>
}

const ESTADO_INICIAL: EstadoMedicacionAccion = { error: null }

export function FormularioMedicacion({
  modo,
  medicacionId,
  valoresIniciales,
}: FormularioMedicacionProps) {
  const accion = modo === "crear" ? crearMedicacion : actualizarMedicacion
  const [estado, enviarAccion, pendiente] = useActionState(accion, ESTADO_INICIAL)

  const [frecuencia, setFrecuencia] = React.useState<FrecuenciaMedicacion>(
    valoresIniciales?.frecuencia ?? "daily",
  )
  const [horarios, setHorarios] = React.useState<string[]>(valoresIniciales?.horarios ?? [])

  return (
    <form action={enviarAccion} className="flex flex-col gap-5">
      {modo === "editar" && medicacionId && (
        <input type="hidden" name="medicacionId" value={medicacionId} />
      )}

      <CampoTexto
        id="nombre"
        label="Nombre comercial"
        required
        maxLength={200}
        defaultValue={valoresIniciales?.nombre}
        ayuda='Tal como figura en la caja. Ej: "Glucophage".'
      />

      <CampoTexto
        id="droga"
        label="Droga / principio activo"
        maxLength={150}
        defaultValue={valoresIniciales?.droga}
        ayuda='Opcional. Ej: "Metformina". Ayuda a detectar duplicados entre marcas.'
      />

      <CampoTexto
        id="presentacion"
        label="Presentación"
        maxLength={150}
        defaultValue={valoresIniciales?.presentacion}
        ayuda='Opcional. Ej: "Comprimidos 850 mg", "Solución 100 mg/ml".'
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CampoNumero
          id="dosisCantidad"
          label="Dosis por toma"
          required
          decimal
          defaultValue={valoresIniciales?.dosisCantidad}
          ayuda="Cantidad en cada toma."
        />
        <CampoTexto
          id="dosisUnidad"
          label="Unidad"
          required
          maxLength={40}
          defaultValue={valoresIniciales?.dosisUnidad ?? "comprimido"}
          ayuda="Comprimido, ml, gotas, puff..."
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="frecuencia-trigger">Frecuencia</Label>
        <Select
          items={OPCIONES_FRECUENCIA}
          value={frecuencia}
          onValueChange={(valor) => setFrecuencia(valor as FrecuenciaMedicacion)}
        >
          <SelectTrigger id="frecuencia-trigger" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_FRECUENCIA.map((opcion) => (
              <SelectItem key={opcion.value} value={opcion.value}>
                {opcion.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* El valor real que lee `crearMedicacion`/`actualizarMedicacion`: el `<Select>` de arriba es pura UI. */}
        <input type="hidden" name="frecuencia" value={frecuencia} />
      </div>

      {frecuencia === "daily" && (
        <CampoHorarios horarios={horarios} onCambiar={setHorarios} />
      )}

      {frecuencia === "interval_hours" && (
        <CampoNumero
          id="intervaloHoras"
          label="Cada cuántas horas"
          required
          defaultValue={valoresIniciales?.intervaloHoras}
          sufijo="hs"
          ayuda="De 1 a 24."
        />
      )}

      {frecuencia === "as_needed" && (
        <Alerta variante="info" estatica>
          No se programan tomas fijas: se registra cada vez que se toma, desde la pantalla de
          tomas del día.
        </Alerta>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CampoTexto
          id="fechaInicio"
          label="Fecha de inicio"
          type="date"
          required
          defaultValue={valoresIniciales?.fechaInicio}
        />
        <CampoTexto
          id="fechaFin"
          label="Fecha de fin"
          type="date"
          defaultValue={valoresIniciales?.fechaFin}
          ayuda="Opcional. Dejar vacío si el tratamiento no tiene fecha de fin."
        />
      </div>

      <CampoNumero
        id="stock"
        label="Stock inicial"
        decimal
        defaultValue={valoresIniciales?.stock}
        sufijo={valoresIniciales?.dosisUnidad}
        ayuda="Opcional. Unidades disponibles ahora mismo — es lo que permite calcular cuántos días quedan."
      />

      <CampoTextarea
        id="notas"
        label="Notas"
        rows={3}
        maxLength={2000}
        conDictado
        defaultValue={valoresIniciales?.notas}
        ayuda="Indicaciones del médico, con qué tomarlo, etc. (opcional)."
      />

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <Boton type="submit" size="lg" cargando={pendiente}>
        {modo === "crear" ? <CalendarPlusIcon aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
        {modo === "crear" ? "Guardar medicación" : "Guardar cambios"}
      </Boton>
    </form>
  )
}

/**
 * Chips de horario: `<input type="time">` + "Agregar" arma la lista;
 * cada chip es removible y viaja como su propio hidden `name="horarios"`
 * (ver el comentario de cabecera del archivo).
 */
function CampoHorarios({
  horarios,
  onCambiar,
}: {
  horarios: string[]
  onCambiar: (horarios: string[]) => void
}) {
  const [horaNueva, setHoraNueva] = React.useState("")

  // Sprint 11 (auditoría a11y): agregar un chip deja "Agregar" deshabilitado
  // -ya no hay hora que agregar-, y un botón deshabilitado NO puede conservar
  // el foco: el navegador lo manda al <body>, o sea al principio del
  // documento. Alguien que carga tres horarios con el teclado tenía que
  // volver a tabular todo el formulario entre horario y horario. Se devuelve
  // el foco al campo de hora, que es exactamente donde sigue la tarea.
  const campoHoraRef = React.useRef<HTMLInputElement | null>(null)

  /**
   * Devuelve el foco al campo de hora dejándolo listo para tipear.
   *
   * `<input type="time">` no es un campo de texto: Chromium le maneja
   * segmentos internos (hora / minuto) y los dígitos entran en el segmento
   * ACTIVO. Después de agregar un horario el foco nunca salió del campo -Enter
   * se maneja acá con `preventDefault`-, así que un `focus()` a secas es un
   * no-op: el puntero de segmento se queda donde terminó, en los minutos.
   * Resultado medido en la auditoría: tipear "2000" llenaba minutos dos veces,
   * la hora quedaba vacía y, como un `input[type=time]` solo reporta `value`
   * con TODOS los segmentos completos, el campo devolvía `""` y "Agregar" no
   * hacía nada. El segundo horario era imposible de cargar con el teclado.
   *
   * `blur()` + `focus()` fuerza a Chromium a reseleccionar el primer segmento
   * (verificado: con reset "2000" da "20:00"; sin reset da ""). Va dentro de
   * un `requestAnimationFrame` para correr después de que React aplicó el
   * `value=""`, igual que el patrón de dictado de
   * `components/base/campo-texto.tsx`.
   */
  function devolverFocoAlCampo() {
    requestAnimationFrame(() => {
      const campo = campoHoraRef.current
      if (!campo) return
      campo.blur()
      campo.focus()
    })
  }

  function agregar() {
    if (!horaNueva) return
    if (horarios.includes(horaNueva)) {
      setHoraNueva("")
      devolverFocoAlCampo()
      return
    }
    onCambiar([...horarios, horaNueva].sort())
    setHoraNueva("")
    devolverFocoAlCampo()
  }

  function quitar(hora: string) {
    onCambiar(horarios.filter((h) => h !== hora))
    // El botón que se acaba de tocar desaparece del DOM con su chip: sin esto
    // el foco cae al <body> igual que arriba.
    devolverFocoAlCampo()
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="horario-nuevo">Horarios</Label>

      <div className="flex items-center gap-2">
        <input
          id="horario-nuevo"
          ref={campoHoraRef}
          type="time"
          value={horaNueva}
          onChange={(evento) => setHoraNueva(evento.target.value)}
          // Enter dentro de un campo de un <form> dispara el submit implícito:
          // sin esto, escribir "08:00" y apretar Enter -el gesto natural- NO
          // agregaba el horario, intentaba guardar la medicación entera. Mismo
          // manejador que ya usaba `components/sos/formulario-sos.tsx`.
          onKeyDown={(evento) => {
            if (evento.key === "Enter") {
              evento.preventDefault()
              agregar()
            }
          }}
          className="min-h-tactil flex-1 rounded-lg border border-input bg-transparent px-3.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Boton type="button" variant="outline" size="lg" onClick={agregar} disabled={!horaNueva}>
          <PlusIcon aria-hidden="true" />
          Agregar
        </Boton>
      </div>

      {horarios.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {horarios.map((hora) => (
            <li key={hora}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 py-1.5 pr-1.5 pl-3.5 text-base font-medium text-primary">
                {hora}
                <input type="hidden" name="horarios" value={hora} />
                {/* `size-9` (40px) en vez de `size-6` (27px): el aspa medía
                    menos que el mínimo táctil y es el control que más se falla
                    con temblor o dedo grueso. El chip crece apenas porque el
                    padding derecho baja de `pr-2` a `pr-1.5`. */}
                <button
                  type="button"
                  onClick={() => quitar(hora)}
                  aria-label={`Quitar el horario ${hora}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <XIcon className="size-4.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <PillIcon className="size-4 shrink-0" aria-hidden="true" />
          Todavía no agregaste ningún horario.
        </p>
      )}
    </div>
  )
}
