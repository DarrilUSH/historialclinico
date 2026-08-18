#!/usr/bin/env node
/**
 * Prueba end-to-end REAL de la extracción de documentos médicos
 * (`app/api/documentos/extraer/route.ts`'s núcleo: `extraerJson` +
 * `PROMPT_DOCUMENTO_MEDICO` + `SCHEMA_DOCUMENTO_MEDICO`) contra la API de
 * Gemini, para validar el campo NUEVO `numero_orden` (hotfix de duplicados
 * semánticos, Capa 2) con un PDF sintético que trae impreso un N° de Orden
 * -mismo patrón que la evidencia real del usuario (Sanatorio San Jorge, N°
 * ORDEN 1446188)-.
 *
 * Qué hace:
 *   1. Carga `.env.local` a mano (mismo parser que `scripts/test-gemini.mjs`).
 *      NUNCA imprime la clave.
 *   2. Extrae `tests/fixtures/documentos/analisis-laboratorio-con-orden.pdf`
 *      -un análisis de laboratorio sintético con "N° de Orden: 1446188"
 *      impreso- y verifica que `numero_orden` salga "1446188".
 *   3. Extrae también las dos versiones REGENERADAS
 *      (`consulta-regenerado-v1.pdf` / `v2.pdf`, mismo contenido visible,
 *      bytes distintos por metadata) y verifica que las dos extracciones den
 *      los mismos datos estructurados -la base de la Capa 3-.
 *   4. Imprime una tabla con lo que extrajo cada corrida.
 *
 * Uso:
 *   node scripts/test-extraer-documento.mjs
 *
 * El modelo usado se imprime siempre (no es secreto). La API key nunca se
 * imprime. El contenido de los PDF es sintético (generado para esta prueba,
 * ninguna persona real).
 */

import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

register('./lib/alias-hooks.mjs', import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAIZ_PROYECTO = path.join(__dirname, '..');
const DIR_FIXTURES = path.join(RAIZ_PROYECTO, 'tests', 'fixtures', 'documentos');

function parsearEnv(contenido) {
  const resultado = {};
  for (const lineaCruda of contenido.split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (linea.length === 0 || linea.startsWith('#')) continue;
    const idx = linea.indexOf('=');
    if (idx === -1) continue;
    const clave = linea.slice(0, idx).trim();
    let valor = linea.slice(idx + 1).trim();
    const envuelvaComillas =
      (valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"));
    if (envuelvaComillas && valor.length >= 2) valor = valor.slice(1, -1);
    if (clave.length > 0) resultado[clave] = valor;
  }
  return resultado;
}

function cargarEnvLocal() {
  const rutaEnv = path.join(RAIZ_PROYECTO, '.env.local');
  if (!existsSync(rutaEnv)) {
    console.error('BLOQUEO: no existe .env.local en la raíz del proyecto.');
    process.exit(1);
  }
  const variables = parsearEnv(readFileSync(rutaEnv, 'utf-8'));
  for (const [clave, valor] of Object.entries(variables)) {
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}

cargarEnvLocal();

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim().length === 0) {
  console.error('BLOQUEO: falta GEMINI_API_KEY (revisar .env.local). No se hizo ninguna llamada a la API.');
  process.exit(1);
}

const { extraerJson, obtenerModeloGemini, GeminiError } = await import(
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

const modelo = obtenerModeloGemini();
console.log(`Modelo Gemini usado: ${modelo}\n`);

function leerPdfBase64(nombre) {
  const bytes = readFileSync(path.join(DIR_FIXTURES, nombre));
  return bytes.toString('base64');
}

function resumen(extraccion) {
  return {
    fecha: extraccion.fecha || '(vacío)',
    categoria: extraccion.categoria,
    institucion: extraccion.institucion || '(vacío)',
    medico: extraccion.medico || '(vacío)',
    especialidad: extraccion.especialidad || '(vacío)',
    numero_orden: extraccion.numero_orden || '(vacío)',
    metricas: extraccion.metricas.length,
  };
}

let huboError = false;
let huboFalloDeAserto = false;
const filasReporte = [];

async function extraer(etiqueta, nombreArchivo) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${etiqueta} (${nombreArchivo})`);
  console.log('='.repeat(78));
  try {
    const base64 = leerPdfBase64(nombreArchivo);
    const crudo = await extraerJson({
      prompt: PROMPT_DOCUMENTO_MEDICO,
      media: { mimeType: 'application/pdf', data: base64 },
      schema: SCHEMA_DOCUMENTO_MEDICO,
    });

    const validacion = validarExtraccion(crudo);
    if (!validacion.ok) {
      huboError = true;
      console.error('FALLO — la extracción no pasó la validación Zod:');
      for (const err of validacion.errores) console.error(`  - ${err}`);
      filasReporte.push({ etiqueta, error: 'validación Zod fallida' });
      return null;
    }

    const datos = validacion.datos;
    console.log(JSON.stringify(resumen(datos), null, 2));
    filasReporte.push({ etiqueta, datos });
    return datos;
  } catch (error) {
    huboError = true;
    const esErrorTipado = error instanceof GeminiError;
    const nombre = esErrorTipado ? error.name : 'Error';
    const mensajeError = error instanceof Error ? error.message : String(error);
    console.error(`FALLO (${nombre}): ${mensajeError}`);
    if (!esErrorTipado && error instanceof Error && error.stack) console.error(error.stack);
    filasReporte.push({ etiqueta, error: mensajeError });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. El PDF con N° de Orden impreso — valida el campo nuevo
// ─────────────────────────────────────────────────────────────────────────

const conOrden = await extraer(
  'ANÁLISIS DE LABORATORIO CON N° DE ORDEN',
  'analisis-laboratorio-con-orden.pdf',
);

if (conOrden) {
  const ok = conOrden.numero_orden === '1446188';
  console.log(`\nnumero_orden extraído: "${conOrden.numero_orden}" — esperado "1446188" — ${ok ? 'OK' : 'FALLÓ'}`);
  if (!ok) huboFalloDeAserto = true;
}

// ─────────────────────────────────────────────────────────────────────────
// 2. El par REGENERADO (mismo contenido visible, bytes distintos) — base de
//    la Capa 3: las dos extracciones tienen que dar los mismos datos.
// ─────────────────────────────────────────────────────────────────────────

const v1 = await extraer('CONSULTA REGENERADA — versión 1', 'consulta-regenerado-v1.pdf');
const v2 = await extraer('CONSULTA REGENERADA — versión 2 (bytes distintos)', 'consulta-regenerado-v2.pdf');

if (v1 && v2) {
  const camposIguales =
    v1.fecha === v2.fecha &&
    v1.categoria === v2.categoria &&
    v1.institucion.trim().toLowerCase() === v2.institucion.trim().toLowerCase() &&
    v1.medico.trim().toLowerCase() === v2.medico.trim().toLowerCase();
  console.log(
    `\nLas dos extracciones del PDF regenerado dan los mismos datos estructurados (fecha/categoría/institución/médico): ${
      camposIguales ? 'SÍ' : 'NO'
    }`,
  );
  if (!camposIguales) huboFalloDeAserto = true;
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Veredicto final
// ─────────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(78)}`);
if (huboError || huboFalloDeAserto) {
  console.log('FAIL — hubo un error de Gemini/validación, o una aserción no se cumplió.');
} else {
  console.log('PASS — numero_orden se extrajo correctamente y el par regenerado dio datos consistentes.');
}
console.log('='.repeat(78));

process.exitCode = huboError || huboFalloDeAserto ? 1 : 0;
