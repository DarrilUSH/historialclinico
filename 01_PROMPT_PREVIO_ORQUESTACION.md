# PROMPT PREVIO: ORQUESTACIÓN, PLANIFICACIÓN DE SPRINTS, OPTIMIZACIÓN DE TOKENS Y TOOLING

Actúa como el **Master Tech Lead y Orquestador de Proyecto (Fable 5 / Lead Architect)** para la construcción de la PWA "Historial Médico". 

El objetivo principal de esta primera etapa es establecer una estrategia de **optimización de tokens, consumo eficiente y gestión de contexto**, planificando la ejecución por Sprints, asignando el modelo de IA adecuado para cada tarea específica y configurando el entorno local con las herramientas sugeridas.

---

## TAREA 1: CREACIÓN DEL ARCHIVO `ROADMAP_SPRINTS.md`

Genera el contenido completo de un archivo llamado `ROADMAP_SPRINTS.md` para la raíz del proyecto. Este archivo debe:

1. **Dividir el desarrollo en Sprints lógicos e incrementales** (ej: Sprint 1: Setup y Base de Datos; Sprint 2: Autenticación y Multiperfil; Sprint 3: Ingesta OCR + Gemini, etc.).
2. **Asignación de Modelos por Complejidad (Optimización de Tokens) y Nivel de Esfuerzo (de más rápido a más inteligente):**
   - **Opus / Fable 5 (última versión)**: Reservado exclusivamente para arquitectura compleja, modelado SQL, políticas RLS, auditorías y decisiones estructurales.
   - **Sonnet (última versión)**: Para desarrollo Full-Stack (rutas de Next.js, Server Actions, integración de Gemini API, componentes complejos de UI).
   - **Haiku (última versión)**: Para tareas livianas, tipos en TypeScript (`types/*.ts`), componentes simples, scripts auxiliares y pruebas unitarias.
3. **REGLA OBLIGATORIA DE NOMENCLATURA EN CADA TAREA:**
   Cada título o encabezado de tarea DENTRO del roadmap debe incluir de forma explícita el modelo asignado. 
   *Ejemplo de formato:* `### [Sonnet] - Creación de Usuarios y Perfiles` o `### [Haiku] - Definición de Tipos TypeScript`.
4. **Protocolo de Auditoría y Checkpoint:**
   - Al finalizar cada tarea de un Sprint, debes entregar un **Resumen de Entrega** para ser auditado antes de proceder.
   - No se avanzará a la siguiente tarea hasta que la actual sea auditada y aprobada.

---

## TAREA 2: SELECCIÓN DE TOOLING PARA ESTE PROYECTO

A partir del **catálogo de herramientas conocidas** de abajo, evaluá cuáles aplican a ESTE proyecto (según su stack, dominio y audiencia), verificá su estado actual y generá un `TOOLING.md` en la raíz con la selección justificada y los comandos de instalación verificados.

> **Procedencia del catálogo:** destilado el 2026-08-12 a partir del análisis frame a frame de 5 videos de TikTok y verificación contra fuentes primarias (GitHub API, npm registry, READMEs crudos, sitios oficiales). **Las versiones, estrellas y comandos envejecen en semanas** (ej.: Impeccable pasó de 34k a 58k estrellas y de CLI 2.3 a 3.5 en meses) — antes de instalar, SIEMPRE re-verificar contra el repo oficial.

### Catálogo de herramientas conocidas

**Base (casi todo proyecto):**

| Herramienta | Repo / Sitio | Qué aporta | Cuándo |
|---|---|---|---|
| `claude-code-setup` | `anthropics/claude-plugins-official` | Skill oficial que analiza el repo real y recomienda MCP servers, skills, hooks y subagentes a medida | **Correrlo PRIMERO** en todo proyecto nuevo, antes de instalar nada más |
| `superpowers`, `frontend-design` y skills oficiales de Anthropic | ya instaladas en el entorno | Flujos de desarrollo (planes, TDD, debugging) y diseño frontend base | Ya activas — no reinstalar ni duplicar |
| Playwright MCP | ya instalado en el entorno | Testing de UI en navegador real | Ya activo |

**Diseño de UI (elegir con criterio — ver reglas de selección):**

| Herramienta | Repo / Sitio | Qué aporta | Cuándo |
|---|---|---|---|
| **Taste Skill** (`design-taste-frontend`, `soft-skill`) | `Leonxlnx/taste-skill` · tasteskill.dev | Anti-UI-genérica: dials de `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY`; variantes calm/premium, minimalist, redesign | Al inicio, ANTES de construir pantallas. Instalar con `npx skills add ... --copy` (symlinks fallan en Windows) |
| **Impeccable** | `pbakaus/impeccable` · impeccable.style | Detector determinístico de anti-patrones "AI slop" (59 reglas y creciendo) + skill `/impeccable` con 23 subcomandos (`audit`, `polish`, `harden`, `clarify`...) | Cuando ya existen 2-3 pantallas reales; su detector necesita UI contra la cual correr. `npx impeccable install` + `/impeccable init` |
| **UI UX Pro Max** | `nextlevelbuilder/ui-ux-pro-max-skill` · uupm.cc | Base local buscable: 84 estilos, 192 paletas, 74 font pairings, guías UX por industria; generador de design system (`--design-system`) | Al definir la identidad visual, si no viene dada. Requiere Python en PATH |
| **Emil Kowalski Skills** (`emil-design-eng`, `review-animations`, `pick-ui-library`) | `emilkowalski/skills` | Reglas de animación con buen gusto: easing, duraciones, solo transform/opacity, `prefers-reduced-motion` | Proyectos con microinteracciones; imprescindible si la audiencia es sensible al movimiento |
| **Vercel Agent Skills** (`web-design-guidelines`, `react-best-practices`, `composition-patterns`) | `vercel-labs/agent-skills` (CLI: `npx skills`) | Accesibilidad/UX del UI, 70 reglas de performance React/Next.js, patrones de composición | Proyectos React/Next.js. `deploy-to-vercel` solo si el deploy es a Vercel |
| **DESIGN.md** | `VoltAgent/awesome-design-md` · getdesign.md | Archivo markdown de tokens/sistema de diseño que el agente lee como source of truth visual (concepto de Google Stitch) | Opcional: solo como ÚNICO archivo de tokens integrado al CLAUDE.md, no como cuarta fuente de "gusto" |
| **Figma MCP** | a verificar | Puente agente ↔ diseños de Figma | Solo si el flujo del proyecto diseña primero en Figma. Verificar repo oficial antes de usar |

**Infraestructura de desarrollo:**

| Herramienta | Repo / Sitio | Qué aporta | Cuándo |
|---|---|---|---|
| **Context7** | `upstash/context7` · context7.com | MCP que inyecta docs actualizadas y version-specific de miles de librerías | Cuando el stack incluye versiones posteriores al conocimiento del modelo (ej. Next.js 16, Tailwind v4). `claude mcp add context7 -- npx -y @upstash/context7-mcp@latest` |
| Claude-Mem | `thedotmack/claude-mem` | Memoria comprimida entre sesiones con búsqueda semántica | Casi nunca: redundante con la memoria nativa de Claude Code. Solo con cientos de sesiones acumuladas |

**Con reservas o de nicho (no instalar por defecto):**

- **Open Design** (`nexu-io/open-design` · open-design.ai): app de escritorio de prototipado visual (Prototype → HTML, HyperFrame → MP4). Al 2026-08-12 tenía señales sin resolver: repo de ~4 meses con crecimiento atípico de estrellas, un reporte de malware nunca aclarado por los mantenedores (issue #1823) y arquitectura BYOK con daemon local. **Re-evaluar madurez antes de considerarla; nunca usarla con datos reales de usuarios/pacientes.**
- **Packs de dominio** (marketing: `marketingskills`, `claude-seo`, `ad-creative`; finanzas: `financial-services`, `dcf-model`, `pitch-deck`; legal: `claude-for-legal`, `contract-review`; social: `social-media-skills`; otros: `gstack`, `codex-plugin-cc`, `hyperframes`, `ai-second-brain`, `notebooklm-skill`, `humanizer`, `caveman`, skills de Vue/Vite): instalar **solo si el dominio o stack del proyecto coincide**. En un proyecto que no es de ese rubro son ruido.

### Reglas de selección (obligatorias para el orquestador)

1. **`claude-code-setup` primero**: su diagnóstico del repo real ordena el resto de las decisiones.
2. **Una sola fuente principal de "gusto" de diseño** (Taste Skill O UI UX Pro Max O DESIGN.md); las demás entran como capas complementarias no redundantes (ej. Impeccable audita, Emil Kowalski cubre animación). Apilar 4 fuentes de estética que se contradicen empeora el output.
3. **Verificar antes de instalar**: comandos, versiones y existencia de cada paquete contra el repo/registry oficial en el momento de la instalación. Registrar todo en el `TOOLING.md` del proyecto con fuentes y nivel de confianza; lo no confirmable se marca "a verificar".
4. **Nada se instala sin justificación** escrita en función del stack, dominio y audiencia del proyecto. Las skills de diseño no reemplazan auditorías de accesibilidad (`a11y-audit`, `mobile-first-check`) — se complementan.
5. **Playbook de flujo** (Boris Cherny, líder de Claude Code): planear antes de escribir código, mantener el archivo de reglas lo más chico posible, y hacer que el agente revise su propio trabajo. Esto ya lo cubren `superpowers` y el protocolo de auditoría de la Tarea 1 — es disciplina de uso, no una herramienta.

---

## ENTREGABLE REQUERIDO PARA ESTA INTERACCIÓN

1. El contenido del archivo `ROADMAP_SPRINTS.md` aplicando la nomenclatura de modelos en cada título.
2. El `TOOLING.md` del proyecto: selección justificada de herramientas del catálogo de la Tarea 2, con comandos de instalación re-verificados a la fecha.
3. Confirmación del protocolo de auditoría para dar paso al Megaprompt del Proyecto.