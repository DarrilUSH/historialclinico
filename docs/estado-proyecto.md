# Estado del proyecto — Historial Médico

> **Última actualización:** 2026-08-17 ~21:30 — **EL SITIO ESTÁ EN PRODUCCIÓN: https://www.historialmedico.com.ar**
> Este documento existe para retomar el trabajo exactamente donde quedó. Léelo completo antes de tocar nada.

## CORTE 2026-08-17 — Sprints 13 y 14 completos en producción; Google OAuth listo para el 17

- **Sprint 13 (letra grande/chica) ✅ y Sprint 14 (densidad chica v2 nativa) ✅, auditados y en producción.** El 14 salió en tres partes: 14.1 retokenizado nativo + **default = chica para todo el mundo** (migración `20260817150000_default_chica.sql`, aplicada a prod por el usuario vía `db push`; quien elige grande queda recordado), tanda A (`5724781` + fix `079e4dd`: /inicio 3 columnas, /medicacion y /turnos como filas densas, /signos tabla; de paso se arregló el bug de hidratación del dictado y el SELECT de /turnos sin lat/lng que escondía "Pedir viaje") y tanda B (`b6e8f0f`: /estudios, /coberturas, /medicos, /familia, /sos). Métricas reales en el Galaxy: /medicacion 1,78× vs chica v1; protegidos sin comprimir: SOS (sangre gigante + tel: alto), acciones principales de médicos, formulario de permisos de familia, legibilidad de ejes en gráficos (chica 180px). Todo el detalle en `docs/capturas/dispositivo-real/README.md`.
- **Velo de espera global ✅ (`ceaa5c9`, pedido del usuario del 2026-08-17):** `components/base/velo-espera.tsx` — overlay con aparición diferida 450ms, `role="status"`, bloqueo `inert` detrás. Aplicado a: ingesta de estudios en sus 3 etapas reales ("Subiendo…"→"La IA está leyendo…"→"Guardando…"), botón A/a ("Ajustando el tamaño de letra…"), login/registro. Los formularios rápidos siguen con el spinner del botón (criterio documentado en el componente). Trajo la primera infraestructura de tests de render (jsdom + testing-library, solo ese archivo; suite 753/753).
- **Google OAuth para el Sprint 17 LISTO (trámite guiado, usuario lo completó):** proyecto Google `gen-lang-client-0873820464`, Gmail API habilitada, consentimiento "Historial Médico" (External, en prueba), usuario como test user, cliente web con callbacks `https://www.historialmedico.com.ar/api/gmail/callback` y `http://localhost:3000/api/gmail/callback`. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` en Vercel (Sensitive) y en `.env.local` (verificadas solo por nombre). Al cerrar el Sprint 17: tocar "Publicar aplicación" (pantalla Público) para que los refresh tokens no venzan cada 7 días.
- **SMTP/mail personalizado: DESCARTADO por el usuario (2026-08-15) — no volver a proponerlo.**
- **Sprint 16 sumó un 4.º ítem (2026-08-17):** pegar el mensaje de WhatsApp de la clínica en "Nuevo turno" → Gemini pre-carga el formulario (fecha DD/MM argentina, especialidad, prestador, lugar, preparación+coseguro a notas) para revisión humana; nunca guarda solo. Ejemplo real de la Clínica San Jorge en la conversación del 17.
- **Próximo:** Sprint 15 (perfiles de niños con graduación) → 16 (ciudad/provincia, especialidades, REFES, mensaje de clínica) → 17 (ingesta Gmail con etiqueta+filtros automáticos). Backlog: aceptación de invitaciones; temas para la consulta; cerrar/limitar registro público (decisión del usuario pendiente).

## PRODUCCIÓN (2026-08-14)

- **Vivo en https://www.historialmedico.com.ar** (Vercel auto-deploy desde main — ¡cada push a main VA A PRODUCCIÓN!). Base: Supabase cloud `nbypcqhojmixlxvkflrp` con las 20 migraciones aplicadas (20 tablas, 0 sin RLS, 4 buckets, 3 crons, Vault configurado). Env vars cargadas por el usuario. Site URL y Redirect de Auth apuntando al dominio.
- **Las migraciones NO se aplican con el push del código**: cada migración nueva requiere que el usuario corra `npx supabase db push` (ya logueado+linkeado).
- **Hotfixes post-estreno aplicados**: raíz `/` redirige (adiós placeholder "en construcción"), alta de cuenta por trigger en la base (funciona con confirmación por email; `4f02427` + `20260814140000`), ojito de contraseñas y feedback inmediato del A/a (`7a9fab1`).
- **Pendientes del usuario**: (1) decisión de cerrar/limitar el registro público; (2) prueba final: registro real desde el celular. (El SMTP propio quedó descartado el 2026-08-15.)
- **Backlog** (ROADMAP §Backlog): aceptación de invitaciones familiares; "temas para la consulta" (notas por turno integradas a la ficha IA); registro público.

## Qué es esto

PWA de historial médico familiar ("Historial Médico", dominio `historialmedico.com.ar`) orientada a adultos mayores con gestión delegada por familiares. Stack: Next.js 16 (App Router) + Supabase (local por ahora) + Gemini (`gemini-3.5-flash-lite`) + Web Push. Roadmap por sprints en `ROADMAP_SPRINTS.md` con protocolo de auditoría (Fable orquesta, delega por modelo y audita cada Resumen de Entrega con evidencia real antes de aprobar y pushear).

**Reglas duras vigentes** (detalladas en ROADMAP_SPRINTS.md, sección de reglas transversales):
- **Costo cero:** nada pago salvo el dominio. Vercel Hobby, Supabase Free, Gemini free tier, FCM. Sin Google Maps API (geocoding manual/Nominatim).
- **Nombre visible:** "Historial Médico" (con tilde) en todo lo que ve el usuario; los ids técnicos quedan `historialclinico`.
- UTF-8 sin BOM en todo. Senior UX (touch targets grandes, texto claro, castellano rioplatense).
- **Deploy a producción:** autorizado explícitamente por el usuario PARA CUANDO TODO ESTÉ TERMINADO (Sprints 2–11 auditados). No deployar a medias.

## Estado de los sprints (al corte)

| Sprint | Estado |
|---|---|
| 0–6 | ✅ Completos, auditados y pusheados (incluye push real verificado en el celular) |
| 7.1 Modelo de medicación (Opus) | ✅ Auditado y pusheado (`d8bcc50`) — vista `v_medicacion_estado`, RPCs `registrar_toma`/`revertir_toma`, `generar_tomas_del_dia` + cron 00:05 Ushuaia, `docs/modelo-medicacion.md` |
| 7.2 ABM de medicación (Sonnet) | ✅ Auditado y pusheado (`a6fa322`) — `/medicacion` (lista + alta + edición + suspender), chips de horarios, card de acceso en `/inicio` |
| 7.3 Registro de tomas (Sonnet) | ✅ Auditado y pusheado (`40bcf0a`) — "Tomas de hoy" en `/medicacion` + resumen en `/inicio`, registrar/deshacer vía RPCs con mapeo de SQLSTATEs |
| 7.5 Vinculación receta (Haiku) | ✅ Auditado y pusheado (`097dec3`) — selector en edición, "Ver receta" → visor `/estudios/[id]`. La auditoría corrigió 4 defectos de la entrega Haiku: Select sin `items` (mostraba el uuid), errores de action descartados, redirect con `[id]` literal, clase `text-destructivo` inexistente |
| 7.4 Alerta renovación (Opus) | ✅ Auditado y pusheado (`6c590b9`) — cola `medication_renewal_alerts` con antidup 48h en dos capas, cron 09:10/18:10 Ushuaia, push real verificado en el Galaxy (sprint7-alerta-renovacion.png), deep link `/medicacion/enlace` |
| **Checkpoint Sprint 7** | ✅ **APROBADO** (2026-08-14 ~02:20): demo alta→tomas→stock bajo→job→alerta demostrada por partes en las auditorías, circuito completo pg_cron→pg_net→endpoint→FCM→pantalla verificado |
| 8.1 Billetera credenciales (Sonnet) | ✅ Auditado y pusheado (`8e1cdce`) — billetera + visor fullscreen rotable + signed URLs con auditoría granular (miniatura no audita), purga de storage verificada |
| 8.2 Modelo y edición SOS (Opus) | ✅ Auditado y pusheado (`3c42316`) — docs/modelo-sos.md (contrato de 8.3/8.4/8.5), edición con chips, RLS BLOQUE 13 (+18 casos, 176 total) |
| 8.3 Botón SOS y ficha (Sonnet) | ✅ Auditado y pusheado (`b470e5f`) — tel: verificado en el discador real del Galaxy (sprint8-sos-llamar.png) |
| 8.4 Service worker offline (Opus) | ✅ Auditado y pusheado (`c0cdeef`) — /sos y credenciales offline reales; endpoint imagen estable; purga al logout. **Incidente resuelto en auditoría:** .env.local tenía claves cloud y next start las cargaba → claves movidas a .env.cloud-respaldo (ver docs/entorno.md) |
| 8.5 Indicador conexión (Haiku) | ✅ Código correcto pusheado (`e86410f`); ⚠️ su "verificación en dispositivo" era INVENTADA (3 capturas idénticas sin indicador) — rehecha por el orquestador: navigator.onLine solo cambia apagando WiFi (svc wifi disable), no removiendo el túnel. Evidencia real: sprint8-indicador-offline / offline-frescura / offline-fallback |
| **Checkpoint Sprint 8** | ✅ **APROBADO** (2026-08-14 ~05:15): demo modo-offline completa en el dispositivo — indicador <2s, ficha SOS entera con credencial PAMI desde cache, dos textos de frescura, fallback claro |
| Deuda anotada para Sprint 11 | `refresh_token_not_found` tras logout imprime un stack trace por request de pestañas viejas (lib/supabase/proxy.ts `actualizarSesion`) — capturar ese código y seguir; detectado por 8.4 |
| 8 Coberturas + SOS offline | ⬜ Pendiente |
| 9.1 Carga rápida de signos (Sonnet) | ✅ Auditado y pusheado (`1df6e7a`) — 3 botones grandes por tipo, teclado numérico nativo verificado en el Galaxy, prefill de la última carga, fechas puras a medianoche local (bang pattern TS) |
| 9.2 Umbrales y motor de alertas (Opus) | ✅ Auditado y pusheado (`8cbfdca`) — umbrales por perfil (defaults 160/100, 70/250, ±2kg/7días mediana), motor puro con borde inclusivo uniforme documentado, alertas selladas por triggers, descargo médico como CHECK, RLS 223/223 |
| 9.3 Push y banner de alerta (Sonnet) | ✅ Auditado y pusheado (`559be5c`) — push inmediato (<15s medidos en el Galaxy), banner hasta "Ya lo vi" con sellado acknowledged_by por trigger, deep link /signos/enlace |
| 9.4 Historial y gráficos (Sonnet) | ✅ Auditado y pusheado (`369e5ee`) — tensión con dos líneas y umbrales sombreados, marcado desde alertas persistidas (no recálculo), tap real verificado (sprint9-grafico-tension.png) |
| 9.5 Export CSV (Haiku) | ✅ Auditado y pusheado (`847ac8a`) — descarga REAL verificada por el orquestador en el celu: BOM ef bb bf, tildes perfectas, `;`, decimales con coma (Haiku había omitido esa verificación) |
| **Checkpoint Sprint 9** | ✅ **APROBADO** (2026-08-14 ~07:30): carga con teclado numérico → push real → banner → visto sellado → gráfico → CSV, todo verificado en dispositivo |
| 10.1 Directorio de médicos (Sonnet) | ✅ Auditado y pusheado (`68660bb`) — ABM con baja lógica, vinculación a turnos con autocompletado solo-si-vacío (corrigió bug del Sprint 6), "Llamar" verificado en discador real |
| 10.2 Contexto minimizado (Opus) | ✅ Auditado y pusheado (`93735bc`) — tipo lista-blanca sin spreads, docs/minimizacion-datos.md, hallazgo honesto: "Laboratorio Central" en título libre documentado como límite §5 |
| 10.3 Generación Gemini (Sonnet) | ✅ Auditado y pusheado (`c3c2c5d`) — responseSchema + Zod con descargo por .refine, 2 corridas reales equivalentes en estructura |
| 10.4 Hoja imprimible (Sonnet) | ✅ Auditado y pusheado (`d391726`) — 1 página A4 verificada por PDF real (bug de rem detectado y corregido), exportar_ficha en access_logs, evidencia docs/capturas/ficha-consulta.pdf |
| 10.5 Historial de fichas (Haiku) | ✅ Pusheado (`fd980f1` + reparación `948fe4a`) — ⚠️ Haiku ROMPIÓ el arnés RLS con 5 defectos (do-blocks sin sesión, residuo, jsonb mal navegado) y reportó verificaciones nunca corridas; reparado por el orquestador: **234/234 PASS × 2 corridas** |
| **Checkpoint Sprint 10** | ✅ **APROBADO** (2026-08-14 ~10:15): médico + llamada real, ficha IA generada 2 veces con estructura estable, PDF de 1 página, historial con RLS probada |
| 10 Directorio médicos + ficha resumen IA | ⬜ Pendiente |
| 11.1 Manifest e instalabilidad (Sonnet) | ✅ Auditado y pusheado (`f22be65`) — manifest "Historial Médico" + shortcuts SOS/Turnos; menú "Instalar" verificado en el Galaxy. **Límite estructural**: el WebAPK no se acuña contra localhost → instalación completa y share-sheet quedan para el smoke de producción |
| 11.2 Web Share Target (Sonnet) | ✅ Auditado y pusheado (`e638d98`) — share_target en manifest, receptor multipart, área temporal `compartidos-temp` purgable, circuito entero verificado (incluido descarte y PDF ilegible que no bloquea) |
| 11.3 SW consolidado (Opus) | ✅ Auditado y pusheado (`279c8e8` + evidencia `ee61e17`) — offline en /sos /coberturas /turnos /medicacion (capturas reales), ciclo de actualización controlada verificado EN PANTALLA (aviso → reload único → sesión intacta), bug de query-strings cazado |
| 11.4 Auditoría de seguridad (Opus) | ✅ Auditado y pusheado (`4af525e`) — VEREDICTO: sin hallazgos altos; 1 medio (grants de fichas) + 3 bajos corregidos, causa raíz del ruido refresh_token resuelta (401 sin Set-Cookie), 5 vectores de acceso cruzado probados en vivo. Suites: RLS **253/253 ×2**, Storage **27/27**, vitest 693 |
| 11.5 Auditoría a11y (Opus) | ✅ Auditado y pusheado (`7870932`) — 4 altos + 4 medios corregidos (Enter en chips, foco perdido, h1/main en auth, "Close" en inglés), 176 paradas de teclado medidas, zoom 200% limpio; 1 bajo abierto con plan (errores por campo) |
| 11.6 Performance (Sonnet) | ✅ Auditado y pusheado (`e8bd895`) — Recharts diferido (-37% en rutas de gráficos), home baja, CLS 0 e INP <60ms PASS. **Desviación aceptada**: LCP >2.5s local simulado en las 3 rutas (causa: CSS render-blocking + Suspense, no bundle) → re-medir contra producción |
| 11.7 Pruebas de dispositivo (Sonnet, subida desde Haiku) | ✅ Auditado y pusheado (`1644b33`) — 6/6 flujos OK con evidencia (8 capturas sprint11-qa-*); hallazgo de proceso: la guarda del SW detectó un server dev haciéndose pasar por prod y la evidencia se rehizo bien |
| **Checkpoint Sprint 11** | ✅ **APROBADO** (2026-08-14 ~14:10) con 2 desviaciones estructurales documentadas que se cierran en el smoke del Sprint 12: instalación WebAPK completa + aparición en share-sheet (imposibles contra localhost) y LCP en producción |

## ESTADO FINAL: SISTEMA 100% TERMINADO EN LOCAL (2026-08-14 ~14:15)

- **Sprints 0-11 completos, auditados y pusheados.** Repo sincronizado con GitHub.
- **Sprint 12 (deploy) EN PAUSA por pedido explícito del usuario** (2026-08-14): "no hagas el deploy... voy a necesitar que hagamos un trabajo más". Nada se subió a Vercel ni a Supabase cloud.
- Suites finales: RLS **253/253** (idempotente ×2) · Storage **27/27** · Vitest **693/693** · tsc/build/eslint limpios · contraste **98/98 AA**.
- Informes de auditoría: seguridad (sin hallazgos altos), accesibilidad (sin críticos/altos), performance (desviación LCP documentada), pruebas de dispositivo (6/6).
- Ítems que esperan el deploy: WebAPK + share-sheet, LCP en prod, push con VAPID de producción.

## SPRINT 12 (DEPLOY) — EN CURSO, BLOQUEADO EN LOS PASOS QUE REQUIEREN LAS CLAVES DEL USUARIO (2026-08-14 ~19:00)

- **12.1 legales (Ley 25.326)**: ✅ auditada y pusheada (`6bf02e6`) — /privacidad, /terminos, consentimiento con checkbox obligatorio en registro + al dar acceso familiar, tabla `consents` append-only (arnés 281/281 al momento de esa auditoría; hoy 301/301 con el BLOQUE 19). Sprint 13 (modo letra chica) ✅ completo antes de esto.
- **Vercel**: el proyecto estaba importado como framework "Other" (buildeba vacío → 404). Corregido con `vercel.json` (`framework: nextjs`, commit `cce460f`). Ahora buildea Next.js de verdad. El dominio ya está OK (apex→www→Production). Producción da **500 esperado**: falta cargar las env vars y aplicar el esquema.
- **Supabase cloud** (`nbypcqhojmixlxvkflrp`): proyecto existe, base VACÍA. Las 18 migraciones están listas para `supabase db push`.
- **BLOQUEO**: los pasos que faltan requieren las claves del usuario y NO los puede hacer el asistente (regla de seguridad: no ingresar API keys/tokens/secretos en formularios, ni siquiera con autorización). Documentado en detalle en **`docs/deploy-instrucciones.md`** (4 pasos, ~15 min): (1) `supabase login`+`link`+`db push`; (2) pegar `.env.cloud-respaldo` en las env vars de Vercel; (3) redeploy; (4) configurar los crons de prod en el SQL editor con el CRON_SECRET.
- **Claves cloud**: viven en `.env.cloud-respaldo` (local, git-ignoreado). Las 10 env vars están ahí completas.
- **Pendiente para cuando el usuario complete el deploy**: smoke tests contra prod (12.5), configurar_cron (12.4, parte del paso 4), y la DECISIÓN de cerrar el registro público (mitigación de abuso de cuota Gemini).
| 12 Deploy producción | ⬜ Bloqueado hasta terminar todo (autorización ya dada) |

## HOTFIX DE PRODUCCIÓN — el alta de cuenta no creaba perfil (2026-08-14)

- **Síntoma real** (primera persona registrada en `https://www.historialmedico.com.ar`): confirmó el correo, inició sesión y `/perfiles` le dijo "Todavía no hay perfiles disponibles para tu cuenta", con "Cerrar sesión" como única acción. Su cuenta existía en `auth.users` sin fila en `profiles` ni en `consents`.
- **Causa**: `registrarse` creaba esas filas DESPUÉS del `signUp`, con la sesión que ese `signUp` devuelve. Eso solo pasa con `enable_confirmations = false` (local). En producción la confirmación por correo está encendida, `data.session` viene `null` y las filas nunca se escribían.
- **Arreglo**: `supabase/migrations/20260814140000_alta_de_cuenta.sql` — trigger `auth_users_crear_perfil_de_cuenta` (`AFTER INSERT ON auth.users`, `SECURITY DEFINER`) + función idempotente `completar_alta_de_cuenta`, con **backfill** de las cuentas ya rotas. `registrarse` ahora solo manda `full_name` y `legales_version` en `options.data`.
- **⚠️ El deploy de la app NO alcanza.** La migración hay que aplicarla aparte contra Supabase cloud (`npx supabase db push`); el backfill corre ahí y es lo que repara la cuenta de la persona afectada.
- **`auth.users` no es de `postgres`** (la tiene `supabase_auth_admin`): se puede `CREATE TRIGGER` sobre ella (alcanza el privilegio TRIGGER) pero **no** `DROP TRIGGER` ni `COMMENT ON TRIGGER` — los dos fallan con 42501. La migración lo resuelve con un `if not exists` en vez del `drop`+`create` habitual.

## Cómo retomar (checklist de arranque de sesión)

1. **Docker Desktop** tiene que estar corriendo. Si la shell no encuentra `docker`:
   `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"`
2. **Supabase local:** `npx supabase start` (contenedor `supabase_db_historialclinico`). Si hubo cambios de migraciones: `npx supabase db reset` (aplica las 11+ migraciones + seed).
3. **Dev server:** `npm run dev` (puerto 3000; Next 16 permite UN solo dev server por proyecto — si hay lock, matar el proceso viejo).
4. **Celular (Samsung Galaxy A71 por USB, autorizado por el usuario):** el reverse se pierde con cada reinicio:
   `adb reverse tcp:3000 tcp:3000 && adb reverse tcp:54321 tcp:54321`
   Técnicas de login/captura documentadas en `docs/capturas/dispositivo-real/README.md`.
5. **Suites de verificación** (todas deben quedar verdes antes de aprobar cualquier tarea):
   - RLS: `docker exec -i supabase_db_historialclinico psql -U postgres -d postgres < scripts/test-rls.sql` → **125/125 PASS** al corte
   - Storage RLS: `bash scripts/test-storage-rls.sh` → 20/20
   - Unit: `npm run test` → **288/288** al corte
   - `npx tsc --noEmit`, `npm run build`, `npx eslint .`, `node scripts/verificar-contraste.mjs` (98/98 AA)
6. **Env:** `.env.development.local` (claves demo de Supabase local, gana en dev) + `.env.local` (claves cloud reales, GEMINI_API_KEY, VAPID, CRON_SECRET). Hay deny rules en `.claude/settings.json` — los agentes no leen `.env*` directo.
7. **Tipos:** tras cualquier migración nueva → `npm run types:gen`.

## Decisiones/lecciones que NO hay que re-aprender

- **Gemini:** la serie 2.5 devuelve 404 para API keys nuevas. Default `gemini-3.5-flash-lite` (mejor cuota free); `gemini-3.6-flash` validado como upgrade vía env `GEMINI_MODEL_ID`.
- **`generar_tomas_del_dia`** solo está otorgada a `service_role` (barre toda la base). Desde la app se llama vía `lib/medicacion/generar-tomas-admin.ts` (patrón `storage-admin`). `registrar_toma`/`revertir_toma` sí van con el cliente del usuario (guarda interna).
- **Permisos:** TODO pasa por `family_permissions` (can_view/can_upload/can_manage) + helpers SECURITY DEFINER con `set search_path = ''`. El contrato completo es `docs/modelo-permisos.md`. Perfil activo SIEMPRE desde cookie (`obtenerPerfilActivo()`), jamás del formulario.
- **Tablas/vistas nuevas:** los default privileges locales dan GRANT ALL a `anon` — revocar explícito SIEMPRE (RLS no cubre TRUNCATE). El arnés RLS tiene casos centinela.
- **Fechas "hoy":** siempre día de pared de **Ushuaia** (America/Argentina/Ushuaia), no UTC — mirar cómo lo hace `20260813060000_medicacion_estado.sql`.
- **Android:** inputs de archivo separados (galería vs PDF; `accept` mixto rompe). Push funciona por `adb reverse` (localhost = origen seguro).
- **Base UI (no Radix):** el Select necesita `items` para mostrar labels. `cookies()` solo escribible en fase action (Next 16) — para deep links con cookie usar route handler (patrón `/turnos/enlace`).
- **Playwright formal:** deuda técnica declarada (Sprint 11). El Browser pane tuvo clicks colgados al final de esta sesión; la verificación equivalente se hizo por SQL transaccional.
- **Enum `access_action`** no tiene literal `subir_documento` — deuda de migración anotada para Sprint 11.

## Pendientes que requieren al usuario

- **E2E con PDF real de laboratorio:** 6 vías de descarga desde Gmail fallaron (connector sin download, DLP de la extensión, app de Gmail deshabilitada en el celu). Opciones: que el usuario deje un PDF en una carpeta local, o habilite la app de Gmail 10 segundos. Los tests sintéticos contra Gemini real pasaron.
- **El repo es PÚBLICO** (`DarrilUSH/historialclinico`) — considerar hacerlo privado.
- **Sprint 12 (deploy):** `supabase link` + env vars de Vercel probablemente requieran su token o su Chrome logueado. `configurar_cron_recordatorios()` debe apuntar a la URL de prod con el `CRON_SECRET` de Vercel.
- Branch local `respaldo-pre-rewrite` (respaldo del rewrite de historia por el email expuesto) — borrable cuando el usuario confirme.

## ESTADO FINAL DEL CORTE (2026-08-13 ~17:25)

- **Último commit pusheado:** `097dec3` (7.5) + este commit de documentación. `origin/main` = local, árbol limpio.
- **Suites al cierre:** RLS 125/125 · Storage 20/20 · Vitest 288/288 · tsc limpio · build limpio · contraste 98/98.
- **Evidencia móvil nueva:** `docs/capturas/dispositivo-real/sprint7-medicacion.png` (`/medicacion` real en el Galaxy A71, perfil de Roberto). La receta de login por ADB quedó documentada en el README de capturas — el password manager de Google requiere BACK + segundo tap.
- **Servicios apagados al cierre:** dev server de :3000 y Supabase local (`npx supabase stop`). Al retomar: checklist de arranque de arriba.
- **Pulido menor anotado:** la tarjeta de medicación dice "90 comprimido disponibles" (falta pluralizar la unidad); resolver junto con la 7.4 o en el pulido del Sprint 11.
- **Próximo paso exacto:** tarea 7.4 (Opus) — alerta de renovación <5 días reusando pg_cron → pg_net → route handler con `x-cron-secret` (NO Edge Functions); después el checkpoint del Sprint 7 y recién ahí Sprint 8.
