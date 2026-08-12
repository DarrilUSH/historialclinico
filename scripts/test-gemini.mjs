#!/usr/bin/env node
/**
 * Prueba end-to-end REAL de `lib/gemini/client.ts` contra la API de Gemini.
 *
 * Qué hace:
 *   1. Carga `GEMINI_API_KEY` (y el resto de variables) parseando `.env.local`
 *      a mano con `fs` (formato `KEY=valor`). NUNCA imprime la clave ni
 *      fragmentos de ella — ni siquiera en los mensajes de error.
 *   2. Manda un texto simple de un análisis de laboratorio ficticio al
 *      wrapper real (`extraerJson`) usando el schema real
 *      (`SCHEMA_DOCUMENTO_MEDICO`) de `lib/gemini/schemas.ts`.
 *   3. Imprime el JSON devuelto y un veredicto PASS/FAIL validando que los
 *      campos estén presentes y con el tipo correcto.
 *
 * Uso:
 *   node scripts/test-gemini.mjs
 *   GEMINI_MODEL_ID=gemini-3.5-flash-lite node scripts/test-gemini.mjs
 *
 * El modelo usado se imprime siempre (no es secreto). La API key nunca se
 * imprime, ni completa ni parcial.
 *
 * Nota técnica: este script importa `lib/gemini/client.ts` y
 * `lib/gemini/schemas.ts` directo (extensión `.ts`) apoyándose en el soporte
 * nativo de Node 24 para TypeScript (type stripping), sin transpilar ni
 * duplicar lógica: lo que se prueba acá es el wrapper real, no una copia.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAIZ_PROYECTO = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// 1. Carga manual de .env.local (formato KEY=valor, sin librerías externas)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parsea un archivo .env simple (líneas `KEY=valor`, comentarios con `#`,
 * comillas simples/dobles opcionales alrededor del valor). No soporta
 * interpolación ni multilínea: alcanza para este proyecto.
 */
function parsearEnv(contenido) {
  /** @type {Record<string, string>} */
  const resultado = {};
  const lineas = contenido.split(/\r?\n/);

  for (const lineaCruda of lineas) {
    const linea = lineaCruda.trim();
    if (linea.length === 0 || linea.startsWith('#')) continue;

    const idx = linea.indexOf('=');
    if (idx === -1) continue;

    const clave = linea.slice(0, idx).trim();
    let valor = linea.slice(idx + 1).trim();

    const envuelvaComillas =
      (valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"));
    if (envuelvaComillas && valor.length >= 2) {
      valor = valor.slice(1, -1);
    }

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

  const contenido = readFileSync(rutaEnv, 'utf-8');
  const variables = parsearEnv(contenido);

  // No pisar variables ya presentes en el entorno del proceso: así
  // `GEMINI_MODEL_ID=gemini-3.5-flash-lite node scripts/test-gemini.mjs`
  // gana por encima de lo que diga .env.local, sin tocar código.
  for (const [clave, valor] of Object.entries(variables)) {
    if (process.env[clave] === undefined) {
      process.env[clave] = valor;
    }
  }
}

cargarEnvLocal();

if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim().length === 0) {
  console.error('BLOQUEO: falta GEMINI_API_KEY (revisar .env.local). No se hizo ninguna llamada a la API.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Llamada real al wrapper con un documento médico ficticio
// ─────────────────────────────────────────────────────────────────────────

const { extraerJson, obtenerModeloGemini, GeminiError } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'gemini', 'client.ts')).href
);
const { SCHEMA_DOCUMENTO_MEDICO } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'gemini', 'schemas.ts')).href
);

const DOCUMENTO_FICTICIO = `
Laboratorio Central
Fecha del estudio: 15/03/2026
Médico solicitante: Dr. Pérez
Especialidad: Clínica médica

Resultados de laboratorio:
- Glucemia en ayunas: 95 mg/dl (valor de referencia: 70 - 110 mg/dl)
- Colesterol total: 180 mg/dl (valor de referencia: hasta 200 mg/dl)

Paciente ficticio, sin hallazgos patológicos relevantes. Se sugiere control de rutina en 6 meses.
`.trim();

const PROMPT = [
  'Extraé los datos estructurados del siguiente documento médico (es un caso de',
  'prueba ficticio, no un paciente real) y devolvé exactamente el JSON pedido',
  'por el schema, en español:',
  '',
  DOCUMENTO_FICTICIO,
].join('\n');

/**
 * Valida la forma del objeto devuelto contra lo que exige
 * `SCHEMA_DOCUMENTO_MEDICO` (presencia de campos + tipo correcto). Devuelve
 * la lista de problemas encontrados; vacía significa PASS.
 */
function validarDocumentoExtraido(json) {
  const problemas = [];
  const CATEGORIAS_VALIDAS = ['laboratory', 'imaging', 'prescription', 'consultation', 'other'];

  if (json === null || typeof json !== 'object') {
    return ['La respuesta no es un objeto JSON.'];
  }

  const camposTexto = ['fecha', 'especialidad', 'institucion', 'medico', 'resumen'];
  for (const campo of camposTexto) {
    if (typeof json[campo] !== 'string') {
      problemas.push(`Campo "${campo}" ausente o no es string (recibido: ${typeof json[campo]}).`);
    }
  }

  if (typeof json.categoria !== 'string') {
    problemas.push(`Campo "categoria" ausente o no es string (recibido: ${typeof json.categoria}).`);
  } else if (!CATEGORIAS_VALIDAS.includes(json.categoria)) {
    problemas.push(`Campo "categoria" tiene un valor fuera del enum: "${json.categoria}".`);
  }

  if (!Array.isArray(json.metricas)) {
    problemas.push(`Campo "metricas" ausente o no es array (recibido: ${typeof json.metricas}).`);
  } else {
    json.metricas.forEach((metrica, i) => {
      if (metrica === null || typeof metrica !== 'object') {
        problemas.push(`metricas[${i}] no es un objeto.`);
        return;
      }
      if (typeof metrica.nombre !== 'string') {
        problemas.push(`metricas[${i}].nombre ausente o no es string.`);
      }
      if (typeof metrica.valor !== 'number' || Number.isNaN(metrica.valor)) {
        problemas.push(`metricas[${i}].valor ausente o no es number.`);
      }
      if (typeof metrica.unidad !== 'string') {
        problemas.push(`metricas[${i}].unidad ausente o no es string.`);
      }
      if (typeof metrica.rango !== 'string') {
        problemas.push(`metricas[${i}].rango ausente o no es string.`);
      }
    });
  }

  return problemas;
}

const modelo = obtenerModeloGemini();
console.log(`Modelo Gemini usado: ${modelo}`);
console.log('Enviando documento médico ficticio de prueba...\n');

try {
  const resultado = await extraerJson({
    prompt: PROMPT,
    schema: SCHEMA_DOCUMENTO_MEDICO,
  });

  console.log('JSON devuelto por Gemini:');
  console.log(JSON.stringify(resultado, null, 2));

  const problemas = validarDocumentoExtraido(resultado);

  console.log('');
  if (problemas.length === 0) {
    console.log(`PASS — modelo "${modelo}": el JSON cumple el schema (campos presentes y tipos correctos).`);
    process.exitCode = 0;
  } else {
    console.log(`FAIL — modelo "${modelo}": el JSON no cumple el schema:`);
    for (const problema of problemas) console.log(`  - ${problema}`);
    process.exitCode = 1;
  }
} catch (error) {
  const esErrorTipado = error instanceof GeminiError;
  const nombre = esErrorTipado ? error.name : 'Error';
  const mensaje = error instanceof Error ? error.message : String(error);

  console.error(`BLOQUEO (${nombre}) — no se pudo completar la prueba contra la API de Gemini:`);
  console.error(`  ${mensaje}`);
  if (!esErrorTipado && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  // Nota: se usa `process.exitCode` (no `process.exit()`) a propósito — en
  // Windows, forzar la salida justo después de una request de red vía
  // fetch/undici puede disparar un assertion crash de libuv
  // (`UV_HANDLE_CLOSING`, src/win/async.c) ajeno a la lógica de este script.
  // Dejar que el proceso termine solo evita ese crash.
  process.exitCode = 1;
}
