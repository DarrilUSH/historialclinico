/**
 * Schema Zod para validar las extracciones de Gemini (`DocumentoMedicoExtraido`).
 *
 * Es un espejo estricto del `SCHEMA_DOCUMENTO_MEDICO` definido en
 * `lib/gemini/schemas.ts`, pero EJECUTABLE: valida el JSON crudo de Gemini
 * antes de persistirlo en la base de datos.
 *
 * Requisitos especiales:
 * - **Fechas:** formato `YYYY-MM-DD` con validación semántica (no 2026-02-30).
 * - **Strings:** `.trim()` para remover espacios; los descriptivos se RECORTAN
 *   al tope en vez de hacer fallar el parseo (ver más abajo).
 * - **Métricas:** nombre no vacío, valor numérico finito; el excedente por
 *   encima de 50 se recorta.
 * - **Mensajes:** en español, explícitos y entendibles para mostrar en log/UI.
 *
 * ## Qué RECORTA y qué RECHAZA, y por qué (Sprint 18)
 *
 * Hasta el Sprint 18 todos los `.max()` eran RECHAZOS: un campo largo de más
 * hacía fallar la extracción ENTERA y el documento se perdía. Los dos casos
 * reales que lo demostraron, medidos sobre los 47 documentos que el dueño
 * cargó de verdad:
 *
 * - Un `texto_completo` de **507** caracteres contra un tope de 500 -siete de
 *   más- tiró TRES extracciones completas.
 * - Un `rango` de referencia de **116** caracteres contra un tope de 100 -el
 *   laboratorio lo imprime en tres renglones, con los valores por edad y por
 *   trimestre de embarazo- tiró la extracción de **38 métricas** del
 *   laboratorio más completo del historial.
 *
 * En los dos casos el documento tenía TODO lo que hacía falta y se descartó
 * por un campo accesorio. La regla que sale de ahí, y que este archivo aplica:
 *
 * > Un campo DESCRIPTIVO largo de más se recorta y el documento sigue. Un
 * > campo de IDENTIDAD mal formado sí rechaza, porque un valor equivocado ahí
 * > vale menos que ningún valor.
 *
 * **Se recortan** (`textoRecortado`): `especialidad`, `institucion`, `medico`,
 * `resumen`, `texto_completo`, `paciente`, `metricas[].nombre`,
 * `metricas[].unidad`, `metricas[].rango`, y el excedente del array de
 * `metricas` por encima de 50. Todos son texto para leer o para titular: que
 * salgan cortados es una molestia visible y reparable a mano.
 *
 * **Siguen rechazando**, a propósito:
 * - `fecha`: es identidad y es la condición NECESARIA del detector de
 *   duplicados. Una fecha recortada (`"2026-03-1"`) o inventada es peor que no
 *   tener el documento: contamina Tendencias y el orden del historial.
 * - `categoria`: es un enum cerrado. Un valor fuera de la lista no se puede
 *   "recortar" a algo válido sin ELEGIR por el modelo, y elegir mal manda el
 *   estudio a la solapa equivocada. Fuera de la lista → a revisión humana.
 * - `metricas[].valor`: tiene que ser un número finito. Un valor recortado o
 *   coercionado es un dato clínico FALSO, que es exactamente lo que este
 *   sprint existe para impedir.
 * - `resumen` vacío: se recorta por arriba, pero el `.min(1)` queda. Un
 *   resumen vacío significa que el lector no entendió el documento.
 * - `metricas[].nombre` vacío: una métrica sin nombre no se puede guardar
 *   (`lab_metrics` tiene `UNIQUE (document_id, metric_name)`) ni mostrar.
 * - La forma general del objeto (`.strict()`): un campo de más o de menos es
 *   un cambio de contrato con el modelo, no un dato largo.
 *
 * Uso en `app/api/documentos/extraer/route.ts`:
 *   const resultado = validarExtraccion(datosDeGemini)
 *   if (!resultado.ok) {
 *     console.error("Datos inválidos:", resultado.errores)
 *     return json({ error: "..." }, 502)
 *   }
 *   // resultado.datos es seguro de persistir
 */

import { z } from 'zod'
import { sanearNumeroOrden } from '@/lib/documentos/numero-orden'
import type {
  CategoriaDocumentoExtraida,
  DocumentoMedicoConPacienteExtraido,
  DocumentoMedicoExtraido,
} from '@/lib/gemini/schemas'

/**
 * Valida que una string sea una fecha válida en formato YYYY-MM-DD.
 *
 * Rechaza:
 * - Formato incorrecto ("15/03/2026", "2026/03/15", vacío)
 * - Fechas inexistentes ("2026-02-30", "2026-13-01")
 * - Fechas con hora/zona horaria
 *
 * Acepta:
 * - Fechas correctamente formateadas en YYYY-MM-DD
 * - Fechas en el pasado, presente y futuro (el modelo puede a veces adivinar;
 *   el Route Handler es quien decide si rechaza fecha futura)
 *
 * Nota sobre parsing: el regex admite días hasta 31 (el refine lo deja pasar
 * para 2026-02-31 porque Date lo "ajusta" silenciosamente a marzo 3). El
 * approach conservador es: si el modelo devuelve "2026-02-30", sabemos que la
 * foto era ilegible. El refine parseá a las 12:00 UTC para evitar el pitfall
 * local del parsing de fecha-solo.
 */
function validarFecha(raw: unknown): { ok: boolean; error?: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'La fecha debe ser texto' }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'La fecha no puede estar vacía' }
  }

  // Validar formato YYYY-MM-DD
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return {
      ok: false,
      error: `La fecha debe estar en formato YYYY-MM-DD (recibido: "${trimmed}")`,
    }
  }

  const [, yearStr, monthStr, dayStr] = match
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)

  // Validaciones semánticas
  if (month < 1 || month > 12) {
    return { ok: false, error: `Mes inválido: ${month}` }
  }

  // Crear fecha a las 12:00 UTC para evitar ajustes de zona horaria local
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))

  // Si la fecha se "ajustó" silenciosamente (ej: 30 febrero → 2 marzo), rechazar
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return {
      ok: false,
      error: `Fecha inexistente: ${trimmed} (¿${month} tiene ${day} días?)`,
    }
  }

  return { ok: true }
}

/**
 * Un campo de texto DESCRIPTIVO: se limpia, y si se pasa del tope se RECORTA.
 * Nunca rechaza por largo.
 *
 * El recorte es por la DERECHA y termina con `trimEnd()` para no dejar un
 * espacio colgando, y el tope se aplica sobre el texto ya `trim()`eado: un
 * campo de 500 caracteres más espacios al final no se recorta, porque su
 * contenido real entra.
 *
 * Que esto no rechace es el punto del Sprint 18: perder precisión en un campo
 * accesorio es reparable a mano en la pantalla de revisión; perder el
 * documento entero no. Ver el encabezado del archivo para qué campos son
 * "descriptivos" y cuáles NO.
 */
function textoRecortado(max: number, mensajeDeTipo: string) {
  return z
    .string({ message: mensajeDeTipo })
    .trim()
    .transform((valor) => (valor.length > max ? valor.slice(0, max).trimEnd() : valor))
}

/**
 * Tope de métricas por documento. El excedente se DESCARTA (se queda con las
 * primeras 50) en vez de tirar la extracción: 50 métricas ya son un
 * laboratorio completo, y un documento con más es un documento igual de
 * válido con la cola cortada.
 */
const MAX_METRICAS = 50

/**
 * Schema Zod espejo de `SCHEMA_DOCUMENTO_MEDICO`.
 *
 * Todos los campos tienen mensajes custom en español. Las coerciones
 * (ej: `string().trim()`, `textoRecortado()`) aplican transformaciones sobre
 * el input, nunca rechazan — el esquema es quien decide si rechaza.
 *
 * Se exporta el OBJETO (y no un `.transform()` sobre él) a propósito: hay
 * código que usa `schemaExtraccionDocumento.shape.metricas` para validar
 * métricas sueltas (`app/(app)/(con-nav)/estudios/actions.ts`), y `.shape`
 * solo existe en un `ZodObject`. El saneamiento del número de orden -que
 * necesita mirar VARIOS campos a la vez- se aplica en `validarExtraccion`,
 * después del parseo.
 */
export const schemaExtraccionDocumento = z
  .object({
    fecha: z
      .string({ message: 'La fecha debe ser texto' })
      .trim()
      .max(10, 'La fecha es demasiado larga')
      .superRefine((raw, ctx) => {
        const validacion = validarFecha(raw)
        if (!validacion.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: validacion.error || 'Fecha inválida',
          })
        }
      }),

    // Descriptivos: se recortan al tope, nunca hacen fallar el documento.
    especialidad: textoRecortado(100, 'La especialidad debe ser texto'),

    institucion: textoRecortado(150, 'La institución debe ser texto'),

    medico: textoRecortado(100, 'El médico debe ser texto'),

    // Se recorta por arriba pero SIGUE rechazando si viene vacío: un resumen
    // vacío no es un resumen largo de más, es un documento que no se entendió.
    resumen: textoRecortado(500, 'El resumen debe ser texto').refine(
      (valor) => valor.length > 0,
      'El resumen no puede estar vacío',
    ),

    categoria: z.enum(['laboratory', 'imaging', 'prescription', 'consultation', 'other'], {
      message:
        'La categoría debe ser una de: laboratory, imaging, prescription, consultation, other',
    }),

    metricas: z
      .array(
        z.object(
          {
            // Mismo criterio que `resumen`: se recorta largo, se rechaza vacío.
            nombre: textoRecortado(100, 'El nombre de la métrica debe ser texto').refine(
              (valor) => valor.length > 0,
              'El nombre de la métrica no puede estar vacío',
            ),

            valor: z
              .number({ message: 'El valor debe ser un número' })
              .refine(
                (n) => Number.isFinite(n),
                'El valor debe ser un número finito (no Infinity ni NaN)',
              ),

            unidad: textoRecortado(50, 'La unidad debe ser texto'),

            // El caso real que costó 38 métricas: un laboratorio imprime el
            // rango de TSH en tres renglones (por edad y por trimestre de
            // embarazo) y sale de 116 caracteres. Se recorta y el laboratorio
            // entra completo.
            rango: textoRecortado(100, 'El rango debe ser texto'),
          },
          {
            message: 'Cada métrica debe tener nombre, valor, unidad y rango',
          },
        ),
      )
      .transform((metricas) =>
        metricas.length > MAX_METRICAS ? metricas.slice(0, MAX_METRICAS) : metricas,
      ),

    // El caso real que costó tres documentos: 507 caracteres contra un tope
    // de 500. Siete de más. Se recorta.
    texto_completo: textoRecortado(500, 'El texto completo debe ser texto').optional(),

    // Número de orden/protocolo del estudio (hotfix de duplicados semánticos):
    // mismo patrón opcional que `texto_completo` — no todo documento lo trae.
    //
    // Acá NO se le pone tope ni se lo recorta, y las dos cosas son a propósito:
    // recortar un identificador lo convierte en OTRO identificador, y este
    // campo decide identidad en la Capa 2 del detector de duplicados; y
    // rechazar por largo tiraría el documento entero por un campo accesorio,
    // que es justo lo que este archivo dejó de hacer. Todo el juicio -el largo
    // contra el CHECK `documents_numero_orden_valido`, la forma, el rótulo-
    // corre en `sanearNumeroOrden` después del parseo, y ante la duda deja el
    // campo en `undefined`.
    numero_orden: z.string({ message: 'El número de orden debe ser texto' }).trim().optional(),
  })
  .strict()

/**
 * Lo que devuelve el schema, con el `numero_orden` ya JUZGADO.
 *
 * El saneamiento no puede vivir dentro de un campo del schema porque necesita
 * mirar OTROS campos del mismo documento -la `categoria` (en un informe de
 * imágenes, el número sin rótulo es la accesión que el equipo quemó en la
 * placa) y el texto impreso, donde puede estar el rótulo que lo acredita-.
 * Ver `lib/documentos/numero-orden.ts` para la regla completa y la evidencia
 * real que la motiva.
 *
 * Cuando el número no se acredita, el campo queda en `undefined` -exactamente
 * como si el documento no lo trajera- y la Capa 2 del detector de duplicados
 * simplemente no se pronuncia. **Nunca hace fallar la extracción**: mismo
 * criterio que el resto del archivo.
 */
function conNumeroOrdenSaneado<T extends {
  categoria: string
  resumen: string
  texto_completo?: string
  numero_orden?: string
}>(datos: T): T {
  const acreditado = sanearNumeroOrden(datos.numero_orden, {
    categoria: datos.categoria as CategoriaDocumentoExtraida,
    textoDelDocumento: `${datos.texto_completo ?? ''} ${datos.resumen}`,
  })

  const saneados: Record<string, unknown> = { ...datos }
  if (acreditado === null) {
    // Se BORRA la clave, no se pone en `undefined`: el resultado tiene que ser
    // indistinguible de un documento que nunca trajo número de orden.
    delete saneados.numero_orden
  } else {
    saneados.numero_orden = acreditado
  }

  return saneados as T
}

/**
 * Valida un objeto desconocido contra el schema de extracción de Gemini.
 *
 * @param data - JSON desconocido (típicamente la respuesta cruda de Gemini).
 * @returns `{ ok: true, datos }` si es válido; `{ ok: false, errores }` si no.
 *
 * Los errores son siempre un array de strings en español, explícitos y listos
 * para loguear o mostrar.
 *
 * @example
 *   const resultado = validarExtraccion(respuestaDeGemini)
 *   if (!resultado.ok) {
 *     console.error("Validación fallida:", resultado.errores)
 *     return json({ error: "Datos inválidos de Gemini" }, 502)
 *   }
 *   await supabase.from("documents").update({ ai_summary: resultado.datos.resumen })
 */
export function validarExtraccion(
  data: unknown,
): { ok: true; datos: DocumentoMedicoExtraido } | { ok: false; errores: string[] } {
  const resultado = schemaExtraccionDocumento.safeParse(data)

  if (resultado.success) {
    return {
      ok: true,
      datos: conNumeroOrdenSaneado(resultado.data) as DocumentoMedicoExtraido,
    }
  }

  const errores = resultado.error.issues.map((err) => {
    const path = err.path.length > 0 ? `${err.path.join('.')}` : '(raíz)'
    return `[${path}] ${err.message}`
  })

  return {
    ok: false,
    errores,
  }
}

/**
 * Espejo Zod de `SCHEMA_DOCUMENTO_MEDICO_CON_PACIENTE` — **solo para el camino
 * automático** (auto-carga sin dudas, Sprint 17).
 *
 * Se deriva con `.extend()` del schema de siempre en vez de copiarlo: las
 * validaciones de fecha, resumen, categoría y métricas son literalmente las
 * mismas objetos Zod, así que no pueden divergir. `.extend()` sobre un schema
 * `.strict()` conserva el `.strict()`: una respuesta con un campo de más sigue
 * siendo rechazada.
 *
 * `paciente` es `.optional()` por el mismo motivo que en el tipo TypeScript: si
 * el modelo lo omite, la compuerta lo trata como duda y el correo va a revisión
 * humana. Nunca se persiste.
 */
export const schemaExtraccionDocumentoConPaciente = schemaExtraccionDocumento.extend({
  paciente: textoRecortado(150, 'El nombre del paciente debe ser texto').optional(),
})

/**
 * Valida la respuesta cruda de Gemini del camino automático.
 *
 * Mismo contrato que `validarExtraccion`: `{ ok: true, datos }` o
 * `{ ok: false, errores }` con mensajes en español que describen la
 * ESTRUCTURA, nunca el contenido recibido — así son seguros de loguear
 * (`docs/minimizacion-datos.md` §6). En particular, un error de este validador
 * jamás incluye el nombre del paciente.
 */
export function validarExtraccionConPaciente(
  data: unknown,
): { ok: true; datos: DocumentoMedicoConPacienteExtraido } | { ok: false; errores: string[] } {
  const resultado = schemaExtraccionDocumentoConPaciente.safeParse(data)

  if (resultado.success) {
    return {
      ok: true,
      datos: conNumeroOrdenSaneado(resultado.data) as DocumentoMedicoConPacienteExtraido,
    }
  }

  const errores = resultado.error.issues.map((err) => {
    const path = err.path.length > 0 ? `${err.path.join('.')}` : '(raíz)'
    return `[${path}] ${err.message}`
  })

  return { ok: false, errores }
}
