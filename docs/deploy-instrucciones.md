# Cómo terminar el deploy a producción — pasos que necesitan tus claves

> **Documento histórico (deploy inicial, Sprint 12, 2026-08-14).** Producción ya está viva desde entonces y estos 4 pasos ya se completaron — se conserva como referencia por si algún día hace falta rearmar el deploy desde cero (proyecto Supabase nuevo, Vercel nuevo, etc.). Para el uso del día a día de hoy en adelante, el flujo es mucho más corto: **cada migración nueva → `npx supabase db push` ANTES de pushear el código que la usa** (ver el recuadro de advertencias en `docs/migracion-maquina.md`). Las env vars de Vercel y el cron ya están configurados y no hace falta repetirlos salvo que rotes una clave.
>
> **Por qué estos pasos los hacía el usuario y no el asistente:** cargar API keys / tokens / secretos en un formulario (las env vars de Vercel, el login de Supabase, el `CRON_SECRET` del Vault) es exactamente lo que el límite de seguridad del asistente le impide hacer — es la regla que protege de que esas claves se filtren.
>
> **Dónde están los valores:** todas las claves cloud están en el archivo local `.env.cloud-respaldo`, en la raíz del proyecto (git-ignoreado, nunca se sube) — la ruta exacta depende de en qué carpeta tengas el proyecto en tu máquina. De ahí se copia y se pega.

---

## ✅ HOTFIX ya aplicado a producción (2026-08-14) — sección histórica

> **`supabase/migrations/20260814140000_alta_de_cuenta.sql`** — arreglaba el bug por el cual una cuenta recién registrada quedaba sin perfil ("Todavía no hay perfiles disponibles para tu cuenta") y sin consentimiento registrado. Se aplicó a producción el mismo 2026-08-14, junto con el resto de las migraciones que se sumaron después (38 en total al 2026-08-21, todas local=remoto). Se deja este párrafo como registro del incidente, no como pendiente.

---

## Paso 1 — Aplicar el esquema a la base de producción (Supabase cloud)

*(Histórico: describe el estado del 2026-08-14, cuando el proyecto cloud estaba **vacío** y había 18 migraciones. Hoy hay 38 y la base ya tiene el esquema — este paso ya no aplica salvo que se rearme el proyecto cloud desde cero.)* La forma robusta es el CLI (aplica todo en orden, transaccional):

```bash
npx supabase login
```
(abre el navegador, te logueás con tu cuenta de Supabase — es tu credencial, por eso lo hacés vos)

```bash
npx supabase link --project-ref nbypcqhojmixlxvkflrp
```
(te va a pedir la **database password** del proyecto — la definiste al crear el proyecto en Supabase; si no la recordás, la reseteás en Dashboard → Project Settings → Database → Reset database password)

```bash
npx supabase db push
```
Esto aplica las 18 migraciones a la base de producción. Al terminar, verificá en el Dashboard → Table Editor que aparezcan las tablas (`profiles`, `medications`, etc.).

> Las extensiones `pg_cron` y `pg_net` deben estar habilitadas: Dashboard → Database → Extensions → buscá `pg_cron` y `pg_net` y activalas (si `db push` no las prendió solo).

---

## Paso 2 — Cargar las variables de entorno en Vercel

1. Abrí: https://vercel.com/darril/historialclinico/settings/environment-variables
2. Abrí el archivo `.env.cloud-respaldo` (raíz del proyecto, en tu máquina) en un editor y **copiá todo su contenido**.
3. En Vercel, tocá **Add Environment Variable** → hay una opción para **pegar un `.env` entero** (o el campo "key" acepta pegar varias líneas). Pegá el contenido completo.
4. Asegurate de que el entorno sea **Production** (marcá también Preview y Development si querés previews funcionales).
5. Guardá. Son 10 variables:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas, van al navegador — es normal)
   - `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `CRON_SECRET` (secretas, quedan solo en el servidor)

---

## Paso 3 — Redeploy para que tome las variables

Las env vars solo se aplican en un build nuevo. En https://vercel.com/darril/historialclinico/deployments:
- Tocá el `...` del deployment de arriba → **Redeploy** → confirmá (dejá tildado "use existing build cache" NO, para que rebuildee con las env).

Cuando termine (~1 min), probá https://www.historialmedico.com.ar/login — debería mostrar el login (ya no un 500).

---

## Paso 4 — Programar los jobs de producción (cron) en Supabase cloud

En Dashboard → SQL Editor del proyecto cloud, pegá y ejecutá (reemplazando `EL_CRON_SECRET` por el valor de `CRON_SECRET` de tu `.env.cloud-respaldo`):

```sql
select public.configurar_cron_recordatorios(
  'https://www.historialmedico.com.ar/api/push/procesar-recordatorios',
  'EL_CRON_SECRET'
);
select public.configurar_cron_alertas_medicacion(
  'https://www.historialmedico.com.ar/api/push/procesar-alertas-medicacion'
);
select public.configurar_cron_gmail(
  'https://www.historialmedico.com.ar/api/gmail/procesar-barrido'
);
```

(La segunda y la tercera no llevan el secreto: reusan el que carga la primera. Es el diseño del Sprint 7, que el Sprint 17 siguió tal cual — hay UN `CRON_SECRET` por entorno.)

El tercer job es el barrido de Gmail (Sprint 17, tarea 17.2): corre cada 30 minutos y no hace nada mientras no haya ninguna casilla conectada. Detalle completo en `docs/gmail-ingesta.md` §5.

---

## Después: avisame

Cuando termines los 4 pasos, decime "listo el deploy" y yo corro los **smoke tests** contra producción (registro, login, y los flujos principales) y te confirmo que todo funciona online. También ahí vemos lo de **cerrar el registro público** (para que un desconocido no pueda crearse cuenta y gastar la cuota de Gemini — te lo propongo como último ajuste).

## Estado al momento de escribir esto (2026-08-14 — histórico)

- ✅ Código completo (Sprints 0–13) pusheado a GitHub.
- ✅ Vercel buildea bien (arreglé el framework preset a Next.js con `vercel.json`).
- ✅ Dominio configurado (apex → www → Production).
- ✅ Páginas legales (`/privacidad`, `/terminos`) y consentimiento en el registro (Ley 25.326).
- ⏳ Falta: los 4 pasos de arriba (requieren tus claves).
- El 500 actual en producción es esperado: la app está deployada pero todavía sin las env vars ni la base con esquema.

**Estado real al 2026-08-21:** los 4 pasos ya se completaron hace una semana. El sitio está en producción con Sprints hasta el 19 incluidos, 38 migraciones aplicadas, y el registro sigue abierto (decisión de cerrarlo o no, pendiente — ver `docs/estado-proyecto.md`). Este documento queda como referencia de "cómo se hizo la primera vez", no como estado vivo.
