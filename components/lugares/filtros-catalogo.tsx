"use client"

/**
 * Filtros de `/lugares` (Sprint 16, tarea 16.3): búsqueda por nombre,
 * provincia, localidad y tipo de establecimiento.
 *
 * ## El estado vive en la URL, no acá
 *
 * Al enviar, el componente navega a `/lugares?q=...&provincia=...` y la
 * PÁGINA (Server Component) hace la consulta. Tres consecuencias que valen la
 * pena y que un filtro con estado local no da: la búsqueda se puede compartir
 * y volver a abrir, el botón "atrás" del teléfono deshace un filtro en vez de
 * salir de la pantalla, y las 36.046 filas nunca viajan al navegador —solo
 * las 40 que se muestran—.
 *
 * ## Por qué "Localidad" es un campo de texto y no un desplegable
 *
 * Porque el país tiene miles de localidades y el catálogo las trae como texto
 * libre del registro: un `<Select>` con esa lista sería inusable en un
 * teléfono, y armarla exigiría un `distinct` sobre 36 mil filas que PostgREST
 * no expone. Se compara contra `health_centers.locality_search`, la columna
 * ya normalizada, así que "guaymallen" encuentra "GUAYMALLÉN".
 */

import * as React from "react"
import { useRouter } from "next/navigation"

import { SearchIcon, XIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CATEGORIA_TODAS, CATEGORIAS_TIPOLOGIA } from "@/lib/lugares/tipologias"
import { PROVINCIAS_ARGENTINAS } from "@/lib/ubicacion/provincias"

/**
 * Valor del desplegable "Tipo" que representa "el default": las cinco
 * categorías que son lugares de atención. Viaja como `""` en la URL, es
 * decir, ausente.
 */
const TIPO_ATENCION = ""

const OPCIONES_PROVINCIA = [
  { value: "", label: "Todas las provincias" },
  ...PROVINCIAS_ARGENTINAS.map((provincia) => ({ value: provincia, label: provincia })),
]

const OPCIONES_TIPO = [
  { value: TIPO_ATENCION, label: "Lugares de atención" },
  ...CATEGORIAS_TIPOLOGIA.map((categoria) => ({ value: categoria.id, label: categoria.etiqueta })),
  { value: CATEGORIA_TODAS, label: "Todos, sin filtrar" },
]

export interface FiltrosCatalogoProps {
  consulta: string
  provincia: string
  localidad: string
  categoria: string
}

export function FiltrosCatalogo(props: FiltrosCatalogoProps) {
  const router = useRouter()

  const [consulta, setConsulta] = React.useState(props.consulta)
  const [provincia, setProvincia] = React.useState(props.provincia)
  const [localidad, setLocalidad] = React.useState(props.localidad)
  const [categoria, setCategoria] = React.useState(props.categoria)

  const hayFiltros =
    consulta.length > 0 || provincia.length > 0 || localidad.length > 0 || categoria.length > 0

  function buscar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()

    const parametros = new URLSearchParams()
    if (consulta.trim()) parametros.set("q", consulta.trim())
    if (provincia) parametros.set("provincia", provincia)
    if (localidad.trim()) parametros.set("localidad", localidad.trim())
    if (categoria) parametros.set("tipo", categoria)

    const cadena = parametros.toString()
    router.push(cadena.length > 0 ? `/lugares?${cadena}` : "/lugares")
  }

  function limpiar() {
    setConsulta("")
    setProvincia("")
    setLocalidad("")
    setCategoria("")
    router.push("/lugares")
  }

  return (
    <form onSubmit={buscar} className="flex flex-col gap-4 chica:gap-3">
      <CampoTexto
        id="q"
        label="Buscar un centro"
        type="search"
        maxLength={100}
        value={consulta}
        onChange={(evento) => setConsulta(evento.target.value)}
        ayuda="Por nombre, localidad o provincia. No hace falta poner las tildes."
        placeholder="Ej: san jorge, hospital italiano, laboratorio"
      />

      {/* Provincia y localidad van juntas: son la misma pregunta ("¿dónde?")
          y en chica entran cómodas en dos columnas, mismo criterio que
          ciudad/provincia en `components/turnos/formulario-turno.tsx`. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2 chica:gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="filtro-provincia-trigger">Provincia</Label>
          <Select
            items={OPCIONES_PROVINCIA}
            value={provincia}
            onValueChange={(valor) => setProvincia(String(valor ?? ""))}
          >
            <SelectTrigger id="filtro-provincia-trigger" className="w-full">
              <SelectValue placeholder="Todas las provincias" />
            </SelectTrigger>
            <SelectContent>
              {OPCIONES_PROVINCIA.map((opcion) => (
                <SelectItem key={opcion.value || "todas"} value={opcion.value}>
                  {opcion.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <CampoTexto
          id="localidad"
          label="Localidad"
          maxLength={100}
          value={localidad}
          onChange={(evento) => setLocalidad(evento.target.value)}
          placeholder="Ej: Ushuaia"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="filtro-tipo-trigger">Tipo de establecimiento</Label>
        <Select
          items={OPCIONES_TIPO}
          value={categoria}
          onValueChange={(valor) => setCategoria(String(valor ?? ""))}
        >
          <SelectTrigger id="filtro-tipo-trigger" className="w-full">
            <SelectValue placeholder="Lugares de atención" />
          </SelectTrigger>
          <SelectContent>
            {OPCIONES_TIPO.map((opcion) => (
              <SelectItem key={opcion.value || "atencion"} value={opcion.value}>
                {opcion.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground chica:hidden">
          Por defecto se muestran los lugares donde una persona se atiende. El registro también
          incluye residencias para personas mayores y establecimientos no asistenciales.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Boton type="submit" size="lg" className="flex-1">
          <SearchIcon aria-hidden="true" />
          Buscar
        </Boton>
        {hayFiltros && (
          <Boton type="button" variant="outline" size="lg" onClick={limpiar}>
            <XIcon aria-hidden="true" />
            Limpiar
          </Boton>
        )}
      </div>
    </form>
  )
}
