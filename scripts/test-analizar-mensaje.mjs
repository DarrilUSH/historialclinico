#!/usr/bin/env node
/**
 * Prueba end-to-end REAL de `lib/turnos/analizar-mensaje.ts` contra la API de
 * Gemini, usando los 8 fixtures de `tests/fixtures/mensajes-turno/` (Sprint
 * 16, tarea 16.4).
 *
 * Qué hace:
 *   1. Carga `.env.local` a mano (mismo parser que `scripts/test-gemini.mjs`).
 *      NUNCA imprime la clave.
 *   2. Corre los 8 fixtures individuales contra `analizarMensajeTurno` (el
 *      orquestador REAL: prompt real + `SCHEMA_ANALISIS_MENSAJE_TURNO` real +
 *      validación Zod real + la capa pura de normalización real).
 *   3. Corre el par de Casa Salud JUNTO (fusión esperada) y el par del
 *      Hospital Británico JUNTO (división esperada).
 *   4. Corre el fixture de la Clínica San Jorge DOS VECES para verificar
 *      estructura estable entre llamadas (mismo criterio que la tarea 10.3).
 *   5. Imprime una tabla mensaje → qué extrajo (fecha/hora/profesional/
 *      especialidad/lugar/flags) para pegar en el resumen de entrega.
 *
 * Uso:
 *   node scripts/test-analizar-mensaje.mjs
 *
 * El modelo usado se imprime siempre (no es secreto). La API key nunca se
 * imprime, ni completa ni parcial. El contenido de los mensajes tampoco se
 * imprime más allá de lo que ya expone la tabla de resultados (son fixtures
 * anonimizados del propio repo, no datos reales).
 */

import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Resuelve el alias `@/` y sustituye `server-only` por el mismo mock que usa
// `vitest.config.ts` — ver `scripts/lib/alias-hooks.mjs` para el porqué.
register('./lib/alias-hooks.mjs', import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAIZ_PROYECTO = path.join(__dirname, '..');
const DIR_FIXTURES = path.join(RAIZ_PROYECTO, 'tests', 'fixtures', 'mensajes-turno');

// ─────────────────────────────────────────────────────────────────────────
// 1. Carga manual de .env.local (idéntico a scripts/test-gemini.mjs)
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// 2. Imports reales (Node 24 type stripping, mismo truco que test-gemini.mjs)
// ─────────────────────────────────────────────────────────────────────────

const { analizarMensajeTurno } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'turnos', 'analizar-mensaje.ts')).href
);
const { obtenerModeloGemini, GeminiError } = await import(
  pathToFileURL(path.join(RAIZ_PROYECTO, 'lib', 'gemini', 'client.ts')).href
);

const modelo = obtenerModeloGemini();
console.log(`Modelo Gemini usado: ${modelo}\n`);

function leerFixture(nombre) {
  return readFileSync(path.join(DIR_FIXTURES, nombre), 'utf-8');
}

function resumenPropuesta(p) {
  const flags = [];
  if (p.anioInferido) flags.push('año inferido');
  if (p.discrepanciaDiaSemana) flags.push('DISCREPANCIA día semana');
  if (p.especialidadInferida) flags.push('especialidad inferida');
  if (p.dudaOrdenNombre) flags.push('duda orden nombre');
  if (p.esEstudioNoProfesional) flags.push('es estudio, no persona');
  return {
    fecha: p.fecha || '(vacío)',
    hora: p.hora || '(vacío)',
    profesional: p.medico || '(vacío)',
    especialidad: p.especialidad || '(vacío)',
    lugar: [p.lugarNombre, p.lugarDireccion].filter(Boolean).join(' — ') || '(vacío)',
    ciudadProvincia: [p.lugarCiudad, p.lugarProvincia].filter(Boolean).join(', ') || '(vacío)',
    flags: flags.join('; ') || '(ninguno)',
    notas: p.notasPreparacion ? `${p.notasPreparacion.length} caracteres, ${p.notasPreparacion.split('\n').length} líneas` : '(vacío)',
  };
}

const filasReporte = [];
let huboError = false;

async function correr(etiqueta, mensaje) {
  console.log(`\n${'='.repeat(78)}`);
  console.log(etiqueta);
  console.log('='.repeat(78));
  try {
    const resultado = await analizarMensajeTurno(mensaje);
    console.log(`relacion: ${resultado.relacion}`);
    console.log(`explicacion: ${resultado.explicacion}`);
    if (resultado.contradiccion) console.log(`CONTRADICCIÓN: ${resultado.contradiccion}`);

    console.log('\nPropuesta principal:');
    console.log(JSON.stringify(resumenPropuesta(resultado.propuestaPrincipal), null, 2));
    if (resultado.propuestaPrincipal.avisos.length > 0) {
      console.log('Avisos:');
      for (const aviso of resultado.propuestaPrincipal.avisos) console.log(`  - ${aviso}`);
    }

    if (resultado.otrasPropuestas.length > 0) {
      console.log(`\nOtras propuestas (${resultado.otrasPropuestas.length}):`);
      resultado.otrasPropuestas.forEach((otra, i) => {
        console.log(`  [${i}] ${JSON.stringify(resumenPropuesta(otra))}`);
      });
    }

    filasReporte.push({ etiqueta, resultado });
    return resultado;
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
// 3. Los 8 fixtures individuales
// ─────────────────────────────────────────────────────────────────────────

const FIXTURES_INDIVIDUALES = [
  'clinica-san-jorge-ecografia.txt',
  'hospital-britanico-estudio.txt',
  'hospital-britanico-profesional.txt',
  'instituto-medico-platense-traumatologia.txt',
  'casa-salud-ginecologia.txt',
  'casa-salud-confirmacion.txt',
  'centro-loria-sin-anio.txt',
  'tcba-salguero-puncion.txt',
];

for (const nombre of FIXTURES_INDIVIDUALES) {
  await correr(`FIXTURE INDIVIDUAL: ${nombre}`, leerFixture(nombre));
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Pares: Casa Salud (fusión esperada) y Británico (división esperada)
// ─────────────────────────────────────────────────────────────────────────

const parCasaSalud = [leerFixture('casa-salud-ginecologia.txt'), leerFixture('casa-salud-confirmacion.txt')].join(
  '\n\n',
);
await correr('PAR CASA SALUD (ginecología + confirmación) — se espera FUSIÓN', parCasaSalud);

const parBritanico = [
  leerFixture('hospital-britanico-estudio.txt'),
  leerFixture('hospital-britanico-profesional.txt'),
].join('\n\n');
await correr('PAR HOSPITAL BRITÁNICO (estudio + profesional) — se espera DIVISIÓN', parBritanico);

// ─────────────────────────────────────────────────────────────────────────
// 5. San Jorge, DOS VECES — estabilidad de estructura entre llamadas
// ─────────────────────────────────────────────────────────────────────────

const sanJorge = leerFixture('clinica-san-jorge-ecografia.txt');
const corrida1 = await correr('SAN JORGE — corrida 1/2 (estabilidad estructural)', sanJorge);
const corrida2 = await correr('SAN JORGE — corrida 2/2 (estabilidad estructural)', sanJorge);

if (corrida1 && corrida2) {
  const clavesEsperadas = Object.keys(resumenPropuesta(corrida1.propuestaPrincipal)).sort();
  const clavesCorrida2 = Object.keys(resumenPropuesta(corrida2.propuestaPrincipal)).sort();
  const estructuraEstable = JSON.stringify(clavesEsperadas) === JSON.stringify(clavesCorrida2);
  console.log(`\nEstructura estable entre las dos corridas de San Jorge: ${estructuraEstable ? 'SÍ' : 'NO'}`);
  console.log(`  Corrida 1 — fecha=${corrida1.propuestaPrincipal.fecha} hora=${corrida1.propuestaPrincipal.hora}`);
  console.log(`  Corrida 2 — fecha=${corrida2.propuestaPrincipal.fecha} hora=${corrida2.propuestaPrincipal.hora}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Veredicto final
// ─────────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(78)}`);
console.log(huboError ? 'FAIL — al menos un fixture terminó en error.' : 'PASS — los 8 fixtures + los 2 pares + la corrida doble terminaron sin error.');
console.log('='.repeat(78));

process.exitCode = huboError ? 1 : 0;
