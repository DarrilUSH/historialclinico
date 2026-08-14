# Estado del proyecto — Historial Médico

> **Última actualización:** 2026-08-13 ~16:50 (sesión cortada a las 18:40 por viaje del usuario).
> Este documento existe para retomar el trabajo exactamente donde quedó. Léelo completo antes de tocar nada.

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
| 10.1 Directorio de médicos | ⏳ En curso |
| 10 Directorio médicos + ficha resumen IA | ⬜ Pendiente |
| 11 PWA/manifest + **Web Share Target** + auditorías finales | ⬜ Pendiente |
| 12 Deploy producción | ⬜ Bloqueado hasta terminar todo (autorización ya dada) |

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
