#!/usr/bin/env node
/**
 * MEDICIÓN REAL del clasificador de intención (Sprint 20 — "una foto, el lugar
 * correcto") contra la API de Gemini.
 *
 * Manda los ocho PDF de `tests/fixtures/documentos-intencion/`
 * -generados por `scripts/generar-fixtures-intencion.mjs`- por el MISMO camino
 * que usa la aplicación (`PROMPT_DOCUMENTO_MEDICO` + `SCHEMA_DOCUMENTO_MEDICO`
 * + `validarExtraccion`, una sola llamada por documento) y reporta:
 *
 *   1. La tasa de acierto de `intencion`, caso por caso.
 *   2. Para las recetas: qué medicamentos leyó, y -lo más importante- si
 *      INVENTÓ una dosis que el papel no imprime. Un acierto de intención con
 *      una dosis inventada es un FALLO, no un acierto: la clasificación bien y
 *      el dato peligroso igual.
 *   3. Para los turnos: si `texto_completo` trae la transcripción con TODAS las
 *      fechas de la captura. Un turno que no quedó transcripto no se puede
 *      derivar después, aunque la intención sea correcta.
 *
 * Sale con código 1 si la tasa no es perfecta o si algún control falla, para
 * que se note.
 *
 * Uso:
 *   node scripts/test-clasificador-intencion.mjs
 *
 * El modelo se imprime (no es secreto). La API key NUNCA se imprime. Todo el
 * contenido de los PDF es inventado.
 */

import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('./lib/alias-hooks.mjs', import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_PROYECTO = path.join(__dirname, '..');
const DIR_FIXTURES = path.join(RAIZ_PROYECTO, 'tests', 'fixtures', 'documentos-intencion');

function parsearEnv(contenido) {
  const resultado = {};
  for (const lineaCruda of contenido.split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (linea.length === 0 || linea.startsWith('#')) continue;
    const idx = linea.indexOf('=');
    if (idx === -1) continue;
    const clave = linea.slice(0, idx).trim();
    let valor = linea.slice(idx + 1).trim();
    const conComillas =
      (valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"));
    if (conComillas && valor.length >= 2) valor = valor.slice(1, -1);
    if (clave.length > 0) resultado[clave] = valor;
  }
  return resultado;
}

const rutaEnv = path.join(RAIZ_PROYECTO, '.env.local');
if (!existsSync(rutaEnv)) {
  console.error('BLOQUEO: no existe .env.local en la raíz del proyecto.');
  process.exit(1);
}
for (const [clave, valor] of Object.entries(parsearEnv(readFileSync(rutaEnv, 'utf-8')))) {
  if (process.env[clave] === undefined) process.env[clave] = valor;
}

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim().length === 0) {
  console.error('BLOQUEO: falta GEMINI_API_KEY (revisar .env.local). No se hizo ninguna llamada.');
  process.exit(1);
}

const { extraerJson, obtenerModeloGemini } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'gemini', 'client.ts')).href
);
const { PROMPT_DOCUMENTO_MEDICO } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'gemini', 'prompt-documento.ts')).href
);
const { SCHEMA_DOCUMENTO_MEDICO } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'gemini', 'schemas.ts')).href
);
const { validarExtraccion } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'validacion', 'documento.schema.ts')).href
);

/**
 * Los ocho casos con su intención esperada y sus controles extra.
 *
 * `controles` recibe la extracción validada y devuelve una lista de problemas
 * (vacía = todo bien). Son los chequeos que NO son la clasificación en sí pero
 * que decidirían si el ruteo sirve para algo.
 */
const CASOS = [
  {
    archivo: 'receta-manuscrita-tres-remedios.pdf',
    etiqueta: 'Papelito manuscrito con 3 remedios (caso real del usuario)',
    esperada: 'receta_o_medicacion',
    controles: (d) => {
      const problemas = [];
      const meds = d.medicamentos ?? [];
      if (meds.length !== 3) problemas.push(`esperaba 3 medicamentos, leyó ${meds.length}`);
      // LO IMPORTANTE: el papel no dice ninguna dosis ni frecuencia.
      for (const med of meds) {
        if (med.dosis_texto.trim().length > 0) {
          problemas.push(`DOSIS INVENTADA en "${med.nombre}": «${med.dosis_texto}»`);
        }
        if (med.frecuencia_texto.trim().length > 0) {
          problemas.push(`FRECUENCIA INVENTADA en "${med.nombre}": «${med.frecuencia_texto}»`);
        }
      }
      const nombres = meds.map((m) => `${m.nombre} ${m.presentacion}`.toUpperCase()).join(' | ');
      for (const esperado of ['COVERAM', 'LIPOMAX', 'ROSUVASTATINA']) {
        if (!nombres.includes(esperado)) problemas.push(`no encontró "${esperado}"`);
      }
      return problemas;
    },
  },
  {
    archivo: 'receta-con-dosis-y-frecuencia.pdf',
    etiqueta: 'Receta con dosis y frecuencia impresas',
    esperada: 'receta_o_medicacion',
    controles: (d) => {
      const problemas = [];
      const meds = d.medicamentos ?? [];
      if (meds.length !== 3) problemas.push(`esperaba 3 medicamentos, leyó ${meds.length}`);
      const conDosis = meds.filter((m) => m.dosis_texto.trim().length > 0).length;
      if (conDosis < 3) problemas.push(`solo ${conDosis}/3 medicamentos con la dosis que el papel SÍ imprime`);
      return problemas;
    },
  },
  {
    archivo: 'agenda-dos-turnos-confirmados.pdf',
    etiqueta: 'Captura de agenda con DOS turnos (caso real del usuario)',
    esperada: 'turno_o_cita',
    controles: (d) => {
      const problemas = [];
      const texto = `${d.texto_completo ?? ''} ${d.resumen}`;
      // Las dos fechas tienen que sobrevivir: el segundo turno vive SOLO acá.
      if (!/22[/-]09/.test(texto)) problemas.push('no transcribió el turno del 22/09');
      if (!/24[/-]09/.test(texto)) problemas.push('no transcribió el turno del 24/09');
      if (!/18:00/.test(texto)) problemas.push('no transcribió la hora 18:00');
      if (!/13:00/.test(texto)) problemas.push('no transcribió la hora 13:00');
      return problemas;
    },
  },
  {
    archivo: 'turno-comprobante-unico.pdf',
    etiqueta: 'Comprobante de UN turno',
    esperada: 'turno_o_cita',
    controles: (d) => {
      const texto = `${d.texto_completo ?? ''} ${d.resumen}`;
      return /05[/-]10/.test(texto) ? [] : ['no transcribió la fecha del turno (05/10)'];
    },
  },
  {
    archivo: 'orden-de-practica.pdf',
    etiqueta: 'Orden de práctica a realizar (sin resultados)',
    esperada: 'orden_de_practica',
    controles: (d) => (d.metricas.length === 0 ? [] : ['inventó métricas en un pedido sin resultados']),
  },
  {
    archivo: 'estudio-laboratorio.pdf',
    etiqueta: 'CONTROL — laboratorio con resultados',
    esperada: 'estudio_realizado',
    controles: (d) => {
      const problemas = [];
      if (d.metricas.length < 4) problemas.push(`esperaba >=4 métricas, leyó ${d.metricas.length}`);
      if ((d.medicamentos ?? []).length > 0) problemas.push('inventó medicamentos en un laboratorio');
      if (d.numero_orden !== '1683737') problemas.push(`numero_orden = "${d.numero_orden ?? ''}" (esperaba 1683737)`);
      return problemas;
    },
  },
  {
    archivo: 'estudio-ecografia.pdf',
    etiqueta: 'CONTROL — ecografía con informe',
    esperada: 'estudio_realizado',
    controles: (d) =>
      (d.medicamentos ?? []).length > 0 ? ['inventó medicamentos en una ecografía'] : [],
  },
  {
    archivo: 'estudio-epicrisis.pdf',
    etiqueta: 'CONTROL — epicrisis de internación',
    esperada: 'estudio_realizado',
    controles: (d) =>
      (d.medicamentos ?? []).length > 0 ? ['inventó medicamentos en una epicrisis'] : [],
  },
];

/**
 * LA NO-REGRESIÓN: una muestra del corpus PREVIO al sprint.
 *
 * El criterio del encargo es que los documentos que ya se sabían leer no
 * cambien de comportamiento. Estos seis salen de
 * `tests/fixtures/documentos-sinteticos/` -el banco del Sprint 18/19, pensado
 * justamente para comprobar que las reglas endurecidas no quedaran sobreajustadas
 * al formato de una sola clínica- y se mandan por el mismo camino real.
 *
 * Lo que se exige de ellos es lo MÁS conservador posible, y a propósito: que la
 * intención salga `estudio_realizado`, es decir, **exactamente el flujo que la
 * aplicación tenía antes de que este clasificador existiera**, y que no aparezca
 * ningún medicamento inventado. Si estos seis pasan, el camino viejo sigue
 * siendo el camino viejo.
 *
 * Van como `text/plain`: son los `.txt` del banco, que es el texto del
 * documento tal como el lector lo vería. Es el contenido lo que se está
 * cotejando, no el formato del archivo.
 */
const CORPUS_PREVIO = [
  '01-bioquimico-del-sur-protocolo.txt',
  '05-radiografia-accesion-dicom.txt',
  '08-guardia-numero-de-internacion.txt',
  '11-laboratorio-dos-fechas-contradictorias.txt',
  '12-laboratorio-rango-en-tres-renglones.txt',
  '15-informe-paciente-codigo-interno.txt',
];

const DIR_CORPUS = path.join(RAIZ_PROYECTO, 'tests', 'fixtures', 'documentos-sinteticos');

console.log(`Modelo Gemini usado: ${obtenerModeloGemini()}`);
console.log(`Casos: ${CASOS.length}  (una llamada por caso, como en producción)\n`);

let aciertosIntencion = 0;
let casosSinProblemas = 0;
const filas = [];

for (const caso of CASOS) {
  console.log('='.repeat(90));
  console.log(caso.etiqueta);
  console.log(`  archivo: ${caso.archivo}   esperada: ${caso.esperada}`);
  console.log('='.repeat(90));

  let datos = null;
  let problemas = [];

  try {
    const base64 = readFileSync(path.join(DIR_FIXTURES, caso.archivo)).toString('base64');
    const crudo = await extraerJson({
      prompt: PROMPT_DOCUMENTO_MEDICO,
      media: { mimeType: 'application/pdf', data: base64 },
      schema: SCHEMA_DOCUMENTO_MEDICO,
    });

    const validacion = validarExtraccion(crudo);
    if (!validacion.ok) {
      problemas = validacion.errores.map((error) => `Zod: ${error}`);
    } else {
      datos = validacion.datos;
      problemas = caso.controles(datos);
    }
  } catch (error) {
    problemas = [`la llamada falló: ${error instanceof Error ? error.message : String(error)}`];
  }

  const obtenida = datos?.intencion ?? '(no vino)';
  const acerto = obtenida === caso.esperada;
  if (acerto) aciertosIntencion += 1;
  if (acerto && problemas.length === 0) casosSinProblemas += 1;

  console.log(`  intencion: ${obtenida}   ${acerto ? 'OK' : 'FALLO'}`);
  if (datos) {
    console.log(`  titulo: ${datos.titulo || '(vacío)'}`);
    console.log(`  categoria: ${datos.categoria}   fecha: ${datos.fecha ?? 'null'}`);
    console.log(`  metricas: ${datos.metricas.length}   medicamentos: ${(datos.medicamentos ?? []).length}`);
    console.log(`  texto_completo: ${(datos.texto_completo ?? '').length} caracteres`);
    for (const med of datos.medicamentos ?? []) {
      console.log(
        `    - ${med.nombre} | droga: ${med.droga || '-'} | pres: ${med.presentacion || '-'} | dosis: ${med.dosis_texto || '(vacía)'} | frec: ${med.frecuencia_texto || '(vacía)'}`,
      );
    }
  }
  if (problemas.length > 0) {
    console.log('  PROBLEMAS:');
    for (const problema of problemas) console.log(`    ! ${problema}`);
  }
  console.log('');

  filas.push({ etiqueta: caso.etiqueta, esperada: caso.esperada, obtenida, acerto, problemas });
}

// ── No-regresión sobre una muestra del corpus previo ──────────────────────
console.log('='.repeat(90));
console.log('NO-REGRESIÓN — muestra del corpus previo al Sprint 20');
console.log('='.repeat(90));

let corpusOk = 0;
for (const nombre of CORPUS_PREVIO) {
  let obtenida = '(no vino)';
  let detalle = '';
  try {
    const texto = readFileSync(path.join(DIR_CORPUS, nombre), 'utf-8');
    const crudo = await extraerJson({
      prompt: PROMPT_DOCUMENTO_MEDICO,
      media: { mimeType: 'text/plain', data: Buffer.from(texto, 'utf-8').toString('base64') },
      schema: SCHEMA_DOCUMENTO_MEDICO,
    });
    const validacion = validarExtraccion(crudo);
    if (!validacion.ok) {
      detalle = `Zod: ${validacion.errores[0]}`;
    } else {
      const d = validacion.datos;
      obtenida = d.intencion ?? '(no vino)';
      const medicamentos = (d.medicamentos ?? []).length;
      detalle = `cat=${d.categoria} fecha=${d.fecha ?? 'null'} metricas=${d.metricas.length} meds=${medicamentos}`;
      if (obtenida === 'estudio_realizado' && medicamentos === 0) corpusOk += 1;
      else if (medicamentos > 0) detalle += '  ! MEDICAMENTOS INVENTADOS';
    }
  } catch (error) {
    detalle = `la llamada falló: ${error instanceof Error ? error.message : String(error)}`;
  }
  const marca = obtenida === 'estudio_realizado' ? 'OK   ' : 'FALLO';
  console.log(`  ${marca} ${nombre.padEnd(46)} -> ${obtenida.padEnd(20)} ${detalle}`);
}
console.log('');

console.log('='.repeat(90));
console.log('RESUMEN');
console.log('='.repeat(90));
for (const fila of filas) {
  const marca = fila.acerto ? (fila.problemas.length === 0 ? 'OK  ' : 'OK* ') : 'FALLO';
  console.log(`  ${marca}  ${fila.esperada.padEnd(20)} -> ${fila.obtenida.padEnd(20)}  ${fila.etiqueta}`);
}
const porcentaje = ((aciertosIntencion / CASOS.length) * 100).toFixed(1);
console.log('');
console.log(`  Intención correcta:        ${aciertosIntencion}/${CASOS.length}  (${porcentaje}%)`);
console.log(`  Sin ningún problema:       ${casosSinProblemas}/${CASOS.length}`);
console.log(`  Corpus previo sin cambios: ${corpusOk}/${CORPUS_PREVIO.length}`);
console.log('  (OK* = clasificó bien pero algún control extra falló — ver el detalle de arriba)');

const todoBien =
  aciertosIntencion === CASOS.length &&
  casosSinProblemas === CASOS.length &&
  corpusOk === CORPUS_PREVIO.length;
process.exit(todoBien ? 0 : 1);
