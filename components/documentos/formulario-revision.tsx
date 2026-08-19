"use client"

/**
 * Formulario de revisión y fallback de edición manual (Sprint 4, tarea 4.5):
 * la pantalla MÁS importante del flujo de ingesta. Acá la persona da su visto
 * bueno a lo que la IA leyó, o carga los datos a mano si la IA falló.
 *
 * REGLA DE ORO: la IA nunca guarda sola, y la subida nunca queda bloqueada
 * por la IA.
 *
 * - `extraccion` presente → título, fecha, categoría, resumen, institución,
 *   especialidad y médico vienen PRE-CARGADOS con lo que detectó Gemini, con
 *   ayuda "Detectado automáticamente — revisalo" (o "No se detectó —
 *   completalo vos" en el campo que quedó sin dato real: ver
 *   `lib/documentos/sugerir-titulo.ts`). Institución, especialidad y médico
 *   son OPCIONALES -pueden quedar vacíos, tanto si Gemini no los detectó como
 *   si la persona los borra a mano-: el RPC (`confirmar_documento_recien_subido`,
 *   `supabase/migrations/20260813030000_confirmacion_metadatos_completos.sql`)
 *   los normaliza a NULL igual que ya hace con el resumen.
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
 * `confirmar_documento_recien_subido`. El NÚMERO DE ORDEN detectado viaja
 * igual, en el campo oculto `numeroOrden` -no tiene campo propio en el
 * formulario, mismo criterio que las métricas-.
 *
 * ## Cruces inteligentes: institución ↔ catálogo REFES, médico ↔ directorio (agosto 2026)
 *
 * "Institución" y "Médico" pasan de `defaultValue` (no controlados) a
 * `value`/`onChange`: es lo único que hace falta para que las dos franjas de
 * abajo -`FranjaCandidatoLugar`, `FranjaCotejoMedico`- puedan REEMPLAZAR el
 * texto al tocar "Usar este"/"Vincular", igual que ya hace
 * `components/turnos/formulario-turno.tsx`. El `name` del campo (heredado del
 * `id`) no cambia, así que `confirmarDocumento` sigue leyendo estos dos
 * campos del mismo `FormData` de siempre.
 *
 * A diferencia del formulario de turno, acá el cotejo se calcula UNA sola vez
 * a partir de `extraccion` -esta pantalla no tiene un "Analizar de nuevo": la
 * IA corrió una sola vez, al subir el documento-, así que no hace falta
 * estado para "qué precargó la última pasada": `institucionInicial`/
 * `medicoInicial` (más abajo) son la referencia fija contra la que cada
 * franja decide si sigue vigente (el campo todavía dice lo que la IA detectó)
 * o si ya se resolvió (la persona lo tipeó, o ya tocó "Usar este"/"Vincular").
 *
 * `documents` no tiene columnas propias de dirección/ciudad/provincia/
 * coordenadas -a diferencia de `appointments`-, así que "Usar este" acá solo
 * reemplaza el NOMBRE de la institución por el oficial del registro; no hay
 * nada de geocodificación que ganar en esta pantalla. Y `documents.doctor_id`
 * existe en el esquema pero ningún flujo de la app lo persiste todavía (solo
 * `doctor_name`, texto): "Vincular" acá tampoco intenta escribirlo, solo
 * normaliza el texto de "Médico" al nombre tal como está cargado en el
 * directorio -mismo criterio de "no exagerar el alcance" que ya declaró esta
 * tarea para el resto del cruce de lugares-.
 *
 * ## La franja de duplicado SEMÁNTICO (Capas 2 y 3, hotfix sobre la huella)
 *
 * `duplicadoSemantico` llega ya resuelto desde `PantallaProcesando`
 * (`app/api/documentos/extraer/route.ts` cotejó mismo N° de orden o todos los
 * datos exactamente iguales contra los documentos YA CONFIRMADOS del perfil).
 * Si hay uno, se muestra una franja de advertencia -"Es un duplicado: …" con
 * "Ver ese estudio" y "Cargar igual"- ARRIBA del formulario, sin bloquear
 * nada: el documento YA fue creado (a diferencia de la huella byte-a-byte,
 * que corre ANTES del `INSERT` y puede evitar crear la fila), así que
 * "Cargar igual" acá es simplemente DESCARTAR el aviso -estado local, no una
 * llamada al servidor- porque el único camino que persiste algo sigue siendo
 * "Confirmar y guardar", que nunca estuvo deshabilitado. Regla de oro
 * respetada: se avisa, nunca se bloquea.
 *
 * ## Sprint 19: la pantalla deja de decir "detectado" cuando no detectó nada
 *
 * Tres cambios, los tres salidos de medir el pipeline con 19 documentos
 * reales del dueño. Los tres apuntan a lo mismo: que la ayuda debajo de cada
 * campo diga la VERDAD, porque "Detectado automáticamente — revisalo" es una
 * invitación a no revisar.
 *
 * 1. **Título.** Antes el título lo componía `sugerirTitulo` como
 *    `<categoría> — <institución>` y, como institución hay casi siempre, la
 *    ayuda decía "Detectado automáticamente" en 15 de 25 documentos que
 *    compartían título con otro. Ahora el nombre del estudio lo trae el
 *    modelo (`DocumentoMedicoExtraido.titulo`): si vino, la ayuda dice que es
 *    una sugerencia; si NO vino y el título es el genérico compuesto, la
 *    ayuda dice "Poné un nombre para reconocerlo" y el campo se lleva el
 *    foco. Además, si el título coincide con el de otro estudio del mismo
 *    perfil (`titulosExistentes`), se avisa acá mismo — se avisa, nunca se
 *    bloquea: dos controles del mismo tipo pueden llamarse igual con todo
 *    derecho.
 * 2. **Fecha.** `extraccion.fecha` ahora puede ser `null` (el documento no
 *    imprime su propia fecha, ver `lib/gemini/schemas.ts`). Antes ese caso
 *    caía a `fechaProvisional` -que es HOY- y se podía confirmar sin que
 *    nadie mirara: una fecha inventada entrando al historial en silencio.
 *    Ahora el campo queda VACÍO, dice "No la encontramos — completala vos",
 *    se lleva el foco y, como es `required`, el formulario no se envía hasta
 *    que una persona la ponga. `fechaProvisional` sigue siendo el default
 *    SOLO cuando la extracción falló entera (formulario manual): ahí no hay
 *    ninguna lectura que contradecir.
 * 3. **Resultados cualitativos.** La tarjeta de métricas mostraba
 *    `{valor} {unidad}` y nada más; un resultado sin número ("No Reactivo",
 *    "No se observan espermatozoides") se veía como una fila vacía. Ahora
 *    muestra el texto cuando no hay número. Viajan por el mismo campo oculto
 *    `metricas` de siempre, así que `confirmarDocumento` los persiste en
 *    `lab_metrics.value_text` sin ningún cambio de su lado.
 *
 * ## Velo de espera (Sprint 14, "Feedback de espera global")
 *
 * "Guardando…" es la tercera y última etapa REAL de la ingesta -ver el
 * comentario equivalente en `../../app/(app)/(con-nav)/estudios/nuevo/pantalla-carga.tsx`
 * para las otras dos-: `confirmarDocumento` hace el RPC que sella el
 * documento y persiste las métricas en la misma transacción, un viaje al
 * servidor con más trabajo que un INSERT simple. El botón "Confirmar y
 * guardar" YA tenía su propio spinner (`cargando={pendienteConfirmar}`, ver
 * `components/base/boton.tsx`) y se conserva sin cambios -es una señal de
 * widget, no una región viva-; el velo se agrega ADEMÁS, porque acá sí hay
 * margen real para que el RPC tarde y la persona necesita el mismo aviso
 * grande que en las dos etapas anteriores. No se aplica en `descartarDocumento`
 * -es un simple `DELETE`, del mismo orden de magnitud que los formularios
 * rápidos que este componente NO cubre (ver el encabezado de
 * `components/base/velo-espera.tsx`)-.
 */

import * as React from "react"
import { useActionState } from "react"
import Link from "next/link"

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
import { VeloEspera } from "@/components/base/velo-espera"
import { FranjaCandidatoLugar } from "@/components/lugares/franja-candidato-lugar"
import { FranjaCotejoMedico } from "@/components/medicos/franja-cotejo-medico"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { sugerirTitulo, tituloYaUsado } from "@/lib/documentos/sugerir-titulo"
import {
  TEXTO_MOTIVO_DUPLICADO_SEMANTICO,
  type DuplicadoSemanticoParaCliente,
} from "@/lib/documentos/duplicados-semanticos"
import { mapearEspecialidadCatalogo } from "@/lib/especialidades/mapear-catalogo"
import type { DocumentoMedicoExtraido } from "@/lib/gemini/schemas"
import type { LugarExtraidoParaCotejo } from "@/lib/lugares/candidatos"
import type { CentroSugerido } from "@/lib/lugares/sugerencias"
import type { MedicoParaAutocompletar } from "@/lib/turnos/autocompletar-medico"
import type { CategoriaDocumento } from "@/types/dominio"
import { cn } from "@/lib/utils"

export interface FormularioRevisionProps {
  documentoId: string
  /** Extracción validada de Gemini, o `null` si falló / no pasó la validación. */
  extraccion: DocumentoMedicoExtraido | null
  /** Mensaje de error de la extracción, para mostrar cuando `extraccion` es `null`. */
  mensajeError?: string | null
  /** Duplicado semántico (Capas 2/3) encontrado contra el historial del perfil, o `null`. */
  duplicadoSemantico?: DuplicadoSemanticoParaCliente | null
  /** Título ya guardado en `documents.title` (provisional, derivado del nombre de archivo). */
  tituloProvisional: string
  /** Categoría ya guardada en `documents.category` (default `"other"`). */
  categoriaProvisional: CategoriaDocumento
  /** Fecha ya guardada en `documents.document_date` (default: hoy). */
  fechaProvisional: string
  /** Fecha de hoy en `YYYY-MM-DD`, hora de pared de Ushuaia — tope del input date. */
  fechaMaximaIso: string
  /** Médicos activos del directorio del perfil, para el cruce "¿Es este médico que ya tenés?" (cruces inteligentes, agosto 2026). Vacío si todavía no cargó ninguno -en ese caso, `FranjaCotejoMedico` solo puede ofrecer "Agregar"-. */
  medicos: MedicoParaAutocompletar[]
  /** `true` si el catálogo REFES tiene centros cargados (cruces inteligentes, agosto 2026). Con `false`, la franja de institución nunca tiene nada que ofrecer. */
  catalogoDisponible?: boolean
  /**
   * Títulos de los documentos que el perfil YA tiene (Sprint 19), para avisar
   * cuando el título propuesto se repite. Se resuelven en el Server Component
   * de `/estudios/nuevo/procesando` y llegan ya filtrados por RLS: son los
   * mismos que la persona ve en `/estudios`, ningún dato nuevo.
   */
  titulosExistentes?: readonly string[]
}

const ESTADO_INICIAL: EstadoConfirmacion = { error: null }
const ID_FORMULARIO = "formulario-revision-documento"
const FECHA_MINIMA_ISO = "1901-01-01"

const AYUDA_DETECTADO = "Detectado automáticamente — revisalo."
const AYUDA_NO_DETECTADO = "No se detectó — completalo vos."
const AYUDA_TITULO_SUGERIDO = "Sugerido a partir de lo que detectamos. Podés cambiarlo."
const AYUDA_TITULO_A_COMPLETAR = "Poné un nombre para reconocerlo."
const AYUDA_FECHA_FALTANTE = "No la encontramos — completala vos."

/** id del aviso de título repetido, para asociarlo al campo con `aria-describedby`. */
const ID_AVISO_TITULO_REPETIDO = "aviso-titulo-repetido"

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
  duplicadoSemantico = null,
  tituloProvisional,
  categoriaProvisional,
  fechaProvisional,
  fechaMaximaIso,
  medicos,
  catalogoDisponible = false,
  titulosExistentes = [],
}: FormularioRevisionProps) {
  const [estadoConfirmar, enviarConfirmar, pendienteConfirmar] = useActionState(
    confirmarDocumento,
    ESTADO_INICIAL,
  )
  const [estadoDescartar, enviarDescartar] = useActionState(descartarDocumento, ESTADO_INICIAL)

  // "Cargar igual" de la franja semántica es puramente local: a diferencia
  // de la huella byte-a-byte (que corre ANTES del INSERT y puede evitar
  // crear la fila), acá el documento YA existe -"Cargar igual" solo descarta
  // el aviso, "Confirmar y guardar" sigue siendo el único botón que persiste-.
  const [avisoDuplicadoDescartado, setAvisoDuplicadoDescartado] = React.useState(false)
  const mostrarAvisoDuplicado = Boolean(duplicadoSemantico) && !avisoDuplicadoDescartado

  const sugerido = extraccion ? sugerirTitulo(extraccion) : null
  const tituloInicial = sugerido?.titulo || tituloProvisional
  // `detectado` es `true` SOLO cuando el modelo nombró el estudio: el título
  // genérico compuesto ya NO cuenta como detectado (ver el encabezado).
  const tituloDetectado = sugerido?.detectado ?? false

  // Fecha: `null` = el documento no imprime la suya. El campo queda VACÍO a
  // propósito -no se cae a "hoy"-, y como es `required` el formulario no se
  // envía hasta que una persona la complete. Con la extracción fallida entera
  // se conserva `fechaProvisional`: ahí no hay ninguna lectura que contradecir.
  const fechaExtraida = extraccion?.fecha ?? null
  const fechaDetectada = Boolean(fechaExtraida && PATRON_FECHA.test(fechaExtraida))
  const faltaFecha = Boolean(extraccion) && !fechaDetectada
  const fechaInicial = extraccion ? (fechaDetectada ? (fechaExtraida ?? "") : "") : fechaProvisional

  // Un solo campo se lleva el foco, y gana el que BLOQUEA: sin fecha no se
  // puede confirmar; sin un buen título sí -el genérico compuesto queda
  // cargado-, así que el título solo pide foco cuando la fecha no lo necesita.
  const enfocarFecha = faltaFecha
  const enfocarTitulo = Boolean(extraccion) && !tituloDetectado && !enfocarFecha

  const categoriaInicial = extraccion?.categoria ?? categoriaProvisional
  // La categoría es un campo required del schema de Gemini: si `extraccion`
  // existe, siempre trae una (el modelo elige "other" cuando no sabe), así
  // que no hay un caso real de "categoría no detectada" dentro de una
  // extracción válida.
  const categoriaDetectada = Boolean(extraccion)

  const resumenInicial = extraccion?.resumen ?? ""
  const resumenDetectado = Boolean(extraccion?.resumen)

  const institucionInicial = extraccion?.institucion?.trim() ?? ""
  const institucionDetectada = Boolean(institucionInicial)

  const especialidadInicial = extraccion?.especialidad?.trim() ?? ""
  const especialidadDetectada = Boolean(especialidadInicial)

  const medicoInicial = extraccion?.medico?.trim() ?? ""
  const medicoDetectado = Boolean(medicoInicial)

  const metricas = extraccion?.metricas ?? []
  const numeroOrden = extraccion?.numero_orden ?? ""

  // Cruces inteligentes (agosto 2026): "Institución" y "Médico" pasan a
  // controlados -ver el comentario de cabecera del archivo- para que las
  // franjas de abajo puedan reemplazar el texto al tocar "Usar
  // este"/"Vincular". Arrancan con lo que detectó la IA, igual que antes.
  const [institucion, setInstitucion] = React.useState(institucionInicial)
  const [medico, setMedico] = React.useState(medicoInicial)

  // El título pasa a controlado por el mismo motivo que institución y médico,
  // pero por otra razón: el aviso de "ya tenés un estudio con este nombre"
  // tiene que seguir a lo que la persona escribe, no al valor inicial.
  const [titulo, setTitulo] = React.useState(tituloInicial)
  const tituloRepetido = tituloYaUsado(titulo, titulosExistentes)

  // Referencia fija de lo que la IA detectó (esta pantalla no tiene un
  // "Analizar de nuevo": ver el comentario de cabecera). Cada franja se
  // esconde sola apenas el campo deja de coincidir con esto -la persona lo
  // tipeó de nuevo, o ya tocó "Usar este"/"Vincular"-.
  const institucionParaFranja: LugarExtraidoParaCotejo | null =
    catalogoDisponible && institucionInicial.length > 0 && institucion === institucionInicial
      ? { nombre: institucionInicial, direccion: "", ciudad: "", provincia: "" }
      : null
  const medicoParaFranja =
    medicoInicial.length > 0 && medico === medicoInicial ? medicoInicial : null

  /** "Usar este" de la franja de institución: acá no hay dirección/ciudad/provincia/coordenadas que completar -`documents` no las tiene-, solo el nombre oficial. */
  function usarInstitucionDelCatalogo(centro: CentroSugerido) {
    setInstitucion(centro.nombre)
  }

  /** "Vincular"/"Agregar" de la franja de médico: normaliza "Médico" al nombre tal como está (o quedó) en el directorio. `documents.doctor_id` no se toca -ver el comentario de cabecera-. */
  function usarMedicoDelDirectorio(doctor: MedicoParaAutocompletar) {
    setMedico(doctor.full_name)
  }

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

      {mostrarAvisoDuplicado && duplicadoSemantico && (
        <div className="flex flex-col gap-3">
          <Alerta variante="advertencia">
            Es un duplicado: {TEXTO_MOTIVO_DUPLICADO_SEMANTICO[duplicadoSemantico.motivo]} — idéntico a «
            {duplicadoSemantico.titulo}» del {duplicadoSemantico.fechaTexto}.
          </Alerta>
          <div className="flex flex-col gap-3 sm:flex-row-reverse">
            <Boton
              render={<Link href={`/estudios/${duplicadoSemantico.documentoId}`} />}
              nativeButton={false}
              variant="outline"
              className="sm:flex-1"
            >
              Ver ese estudio
            </Boton>
            <Boton
              type="button"
              variant="ghost"
              className="sm:flex-1"
              onClick={() => setAvisoDuplicadoDescartado(true)}
            >
              Cargar igual
            </Boton>
          </div>
        </div>
      )}

      <form id={ID_FORMULARIO} action={enviarConfirmar} className="flex flex-col gap-5">
        <input type="hidden" name="documentoId" value={documentoId} />
        <input type="hidden" name="metricas" value={JSON.stringify(metricas)} />
        <input type="hidden" name="numeroOrden" value={numeroOrden} />

        <CampoTexto
          id="titulo"
          label="Título"
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          required
          maxLength={200}
          autoFocus={enfocarTitulo}
          describedBy={tituloRepetido ? ID_AVISO_TITULO_REPETIDO : undefined}
          ayuda={tituloDetectado ? AYUDA_TITULO_SUGERIDO : AYUDA_TITULO_A_COMPLETAR}
        />

        {/* Se avisa, nunca se bloquea: dos controles del mismo tipo pueden
            llamarse igual con todo derecho, y quien decide es la persona.
            `estatica` porque el aviso puede estar en pantalla desde el
            arranque -un `role="alert"` en cada carga interrumpe al lector de
            pantalla sin motivo, ver `components/base/alerta.tsx`-; la
            asociación con el campo la da `describedBy` de arriba. */}
        {tituloRepetido && (
          <Alerta id={ID_AVISO_TITULO_REPETIDO} variante="advertencia" estatica>
            Ya tenés un estudio guardado con este mismo nombre. Podés cambiarlo para
            distinguirlos, o dejarlo así.
          </Alerta>
        )}

        {/* Chica (Sprint 13, tarea 13.3): fecha+categoría se agrupan en una
            grilla de 2 columnas -el mismo gap-5 que ya separaba estos campos
            como elementos sueltos del formulario ahora vive DENTRO del
            wrapper, así que el espaciado en grande queda pixel-a-pixel
            idéntico: el wrapper es un elemento más de la columna del
            formulario, no cambia cuántos "huecos" hay entre título, este par
            y el resto-. Título y resumen (los campos más largos) siguen a
            ancho completo en los dos modos. */}
        <div className="flex flex-col gap-5 chica:grid chica:grid-cols-2 chica:items-start chica:gap-3">
          <CampoTexto
            id="fecha"
            label="Fecha del estudio"
            type="date"
            defaultValue={fechaInicial}
            required
            max={fechaMaximaIso}
            min={FECHA_MINIMA_ISO}
            autoFocus={enfocarFecha}
            ayuda={
              fechaDetectada
                ? AYUDA_DETECTADO
                : faltaFecha
                  ? AYUDA_FECHA_FALTANTE
                  : AYUDA_NO_DETECTADO
            }
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
        </div>

        {/* Institución + especialidad + médico: misma idea, en una grilla de
            2 columnas que se completa en el orden de lectura de siempre
            -institución y especialidad en la primera fila, médico solo en la
            segunda-, sin reordenar el DOM. */}
        <div className="flex flex-col gap-5 chica:grid chica:grid-cols-2 chica:gap-3">
          <CampoTexto
            id="institucion"
            label="Institución"
            value={institucion}
            onChange={(evento) => setInstitucion(evento.target.value)}
            maxLength={150}
            ayuda={institucionDetectada ? AYUDA_DETECTADO : AYUDA_NO_DETECTADO}
          />

          <CampoTexto
            id="especialidad"
            label="Especialidad"
            defaultValue={especialidadInicial}
            maxLength={100}
            ayuda={especialidadDetectada ? AYUDA_DETECTADO : AYUDA_NO_DETECTADO}
          />

          <CampoTexto
            id="medico"
            label="Médico"
            value={medico}
            onChange={(evento) => setMedico(evento.target.value)}
            maxLength={100}
            ayuda={medicoDetectado ? AYUDA_DETECTADO : AYUDA_NO_DETECTADO}
          />
        </div>

        {/*
          Cruces inteligentes (agosto 2026): franjas discretas bajo
          institución/médico -ver el comentario de cabecera del archivo-.
          Cada una decide sola si tiene algo para ofrecer; sin coincidencia no
          se renderiza nada.
        */}
        <FranjaCandidatoLugar extraido={institucionParaFranja} onUsar={usarInstitucionDelCatalogo} />
        <FranjaCotejoMedico
          nombreExtraido={medicoParaFranja}
          directorio={medicos}
          contexto={{
            especialidad: mapearEspecialidadCatalogo(especialidadInicial),
            institucion,
            direccion: "",
            ciudad: "",
            provincia: "",
          }}
          onVincular={usarMedicoDelDirectorio}
          onAgregado={usarMedicoDelDirectorio}
        />

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
              {metricas.map((metrica, indice) => {
                // Sprint 19: un resultado sin número ("No Reactivo", "No se
                // observan espermatozoides") se muestra por su texto. Antes
                // esta fila quedaba vacía y la persona no tenía cómo saber
                // que el resultado estaba ahí. `numeros-clinicos` (cifras
                // tabulares) solo aplica al caso numérico.
                const esNumerico = typeof metrica.valor === "number"
                return (
                  <li
                    key={`${metrica.nombre}-${indice}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2 last:border-0 last:pb-0"
                  >
                    <span className="text-base font-medium text-foreground">{metrica.nombre}</span>
                    <span
                      className={cn(
                        "text-base text-muted-foreground",
                        esNumerico && "numeros-clinicos",
                      )}
                    >
                      {esNumerico ? `${metrica.valor} ${metrica.unidad}`.trim() : metrica.valorTexto}
                      {metrica.rango && ` (ref: ${metrica.rango})`}
                    </span>
                  </li>
                )
              })}
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

      <VeloEspera visible={pendienteConfirmar} mensaje="Guardando…" />
    </div>
  )
}
