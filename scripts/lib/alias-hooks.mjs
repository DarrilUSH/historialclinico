/**
 * Loader hook de resolución de módulos ESM (Node 24 `module.register`) para
 * poder importar código del proyecto DIRECTO desde un script `.mjs` de
 * `scripts/` sin pasar por el bundler de Next.js — mismo espíritu que
 * `scripts/test-gemini.mjs`, pero ese script se salvaba porque los dos
 * archivos que importa (`lib/gemini/client.ts`, `lib/gemini/schemas.ts`) no
 * tienen NINGÚN import con el alias `@/` adentro. `lib/turnos/analizar-mensaje.ts`
 * (Sprint 16, tarea 16.4) sí encadena varios (`@/lib/gemini/...`,
 * `@/lib/turnos/...`, `@/lib/validacion/...`, y de ahí en más), así que hace
 * falta resolver el alias de verdad -Node no sabe nada de los `paths` de
 * `tsconfig.json`, eso es una convención de TypeScript/Next, no del
 * runtime-.
 *
 * Dos reglas de resolución, en orden:
 * 1. `@/algo` → `<raíz del proyecto>/algo(.ts|.tsx|/index.ts)`, probando
 *    extensiones en ese orden (mismo criterio que la resolución de módulos de
 *    TypeScript: el código fuente nunca escribe la extensión).
 * 2. `server-only` → el mismo mock vacío que ya usa `vitest.config.ts`
 *    (`tests/mocks/server-only.ts`): el paquete real (`node_modules/server-only`)
 *    hace `throw` incondicional al importarse -pensado para que el bundler de
 *    Next lo sustituya en server components-, así que en un script Node plano
 *    hay que interceptarlo iguel que hace el arnés de tests.
 */

import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const RAIZ = path.join(import.meta.dirname, "..", "..")
const MOCK_SERVER_ONLY = path.join(RAIZ, "tests", "mocks", "server-only.ts")

function resolverAlias(rutaRelativa) {
  const base = path.join(RAIZ, rutaRelativa)
  const candidatos = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
  return candidatos.find((candidato) => existsSync(candidato))
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return nextResolve(pathToFileURL(MOCK_SERVER_ONLY).href, context)
  }

  if (specifier.startsWith("@/")) {
    const encontrado = resolverAlias(specifier.slice(2))
    if (encontrado) {
      return nextResolve(pathToFileURL(encontrado).href, context)
    }
  }

  return nextResolve(specifier, context)
}
