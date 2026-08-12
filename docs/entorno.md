# Entorno de desarrollo — MiHistorialMédico

**Fecha de verificación:** 2026-08-12  
**Máquina:** Windows 11 Pro, versión 10.0.26200  
**Dirección de trabajo local:** `C:\laragon\www\historialclinico`

## Versiones de software

| Software | Versión | Requisito | Estado |
|---|---|---|---|
| Node.js | v24.14.0 | ≥22.12.0 (Impeccable, Taste Skill) | ✓ Cumple |
| npm | 11.9.0 | Actual | ✓ Cumple |
| Python | 3.12.10 | Para UI UX Pro Max (si se instala) | ✓ Cumple |
| git | 2.55.0.windows.3 | Actual | ✓ Cumple |
| Claude Code | 2.1.201 | Soporta MCPs + skills + scopes | ✓ Cumple |

**Cómo verificar:**

```powershell
node -v
npm -v
python --version
git --version
```

## MCPs (Servidores de Protocolo de Módulos de Claude)

| MCP | Scope | Transporte | Instalación | Verificación |
|---|---|---|---|---|
| **Context7** | Usuario | HTTP remoto (https://mcp.context7.com/mcp) | 2026-08-12 con `npx ctx7 setup --claude` | `claude mcp list` → debe aparecer "context7" |
| **Playwright** | Preexistente en el entorno | stdio (subejecución local) | Ya disponible | `claude mcp list` → debe aparecer "mcp__playwright__*" |

### Cómo verificar MCPs instalados

```powershell
# En PowerShell
claude mcp list

# Dentro de una sesión de Claude Code interactiva
/mcp list
```

**Ejemplo de salida esperada:**
```
- context7 (user scope, HTTP)
- Playwright MCP (stdio)
- ... otros MCPs de este entorno ...
```

## Skills instaladas en el proyecto

**Ubicación:** `F:\Proyectos\historialclinico\.claude\skills\`

| Skill | Versión | Instalación | Ubicación | Verificación |
|---|---|---|---|---|
| **design-taste-frontend** (Taste Skill) | v2 (1206 líneas) | 2026-08-12 con `npx skills add https://github.com/Leonxlnx/taste-skill --skill design-taste-frontend -a claude-code --copy -y` | `.claude/skills/design-taste-frontend/SKILL.md` | `ls .claude/skills/` → debe aparecer `design-taste-frontend/` |
| **high-end-visual-design** (Taste Skill) | Variante premium (98 líneas) | 2026-08-12 con el mismo comando | `.claude/skills/high-end-visual-design/SKILL.md` | `ls .claude/skills/` → debe aparecer `high-end-visual-design/` |

### Cómo verificar skills del proyecto

```powershell
# Listar skills del proyecto (scope actual)
ls F:\Proyectos\historialclinico\.claude\skills\

# O en PowerShell con alias corto
dir .\.claude\skills\

# Dentro de Claude Code
npx skills list -a claude-code
```

## Skills y plugins preexistentes (ya disponibles, no reinstalar)

Estos recursos estaban activos en el entorno antes del Sprint 0. Se listan para referencia — NO hace falta instalarlos nuevamente:

- **frontend-design** (Anthropic)
- **superpowers** (brainstorming, writing-plans, executing-plans, test-driven-development, systematic-debugging, requesting-code-review, using-git-worktrees, etc.)
- **Playwright MCP** (para testing automatizado)
- Todas las skills oficiales de Anthropic en la lista global del usuario: adb-mobile-testing, algorithmic-art, a11y-audit, brand-guidelines, canvas-design, charset-audit, claude-api, csp-builder, cuit-cuil-validate, db-migration, doc-coauthoring, docx, grill-me, htaccess-builder, image-optimizer, init-neolo-project, init-pwa, internal-comms, legal-pages-init, mailer-init, mariadb-utf8mb4-neolo, mcp-builder, mobile-first-check, mobile-ux-patterns, neolo-deploy-checklist, pdf, performance-audit, pptx, pre-deploy-check, pwa-audit, pwa-vapid-push-setup, seo-audit, skill-creator, slack-gif-creator, template-skill, theme-factory, web-artifacts-builder, webapp-testing, xlsx.

**Cómo verificar la lista global:**

```powershell
npx skills list -g
```

## Faltantes y pendientes

### NO instalados (pero sí previstos)

| Software | Descripción | Requisito para... | Plan de instalación | Bloquea desarrollo |
|---|---|---|---|---|
| **gh CLI** | GitHub CLI para operaciones de PR/issues desde línea de comandos | Flujos de CI/CD avanzados (opcional, no es MVP) | Opcional. Si se necesita: `npm install -g gh` o descarga desde https://github.com/cli/cli | No |
| **Supabase CLI** | CLI para operaciones locales de Supabase (`supabase start`, migraciones) | Desarrollo local con BD viva (actualmente no en uso; cuando se active) | Se instalará como dependencia npm en la tarea de Supabase; revisar `package.json` | No (de momento) |
| **Docker Desktop** | Contenedor local para `supabase start` | Supabase en modo local (actualmente no en uso) | Instalación manual desde https://docs.docker.com/desktop/setup/install/windows-install/ — usuario ejecuta el instalador descargado. Verificar con `docker --version` después de instalar | No (de momento) |

**Nota sobre Docker:** requerido solo si el proyecto entra en fase de desarrollo intensivo de Supabase con migraciones/rollbacks locales. No impide deploy a producción (Supabase vive en la nube). Ver sección **"Por qué se necesita Docker"** abajo.

### Pendientes (Sprint 3+, decisiones de diseño)

Herramientas documentadas en TOOLING.md §8.8 que se instalarán en fases posteriores:

- **Impeccable** — detector de anti-patrones de UI (Sprint 3+, cuando existan 2-3 pantallas reales)
- **UI UX Pro Max** — generador de sistema de diseño (Sprint 3+, evaluación comparativa con Taste Skill)
- **Vercel Agent Skills** — capas de accesibilidad/performance/composición (Sprint 3+, complementarias a Taste Skill)
- **Emil Kowalski Skills** — especialista en animaciones/microinteracciones (Sprint 3+, pulido final)

### Descartadas (con justificación)

- **Claude-Mem** — redundante con `MEMORY.md` nativa
- **Open Design** — riesgo de seguridad en datos médicos + repo joven sin verificación
- **Figma MCP** — pendiente de investigación; no instalar hasta verificar

## Configuración de charset y localización

**Regla global obligatoria del usuario:** UTF-8 en todo el stack (bases de datos, archivos fuente, HTTP headers).

| Componente | Charset/Encoding | Verificación |
|---|---|---|
| **Archivos fuente** (.php, .js, .ts, .html, .css, .md, etc.) | UTF-8 sin BOM | `file -i <archivo>` en WSL, o verificar en editor |
| **MySQL/MariaDB** (cuando esté en uso) | utf8mb4 / utf8mb4_unicode_ci | `SHOW VARIABLES LIKE 'character_set%';` en la BD |
| **Node.js / npm** | Default UTF-8 | `node -e "console.log(process.env.LC_ALL)"` |
| **PowerShell** (generación de archivos) | Usar herramienta Write de Claude Code (UTF-8 sin BOM) | Nunca `Out-File` ni `Set-Content` de PowerShell nativo |
| **HTML** | `<meta charset="utf-8">` en el `<head>` | Inspeccionar HTML generado o rendered |

**Por qué importa:** el usuario trabaja en español (tildes, ñ, ¿¡) y necesita compatibilidad sin fallos de encoding. Un bug anterior en este mismo entorno generó bytes UTF-8 guardados verbatim en columnas latin1, corrompiendo slugs.

**Cómo verificar el proyecto completo:**

```powershell
# En WSL si está disponible:
file -i F:\Proyectos\historialclinico\**\*.md
file -i F:\Proyectos\historialclinico\**\*.ts
file -i F:\Proyectos\historialclinico\**\*.tsx

# En PowerShell nativo (más lento):
Get-ChildItem -Path F:\Proyectos\historialclinico\ -Recurse -Include *.md, *.ts, *.tsx |
  ForEach-Object { [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8) } |
  Write-Host "✓ UTF-8"
```

## Por qué se necesita Docker

Docker Desktop no es requerido para MVP ni para deploy a Neolo, pero SÍ facilita:

1. **`supabase start` local** — ejecuta BD PostgreSQL + Auth + Realtime en contenedores, idéntico al entorno de producción. Útil para testing de triggers, funciones PL/pgsql, y migraciones de BD antes de subirlas a Supabase Cloud.
2. **CI/CD eventual** — si se monta GitHub Actions o similar, Docker en CI es estándar para reproducibilidad.
3. **No es bloqueante** — el desarrollo de Next.js + componentes shadcn funciona sin Docker. Se agrega solo cuando el proyecto entre en fase intensiva de BD.

**Instalación manual (usuario):**
1. Descargar desde https://docs.docker.com/desktop/setup/install/windows-install/
2. Ejecutar instalador; puede pedir reinicio de máquina
3. Verificar con `docker --version` en PowerShell

Documentar en este archivo una vez instalado.

## Flujo de re-verificación posterior

Después de cambios de máquina, actualizaciones de software, o si algo falla:

### Verificación rápida (2 minutos)

```powershell
# Terminal / PowerShell
node -v              # ≥22.12.0
npm -v               # 11.x+
python --version     # 3.x
git --version        # 2.55+
docker --version     # (si instalado; opcional)

# Dentro de una sesión de Claude Code interactiva
/mcp list                           # Context7 debe aparecer
npx skills list -a claude-code      # design-taste-frontend + high-end-visual-design
npx skills list -g | head -20       # frontend-design, superpowers, etc.
```

### Verificación profunda (si algo falla)

```powershell
# MCPs
claude mcp list --json | sls context7

# Skills del proyecto
ls .claude/skills/ | sls design-taste
ls .claude/skills/ | sls high-end

# Verificar que Taste Skill está lista para usar
cd F:\Proyectos\historialclinico
npx skills list -a claude-code | sls design-taste

# Test de Node/npm
npm view skills         # debe listar paquetes
npx --version           # debe funcionar

# Test de GitHub (si gh está instalado)
gh --version            # (opcional)
```

## Logs y diagnóstico

Si algo falla durante una sesión de Claude Code:

- **Claude Code logs:** `~/.claude/logs/` (shell logs) o `/Application Support/Claude Code/logs/` (macOS)
- **npm logs:** `~/.npm/_logs/` (últimas operaciones de npm)
- **Supabase logs (si se instala):** `~/.supabase/logs/`

En Windows 11, acceder via `%APPDATA%\` o `Set-Location $PROFILE` en PowerShell.

## Cambios futuros esperados

- **Sprint 0 (actual):** Taste Skill + Context7 (instaladas). Versiones registradas.
- **Sprint 1:** Primeras pantallas de UI con shadcn/ui. Revisión de charset UTF-8 en BD de desarrollo (Supabase).
- **Sprint 2:** Supabase CLI (via npm) + eventualmente Docker Desktop (manual del usuario). Actualizar tabla de "No instalados" → "Instalados".
- **Sprint 3+:** Impeccable, UI UX Pro Max (decisión comparativa con Taste Skill), Vercel Agent Skills, Emil Kowalski Skills. Agregar nuevo apartado "§Sprint 3 — Herramientas de auditoria y pulido".
