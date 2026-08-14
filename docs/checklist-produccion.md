# Checklist de seguridad y privacidad previa a producción — Historial Médico

> **Qué es este documento.** El cierre de la tarea 12.2 del Sprint 12
> (`ROADMAP_SPRINTS.md` líneas 748-754): la revisión final **antes de publicar**,
> con foco en el **contrato de deploy** (`docs/deploy-instrucciones.md`) y en la
> frontera entre lo que vive en el repositorio y lo que vive solo en el servidor
> de producción.
>
> **Relación con la auditoría 11.4.** Esta revisión **no repite** la auditoría de
> RLS y Storage de [`docs/auditoria-seguridad.md`](./auditoria-seguridad.md) —la
> **complementa**. Aquella demostró, con 280 casos automatizados, que el modelo de
> permisos decide bien contra el motor y la API reales. Esta se para un paso más
> arriba: verifica que **al empaquetar y desplegar** ninguna clave de producción
> viaje en el repo, que los secretos no estén hardcodeados, que los logs no
> filtren contexto clínico, y deja explícitos los ítems que **solo se pueden
> cerrar contra la base remota después del `db push`** (marcados como
> *verificación post-deploy*).
>
> **Fecha:** 2026-08-14 · **Base local:** PostgreSQL 17.6 (contenedor
> `supabase_db_historialclinico`, 18 migraciones + seed) · **App:** Next.js 16.
> **Alcance:** análisis del repositorio y de la base **local**. No toca secretos
> de producción ni el proyecto cloud (eso lo hace el usuario en el deploy, por la
> regla de seguridad de `docs/deploy-instrucciones.md`).

---

## Resumen

| # | Ítem | Estado |
|---|---|---|
| 1 | Variables de entorno: prod separadas de local | **OK** + 1 recomendación menor |
| 2 | Secretos hardcodeados en `app/` `components/` `lib/` | **OK** — 0 secretos |
| 3 | RLS en la base (criterio del roadmap) | **OK** en local · **verificación post-deploy pendiente** en remoto |
| 4 | Buckets privados + signed URLs con TTL corto | **OK** — los 4 privados |
| 5 | Logs sin datos clínicos ni payload de Gemini | **OK** + 1 observación menor |
| 6 | Política de retención y borrado | Ver [`docs/retencion-datos.md`](./retencion-datos.md) — **con gaps** |
| 7 | Superficie post-deploy: registro público abierto | **PENDIENTE DEL USUARIO** (decisión) |
| 8 | `CRON_SECRET` y endpoints de cron | **OK** — comparación en tiempo constante |

Ningún hallazgo crítico: **no se encontró ninguna clave de producción en el
repositorio.** Los puntos abiertos son (a) una decisión de negocio del usuario
—cerrar o no el registro público (ítem 7)—, (b) gaps de la política de retención
documentados en [`docs/retencion-datos.md`](./retencion-datos.md) (ítem 6), y (c)
dos recomendaciones menores de defensa en profundidad (ítems 1 y 5).

---

## 1. Variables de entorno: producción separada de local — **OK**

**Criterio.** Ninguna clave de producción en el repo; las claves cloud entran a
producción por el panel de Vercel, nunca por un archivo que Next auto-cargue
(`docs/entorno.md` §"Capas de variables de entorno").

**Evidencia — archivos `.env` rastreados por git:**

```
$ git ls-files | grep -iE "\.env"
.env.example
```

Solo aparece la plantilla versionada. Sus únicos valores no vacíos son públicos:

```
$ git show HEAD:.env.example | grep -nE "^[A-Z_]+=.+"
16:NEXT_PUBLIC_SUPABASE_URL=https://nbypcqhojmixlxvkflrp.supabase.co
33:GEMINI_MODEL_ID=gemini-3.5-flash-lite
49:VAPID_SUBJECT=mailto:contacto@historialmedico.com.ar
```

- `NEXT_PUBLIC_SUPABASE_URL` es **pública por diseño**: viaja en el bundle del
  navegador y en cada request. No es un secreto (lo confirma también la
  auditoría 11.4 §5.3).
- `GEMINI_MODEL_ID` es un nombre de modelo; `VAPID_SUBJECT` es un `mailto:` del
  estándar VAPID. Ninguno es secreto.
- El resto de las claves (anon key, `SUPABASE_SERVICE_ROLE_KEY`,
  `GEMINI_API_KEY`, VAPID pública/privada, `CRON_SECRET`) son **placeholders
  vacíos** en la plantilla.

**Evidencia — el respaldo de claves cloud nunca estuvo en git:**

```
$ git check-ignore -v .env.cloud-respaldo
.gitignore:34:.env*    .env.cloud-respaldo

$ git log --all --oneline -- .env.cloud-respaldo
(vacío — el archivo nunca fue rastreado en ninguna rama)
```

`.env.cloud-respaldo` —el único archivo con las claves del Supabase **cloud** de
producción (`docs/deploy-instrucciones.md` lo usa como fuente para pegar en
Vercel)— está cubierto por la regla `.env*` de `.gitignore` (con la excepción
`!.env.example`) y **jamás fue commiteado**. En disco conviven, todos
git-ignoreados: `.env.cloud-respaldo`, `.env.development.local`, `.env.local`; el
único versionado es `.env.example`. El esquema de capas (`docs/entorno.md`) es el
que corrigió el incidente 8.4, donde `.env.local` apuntaba a la nube real.

**Recomendación menor (defensa en profundidad).** El deny-list del proyecto
(`.claude/settings.json`) enumera `Read/Edit/Write` sobre `.env`, `.env.local`,
`.env.*.local`, `.env.development`, `.env.production`, pero **no nombra
`.env.cloud-respaldo`** ni un glob que lo cubra —y ese es justamente el archivo
que concentra **todas** las claves cloud—. Empíricamente hay una regla más amplia
en efecto (el intento de leer `.env.example` fue bloqueado pese a no coincidir con
ningún glob del proyecto), así que la protección hoy existe; pero conviene hacerla
**explícita a nivel de proyecto** para no depender de una regla externa: agregar
`Read(./.env.cloud-respaldo)` (o un `Read(./.env.*)` con la excepción de
`.env.example`) al `deny`. No es un hallazgo de fuga —el archivo está fuera de
git— sino un endurecimiento del propio arnés de trabajo.

---

## 2. Secretos hardcodeados — **OK (0 secretos)**

**Criterio.** Ningún JWT (`eyJ…`), clave `service_role`, API key de Gemini
(`AIza…`), ni secreto `sb_secret_` embebido en el código de aplicación. Los
únicos JWT del árbol tienen que ser las **claves demo públicas del CLI de
Supabase** (conocidas, solo válidas contra el stack local).

**Evidencia — `service_role` fuera del cliente:**

```
$ grep -rn "SERVICE_ROLE" components/
(0 coincidencias)
```

En `app/` las únicas coincidencias son (a) comentarios explicativos y (b) lecturas
de `process.env.SUPABASE_SERVICE_ROLE_KEY` dentro de Route Handlers **server-only**
(`app/api/push/procesar-recordatorios`, `.../procesar-alertas-medicacion`, con
`export const runtime = "nodejs"`). Ningún componente cliente la referencia.

**Evidencia — patrones de secreto en el código de aplicación:**

```
$ grep -rn -E "eyJ[A-Za-z0-9_-]{15,}|sb_secret_|AIza[A-Za-z0-9_-]{10,}" app/ components/ lib/
(0 coincidencias)
```

Cero claves embebidas en `app/`, `components/` y `lib/`.

**Evidencia — dónde viven los JWT del árbol (justificado):**

```
$ git grep -n -I "eyJ[A-Za-z0-9_-]{15,}" -- ':!node_modules' ':!.next'
package-lock.json:8013:  "integrity": "sha512-V7Qr52...==",           ← falso positivo
scripts/separar-claves-cloud.mjs:24: "eyJhbGciOiJIUzI1NiI...role":"anon"...
scripts/separar-claves-cloud.mjs:26: "eyJhbGciOiJIUzI1NiI...role":"service_role"...
```

- `package-lock.json:8013` es un **hash de integridad** `sha512-…==` en base64 que
  casualmente contiene la subcadena `eyJ`; **no es un JWT**.
- Los dos JWT reales viven en `scripts/separar-claves-cloud.mjs`. Sus payloads
  decodifican a `{"iss":"supabase-demo","role":"anon"}` y
  `{"iss":"supabase-demo","role":"service_role"}`: son las **claves demo del CLI
  de Supabase**, idénticas en cualquier máquina que corre `supabase start`, de
  conocimiento público y **solo válidas contra el stack local**. No son
  credenciales de producción. Es el mismo hallazgo (no-hallazgo) que la auditoría
  11.4 §5.3.

La auditoría 11.4 §5.2 ya verificó, además, que tras `npx next build` **ni el
valor ni el nombre** de `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
`VAPID_PRIVATE_KEY` ni `CRON_SECRET` aparecen en los 55 archivos JS del bundle
del cliente.

---

## 3. RLS en la base — **OK en local; verificación post-deploy pendiente**

**Criterio del roadmap (línea 753).** `select tablename from pg_tables where
schemaname='public' and rowsecurity=false` debe devolver **vacío**.

**Evidencia — base local (18 migraciones + seed):**

```
$ docker exec supabase_db_historialclinico psql -U postgres -d postgres \
    -c "select tablename from pg_tables where schemaname='public' and rowsecurity=false;"
 tablename
-----------
(0 rows)

$ ... "select count(*) as tablas, count(*) filter (where rowsecurity) as con_rls
        from pg_tables where schemaname='public';"
 tablas | con_rls
--------+---------
   20   |   20
```

Las 20 tablas de `public` tienen RLS habilitada; ninguna queda sin proteger. (Son
20 y no las 19 de la auditoría 11.4: la migración `20260814130000_consents.sql` de
la tarea 12.1 agregó la tabla `consents`, también con RLS y `revoke all` a
`anon, authenticated`.) Además, `anon` no tiene ni un `SELECT` sobre el dominio:

```
$ ... "select count(*) from information_schema.role_table_grants
        where table_schema='public' and grantee='anon';"
 0
```

> ### ⚠️ Verificación post-deploy (obligatoria — para el smoke, tarea 12.6)
>
> El criterio del roadmap habla de la **base remota**. La base local está limpia,
> pero el `db push` aplica las migraciones a un proyecto cloud que **hoy está
> vacío** (`docs/deploy-instrucciones.md` Paso 1). **Después del `db push` hay que
> correr el MISMO check contra la base de producción** y confirmar 0 filas:
>
> ```sql
> -- En Dashboard → SQL Editor del proyecto cloud, tras el db push:
> select tablename from pg_tables where schemaname='public' and rowsecurity=false;
> -- Debe devolver 0 filas.
> ```
>
> `supabase db push` aplica el mismo SQL versionado, así que el resultado debería
> ser idéntico; pero el criterio de aceptación exige la comprobación contra el
> remoto, no se da por sentada. Queda anotado como ítem del smoke post-deploy.

---

## 4. Buckets privados y signed URLs — **OK**

**Criterio.** Los 4 buckets privados; el acceso a archivos, exclusivamente por
signed URL de vida corta emitida en el servidor.

**Evidencia — base local:**

```
$ docker exec supabase_db_historialclinico psql -U postgres -d postgres \
    -c "select id, public, file_size_limit from storage.buckets order by id;"
           id           | public | file_size_limit
------------------------+--------+-----------------
 avatares               | f      |         2097152
 compartidos-temp       | f      |        26214400
 credenciales-cobertura | f      |         5242880
 documentos-medicos     | f      |         26214400
(4 rows)

$ ... "select count(*) from storage.buckets where public;"
 0
```

Los cuatro con `public = f`. Se crean en:
`supabase/migrations/20260812230000_storage.sql` (los tres del producto:
`documentos-medicos`, `credenciales-cobertura`, `avatares`) y
`supabase/migrations/20260814100000_share_target_temporal.sql`
(`compartidos-temp`, sin ninguna política de `storage.objects` → negación por
defecto para el cliente; solo `service_role` lo toca).

**Signed URLs con TTL corto.** `lib/storage-admin.ts` acota la vida de la firma
**en el código**, no en cada llamador:

```
TTL_MINIMO_SEGUNDOS = 1
TTL_DEFAULT_SEGUNDOS = 60
TTL_MAXIMO_SEGUNDOS = 300
```

`crearSignedUrl()` **lanza** si le piden un valor fuera de `[1, 300]`, así que
ningún llamador puede emitir una URL de una hora aunque se equivoque. El techo de
300 s es la única ventana de exposición posterior a revocar un permiso (una URL ya
firmada sigue sirviendo el archivo hasta que expira, sin reconsultar la base). El
endpoint estable de bytes `app/api/credenciales/[id]/imagen/route.ts` sirve con
`Cache-Control: private, no-cache` y `X-Content-Type-Options: nosniff`, y hace la
verificación de permiso (leer la fila con el cliente del usuario → RLS decide)
**antes** de bajar el objeto con `service_role`. Todo esto verificado en detalle
por la auditoría 11.4 §2.4.

---

## 5. Logs sin datos sensibles — **OK**

**Criterio (contrato de 10.2 / 10.3).** Ningún `console.*` debe volcar contexto
clínico ni el payload que se manda a Gemini (`docs/minimizacion-datos.md` §6: el
contexto es efímero y no se persiste, cachea ni loguea).

**Evidencia — `lib/gemini/` no loguea nada:**

```
$ grep -rn -E "console\.(log|error|warn|info|debug)" lib/gemini/
(0 coincidencias)
```

El cliente de Gemini y el armado del prompt **no tienen una sola sentencia
`console`**: el prompt (que sí lleva `JSON.stringify(contexto)` dentro, en
`lib/gemini/prompt-ficha.ts`) nunca se imprime.

**Evidencia — el Route Handler de ficha no filtra el contexto:**

`app/api/ficha/generar/route.ts` lo declara en su encabezado (líneas 35-45: *"En
NINGÚN `console.error` de acá aparece `contexto`, ni siquiera parcialmente"*) y el
código lo cumple: los `console.error` de `respuestaDeErrorGemini` logean solo
`error.message` de las excepciones tipadas (**estado** de la llamada: timeout,
parse, config, HTTP status) y `FichaInvalidaError.errores` (**estructura** de la
respuesta rechazada, no su contenido). El único `console.log` (línea 215) imprime
el **id** de la ficha persistida (un uuid), no su contenido.

**Evidencia — la lectura del contexto solo loguea el id del perfil y el error de
DB:**

`lib/ficha/contexto.ts` (líneas 164-181): seis `console.error` que, ante un fallo
de lectura, imprimen `perfilId` (un uuid) y el objeto de error de PostgREST
(`message`/`code`/`hint`/`details` del error de base, **no** las filas de datos).
Ninguno vuelca el `ContextoClinico`.

**Observación menor (no bloqueante).** El barrido de recordatorios
(`app/api/push/procesar-recordatorios/route.ts:259`) emite un `console.info` con
`payload.titulo` y la cantidad de destinatarios. El título de una notificación de
turno puede incluir la **especialidad** (p. ej. "Cardiología"), que es un dato de
salud de bajo grado. No es contexto clínico ni identificatorio directo, y es
funcional para depurar la entrega push, pero se anota por completitud: si se
quisiera un log estéril, bastaría con logear solo `turno=<uuid>` y los contadores,
sin el título. Fuera del alcance estricto del contrato de 10.2/10.3 (que es sobre
Gemini), por eso queda como observación y no como acción.

---

## 6. Política de retención y borrado — ver documento dedicado

La política de retención y el circuito de baja (Ley 25.326, derecho de supresión,
arts. 14-16) están en **[`docs/retencion-datos.md`](./retencion-datos.md)**. Ese
documento detalla, sobre el esquema real: qué se guarda y por cuánto, los
`ON DELETE CASCADE`, la cola `storage_purge_queue`, el área temporal de
compartidos y su purga, y el circuito de baja de cuenta. **Declara cuatro gaps**
—entre otros, la ausencia de un "borrar mi cuenta / mi perfil" self-service en la
UI pese a que la Política de Privacidad lo insinúa, y que borrar una cuenta **no**
cascadea a los perfiles gestionados (`user_id IS NULL`)— con severidad y
recomendación cada uno.

---

## 7. Superficie post-deploy: registro público abierto — **DECISIÓN PENDIENTE DEL USUARIO**

**El riesgo.** El registro es **completamente abierto**. `registrarse()`
(`app/(auth)/actions.ts:122`) llama a `supabase.auth.signUp` sin código de
invitación, sin allowlist de correos y sin restricción de dominio: valida nombre,
email, contraseña ≥ largo mínimo y el checkbox de consentimiento (Ley 25.326), y
crea la cuenta. `/registro` está en `RUTAS_PUBLICAS` (auditoría 11.4 §7). Una vez
registrado, con un perfil creado, el usuario puede **consumir la cuota de Gemini**
por las dos vías de IA del proyecto: extracción de documentos
(`/api/documentos/extraer`) y generación de ficha (`/api/ficha/generar`).

En producción, con el sitio publicado en `historialmedico.com.ar`, esto significa
que **cualquier desconocido puede crearse una cuenta y gastar la cuota de la API
de Gemini** (que es la del titular del proyecto, con costo/límite reales). Es un
vector de abuso de recurso, no de fuga de datos: cada cuenta solo ve sus propios
datos (RLS), pero el gasto de cuota es compartido.

Este riesgo **ya lo anticipó el orquestador** en
`docs/deploy-instrucciones.md` (línea 73: *"cerrar el registro público … para que
un desconocido no pueda … gastar la cuota de Gemini"*). Se documenta acá como la
decisión formal pendiente.

**Mitigaciones posibles (a decidir por el usuario — NO implementadas en esta
tarea):**

1. **Cerrar el registro** (el proyecto es de uso personal/familiar). Quitar
   `/registro` de `RUTAS_PUBLICAS`, o hacer que la Server Action `registrarse`
   rechace todo salvo una allowlist de correos definida por env var. Es lo más
   simple y el uso previsto (una familia) lo tolera.
2. **Allowlist / invitación.** Un código de invitación o una lista de dominios de
   correo permitidos, validado en `registrarse` **del lado servidor** (no solo en
   el form), igual que hoy se revalida `aceptaLegales`.
3. **Confirmación de email obligatoria + rate-limit.** Exigir verificación de
   correo (Supabase Auth ya la soporta; el código ya contempla el caso
   `!data.session`) antes de permitir cualquier llamada a Gemini, y sumar un
   límite por cuenta/día a los dos endpoints de IA.

**Recomendación.** Para un producto de uso familiar, la opción 1 o 2 es la
adecuada y la de menor superficie. **Queda como decisión del usuario**; el
orquestador ya la dejó pactada para "después del deploy"
(`docs/deploy-instrucciones.md`, sección final).

---

## 8. `CRON_SECRET` y endpoints de cron — **OK (comparación en tiempo constante)**

**Criterio.** Los dos endpoints de barrido comparan el secreto en **tiempo
constante** (`timingSafeEqual`) y, sin el header, responden 401.

**Evidencia — código (idéntico en los dos endpoints):**

`app/api/push/procesar-recordatorios/route.ts` (tarea 6.4) y
`app/api/push/procesar-alertas-medicacion/route.ts` (tarea 7.4):

```ts
import { createHash, timingSafeEqual } from "node:crypto"

function secretoCoincide(recibido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recibido).digest()   // 32 bytes fijos
  const b = createHash("sha256").update(esperado).digest()
  return timingSafeEqual(a, b)                                // tiempo constante
}

export async function POST(request: Request) {
  const esperado = process.env.CRON_SECRET
  if (!esperado) {
    // Sin la variable, el barrido NO queda abierto: responde 503 y no hace nada.
    return json({ error: "… no está configurado." }, 503)
  }
  const recibido = request.headers.get("x-cron-secret")
  if (!recibido || !secretoCoincide(recibido, esperado)) {
    return json({ error: "No autorizado" }, 401)
  }
  …
}
```

- Se comparan los **digests SHA-256** (siempre 32 bytes) porque `timingSafeEqual`
  exige buffers de igual largo —y tirar por longitud distinta ya filtraría
  información—; esto iguala las longitudes sin ramas dependientes del secreto.
- **Sin `CRON_SECRET` en el entorno → 503** (un despliegue al que le falta la
  variable se ve roto, no abierto). **Sin header o con secreto incorrecto → 401.**
- El endpoint no expone datos ni acepta parámetros: no se le puede pedir "mandale
  una notificación a fulano" (encabezados de ambos archivos).

La auditoría 11.4 §7 ("Rutas públicas") ya probó **en vivo** la matriz: sin
header → 401, con secreto adivinado → 401, con sesión válida y sin header → 401,
para los dos endpoints. Los jobs de `pg_cron` que los invocan se configuran en el
deploy (`docs/deploy-instrucciones.md` Paso 4) pasando el secreto por Vault.

> **Verificación post-deploy.** Confirmar en el proyecto cloud, tras el Paso 4,
> que `select * from cron.job` lista `recordatorios-turnos` y
> `alertas-medicacion` (en local: `recordatorios-turnos */15`,
> `alertas-medicacion 10 12,21`, `generar-tomas-del-dia 5 3`), y que un POST sin
> `x-cron-secret` contra los endpoints de producción responde 401.

---

## Anexo — comandos corridos

Todos contra la base local (contenedor `supabase_db_historialclinico`, Docker
29.7.2, con `PATH` a `/c/Program Files/Docker/Docker/resources/bin`) y el árbol
del repositorio. Reproducibles:

```bash
# Ítem 1 — env
git ls-files | grep -iE "\.env"
git check-ignore -v .env.cloud-respaldo
git log --all --oneline -- .env.cloud-respaldo
git show HEAD:.env.example | grep -nE "^[A-Z_]+=.+"

# Ítem 2 — secretos
grep -rn "SERVICE_ROLE" components/
grep -rn -E "eyJ[A-Za-z0-9_-]{15,}|sb_secret_|AIza[A-Za-z0-9_-]{10,}" app/ components/ lib/
git grep -n -I "eyJ[A-Za-z0-9_-]{15,}" -- ':!node_modules' ':!.next'

# Ítem 3 — RLS
docker exec supabase_db_historialclinico psql -U postgres -d postgres \
  -c "select tablename from pg_tables where schemaname='public' and rowsecurity=false;"

# Ítem 4 — buckets
docker exec supabase_db_historialclinico psql -U postgres -d postgres \
  -c "select id, public from storage.buckets order by id;"

# Ítem 5 — logs
grep -rn -E "console\.(log|error|warn|info|debug)" lib/gemini/ lib/ficha/ app/api/ficha/

# Ítem 8 — cron (jobs en local)
docker exec supabase_db_historialclinico psql -U postgres -d postgres \
  -c "select jobname, schedule from cron.job order by jobname;"
```

**Suites de no-regresión** (esta tarea es auditoría: no se modificó código de la
aplicación, solo se crearon dos `.md`):

```
$ npx vitest run     → 739 passed (43 archivos)   ✅ exit 0
$ npx tsc --noEmit   → exit 0                       ✅
```
