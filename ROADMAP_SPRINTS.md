# ROADMAP_SPRINTS.md — Historial Médico

> PWA de historial médico familiar para adultos mayores, con gestión delegada por cuidadores y familiares.
> Repo: `github.com/DarrilUSH/historialclinico` · Dominio final: `historialmedico.com.ar` (Vercel) · Desarrollo: **local-first**.

## Propósito de este documento

Este roadmap es el **plan de ejecución operativo** del proyecto: define qué se construye, en qué orden, con qué modelo se ejecuta cada tarea y cómo se verifica que quedó bien. No es un documento aspiracional — cada tarea tiene artefactos concretos y un criterio de aceptación que se puede correr o mirar en local.

## Cómo se usa este roadmap (protocolo en 3 líneas)

1. El orquestador (**Fable**) toma la siguiente tarea pendiente en orden y la delega al modelo indicado en el heading (`### [Haiku|Sonnet|Opus] - Título`).
2. El ejecutor implementa **código completo, sin placeholders**, y entrega un **Resumen de Entrega** con el formato exacto de la sección "Protocolo de Auditoría y Checkpoints".
3. Fable audita el resumen; **sin aprobación explícita no se avanza a la tarea siguiente**, y cada sprint cierra con un checkpoint de demo verificable en local.

---

## Asignación de modelos por complejidad

**Regla de nomenclatura obligatoria:** todo título de tarea es un heading de nivel 3 con el formato exacto
`### [Modelo] - Título de la tarea`
donde `Modelo` es **Haiku**, **Sonnet** u **Opus**. `[Fable]` nunca aparece en una tarea: Fable es el orquestador que audita checkpoints y no ejecuta trabajo de implementación.

| Modelo | Alcance | Ejemplos típicos en este proyecto |
|---|---|---|
| **Haiku** | Tareas livianas, mecánicas y de bajo riesgo | Tipos TypeScript, componentes de presentación simples, scripts auxiliares, seeds, tests unitarios puros, chequeos de charset, constantes y catálogos |
| **Sonnet** | Desarrollo full-stack estándar | Rutas del App Router, Server Actions, formularios, integración con Gemini, componentes complejos, charts, Edge Functions, service worker |
| **Opus** | Arquitectura, modelado y seguridad | Esquema SQL, enums, políticas RLS, políticas de Storage, modelo de permisos familiares, auditorías de seguridad y accesibilidad, decisiones estructurales |
| **Fable** | **Solo orquestación** | Auditoría de Resúmenes de Entrega, checkpoints de sprint, desbloqueo de dependencias. Nunca aparece como `[Fable]` en una tarea |

**Criterio de desempate:** si una tarea toca RLS, el esquema de datos, o puede exponer datos de salud de un tercero, **es Opus** aunque parezca chica.

---

## Vista rápida de sprints

| # | Sprint | Objetivo | Entregable demostrable |
|---|---|---|---|
| 0 | Tooling y entorno local | Dejar el entorno listo y reproducible | `npm run dev` levanta la app en `localhost:3000` con Tailwind + shadcn/ui, repo en GitHub, Supabase linkeado |
| 1 | Fundaciones de datos | Esquema completo, RLS, Storage privado y clientes | Migraciones aplicadas en local, `SELECT` bloqueado por RLS demostrado, tipos TS generados, seed cargado |
| 2 | Autenticación y multiperfil | Login real y selector de perfiles familiares | Login → selector "Netflix" → perfil activo, con registro en `access_logs` |
| 3 | Design system Senior UX | Base visual accesible para adultos mayores | Layout con bottom nav fija, tema alto contraste, dictado por voz funcionando |
| 4 | Ingesta de documentos | Subir y entender documentos médicos | Foto/PDF → Gemini → JSON estructurado → documento guardado, con fallback manual |
| 5 | Estudios y tendencias | Ver el historial y su evolución | Galería cronológica filtrable + gráfico de glucosa/colesterol/hemoglobina |
| 6 | Turnos y logística | Que el turno se pueda cumplir sin fricción | Turno con recordatorios push reales y botones Maps / Uber-DiDi-Cabify / `.ics` |
| 7 | Medicación y recetas | No quedarse sin remedios | Alta de medicación con stock y alerta a menos de 5 días de dosis |
| 8 | Coberturas + SOS offline | Datos vitales disponibles siempre | Ficha SOS y credenciales visibles **en modo avión** |
| 9 | Signos vitales y alertas | Monitoreo diario con escalamiento | Carga de tensión 17/11 dispara alerta al perfil administrador |
| 10 | Médicos + Ficha de Resumen IA | Llegar preparado a la consulta | Ficha de 1 página generada por IA, imprimible |
| 11 | PWA completa y hardening | Instalable, offline, segura y accesible | App instalada desde el navegador + informe de auditoría RLS y WCAG AA |
| 12 | Deploy a producción | Publicar (solo si el usuario lo pide) | Sitio en `historialmedico.com.ar` con páginas legales Ley 25.326 |

---

## Sprint 0: Tooling y entorno local

**Objetivo:** dejar un entorno de desarrollo reproducible, en UTF-8, con el stack vigente a agosto de 2026 y el repositorio versionado.
**Entregable demostrable:** `npm run dev` sirve la app en `http://localhost:3000` con Tailwind v4 y un componente de shadcn/ui renderizando; el repo está en GitHub y el proyecto Supabase local responde.

### [Haiku] - Instalar skills y plugins declarados en TOOLING.md

Leer `TOOLING.md` y dejar instaladas/habilitadas las skills y plugins que el proyecto declara como necesarias (charset-audit, a11y-audit, pwa-audit, performance-audit, mobile-first-check, pwa-vapid-push-setup, legal-pages-init y las que TOOLING.md agregue). No instalar nada que no esté declarado.

- **Artefactos:** `TOOLING.md` actualizado con el estado real (instalada / pendiente / no aplica), `docs/entorno.md` con versiones de Node, npm y Supabase CLI.
- **Criterio de aceptación:** cada ítem de `TOOLING.md` tiene estado explícito; `node -v`, `npm -v` y `supabase --version` quedan registrados en `docs/entorno.md` y coinciden con la máquina real.
- **Dependencias:** ninguna.

### [Sonnet] - Scaffold Next.js 16.3 + React 19 + TypeScript + Tailwind v4.3

Crear el proyecto con `npx create-next-app@latest` (App Router, TypeScript, sin `src/` opcional según preferencia, alias `@/*`). Verificar que quedan Next.js 16.3, React 19 y Tailwind v4.3 con configuración CSS-first (`@import "tailwindcss";` y bloque `@theme`), **sin** `tailwind.config.js` heredado de v3.

- **Artefactos:** `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`.
- **Criterio de aceptación:** `npm run dev` levanta sin warnings; `npm ls next react tailwindcss` muestra `next@16.3.x`, `react@19.x`, `tailwindcss@4.3.x`; una utilidad Tailwind aplicada en `app/page.tsx` se ve en el navegador.
- **Dependencias:** instalación de tooling.

### [Sonnet] - Inicializar shadcn/ui y Lucide React

Correr el init de shadcn/ui con soporte Tailwind v4 (`@theme inline`), definir el alias de componentes en `components/ui`, e instalar `lucide-react`. Traer un set inicial mínimo: `button`, `card`, `input`, `label`, `dialog`, `select`, `sonner`.

- **Artefactos:** `components.json`, `components/ui/*.tsx`, `lib/utils.ts`, dependencia `lucide-react` en `package.json`.
- **Criterio de aceptación:** una página de prueba renderiza un `<Button>` con un ícono de Lucide y un `<Card>`, y el build (`npm run build`) pasa sin errores de tipos.
- **Dependencias:** scaffold Next.js.

### [Haiku] - git init, .gitignore y repo remoto en GitHub

Inicializar git, configurar `.gitignore` (incluyendo `.env*.local`, `.next`, `node_modules`, `supabase/.temp`), hacer el commit inicial y vincular el remoto `github.com/DarrilUSH/historialclinico` en la rama `main`.

- **Artefactos:** `.gitignore`, `.gitattributes` (con `* text=auto eol=lf` y marcado de binarios), historial git con commit inicial.
- **Criterio de aceptación:** `git status` limpio, `git remote -v` apunta al repo correcto, y `git ls-files | grep -c "\.env"` devuelve 0.
- **Dependencias:** scaffold Next.js.

### [Sonnet] - Proyecto Supabase local, CLI y variables de entorno

Inicializar Supabase con el CLI (`supabase init`, `supabase start`) para trabajar contra la base local, y linkear el proyecto remoto solo como destino futuro de migraciones (sin push). Crear `.env.local` y `.env.example` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

- **Artefactos:** `supabase/config.toml`, `.env.local` (no versionado), `.env.example` (versionado, sin secretos), `docs/entorno.md` con los pasos de arranque.
- **Criterio de aceptación:** `supabase status` muestra los servicios locales arriba; Studio local abre; `.env.example` lista todas las claves con valores vacíos y `.env.local` no aparece en git.
- **Dependencias:** git init.

### [Haiku] - Verificación de charset UTF-8 del repositorio

Correr la auditoría de charset sobre todo el repo: todos los archivos fuente deben ser **UTF-8 sin BOM**, sin mojibake ni referencias a latin1. Dejar documentado cómo se escriben archivos desde PowerShell sin romper el encoding.

- **Artefactos:** `docs/charset.md` con el procedimiento y el resultado de la auditoría; correcciones de encoding si hubiera.
- **Criterio de aceptación:** la skill `charset-audit` reporta 0 archivos no-UTF-8 y 0 BOM; un archivo de prueba con `áéíóúñ¿¡` se lee correcto en editor y en navegador.
- **Dependencias:** repo inicializado.

### Checkpoint Sprint 0

Demo en local: `npm run dev` con una home que renderiza un componente shadcn/ui, `supabase status` OK, repo pusheado a GitHub, auditoría de charset limpia. **Fable aprueba antes de abrir el Sprint 1.**

---

## Sprint 1: Fundaciones de datos

**Objetivo:** modelar el dominio completo (incluidas las tablas que faltaban en el spec), blindarlo con RLS desde el día uno y dejar los clientes y helpers listos.
**Entregable demostrable:** migraciones aplicadas en la base local, tipos TypeScript generados, seed cargado y una demostración de que un usuario sin permiso **no puede leer** datos de otra familia.

### [Opus] - Diseño del esquema SQL completo (dominio y enums)

Escribir la migración inicial con **todas** las tablas: `profiles`, `family_permissions`, `documents`, `lab_metrics`, `appointments`, `medications`, `medication_intakes`, `vital_signs`, `doctors`, `insurance_cards`, `access_logs`, `push_subscriptions`. Usar `gen_random_uuid()` (pgcrypto) para todos los PK, `timestamptz` para fechas con hora, `text` con `CHECK` o enums para dominios cerrados. Enums: `user_role`, `doc_category`, `appointment_status` ('pending','confirmed','completed','cancelled'), `vital_sign_type`, `insurance_card_side`.

- **Artefactos:** `supabase/migrations/0001_schema_inicial.sql`, `docs/modelo-datos.md` con diagrama textual de relaciones.
- **Criterio de aceptación:** `supabase db reset` corre sin errores; `\d+` de cada tabla muestra los tipos esperados; no existe ninguna aparición de `uuid_generate_v4()` en el repo (`grep -rn "uuid_generate_v4" supabase/` devuelve 0).
- **Dependencias:** Sprint 0 completo.

### [Opus] - Modelo de permisos familiares y documentación de profiles.user_id nullable

Definir `family_permissions` como el eje del modelo: `owner_profile_id`, `granted_profile_id` (o `granted_user_id`), `can_view`, `can_upload`, `can_manage`, con unicidad por par y timestamps. Documentar explícitamente que **`profiles.user_id` es nullable a propósito**: un adulto mayor puede tener un perfil gestionado por un familiar sin cuenta propia en Supabase Auth.

- **Artefactos:** sección de `supabase/migrations/0001_schema_inicial.sql` con comentarios SQL (`COMMENT ON COLUMN profiles.user_id IS ...`), `docs/modelo-permisos.md`.
- **Criterio de aceptación:** `COMMENT ON COLUMN` está presente y se ve en `\d+ profiles`; el documento describe con ejemplos los tres casos: perfil con cuenta, perfil gestionado sin cuenta, cuidador con permisos parciales.
- **Dependencias:** diseño del esquema.

### [Opus] - Políticas RLS en todas las tablas

Habilitar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en **todas** las tablas del esquema y escribir políticas `select/insert/update/delete` derivadas de `family_permissions`: el dueño ve y edita todo lo suyo; el familiar autorizado ve según `can_view` y sube según `can_upload`; nadie más ve nada. Incluir función `SECURITY DEFINER` auxiliar (por ejemplo `public.puede_ver_perfil(uuid)`) para evitar recursión de políticas.

- **Artefactos:** `supabase/migrations/0002_rls.sql`, `docs/seguridad-rls.md` con la matriz rol × tabla × operación.
- **Criterio de aceptación:** con dos usuarios de prueba, el usuario B recibe 0 filas al consultar `documents` del usuario A; `select tablename from pg_tables where schemaname='public' and rowsecurity=false` devuelve **vacío**.
- **Dependencias:** modelo de permisos.

### [Opus] - Buckets privados de Storage y políticas de acceso

Crear los buckets `documentos-medicos` y `credenciales-cobertura` como **privados**, con políticas de storage alineadas a `family_permissions`. El acceso a archivos se hace **exclusivamente por signed URLs** de corta vida generadas en el servidor; en la base se guarda el **path** del objeto, nunca una URL pública.

- **Artefactos:** `supabase/migrations/0003_storage.sql`, `lib/storage.ts` con `crearSignedUrl(path, segundos)`.
- **Criterio de aceptación:** un `GET` directo a la URL pública del objeto devuelve 400/403; la signed URL generada por el servidor devuelve el archivo y expira; las columnas de archivo en `documents` e `insurance_cards` se llaman `storage_path` y contienen paths, no URLs.
- **Dependencias:** políticas RLS.

### [Sonnet] - Clientes @supabase/ssr (browser, server, middleware)

Implementar los tres puntos de entrada con `@supabase/ssr` + `@supabase/supabase-js`: `createBrowserClient` para Client Components, `createServerClient` para Server Components / Server Actions / Route Handlers, y el middleware de refresco de sesión. Prohibido usar `@supabase/auth-helpers-nextjs` (deprecado) o mezclarlo.

- **Artefactos:** `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`, `middleware.ts`.
- **Criterio de aceptación:** una página server-side lista filas de una tabla con RLS aplicada; el middleware refresca cookies (se ve la cookie renovada tras expiración simulada); `grep -rn "auth-helpers" .` devuelve 0.
- **Dependencias:** buckets y RLS.

### [Haiku] - Generación de tipos TypeScript desde el esquema

Generar los tipos de la base con el CLI de Supabase y exponer alias legibles del dominio (`Profile`, `Documento`, `Turno`, `Medicacion`, `SignoVital`, etc.) para no arrastrar `Database["public"]["Tables"][...]` por toda la app.

- **Artefactos:** `types/database.types.ts` (generado), `types/dominio.ts` (alias), script `npm run types:gen` en `package.json`.
- **Criterio de aceptación:** `npm run types:gen` regenera el archivo sin diferencias inesperadas; `npx tsc --noEmit` pasa; los alias se usan al menos en un componente de prueba.
- **Dependencias:** esquema aplicado.

### [Sonnet] - lib/gemini con @google/genai y modelo parametrizable

Implementar el wrapper de Gemini con el SDK vigente `@google/genai` (pinneado a `<3.0.0` si el runtime no es Node 22+), leyendo el model id desde `process.env.GEMINI_MODEL_ID` con default `gemini-3.5-flash-lite`. Dejar preparado `generateContent` con `responseMimeType: "application/json"` + `responseSchema`. **Nada de `@google/generative-ai` ni `gemini-1.5-flash`** (ambos retirados).

- **Artefactos:** `lib/gemini/client.ts`, `lib/gemini/schemas.ts`, `.env.example` con `GEMINI_MODEL_ID=gemini-3.5-flash-lite`.
- **Criterio de aceptación:** un script de prueba manda un texto simple y devuelve JSON válido contra el schema; cambiar `GEMINI_MODEL_ID` a `gemini-3.5-flash-lite` cambia el modelo **sin tocar código**; `grep -rn "generative-ai\|gemini-1.5" .` devuelve 0.
- **Dependencias:** clientes Supabase (para el patrón de env vars) y scaffold.

### [Haiku] - Seed de datos de prueba

Escribir un seed reproducible con una familia ficticia: un titular con cuenta, un adulto mayor con perfil gestionado (`user_id` NULL), permisos cruzados, 5 documentos, 20 `lab_metrics` en el tiempo, 3 turnos, 2 medicaciones, 10 signos vitales, 2 médicos y 1 credencial. Datos verosímiles en español con tildes y ñ.

- **Artefactos:** `supabase/seed.sql`, `scripts/seed.md` con instrucciones.
- **Criterio de aceptación:** `supabase db reset` deja la base con los volúmenes indicados (verificable con `SELECT count(*)` por tabla) y los textos con tildes se leen correctamente en Studio.
- **Dependencias:** esquema y RLS.

### Checkpoint Sprint 1

Demo en local: reset de base limpio, seed cargado, tipos generados, prueba de aislamiento RLS entre dos usuarios y una signed URL funcionando contra bucket privado. **Fable aprueba antes del Sprint 2.**

---

## Sprint 2: Autenticación y multiperfil

**Objetivo:** que una persona real pueda registrarse, entrar y elegir sobre qué perfil familiar va a trabajar, dejando rastro auditable.
**Entregable demostrable:** flujo completo login → selector de perfiles → contexto de perfil activo, con filas nuevas en `access_logs`.

### [Sonnet] - Registro, login y recuperación de contraseña

Implementar las pantallas de auth con Server Actions y `@supabase/ssr`: alta con email/contraseña, login, logout y recupero. Mensajes de error en español claro y sin jerga técnica, campos grandes y accesibles.

- **Artefactos:** `app/(auth)/login/page.tsx`, `app/(auth)/registro/page.tsx`, `app/(auth)/recuperar/page.tsx`, `app/(auth)/actions.ts`, `components/auth/formulario-auth.tsx`.
- **Criterio de aceptación:** un usuario nuevo se registra, cierra sesión y vuelve a entrar; una contraseña incorrecta muestra "La contraseña no es correcta" y no un stack trace; las rutas privadas redirigen a `/login`.
- **Dependencias:** Sprint 1 completo.

### [Opus] - Middleware de sesión y guardas de rutas privadas

Definir la matriz de rutas públicas/privadas y proteger todo lo que toque datos de salud, incluyendo Route Handlers. El middleware refresca la sesión y redirige; las Server Actions validan sesión y permiso **del lado del servidor**, sin confiar en el cliente.

- **Artefactos:** `middleware.ts` (matcher completo), `lib/auth/guardas.ts` con `requerirSesion()` y `requerirPermiso(perfilId, 'view'|'upload'|'manage')`.
- **Criterio de aceptación:** llamar a una Server Action de escritura sin sesión devuelve error controlado y no escribe; un `curl` a un Route Handler privado sin cookie devuelve 401.
- **Dependencias:** registro y login.

### [Sonnet] - Selector de perfiles estilo "Netflix"

Pantalla posterior al login que lista los perfiles a los que el usuario tiene acceso (propios + otorgados por `family_permissions`), con avatares grandes, nombre en tipografía grande y touch targets amplios. Al elegir, se fija el perfil activo en cookie httpOnly y se navega al inicio.

- **Artefactos:** `app/(app)/perfiles/page.tsx`, `components/perfiles/selector-perfiles.tsx`, `lib/perfil-activo.ts` (get/set del perfil activo server-side).
- **Criterio de aceptación:** con el seed, el titular ve 2 perfiles; al elegir el del adulto mayor, la home muestra su nombre; forzar por cookie un `perfil_id` sin permiso resulta en redirección al selector, no en fuga de datos.
- **Dependencias:** guardas de rutas.

### [Sonnet] - ABM de permisos familiares (invitar y revocar)

Pantalla para que el dueño de un perfil otorgue, edite y revoque accesos: elegir familiar, marcar `can_view` / `can_upload` / `can_manage`, y revocar en un click con confirmación. Aplicar minimización: por defecto solo `can_view`.

- **Artefactos:** `app/(app)/familia/page.tsx`, `app/(app)/familia/actions.ts`, `components/familia/tarjeta-permiso.tsx`.
- **Criterio de aceptación:** otorgar `can_view` hace aparecer el perfil en el selector del familiar; revocarlo lo saca y sus consultas directas devuelven 0 filas por RLS; el default al crear es solo lectura.
- **Dependencias:** selector de perfiles.

### [Opus] - Auditoría de accesos (access_logs)

Registrar en `access_logs` todo acceso a datos sensibles: qué usuario, sobre qué perfil, qué acción (`login`, `ver_perfil`, `ver_documento`, `descargar_archivo`, `exportar_ficha`), timestamp e IP/user-agent. El registro es append-only: sin `update` ni `delete` para usuarios finales.

- **Artefactos:** `lib/auditoria.ts`, política RLS append-only en `supabase/migrations/0004_auditoria.sql`, `app/(app)/familia/accesos/page.tsx` (vista para el dueño).
- **Criterio de aceptación:** entrar al perfil del adulto mayor genera una fila; intentar `delete from access_logs` como usuario autenticado falla; la vista muestra los últimos 50 accesos legibles ("María vio los estudios de Roberto — 12/08 14:30").
- **Dependencias:** ABM de permisos.

### [Haiku] - Tests unitarios de las guardas de permisos

Cubrir con tests la lógica pura de permisos: dueño, familiar con view, familiar con upload, familiar revocado, perfil inexistente. Sin tocar red: mocks del cliente Supabase.

- **Artefactos:** `tests/unit/guardas.test.ts`, configuración de Vitest en `vitest.config.ts`, script `npm run test`.
- **Criterio de aceptación:** `npm run test` pasa con al menos 8 casos y cubre los 4 verbos de permiso.
- **Dependencias:** guardas y auditoría.

### Checkpoint Sprint 2

Demo en local: registro de un usuario nuevo, otorgamiento de permiso a un segundo usuario, selector mostrando ambos perfiles, y `access_logs` con las filas correspondientes. **Fable aprueba antes del Sprint 3.**

---

## Sprint 3: Design system Senior UX

**Objetivo:** fijar el lenguaje visual y de interacción pensado para adultos mayores, para que todo lo que se construya después lo herede.
**Entregable demostrable:** shell de la app con bottom nav fija, tema de alto contraste, tipografía grande y dictado por voz operativo.

### [Opus] - Tokens de diseño y tema de alto contraste (Tailwind v4 @theme)

Definir la paleta en OKLCH y los tokens tipográficos en `@theme`: base de texto **18px** mínimo, escala hasta 32px para títulos, contraste **WCAG AA** (4.5:1 en texto normal, 3:1 en texto grande y componentes). Definir espaciados que garanticen targets de **48×48px**. Incluir variante de tema claro y oscuro coherentes.

- **Artefactos:** `app/globals.css` con bloque `@theme`, `docs/design-system.md` con la tabla de tokens y sus ratios de contraste medidos.
- **Criterio de aceptación:** cada par fondo/texto del documento tiene su ratio calculado y ≥ 4.5:1 (≥ 3:1 para texto ≥ 24px); el `font-size` computado del `body` es 18px o más.
- **Dependencias:** Sprint 2 completo.

### [Sonnet] - Layout base y bottom nav fija de 4 accesos

Shell de la aplicación con header mínimo (nombre del perfil activo + cambio de perfil) y **bottom nav fija** con cuatro accesos: **Inicio/SOS**, **Estudios**, **Turnos**, **Perfil/Familia**. Íconos Lucide grandes con etiqueta de texto siempre visible (nunca solo ícono), estado activo evidente por color **y** por forma.

- **Artefactos:** `app/(app)/layout.tsx`, `components/navegacion/bottom-nav.tsx`, `components/navegacion/encabezado-perfil.tsx`.
- **Criterio de aceptación:** medido en DevTools, cada botón de la nav mide ≥ 48×48px; la nav queda fija sobre el teclado virtual en Android; el contenido nunca queda tapado (padding-bottom reservado) y la altura usa `100dvh` con fallback.
- **Dependencias:** tokens de diseño.

### [Sonnet] - Componentes accesibles base (botón, campo, tarjeta, diálogo, alerta)

Envolver los primitivos de shadcn/ui en componentes propios con las reglas Senior UX aplicadas por defecto: labels siempre visibles (no placeholders como label), errores con texto además de color, `focus-visible` marcado, `inputmode` correcto en campos numéricos, confirmación explícita en acciones destructivas.

- **Artefactos:** `components/base/boton.tsx`, `components/base/campo-texto.tsx`, `components/base/campo-numero.tsx`, `components/base/tarjeta.tsx`, `components/base/dialogo-confirmacion.tsx`, `components/base/alerta.tsx`.
- **Criterio de aceptación:** navegación completa por teclado con foco siempre visible; los inputs numéricos abren teclado numérico en Android real; la skill `a11y-audit` no reporta labels desasociados ni `outline:none` sin reemplazo.
- **Dependencias:** layout base.

### [Sonnet] - Dictado por voz con Web Speech API

Componente de dictado reutilizable (botón de micrófono con estados: inactivo, escuchando, procesando, no soportado) integrado en buscadores y campos de texto largos, con idioma `es-AR`. Degradación limpia si el navegador no lo soporta: el campo sigue siendo escribible.

- **Artefactos:** `components/base/boton-dictado.tsx`, `hooks/use-reconocimiento-voz.ts`, tipos en `types/speech.d.ts`.
- **Criterio de aceptación:** dictar "control de glucosa" en el buscador escribe el texto con tildes correctas; en un navegador sin soporte el botón no se muestra y el input funciona igual; el permiso de micrófono se pide **con gesto del usuario**, nunca al cargar.
- **Dependencias:** componentes base.

### [Haiku] - Página de estilos (kitchen sink) para revisión visual

Página interna que muestra todos los componentes base en sus estados (normal, foco, error, deshabilitado, cargando) y la escala tipográfica completa, para revisar de un vistazo la coherencia del sistema.

- **Artefactos:** `app/(dev)/estilos/page.tsx`.
- **Criterio de aceptación:** la página lista todos los componentes de `components/base/` con al menos 3 estados cada uno y se ve correcta en 375px y 1280px de ancho.
- **Dependencias:** componentes base y dictado.

### Checkpoint Sprint 3

Demo en local: recorrido por la app con bottom nav, kitchen sink de estilos, dictado por voz funcionando y medición de contraste/targets. **Fable aprueba antes del Sprint 4.**

---

## Sprint 4: Ingesta inteligente de documentos

**Objetivo:** que subir un estudio sea tan simple como sacarle una foto, y que el sistema entienda qué es.
**Entregable demostrable:** foto de un análisis desde la cámara → extracción JSON con Gemini → documento guardado en bucket privado con sus métricas de laboratorio.

### [Sonnet] - Captura desde cámara y selección de PDF

Componente de carga con dos caminos: **sacar foto** (`capture="environment"`) y **elegir archivo** (PDF/JPG/PNG). Validación de tipo por MIME real (no por extensión), límite de tamaño, compresión client-side de fotos grandes y vista previa antes de confirmar.

- **Artefactos:** `components/documentos/cargador-documento.tsx`, `lib/archivos/validacion.ts`, `lib/archivos/compresion.ts`.
- **Criterio de aceptación:** en Android real la cámara abre directamente; un `.exe` renombrado a `.pdf` es rechazado por MIME; una foto de 8MB se sube comprimida a menos de 2MB sin perder legibilidad del texto.
- **Dependencias:** Sprint 3 completo.

### [Opus] - Pipeline de subida a Storage privado con path determinístico

Definir el esquema de paths (`{perfil_id}/{anio}/{uuid}.{ext}`), subir con el cliente server-side, guardar `storage_path` en `documents` y **nunca** una URL. Toda visualización posterior pasa por signed URL de vida corta generada en el servidor y auditada. Diseñar la Server Action y la ruta de ingesta de forma **reutilizable**: en el Sprint 11 el Web Share Target inyecta archivos compartidos desde otras apps por este mismo camino. El borrado de documentos/credenciales elimina también los objetos de Storage por doble vía: borrado explícito en la Server Action + tabla de purga (`storage_purge_queue`, creada en Sprint 1) que drena el job del Sprint 6 — requisito del derecho de supresión de la Ley 25.326.

- **Artefactos:** `app/(app)/documentos/actions.ts` (`subirDocumento`), `lib/storage.ts` extendido, migración de índices en `supabase/migrations/0005_documentos.sql`.
- **Criterio de aceptación:** el archivo aparece en el bucket con el path esperado; la fila de `documents` tiene `storage_path` y no contiene `http`; un familiar sin `can_view` recibe error al pedir la signed URL y queda registrado el intento.
- **Dependencias:** captura desde cámara.

### [Sonnet] - Route Handler de extracción con Gemini y responseSchema

API route que recibe el documento (o lo lee del bucket), lo manda a Gemini como `inlineData` con el MIME correcto y devuelve JSON estructurado validado: `{fecha, especialidad, institucion, medico, resumen, categoria, metricas[]}`. Modelo tomado de `GEMINI_MODEL_ID`. Timeout, reintento único y errores en español.

- **Artefactos:** `app/api/documentos/extraer/route.ts`, `lib/gemini/schemas.ts` (schema de documento médico), `lib/gemini/prompt-documento.ts`.
- **Criterio de aceptación:** con 3 documentos de prueba (análisis de sangre, informe de imágenes, receta) devuelve JSON válido contra el schema en los 3 casos; forzar un `GEMINI_MODEL_ID` inválido produce error controlado con mensaje claro, no un crash 500 sin cuerpo.
- **Dependencias:** pipeline de subida; `lib/gemini` del Sprint 1.

### [Haiku] - Validación del JSON extraído con Zod

Esquema Zod espejo del `responseSchema` de Gemini para validar la respuesta antes de tocar la base: fechas en `YYYY-MM-DD`, strings recortados, métricas con valor numérico y unidad, campos opcionales explícitos.

- **Artefactos:** `lib/validacion/documento.schema.ts`, `tests/unit/documento-schema.test.ts`.
- **Criterio de aceptación:** los tests cubren respuesta válida, campo faltante, fecha mal formada y métrica con valor no numérico; ninguna respuesta inválida llega a un `insert`.
- **Dependencias:** Route Handler de extracción.

### [Sonnet] - Pantalla de revisión y fallback de edición manual

Después de la extracción, mostrar los campos detectados en un formulario editable con indicación de confianza baja cuando la imagen es ilegible. Si Gemini falla o devuelve vacío, el mismo formulario se presenta en blanco para carga manual: **la subida nunca queda bloqueada por la IA**.

- **Artefactos:** `app/(app)/documentos/nuevo/page.tsx`, `components/documentos/formulario-revision.tsx`, `app/(app)/documentos/actions.ts` (`confirmarDocumento`).
- **Criterio de aceptación:** subir una foto borrosa a propósito lleva al formulario manual con aviso claro y permite guardar igual; editar un campo detectado y confirmar persiste el valor editado, no el de la IA.
- **Dependencias:** validación Zod.

### [Sonnet] - Persistencia de métricas de laboratorio (lab_metrics)

Al confirmar un documento de laboratorio, normalizar y guardar las métricas detectadas en `lab_metrics` (nombre canónico, valor, unidad, rango de referencia, fecha del estudio, `document_id`). Diccionario de sinónimos para unificar nombres ("Glucemia", "Glucosa en ayunas", "GLU").

- **Artefactos:** `lib/laboratorio/normalizacion.ts`, `lib/laboratorio/diccionario.ts`, migración `supabase/migrations/0006_lab_metrics_indices.sql`.
- **Criterio de aceptación:** un análisis con glucosa, colesterol total y hemoglobina genera exactamente 3 filas con nombre canónico; subir dos análisis de fechas distintas produce una serie ordenable por fecha sin duplicados.
- **Dependencias:** pantalla de revisión.

### Checkpoint Sprint 4

Demo en local: sacar foto de un análisis con el celular, ver la extracción, corregir un campo, guardar, y confirmar en Studio que quedaron documento + métricas + archivo en bucket privado. **Fable aprueba antes del Sprint 5.**

---

## Sprint 5: Estudios y tendencias de laboratorio

**Objetivo:** convertir la pila de documentos en información legible: qué me hice, cuándo, dónde, y cómo vengo evolucionando.
**Entregable demostrable:** galería cronológica filtrable y gráfico de evolución de glucosa/colesterol/hemoglobina con datos reales del seed.

### [Sonnet] - Galería cronológica de estudios

Listado agrupado por año y mes, con tarjetas grandes que muestran fecha, especialidad, institución y resumen en una línea. Paginación por scroll o "Ver más" (nunca scroll infinito sin control), estado vacío explicativo y skeletons de carga.

- **Artefactos:** `app/(app)/estudios/page.tsx`, `components/estudios/lista-estudios.tsx`, `components/estudios/tarjeta-estudio.tsx`.
- **Criterio de aceptación:** con el seed se ven los 5 documentos agrupados por período y ordenados de más nuevo a más viejo; sin documentos aparece un empty state con acción "Subir mi primer estudio".
- **Dependencias:** Sprint 4 completo.

### [Sonnet] - Filtros por especialidad, institución y rango de fechas + búsqueda por voz

Barra de filtros persistida en la URL (search params) con selects grandes y chips de filtros activos removibles. El buscador de texto incorpora el botón de dictado del Sprint 3.

- **Artefactos:** `components/estudios/filtros-estudios.tsx`, `lib/estudios/consultas.ts`.
- **Criterio de aceptación:** filtrar por "Cardiología" reduce la lista y la URL refleja `?especialidad=cardiologia`; recargar mantiene el filtro; dictar "laboratorio central" filtra por institución.
- **Dependencias:** galería.

### [Sonnet] - Visor de documento con signed URL y auditoría

Detalle del estudio: metadatos, resumen de la IA, métricas asociadas y visor del archivo (imagen o PDF embebido) servido por signed URL de vida corta. Cada apertura registra `ver_documento` en `access_logs`.

- **Artefactos:** `app/(app)/estudios/[id]/page.tsx`, `components/estudios/visor-documento.tsx`, `app/api/documentos/[id]/url/route.ts`.
- **Criterio de aceptación:** el visor abre el PDF; copiar la signed URL y usarla tras su expiración devuelve error; abrir el estudio agrega una fila de auditoría con el `document_id`.
- **Dependencias:** filtros.

### [Sonnet] - Gráficos de evolución temporal de métricas

Gráfico de líneas por métrica (glucosa, colesterol, hemoglobina y las demás disponibles) con banda de rango de referencia, puntos táctiles grandes, tooltip legible y selector de período (6 meses / 1 año / todo). Colores accesibles y forma diferenciada por serie (no solo color).

- **Artefactos:** `app/(app)/estudios/tendencias/page.tsx`, `components/estudios/grafico-metrica.tsx`, `lib/laboratorio/series.ts`.
- **Criterio de aceptación:** con las 20 métricas del seed el gráfico dibuja la serie correcta por métrica; valores fuera de rango se destacan; en 375px de ancho el gráfico se lee sin scroll horizontal de la página.
- **Dependencias:** visor de documento.

### [Haiku] - Tarjetas de resumen "último valor" por métrica clave

Tarjetas compactas con el último valor de cada métrica clave, su fecha, la variación respecto de la medición anterior y una señal visual (dentro / fuera de rango) que no dependa solo del color.

- **Artefactos:** `components/estudios/tarjeta-ultimo-valor.tsx`, integración en `app/(app)/estudios/tendencias/page.tsx`.
- **Criterio de aceptación:** la tarjeta muestra el valor más reciente y la flecha/etiqueta de tendencia correcta contra el dato previo; con una sola medición no muestra tendencia inventada.
- **Dependencias:** gráficos.

### Checkpoint Sprint 5

Demo en local: filtrar estudios por especialidad, abrir uno, ver el archivo, y pasar a tendencias con el gráfico de glucosa dibujado. **Fable aprueba antes del Sprint 6.**

---

## Sprint 6: Turnos y logística

**Objetivo:** que el turno no se pierda ni por olvido ni por no saber cómo llegar.
**Entregable demostrable:** turno cargado que dispara una notificación push real y ofrece "Cómo llegar", "Pedir viaje" y "Agregar al calendario".

### [Sonnet] - CRUD de turnos con estado tipado

Alta, edición, cancelación y marcado de asistencia de turnos, con `appointment_status` ('pending','confirmed','completed','cancelled'), especialidad, médico (opcional, ligado a `doctors`), institución, dirección y coordenadas `lat`/`lng`.

- **Artefactos:** `app/(app)/turnos/page.tsx`, `app/(app)/turnos/nuevo/page.tsx`, `app/(app)/turnos/actions.ts`, `components/turnos/formulario-turno.tsx`, `components/turnos/tarjeta-turno.tsx`.
- **Criterio de aceptación:** crear, editar y cancelar un turno funciona con RLS activa; los turnos pasados se muestran separados de los próximos; un `status` inválido es rechazado por el enum a nivel base.
- **Dependencias:** Sprint 5 completo.

### [Haiku] - Botones de logística: Maps, viajes y calendario

Barra de acciones del turno: **Cómo llegar** (deep link a Google Maps con `lat,lng`), **Pedir Viaje** (deep links a Uber, DiDi y Cabify con destino en `lat`/`lng`, con fallback a la web si la app no está instalada) y **Agregar al Calendario** (descarga `.ics` y link a Google Calendar).

- **Artefactos:** `lib/logistica/deep-links.ts`, `components/turnos/acciones-turno.tsx`, `app/api/turnos/[id]/ics/route.ts`.
- **Criterio de aceptación:** en Android real, "Cómo llegar" abre Maps con el destino correcto; los tres links de viaje abren app o web; el `.ics` descargado se importa en Google Calendar con fecha, hora, título y dirección correctas y en UTF-8.
- **Dependencias:** CRUD de turnos.

### [Opus] - Infraestructura de Web Push: tabla, VAPID y suscripción

Modelar `push_subscriptions` (endpoint, claves p256dh/auth, perfil, user agent, `created_at`, `last_seen_at`), generar el par VAPID, y registrar la suscripción desde la PWA pidiendo permiso **con gesto explícito** del usuario. Manejar `410 Gone` limpiando suscripciones muertas.

- **Artefactos:** `supabase/migrations/0007_push.sql`, `lib/push/suscripcion.ts`, `components/notificaciones/activar-notificaciones.tsx`, `public/sw.js` (handlers `push` y `notificationclick`), `docs/push.md` con la generación de claves VAPID.
- **Criterio de aceptación:** activar notificaciones crea una fila en `push_subscriptions`; un push de prueba llega al dispositivo y al tocarlo abre la ruta del turno; borrar la suscripción del navegador y reintentar marca la fila como inválida.
- **Dependencias:** CRUD de turnos.

### [Opus] - Edge Function + pg_cron para recordatorios programados

Edge Function que consulta turnos próximos y envía Web Push en las ventanas **7 días, 48hs, 24hs y 3hs**, con tabla o columna de control para no duplicar envíos. Programación con `pg_cron` cada 15 minutos; zona horaria `America/Argentina/Ushuaia` explícita.

- **Artefactos:** `supabase/functions/recordatorios-turnos/index.ts`, `supabase/migrations/0008_cron_recordatorios.sql`, `docs/recordatorios.md`.
- **Criterio de aceptación:** con un turno creado a 3h05m, el job envía exactamente **un** push en la ventana de 3hs y no repite en la corrida siguiente; el log de la función muestra la cantidad de destinatarios; cambiar la hora del turno recalcula las ventanas pendientes.
- **Dependencias:** infraestructura de Web Push.

### [Haiku] - Vista "Próximo turno" en la home

Bloque destacado en el inicio con el próximo turno del perfil activo: cuánto falta en lenguaje natural ("en 2 días"), lugar y acceso directo a las acciones de logística.

- **Artefactos:** `components/inicio/proximo-turno.tsx`, integración en `app/(app)/page.tsx`.
- **Criterio de aceptación:** con turnos del seed la home muestra el más próximo no cancelado; sin turnos futuros muestra "No tenés turnos programados" con acción de alta.
- **Dependencias:** botones de logística.

### Checkpoint Sprint 6

Demo en local: crear un turno, activar notificaciones, forzar la Edge Function y recibir el push en el celular; probar los tres deep links y el `.ics`. **Fable aprueba antes del Sprint 7.**

---

## Sprint 7: Medicación y recetas

**Objetivo:** saber qué toma la persona, cuándo, y avisar antes de que se quede sin remedios.
**Entregable demostrable:** medicación cargada con stock que dispara la alerta de renovación cuando quedan menos de 5 días de dosis.

### [Opus] - Modelo de medicación, tomas y cálculo de stock

Cerrar el diseño de `medications` (nombre comercial y droga, presentación, dosis, unidad, horarios, fecha de inicio, fecha de fin opcional, `stock_unidades`, `receta_document_id`) y `medication_intakes` (toma programada/registrada). Definir la fórmula de días restantes = `stock_unidades / dosis_diaria_total` y dónde se materializa (vista SQL o función), documentando la decisión.

- **Artefactos:** `supabase/migrations/0009_medicacion.sql` (tablas, enums de frecuencia, RLS, vista `v_medicacion_estado`), `docs/modelo-medicacion.md`.
- **Criterio de aceptación:** la vista devuelve `dias_restantes` correcto para 3 casos de prueba (1 toma/día, 2 tomas/día, cada 8hs); RLS activa y verificada con dos usuarios.
- **Dependencias:** Sprint 6 completo.

### [Sonnet] - ABM de medicación con horarios

Formulario de alta y edición con horarios múltiples (chips de hora, no un free text), unidades claras y ayuda contextual. Listado de medicación activa e histórica, con acción de suspender en vez de borrar (trazabilidad).

- **Artefactos:** `app/(app)/medicacion/page.tsx`, `app/(app)/medicacion/actions.ts`, `components/medicacion/formulario-medicacion.tsx`, `components/medicacion/tarjeta-medicacion.tsx`.
- **Criterio de aceptación:** cargar "Metformina 850mg, 2 veces por día, 8:00 y 20:00, stock 60 comprimidos" persiste correctamente y la vista calcula 30 días restantes; suspender la deja en el histórico sin borrar filas.
- **Dependencias:** modelo de medicación.

### [Sonnet] - Registro de tomas y descuento de stock

Marcado rápido de "tomé" desde la home o el detalle, que registra en `medication_intakes` y descuenta stock. Permitir corregir una toma marcada por error dentro del día.

- **Artefactos:** `components/medicacion/registro-toma.tsx`, `app/(app)/medicacion/actions.ts` (`registrarToma`, `revertirToma`).
- **Criterio de aceptación:** registrar una toma baja el stock en la dosis correspondiente y aparece en el historial del día; revertirla restituye el stock exacto; no se puede registrar dos veces la misma toma programada.
- **Dependencias:** ABM de medicación.

### [Opus] - Alerta preventiva de renovación de receta (menos de 5 días)

Job programado (pg_cron + Edge Function, reutilizando la infraestructura del Sprint 6) que detecta medicaciones con menos de 5 días de dosis y notifica al perfil y a los familiares con `can_manage`. Antiduplicación: una alerta por medicación cada 48hs.

- **Artefactos:** `supabase/functions/alertas-medicacion/index.ts`, `supabase/migrations/0010_cron_medicacion.sql`, `components/medicacion/banner-renovacion.tsx`.
- **Criterio de aceptación:** con stock para 4 días llega push y aparece el banner en la app; con stock para 6 días no llega nada; correr el job dos veces seguidas no duplica la notificación.
- **Dependencias:** registro de tomas; Web Push del Sprint 6.

### [Haiku] - Vinculación de la receta (documento) a la medicación

Permitir asociar un documento ya cargado (categoría receta) a la medicación, y mostrar acceso directo a la imagen de la receta desde la tarjeta.

- **Artefactos:** `components/medicacion/selector-receta.tsx`, columna `receta_document_id` usada en `components/medicacion/tarjeta-medicacion.tsx`.
- **Criterio de aceptación:** asociar una receta muestra el acceso "Ver receta" que abre el visor con signed URL; desasociar la quita sin borrar el documento.
- **Dependencias:** ABM de medicación; visor del Sprint 5.

### Checkpoint Sprint 7

Demo en local: alta de medicación, registro de tomas hasta bajar el stock a menos de 5 días, disparo del job y recepción de la alerta. **Fable aprueba antes del Sprint 8.**

---

## Sprint 8: Billetera de coberturas + Ficha SOS offline

**Objetivo:** que la información crítica esté disponible **siempre**, incluso sin señal, y que la credencial esté a mano en la ventanilla.
**Entregable demostrable:** con el celular en modo avión, la Ficha SOS y las credenciales se abren y se leen.

### [Sonnet] - Billetera de credenciales de cobertura

Alta de coberturas (OSDE, PAMI, IOMA, obra social sindical, prepaga, etc.) con número de afiliado, plan y **fotos de frente y dorso** guardadas en el bucket privado `credenciales-cobertura`. Visualización a pantalla completa con brillo alto para que la lea un lector de códigos.

- **Artefactos:** `app/(app)/coberturas/page.tsx`, `app/(app)/coberturas/actions.ts`, `components/coberturas/formulario-cobertura.tsx`, `components/coberturas/visor-credencial.tsx`.
- **Criterio de aceptación:** cargar frente y dorso persiste dos `storage_path` distintos; el visor muestra la imagen en pantalla completa y rotable; el archivo no es accesible sin signed URL.
- **Dependencias:** Sprint 7 completo.

### [Opus] - Modelo y edición de datos vitales SOS

Definir dónde viven los datos SOS (grupo sanguíneo, factor, alergias, enfermedades crónicas, medicación crítica, contacto de emergencia con teléfono y vínculo, cobertura principal): columnas dedicadas en `profiles` o tabla `emergency_info`, con la decisión documentada. Validación estricta y RLS.

- **Artefactos:** `supabase/migrations/0011_sos.sql`, `app/(app)/perfil/sos/page.tsx`, `app/(app)/perfil/sos/actions.ts`, `docs/modelo-sos.md`.
- **Criterio de aceptación:** los campos se guardan y recuperan con tildes correctas; un grupo sanguíneo inválido es rechazado; el familiar con `can_view` los ve y el revocado no.
- **Dependencias:** billetera de credenciales.

### [Sonnet] - Botón SOS destacado y ficha de emergencia

Botón SOS grande y siempre visible en la home (y accesible desde la bottom nav en "Inicio/SOS"), que abre una ficha de máxima legibilidad: tipografía grande, alto contraste, sin decoración, con llamada directa al contacto de emergencia (`tel:`).

- **Artefactos:** `components/inicio/boton-sos.tsx`, `app/(app)/sos/page.tsx`, `components/sos/ficha-sos.tsx`.
- **Criterio de aceptación:** el botón mide bastante más de 48×48px y contrasta ≥ 4.5:1; la ficha abre en menos de 2 toques desde cualquier pantalla; el teléfono del contacto marca al tocarlo en Android real.
- **Dependencias:** modelo SOS.

### [Opus] - Service worker con cache offline de datos vitales

Registrar el service worker con estrategia diferenciada: **cache-first** para el shell de la app, credenciales e imagen SOS; **network-first** con fallback a cache para los datos SOS en JSON. Actualizar el cache al abrir la app con conexión, versionar el cache y limpiar versiones viejas.

- **Artefactos:** `public/sw.js` (ampliado), `lib/pwa/registrar-sw.ts`, `app/api/sos/[perfilId]/route.ts` (payload cacheable), `docs/offline.md` con la matriz de estrategias.
- **Criterio de aceptación:** con **modo avión** activo, `/sos` y las imágenes de credenciales se abren completas; el resto de la app muestra una pantalla de "sin conexión" clara y no un error del navegador; al volver la conexión el cache se refresca.
- **Dependencias:** botón SOS.

### [Haiku] - Indicador de estado de conexión y última sincronización

Componente que muestra si la app está offline y cuándo se actualizaron por última vez los datos SOS cacheados, para que nadie confíe en información vieja sin saberlo.

- **Artefactos:** `components/base/indicador-conexion.tsx`, `hooks/use-estado-conexion.ts`.
- **Criterio de aceptación:** al cortar la red aparece el aviso en menos de 2 segundos; la ficha SOS offline muestra "Datos actualizados el 12/08 14:30".
- **Dependencias:** service worker.

### Checkpoint Sprint 8

Demo en local: cargar cobertura y datos SOS, poner el celular en modo avión y abrir la ficha SOS y la credencial. **Fable aprueba antes del Sprint 9.**

---

## Sprint 9: Signos vitales diarios y alertas

**Objetivo:** carga diaria sin fricción y escalamiento automático cuando un valor es peligroso.
**Entregable demostrable:** cargar 17/11 de tensión dispara alerta visible y notificación al perfil administrador.

### [Sonnet] - Carga rápida de tensión, glucemia y peso

Formulario minimalista optimizado para adultos mayores: teclado numérico, campos grandes, valores por defecto tomados de la última carga, y confirmación con feedback claro. Fecha y hora prellenadas con "ahora" y editables.

- **Artefactos:** `app/(app)/signos/page.tsx`, `app/(app)/signos/nuevo/page.tsx`, `app/(app)/signos/actions.ts`, `components/signos/formulario-signo.tsx`.
- **Criterio de aceptación:** cargar una medición completa toma 3 toques y 4 números; los campos abren teclado numérico; las fechas puras (`YYYY-MM-DD`, sin hora) se parsean a medianoche local explícita antes de comparar o calcular diferencias — nunca arrastrando la hora actual del momento de carga (el clásico bug de "la fecha no puede ser futura" que rompe todo el día salvo a las 00:00).
- **Dependencias:** Sprint 8 completo.

### [Opus] - Umbrales clínicos, validación y motor de alertas

Definir la tabla o constante de umbrales (por ejemplo sistólica ≥ 160 o diastólica ≥ 100; glucemia < 70 o > 250; variación de peso significativa), configurables por perfil, y el motor que evalúa cada carga y genera la alerta. Los umbrales son orientativos, no diagnóstico: el texto debe decirlo.

- **Artefactos:** `supabase/migrations/0012_signos_umbrales.sql`, `lib/signos/umbrales.ts`, `lib/signos/evaluar.ts`, `tests/unit/umbrales.test.ts`.
- **Criterio de aceptación:** los tests cubren valor normal, límite exacto, por encima y valor imposible; 16/10 exacto dispara según la regla definida y queda documentado si el límite es inclusivo.
- **Dependencias:** carga rápida.

### [Sonnet] - Notificación de alerta al perfil administrador

Cuando una carga supera el umbral, notificar por Web Push a los familiares con `can_manage` sobre ese perfil, dejar registro y mostrar un banner persistente en la app hasta que alguien lo marque como visto.

- **Artefactos:** `lib/signos/notificar.ts`, `components/signos/banner-alerta.tsx`, `app/(app)/signos/actions.ts` (`marcarAlertaVista`).
- **Criterio de aceptación:** cargar 17/11 con el usuario del adulto mayor hace llegar push al familiar administrador en menos de 30 segundos; el banner queda hasta que se lo marca visto y eso se registra con usuario y hora.
- **Dependencias:** motor de alertas; Web Push del Sprint 6.

### [Sonnet] - Historial y gráficos de signos vitales

Vista con la serie temporal de cada signo (tensión con dos líneas sistólica/diastólica, glucemia, peso), rangos de referencia sombreados y filtro por período, reutilizando los componentes de gráfico del Sprint 5.

- **Artefactos:** `app/(app)/signos/historial/page.tsx`, `components/signos/grafico-tension.tsx`, `lib/signos/series.ts`.
- **Criterio de aceptación:** con 10 mediciones del seed las tres series se dibujan correctamente; los valores fuera de umbral se marcan visualmente y con etiqueta textual.
- **Dependencias:** notificación de alerta.

### [Haiku] - Exportación CSV de signos vitales

Descarga de la serie filtrada en CSV **UTF-8 con BOM opcional para Excel**, separador configurable, encabezados en español, para llevarle datos al médico.

- **Artefactos:** `app/api/signos/export/route.ts`, `components/signos/boton-exportar.tsx`.
- **Criterio de aceptación:** el CSV abre en Excel con tildes correctas y una fila por medición; el rango exportado coincide exactamente con el filtro aplicado en pantalla.
- **Dependencias:** historial y gráficos.

### Checkpoint Sprint 9

Demo en local: carga diaria de tensión, disparo de alerta con push al administrador, historial graficado y exportación CSV. **Fable aprueba antes del Sprint 10.**

---

## Sprint 10: Directorio de médicos + Ficha de Resumen para Consulta

**Objetivo:** tener la agenda de profesionales a mano y llegar a la consulta con una hoja que resuma todo.
**Entregable demostrable:** ficha de 1 página generada por IA con antecedentes, estudios recientes y medicación, lista para imprimir o mostrar.

### [Sonnet] - Directorio de médicos (ABM y vinculación)

ABM de `doctors`: nombre, especialidad, matrícula, institución, teléfono, dirección con coordenadas y notas. Vinculación con turnos y documentos, y acciones rápidas de llamar y "cómo llegar".

- **Artefactos:** `app/(app)/medicos/page.tsx`, `app/(app)/medicos/actions.ts`, `components/medicos/formulario-medico.tsx`, `components/medicos/tarjeta-medico.tsx`.
- **Criterio de aceptación:** alta, edición y baja lógica funcionan con RLS; al crear un turno se puede elegir un médico existente y queda vinculado; el botón de teléfono marca en Android real.
- **Dependencias:** Sprint 9 completo.

### [Opus] - Armado del contexto clínico para la ficha (con minimización de datos)

Función server-side que reúne el contexto que se manda a la IA: antecedentes y datos SOS, últimos N estudios con sus resúmenes, métricas relevantes con tendencia, medicación activa y últimos signos vitales. **Minimización obligatoria:** se envía solo lo necesario, sin nombre completo, documento ni datos de contacto identificatorios innecesarios.

- **Artefactos:** `lib/ficha/contexto.ts`, `docs/minimizacion-datos.md` con la lista exacta de campos enviados y los excluidos.
- **Criterio de aceptación:** el payload generado para el perfil del seed **no contiene** DNI, dirección, teléfono ni email (verificable con un test que busca esos campos); contiene medicación activa y las 3 últimas métricas por tipo.
- **Dependencias:** directorio de médicos.

### [Sonnet] - Generación de la ficha con Gemini (structured output)

Route Handler que envía el contexto a Gemini con `responseSchema` y devuelve secciones estructuradas: motivo de consulta sugerido, antecedentes, medicación actual, estudios recientes, valores fuera de rango, preguntas sugeridas para el médico. Con aviso visible de que es un resumen asistido por IA y no un diagnóstico.

- **Artefactos:** `app/api/ficha/generar/route.ts`, `lib/gemini/schemas.ts` (schema de ficha), `lib/gemini/prompt-ficha.ts`.
- **Criterio de aceptación:** la respuesta valida contra el schema Zod correspondiente; una segunda generación con los mismos datos produce secciones equivalentes en estructura; el aviso de "resumen asistido por IA, no sustituye criterio médico" aparece en la salida.
- **Dependencias:** contexto clínico.

### [Sonnet] - Vista imprimible de 1 página y compartir

Render de la ficha en una hoja A4 con estilos de impresión (`@media print`), tipografía legible, sin navegación, y opciones de imprimir o compartir. Debe caber en una página con los datos típicos.

- **Artefactos:** `app/(app)/ficha/[perfilId]/page.tsx`, `app/(app)/ficha/ficha.print.css`, `components/ficha/hoja-consulta.tsx`.
- **Criterio de aceptación:** la vista previa de impresión del navegador muestra **una** página con el contenido del seed; los caracteres con tilde salen correctos en el PDF impreso; generar la ficha registra `exportar_ficha` en `access_logs`.
- **Dependencias:** generación con Gemini.

### [Haiku] - Historial de fichas generadas

Guardar cada ficha generada (fecha, perfil, quién la generó, contenido) y listarla, para poder mostrar la misma hoja en la consulta sin regenerarla ni gastar tokens de más.

- **Artefactos:** `supabase/migrations/0013_fichas.sql`, `app/(app)/ficha/historial/page.tsx`.
- **Criterio de aceptación:** generar dos fichas deja dos filas; abrir una vieja muestra exactamente el contenido guardado, no una regeneración.
- **Dependencias:** vista imprimible.

### Checkpoint Sprint 10

Demo en local: alta de médico, generación de la ficha de resumen, vista de impresión de una página y registro en el historial y en auditoría. **Fable aprueba antes del Sprint 11.**

---

## Sprint 11: PWA completa y hardening

**Objetivo:** cerrar la app como producto instalable, rápido, accesible y seguro, con auditorías escritas.
**Entregable demostrable:** app instalada desde el navegador en un Android real + informes de auditoría RLS, accesibilidad y performance con hallazgos resueltos.

### [Sonnet] - Manifest, íconos e instalabilidad

Completar `manifest.webmanifest` (nombre, nombre corto, `start_url`, `display: standalone`, colores de tema y fondo, orientación, íconos 192/512 y maskable, shortcuts a SOS y Turnos) y el prompt de instalación con gesto del usuario. Meta tags de Apple incluidos.

- **Artefactos:** `app/manifest.ts` o `public/manifest.webmanifest`, `public/icons/*`, `components/pwa/boton-instalar.tsx`, metadatos en `app/layout.tsx`.
- **Criterio de aceptación:** la skill `pwa-audit` pasa sin errores; en Android real aparece "Instalar aplicación" y, una vez instalada, abre sin barra de navegador con el ícono correcto; los shortcuts abren SOS y Turnos.
- **Dependencias:** Sprint 10 completo.

### [Sonnet] - Web Share Target: recibir archivos desde el menú Compartir del sistema

Registrar la PWA como destino de compartir a nivel sistema: `share_target` en el manifest (`method: POST`, `enctype: multipart/form-data`, `files` aceptando PDF/JPG/PNG/WebP) con handler que recibe el archivo y lo encola en el flujo de ingesta del Sprint 4. Flujo decidido: compartir desde cualquier app → se abre la pantalla de recepción de Historial Médico → el usuario elige el **perfil de destino** (crítico en app multiperfil) → extracción automática con Gemini → formulario de revisión → **visto bueno del usuario** → guardado. La IA nunca guarda sin confirmación. Limitación documentada: requiere PWA instalada en Android (Chrome/Edge); iOS no soporta share target — la alternativa es subir desde la app.

- **Artefactos:** `manifest` con bloque `share_target`, `app/api/compartir/route.ts` (receptor POST multipart), `app/(app)/compartir/page.tsx` (pantalla de recepción con selector de perfil), `docs/share-target.md`.
- **Criterio de aceptación:** en un Android real con la PWA instalada, "Compartir" un PDF desde el gestor de archivos muestra "Historial Médico" entre los destinos; elegirla abre la recepción con el archivo adjunto, se selecciona perfil, corre la extracción y el documento queda guardado recién tras confirmar; compartir una foto JPG desde la galería funciona igual; compartir con la app NO instalada no rompe nada (la opción simplemente no aparece).
- **Dependencias:** manifest e instalabilidad; pipeline de ingesta del Sprint 4.

### [Opus] - Consolidación del service worker y estrategia offline global

Unificar en un solo service worker el cache del shell, los datos SOS, el manejo de push y el ciclo de actualización (skipWaiting controlado, aviso de "hay una versión nueva"). Definir qué rutas son navegables offline y cuáles muestran fallback.

- **Artefactos:** `public/sw.js` (versión final comentada), `app/offline/page.tsx`, `docs/offline.md` actualizado con la matriz completa de rutas.
- **Criterio de aceptación:** offline: SOS, coberturas y última lista de turnos y medicación se ven; el resto cae en `/offline` con explicación; publicar una versión nueva del SW muestra el aviso de actualización y no rompe la sesión.
- **Dependencias:** manifest e íconos.

### [Opus] - Auditoría de seguridad de RLS y Storage

Revisión sistemática: toda tabla con RLS habilitada y políticas efectivas, ninguna ruta que use `SERVICE_ROLE_KEY` desde el cliente, buckets privados, signed URLs con vida corta, `access_logs` append-only, sin secretos en el bundle del cliente. Incluir pruebas activas de intento de acceso cruzado.

- **Artefactos:** `docs/auditoria-seguridad.md` con hallazgos, severidad y estado; `tests/seguridad/rls.test.ts` con casos de acceso cruzado.
- **Criterio de aceptación:** los tests demuestran 0 filas devueltas en todos los intentos cruzados; `grep -rn "SERVICE_ROLE" app/ components/` no encuentra usos en código de cliente; el informe no tiene hallazgos abiertos de severidad alta.
- **Dependencias:** service worker consolidado.

### [Opus] - Auditoría de accesibilidad WCAG 2.1 AA

Auditoría completa con la skill `a11y-audit` más revisión manual: navegación por teclado, foco visible, landmarks, jerarquía de headings, contraste real medido, textos alternativos, mensajes de error asociados, `prefers-reduced-motion`, tamaño de targets y zoom al 200% sin pérdida de contenido.

- **Artefactos:** `docs/auditoria-a11y.md` con hallazgos y correcciones aplicadas; fixes en los componentes afectados.
- **Criterio de aceptación:** `a11y-audit` sin hallazgos críticos; recorrido completo del flujo principal solo con teclado; a 200% de zoom no hay contenido cortado ni scroll horizontal.
- **Dependencias:** auditoría de seguridad.

### [Sonnet] - Optimización de performance y Core Web Vitals

Revisión de bundle, imágenes (`next/image` con `width`/`height`), carga diferida de charts, streaming con Suspense donde ayude, y verificación de LCP < 2.5s, INP < 200ms, CLS < 0.1 en la home, estudios y turnos.

- **Artefactos:** `docs/auditoria-performance.md` con métricas antes/después, ajustes en componentes y `next.config.ts`.
- **Criterio de aceptación:** las tres rutas cumplen los umbrales en Lighthouse mobile local; el bundle de la home baja respecto de la medición inicial y el número queda registrado en el informe.
- **Dependencias:** auditoría de accesibilidad.

### [Haiku] - Pruebas en dispositivo Android real

Recorrido guiado de los flujos principales en un Android real por ADB: cámara, push, deep links, instalación PWA, modo avión y dictado por voz. Registro de resultados con capturas.

- **Artefactos:** `docs/pruebas-dispositivo.md` con checklist, resultados y capturas en `docs/capturas/`.
- **Criterio de aceptación:** los 6 flujos quedan marcados OK o con incidencia registrada; cada incidencia tiene tarea derivada anotada.
- **Dependencias:** optimización de performance.

### Checkpoint Sprint 11

Demo en local: app instalada en un celular real, funcionando offline en lo crítico, con los tres informes de auditoría cerrados sin hallazgos altos. **Fable aprueba antes del Sprint 12.**

---

## Sprint 12: Deploy a producción

> **Este sprint no se ejecuta por iniciativa propia.** Todo el desarrollo es local-first. Este sprint arranca **únicamente** cuando el usuario lo pide con palabras explícitas del tipo "subilo a producción", "deployá a Vercel", "publicá el sitio". Frases como "listo", "terminé", "funciona" o "está confirmado" **no** autorizan el deploy: ante la duda, se pregunta.
>
> **Autorización registrada (2026-08-12):** el usuario autorizó explícitamente el deploy a producción **condicionado a que los Sprints 2-11 estén completamente terminados y auditados**. Verificado ese día que el proyecto Vercel NO tiene auto-deploy desde GitHub (404 en vercel.app y en el dominio) — el deploy será un acto deliberado del Sprint 12. Pasos que probablemente requieran presencia del usuario o su navegador autenticado: `supabase link`/`db push` al proyecto cloud (access token), carga de variables de entorno en Vercel, y conexión del repo. Si el navegador del usuario (extensión de Chrome) está disponible, se intentará; lo que no se pueda queda en la lista de pendientes de su regreso.

**Objetivo:** publicar la aplicación en `historialmedico.com.ar` cumpliendo la Ley 25.326.
**Entregable demostrable:** sitio en producción con dominio propio, HTTPS, páginas legales y consentimiento operativo.

### [Sonnet] - Páginas legales y consentimiento (Ley 25.326)

Redactar y publicar Política de Privacidad y Términos, dejando explícito que los datos de salud son **datos sensibles** (art. 2 y 7 de la Ley 25.326), la finalidad del tratamiento, la base de consentimiento libre, expreso e informado, los derechos de acceso, rectificación y supresión, el responsable de la base y el contacto. Consentimiento explícito en el registro y al otorgar acceso a un familiar.

- **Artefactos:** `app/(legal)/privacidad/page.tsx`, `app/(legal)/terminos/page.tsx`, `components/legal/consentimiento.tsx`, columna de consentimiento con fecha y versión en `profiles` o tabla `consents`.
- **Criterio de aceptación:** no se puede completar el registro sin aceptar explícitamente (checkbox sin marcar por defecto, sin dark patterns); el consentimiento queda registrado con versión y timestamp; ambas páginas son accesibles desde el pie sin sesión.
- **Dependencias:** Sprint 11 completo **y pedido explícito del usuario**.

### [Opus] - Revisión de seguridad y privacidad previa a producción

Chequeo final antes de publicar: variables de entorno de producción separadas de las de local, claves rotadas si estuvieron expuestas, RLS verificada contra la base remota, buckets privados en el proyecto de producción, logs sin datos sensibles, política de retención y borrado documentada.

- **Artefactos:** `docs/checklist-produccion.md` completado, `docs/retencion-datos.md`.
- **Criterio de aceptación:** cada ítem del checklist tiene evidencia (comando corrido o captura); ninguna clave de producción está en el repo; `select tablename from pg_tables where schemaname='public' and rowsecurity=false` en la base remota devuelve vacío.
- **Dependencias:** páginas legales.

### [Sonnet] - Deploy en Vercel y configuración del dominio

Conectar el repo a Vercel, cargar variables de entorno de producción, configurar `historialmedico.com.ar` con sus DNS, forzar HTTPS y redirección `www` → apex (o la que decida el usuario), y aplicar las migraciones al proyecto Supabase de producción.

- **Artefactos:** configuración del proyecto en Vercel, `docs/deploy.md` con pasos y DNS, migraciones aplicadas en remoto.
- **Criterio de aceptación:** `https://historialmedico.com.ar` responde 200 con certificado válido; `http://` y `www` redirigen; el login y un flujo de lectura funcionan contra la base de producción.
- **Dependencias:** revisión de seguridad.

### [Sonnet] - Jobs de producción: pg_cron, Edge Functions y VAPID

Desplegar las Edge Functions de recordatorios y alertas en el proyecto remoto, programar los cron jobs con la zona horaria correcta y cargar las claves VAPID de producción (distintas de las de local).

- **Artefactos:** funciones desplegadas, `docs/deploy.md` con los comandos de despliegue y el listado de jobs.
- **Criterio de aceptación:** `select * from cron.job` en producción lista los jobs esperados; un turno de prueba genera push real en un dispositivo; los logs de la función no imprimen datos de salud.
- **Dependencias:** deploy en Vercel.

### [Haiku] - Verificación post-deploy y smoke tests

Recorrido de humo en producción: registro, login, selector de perfiles, subida de un documento, carga de un signo vital, ficha SOS offline y páginas legales. Registro de resultados.

- **Artefactos:** `docs/smoke-produccion.md` con checklist y resultados fechados.
- **Criterio de aceptación:** los 7 flujos pasan en producción desde un dispositivo real; cualquier falla queda anotada con severidad y responsable.
- **Dependencias:** jobs de producción.

### Checkpoint Sprint 12

Demo: sitio productivo funcionando con dominio, legales y notificaciones reales, más el checklist de smoke tests completo. **Fable audita y cierra el proyecto o abre el backlog de mejoras.**

---

## Sprint 13: Modo de letra chica (densidad compacta)

> Pedido del usuario (2026-08-14, con el Sprint 12 en pausa): además del modo actual de letra GRANDE (Senior UX, queda como está y como default), un modo de letra CHICA para quien ve bien — pantallas mejor organizadas, tipografía/tarjetas/secciones más compactas. Decisiones cerradas con el usuario: la preferencia es **de quien mira** (cuenta logueada, persistida en su perfil, viaja entre dispositivos); rediseño **profundo vista por vista** (TODAS las vistas); **SOS también compacta**; conmutador **Opción A** (pregunta en el selector de perfiles + botón A/a siempre visible en el encabezado).

**Objetivo:** que María (49, ve bien) use la app densa y Roberto (80) la use grande, cada uno sin enterarse del modo del otro.
**Entregable demostrable:** alternar A/a reorganiza TODA la app al instante y la preferencia persiste entre sesiones y dispositivos.

### [Opus] - Fundaciones de densidad: preferencia, tokens y conmutadores

Migración de la columna de preferencia en `profiles` (de la cuenta que mira, default `grande`), atributo `data-tamano` en `<html>` resuelto server-side (sin flash), set completo de tokens compactos en `globals.css` (tipografía, espaciados, alturas táctiles — piso 40px en compacta), custom variant de Tailwind para redisenos por vista (`chica:`), Server Action de persistencia, pregunta en el selector de perfiles y botón A/a en el encabezado. El script de contraste debe validar los pares en AMBAS densidades (un texto que era "grande" para WCAG puede pasar a umbral 4.5:1 en compacta).

- **Criterio de aceptación:** alternar A/a cambia toda la app al instante y sin flash al recargar; la preferencia persiste en la base y sigue a la cuenta; RLS del campo verificada; contraste PASS en ambas densidades.

### [Sonnet] - Rediseño compacto por secciones (5 tandas)

1. Shell + inicio + navegación; 2. Estudios completo (galería, filtros, carga, detalle, tendencias); 3. Turnos + medicación + signos; 4. Coberturas + familia + médicos + SOS (edición y ficha); 5. Ficha IA + compartir + offline + auth. Cada tanda: reorganización real en modo chico (grillas más densas, tarjetas compactas, listas apretadas) sin tocar el modo grande, verificación en dispositivo de ambos modos, suites completas.

- **Criterio de aceptación por tanda:** en modo chico las pantallas muestran más contenido por pantalla con jerarquía clara; en modo grande quedan EXACTAMENTE como estaban (captura comparativa); a11y sostenida (foco, teclado, targets ≥40px compacta).

### Checkpoint Sprint 13

Demo en el dispositivo real: alternar A/a en 6 pantallas representativas, persistencia tras relogin, ambos modos auditados (contraste dual, a11y, suites completas). **Fable aprueba y recién ahí se retoma la pausa del Sprint 12 cuando el usuario lo pida.**

---

## Sprint 14: Densidad chica v2 — paridad con apps nativas

> Pedido del usuario (2026-08-15, con el sitio ya en producción): la letra chica del Sprint 13 sigue siendo "enorme" — es una reducción del modo grande, no una densidad nativa. Objetivo: que el modo chico se sienta como una app de celular real (WhatsApp/Mercado Libre/home banking), con mejora percibida de ~80% en aprovechamiento de pantalla. Autorizado explícitamente: layouts multi-columna (2+ tarjetas/secciones por fila) donde aporte. **El modo grande NO se toca.** Además: **el DEFAULT pasa a CHICA** para todo el mundo (DB, cookie pre-sesión y backfill), recordando a quien elija grande con el A/a. Verificación en el Galaxy A71 real (reconectado, acceso total re-autorizado).
>
> ⚠️ CONTEXTO DEPLOY: push a main = PRODUCCIÓN (auto-deploy). Migraciones nuevas requieren `npx supabase db push` del usuario.

### [Opus] - Retokenizado nativo + default chica

Benchmark de métricas nativas (Material 3 / iOS HIG) y recalibración COMPLETA del set compacto en globals.css: cuerpo ~14px, secundario 12-13px, títulos de pantalla 18-20px, spacing base 4→3.5px o menor, paddings de tarjeta 12px, gaps 8px, radios ~10px, header ~56px, bottom nav ~64px, controles 40-44px (piso táctil WCAG 24, confort 40). Contraste dual re-verificado (tamaños menores → umbrales más exigentes). Default: migración `display_density` default 'chica' + backfill de filas en 'grande' (nadie eligió grande explícitamente aún) + default de cookie/lib en 'chica' + seed con Roberto explícito en 'grande' (persona mayor de la demo).

- **Criterio:** en el Galaxy, /inicio y /medicacion en chica muestran ≥1.7× más contenido vertical que la chica v1 (medido en px de contenido visible); login sin cookie sale en chica; grande queda idéntico al píxel.

### [Sonnet] - Tandas de re-compactado por layout (2 tandas)

Tanda A: inicio (grilla de accesos 3 columnas si entra, cards de datos como FILAS densas), medicación (tarjetas → filas expandibles o tarjetas de media altura, tomas de hoy como lista), signos (últimas mediciones como tabla densa), turnos (filas). Tanda B: estudios (galería 2 columnas o filas densas), coberturas/médicos/familia (filas), SOS/ficha/ajustes menores. Multi-columna donde aporte; información clínica siempre visible; targets ≥40px.

- **Criterio por tanda:** capturas comparativas v1 vs v2 en el dispositivo; sin truncados con datos reales; grande intacto (pixel diff).

### Checkpoint Sprint 14

Demo en el Galaxy: recorrido completo en chica v2 + métricas de contenido por pantalla vs v1 + grande intacto + suites completas. Tras aprobar: push (auto-deploy) + `db push` del usuario para la migración del default.

---

## Sprint 15: Perfiles de niños (gestionados) con graduación

> Pedido del usuario (2026-08-15). El modelo YA soporta perfiles sin cuenta (`profiles.user_id NULL`, Roberto de la demo) pero NO hay UI para crearlos, y falta la pieza nueva: la **graduación** (vincular email+contraseña más adelante). Decisión de producto cerrada con el usuario: tras la graduación los accesos existentes SE MANTIENEN y el nuevo titular puede revocarlos desde Familia.

### [Sonnet] - Crear perfil gestionado desde Familia

Formulario en /familia: nombre + fecha de nacimiento (sin email). El creador queda con can_view/upload/manage (fila de family_permissions) y `created_by_profile_id`; puede autorizar a otros con el flujo existente. Sirve para niños Y para mayores sin email (mismo mecanismo, texto de UI neutro: "Crear un perfil para un familiar sin cuenta"). Respeta el trigger de no-orfandad y el consentimiento de acceso familiar (12.1) — el creador consiente como responsable/representante (Ley 25.326, patria potestad), texto legal acorde.

- **Criterio:** crear "Lucas (2019)" desde Familia → aparece en el selector del creador como gestionado; un tercero autorizado lo ve; un no autorizado no; RLS arnesada.

### [Opus] - Graduación: vincular cuenta propia al perfil gestionado

Solo el CREADOR del perfil (created_by_profile_id) ve la acción "Darle su propia cuenta" en el perfil gestionado: carga email + contraseña inicial → server-side (service_role admin API) se crea la cuenta de auth con metadata `perfil_existente: <uuid>` → el trigger de alta (20260814140000) debe detectar ese metadata y VINCULAR (UPDATE profiles SET user_id WHERE id = X AND user_id IS NULL) en vez de crear un perfil nuevo, con consents del nuevo titular al primer ingreso (acepta legales él mismo — hasta entonces rige el consentimiento del representante). El chico entra desde su celular, cambia la contraseña con el flujo de recuperar existente, y como titular gestiona sus autorizados (los accesos previos se mantienen). Casos hostiles arnesados: graduar un perfil ya graduado (rechazado), email ya en uso (mensaje claro), un can_manage NO creador no puede graduar.

- **Criterio:** flujo completo demostrado con dos cuentas reales en local; producción tras auditoría + db push del usuario.

### Checkpoint Sprint 15

Demo: crear niño → cargarle historial → graduarlo → entrar con su cuenta → revocar un acceso. **Fable aprueba antes de pushear.**

---

## Sprint 16: Turnos inteligentes y catálogos (pedido 2026-08-17, tras Sprint 15)

1. **Ciudad/provincia en turnos y médicos** — el link "Cómo llegar" hoy fuerza ", Ushuaia, Tierra del Fuego" cuando no hay coords (bug reportado por el usuario con "caba"). Campos nuevos opcionales con Ushuaia como sugerencia editable; deep link con lo que el usuario ponga.
2. **Catálogo de especialidades médicas** (lista completa reconocida en Argentina) precargado + autocompletar por coincidencia en turnos/médicos. Médicos con MÚLTIPLES especialidades (join table; migrar el texto actual).
3. **Catálogo REFES de establecimientos de salud** (dataset público datos.gob.ar) precargado: autocompletar de "Lugar" con filtro provincia/localidad; siempre editable a mano. Cards de "Lugares" y "Especialidades" en /inicio. **Botón "Actualizar" (confirmado 2026-08-17)**: re-descarga el dataset oficial y sincroniza el catálogo local por lotes (upsert incremental, job trackeable — cuidar límites de tiempo de Vercel Hobby).

(El flujo de llamada de emergencia queda COMO ESTÁ — decisión del usuario 2026-08-17: el auto-llamado es inviable en web y no se trabaja más en eso.)

## Sprint 17 (CONFIRMADO 2026-08-17): Ingesta automática desde Gmail

Conectar la cuenta de Gmail del usuario vía OAuth (gratuito, scopes mínimos de lectura + etiquetas) para que la app lea la etiqueta "historialmedico" periódicamente e importe los adjuntos al flujo de ingesta (extracción + revisión + visto bueno — nunca guarda sola). **Al conectar, si la etiqueta no existe, la app la CREA automáticamente** (pedido del usuario, evita errores de tipeo). Diseño pendiente de spec: OAuth por cuenta (tabla de conexiones con tokens cifrados), barrido periódico (cron existente como patrón), y pantalla de "correos detectados" para elegir perfil + revisar. Nota: requiere crear credenciales OAuth en Google Cloud Console (gratuito) — paso del usuario con instructivo, como las claves del deploy.

### Estado

- **17.1 — Conexión OAuth (hecha).** `gmail_connections`, el refresh token cifrado en el Vault, la etiqueta `historialmedico` creada al conectar, la pantalla `/perfil/gmail` con sus tres estados y la desconexión que revoca contra Google. Ver `docs/minimizacion-datos.md` §10.
- **17.2 — Barrido, ingesta y filtros aprendidos (hecha, local).** El barrido de la etiqueta (cron cada 30 min con el patrón `pg_cron` → `pg_net` → `x-cron-secret`, más el botón "Buscar ahora"), el registro de correos con dedup (`gmail_messages`), la bandeja "Llegaron por Gmail" en `/perfil/gmail`, la ingesta de adjuntos por el pipeline de documentos EXISTENTE (`ingestarDocumento` → la pantalla de revisión de siempre), la propuesta de turno con el analizador de la 16.4 y los filtros por remitente aprendidos del uso (`gmail_filters`, con su botón de sacarlos). Documentación completa en `docs/gmail-ingesta.md`; privacidad en `docs/minimizacion-datos.md` §10.6.
  - **Falta la verificación con una casilla REAL**: todo el circuito está probado contra un Gmail de mentira (`tests/unit/gmail-barrido.test.ts`), porque el toque de consentimiento es del usuario. La lista de lo que solo se puede confirmar con la conexión real está en el Resumen de Entrega de la tarea.

## Backlog de mejoras (post-lanzamiento, pedidas por el usuario)

> Anotadas el 2026-08-14 durante el estreno en producción. Se encaran como tandas nuevas cuando el usuario lo pida, con el protocolo de siempre.

1. **Aceptación de invitaciones familiares** — hoy quien otorga acceso consiente explícitamente (Ley 25.326, tarea 12.1) pero a la contraparte el perfil le aparece sin aceptar. Mejora: invitación PENDIENTE con notificación ("X quiere darte acceso, nivel: ver"), estados aceptada/rechazada, y nada visible hasta aceptar. Tabla de invitaciones + pantalla + push.
2. **"Temas para la consulta" (notas por turno)** — sugerencia de un conocido del usuario: lista viva de ítems colgada de cada turno ("preguntarle por la pastilla X", "contarle de la alergia"), carga en dos toques desde el detalle o la card del próximo turno, vista destacada el día de la consulta con checkboxes para tachar en vivo, e integración con la Ficha para el médico (los ítems reales del usuario se combinan con las preguntas sugeridas por la IA). Los campos de notas actuales (preparation_notes, notes) quedan como están: esto es una entidad propia (ítems, no texto libre).
3. **SMTP propio para los mails de Auth** — Supabase no permite personalizar remitente/asunto/cuerpo sin SMTP custom. Opción costo-cero: Brevo (300/día gratis). El usuario carga las credenciales SMTP + "Sender name: Historial Médico"; después se redactan los templates en castellano (contenido, lo puede hacer el orquestador vía dashboard).
4. **Cerrar o limitar el registro público** — decisión pendiente del usuario (mitigación de abuso de cuota Gemini; docs/checklist-produccion.md ítem 7).

## Protocolo de Auditoría y Checkpoints

### Cómo funciona

1. **Una tarea por vez.** Fable delega la siguiente tarea pendiente al modelo indicado en su heading. No se abren dos tareas en paralelo salvo que sean explícitamente independientes y Fable lo autorice.
2. **El ejecutor entrega código completo.** Sin placeholders, sin `// resto del código acá`, sin funciones vacías "para completar después".
3. **Resumen de Entrega obligatorio.** Al terminar, el ejecutor produce el resumen con el formato exacto de abajo.
4. **Auditoría de Fable.** Fable verifica el criterio de aceptación, revisa los archivos tocados y confirma que no haya desvíos silenciosos (charset, RLS faltante, secretos filtrados, deploy no solicitado).
5. **Sin aprobación explícita no se avanza.** Si la auditoría encuentra problemas, la tarea vuelve al ejecutor con observaciones numeradas.
6. **Checkpoint de sprint.** Al cerrar cada sprint hay una **demo verificable en local**; recién con la demo aprobada se abre el sprint siguiente.

### Formato exacto del Resumen de Entrega

```
## Resumen de Entrega — Sprint N · [Modelo] - Título de la tarea

**1. Qué se hizo**
- Punto por punto, en pasado, lo que quedó implementado.

**2. Archivos tocados**
| Archivo (ruta absoluta) | Acción | Motivo |
|---|---|---|
| ... | creado / modificado / eliminado | ... |

**3. Cómo verificarlo**
- Comandos exactos a correr (con el resultado esperado).
- Pasos manuales en el navegador, con la URL local y lo que se debe ver.
- Consultas SQL de verificación, si aplica.

**4. Criterio de aceptación**
- [ ] Enunciado del criterio → resultado obtenido (evidencia concreta).

**5. Desvíos respecto del plan**
- Ninguno, o la lista de desvíos con su justificación técnica.

**6. Deuda o riesgos abiertos**
- Lo que quedó pendiente y por qué; vacío si no hay.

**7. Confirmaciones transversales**
- [ ] Archivos en UTF-8 sin BOM.
- [ ] No se deployó nada a producción.
- [ ] RLS verificada en las tablas tocadas (o N/A).
- [ ] Sin secretos ni claves en el código versionado.
- [ ] Código completo, sin placeholders.
```

### Formato del checkpoint de sprint

```
## Checkpoint Sprint N — Demo local

**Guion de demo:** pasos numerados que Fable puede reproducir en su máquina.
**Estado de tareas:** tabla tarea → aprobada / observada / pendiente.
**Riesgos abiertos:** los que se arrastran al sprint siguiente.
**Decisión de Fable:** APROBADO / APROBADO CON OBSERVACIONES / RECHAZADO (+ motivo).
```

---

## Reglas transversales

### Senior UX (adultos mayores)

- **Tipografía base mínima 18px**, títulos hasta 32px, interlineado holgado y textos sin jerga médica innecesaria.
- **Touch targets mínimos 48×48px** con separación suficiente para evitar toques accidentales.
- **Contraste WCAG AA**: 4.5:1 en texto normal, 3:1 en texto grande y en componentes de interfaz. El color nunca es la única señal: siempre acompaña texto o forma.
- **Bottom nav fija** con cuatro accesos: Inicio/SOS, Estudios, Turnos, Perfil/Familia. Íconos siempre con etiqueta de texto.
- **Web Speech API** para dictado por voz en buscadores y campos de texto, en `es-AR`, con degradación limpia si no hay soporte y permiso pedido con gesto del usuario.
- Confirmación explícita en toda acción destructiva; mensajes de error en lenguaje humano; nada de scroll infinito sin control ni de flujos multi-paso sin guardar estado.

### UTF-8 en todo

- Todos los archivos fuente en **UTF-8 sin BOM**; `<meta charset="utf-8">`; base Postgres en UTF-8; exportaciones (CSV, `.ics`, JSON) en UTF-8.
- En PowerShell, nunca `Out-File`/`Set-Content` sin encoding explícito: preferir la herramienta de escritura del agente o `[System.IO.File]::WriteAllText` con `UTF8Encoding($false)`.
- La auditoría de charset se corre al cerrar cada sprint, no solo al principio.

### Local-first y no-deploy

- **Todo se desarrolla y prueba en local.** No se sube nada a Vercel ni a ningún hosting sin pedido explícito del usuario.
- "Listo", "terminé", "funciona", "está confirmado" significan que el cambio está cerrado en local, **no** que se deploya.
- No se preparan listas de archivos para subir, ni se corren checklists de pre-deploy, ni se sugiere publicar por iniciativa propia. El Sprint 12 permanece bloqueado hasta que el usuario lo desbloquee con palabras explícitas.

### Código completo

- Cada entrega incluye el archivo completo y funcional. Nada de fragmentos con "acá va el resto", funciones sin cuerpo o TODOs que oculten trabajo no hecho.
- Si algo queda pendiente a propósito, va declarado en el punto 6 del Resumen de Entrega, no escondido en un comentario.
- Los manifests (`package.json`, `engines`) declaran el **target real de producción**, aunque eso incomode a la máquina local.

### Seguridad, RLS y Storage

- **RLS habilitada en todas las tablas**, sin excepción, modelada alrededor de `family_permissions`.
- **Buckets privados**: documentos médicos y credenciales solo se sirven por **signed URLs** de vida corta generadas en el servidor. En la base se guarda el **path**, nunca una URL pública.
- `SERVICE_ROLE_KEY` jamás llega al cliente ni al bundle. Toda escritura pasa por Server Actions o Route Handlers que validan sesión y permiso del lado del servidor.
- `access_logs` es **append-only** y registra accesos a datos sensibles.
- IDs con `gen_random_uuid()` (pgcrypto). Nada de `uuid_generate_v4()`.
- `profiles.user_id` es **nullable a propósito**, para perfiles gestionados sin cuenta propia; está documentado en la base y en `docs/modelo-permisos.md`.

### Stack fijado (agosto 2026)

- Next.js **16.3** (App Router, Server Actions, Turbopack) + React **19** + TypeScript.
- Tailwind CSS **v4.3** con configuración CSS-first (`@import "tailwindcss"` + `@theme`), shadcn/ui compatible con v4, Lucide React.
- Supabase con **`@supabase/ssr` + `@supabase/supabase-js`**. `@supabase/auth-helpers-nextjs` está deprecado y **no se usa ni se mezcla**.
- Gemini con **`@google/genai`** (pinneado a `<3.0.0` si el runtime no es Node 22+) y modelo **`gemini-3.5-flash-lite`** por defecto, `gemini-3.5-flash-lite` como variante barata, siempre leído desde `GEMINI_MODEL_ID`. **`@google/generative-ai` y `gemini-1.5-flash` están retirados: no aparecen en el código.**
- Structured output vía `generateContent` con `responseMimeType: "application/json"` + `responseSchema`, validado además con Zod del lado del servidor.

### Costo cero (regla dura del usuario, 2026-08-12)

- **El proyecto no debe generar ningún gasto** más allá del dominio ya pagado, al menos mientras sea de uso personal/familiar. Todo corre en capa gratuita: Vercel Hobby, Supabase Free (500 MB base / 1 GB storage / Edge Functions incluidas), Gemini API free tier (la key es de AI Studio sin billing; si aparece un 429 de cuota se informa al usuario, no se paga), Web Push vía FCM (gratis), deep links de Maps/Uber/DiDi/Cabify (son URLs, no APIs pagas).
- **Prohibido incorporar APIs o servicios pagos** sin pedido explícito del usuario: nada de Google Maps API (geocoding/places), SMS, email transaccional pago, etc. Para geocodificar direcciones de turnos (Sprint 6): entrada manual asistida o Nominatim/OpenStreetMap respetando su política de uso — decisión registrada.
- **Cuidados de capa gratuita**: Supabase Free pausa proyectos tras ~1 semana sin actividad (documentar cómo despertarlo); mantener las imágenes comprimidas (el compresor client-side del Sprint 4 también protege el límite de 1 GB); si el uso se masifica, el usuario decidirá qué plan pagar.

### Neutralidad geográfica (regla dura del usuario, 2026-08-28)

- **La app funciona en todo el mundo: ninguna lógica se condiciona por ciudad, provincia o país.** Pedido textual del dueño: *"no te concentres en Ushuaia, la idea es que esta app funcione en todo el mundo, donde se quiera utilizar."*
- Los textos siguen en castellano rioplatense (decisión de producto, no de lógica) y las fuentes de datos regionales que ya existen (catálogo REFES, el formato `dd/mm/aaaa` que el prompt de turnos le explica al modelo) son DATOS y EJEMPLOS, nunca supuestos del código.
- Caso ya cazado por la regla: `linkComoLlegar` le pegaba `", Argentina"` a toda dirección para armar el enlace de "Cómo llegar" — una dirección de Madrid terminaba buscándose en otro continente. Se sacó (`c07a64f`, 2026-08-28); el enlace se manda tal como se cargó la dirección. Mismo commit: los tres atajos fijos de apps de viaje (Uber, DiDi, Cabify) se redujeron al único cuyo enlace es una URL HTTPS común (no un esquema `app://` que no abre nada donde la app no está instalada), sin filtrar por ciudad.
- Antes de escribir lógica nueva que dependa de ciudad/provincia/país, revisar si hace falta de verdad — el criterio es del mismo nivel que "nada específico de un laboratorio": nada específico de una geografía. Deuda declarada bajo esta regla: `ZONA_HORARIA_TURNOS` sigue clavada en Ushuaia (ver `docs/estado-proyecto.md` § Deudas conocidas).

### Ley 25.326 (Protección de Datos Personales, Argentina)

- Los datos de salud son **datos sensibles**: requieren consentimiento libre, expreso e informado, y su tratamiento debe limitarse a la finalidad declarada.
- **Minimización de acceso**: los permisos familiares arrancan en solo lectura; el contexto que se envía a la IA excluye identificadores innecesarios (documento, dirección, teléfono, email).
- **Trazabilidad**: todo acceso a datos de salud de un tercero queda registrado en `access_logs` y es consultable por el titular del perfil.
- **Derechos del titular**: acceso, rectificación y supresión contemplados en producto (exportación de datos y baja de perfil) y explicados en la Política de Privacidad.
- Las páginas legales y el consentimiento son requisito de salida del Sprint 12; no se publica el sitio sin ellas.