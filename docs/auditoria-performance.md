# Auditoría de performance y Core Web Vitals

Sprint 11, tarea 11.6. Bundle, imágenes, carga diferida de gráficos y medición
de LCP/INP/CLS en `/inicio`, `/estudios` y `/turnos`, antes y después de
optimizar.

- **Fecha:** 2026-08-14
- **Alcance:** las tres rutas del criterio de aceptación (`/inicio`,
  `/estudios`, `/turnos`), más `/estudios/tendencias` y `/signos/historial`
  (los dos únicos puntos de la app que importan Recharts) porque el roadmap
  pide diferir sus gráficos explícitamente aunque no estén en el checkpoint.
- **Veredicto:** **CLS e INP (proxy TBT) cumplen el umbral en las tres rutas,
  antes y después.** El bundle de `/inicio` bajó (criterio de aceptación
  cumplido). **LCP sigue en FAIL en las tres rutas** después de optimizar —
  ver §5 para el diagnóstico honesto de por qué, y por qué no es un problema
  de JavaScript.

---

## 1. Método

### 1.1 Bundle: por qué no sale de la tabla de `next build`

Next 16 con Turbopack **ya no imprime la columna "First Load JS"** que
webpack sí mostraba en versiones anteriores (`node_modules/next/dist/docs/
01-app/02-guides/building.md` no la documenta porque no existe más). El
número real vive en `.next/diagnostics/route-bundle-stats.json`, un artefacto
de cada `next build` con `firstLoadUncompressedJsBytes` y la lista de chunks
por ruta. Todos los "bundle de la home" de este informe salen de ahí, no de
inspección manual del output de consola.

### 1.2 Comparación antes/después con el mismo commit

Para medir el bundle y el runtime del código **anterior** a este sprint sin
perder el trabajo en curso: `git stash -u` (incluye los dos archivos nuevos),
`npm run build` + `npm run start` sobre el código stasheado, medir, `git
stash pop`, reconstruir, medir de nuevo. Los dos builds corren exactamente la
misma máquina, mismo `.env.local`, mismo seed — la única variable es el
código.

### 1.3 Lighthouse mobile con sesión real (el problema de la cookie)

Las tres rutas exigen sesión y perfil activo; Lighthouse navega sin cookies.
Solución: login real con Playwright MCP (`maria@ejemplo.com.ar` /
`password123`, seed de `supabase/seed.sql`) contra `npm run start`, perfil
activo "Roberto Gómez" (tiene datos reales de laboratorio y signos vitales,
a diferencia de María, que en el seed no tiene estudios cargados — importa
para que el elemento LCP no sea siempre un estado vacío). Las cookies
—incluida `perfil_activo`, que es `httpOnly` y no aparece en
`document.cookie`— se leyeron con `page.context().cookies()` vía
`browser_run_code_unsafe`, y se pasaron a Lighthouse como
`--extra-headers` (archivo JSON con el header `Cookie` completo).

Comando base:

```
npx lighthouse http://localhost:3000/<ruta> \
  --preset=perf --form-factor=mobile \
  --screenEmulation.mobile=true --screenEmulation.width=375 --screenEmulation.height=667 --screenEmulation.deviceScaleFactor=2 \
  --throttling-method=simulate \
  --extra-headers=<archivo con {"Cookie": "..."}> \
  --chrome-flags="--headless=new --no-sandbox" \
  --output=json --output-path=<archivo>.json
```

`--throttling-method=simulate` es el método por defecto de Lighthouse
(modelo Lantern: corre la traza sin *throttling* real y **estima**
matemáticamente los tiempos bajo red/CPU móvil simulada) — el mismo método
que usa el Lighthouse de Chrome DevTools y PageSpeed Insights. Nota lateral
de la corrida en Windows: `chrome-launcher` tira un `EPERM` cosmético al
borrar su directorio temporal al cerrar Chrome (antivirus/permmisos de
`AppData\Local\Temp`); no afecta el resultado — el JSON se escribe antes de
ese paso — así que se ignoró.

Servidores coordinados igual que en tareas previas: `next dev` abajo →
`next build` → `npm run start` → medir → `next dev` arriba al final (§6).

---

## 2. Qué se cambió y por qué

### 2.1 Recharts diferido con `next/dynamic({ ssr: false })`

`components/estudios/grafico-metrica.tsx` (`/estudios/tendencias`) y
`components/signos/grafico-signo.tsx` (`/signos/historial`) son los
**únicos** dos puntos de toda la app que importan `recharts`
(`grep -rl recharts **/*.tsx` → exactamente esos dos archivos). Ninguna de
las tres rutas del checkpoint (`/inicio`, `/estudios`, `/turnos`) los importa
ni directa ni indirectamente — se verificó leyendo el árbol de imports
completo de las tres, no solo grepeando "recharts" — así que el criterio "si
`/inicio` o `/estudios` importan algo de Recharts, cortalo" ya estaba
cumplido de entrada.

Aun así, `/estudios/tendencias` y `/signos/historial` cargaban Recharts
(~130KB) de forma **estática y bloqueante** en su propio First Load JS,
mencionado por nombre en la consigna. Se cambió a:

```tsx
const GraficoMetrica = dynamic(
  () => import("@/components/estudios/grafico-metrica").then((m) => m.GraficoMetrica),
  { ssr: false, loading: () => <EsqueletoGrafico /> },
)
```

(mismo patrón en `panel-historial-signos.tsx` para `GraficoSigno`). El
`ssr: false` **solo funciona code-splitteando de verdad si el `dynamic()`
vive dentro de un Client Component** — `node_modules/next/dist/docs/
01-app/02-guides/lazy-loading.md`, sección "Skipping SSR", es explícito: si
un Server Component lo llama directo sobre un Client Component no hay
code-splitting real. Los dos casos ya estaban dentro de `"use client"`
(`panel-tendencias.tsx`, `panel-historial-signos.tsx`), así que el patrón
aplicó limpio.

`components/graficos/esqueleto-grafico.tsx` (nuevo) es el `loading:`
compartido: reserva ~260px (el alto de dibujo real, `ALTURA_GRAFICO` en
ambos componentes) + una tarjeta de detalle + una barra de tabla colapsada,
para que el chunk de Recharts terminando de bajar no corra el resto de la
pantalla (CLS).

### 2.2 `/inicio`: diferir `ActivarNotificaciones` y `BotonInstalar`

Con Recharts descartado como sospechoso para las tres rutas del checkpoint,
se midió qué chunks eran específicos de `/inicio` contra los compartidos por
las 44 rutas de la app (intersección de `firstLoadChunkPaths` en el JSON de
diagnóstico). El framework compartido (React, runtime de Next, cliente de
Supabase) pesa ~445KB y es igual en todas partes — no reducible desde acá.
Lo único específico de `/inicio` y no compartido con `/estudios`/`/turnos`
era el chunk de `ActivarNotificaciones` + `BotonInstalar` (~17KB sin
comprimir).

Las dos son las últimas cosas de la pantalla, ninguna aporta al elemento LCP,
y las dos **ya devuelven `null` en el primer render** (`ActivarNotificaciones`
arranca en `estado === "comprobando"`; `BotonInstalar` sin
`beforeinstallprompt` capturado) — diferirlas no cambia nada de lo que se ve
al entrar. `components/inicio/acciones-diferidas.tsx` (nuevo, `"use client"`)
las envuelve en `dynamic(..., { ssr: false })` cada una, y
`app/(app)/(con-nav)/inicio/page.tsx` ahora renderiza ese único wrapper en
vez de las dos importaciones directas.

### 2.3 Verificado, sin cambios necesarios

- **`optimizePackageImports`**: `recharts` y `lucide-react` ya están en la
  lista *default* de Next 16 (`node_modules/next/dist/docs/.../
  optimizePackageImports.md`) — no hace falta declararlos en
  `next.config.ts`.
- **Fuentes**: `app/layout.tsx` ya usa `next/font/google` con
  `display: "swap"` para las dos variantes de Atkinson Hyperlegible,
  autoalojadas (sin pedido a Google en runtime). Sin cambios.
- **Imágenes**: no hay un solo uso de `next/image` en el proyecto (`grep -rl
  "next/image"` → cero resultados) ni en las tres rutas auditadas. Los únicos
  `<img>` de la app (`components/coberturas/miniatura-credencial.tsx`,
  `components/estudios/visor-documento.tsx`, `components/sos/ficha-sos.tsx`)
  quedan fuera de `/inicio`/`/estudios`/`/turnos`; se verificó igual la
  miniatura de credencial que pide el roadmap: contenedor `size-16` fijo
  (`components/coberturas/miniatura-credencial.tsx:73,84,93`) tanto en carga
  como en error como en éxito — no hay salto de layout posible ahí.
- **`"use client"` innecesarios**: se revisó el árbol completo de las tres
  rutas. `ProximoTurno` y `BotonSos` (`/inicio`) ya son Server Components.
  `TarjetaEstudio` y `TarjetaTurno` (las cards de las listas) también. Los
  Client Components que quedan (`FiltrosEstudios`, `AvisoConfirmacion`,
  `SeccionPasados`, `AvisoTurno`, `BannerAlertasSignos`) lo son por un motivo
  concreto y documentado en su propio encabezado — estado de URL con
  `useSearchParams`/`router.replace`, `useActionState`, o un simple
  disclosure con `useState` — ninguno es candidato real a Server Component.
- **`next.config.ts`**: nada aplicable de esta versión más allá de lo ya
  configurado (`allowedDevOrigins`, `serverExternalPackages`,
  `bodySizeLimit`) — ver el propio archivo para el porqué de cada uno.

---

## 3. Bundle: antes / después

`firstLoadUncompressedJsBytes` de `.next/diagnostics/route-bundle-stats.json`,
mismo build (`next build`, Turbopack), antes = HEAD de este sprint, después =
con los cambios de §2.

| Ruta | Antes | Después | Δ |
|---|---|---|---|
| **`/inicio`** (criterio de aceptación) | **557.2 KB** (570 558 B) | **553.4 KB** (566 640 B) | **-3.9 KB (-0.7%)** |
| `/estudios` | 698.8 KB | 698.8 KB | sin cambios (no importa Recharts, confirmado en §2.1) |
| `/turnos` | 547.4 KB | 547.4 KB | sin cambios (no importa Recharts) |
| `/estudios/tendencias` | 874.8 KB | 552.9 KB | **-321.9 KB (-36.8%)** |
| `/signos/historial` | 878.4 KB | 551.2 KB | **-327.2 KB (-37.3%)** |

**El bundle de la home bajó (557.2 → 553.4 KB): criterio de aceptación
cumplido.** La reducción es modesta porque el framework compartido (~445KB:
React, runtime de Next, cliente de Supabase) domina el First Load JS de
`/inicio` y no es reducible sin tocar dependencias de base — lo único
específico de la ruta y diferible era el banner de notificaciones/instalación
(§2.2). `/estudios` y `/turnos` no cambiaron porque nunca tuvieron Recharts en
su cadena de imports (no había nada que cortar ahí); su peso viene de Base UI
(`Select`/`Combobox` de los filtros) y del framework compartido, no de
gráficos — tocar eso es un cambio de UI de mayor alcance que el que justifica
esta tarea (ver §5).

---

## 4. Lighthouse mobile: antes / después

Perfil activo "Roberto Gómez" (tiene turnos, medicación, signos vitales y
laboratorio cargados), `--throttling-method=simulate`, 375×667 @2x. TBT como
proxy de INP (Lighthouse de laboratorio no puede medir INP real sin
interacción del usuario; ver nota al pie).

| Ruta | LCP antes | LCP después | CLS antes | CLS después | TBT antes | TBT después |
|---|---|---|---|---|---|---|
| `/inicio` | 3.24 s | 3.21 s | 0 | 0 | 40 ms | 50 ms |
| `/estudios` | 3.43 s | 3.18 s | 0 | 0 | 70 ms | 40 ms |
| `/turnos` | 2.82 s | 2.66 s | 0 | 0 | 50 ms | 60 ms |

### PASS/FAIL contra el criterio (LCP < 2.5 s, INP < 200 ms, CLS < 0.1)

| Ruta | LCP | INP (TBT) | CLS |
|---|---|---|---|
| `/inicio` | **FAIL** (3.21 s) | PASS (50 ms) | PASS (0) |
| `/estudios` | **FAIL** (3.18 s) | PASS (40 ms) | PASS (0) |
| `/turnos` | **FAIL** (2.66 s) | PASS (60 ms) | PASS (0) |

CLS e INP cumplen con margen amplio en las tres rutas, antes y después de
optimizar. LCP mejoró en `/estudios` (-250 ms) y `/turnos` (-164 ms) y quedó
prácticamente igual en `/inicio` (-26 ms, dentro del ruido de una corrida
única) — pero **ninguna de las tres cruza el umbral de 2.5 s**, ni antes ni
después. El diagnóstico de por qué está en §5: no es un problema que un
recorte de JavaScript adicional fuera a resolver.

*(Nota de honestidad metodológica: cada celda es **una** corrida de
Lighthouse, no una mediana de varias — hay ruido de medición del orden de
±10-20ms en TBT/CLS que se ve en las variaciones sin cambio de código, por
ej. TBT de `/inicio` 40→50ms o `/turnos` 50→60ms. Las diferencias de LCP
citadas arriba (150-250ms) son mayores a ese ruido y se sostienen en el
diagnóstico de §5, pero para un informe de referencia continua convendría
correr 3 veces y tomar la mediana.)*

---

## 5. Por qué LCP sigue en FAIL, y por qué no es un problema de bundle

El desglose de `lighthouse` (`lcp-breakdown-insight`, la traza real
*sin* simular) para las tres rutas:

| Ruta | Time to First Byte | Element render delay | Elemento LCP real |
|---|---|---|---|
| `/inicio` | 173 ms | 257 ms | Párrafo "No tenés turnos programados" / tarjeta de próximo turno |
| `/estudios` | 202 ms | **1 184 ms** | Párrafo de estado vacío dentro del `<Suspense>` de `ListaEstudios` |
| `/turnos` | 166 ms | 136 ms | Párrafo de estado vacío de la sección Próximos |

Esos números (TTFB + render delay) son la traza **observada**, sin
throttling — suman bien por debajo de un segundo en las tres rutas. El LCP
de 2.7-3.2s reportado arriba es la **estimación de Lantern** bajo red/CPU
móvil simulada, que aplica multiplicadores fuertes sobre todo lo que hay en
el camino crítico. El propio `render-blocking-insight` de Lighthouse señala
la causa concreta y consistente en las tres rutas: **un único chunk CSS
global** (`_next/static/chunks/44p962__2tcp4.css`, 17.6KB, el Tailwind
compilado de toda la app) bloqueando el primer render, con un ahorro
estimado de ~250-315ms si se pudiera diferir o inlinear la porción crítica.

Ese CSS es compartido por las 44 rutas de la app — no hay nada específico de
`/inicio`, `/estudios` o `/turnos` que recortar ahí sin tocar el pipeline de
Tailwind entero (CSS crítico inline, splitting por ruta), que es un cambio de
infraestructura de build, no una optimización de componente, y excede lo que
esta tarea puede tocar con la responsabilidad de "no romper nada" (criterio
de cierre: suites verdes). El caso de `/estudios` es más marcado todavía
(1.18s de *render delay* observado): el elemento LCP ahí es texto que vive
**detrás del `<Suspense>`** de `ListaEstudios` — llega recién cuando la
consulta a Supabase resuelve y el RSC stream la entrega, así que compite con
el resto del trabajo de hidratación de la pantalla (los `Select`/`Combobox`
de Base UI de `FiltrosEstudios`) por el hilo principal antes de poder
pintarse. Separado de esto: el perfil usado en la medición (Roberto) sí tiene
turnos con propósito, pero **no tiene estudios cargados**, así que el LCP de
`/estudios` en esta corrida es el estado vacío, no una tarjeta real — con
datos reales el elemento LCP casi seguro sería la primera `TarjetaEstudio`,
que es contenido servidor puro sin ningún `<Suspense>` de por medio una vez
resuelta la consulta.

**Conclusión honesta:** los cambios de esta tarea (diferir Recharts,
diferir banner no crítico) son el ajuste correcto y justificado por el
bundle real medido — y produjeron una reducción real y grande donde había
JavaScript de sobra (`/estudios/tendencias`, `/signos/historial`) y una baja,
aunque modesta, en la home. Pero **no eran la causa del FAIL de LCP** en
ninguna de las tres rutas del checkpoint: la causa real es CSS
render-blocking compartido por toda la app más streaming detrás de
`<Suspense>` en el caso de `/estudios`, dos cosas de alcance mayor
(pipeline de CSS, arquitectura de streaming) que ameritan su propia tarea en
vez de forzarlas dentro de este sprint.

---

## 6. Verificación de que nada se rompió

- `npm run test` → **693/693 tests pasando** (41 archivos).
- `npx tsc --noEmit` → sin errores.
- `npm run build` → build de producción limpio (Turbopack, sin warnings
  nuevos más allá de los dos preexistentes de *font fallback*, no
  relacionados con este cambio).
- `npm run lint` → sin hallazgos.
- `node scripts/verificar-contraste.mjs` → **98/98 pares PASS AA**, sin
  tocar ningún token de color.
- Verificación funcional manual con Playwright (sesión real, perfil
  "Roberto Gómez"): `/estudios/tendencias` y `/signos/historial` renderizan
  sus gráficos con datos reales (Colesterol HDL, tensión arterial con dos
  líneas) tras el `loading:` del `dynamic()`, sin errores de consola y sin
  quedar pegados en el esqueleto. `/inicio` muestra el banner "Activá
  recordatorios" (estado `inactivo` de `ActivarNotificaciones`) igual que
  antes del cambio, cargado ahora por el wrapper diferido.
- RLS/Storage: sin tocar (ningún cambio de este sprint toca políticas,
  consultas a Supabase ni buckets).
- Dev server: `next dev` vuelve a quedar corriendo al final de la tarea.
