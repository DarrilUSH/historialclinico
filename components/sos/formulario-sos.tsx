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
import { cn } from "@/lib/utils"
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
    <form action={enviarAccion} className="flex flex-col gap-6 chica:gap-3">
      <div className="flex flex-col gap-2 chica:gap-1.5">
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
        <p className="text-sm text-muted-foreground chica:hidden">
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

      <fieldset className="flex flex-col gap-4 rounded-xl border border-border p-4 chica:gap-3 chica:p-3">
        <legend className="px-1 text-base font-semibold">Contacto de emergencia</legend>

        {/*
          Chica (Sprint 13, tarea 13.5): "Nombre" y "Vínculo" pasan a
          compartir fila, y "Teléfono" queda solo a ancho completo debajo.
          Los tres campos viven en UN solo grid -en vez de reordenar el DOM,
          que arriesgaría tocar el orden visual en grande- y la reubicación
          es puramente visual, vía `order` con `chica:`: grande nunca aplica
          esas clases, así que su disposición (Nombre solo arriba, Teléfono y
          Vínculo en fila desde `sm:`) queda pixel a pixel igual que antes.
          El costo es que el orden de tabulación/lectura de pantalla en chica
          (Nombre, Teléfono, Vínculo — el orden real del DOM, sin cambios) no
          coincide con el orden visual (Nombre, Vínculo, Teléfono): un
          desvío acotado y deliberado de WCAG 1.3.2, confinado a este único
          grupo de tres campos cortos donde la relación entre ellos es obvia
          igual sin mirar el orden exacto.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2 chica:gap-3">
          <CampoTexto
            id="contactoNombre"
            label="Nombre"
            maxLength={120}
            autoComplete="off"
            defaultValue={valoresIniciales.contactoNombre}
            ayuda="A quién llamar en caso de emergencia."
            contenedorClassName="sm:col-span-2 chica:col-span-1 chica:order-1"
          />
          <CampoTexto
            id="contactoTelefono"
            label="Teléfono"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={MAX_LARGO_TELEFONO}
            defaultValue={valoresIniciales.contactoTelefono}
            ayuda="Con característica. Ej: +54 9 2901 612345."
            contenedorClassName="chica:order-3 chica:col-span-2"
          />
          <CampoTexto
            id="contactoVinculo"
            label="Vínculo"
            maxLength={60}
            autoComplete="off"
            defaultValue={valoresIniciales.contactoVinculo}
            ayuda="Hija, esposo, vecina, cuidadora..."
            contenedorClassName="chica:order-2"
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
    <div className="flex flex-col gap-2 chica:gap-1.5">
      <Label htmlFor={`${id}-nuevo`}>{label}</Label>

      <div className="flex items-center gap-2 chica:gap-1.5">
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

      {/* La ayuda pura se oculta en chica (regla del rediseño compacto); el
          aviso de "llegaste al máximo" NO -es la explicación de por qué
          "Agregar" está deshabilitado, no una guía de contexto-. */}
      <p
        id={`${id}-ayuda`}
        className={cn("text-sm text-muted-foreground", !lleno && "chica:hidden")}
      >
        {lleno ? `Llegaste al máximo de ${MAX_ITEMS_LISTA} entradas.` : ayuda}
      </p>

      {valores.length > 0 ? (
        <ul className="flex flex-wrap gap-2 chica:gap-1.5">
          {valores.map((valor) => (
            <li key={valor}>
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1.5 pr-1.5 pl-3.5 text-base font-medium text-primary chica:py-1 chica:pl-3 chica:text-sm">
                <span className="min-w-0 break-words">{valor}</span>
                <input type="hidden" name={id} value={valor} />
                {/* `size-9` (40px en grande) en vez de `size-6` (27px): mismo
                    criterio que los chips de horario de
                    `formulario-medicacion.tsx`. Chica: `size-9` computa a
                    36px con la escala de espaciado compacta -por debajo del
                    piso-, así que se fija en `chica:size-10` (40px exacto). */}
                <button
                  type="button"
                  onClick={() => quitar(valor)}
                  aria-label={`Quitar ${valor} de ${label.toLocaleLowerCase("es-AR")}`}
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
          <HeartPulseIcon className="size-4 shrink-0" aria-hidden="true" />
          {textoVacio}
        </p>
      )}
    </div>
  )
}
