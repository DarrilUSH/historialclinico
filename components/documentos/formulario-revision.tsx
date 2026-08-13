"use client"

/**
 * Formulario de revisión y fallback de edición manual (Sprint 4, tarea 4.5):
 * la pantalla MÁS importante del flujo de ingesta. Acá la persona da su visto
 * bueno a lo que la IA leyó, o carga los datos a mano si la IA falló.
 *
 * REGLA DE ORO: la IA nunca guarda sola, y la subida nunca queda bloqueada
 * por la IA.
 *
 * - `extraccion` presente → los cuatro campos vienen PRE-CARGADOS con lo que
 *   detectó Gemini, con ayuda "Detectado automáticamente — revisalo" (o "No se
 *   detectó — completalo vos" en el campo que quedó sin dato real: ver
 *   `lib/documentos/sugerir-titulo.ts`).
 * - `extraccion` es `null` (la extracción falló o Gemini devolvió algo que no
 *   pasó la validación Zod) → el MISMO formulario, con la `<Alerta>` de arriba
 *   explicando que no se pudo leer, y los campos que la IA habría llenado
 *   (fecha, resumen) en blanco. El título arranca con el nombre provisional
 *   que ya quedó guardado al subir (`tituloDesdeNombre`, `lib/documentos/ingesta.ts`)
 *   -no es un dato de la IA, es simplemente lo que ya hay en la fila- y la
 *   categoría en "Otro", el mismo default de la base: no tiene sentido
 *   vaciar campos que ya tienen un valor razonable solo para que se vean
 *   "en blanco".
 *
 * El único botón que persiste es "Confirmar y guardar" (Server Action
 * `confirmarDocumento`, vía el RPC `confirmar_documento_recien_subido`).
 * "Cancelar" abre `DialogoConfirmacion` y, si se confirma el descarte, corre
 * `descartarDocumento` (RPC `descartar_documento_recien_subido` + borrado
 * inmediato del objeto de Storage).
 *
 * Las MÉTRICAS detectadas se muestran de solo lectura -esta pantalla no las
 * edita- pero viajan en un campo oculto (`metricas`, JSON) dentro del mismo
 * `<form>`: `confirmarDocumento` (tarea 4.6 del roadmap) las normaliza con
 * `lib/laboratorio/normalizacion.ts` y las persiste en `lab_metrics` de forma
 * atómica con la confirmación del documento, vía el RPC
 * `confirmar_documento_recien_subido`.
 */

import * as React from "react"
import { useActionState } from "react"

import { CircleCheckIcon, FlaskConicalIcon } from "lucide-react"

import {
  confirmarDocumento,
  descartarDocumento,
  type EstadoConfirmacion,
} from "@/app/(app)/(con-nav)/estudios/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { CampoTextarea } from "@/components/base/campo-textarea"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import { Tarjeta } from "@/components/base/tarjeta"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { sugerirTitulo } from "@/lib/documentos/sugerir-titulo"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import type { CategoriaDocumento } from "@/types/dominio"

export interface FormularioRevisionProps {
  documentoId: string
  /** Extracción validada de Gemini, o `null` si falló / no pasó la validación. */
  extraccion: DocumentoMedicoExtraido | null
  /** Mensaje de error de la extracción, para mostrar cuando `extraccion` es `null`. */
  mensajeError?: string | null
  /** Título ya guardado en `documents.title` (provisional, derivado del nombre de archivo). */
  tituloProvisional: string
  /** Categoría ya guardada en `documents.category` (default `"other"`). */
  categoriaProvisional: CategoriaDocumento
  /** Fecha ya guardada en `documents.document_date` (default: hoy). */
  fechaProvisional: string
  /** Fecha de hoy en `YYYY-MM-DD`, hora de pared de Ushuaia — tope del input date. */
  fechaMaximaIso: string
}

const ESTADO_INICIAL: EstadoConfirmacion = { error: null }
const ID_FORMULARIO = "formulario-revision-documento"
const FECHA_MINIMA_ISO = "1901-01-01"

const AYUDA_DETECTADO = "Detectado automáticamente — revisalo."
const AYUDA_NO_DETECTADO = "No se detectó — completalo vos."

const CATEGORIAS: { valor: CategoriaDocumento; etiqueta: string }[] = [
  { valor: "laboratory", etiqueta: "Laboratorio" },
  { valor: "imaging", etiqueta: "Imágenes" },
  { valor: "prescription", etiqueta: "Receta" },
  { valor: "consultation", etiqueta: "Consulta" },
  { valor: "other", etiqueta: "Otro" },
]

/**
 * `{ value, label }` -Base UI reconoce esta forma automáticamente- para que
 * `<Select items={...}>` pueda resolver "Laboratorio" en el trigger apenas
 * monta, con `defaultValue="laboratory"` y SIN que la persona haya abierto el
 * desplegable todavía. Sin `items`, `<SelectValue>` no tiene de dónde sacar
 * la etiqueta de un valor inicial no interactivo y cae a mostrar el `value`
 * crudo tal cual -"laboratory" en vez de "Laboratorio"-, porque los
 * `<SelectItem>` que sí traen la etiqueta viven dentro de `<SelectContent>`,
 * que Base UI monta recién al abrir el popup (bug real, encontrado al
 * verificar esta pantalla en el navegador: el trigger mostraba el enum en
 * inglés apenas se cargaba la extracción).
 */
const ITEMS_CATEGORIA = CATEGORIAS.map((categoria) => ({
  value: categoria.valor,
  label: categoria.etiqueta,
}))

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/

export function FormularioRevision({
  documentoId,
  extraccion,
  mensajeError,
  tituloProvisional,
  categoriaProvisional,
  fechaProvisional,
  fechaMaximaIso,
}: FormularioRevisionProps) {
  const [estadoConfirmar, enviarConfirmar, pendienteConfirmar] = useActionState(
    confirmarDocumento,
    ESTADO_INICIAL,
  )
  const [estadoDescartar, enviarDescartar] = useActionState(descartarDocumento, ESTADO_INICIAL)

  const sugerido = extraccion ? sugerirTitulo(extraccion) : null
  const tituloInicial = sugerido?.titulo || tituloProvisional
  const tituloDetectado = sugerido?.detectado ?? false

  const fechaDetectada = Boolean(extraccion && PATRON_FECHA.test(extraccion.fecha))
  const fechaInicial = fechaDetectada && extraccion ? extraccion.fecha : fechaProvisional

  const categoriaInicial = extraccion?.categoria ?? categoriaProvisional
  // La categoría es un campo required del schema de Gemini: si `extraccion`
  // existe, siempre trae una (el modelo elige "other" cuando no sabe), así
  // que no hay un caso real de "categoría no detectada" dentro de una
  // extracción válida.
  const categoriaDetectada = Boolean(extraccion)

  const resumenInicial = extraccion?.resumen ?? ""
  const resumenDetectado = Boolean(extraccion?.resumen)

  const metricas = extraccion?.metricas ?? []

  return (
    <div className="flex w-full flex-col gap-6">
      {extraccion ? (
        <Alerta variante="info" estatica>
          Así entendimos el documento. Revisá los datos, corregí lo que haga falta y confirmá
          para guardarlo. Esto es solo asistencia: nada se guarda hasta que vos lo confirmes.
        </Alerta>
      ) : (
        <Alerta variante="advertencia" estatica titulo="No pudimos leer el documento automáticamente">
          {mensajeError ?? "Cargá los datos a mano: el archivo que subiste no se perdió."}
        </Alerta>
      )}

      <form id={ID_FORMULARIO} action={enviarConfirmar} className="flex flex-col gap-5">
        <input type="hidden" name="documentoId" value={documentoId} />
        <input type="hidden" name="metricas" value={JSON.stringify(metricas)} />

        <CampoTexto
          id="titulo"
          label="Título"
          defaultValue={tituloInicial}
          required
          maxLength={200}
          ayuda={tituloDetectado ? "Sugerido a partir de lo que detectamos. Podés cambiarlo." : AYUDA_NO_DETECTADO}
        />

        <CampoTexto
          id="fecha"
          label="Fecha del estudio"
          type="date"
          defaultValue={fechaInicial}
          required
          max={fechaMaximaIso}
          min={FECHA_MINIMA_ISO}
          ayuda={fechaDetectada ? AYUDA_DETECTADO : AYUDA_NO_DETECTADO}
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="categoria-trigger">Categoría</Label>
          <Select name="categoria" items={ITEMS_CATEGORIA} defaultValue={categoriaInicial} required>
            <SelectTrigger id="categoria-trigger" className="w-full">
              <SelectValue placeholder="Elegí una categoría" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIAS.map((categoria) => (
                <SelectItem key={categoria.valor} value={categoria.valor}>
                  {categoria.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {categoriaDetectada ? AYUDA_DETECTADO : "Elegí la categoría que corresponda."}
          </p>
        </div>

        <CampoTextarea
          id="resumen"
          label="Resumen"
          defaultValue={resumenInicial}
          conDictado
          rows={4}
          maxLength={2000}
          ayuda={
            resumenDetectado
              ? AYUDA_DETECTADO
              : "Contá brevemente de qué se trata el documento (opcional)."
          }
        />

        {metricas.length > 0 && (
          <Tarjeta className="gap-3 px-(--card-spacing)">
            <div className="flex items-center gap-2">
              <FlaskConicalIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-base font-semibold text-foreground">
                Resultados de laboratorio detectados
              </p>
            </div>
            <ul className="flex flex-col gap-2">
              {metricas.map((metrica, indice) => (
                <li
                  key={`${metrica.nombre}-${indice}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-base font-medium text-foreground">{metrica.nombre}</span>
                  <span className="text-base text-muted-foreground numeros-clinicos">
                    {metrica.valor} {metrica.unidad}
                    {metrica.rango && ` (ref: ${metrica.rango})`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Se van a guardar como serie de laboratorio al confirmar.
            </p>
          </Tarjeta>
        )}

        {estadoConfirmar.error && <Alerta variante="error">{estadoConfirmar.error}</Alerta>}
      </form>

      <div className="flex flex-col gap-3 sm:flex-row-reverse">
        <Boton
          type="submit"
          form={ID_FORMULARIO}
          size="lg"
          cargando={pendienteConfirmar}
          className="sm:flex-1"
        >
          <CircleCheckIcon aria-hidden="true" />
          Confirmar y guardar
        </Boton>

        <DialogoConfirmacion
          disparador={<Boton variant="outline" size="lg" className="sm:flex-1" />}
          titulo="¿Descartar este documento?"
          consecuencia="Vamos a borrar el archivo que subiste. No va a quedar guardado en tu historial, y esta acción no se puede deshacer."
          accion={enviarDescartar}
          camposOcultos={{ documentoId }}
          error={estadoDescartar.error}
          textoConfirmar="Sí, descartar"
          textoCancelar="Seguir editando"
        >
          Cancelar
        </DialogoConfirmacion>
      </div>
    </div>
  )
}
