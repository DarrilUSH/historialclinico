# Cómo mudar "Historial Médico" a otra máquina Windows

> **Qué es este documento.** La guía para llevar este proyecto a otra notebook sin perder nada — ni código, ni configuración, ni la memoria de las sesiones de Claude Code. Está pensada para vos, no para un programador: cada paso dice qué hacer y por qué.
>
> **Censo verificado el 2026-08-21** con `git status --ignored --short` y `git ls-files --others --ignored --exclude-standard` sobre el árbol real del proyecto. Si en el futuro este censo no coincide con lo que ves al correr esos mismos comandos, confiá en el comando — este documento puede haberse desactualizado, esos dos comandos nunca mienten.

---

## Antes de arrancar: la idea general

Git se lleva el código solo. Pero un proyecto real tiene tres capas:

1. **Lo que vive en git** → viaja clonando el repo. Cero trabajo extra.
2. **Lo que está en tu disco pero git ignora a propósito** (claves, configuración local) → hay que copiarlo A MANO, archivo por archivo. Es la parte que este documento existe para no olvidar.
3. **Lo que no es un archivo sino una sesión iniciada** (tu login de Supabase, Docker instalado, ADB autorizado) → hay que rehacerlo en la máquina nueva, no se copia.

Las secciones (a), (b) y (c) de abajo son exactamente esas tres capas.

---

## a) Lo que viaja solo con git

Cloná el repo (es público) o copiá la carpeta completa — cualquiera de las dos formas te da lo mismo, porque todo esto está trackeado:

```powershell
git clone https://github.com/DarrilUSH/historialclinico.git
```

Esto incluye: todo `app/`, `components/`, `lib/`, `hooks/`, `types/`, `scripts/`, `supabase/migrations/` (las 39 migraciones), `supabase/config.toml`, `supabase/seed.sql`, todo `docs/` (incluido este archivo), `ROADMAP_SPRINTS.md`, `TOOLING.md`, los prompts `01_`/`02_`, `tests/`, `README.md`, `package.json` + `package-lock.json`, `.env.example` (la plantilla sin secretos), `.gitignore`, `.gitattributes`, y `.claude/launch.json` + `.claude/settings.json` + `.claude/skills/` (las deny-rules que protegen los `.env*` de lectura accidental por un agente **también viajan solas**, están en `.claude/settings.json`, que SÍ está trackeado).

---

## b) Lo que NO viaja y hay que llevar a mano

Esto es el censo real — lo que `git status --ignored` y `git ls-files --others --ignored --exclude-standard` encuentran hoy, filtrando lo que es basura regenerable (`node_modules/`, `.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts`, `.playwright-mcp/` con capturas viejas de pruebas, `supabase/.temp/` y `supabase/.branches/` que arma `supabase start` solo):

### Las claves — lo más importante de este documento

| Archivo | Qué contiene (solo nombres de variable, nunca valores) | Gravedad |
|---|---|---|
| **`.env.local`** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `CRON_SECRET` | Alta — sin este archivo, `npm run dev` no arranca contra nada |
| **`.env.cloud-respaldo`** | Las mismas claves de arriba, pero con los valores de **PRODUCCIÓN** (el proyecto Supabase cloud `nbypcqhojmixlxvkflrp`, la API key de Gemini real, las VAPID de producción) | **CRÍTICA** — es la única copia fuera de Vercel de las claves con las que corre `historialmedico.com.ar`. Si se pierde este archivo sin haber guardado esas claves en otro lado (el propio Dashboard de Vercel/Supabase/Google/tu gestor de contraseñas), no hay forma de recuperarlas más que regenerarlas una por una |
| **`.env.development.local`** | Mismo tipo de variables, con los valores DEMO que genera `npx supabase start` en local (`SUPABASE_SERVICE_ROLE_KEY` local, etc.) — Next.js le da prioridad sobre `.env.local` en `next dev`, por eso existe separado | Baja — se regenera solo la primera vez que corrés `npx supabase start` (mirá `npx supabase status`) |
| **`.env.example`** | La plantilla comentada, SIN secretos — **esta SÍ viaja con git**, la menciono acá solo para que no la confundas con las tres de arriba | — |

Esta lista de nombres de variable salió de grepear `process.env\.` en el código fuente (`app/`, `lib/`, etc.), **no** de abrir los archivos `.env*` — este documento tiene prohibido leer o imprimir esos valores, y de hecho el propio sandbox de Claude Code se negó a correr un `grep`/`cat` sobre esos archivos aunque solo pidiera los nombres de las claves, porque `.claude/settings.json` (que viaja con git) tiene reglas `deny` explícitas sobre `Read`/`Edit`/`Write` de todo `.env*`. Esa protección la vas a tener también en la máquina nueva apenas clones el repo — es una buena noticia, no un obstáculo: significa que ningún agente de IA que trabaje en este proyecto, en ninguna máquina, puede leer esos archivos por accidente.

**Cómo copiarlos:** son 4 archivos de texto chicos (entre 1,5 KB y 2,8 KB cada uno) en la raíz del proyecto. Copialos vos mismo con el explorador de Windows, un pendrive, o subiéndolos a un lugar privado (jamás un repo, jamás un chat). Si preferís no arrastrar `.env.cloud-respaldo` como archivo, la alternativa es tener esas 10 claves guardadas en tu gestor de contraseñas y recrear el archivo a mano en la máquina nueva — más seguro, un poco más de tipeo.

### Configuración local de Claude Code (no crítica, pero conviene saber que existe)

- **`.claude/settings.local.json`** — gitignoreado. Hoy contiene permisos adicionales que le diste a Claude Code en esta máquina (algunos `WebFetch` para dominios de datos.gob.ar, un `Bash(docker exec *)`, etc.) — son comodidades de esta sesión, **no** reglas de seguridad (esas viven en `.claude/settings.json`, que sí viaja con git). Si no lo copiás, Claude Code te va a volver a pedir esos permisos la primera vez que los necesite en la máquina nueva. No hay nada sensible adentro; copialo solo si te molesta repetir esas confirmaciones.

### La carpeta de estudios médicos personales

- **`Estudios Dario Hernandez/`** (≈11 MB) — documentos médicos personales del dueño del proyecto. Está sin trackear a propósito y **así debe seguir**: jamás va a un commit. Si la querés en la máquina nueva, copiala a mano (pendrive, OneDrive privado, lo que prefieras) — este documento no toca ni lista su contenido.

### Lo que NO hace falta copiar (basura regenerable)

- `node_modules/` → lo repone `npm install`.
- `.next/`, `tsconfig.tsbuildinfo`, `next-env.d.ts` → los repone `npm run dev` / `npm run build` / `npx tsc`.
- `.playwright-mcp/` → capturas y logs sueltos de sesiones de prueba con el navegador (más de 300 archivos `.yml`/`.log`/`.png` acumulados desde el 13/8). Ninguno es necesario para retomar el trabajo.
- `supabase/.temp/` y `supabase/.branches/` → los arma `npx supabase start` cada vez que lo corrés.

---

## c) Lo que hay que REINSTALAR o RE-LOGUEAR en la máquina nueva

Esto no son archivos — son programas y sesiones que viven en la instalación de Windows, no en la carpeta del proyecto.

| Qué | Cómo | Nota |
|---|---|---|
| **Node.js** | Instalar la misma versión mayor que usás hoy (`node -v` → verificá qué te da; al momento de escribir esto, v24.14.0) o al menos ≥22.12.0 (piso documentado en `docs/entorno.md`) | Después: `npm install` en la raíz del proyecto |
| **Docker Desktop** | Instalador desde docker.com, reiniciar si lo pide | Hace falta para `npx supabase start` (la base de datos local corre en contenedores) |
| **Supabase CLI** | Ya viene como `devDependency` del proyecto (`npm install` alcanza) — pero la SESIÓN de la CLI no viaja | `npx supabase login` (abre el navegador, te logueás con tu cuenta) → `npx supabase link --project-ref nbypcqhojmixlxvkflrp` (te va a pedir la database password del proyecto cloud) |
| **Android platform-tools (ADB)** | Si vas a seguir probando en el Galaxy por USB | Instalación y receta completa en la skill `adb-mobile-testing` y en `docs/pruebas-dispositivo.md` — no hace falta repetirla acá |
| **Claude Code** | Instalar normalmente | Ver el punto siguiente para no perder la memoria de las sesiones |

### La memoria de Claude Code — el dato clave que es fácil pasar por alto

La memoria del asistente **no vive dentro de la carpeta del proyecto**. Vive en:

```
C:\Users\<tu-usuario>\.claude\projects\<carpeta-derivada-de-la-ruta>\
```

Hoy, con el proyecto en `F:\Proyectos\historialclinico`, esa carpeta es:

```
C:\Users\legistdf\.claude\projects\F--Proyectos-historialclinico\
```

**Cómo se deriva el nombre:** Claude Code toma la ruta completa de la carpeta del proyecto y reemplaza cada `:` y cada `\` por un `-`. `F:\Proyectos\historialclinico` tiene el patrón `F` + `:` + `\Proyectos` + `\historialclinico` → cada separador se vuelve un guion → `F--Proyectos-historialclinico` (el doble guion del principio sale de que el `:` y la `\` caen uno pegado al otro).

**Por qué importa:** si en la máquina nueva el proyecto queda en una ruta distinta (por ejemplo `C:\Proyectos\historialclinico` en vez de `F:\Proyectos\historialclinico`, o `C:\Users\OtroUsuario\...`), el nombre de esta carpeta **cambia**, aunque el contenido del proyecto sea idéntico. Claude Code no va a "encontrar" tu memoria vieja solo — tenés que copiarla vos a la carpeta con el nombre nuevo que le corresponda a la ruta nueva.

**Qué copiar:** la carpeta completa trae dos cosas distintas —

- `memory/` — los apuntes de memoria persistente (`MEMORY.md` + los archivos que indexa). Esto es lo liviano y lo que de verdad querés conservar.
- los archivos `*.jsonl` sueltos — son las transcripciones completas de cada sesión. Son pesados (la de esta sesión sola pesa más de 130 MB) y no son memoria activa, son historial crudo.

Si solo te interesa que el asistente recuerde el proyecto, alcanza con copiar la subcarpeta `memory\`. Si además querés poder consultar sesiones viejas completas, copiá la carpeta entera.

**Si no copiás nada:** no se pierde el trabajo — el asistente arranca sin memoria de sesiones anteriores, pero **lee `docs/estado-proyecto.md`** (que este mismo trabajo de documentación dejó al día al 2026-08-21) para reconstruir dónde quedó el proyecto. Por eso ese archivo existe y por eso se lo mantiene actualizado: es la red de seguridad para cuando la memoria no viaja.

### Lo que NO hace falta tocar

- **Vercel** — auto-deploy desde GitHub, cero estado que dependa de esta máquina. En cuanto la máquina nueva haga `git push` a `main`, Vercel deployea igual que siempre.
- **Google OAuth** (conexión Gmail) — la configuración vive en Google Cloud y en Supabase Vault (los refresh tokens), no en el disco.
- **El dominio** (`historialmedico.com.ar`) y los **cron jobs de producción** — viven en el DNS y en Supabase cloud respectivamente.

---

## d) Verificación de que la migración salió bien

Corré esto en orden, en la carpeta del proyecto ya clonado/copiado con los `.env*` ya pegados:

```powershell
# 1. Dependencias
npm install

# 2. Base de datos local (Docker Desktop tiene que estar corriendo)
npx supabase start

# 3. Aplicar las 39 migraciones + seed a la base local
npx supabase db reset

# 4. Suite de tests unitarios — esperado: 1870/1870
npm run test

# 5. Arnés de RLS — esperado: 551/551 PASS, corrido dos veces (debe dar
#    exactamente lo mismo las dos veces: confirma que el script es idempotente
#    y no deja basura en la base)
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres < scripts/test-rls.sql
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres < scripts/test-rls.sql

# 6. Levantar el servidor y abrir http://localhost:3000 a mano — tiene que
#    mostrar el login, no un error
npm run dev

# 7. Confirmar que local y remoto están sincronizados (requiere el login+link
#    del paso (c) ya hecho) — esperado: las 39 migraciones con local=remote
npx supabase migration list --linked
```

Extras que no son obligatorios pero que valen la pena si tenés tiempo: `bash scripts/test-storage-rls.sh` (esperado 27/27), `node scripts/verificar-contraste.mjs` (esperado 196/196 AA), `npx tsc --noEmit` y `npm run lint` (los dos sin salida = limpios), `npm run build` (build de producción completo).

Si el paso 5 no da 551/551, o el paso 7 muestra algún `local` sin su `remote` (o viceversa), pará ahí antes de seguir trabajando — algo de la migración quedó a medio hacer.

---

## e) Advertencias — leé esto antes de tocar nada en la máquina nueva

> ### ⚠️ Cuatro reglas que no perdonan
>
> 1. **Cada `git push` a `main` VA A PRODUCCIÓN.** Vercel hace auto-deploy desde GitHub sin pedir confirmación. No existe un ambiente de "staging" intermedio — `main` es prod.
> 2. **Las migraciones de base de datos NO viajan con el push del código.** Cada migración nueva en `supabase/migrations/` necesita que corras `npx supabase db push` a mano **ANTES** de pushear el código que la usa — si pusheás el código primero, la app en producción va a llamar a tablas/funciones que todavía no existen ahí.
> 3. **Jamás commitear `Estudios Dario Hernandez/` ni ningún `.env*` salvo `.env.example`.** El `.gitignore` ya los bloquea, pero si algún día lo tocás, revisá que esas reglas sigan ahí.
> 4. **Todo archivo nuevo en UTF-8 sin BOM.** Si generás archivos con PowerShell nativo (`Out-File`, `Set-Content`), fuerzan BOM por default y rompen parsers — usá `-Encoding utf8` como mínimo, o mejor, dejá que Claude Code escriba los archivos (ya lo hace en UTF-8 sin BOM).

---

## Resumen de una línea por sección

- **(a)** clonás y ya tenés el 95% del proyecto.
- **(b)** copiás a mano 4 archivos `.env*` chicos (uno de ellos crítico: `.env.cloud-respaldo`) + opcionalmente `.claude/settings.local.json` + opcionalmente `Estudios Dario Hernandez/`.
- **(c)** reinstalás Node/Docker/Supabase CLI/ADB, re-logueás Supabase CLI, y decidís si copiás la memoria de Claude Code (si no, `docs/estado-proyecto.md` hace de red de seguridad).
- **(d)** siete comandos, en orden, para confirmar que todo quedó igual que en la máquina vieja.
- **(e)** cuatro reglas para no romper producción por accidente en la máquina nueva.
