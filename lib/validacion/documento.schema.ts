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
 * - `fecha` MAL FORMADA: es identidad y es la condición NECESARIA del detector
 *   de duplicados. Una fecha recortada (`"2026-03-1"`) o imposible
 *   (`"2026-02-30"`) es peor que no tener el documento: contamina Tendencias y
 *   el orden del historial. Ver abajo la diferencia con la fecha AUSENTE.
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
 * ## Sprint 19 — las dos excepciones que salieron de medir el pipeline
 *
 * ### `fecha: null` ACEPTADA (fecha ausente ≠ fecha mal formada)
 *
 * Hasta el Sprint 18, `fecha` era `z.string()` con formato obligatorio: ni
 * `null` ni `""` pasaban. Y el prompt le pedía a Gemini justamente `""`
 * cuando el documento no trae fecha, así que un modelo OBEDIENTE tiraba la
 * extracción entera. El incentivo real, entonces, era desobedecer e inventar
 * — y eso es lo que la medición encontró: dos fechas inventadas de la nada
 * (`2024-03-12`, `2024-02-14`) y una robada de un estudio previo citado en el
 * texto (`2025-10-29` en una colangio-RMN del 3 de noviembre).
 *
 * La regla nueva distingue dos cosas que antes eran la misma:
 *
 * - **Fecha AUSENTE** (`null` o `""`) → se normaliza a `null` y el documento
 *   SIGUE. Es la única excepción que vale la pena en "la identidad no se
 *   recorta": no se recorta nada, se acepta un "no la sé" honesto. Todo el
 *   resto del documento -resumen, métricas, institución- sigue siendo valioso,
 *   y la pantalla de revisión pide la fecha con el foco puesto ahí y no deja
 *   confirmar sin ella (`components/documentos/formulario-revision.tsx`).
 * - **Fecha MAL FORMADA** (`"15/03/2026"`, `"2026-02-30"`, `"2026-03-1"`) →
 *   sigue RECHAZANDO. Un valor así no es "no la sé": es una lectura
 *   equivocada, y convertirla en `null` en silencio taparía un problema
 *   sistemático del lector.
 *
 * Ningún RPC cambia: `confirmar_documento_recien_subido` e
 * `ingresar_documento_automatico` siguen exigiendo `nueva_fecha`/`p_fecha` no
 * nulas. El `null` vive y muere ANTES de esos dos puntos — lo resuelve una
 * persona en el formulario, o la compuerta de auto-carga manda el correo a
 * revisión (`fecha_no_confiable`, `lib/gmail/auto-ingesta.ts`).
 *
 * ### Métricas: valor numérico **O** resultado cualitativo
 *
 * `lab_metrics.value` es nullable y existe `value_text` desde
 * `20260819190000_lab_metrics_resultados_cualitativos.sql`, con el CHECK
 * `lab_metrics_valor_o_texto` (al menos uno de los dos). `prepararMetricas`
 * ya sabía leer `valorTexto` desde el Sprint 18. Lo que faltaba era este
 * archivo -y el `responseSchema`-: acá `valor` era `z.number()` a secas y
 * `valorTexto` ni se aceptaba, así que Zod lo stripeaba en silencio. Medido:
 * de 5 resultados cualitativos del corpus real ("VDRL / HBsAg / Hepatitis C:
 * No Reactivo" del laboratorio más completo del dueño, el espermograma
 * post-vasectomía), se guardaron 0.
 *
 * Ahora `valor` acepta `number | null` y `valorTexto` es un descriptivo más
 * (se recorta a 300, el mismo tope que valida el RPC). Una métrica que no
 * trae NINGUNO de los dos no describe ninguna medición: se DESCARTA esa
 * métrica sola -no tiene nada que guardar, y `prepararMetricas` la descartaría
 * igual- y el documento sigue con el resto. Es la misma lección del Sprint 18
 * llevada al array: no se pierden 38 métricas buenas por una vacía.
 *
 * ## Sprint 20 — dos campos nuevos, y por qué NINGUNO puede tirar el documento
 *
 * `intencion` (para qué sirve el papel) y `medicamentos` (los renglones de una
 * receta) entran como `.optional()`, no como campos obligatorios del espejo. No
 * es descuido: este mismo schema valida los jsonb `documents.ai_extraction` que
 * ya estaban guardados ANTES del sprint y que no traen ninguno de los dos.
 * Exigirlos convertiría en "ilegible" a todo documento que estuviera esperando
 * revisión el día del deploy. Quien los lee lo hace con
 * `intencionDeExtraccion(...)` y `medicamentos ?? []`
 * (`lib/documentos/intencion.ts`), que devuelven el comportamiento previo al
 * sprint cuando no vinieron.
 *
 * Lo que SÍ rechaza es una `intencion` presente pero fuera del enum, por el
 * mismo motivo que `categoria`: elegir un valor válido en su lugar sería
 * decidir por el modelo hacia dónde rutear un papel médico.
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
    // Esta rama ya no se alcanza desde `schemaExtraccionDocumento` -la fecha
    // vacía se normaliza a `null` antes, ver el encabezado del archivo-, pero
    // la función sigue siendo total: es pública para el resto del código y no
    // tiene por qué asumir que la llaman ya normalizada.
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
 * Deja el array de métricas listo para `MetricaExtraida[]`:
 *
 * 1. `valor` SIEMPRE presente (`number | null`), aunque el modelo lo omita —
 *    así el tipo de salida es el del contrato y no un `?` accidental.
 * 2. `valorTexto` vacío se OMITE: la cadena vacía no es un resultado
 *    cualitativo, y dejarla puesta solo engorda el JSON del campo oculto del
 *    formulario.
 * 3. Una métrica sin valor numérico Y sin texto se DESCARTA (ella sola, no el
 *    documento): no describe ninguna medición, el CHECK
 *    `lab_metrics_valor_o_texto` la rechazaría y `prepararMetricas` la
 *    saltearía igual. Ver el encabezado del archivo.
 * 4. El excedente por encima de `MAX_METRICAS` se corta, como antes.
 */
function normalizarMetricas(
  metricas: readonly {
    nombre: string
    valor?: number | null
    valorTexto?: string
    unidad: string
    rango: string
  }[],
) {
  const utiles = metricas
    .map((metrica) => ({
      ...metrica,
      valor: typeof metrica.valor === 'number' ? metrica.valor : null,
      valorTexto:
        metrica.valorTexto && metrica.valorTexto.length > 0 ? metrica.valorTexto : undefined,
    }))
    .filter((metrica) => metrica.valor !== null || metrica.valorTexto !== undefined)

  return utiles.length > MAX_METRICAS ? utiles.slice(0, MAX_METRICAS) : utiles
}

/**
 * Tope de medicamentos por documento. Mismo criterio que `MAX_METRICAS`: el
 * excedente se DESCARTA en vez de tirar la extracción. Veinte renglones ya son
 * una lista de remedios larguísima para una persona.
 */
const MAX_MEDICAMENTOS = 20

/**
 * Deja la lista de medicamentos lista para `MedicamentoExtraido[]`:
 *
 * 1. Los cuatro campos que no son el nombre pasan a cadena vacía cuando el
 *    modelo los omite — así el tipo de salida es el del contrato y quien lo
 *    consume no tiene que distinguir `undefined` de `""`. Los dos significan lo
 *    mismo: **el papel no lo dice**.
 * 2. Un medicamento sin nombre no se puede mostrar ni cargar: se descarta ese
 *    solo (no el documento). Zod ya lo rechaza por el `.refine`, pero el filtro
 *    queda por si el recorte lo deja vacío.
 * 3. El excedente por encima de `MAX_MEDICAMENTOS` se corta.
 */
function normalizarMedicamentos(
  medicamentos: readonly {
    nombre: string
    droga?: string
    presentacion?: string
    dosis_texto?: string
    frecuencia_texto?: string
  }[],
) {
  const utiles = medicamentos
    .filter((medicamento) => medicamento.nombre.length > 0)
    .map((medicamento) => ({
      nombre: medicamento.nombre,
      droga: medicamento.droga ?? '',
      presentacion: medicamento.presentacion ?? '',
      dosis_texto: medicamento.dosis_texto ?? '',
      frecuencia_texto: medicamento.frecuencia_texto ?? '',
    }))

  return utiles.length > MAX_MEDICAMENTOS ? utiles.slice(0, MAX_MEDICAMENTOS) : utiles
}

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
    // Nombre del estudio dicho por el MODELO (Sprint 19). Descriptivo: se
    // recorta al tope del campo del formulario (`maxLength={200}`), nunca
    // rechaza. `.optional()` aunque el `responseSchema` lo pida en `required`,
    // por el mismo criterio defensivo que `paciente`: si el modelo lo omite,
    // `sugerirTitulo` cae al título genérico compuesto y la UI lo marca como
    // NO detectado, que es exactamente lo que corresponde.
    titulo: textoRecortado(200, 'El título debe ser texto').optional(),

    // Fecha AUSENTE (`null` o cadena vacía) -> `null`, y el documento sigue.
    // Fecha MAL FORMADA -> sigue rechazando. Ver el encabezado del archivo
    // para la evidencia medida detrás de esta distinción.
    fecha: z
      .union([z.string(), z.null()], { message: 'La fecha debe ser texto o null' })
      .superRefine((raw, ctx) => {
        if (raw === null) return

        const limpia = raw.trim()
        if (limpia.length === 0) return

        if (limpia.length > 10) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha es demasiado larga' })
          return
        }

        const validacion = validarFecha(limpia)
        if (!validacion.ok) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: validacion.error || 'Fecha inválida',
          })
        }
      })
      .transform((raw) => {
        if (raw === null) return null
        const limpia = raw.trim()
        return limpia.length === 0 ? null : limpia
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

            // `null` = el resultado no es numérico y vive en `valorTexto`
            // (Sprint 19). Un valor PRESENTE que no sea un número finito sigue
            // rechazando: eso no es "no lo sé", es un dato clínico falso, que
            // es exactamente lo que este archivo existe para impedir.
            valor: z
              .union([z.number(), z.null()], {
                message: 'El valor debe ser un número finito o null',
              })
              .optional()
              .refine(
                (n) => n === undefined || n === null || Number.isFinite(n),
                'El valor debe ser un número finito (no Infinity ni NaN)',
              ),

            // Resultado CUALITATIVO ("No Reactivo", "No se observan
            // espermatozoides"). Descriptivo: se recorta a 300, el mismo tope
            // que valida el RPC sobre `lab_metrics.value_text`.
            valorTexto: textoRecortado(300, 'El resultado cualitativo debe ser texto').optional(),

            unidad: textoRecortado(50, 'La unidad debe ser texto'),

            // El caso real que costó 38 métricas: un laboratorio imprime el
            // rango de TSH en tres renglones (por edad y por trimestre de
            // embarazo) y sale de 116 caracteres. Se recorta y el laboratorio
            // entra completo.
            rango: textoRecortado(100, 'El rango debe ser texto'),
          },
          {
            message: 'Cada métrica debe tener nombre, y un valor numérico o un resultado en texto',
          },
        ),
      )
      .transform(normalizarMetricas),

    // Para qué sirve el papel (Sprint 20). `.optional()` con dos motivos, y
    // ninguno es pereza:
    //
    // 1. Este schema también valida jsonb `ai_extraction` guardados ANTES del
    //    Sprint 20, que no traen el campo. Rechazarlos convertiría documentos
    //    que estaban esperando revisión en documentos ilegibles.
    // 2. Es la lección del Sprint 18 aplicada a un campo nuevo: perder la
    //    extracción entera porque el modelo omitió la clasificación sería
    //    exactamente el error que este archivo existe para no repetir.
    //
    // Un valor PRESENTE pero fuera del enum sí rechaza, igual que `categoria`:
    // es un enum cerrado, y "corregirlo" a algo válido sería elegir por el
    // modelo hacia dónde rutear un papel médico.
    intencion: z
      .enum(
        ['estudio_realizado', 'receta_o_medicacion', 'turno_o_cita', 'orden_de_practica', 'otro'],
        {
          message:
            'La intención debe ser una de: estudio_realizado, receta_o_medicacion, turno_o_cita, orden_de_practica, otro',
        },
      )
      .optional(),

    // Medicamentos de una receta o de una lista de remedios (Sprint 20).
    // Opcional por los mismos dos motivos que `intencion`, y con la misma
    // política de recorte que `metricas`: los campos son todos DESCRIPTIVOS
    // -texto para mostrar y para que una persona corrija-, así que se recortan
    // y nunca hacen fallar el documento.
    //
    // `dosis_texto` y `frecuencia_texto` son texto LITERAL a propósito: no hay
    // acá ningún `z.number()` de dosis donde un valor inventado pudiera
    // colarse con forma de dato válido. La traducción a los campos del
    // formulario -y su negativa a adivinar- vive en
    // `lib/medicacion/desde-documento.ts`.
    medicamentos: z
      .array(
        z.object(
          {
            nombre: textoRecortado(200, 'El nombre del medicamento debe ser texto').refine(
              (valor) => valor.length > 0,
              'El nombre del medicamento no puede estar vacío',
            ),
            droga: textoRecortado(150, 'La droga debe ser texto').optional(),
            presentacion: textoRecortado(150, 'La presentación debe ser texto').optional(),
            dosis_texto: textoRecortado(150, 'La dosis debe ser texto').optional(),
            frecuencia_texto: textoRecortado(150, 'La frecuencia debe ser texto').optional(),
          },
          { message: 'Cada medicamento debe tener al menos un nombre' },
        ),
      )
      .transform(normalizarMedicamentos)
      .optional(),

    // El caso real que costó tres documentos: 507 caracteres contra un tope
    // de 500. Siete de más. Se recorta.
    //
    // Sprint 20: el tope sube de 500 a 2000 porque un turno o una orden piden
    // TRANSCRIPCIÓN LITERAL, no extracto -es el único insumo con el que después
    // se arman los turnos, y un dato que no entre acá se pierde-. Para los
    // estudios el prompt sigue pidiendo ≤500, así que su lectura no cambia; y
    // `documents.raw_ocr_text` sigue recortándose a 500 en
    // `app/api/documentos/extraer/route.ts`, así que la columna tampoco cambia.
    // El texto largo vive solo en el jsonb transitorio `ai_extraction`, que se
    // limpia al confirmar.
    texto_completo: textoRecortado(2000, 'El texto completo debe ser texto').optional(),

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

    // El RÓTULO impreso al lado del número (Sprint 19), la entrada nueva de
    // `sanearNumeroOrden`. Descriptivo -no es identidad, es la EVIDENCIA con
    // la que se juzga la identidad-: se recorta y nunca hace fallar el
    // documento. Se consume en `conNumeroOrdenSaneado` y no se persiste en
    // ninguna columna.
    numero_orden_rotulo: textoRecortado(
      100,
      'El rótulo del número de orden debe ser texto',
    ).optional(),
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
  numero_orden_rotulo?: string
}>(datos: T): T {
  const acreditado = sanearNumeroOrden(datos.numero_orden, {
    categoria: datos.categoria as CategoriaDocumentoExtraida,
    textoDelDocumento: `${datos.texto_completo ?? ''} ${datos.resumen}`,
    // Sprint 19: el rótulo que el lector copió del documento. Es lo que
    // devuelve la Capa 2 a la vida para los números de orden que son una tira
    // de dígitos corridos -los 5 reales del laboratorio del dueño-, sin
    // aflojar ninguno de los rechazos del Sprint 18.
    rotulo: datos.numero_orden_rotulo,
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
