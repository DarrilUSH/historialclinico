/**
 * Cirugía de entorno (una sola vez, auditoría 8.4): `.env.local` tenía las
 * claves del proyecto Supabase CLOUD, y Next.js carga `.env.local` también en
 * `next start` — la app de producción local quedó apuntando a la nube real
 * (incidente documentado en docs/entorno.md).
 *
 * Este script:
 * 1. Respalda `.env.local` COMPLETO en `.env.cloud-respaldo` (nombre que
 *    Next.js NO auto-carga; cubierto por .gitignore) — de ahí saldrán las
 *    claves cloud en el Sprint 12.
 * 2. Reemplaza EN `.env.local` los valores de las tres variables de Supabase
 *    por los del stack local (claves demo públicas del CLI de Supabase).
 *    El resto (GEMINI, VAPID, CRON_SECRET) queda intacto: dev las necesita.
 * 3. Imprime SOLO nombres de variables y conteos. Jamás un valor.
 */
import { copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs"

const ENV = ".env.local"
const RESPALDO = ".env.cloud-respaldo"

const LOCALES = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
}

if (!existsSync(ENV)) {
  console.error(`${ENV} no existe — nada que hacer.`)
  process.exit(1)
}

if (existsSync(RESPALDO)) {
  console.log(`${RESPALDO} ya existe: no se pisa el respaldo previo.`)
} else {
  copyFileSync(ENV, RESPALDO)
  console.log(`Respaldo completo creado: ${RESPALDO}`)
}

const lineas = readFileSync(ENV, "utf8").split(/\r?\n/)
const cambiadas = []
const resultado = lineas.map((linea) => {
  const m = linea.match(/^([A-Z_0-9]+)=/)
  if (m && Object.hasOwn(LOCALES, m[1])) {
    cambiadas.push(m[1])
    return `${m[1]}=${LOCALES[m[1]]}`
  }
  return linea
})

writeFileSync(ENV, resultado.join("\n"), { encoding: "utf8" })

console.log(`Variables reapuntadas a local: ${cambiadas.join(", ") || "(ninguna)"}`)
const quedanCloud = readFileSync(ENV, "utf8").includes("supabase.co")
console.log(`Referencias a *.supabase.co restantes en ${ENV}: ${quedanCloud ? "SÍ (revisar)" : "0"}`)
const nombres = readFileSync(ENV, "utf8")
  .split(/\r?\n/)
  .map((l) => (l.match(/^([A-Z_0-9]+)=/) || [])[1])
  .filter(Boolean)
console.log(`Variables presentes: ${nombres.join(", ")}`)
