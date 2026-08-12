# TOOLING.md — Análisis de herramientas para MiHistorialMédico

## 1. Propósito

Este documento consolida el análisis de los recursos que el usuario pidió evaluar como candidatos para el toolkit de desarrollo de **MiHistorialMédico** (PWA de historial clínico personal, enfocada en Senior UX, construida con Next.js + Supabase + Gemini, desarrollada en Windows 11 con Claude Code): cinco videos de TikTok, el plugin oficial `claude-code-setup` de Anthropic, y las skills **Frontend Design** (Anthropic), **UI UX Pro Max**, **Vercel Agent Skills** y **Emil Kowalski Skills**. Para cada uno se documenta qué es, por qué aporta (o no) valor concreto a este proyecto, los comandos de instalación verificados para Windows/PowerShell + Claude Code, la configuración posterior necesaria, y las fuentes usadas. Los datos con verificación parcial o inferida se marcan explícitamente como "a verificar" — no se completó ningún dato inventado.

## 2. Tabla resumen

| Herramienta | Qué aporta al proyecto | Estado | Confianza |
|---|---|---|---|
| `claude-code-setup` (plugin oficial Anthropic) | Analiza el repo Next.js/Supabase/Gemini y sugiere MCP servers, skills, hooks y subagentes a medida, antes de instalar nada más | Opcional (recomendado como primer paso, de bajo riesgo) | Alta |
| **UI UX Pro Max** | Genera sistema de diseño (paleta, tipografía, patrones UX/anti-patrones) buscable localmente, útil para definir la identidad visual Senior UX de la app | Instalar | Alta (el paquete npm `ui-ux-pro-max-cli` puntual: confianza **media**, no se pudo verificar contra el registry) |
| **Vercel Agent Skills** (`web-design-guidelines`, `react-best-practices`, `composition-patterns`, `deploy-to-vercel`) | Guías de accesibilidad/UX/performance para el UI, 70 reglas de performance React/Next.js, y patrones de composición aplicables directo sobre shadcn/ui | Instalar | Alta |
| **Emil Kowalski Skills** (`emil-design-eng` y afines) | Reglas de "buen gusto" para animaciones/microinteracciones: easing, duración, `prefers-reduced-motion` — crítico en una app para usuarios senior | Instalar (selectivo, no las 10 completas) | Alta |
| **Frontend Design** (Anthropic) | Framework de 4 preguntas (propósito, tono, restricciones, diferenciación) para evitar estética genérica de IA | **Ya disponible** en este entorno | Alta |
| **superpowers** (mencionado por instrucciones globales del usuario) | Flujos de brainstorming, TDD, revisión de código, planes de ejecución | **Ya disponible** en este entorno | N/D — no fue objeto de esta investigación, se confirma por la lista de skills activas del entorno actual |
| 5 videos de TikTok | **Analizados por completo el 2026-08-12** con navegador real (captions + frames) — herramientas nuevas identificadas: Impeccable, Open Design, Taste Skill, DESIGN.md (VoltAgent), Context7, Claude-Mem | Resuelto — ver §8 | Alta |

## 3. Nota honesta sobre los TikToks

> **Actualización 2026-08-12:** esta limitación quedó superada. Los cinco videos se analizaron por completo con navegador real (captions, frames y carruseles) y el resultado está en la **§8** de este documento. Esta sección se conserva como registro del primer intento y de por qué falló.

Los cinco links se resolvieron correctamente (redirect 3xx) hacia perfiles/posts reales de TikTok, pero **WebFetch no pudo extraer contenido real de ninguno**: TikTok es una SPA que renderiza título, caption y metadata vía JavaScript en el cliente, y el HTML estático devuelto solo trae un `og:title` genérico ("TikTok - Make Your Day"), sin `og:description`, `twitter:description` ni caption. No hay transcripción, no hay texto en pantalla, no hay audio analizado. Por eso **no se identificó ninguna herramienta ni tema concreto a partir de estos videos** — cualquier intento de adivinar el contenido a partir del handle del creador sería inventar datos, algo que esta investigación tuvo explícitamente prohibido.

Esto es lo único verificable de cada uno:

| # | URL | Redirige a | Dato extraído |
|---|---|---|---|
| 1 | `https://vt.tiktok.com/ZSCC2KgcC/` | `@agustin.ruppel_/video` | Ninguno (solo og:title genérico) |
| 2 | `https://vt.tiktok.com/ZS4SWDyex/` | `@esmejorconia/photo` | Ninguno |
| 3 | `https://vt.tiktok.com/ZS4vVTeso/` | `@revolutia.ai/video` | Ninguno |
| 4 | `https://vt.tiktok.com/ZS4vbYNRo/` | `@santiperedo/video` | Ninguno |
| 5 | `https://vt.tiktok.com/ZS4vbtEGt/` | `@itsvictorchaves/photo` | Ninguno |

**Conclusión:** ninguno de los cinco links se pudo mapear a una herramienta específica con evidencia real. Si alguno de estos videos era la fuente original de la recomendación de UI UX Pro Max, Vercel Skills, Emil Kowalski Skills o claude-code-setup, esa conexión **no quedó confirmada por esta investigación** — esas cuatro herramientas se evaluaron de forma independiente, por nombre, no por el contenido de los TikToks. Si te importa esa trazabilidad puntual, la única forma de resolverla es mirar los videos manualmente (con audio/video real) y decírmelo.

## 4. Herramientas evaluadas

### 4.1 `claude-code-setup` (plugin oficial de Anthropic)

**Qué es.** Plugin oficial del repo `anthropics/claude-plugins-official` que consiste en una única skill, `claude-automation-recommender`. Es de **solo lectura**: escanea la estructura del proyecto actual (dependencias, frameworks, archivos) y devuelve un reporte con 1-2 recomendaciones concretas por categoría de automatización de Claude Code (MCP servers, skills, hooks, subagentes, plugins), con instrucciones de setup para cada una. No modifica nada por sí mismo. Se activa por lenguaje natural ("recommend automations for this project", "help me set up Claude Code", "what hooks should I use?"), no trae comandos slash propios.

**Por qué sirve para este proyecto.** MiHistorialMédico combina Next.js + Supabase + Gemini con requisitos particulares (PWA, Senior UX, datos médicos sensibles). Correrlo una vez, antes de decidir qué más instalar, da un diagnóstico específico del repo real (por ejemplo, podría sugerir un MCP server de Supabase, hooks de validación de charset/UTF-8 coherentes con las reglas globales del usuario, o subagentes para revisión de accesibilidad) en vez de instalar herramientas genéricas "a ciegas".

**Instalación (Windows/PowerShell + Claude Code).**

```text
# Estos comandos se escriben DENTRO de la sesión interactiva de Claude Code
# (abrís PowerShell, corrés `claude`, y ahí adentro tipeás esto):

/plugin marketplace add anthropics/claude-plugins-official
/plugin install claude-code-setup@claude-plugins-official
/reload-plugins
# ^ correr /reload-plugins SOLO si el resumen de instalación dice
#   "Run /reload-plugins to activate."
```

```powershell
# Alternativa para scripting, sin entrar a la sesión interactiva
# (esto sí corre directo en PowerShell):
claude plugin install claude-code-setup@claude-plugins-official
# instala a scope de usuario por defecto; agregar --scope project
# o --scope local si se necesita otro alcance
```

Nota: el marketplace oficial `claude-plugins-official` normalmente ya está agregado automáticamente la primera vez que corriste Claude Code de forma interactiva, así que en la mayoría de los casos el paso `/plugin marketplace add` es innecesario.

**Configuración posterior.** Ninguna — es puramente conversacional, no toca archivos del proyecto ni requiere variables de entorno ni ajustes de charset/BD.

**Fuentes.**
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-code-setup/README.md
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/plugins/claude-code-setup/.claude-plugin/plugin.json
- https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json
- https://code.claude.com/docs/en/discover-plugins
- https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup

---

### 4.2 UI UX Pro Max

**Qué es.** Skill/CLI de "inteligencia de diseño" del repo `nextlevelbuilder/ui-ux-pro-max-skill` (116.077 estrellas, MIT, verificado vía API de GitHub). Trae una base de datos local buscable (sin llamadas de red, solo Python 3 stdlib) con 84 estilos de UI, 192 paletas de color, 74 combinaciones tipográficas de Google Fonts, 25 tipos de gráficos, 98 guías de UX, y reglas de razonamiento por tipo de producto para 22 stacks (incluye React/Next.js/Tailwind). Su función flagship (`--design-system`) analiza el proyecto y devuelve paleta, tipografía, patrones y anti-patrones a evitar.

**Por qué sirve para este proyecto.** Para una app de historial médico dirigida a usuarios senior, la identidad visual no puede ser genérica ni "trendy porque sí": necesita contraste alto, tipografía legible, paletas que transmitan confianza clínica y patrones de UX validados (no solo estéticos). El generador de sistema de diseño (`--design-system`) da un punto de partida objetivo para paleta/tipografía en vez de que cada pantalla se diseñe ad-hoc, y la base de 98 guías de UX + 25 tipos de gráfico es directamente útil para mostrar líneas de tiempo clínicas, mediciones y tendencias de forma legible para adultos mayores. (Recomendación: al usarla, pedile explícitamente patrones "para accesibilidad/adultos mayores/alto contraste" — la skill no tiene una categoría dedicada confirmada a "senior UX" en los datos investigados, así que no asuma que lo prioriza sin pedírselo.)

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
# Prerrequisito: verificar Python 3.x — en Windows probar ambos alias
python --version
py --version
```

```text
# === Método 1 (oficial, recomendado) — dentro de la sesión de Claude Code ===
/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
/plugin install ui-ux-pro-max@ui-ux-pro-max-skill
```

```powershell
# === Método 2 (oficial, CLI npm) — en PowerShell/CMD ===
npm install -g ui-ux-pro-max-cli
cd F:\Proyectos\historialclinico
uipro init --ai claude

# Instalación global (para todos los proyectos, no solo este):
uipro init --ai claude --global

# Mantenimiento:
uipro versions
uipro update
uipro update --global
uipro uninstall
uipro uninstall --global
```

```powershell
# === Método 3 (alternativo, CLI comunitario de terceros "skills.sh" / Vercel Labs) ===
npx skills add nextlevelbuilder/ui-ux-pro-max-skill
```

**Configuración posterior.** En Windows, el propio script interno de la skill invoca `python ...scripts/search.py` (no `python3`), así que asegurate de que el comando `python` esté en el PATH — el launcher `py` no alcanza si el script llama a `python` directamente. No requiere red para operar (toda la base es local), solo la necesitó para instalarse.

**A verificar:** el paquete npm `ui-ux-pro-max-cli` no se pudo confirmar de forma directa contra el registry (timeout/403 en los intentos de la investigación); el nombre y el comando `uipro init --ai claude` están documentados de forma consistente en el README oficial, pero antes de correr `npm install -g` en una máquina nueva conviene un chequeo rápido (`npm view ui-ux-pro-max-cli`) para confirmar que el paquete existe tal cual con ese nombre.

**Fuentes.**
- https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- https://api.github.com/repos/nextlevelbuilder/ui-ux-pro-max-skill
- https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/README.md
- https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/.claude/skills/ui-ux-pro-max/SKILL.md
- https://skills.sh/nextlevelbuilder/ui-ux-pro-max-skill
- https://www.uupm.cc/

---

### 4.3 Vercel Agent Skills

**Qué es.** Vercel mantiene el CLI open-source `npx skills` (repo `vercel-labs/skills`, no exclusivo de Vercel, compatible con 75+ agentes incluido Claude Code) y una colección propia de skills en `vercel-labs/agent-skills`. Carpetas reales confirmadas vía API de GitHub: `composition-patterns`, `deploy-to-vercel`, `react-best-practices`, `react-native-skills`, `react-view-transitions`, `vercel-cli-with-tokens`, `vercel-optimize`, `web-design-guidelines`, `writing-guidelines`.

**Por qué sirve para este proyecto.** Para el stack de MiHistorialMédico (Next.js + Tailwind + shadcn/ui) las tres más relevantes son:
- **`web-design-guidelines`**: accesibilidad, UX y performance del UI — directamente aplicable a componentes shadcn y crítico para Senior UX (contraste, tamaños de touch target, legibilidad).
- **`react-best-practices`**: 70 reglas de performance React/Next.js — importante porque usuarios senior suelen tener dispositivos/conexiones más limitados.
- **`composition-patterns`**: patrones de composición de componentes React, evita prop-drilling — encaja con el patrón típico de shadcn/ui.

`deploy-to-vercel` es opcional y solo suma valor si el deploy final se hace con Vercel CLI vía Claude Code (no confundir con las reglas globales del usuario de "nada se sube a producción sin pedido explícito" — instalar la skill no dispara ningún deploy por sí sola). No existe una skill específica "shadcn/ui" en el repo.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
# Ver qué skills trae el repo antes de instalar
npx skills add vercel-labs/agent-skills --list

# Instalar las 3 recomendadas para este proyecto (scope: proyecto actual)
npx skills add vercel-labs/agent-skills -a claude-code -s web-design-guidelines -s react-best-practices -s composition-patterns -y

# Opcional: deploy-to-vercel
npx skills add vercel-labs/agent-skills -a claude-code -s deploy-to-vercel -y

# Opcional: instalar una skill a nivel global (todos los proyectos)
npx skills add vercel-labs/agent-skills -a claude-code -s web-design-guidelines -g

# Instalar la colección completa (no recomendado para este proyecto, incluye react-native, etc.)
npx skills add vercel-labs/agent-skills --all
```

Comandos de mantenimiento:

```powershell
npx skills list
npx skills list -g
npx skills list -a claude-code
npx skills find react
npx skills find --owner vercel
npx skills update
npx skills update web-design-guidelines react-best-practices
npx skills remove web-design-guidelines
npx skills remove --all
```

**Configuración posterior.** Requiere Node.js/npm en PATH (cross-platform, no hace falta WSL). Con `-a claude-code` el CLI coloca las skills en `.claude/skills/` (proyecto) o `~/.claude/skills/` (global, con `-g`). **Importante:** `web-design-guidelines` no embebe las reglas en el `SKILL.md` — las trae en vivo desde un repo de Vercel Labs cada vez que se usa, así que necesita acceso a internet en el momento de invocarla, no solo al instalar. `deploy-to-vercel` requiere el Vercel CLI instalado y, si no hay sesión autenticada, intenta un flujo sin token; para uso recurrente con CI conviene la variante `vercel-cli-with-tokens` (token vía variable de entorno, nunca como flag en el historial de shell).

**Fuentes.**
- https://github.com/vercel-labs/skills
- https://github.com/vercel-labs/agent-skills
- https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/web-design-guidelines/SKILL.md
- https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md
- https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/deploy-to-vercel/SKILL.md
- https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem
- https://vercel.com/docs/agent-resources/skills
- https://www.npmjs.com/package/skills

---

### 4.4 Emil Kowalski Skills

**Qué es.** Repo oficial de Emil Kowalski (ex-Vercel/Linear, autor de Sonner/Vaul, `emilkowalski/skills`, MIT). Diez skills orientadas a compensar que "los agentes no tienen buen gusto" en UI/animaciones. La principal, **`emil-design-eng`**, codifica reglas concretas: qué animar y qué no (nunca animar acciones repetitivas por teclado), easing (`ease-out` para entradas, `ease-in-out` para movimiento en pantalla, nunca `ease-in`), duraciones (UI <300ms, botones 100-160ms, modales 200-500ms), performance (animar solo `transform`/`opacity`), y **accesibilidad de movimiento** (`prefers-reduced-motion`, hover gating en touch). Las otras nueve incluyen `review-animations` (audita animaciones existentes), `pick-ui-library` (elige librerías de componentes en vez de reinventar), `find-animation-opportunities`, `apple-design`, entre otras.

**Por qué sirve para este proyecto.** Dos puntos son directamente relevantes para Senior UX en una PWA médica: (1) el respeto obligatorio a `prefers-reduced-motion` — usuarios mayores son más propensos a sensibilidad al movimiento y a tener esa preferencia activada en el SO; y (2) las duraciones/easing conservadores evitan microinteracciones que confundan a usuarios menos habituados a interfaces animadas. `pick-ui-library` también es relevante porque el proyecto ya usa shadcn/ui: ayuda a no reinventar componentes que shadcn ya resuelve bien. No hace falta instalar las 10 — para este proyecto alcanza con `emil-design-eng`, `review-animations` y `pick-ui-library`.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
# Instala las 10 skills del repo
npx skills@latest add emilkowalski/skills

# Instalar solo una skill puntual (recomendado para este proyecto: repetir por cada una)
npx skills add emilkowalski/skills/emil-design-eng
npx skills add emilkowalski/skills/review-animations
npx skills add emilkowalski/skills/pick-ui-library
```

**Configuración posterior.** Ninguna especial — se invoca en Claude Code pidiendo explícitamente "usá la skill emil-design-eng para revisar esta animación", o el harness la dispara solo si la descripción matchea la tarea. **A verificar (confianza baja):** las cifras de popularidad (~675K instalaciones, ~202K para `emil-design-eng`) vienen de `skills.sh` y no están verificadas de forma independiente — no afectan la recomendación de uso, solo se citan como referencia de adopción.

**Fuentes.**
- https://github.com/emilkowalski/skills
- https://github.com/emilkowalski/skills/blob/main/README.md
- https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md
- https://skills.sh/emilkowalski/skills
- https://emilkowal.ski/skill
- https://emilkowal.ski/ui/agents-with-taste

## 5. Ya disponible en este entorno (no reinstalar)

Dos de los recursos evaluados **ya están activos en el entorno actual de Claude Code del usuario** — confirmado por la lista de skills disponibles de esta misma sesión, no requieren ningún comando de instalación:

- **`frontend-design`** (Anthropic): ya habilitada. Aplica su framework de 4 preguntas (propósito, tono, restricciones, diferenciación) automáticamente al crear o restylear componentes/pantallas — no hace falta invocarla con un comando especial, simplemente pedí crear/mejorar UI y actúa como design lead. Si en algún momento no aparece activa, verificar con `/plugin marketplace list` y `/plugin` dentro de Claude Code.
- **`superpowers`** (paquete completo: `brainstorming`, `writing-plans`, `executing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `using-git-worktrees`, etc.): ya habilitada. Cubre flujos de desarrollo (no de diseño visual) que complementan a las cuatro skills de la sección 4 — por ejemplo, usar `superpowers:brainstorming` antes de implementar una pantalla nueva y luego `frontend-design` / `emil-design-eng` para la parte visual.

No instalar de nuevo `claude-code-setup`, ni buscar plugins equivalentes a estos dos — ya cumplen esa función en este entorno.

## 6. Orden de instalación recomendado

1. **`claude-code-setup`** primero. Es de solo lectura, cero riesgo, y da un diagnóstico específico del repo real de MiHistorialMédico antes de decidir con qué prioridad instalar el resto (por ejemplo, puede confirmar o descartar la necesidad de un MCP server de Supabase).
2. **UI UX Pro Max** segundo. Define paleta, tipografía y patrones base del sistema de diseño — conviene tenerlo antes de escribir componentes, para no rehacer estilos después.
3. **Vercel Agent Skills** (`web-design-guidelines`, `react-best-practices`, `composition-patterns`) tercero. Se aplican mientras se construyen los componentes reales sobre shadcn/ui, una vez que ya hay un sistema de diseño de base.
4. **Emil Kowalski Skills** (`emil-design-eng`, `review-animations`, `pick-ui-library`) cuarto. Es una capa de pulido (animaciones/microinteracciones) que tiene más sentido aplicar sobre componentes que ya existen, no antes.
5. **`frontend-design`** y **`superpowers`** ya están activas desde el día uno — no son parte de esta secuencia, se usan en paralelo durante todo el desarrollo.

**Comandos de verificación (una vez instalado todo):**

```text
# Dentro de la sesión de Claude Code:
/plugin marketplace list
/plugin
```

```powershell
# En PowerShell — confirma versiones y presencia de cada herramienta:
python --version
py --version
uipro versions
npx skills list -a claude-code
npx skills list -g
dir .claude\skills
```

## 7. Hallazgos adicionales de la investigación (fuera del pedido original de las 4 herramientas + TikToks, pero relevados con la misma evidencia)

Estos dos puntos no formaban parte del pedido explícito, pero surgieron de la misma investigación y son accionables sobre el stack real del proyecto — se documentan acá para no perderlos, marcados aparte para que quede claro que no son "herramientas a instalar" sino verificaciones de dependencias.

### 7.1 Gemini: acción urgente, no solo a futuro

- **`gemini-1.5-flash` está retirado desde el 24/09/2025** (confirmado en el foro oficial de Google AI Developers, coherente con `ai.google.dev/gemini-api/docs/deprecations`). Si el código de MiHistorialMédico todavía llama a este modelo para OCR/extracción de documentos médicos, las llamadas ya están fallando en producción — no es un "aviso a futuro".
- **`@google/generative-ai` está deprecado y archivado** (fin de soporte 30/11/2025, repo archivado 16/12/2025). El SDK vigente es **`@google/genai`** (`npm i @google/genai`).
- **Recomendación de modelo:** `gemini-2.5-flash` como principal para OCR + extracción JSON de documentos médicos (sin fecha de apagado anunciada a la fecha de esta investigación), con `gemini-2.5-flash-lite` como variante más barata para documentos simples. Evitar `gemini-2.0-flash` para código nuevo: tiene shutdown confirmado para el 01/06/2026.
- El endpoint `generateContent` con `responseSchema` (structured output a JSON) sigue totalmente soportado y es suficiente para este caso de uso; no hace falta migrar a la nueva "Interactions API" de Google para un pipeline de extracción de campos.
- **A verificar (confianza baja):** la fecha exacta de disponibilidad general de la "Interactions API" no se pudo fijar con precisión de día — no afecta la recomendación práctica de arriba.

### 7.2 Stack Next.js/Supabase/Tailwind: vigencia de versiones (agosto 2026)

- **Next.js 16.3** + **React 19** son la combinación recomendada actual (`create-next-app@latest` ya las trae por defecto).
- **Supabase:** usar exclusivamente `@supabase/ssr` (`createBrowserClient` / `createServerClient`). `@supabase/auth-helpers` está deprecado — **nunca mezclar ambos paquetes en la misma app** (genera conflictos de auth).
- **Tailwind CSS v4.3**: configuración por CSS puro (`@theme` en vez de `tailwind.config.js`), colores en OKLCH.
- **shadcn/ui**: totalmente compatible con Tailwind v4 + React 19 + Next.js 16 a la fecha de esta investigación.

**Fuentes (7.1 y 7.2):**
- https://ai.google.dev/gemini-api/docs/deprecations
- https://github.com/google-gemini/deprecated-generative-ai-js
- https://github.com/googleapis/js-genai
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/document-processing
- https://nextjs.org/blog/next-16-3
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://tailwindcss.com/blog/tailwindcss-v4
- https://ui.shadcn.com/docs/tailwind-v4

## 8. Herramientas identificadas en los TikToks (análisis completo)

La limitación registrada en la §3 (WebFetch no podía extraer contenido real de TikTok) quedó superada: los cinco videos se volvieron a analizar con navegador real, frame a frame, leyendo captions, texto en pantalla y las skills/plugins nombrados explícitamente en cada uno. A diferencia de la primera pasada, acá sí hay contenido concreto para documentar. La tabla siguiente mapea cada video a las herramientas que muestra y marca cuáles ya estaban cubiertas en las secciones 1 a 7 de este documento (o ya activas en el entorno del usuario) y cuáles son nuevas — estas últimas se documentan en detalle en las §8.2 a §8.7.

### 8.1 Qué mostraba cada video (mapeo completo)

| # | Video (creador) | Herramientas / conceptos que muestra | Estado |
|---|---|---|---|
| 1 | **@agustin.ruppel_** — "5 skills de diseño" | DESIGN.md (VoltAgent) · UI UX Pro Max · Open Design · Impeccable · frontend-design (esta última referida por el README de Impeccable; en pantalla se muestran 4) | UI UX Pro Max (§4.2) y frontend-design (§5) ya documentadas. **Nuevas:** DESIGN.md → §8.5, Open Design → §8.3, Impeccable → §8.2 |
| 2 | **@esmejorconia** — carrusel "Tu equipo Claude" (42 skills en 7 departamentos: Dev, Diseño, Marketing, Social, Finanzas, Ops, Legal) | Concepto organizativo, no una herramienta puntual | Casi todas las skills de Dev/Diseño del carrusel ya están activas en el entorno actual: Superpowers, frontend-design, web-artifacts (`web-artifacts-builder`), canvas-design, algorithmic-art, slack-gif (`slack-gif-creator`), seo-audit, xlsx, docx, internal-comms, MCP Builder (`mcp-builder`), Skill Creator (`skill-creator`), Webapp Testing (`webapp-testing`). **Nuevas:** Context7 → §8.6, Claude-Mem → §8.7. El resto del carrusel (departamentos de Marketing, Finanzas, Legal: `dcf-model`, `pitch-deck`, `contract-review`, etc.) no tiene aplicación en una PWA médica y no se documenta acá |
| 3 | **@revolutia.ai** | Emil Kowalski Skills · Impeccable · Taste Skill · Figma MCP · Playwright MCP | Emil Kowalski (§4.4) ya documentada; Playwright MCP ya está en el entorno del usuario (`mcp__playwright__*`), no requiere instalación. **Nuevas:** Impeccable → §8.2 (coincide con video 1), Taste Skill → §8.4. **Figma MCP: a verificar** — el video lo nombra pero no se investigó en esta pasada (no forma parte de la investigación verificada adjunta); no hay datos de repo, instalación ni confianza para documentarlo con el mismo estándar que el resto — no se recomienda instalar hasta verificarlo |
| 4 | **@santiperedo** (SantIA) | `claude-code-setup` + playbook de Boris Cherny (Anthropic) | `claude-code-setup` ya documentado (§4.1). El playbook de Cherny (planear antes de escribir código, mantener un archivo de reglas mínimo, hacer que el agente revise su propio trabajo) es una **práctica de workflow, no una herramienta instalable** — no genera subsección propia. Ver nota en el veredicto (§8.8) |
| 5 | **@itsvictorchaves** | 8 plugins: `gstack`, `superpowers`, `codex-plugin-cc`, `financial-services`, `claude-for-legal`, marketplace `claude-skills`, `marketingskills`, `social-media-skills`. 8 skills: `frontend-design`, `hyperframes`, `ai-second-brain`, `notebooklm-skill`, `humanizer`, `claude-seo`, skills de Vue/Vite, `caveman` | `superpowers` y `frontend-design` ya activas (§5). El resto son packs de nicho (legal, finanzas, marketing, redes sociales, Vue/Vite, notas tipo "second brain") **sin relevancia de dominio** para una PWA médica en Next.js/Tailwind/shadcn — no se investigaron en profundidad porque el mismatch de dominio es evidente a simple vista, se listan por completitud y quedan descartados en el veredicto (§8.8) |

### 8.2 Impeccable

**Qué es.** Sistema de skills/comandos para agentes de código (Claude Code, Cursor, Codex CLI, Gemini CLI, Grok Build, GitHub Copilot, entre otros) creado por Paul Bakaus (repo `pbakaus/impeccable`, Apache-2.0) para combatir el "AI slop" de frontend: Inter para todo, gradientes púrpura-azul, cards anidadas sin fin, texto gris sobre fondos de color, íconos redondeados sobre cada heading. Se instala como una skill (`/impeccable`) con 23 subcomandos (`init`, `craft`, `shape`, `critique`, `audit`, `polish`, `bolder`, `quieter`, `distill`, `harden`, `onboard`, `animate`, `colorize`, `typeset`, `layout`, `delight`, `overdrive`, `clarify`, `adapt`, `optimize`, `live`, `document`, `extract`) respaldados por un motor detector con **59 reglas anti-patrón determinísticas** (el número creció desde las ~27+12 que suelen citar videos más viejos — el proyecto se actualiza muy seguido) más critique asistido por LLM. El propio README lo presenta explícitamente como evolución de `frontend-design` de Anthropic: *"Anthropic's frontend-design was the first widely-used design skill for Claude. Impeccable started there."* Trae además CLI standalone (`npx impeccable detect`), extensión de navegador Chrome/Firefox para correr el detector sin LLM ni API key, y un "Live Mode" (Beta) para iterar visualmente eligiendo elementos en el browser y recibiendo variantes vía HMR.

**Por qué sirve para este proyecto.** Aporta sin ser medical-specific: (1) respeta tokens/componentes existentes en vez de imponer los suyos — documentado como "Design System Integration: Respects existing tokens, components, and conventions", así que convive con Tailwind v4 + shadcn/ui sin pisarlos; (2) el detector de 59 reglas incluye chequeos de accesibilidad, touch targets chicos, contraste, jerarquía de headings y largo de línea — justo lo crítico para Senior UX; (3) `/impeccable audit` corre a11y + performance + responsive, `/impeccable harden` cubre manejo de errores/edge cases (relevante en formularios clínicos), `/impeccable clarify` mejora copy poco claro (relevante para instrucciones médicas), `/impeccable adapt` adapta a distintos dispositivos (relevante siendo PWA instalable). El hook del detector corre automáticamente en cada edición de archivos de UI dentro de Claude Code, dando feedback inline sin salir del flujo. **No reemplaza** una auditoría de accesibilidad clínica/WCAG dedicada — para eso ya está la skill local `a11y-audit` — sino que la complementa a nivel de consistencia visual.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
# Desde la raíz del proyecto — requiere Node >=22.12.0
cd F:\Proyectos\historialclinico
npx impeccable install
# Elegí el harness "Claude Code" y scope "project". Reload de Claude Code después.
```

```text
# Dentro de la sesión de Claude Code, inicializar el contexto de diseño del proyecto:
/impeccable init

# Alternativa nativa vía marketplace de plugins (no reemplaza el detector, que solo instala la vía npx):
/plugin marketplace add pbakaus/impeccable
# luego /plugin → instalar "Impeccable" de la lista

# Para actualizar más adelante:
npx impeccable update

# Pinnear un comando usado seguido como slash-command corto:
/impeccable pin audit
```

**Configuración posterior.** El versionado es por componente, no uno solo: skill (Claude Code) en `skill-v4.0.4`, CLI npm en dist-tag `latest` = `3.5.0`, extensión de navegador en `ext-v1.3.1` — si un video menciona otras versiones, están desactualizadas (el repo pasó de creado el 2025-11-16 a 58.541 estrellas al 2026-08-12). Hubo dos bugs de Windows ya resueltos, sin caveats pendientes conocidos: v3.1.1 arregló que `/impeccable critique` fallara en Windows por mezcla forward-slash/backslash entre `import.meta.url` y `process.argv[1]`; v3.0.2 cambió la extracción de ZIP a `fflate` puro-JS para evitar cuelgues de instalación en Node ≥24.16.

**Confianza:** Alta (verificado con GitHub API, README y DESIGN.md crudos, npm registry y release notes — no solo blogs).

**Fuentes.**
- https://github.com/pbakaus/impeccable
- https://api.github.com/repos/pbakaus/impeccable
- https://raw.githubusercontent.com/pbakaus/impeccable/main/README.md
- https://raw.githubusercontent.com/pbakaus/impeccable/main/DESIGN.md
- https://registry.npmjs.org/impeccable
- https://impeccable.style/ · https://impeccable.style/changelog/
- https://github.com/pbakaus/impeccable/releases/tag/ext-v1.3.1

---

### 8.3 Open Design

**Qué es.** App de escritorio local-first (`nexu-io/open-design`, Apache-2.0, Electron/Next.js 16/Node 24/Express/SQLite) que **no trae agente propio**: conecta agentes de código ya instalados (Claude Code, Cursor, Copilot, Codex, Gemini CLI, OpenCode, Qwen y ~20 más) vía un servidor MCP stdio y un CLI llamado `od`, usando BYOK (API keys propias). Dos features confirmadas: **"Prototype"** (artefactos HTML de una página, en iframe sandboxeado, que leen un DESIGN.md y exportan a HTML/PDF/PPTX/MP4) y **"HyperFrame"** (motion programático renderizado a MP4 real vía headless Chrome + FFmpeg, 1920×1080 30fps). Versión actual verificada vía API de Releases: **v0.19.0** (11-ago-2026) — el proyecto libera cada 2-4 días.

**Por qué sirve para este proyecto (y por qué con cautela).** Sirve como herramienta de **prototipado visual**, no como generador del código final: "Prototype" puede iterar rápido layouts de dashboard de paciente o formularios de historial clínico como HTML standalone, que después hay que portar a mano a componentes shadcn/Next.js — no exporta JSX/TSX directamente. "HyperFrame" tendría uso marginal, quizás para un video de onboarding de pacientes mayores. Riesgos concretos para este proyecto: (1) repo de solo ~4 meses con crecimiento atípico (85.307 estrellas, ~9.997 forks) que no se pudo verificar como orgánico; (2) un issue cerrado (#1823) de un usuario que recibió alerta de malware de macOS al instalar el build 0.7.0 — probablemente falso positivo de Gatekeeper por firma de código nueva, pero **no confirmado** como tal por los mantenedores; (3) es BYOK: corre con tus propias API keys y las procesa un servidor local propio (daemon Node/Express) — por la Ley 25.326/AAIP, **nunca cargar datos reales de pacientes ahí**, solo dummy para prototipar layout; (4) agrega una cadena de build pesada (Node 24 + pnpm + Electron) ajena al stack del proyecto.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
# --- Opción A (recomendada en Windows): instalador de escritorio, sin build local ---
curl -LO https://github.com/nexu-io/open-design/releases/download/open-design-v0.19.0/open-design-0.19.0-win-x64-setup.exe
curl -LO https://github.com/nexu-io/open-design/releases/download/open-design-v0.19.0/open-design-0.19.0-win-x64-setup.exe.sha256
certUtil -hashfile open-design-0.19.0-win-x64-setup.exe SHA256   # comparar contra el .sha256 publicado ANTES de ejecutar el .exe
# Ejecutar el instalador manualmente. La app auto-detecta Claude Code si está en el PATH.
```

```powershell
# --- Opción B: CLI/MCP explícito (build desde código fuente) ---
# Prerrequisitos: Node ~24.x, pnpm 10.33.x vía Corepack, y en Windows nativo Visual Studio Build Tools (workload C++) por better-sqlite3
git clone https://github.com/nexu-io/open-design.git
cd open-design
corepack enable
pnpm install
pnpm tools-dev run web
od mcp install claude --print   # previsualiza la config MCP antes de aplicarla
od mcp install claude           # registra el servidor MCP stdio en la config de Claude Code
```

Nota Windows: si `curl` está aliasado a `Invoke-WebRequest` en tu PowerShell, usá `curl.exe` explícito o descargá el asset manualmente desde la página de Releases antes de correr `certUtil`.

**Confianza:** Media (repo y releases reales y verificados vía API, pero con señales mixtas sin resolver: crecimiento atípico de estrellas y el issue de malware sin confirmación).

**Fuentes.**
- https://github.com/nexu-io/open-design · https://api.github.com/repos/nexu-io/open-design
- https://raw.githubusercontent.com/nexu-io/open-design/main/README.md · .../QUICKSTART.md
- https://open-design.ai/ · https://open-design.ai/quickstart/
- https://github.com/nexu-io/open-design/issues/1823 · /issues/3430

---

### 8.4 Taste Skill

**Qué es.** Colección open-source de Agent Skills (`Leonxlnx/taste-skill`, MIT, 75.815 estrellas, patrocinada por Vercel OSS Program, img.ly, animations.dev y Novamira) que se autotitula "The Anti-Slop Frontend Framework for AI Agents". Da reglas de diseño (layout, tipografía, motion, spacing) a agentes de código para evitar UI genérica. La skill principal (`design-taste-frontend`, v2) lee el brief, infiere el lenguaje de diseño y ajusta tres "dials": `DESIGN_VARIANCE`, `MOTION_INTENSITY`, `VISUAL_DENSITY`. Incluye variantes: `redesign-skill` (auditar un proyecto existente antes de tocar CSS), `soft-skill` (premium/calm), `minimalist-skill`, `brutalist-skill`, `gpt-tasteskill`, `output-skill`, y — relevante para el video de @revolutia.ai — `image-to-code-skill` más `imagegen-frontend-web`/`imagegen-frontend-mobile`/`brandkit`, pensadas para generar primero referencias visuales y recién después pasárselas al agente de código.

**Por qué sirve para este proyecto.** Alta relevancia y compatible con la stack real (confirmado en `02_MEGAPROMPT_DESARROLLO.md`: Next.js 14+ App Router + TypeScript + Tailwind + shadcn/ui + Lucide React, target explícito Senior UX/HealthTech). No está atada a una API de framework específica — actúa sobre decisiones de diseño, por lo que convive bien con Tailwind + shadcn tal cual están. Evita el "look shadcn genérico" que todos los agentes de IA generan igual, sensible en un producto médico donde la UI necesita transmitir confianza. `soft-skill` (calm/premium, whitespace generoso) calza conceptualmente con Senior UX. **Limitación importante:** es estética, no de accesibilidad — no valida WCAG, contraste real ni touch targets, así que debe usarse **en combinación** con `a11y-audit` y `mobile-first-check`, ya instaladas, no en reemplazo. El dial `MOTION_INTENSITY` debería fijarse bajo para respetar `prefers-reduced-motion` en una audiencia de adultos mayores.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
node -v   # verificar >= 22.20.0 (requisito de la CLI 'skills'; actualizar si es menor)
cd F:\Proyectos\historialclinico

# Instalar SOLO la skill principal v2, a nivel proyecto
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend" -a claude-code --copy

# Instalar TODAS las skills del repo (incluye redesign-skill, soft-skill, image-to-code-skill, etc.)
npx skills add https://github.com/Leonxlnx/taste-skill -a claude-code --copy

# Variante GLOBAL (todos tus proyectos, no solo historialclinico)
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend" -a claude-code -g --copy
```

**Configuración posterior.** El flag `--copy` es obligatorio en la práctica en Windows: la CLI por default puede usar symlinks, que requieren Modo Desarrollador activado o permisos de administrador y suelen fallar en sesiones normales. Sin `-g`, la skill queda en `.claude\skills\<nombre>\SKILL.md` dentro del proyecto (recomendado si solo aplica acá). Recomendación puntual para este proyecto: instalar como mínimo `design-taste-frontend` y `soft-skill` desde el arranque, dejando `redesign-skill` para cuando ya haya UI construida y quieran auditarla.

**Confianza:** Alta.

**Fuentes.**
- https://www.tasteskill.dev/ · https://www.tasteskill.dev/docs
- https://github.com/Leonxlnx/taste-skill · https://api.github.com/repos/Leonxlnx/taste-skill
- https://github.com/vercel-labs/skills

---

### 8.5 DESIGN.md (VoltAgent)

**Qué es.** VoltAgent es una organización open-source que mantiene colecciones de archivos `DESIGN.md` — formato plain-text markdown que describe un sistema de diseño visual (colores, tipografía, espaciado, componentes) para que agentes como Claude Code generen UI consistente sin Figma ni tokens JSON. El concepto lo popularizó Google Stitch; VoltAgent es el ecosistema principal, con `awesome-design-md` (73+ ejemplos curados), `official-design-md` (diseños de marca oficiales) y la galería web `getdesign.md` (300+ análisis listos, cada uno con `DESIGN.md` + preview light/dark).

**Por qué sirve para este proyecto.** Directa pero opcional: (1) copiar o crear un `DESIGN.md` propio con tokens + restricciones visuales médicas (WCAG 2.1 AA obligatorio, contraste alto, tipografía legible, espaciado generoso para pantallas táctiles), (2) referenciarlo desde el `CLAUDE.md` del proyecto, (3) en cada sesión pedirle a Claude Code que lo use — genera componentes que respetan los tokens sin reinventar la paleta en cada pantalla. La separación de roles es clara: `CLAUDE.md` = cómo trabajar en el proyecto, `DESIGN.md` = source of truth visual. No hay CLI ni integración automática — es copiar el archivo y comunicárselo al agente.

**Instalación (Windows/PowerShell + Claude Code).**

```text
# Opción 1: descargar directo desde GitHub
# https://github.com/VoltAgent/awesome-design-md/tree/main/design-md
# copiar el contenido de un DESIGN.md y crear DESIGN.md en la raíz del proyecto

# Opción 2: galería web
# https://getdesign.md/ → buscar un diseño → copiar el archivo al proyecto
```

```powershell
# Opción 3: clonar el repo completo y extraer un archivo puntual
git clone https://github.com/VoltAgent/awesome-design-md.git
cp awesome-design-md\design-md\<marca>\DESIGN.md F:\Proyectos\historialclinico\DESIGN.md
```

**Configuración posterior.** Ninguna automática — es manual + instrucción explícita al agente ("Usá el DESIGN.md del proyecto para toda la UI"), o integrarlo por referencia dentro del `CLAUDE.md`.

**Confianza:** Media (repos y sitio verificados como reales; el contenido específico de cada `DESIGN.md` de ejemplo no se auditó archivo por archivo).

**Fuentes.**
- https://github.com/VoltAgent/awesome-design-md · /official-design-md · /design-md
- https://getdesign.md/
- https://uxplanet.org/claude-md-vs-design-md-what-to-put-in-each-for-claude-code-53647d015bfd

---

### 8.6 Context7

**Qué es.** Servidor MCP de Upstash (`upstash/context7`) que inyecta documentación actualizada y específica por versión directamente en prompts de agentes de IA, para miles de librerías (Next.js, React, Supabase, Tailwind, etc.), evitando alucinaciones de APIs desactualizadas.

**Por qué sirve para este proyecto.** No es específico de dominio médico ni de Senior UX, pero sí tiene un argumento concreto para este stack puntual: **Next.js 16** y **Tailwind v4** (documentados en la §7.2 como la combinación vigente) son posteriores al corte de conocimiento del modelo — Context7 reduce el riesgo de que Claude Code sugiera APIs de Next.js 14/15 o de la vieja config `tailwind.config.js` en vez de `@theme` con CSS puro. Costo de adopción bajo, sin impacto en runtime de la app.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
npx ctx7 setup --claude
# o, de forma explícita, scope de usuario:
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
```

```powershell
# Instalación local con API key propia (Node.js 18+ requerido):
npx -y @upstash/context7-mcp --api-key TU_API_KEY

# Alternativa remota, sin instalación local:
# https://mcp.context7.com/mcp  o  https://mcp.context7.com/sse
```

**Configuración posterior.** API key gratuita en `context7.com/dashboard` (opcional pero recomendada). Vía variable de entorno `CONTEXT7_API_KEY` o flag `--api-key`. Transporte HTTP/HTTPS nativo, no requiere proxy.

**Confianza:** Alta.

**Fuentes.**
- https://github.com/upstash/context7
- https://context7.com/docs/clients/claude-code · https://context7.com/install

---

### 8.7 Claude-Mem

**Qué es.** Plugin para Claude Code (`thedotmack/claude-mem`) que captura y comprime el contexto de sesiones pasadas usando IA, inyectando memoria persistente en sesiones futuras. Ofrece búsqueda semántica híbrida, archivado sin límite de tamaño, y progressive token disclosure. Complementa (no reemplaza) la memoria nativa `MEMORY.md` de Claude Code, disponible desde v2.1.59 (feb-2026) pero limitada a 200 líneas sin búsqueda.

**Por qué sirve para este proyecto.** Poco aporte directo: es herramienta pura de tooling de desarrollador (persistencia entre sesiones), sin aplicación en el frontend médico en sí. Solo justificaría instalarse si el desarrollo de MiHistorialMédico acumula cientos de sesiones de Claude Code o necesita memoria cross-project — no es el caso típico de desarrollo estándar de un proyecto único.

**Instalación (Windows/PowerShell + Claude Code).**

```powershell
npx claude-mem install
```

**Configuración posterior.** **Advertencia:** no activar simultáneamente con `MEMORY.md` nativa — el usuario ya la tiene disponible. Si se instala, configurar `CLAUDE_MEM_DATA_DIR` en variables de entorno de Windows para controlar la ubicación de datos (default `~/.claude-mem/`).

**Confianza:** Alta.

**Fuentes.**
- https://github.com/thedotmack/claude-mem
- https://docs.claude-mem.ai/installation

---

### 8.8 Veredicto para MiHistorialMédico

Punto de partida: **ya están instaladas** `frontend-design`, `superpowers`, Playwright MCP y todas las skills de Anthropic listadas en el entorno. El criterio para lo nuevo es el mismo que ya rige el proyecto — Senior UX médico necesita diseño sobrio, accesible y consistente, no acumular fuentes de "gusto" que se pisen entre sí. Instalar `UI UX Pro Max` (84 estilos) + Taste Skill + Impeccable + DESIGN.md al mismo tiempo, todas dando señales de diseño distintas al agente, es contraproducente: conviene un único source of truth de tokens y usar el resto como capas complementarias, no redundantes.

**Instalar ahora, bajo riesgo / alto valor:**
1. **Context7** (§8.6) — instalarlo ya, antes de seguir codeando. Costo mínimo, sin impacto visual, y el stack (Next.js 16 + Tailwind v4) es lo bastante reciente como para que la documentación fresca evite errores de API.
2. **Taste Skill → `design-taste-frontend`** (§8.4) — instalarla ahora, antes de construir más pantallas. Es la única de las tres skills de diseño nuevas que ya se verificó compatible con el stack real del proyecto (Next.js + Tailwind + shadcn confirmado en `02_MEGAPROMPT_DESARROLLO.md`). Fijar `MOTION_INTENSITY` bajo desde el inicio. No instalar `redesign-skill` todavía — no hay nada que auditar sin UI construida.

**Instalar en la siguiente fase (cuando ya haya 2-3 pantallas reales con shadcn):**
3. **Impeccable** (§8.2) — el detector necesita UI real contra la cual correr. Instalarlo cuando exista un esqueleto de pantallas, correr `/impeccable init` y después `/impeccable audit` como parte del ciclo normal de cada feature grande, en combinación con `a11y-audit` y `mobile-first-check` (no en reemplazo).

**Opcional, evaluar según necesidad, sin apuro:**
4. **DESIGN.md (VoltAgent)** (§8.5) — solo si, después de usar Taste Skill, sienten que falta un archivo explícito de tokens de marca. No es imprescindible: agregar una cuarta fuente de guía visual (después de `frontend-design`, Taste Skill e Impeccable) puede generar más ruido que claridad. Si se adopta, que sea uno solo, integrado al `CLAUDE.md`, no varios.
5. **Claude-Mem** (§8.7) — solo si el historial de sesiones de Claude Code sobre este proyecto crece a cientos de sesiones. Con `MEMORY.md` nativa alcanza para el desarrollo estándar actual.

**Descartar (por ahora):**
- **Open Design** (§8.3) — riesgo/beneficio desfavorable para este proyecto puntual: repo joven con crecimiento atípico sin verificar, un reporte de malware sin confirmar como falso positivo, y arquitectura BYOK que procesa datos en un servidor local propio — inaceptable para prototipar con datos clínicos reales bajo Ley 25.326/AAIP. El único uso legítimo (mockups HTML rápidos con datos dummy) no justifica el riesgo ni la cadena de build adicional (Node 24 + pnpm + Electron) en este momento del proyecto.
- **Figma MCP** (mencionada en el video 3) — no investigada en esta pasada, no hay datos de repo/instalación/confianza para evaluarla. Queda "a verificar"; no instalar sin antes hacer esa investigación puntual.
- **Playbook de Boris Cherny** (video 4) — no es una herramienta instalable. Sus tres ideas (planear antes de escribir, archivo de reglas mínimo, que el agente revise su propio trabajo) ya están cubiertas conceptualmente por `superpowers:writing-plans` + `superpowers:brainstorming` (ya activas) y por mantener este mismo `TOOLING.md`/`CLAUDE.md` como el "archivo de reglas mínimo". No requiere acción nueva, solo disciplina de uso.
- **Los 8 plugins y 8 skills del video 5** (`gstack`, `codex-plugin-cc`, `financial-services`, `claude-for-legal`, marketplace `claude-skills`, `marketingskills`, `social-media-skills`, `hyperframes`, `ai-second-brain`, `notebooklm-skill`, `humanizer`, `claude-seo`, skills de Vue/Vite, `caveman`) — descartados por mismatch de dominio evidente (legal, finanzas, marketing, redes sociales, framework Vue en un proyecto Next.js). No se investigaron en profundidad porque no hay escenario razonable donde aporten a esta PWA médica.

### 8.9 Nota de trazabilidad

Este análisis se realizó el **2026-08-12**, a partir de los captions y frames reales de los cinco videos de TikTok (revisados con navegador real, frame a frame), a diferencia del intento inicial documentado en la §3 de este mismo archivo, donde WebFetch no había podido extraer contenido. Los datos técnicos de cada herramienta nueva (versión, estrellas, licencia, comandos de instalación) se verificaron contra fuentes primarias — API de GitHub, READMEs crudos vía `raw.githubusercontent.com`, npm registry, sitios oficiales — no solo contra lo mostrado en el video, y cualquier dato no confirmable de forma independiente quedó marcado explícitamente como "a verificar" en su subsección correspondiente.

## 9. Estado de instalación (Sprint 0 — 2026-08-12)

| Herramienta | Estado | Detalle |
|---|---|---|
| **MCP Context7** | Instalada | HTTP remoto (https://mcp.context7.com/mcp), scope usuario. Verificado con `claude mcp list`. Documentación fresca para Next.js 16 + Tailwind v4. |
| **Taste Skill** (`design-taste-frontend`) | Instalada | v2 a nivel proyecto, 1206 líneas. Instalado con `npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend -a claude-code --copy -y`. Verificado en `.claude/skills/`. |
| **Taste Skill** (`high-end-visual-design`) | Instalada | Variante premium, 98 líneas. Instalado con el mismo comando. Verificado en `.claude/skills/`. |
| **frontend-design** (Anthropic) | Ya disponible | Verificado en lista de skills activas del entorno. No reinstalar. |
| **superpowers** (completo) | Ya disponible | Paquete activo: brainstorming, writing-plans, executing-plans, test-driven-development, systematic-debugging, requesting-code-review, using-git-worktrees, etc. Verificado en lista de skills activas. |
| **Playwright MCP** | Ya disponible | `mcp__playwright__*` en lista de MCPs del entorno. No reinstalar. |
| **Skills oficiales de Anthropic** | Ya disponible | Confirmado: adb-mobile-testing, algorithmic-art, a11y-audit, brand-guidelines, canvas-design, charset-audit, claude-api, csp-builder, cuit-cuil-validate, db-migration, doc-coauthoring, docx, frontend-design, grill-me, htaccess-builder, image-optimizer, init-neolo-project, init-pwa, internal-comms, legal-pages-init, mailer-init, mariadb-utf8mb4-neolo, mcp-builder, mobile-first-check, mobile-ux-patterns, neolo-deploy-checklist, pdf, performance-audit, pptx, pre-deploy-check, pwa-audit, pwa-vapid-push-setup, seo-audit, skill-creator, slack-gif-creator, template-skill, theme-factory, web-artifacts-builder, webapp-testing, xlsx. |
| **Impeccable** | Pendiente | Sprint 3+ — se instala cuando existan 2-3 pantallas reales con shadcn/ui para auditar. Comandos: `npx impeccable install` (scope proyecto) + `/impeccable init`. Motivo del aplazamiento: necesita UI real para proporcionar valor. |
| **UI UX Pro Max** | Pendiente | Sprint 3+ — decisión de única fuente de diseño (Taste Skill instalada ahora vs. UI UX Pro Max en Sprint 3). Se evaluará cuando Taste Skill esté en uso. Comando de instalación verificado: `npm install -g ui-ux-pro-max-cli` o `npx skills add nextlevelbuilder/ui-ux-pro-max-skill`. |
| **Vercel Agent Skills** (`web-design-guidelines`, `react-best-practices`, `composition-patterns`) | Pendiente | Sprint 3+ — se instala como capas complementarias de Taste Skill. Comando: `npx skills add vercel-labs/agent-skills -a claude-code -s web-design-guidelines -s react-best-practices -s composition-patterns -y`. Motivo del aplazamiento: esperar a que Taste Skill esté operativo para evitar redundancia visual. |
| **Emil Kowalski Skills** (`emil-design-eng`, `review-animations`, `pick-ui-library`) | Pendiente | Sprint 3+ — instalación selectiva (no las 10 completas). Comando: repetir `npx skills add emilkowalski/skills/<skill-name>` para cada una. Motivo del aplazamiento: pulido de microinteracciones; tiene más sentido sobre componentes ya existentes. |
| **claude-code-setup** | Opcional | Puede correr en cualquier momento como diagnóstico de solo lectura. Comando de instalación verificado en §4.1. Motivo pendiente: se espera a próxima sesión o cuando quiera auditar el proyecto específicamente. |
| **DESIGN.md (VoltAgent)** | Opcional | Solo si, después de usar Taste Skill, sienten necesidad de archivo explícito de tokens de marca. Instalación: copiar desde https://getdesign.md/ o github.com/VoltAgent/awesome-design-md. Puede agregarse en Sprint 2 o después sin apuro. |
| **Claude-Mem** | Descartada | Redundante con `MEMORY.md` nativa (disponible desde Claude Code 2.1.59). No justifica instalación para el desarrollo estándar actual. Revisar solo si sesiones futuras superan cientos y necesitan búsqueda semántica cross-project. |
| **Open Design** | Descartada | Repo joven (creado ~4 meses), crecimiento de estrellas atípico sin verificar como orgánico (85.307 estrellas en agosto 2026), issue de malware sin confirmar como falso positivo, arquitectura BYOK inaceptable para datos médicos bajo Ley 25.326/AAIP. Riesgo/beneficio negativo para este proyecto. Revisitar en futuro si el proyecto necesita prototipado visual intensivo con dummy data. |
| **Figma MCP** | A verificar | Mencionado en video 3 (@revolutia.ai) pero no investigado en esta pasada. No datos de repo, instalación, confianza ni relevancia verificada. No instalar hasta completar investigación puntual. Incluir en auditoría si/cuando el proyecto adopta Figma para design system. |
| **gh CLI** | No instalado | Opcional, no es prerrequisito de MiHistorialMédico. Verificación: `gh --version`. |
| **Supabase CLI** | No instalado — pendiente como dependencia npm | Se instalará como dependencia del proyecto cuando la tarea de Supabase lo declare en `package.json`. Verificación futura: `npm list -g supabase` o `supabase --version`. |
| **Docker Desktop** | No instalado — manual del usuario | Requerido para `supabase start` (modo local). Instalación manual desde https://docs.docker.com/desktop/setup/install/windows-install/ — no es automatizable. Verificación: `docker --version` una vez instalado. Bloqueante para desarrollo local de Supabase si se usa `supabase start`; no impide deploy. |
| **Node.js** | v24.14.0 | Verificado con `node -v` el 2026-08-12. Requisito de Impeccable (≥22.12.0), Taste Skill (≥22.20.0), Context7 (v18+). Cumple con creces. |
| **npm** | 11.9.0 | Verificado con `npm -v` el 2026-08-12. Versión actual compatible con todas las herramientas. |
| **Python** | 3.12.10 | Verificado con `python --version` (alias `python` en PATH). Requerido para UI UX Pro Max si se instala (scripts internos llaman a `python`, no `python3`). Cumple. |
| **git** | 2.55.0.windows.3 | Verificado con `git --version` el 2026-08-12. Vigente para operaciones de repos. |
| **Claude Code** | 2.1.201 | Verificado el 2026-08-12. Soporta MEMORY.md nativa, MCPs con transporte HTTP/stdio, skills con scopes usuario/proyecto, `/reload-plugins`. |
