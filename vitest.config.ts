import path from "path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // `.tsx` se sumó en el Sprint 14 para el primer test de RENDER de un
    // componente (`tests/unit/base/velo-espera.test.tsx`, `components/base/velo-espera.tsx`):
    // usa `// @vitest-environment jsdom` en su propio encabezado para pedir
    // DOM SOLO en ese archivo -el resto de la suite sigue en `"node"`, sin
    // DOM, tal como estaba-. Ver el comentario de ese test para el porqué.
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
  },
})
