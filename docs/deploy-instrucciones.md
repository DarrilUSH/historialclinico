# Cómo terminar el deploy a producción — pasos que necesitan tus claves

> **Por qué estos pasos los hacés vos y no yo:** cargar API keys / tokens / secretos en un formulario (las env vars de Vercel, tu login de Supabase, el `CRON_SECRET` del Vault) es exactamente lo que mi límite de seguridad me impide hacer — es la regla que te protege de que esas claves se filtren. Todo lo demás (código, framework de Vercel, páginas legales, el esquema de la base listo para aplicar) ya está hecho y pusheado. Lo que sigue son **4 pasos y ~15 minutos**.
>
> **Dónde están tus valores:** todas las claves cloud están en el archivo local `F:\Proyectos\historialclinico\.env.cloud-respaldo` (está git-ignoreado, nunca se sube). De ahí copiás y pegás.

---

## Paso 1 — Aplicar el esquema a la base de producción (Supabase cloud)

El proyecto cloud es `nbypcqhojmixlxvkflrp` y está **vacío**. Hay que aplicarle las 18 migraciones. La forma robusta es el CLI (aplica todo en orden, transaccional):

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
2. Abrí el archivo `F:\Proyectos\historialclinico\.env.cloud-respaldo` en un editor y **copiá todo su contenido**.
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
```

(La segunda no lleva el secreto: reusa el que carga la primera. Es el diseño del Sprint 7.)

---

## Después: avisame

Cuando termines los 4 pasos, decime "listo el deploy" y yo corro los **smoke tests** contra producción (registro, login, y los flujos principales) y te confirmo que todo funciona online. También ahí vemos lo de **cerrar el registro público** (para que un desconocido no pueda crearse cuenta y gastar la cuota de Gemini — te lo propongo como último ajuste).

## Estado al momento de escribir esto

- ✅ Código completo (Sprints 0–13) pusheado a GitHub.
- ✅ Vercel buildea bien (arreglé el framework preset a Next.js con `vercel.json`).
- ✅ Dominio configurado (apex → www → Production).
- ✅ Páginas legales (`/privacidad`, `/terminos`) y consentimiento en el registro (Ley 25.326).
- ⏳ Falta: los 4 pasos de arriba (requieren tus claves).
- El 500 actual en producción es esperado: la app está deployada pero todavía sin las env vars ni la base con esquema.
