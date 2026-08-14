"use client"

/**
 * Formulario de edición de la ficha SOS del perfil activo (Sprint 8, tarea
 * 8.2). Contrato del modelo: `docs/modelo-sos.md`. Validación espejo:
 * `lib/validacion/sos.schema.ts`.
 *
 * A diferencia de `formulario-medicacion.tsx` o `formulario-turno.tsx`, acá
 * NO hay `modo` "crear" / "editar": la ficha SOS **siempre existe** —son
 * columnas de la fila de `profiles`, que ya está— y lo único que se hace es
 * editarla. Guardar una ficha entera en blanco es una operación legítima
 * (vaciar un dato que dejó de ser cierto), no un error de validación.
 *
 * ## Las tres listas son chips, igual que los horarios de medicación
 *
 * `CampoLista` de abajo es el mismo patrón que `CampoHorarios`
 * (`components/medicacion/formulario-medicacion.tsx`): un campo de texto +
 * "Agregar" arma la lista, cada entrada es un chip removible, y cada chip
 * viaja como su propio `<input type="hidden">` con el mismo `name`, así que
 * del lado del servidor `formData.getAll("alergias")` da directamente el
 * array que espera el schema. Lo que cambia es el control de entrada: un
 * `<input type="text">` en vez de un `type="time"`, porque acá el contenido
 * es texto libre en español —con tildes y ñ, que viajan intactas de punta a
 * punta—.
 *
 * **Por qué chips y no un textarea con comas:** "Alergia a la penicilina,
 * con shock anafiláctico" es UNA alergia. Partir por comas la convertiría en
 * dos entradas falsas, y en una ficha que lee un paramédico apurado esa
 * diferencia importa. El chip obliga a decidir dónde termina cada ítem en el
 * momento de cargarlo, no cuando ya es tarde.
 *
 * ## Grupo sanguíneo: los 8 valores del CHECK, más "No lo sé"
 *
 * El desplegable ofrece exactamente los ocho valores de
 * `profiles_blood_type_valido` (importados de `sos.schema.ts`, una sola
 * fuente) más "No lo sé", que manda cadena vacía y termina siendo `NULL`.
 * "No lo sé" NO es un valor de relleno: es información real —la ficha lo
 * muestra como desconocido en vez de un grupo que nadie confirmó—.
 */

import * as React from "react"
import { useActionState } from "react"

import { HeartPulseIcon, PlusIcon, SaveIcon, XIcon } from "lucide-react"

import {
  guardarFichaSos,
  type EstadoSosAccion,
} from "@/app/(app)/(con-nav)/perfil/sos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { CampoTextarea } from "@/components/base/campo-textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  GRUPOS_SANGUINEOS,
  MAX_ITEMS_LISTA,
  MAX_LARGO_ITEM,
  MAX_LARGO_NOTAS,
  MAX_LARGO_TELEFONO,
} from "@/lib/validacion/sos.schema"

/**
 * Valor del desplegable que representa "no lo sé". Se traduce a cadena vacía
 * en el `<input type="hidden">` que lee la Server Action: el schema solo
 * conoce los ocho valores del CHECK y `""`, nunca este centinela de interfaz.
 */
const SIN_GRUPO = "desconocido"

const OPCIONES_GRUPO: { value: string; label: string }[] = [
  { value: SIN_GRUPO, label: "No lo sé" },
  ...GRUPOS_SANGUINEOS.map((grupo) => ({ value: grupo, label: grupo })),
]

export interface ValoresSos {
  grupoSanguineo: string
  alergias: string[]
  condicionesCronicas: string[]
  medicacionCritica: string[]
  contactoNombre: string
  contactoTelefono: string
  contactoVinculo: string
  notas: string
}

export interface FormularioSosProps {
  valoresIniciales: ValoresSos
}

const ESTADO_INICIAL: EstadoSosAccion = { error: null }

export function FormularioSos({ valoresIniciales }: FormularioSosProps) {
  const [estado, enviarAccion, pendiente] = useActionState(guardarFichaSos, ESTADO_INICIAL)

  const [grupo, setGrupo] = React.useState<string>(
    valoresIniciales.grupoSanguineo || SIN_GRUPO,
  )
  const [alergias, setAlergias] = React.useState<string[]>(valoresIniciales.alergias)
  const [condiciones, setCondiciones] = React.useState<string[]>(
    valoresIniciales.condicionesCronicas,
  )
  const [medicacion, setMedicacion] = React.useState<string[]>(
    valoresIniciales.medicacionCritica,
  )

  return (
    <form action={enviarAccion} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="grupoSanguineo-trigger">Grupo y factor sanguíneo</Label>
        <Select items={OPCIONES_GRUPO} value={grupo} onValueChange={(valor) => setGrupo(String(valor))}>
          <SelectTrigger id="grupoSanguineo-trigger" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_GRUPO.map((opcion) => (
              <SelectItem key={opcion.value} value={opcion.value}>
                {opcion.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* El valor real que lee `guardarFichaSos`: el `<Select>` es pura UI. */}
        <input
          type="hidden"
          name="grupoSanguineo"
          value={grupo === SIN_GRUPO ? "" : grupo}
        />
        <p className="text-sm text-muted-foreground">
          Si no está confirmado por un análisis, dejá &quot;No lo sé&quot;: en una emergencia es
          preferible a un dato que nadie verificó.
        </p>
      </div>

      <CampoLista
        id="alergias"
        label="Alergias"
        valores={alergias}
        onCambiar={setAlergias}
        placeholder="Penicilina"
        ayuda="Medicamentos, alimentos, látex, picaduras. Una por entrada."
        textoVacio="Todavía no cargaste ninguna alergia."
      />

      <CampoLista
        id="condicionesCronicas"
        label="Enfermedades crónicas"
        valores={condiciones}
        onCambiar={setCondiciones}
        placeholder="Hipertensión arterial"
        ayuda="Diagnósticos que un médico de guardia necesita saber de entrada."
        textoVacio="Todavía no cargaste ninguna enfermedad crónica."
      />

      <CampoLista
        id="medicacionCritica"
        label="Medicación crítica"
        valores={medicacion}
        onCambiar={setMedicacion}
        placeholder="Anticoagulante — Acenocumarol 4 mg"
        ayuda="Solo lo que no se puede suspender ni ignorar: anticoagulantes, insulina, antiarrítmicos, corticoides."
        textoVacio="Todavía no cargaste ninguna medicación crítica."
      />

      <fieldset className="flex flex-col gap-4 rounded-xl border border-border p-4">
        <legend className="px-1 text-base font-semibold">Contacto de emergencia</legend>

        <CampoTexto
          id="contactoNombre"
          label="Nombre"
          maxLength={120}
          autoComplete="off"
          defaultValue={valoresIniciales.contactoNombre}
          ayuda="A quién llamar. Sin nombre, el teléfono no le sirve a nadie."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CampoTexto
            id="contactoTelefono"
            label="Teléfono"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={MAX_LARGO_TELEFONO}
            defaultValue={valoresIniciales.contactoTelefono}
            ayuda="Con característica. Ej: +54 9 2901 612345."
          />
          <CampoTexto
            id="contactoVinculo"
            label="Vínculo"
            maxLength={60}
            autoComplete="off"
            defaultValue={valoresIniciales.contactoVinculo}
            ayuda="Hija, esposo, vecina, cuidadora..."
          />
        </div>
      </fieldset>

      <CampoTextarea
        id="notas"
        label="Observaciones para el personal de emergencia"
        rows={4}
        maxLength={MAX_LARGO_NOTAS}
        conDictado
        defaultValue={valoresIniciales.notas}
        ayuda="Marcapasos, prótesis, idioma, dificultades para hablar, cualquier cosa que convenga saber antes de tocarlo."
      />

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <Boton type="submit" size="lg" cargando={pendiente}>
        <SaveIcon aria-hidden="true" />
        Guardar ficha SOS
      </Boton>
    </form>
  )
}

/**
 * Una de las tres listas SOS: campo de texto + "Agregar" arma la lista, cada
 * entrada es un chip removible, y cada chip viaja como su propio
 * `<input type="hidden" name={id}>` (ver el encabezado del archivo).
 *
 * El campo de entrada NO es parte del `FormData`: no tiene `name`, a
 * propósito. Si lo tuviera, lo que quedó escrito sin apretar "Agregar" se
 * enviaría como un valor más y aparecería en la ficha sin que nadie lo
 * hubiera confirmado.
 *
 * Enter agrega el ítem en vez de enviar el formulario entero: es el gesto
 * que espera cualquiera que esté cargando una lista, y sin esto una lista de
 * cinco alergias se guarda cinco veces a medio hacer.
 */
function CampoLista({
  id,
  label,
  valores,
  onCambiar,
  placeholder,
  ayuda,
  textoVacio,
}: {
  id: string
  label: string
  valores: string[]
  onCambiar: (valores: string[]) => void
  placeholder: string
  ayuda: string
  textoVacio: string
}) {
  const [borrador, setBorrador] = React.useState("")

  const limpio = borrador.trim()
  const yaEsta = valores.some(
    (valor) => valor.toLocaleLowerCase("es-AR") === limpio.toLocaleLowerCase("es-AR"),
  )
  const lleno = valores.length >= MAX_ITEMS_LISTA
  const puedeAgregar = limpio.length > 0 && !yaEsta && !lleno

  // Sprint 11 (auditoría a11y): al agregar, "Agregar" queda deshabilitado
  // -el borrador se vació- y un botón deshabilitado no retiene el foco; al
  // quitar, el aspa desaparece con su chip. En los dos casos el navegador
  // manda el foco al <body>, o sea al principio del documento. Se devuelve al
  // campo de texto, que es donde sigue la tarea. (Con Enter el foco ya se
  // quedaba en el campo; esto cubre el camino del botón y el del aspa.)
  const campoRef = React.useRef<HTMLInputElement | null>(null)

  function agregar() {
    if (!puedeAgregar) return
    onCambiar([...valores, limpio])
    setBorrador("")
    campoRef.current?.focus()
  }

  function quitar(valor: string) {
    onCambiar(valores.filter((v) => v !== valor))
    campoRef.current?.focus()
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-nuevo`}>{label}</Label>

      <div className="flex items-center gap-2">
        <Input
          id={`${id}-nuevo`}
          ref={campoRef}
          type="text"
          className="flex-1"
          value={borrador}
          maxLength={MAX_LARGO_ITEM}
          placeholder={placeholder}
          autoComplete="off"
          aria-describedby={`${id}-ayuda`}
          onChange={(evento) => setBorrador(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") {
              evento.preventDefault()
              agregar()
            }
          }}
        />
        <Boton type="button" variant="outline" size="lg" onClick={agregar} disabled={!puedeAgregar}>
          <PlusIcon aria-hidden="true" />
          Agregar
        </Boton>
      </div>

      <p id={`${id}-ayuda`} className="text-sm text-muted-foreground">
        {lleno ? `Llegaste al máximo de ${MAX_ITEMS_LISTA} entradas.` : ayuda}
      </p>

      {valores.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {valores.map((valor) => (
            <li key={valor}>
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1.5 pr-1.5 pl-3.5 text-base font-medium text-primary">
                <span className="min-w-0 break-words">{valor}</span>
                <input type="hidden" name={id} value={valor} />
                {/* `size-9` (40px) en vez de `size-6` (27px): mismo criterio
                    que los chips de horario de `formulario-medicacion.tsx`. */}
                <button
                  type="button"
                  onClick={() => quitar(valor)}
                  aria-label={`Quitar ${valor} de ${label.toLocaleLowerCase("es-AR")}`}
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
          <HeartPulseIcon className="size-4 shrink-0" aria-hidden="true" />
          {textoVacio}
        </p>
      )}
    </div>
  )
}
