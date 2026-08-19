/**
 * Banco de pruebas SINTÉTICO de documentos médicos.
 *
 * El dueño de la app cargó 47 documentos REALES de una sola clínica
 * (Clínica/Sanatorio San Jorge, Ushuaia) para probar la extracción con Gemini,
 * y la IA cometió 37 errores. De ahí salieron las cuatro reglas endurecidas del
 * Sprint 18. El problema: como el dueño no tiene documentos de NINGUNA otra
 * institución, no hay forma de comprobar con material real que esas reglas sean
 * GENERALES y no hayan quedado ajustadas al formato particular de San Jorge —
 * sus rótulos, su manera de fechar, su numeración de órdenes.
 *
 * Este archivo es ese banco alternativo: 16 casos con instituciones ficticias
 * de OTRAS provincias argentinas, cada uno ejercitando un formato o un rótulo
 * distinto (protocolo, orden alfanumérica, solicitud, número de registro,
 * accesión DICOM, número de internación, código de equipo, fechas en letras,
 * fechas contradictorias, rangos en varios renglones, texto largo, apellido
 * truncado, código interno de paciente, DNI mal leído). Ninguna institución,
 * ningún rótulo y ningún formato imita a San Jorge.
 *
 * **DATOS DE PACIENTE 100% FICTICIOS.** No corresponden a ninguna persona real.
 * Se usan dos identidades inventadas en todo el banco:
 *   - Paciente A: María Luján Gregorio, DNI 28.114.902, n. 15/06/1985.
 *   - Paciente B: Roberto Carlos Ferreyra, DNI 22.907.318.
 *
 * Cada caso tiene:
 *   - un `.txt` hermano (mismo id) = el documento impreso tal como lo leería un
 *     OCR: membrete, datos del paciente, tabla de resultados, firma. Texto
 *     plano, UTF-8 sin BOM. Algunos están escritos SIN tildes a propósito: los
 *     sistemas de gestión viejos que usan muchos laboratorios imprimen así, y
 *     que el cotejo de nombres lo tolere es parte de lo que se prueba.
 *   - una `extraccion` = el JSON CRUDO que Gemini devolvería al leer ese texto,
 *     ANTES de pasar por ninguna validación. Por eso incluye a propósito
 *     extracciones EQUIVOCADAS -números de serie confundidos con número de
 *     orden, accesiones DICOM, fechas mal elegidas- cuando esa es justamente la
 *     regla que el caso ejercita: lo que se prueba es el validador, no este
 *     catálogo.
 *
 * Sobre los campos ausentes: hasta el Sprint 18, cuando un campo no estaba en
 * el documento Gemini devolvía cadena vacía (`""`) y nunca `null`. Desde el
 * Sprint 19 hay UNA excepción declarada en el contrato: `fecha` puede venir
 * `null` cuando el documento no imprime su propia fecha
 * (`lib/gemini/schemas.ts`), y el validador la acepta -campo vacío en la
 * pantalla, que la complete una persona- en vez de tirar la extracción entera
 * y empujar al modelo a inventar. Todos los demás campos siguen usando la
 * cadena vacía.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const CARPETA = dirname(fileURLToPath(import.meta.url))

export interface CasoSintetico {
  /** Igual al nombre del `.txt` sin extensión. */
  id: string
  /** Institución ficticia que emite el documento. */
  institucion: string
  /** Qué regla del Sprint 18 valida este fixture (frase corta). */
  regla: string
  /** El documento impreso, leído del `.txt` hermano. */
  texto: string
  /** Lo que Gemini devolvería al leer ese texto: JSON CRUDO, sin validar. */
  extraccion: Record<string, unknown>
}

const DEFINICIONES: readonly Omit<CasoSintetico, "texto">[] = [
  {
    id: "01-bioquimico-del-sur-protocolo",
    institucion: "Laboratorio Bioquímico del Sur",
    regla: 'Formato alternativo: rótulo "Protocolo N°" y doble fecha rotulada (extracción vs. informe). El rótulo queda en `texto_completo`, así que el número SÍ se acredita.',
    extraccion: {
      fecha: "2026-03-04",
      especialidad: "Bioquímica",
      institucion: "Laboratorio Bioquímico del Sur",
      medico: "Dr. Gustavo Peralta",
      resumen: "Hemograma completo dentro de parámetros normales.",
      categoria: "laboratory",
      numero_orden: "24601",
      texto_completo:
        "Protocolo N°: 24601. Metodología: contador hematológico automatizado. " +
        "Tipo de muestra: sangre venosa con EDTA. Observaciones: sin observaciones.",
      paciente: "GREGORIO, MARIA LUJAN",
      metricas: [
        { nombre: "Hematocrito", valor: 42.5, unidad: "%", rango: "38,0 - 47,0" },
        { nombre: "Hemoglobina", valor: 14.1, unidad: "g/dl", rango: "12,0 - 16,0" },
        { nombre: "Eritrocitos", valor: 4.52, unidad: "millones/mm³", rango: "4,00 - 5,40" },
        { nombre: "Leucocitos", valor: 6800, unidad: "/mm³", rango: "4500 - 11000" },
        { nombre: "Plaquetas", valor: 245000, unidad: "/mm³", rango: "150000 - 450000" },
      ],
    },
  },
  {
    id: "02-centro-vega-orden-alfanumerica",
    institucion: "Centro de Análisis Clínicos Vega",
    regla: 'Número de orden ALFANUMÉRICO con guion ("887-2026") + fecha escrita en letras. Se acredita por FORMA: ningún DNI ni accesión se imprime con guion.',
    extraccion: {
      fecha: "2026-02-12",
      especialidad: "Análisis Clínicos",
      institucion: "Centro de Análisis Clínicos Vega",
      medico: "Dra. Valeria Nuñez",
      resumen: "Perfil lipídico con colesterol total y triglicéridos levemente elevados.",
      categoria: "laboratory",
      numero_orden: "887-2026",
      paciente: "FERREYRA, ROBERTO CARLOS",
      metricas: [
        { nombre: "Colesterol total", valor: 210, unidad: "mg/dl", rango: "Deseable: < 200" },
        { nombre: "Triglicéridos", valor: 165, unidad: "mg/dl", rango: "Normal: < 150" },
        { nombre: "Colesterol HDL", valor: 42, unidad: "mg/dl", rango: "Deseable: > 40" },
      ],
    },
  },
  {
    id: "03-hospital-zonal-solicitud",
    institucion: "Hospital Zonal de Trelew",
    regla: 'Tercer sinónimo de rótulo ("Solicitud") + código con prefijo de letras ("OP-3391"): se acredita por FORMA.',
    extraccion: {
      fecha: "2026-01-21",
      especialidad: "Bioquímica",
      institucion: "Hospital Zonal de Trelew",
      medico: "Dr. Hugo Aguirre",
      resumen: "Glucemia y creatinina dentro de valores normales.",
      categoria: "laboratory",
      numero_orden: "OP-3391",
      paciente: "GREGORIO, MARIA LUJAN",
      metricas: [
        { nombre: "Glucemia", valor: 92, unidad: "mg/dl", rango: "70 - 100" },
        { nombre: "Creatinina", valor: 0.78, unidad: "mg/dl", rango: "0,50 - 1,10" },
      ],
    },
  },
  {
    id: "04-imagenes-vega-registro-dos-medicos",
    institucion: "Imágenes Diagnósticas del Litoral",
    regla: 'Dos médicos rotulados por separado (solicitante/informante) + rótulo "N° de registro" en un informe de IMÁGENES: en imágenes solo se acredita con rótulo explícito, y acá lo hay.',
    extraccion: {
      fecha: "2026-04-09",
      especialidad: "Diagnóstico por imágenes",
      institucion: "Imágenes Diagnósticas del Litoral",
      medico: "Dra. Silvana Roldán",
      resumen: "Resonancia magnética de rodilla derecha sin hallazgos patológicos significativos, leve derrame articular.",
      categoria: "imaging",
      numero_orden: "R-2026-0447",
      texto_completo:
        "N° de registro: R-2026-0447. Técnica: secuencias multiplanares T1, T2 y DP con " +
        "saturación grasa. Médico solicitante: Dr. Aníbal Sarmiento (M.P. 4412).",
      paciente: "FERREYRA, ROBERTO CARLOS",
      metricas: [],
    },
  },
  {
    id: "05-radiografia-accesion-dicom",
    institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
    regla: "Número de accesión DICOM (patrón \\d{6,}\\.\\d{2}) tomado como número de orden — debe RECHAZARSE.",
    extraccion: {
      fecha: "2026-05-18",
      especialidad: "Diagnóstico por imágenes",
      institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
      medico: "",
      resumen: "Radiografía de tórax frente sin infiltrados ni consolidaciones, silueta cardíaca conservada.",
      categoria: "imaging",
      numero_orden: "15570342.01",
      paciente: "GREGORIO MARIA LUJAN",
      metricas: [],
    },
  },
  {
    id: "06-columna-lumbar-frente",
    institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
    regla: "Accesión SIN ningún rótulo en un estudio de imágenes — se rechaza; y es la mitad del par de falso positivo de la Capa 3, junto con el caso 07.",
    extraccion: {
      fecha: "2026-05-18",
      especialidad: "Diagnóstico por imágenes",
      institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
      medico: "",
      resumen: "Radiografía de columna lumbar, vista frente: rectificación leve de la lordosis fisiológica, sin lesiones óseas agudas.",
      categoria: "imaging",
      numero_orden: "11021738",
      paciente: "GREGORIO MARIA LUJAN",
      metricas: [],
    },
  },
  {
    id: "07-columna-lumbar-perfil",
    institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
    regla: "Dos vistas del MISMO estudio que comparten accesión (idéntica a la del caso 06) — ni la Capa 2 ni la Capa 3 pueden marcarlas como duplicadas entre sí.",
    extraccion: {
      fecha: "2026-05-18",
      especialidad: "Diagnóstico por imágenes",
      institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
      medico: "",
      resumen: "Radiografía de columna lumbar, vista perfil: disminución leve del espacio intervertebral L4-L5, sin otros hallazgos.",
      categoria: "imaging",
      numero_orden: "11021738",
      paciente: "GREGORIO MARIA LUJAN",
      metricas: [],
    },
  },
  {
    id: "08-guardia-numero-de-internacion",
    institucion: "Sanatorio Los Alerces",
    regla: "Número de internación con relleno de ceros tomado como número de orden — se rechaza (no es una orden).",
    extraccion: {
      fecha: "2026-06-02",
      especialidad: "Clínica Médica",
      institucion: "Sanatorio Los Alerces",
      medico: "Dra. Cecilia Bravo",
      resumen: "Paciente ingresa por dolor abdominal agudo, evoluciona favorablemente, se otorga alta con indicaciones.",
      categoria: "consultation",
      numero_orden: "00176828",
      paciente: "FERREYRA, ROBERTO CARLOS",
      metricas: [],
      texto_completo:
        "Epicrisis de guardia. N° de Internación: 00176828. Paciente ingresa por dolor abdominal agudo de 6 horas de evolución, evoluciona favorablemente con analgesia y observación, y se otorga alta con indicaciones de control por consultorio externo en 48 horas.",
    },
  },
  {
    id: "09-ecografia-codigo-de-equipo",
    institucion: "Instituto de Ecografía del Valle",
    regla: "Número de serie del EQUIPO (S/N) tomado como número de orden — se rechaza.",
    extraccion: {
      fecha: "2026-07-03",
      especialidad: "Diagnóstico por imágenes",
      institucion: "Instituto de Ecografía del Valle",
      medico: "Dr. Matías Coronel",
      resumen: "Ecografía abdominal sin alteraciones morfológicas relevantes en órganos evaluados.",
      categoria: "imaging",
      numero_orden: "88234512",
      paciente: "GREGORIO, MARIA LUJAN",
      metricas: [],
      texto_completo:
        "Ecografía abdominal completa sin alteraciones morfológicas relevantes en los órganos evaluados. Equipo: GE LOGIQ P9 - S/N 88234512.",
    },
  },
  {
    id: "10-informe-sin-numero-de-orden",
    institucion: "Consultorios Médicos San Martín",
    regla: "Documento SIN número de orden — el campo queda vacío y la Capa 2 simplemente no aplica.",
    extraccion: {
      fecha: "2026-03-27",
      especialidad: "Clínica Médica",
      institucion: "Consultorios Médicos San Martín",
      medico: "Dr. Ricardo Funes",
      resumen: "Consulta de control clínico general, paciente asintomático, se indican pautas de alarma.",
      categoria: "consultation",
      numero_orden: "",
      paciente: "FERREYRA, ROBERTO CARLOS",
      metricas: [],
    },
  },
  {
    id: "11-laboratorio-dos-fechas-contradictorias",
    institucion: "Laboratorio Central de Tandil",
    regla: "Dos fechas contradictorias (el informe es anterior a la extracción: cronológicamente imposible) — caso hostil para la validación de fecha.",
    extraccion: {
      fecha: "2026-04-30",
      especialidad: "Bioquímica",
      institucion: "Laboratorio Central de Tandil",
      medico: "Dra. Norma Villalba",
      resumen: "Glucemia y urea dentro de valores normales.",
      categoria: "laboratory",
      numero_orden: "P-55120",
      paciente: "GREGORIO, MARIA LUJAN",
      metricas: [
        { nombre: "Glucemia", valor: 98, unidad: "mg/dl", rango: "70 - 100" },
        { nombre: "Urea", valor: 32, unidad: "mg/dl", rango: "10 - 50" },
      ],
    },
  },
  {
    id: "12-laboratorio-rango-en-tres-renglones",
    institucion: "Laboratorio de Endocrinologia Pampeana",
    regla: "`rango` larguísimo, de 116 caracteres (impreso en tres renglones, por edad y por trimestre de embarazo) — debe RECORTARSE, jamás tirar la extracción entera.",
    extraccion: {
      fecha: "2026-02-19",
      especialidad: "Endocrinología",
      institucion: "Laboratorio de Endocrinología Pampeana",
      medico: "Dra. Beatriz Coria",
      resumen: "Perfil tiroideo dentro de parámetros normales para adulto.",
      categoria: "laboratory",
      numero_orden: "PROT-9087",
      paciente: "GREGORIO, MARIA LUJAN",
      metricas: [
        {
          nombre: "TSH",
          valor: 2.1,
          unidad: "uUI/ml",
          rango:
            "Adultos: 0,40 - 4,00 uUI/ml; Embarazo 1er trimestre: 0,10 - 2,50 uUI/ml; 2do y 3er trimestre: 0,20 - 3,00 uUI/ml (*)",
        },
        { nombre: "T4 libre", valor: 1.15, unidad: "ng/dl", rango: "0,80 - 1,90" },
        { nombre: "T3 total", valor: 110, unidad: "ng/dl", rango: "80 - 200" },
      ],
    },
  },
  {
    id: "13-consulta-texto-completo-507",
    institucion: "Policlínico Regional del Comahue",
    regla: "`texto_completo` que se pasa por 7 caracteres del tope de 500 (mide 507) — debe RECORTARSE, jamás tirar la extracción entera.",
    extraccion: {
      fecha: "2026-01-08",
      especialidad: "Cardiología",
      institucion: "Policlínico Regional del Comahue",
      medico: "Dr. Sebastián Molina",
      resumen: "Control cardiológico de rutina, paciente estable, sin cambios en el ECG respecto al previo.",
      categoria: "consultation",
      numero_orden: "",
      paciente: "FERREYRA, ROBERTO CARLOS",
      metricas: [],
      texto_completo:
        "Paciente Roberto Carlos Ferreyra concurre a control cardiologico de rutina, refiere buen estado general sin dolor precordial ni disnea de esfuerzo en el ultimo mes. Antecedentes de hipertension arterial en tratamiento con enalapril 10 mg cada 12 horas, buena adherencia. Al examen: TA 128/82 mmHg, FC 74 lpm, regular, ruidos cardiacos normales sin soplos, pulsos perifericos presentes y simetricos. ECG de control sin cambios, respecto al previo. Se indica continuar tratamiento actual y control en 6 meses.",
    },
  },
  {
    id: "14-laboratorio-apellido-truncado",
    institucion: "Laboratorio Bioquímico del Sur",
    regla: "Apellido truncado por el sistema del laboratorio (falta la última letra) — la titularidad no se puede RECHAZAR por eso; queda a confirmar.",
    extraccion: {
      fecha: "2026-08-05",
      especialidad: "Bioquímica",
      institucion: "Laboratorio Bioquímico del Sur",
      medico: "Dr. Gustavo Peralta",
      resumen: "Glucemia y colesterol total dentro de parámetros normales.",
      categoria: "laboratory",
      numero_orden: "24988",
      paciente: "GREGORI, MARIA LUJAN",
      metricas: [
        { nombre: "Glucemia", valor: 88, unidad: "mg/dl", rango: "70 - 100" },
        { nombre: "Colesterol total", valor: 178, unidad: "mg/dl", rango: "Deseable: < 200" },
      ],
    },
  },
  {
    id: "15-informe-paciente-codigo-interno",
    institucion: "Centro de Medicina Nuclear del Plata",
    regla: 'El documento trae un CÓDIGO interno en vez de un nombre — es "no se sabe de quién es", no "es de otra persona".',
    extraccion: {
      fecha: "2026-04-22",
      especialidad: "Medicina Nuclear",
      institucion: "Centro de Medicina Nuclear del Plata",
      medico: "Dr. Joaquín Ortíz",
      resumen: "Centellograma sin alteraciones significativas en la captación evaluada.",
      categoria: "imaging",
      numero_orden: "",
      paciente: "MDAHE15061985",
      metricas: [],
    },
  },
  {
    id: "16-radiografia-dni-mal-leido",
    institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
    regla: "DNI mal leído en una placa de baja resolución (un dígito cambiado) — el DNI solo CORROBORA, jamás rechaza por sí solo.",
    extraccion: {
      fecha: "2026-05-18",
      especialidad: "Diagnóstico por imágenes",
      institucion: "Centro de Diagnóstico por Imágenes Aconcagua",
      medico: "",
      resumen: "Radiografía de tobillo derecho sin evidencia de fractura aguda.",
      categoria: "imaging",
      numero_orden: "",
      paciente: "GREGORIO MARIA LUJAN",
      metricas: [],
    },
  },
]

export const CASOS_SINTETICOS: readonly CasoSintetico[] = DEFINICIONES.map((def) => ({
  ...def,
  texto: readFileSync(join(CARPETA, `${def.id}.txt`), "utf8"),
}))

/** Busca un caso por id; lanza si no existe (un test que pide un id inexistente es un bug del test). */
export function caso(id: string): CasoSintetico {
  const encontrado = CASOS_SINTETICOS.find((c) => c.id === id)
  if (!encontrado) {
    throw new Error(`No existe un caso sintetico con id "${id}". Revisa tests/fixtures/documentos-sinteticos/casos.ts`)
  }
  return encontrado
}
