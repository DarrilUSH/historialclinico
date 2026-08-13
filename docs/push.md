# Web Push — infraestructura de notificaciones

**Sprint 6, tarea 6.3.** Verificado en un Samsung Galaxy real (Android, Chrome)
el 2026-08-13. Esta es la base de **todas** las notificaciones del producto:
recordatorios de turnos (6.4), alertas de medicación (Sprint 7) y alertas de
presión (Sprint 9) pasan por acá.

---

## 1. Qué se construyó

| Pieza | Archivo | Corre en |
|---|---|---|
| Generación de claves VAPID | `scripts/generar-vapid.mjs` | máquina de desarrollo |
| Envío + política de bajas | `lib/push/servidor.ts` | servidor (Node) |
| Alta idempotente en la base | `supabase/migrations/20260813040000_push_suscripciones.sql` | Postgres |
| Server Actions de alta/baja | `app/(app)/(con-nav)/inicio/actions.ts` | servidor |
| Validación de entrada | `lib/validacion/suscripcion-push.schema.ts` | servidor |
| Service worker | `public/sw.js` | navegador (worker) |
| Registro del SW | `lib/push/registrar-sw.ts` | navegador |
| Suscripción / baja | `lib/push/suscripcion.ts` | navegador |
| Banner de activación | `components/notificaciones/activar-notificaciones.tsx` | navegador |
| Endpoint de prueba (solo dev) | `app/api/push/probar/route.ts` | servidor |
| Íconos de la notificación | `scripts/generar-iconos-push.mjs` → `public/icono-192.png`, `public/badge-96.png` | navegador |

La tabla `push_subscriptions` **ya existía** desde el esquema inicial
(`20260812200000_schema_inicial.sql` §4.12) con sus cuatro políticas RLS
(`20260812220000_rls.sql` §5.5). Esta tarea no la recreó: agregó únicamente el
RPC de alta.

**Costo: cero.** Los Push Services (FCM de Google para Chrome/Android, autopush
de Mozilla para Firefox) son gratuitos y no requieren cuenta ni SDK
propietario. `web-push` es MIT.

---

## 2. Generar las claves VAPID

```bash
node scripts/generar-vapid.mjs
```

Imprime cuatro líneas listas para pegar. **No escribe ningún archivo**: los
`.env` se editan a mano.

| Variable | Dónde va | Qué es |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `.env.local` y `.env.development.local` | clave pública P-256 |
| `VAPID_PRIVATE_KEY` | ídem | **secreto**: firma el JWT de cada envío |
| `VAPID_SUBJECT` | ídem | `mailto:contacto@historialmedico.com.ar` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ídem | la MISMA pública, expuesta al navegador |

`.env.example` documenta las cuatro **sin valores** y está versionado. Los
`.env` reales no: `.gitignore` ignora `.env*` salvo el example. La clave
privada VAPID **no entra nunca al repositorio**.

> `NEXT_PUBLIC_VAPID_PUBLIC_KEY` duplica el valor de `VAPID_PUBLIC_KEY` a
> propósito. El navegador necesita la clave pública para pasarla como
> `applicationServerKey`, y en Next.js solo las variables con prefijo
> `NEXT_PUBLIC_` llegan al cliente. Duplicarla no filtra nada: es pública por
> diseño y viaja igual dentro del bundle.

### Rotar las claves invalida todas las suscripciones

Si el par cambia, cada endpoint ya registrado queda asociado a la clave vieja y
el Push Service devuelve **403** en todos los envíos. La rotación implica que
cada persona vuelva a tocar "Activar recordatorios". Por eso el script no pisa
nada solo, y por eso un 403 se loguea como error de configuración y **no** da
de baja la suscripción (ver §5).

---

## 3. El circuito completo

```
[Banner] click "Activar recordatorios"
    │  (gesto explícito: sin esto Chrome aplica quiet UI y el prompt no se ve)
    ├─ registrarServiceWorker()  →  /sw.js registrado y ACTIVO
    ├─ Notification.requestPermission()  →  prompt nativo del sistema
    ├─ pushManager.subscribe({ userVisibleOnly, applicationServerKey })
    │      → { endpoint, p256dh, auth }
    └─ Server Action guardarSuscripcion()
           → validación Zod
           → RPC registrar_suscripcion_push()  →  fila en push_subscriptions

[Servidor] enviarPushAUsuario(userId, payload)
    ├─ lee las suscripciones activas con service_role
    ├─ web-push: JWT ES256 (VAPID) + cifrado aes128gcm (RFC 8291)
    └─ POST al endpoint del Push Service
           → 201  entregado
           → 404/410  revoked_at = now()   (la suscripción murió)
           → 429/5xx  log, se reintenta en el próximo ciclo
           → 400/403  log de error: bug nuestro

[Dispositivo] service worker
    ├─ evento `push`               → showNotification(titulo, {body, icon, badge, tag, data.url})
    └─ evento `notificationclick`  → focus/navigate de data.url (o ventana nueva)
```

### El permiso se pide con gesto, y una sola vez

En Chrome un `denied` es **definitivo**: el sitio no vuelve a preguntar nunca y
recuperarlo exige entrar a la configuración del navegador — algo que no se le
puede explicar por teléfono a un adulto mayor. Un prompt disparado en el
pageload, descartado por reflejo, quema para siempre la posibilidad de avisarle
a esa persona que tiene turno mañana. Por eso el banner explica primero y
pregunta después, y `pedirPermisoYSuscribir()` solo se llama desde el manejador
de un click.

---

## 4. Decisiones de esta tarea

### 4.1 `registrar_suscripcion_push()`: por qué el alta pasa por un RPC

El `endpoint` es único a nivel GLOBAL y pertenece al **navegador**, no a la
persona logueada. En un dispositivo compartido —el caso más común de este
producto: la hija que administra el perfil de la madre entra con su cuenta en
el mismo teléfono— el segundo `subscribe()` devuelve el MISMO endpoint que ya
está guardado a nombre de la primera cuenta. Un `upsert` del cliente choca
contra `push_subscriptions_update_propias` (`user_id = auth.uid()`), no matchea
la fila ajena, y la activación falla **para siempre** sin que la persona pueda
arreglarlo desde la aplicación.

El RPC reasigna esa fila a quien acaba de suscribirse. Es seguro porque el
endpoint es una *capability URL* del Push Service: quien lo presenta probó
poseer ese navegador. El peor abuso posible —alguien que consigue el endpoint
ajeno y lo registra a su nombre— es una **denegación** de notificaciones: los
envíos siguientes se cifran con las claves del atacante y el dispositivo de la
víctima no puede descifrarlos. En ningún escenario se lee un dato ajeno.

El RPC además descarta un `profile_id` que el llamador no pueda ver, cosa que
ninguna política valida hoy.

**La baja NO pasa por un RPC**: es un `UPDATE` sobre una fila propia y entra
por RLS. Darle a la baja el mismo poder de reasignación permitiría apagarle las
notificaciones a otra persona con solo conocer su endpoint.

### 4.2 `/sw.js` tuvo que declararse ruta pública

`navigator.serviceWorker.register()` descarga el script con una request que
**no sigue redirecciones**. La regla "privado por defecto" de
`lib/auth/rutas.ts` hacía que el proxy le contestara `307 → /login`, y el
registro fallaba con `The script resource is behind a redirect, which is
disallowed`. Se agregó `RUTA_SERVICE_WORKER` a `RUTAS_PUBLICAS`, con test.
No expone nada: `sw.js` es código que se descarga igual en cualquier bundle y
el navegador lo pide sin cookies.

### 4.3 `skipWaiting()` + `clients.claim()` en el service worker

Sin ellos, una versión nueva de `sw.js` queda en `waiting` hasta que se cierren
**todas** las pestañas de la app — y en un celular las pestañas no se cierran
nunca. Se comprobó en el teléfono: una corrección del handler
`notificationclick` se quedó esperando detrás de pestañas abiertas hacía horas,
con el worker viejo atendiendo los pushes.

Además, sin `clients.claim()` la pestaña desde la que se acaba de activar queda
sin controlar y `WindowClient.navigate()` rechaza: la notificación se abría, la
app pasaba al frente y se quedaba en la pantalla donde estaba, en silencio.

Las dos líneas son seguras **hoy** porque este service worker no tiene handler
`fetch`: no sirve ni un byte de red, así que tomar el control no cambia nada.
**La tarea de PWA/offline (Sprint 8/11) tiene que revisarlas** junto con el
versionado del caché.

### 4.4 Nada de caché en `sw.js` todavía

No hay `install` con `addAll` ni handler `fetch`, y es deliberado: este
producto sirve documentos médicos por signed URLs de vida corta, y una
estrategia de caché ingenua los dejaría escritos en el disco del celular,
sobreviviendo a la revocación del permiso familiar
(`docs/modelo-permisos.md` §8.1). El caché entra cuando exista la lista
explícita de qué se guarda y qué no.

### 4.5 Los envíos no se auditan en `access_logs`

El enum `access_action` no tiene un literal para "activó notificaciones", y
registrarlo como cualquier otro mentiría sobre lo que pasó (mismo criterio que
la deuda declarada de `subir_documento` en `lib/auditoria.ts`). Además una
suscripción no es un acceso a datos de salud de nadie: es una preferencia de
dispositivo de la propia cuenta.

---

## 5. Qué se hace con cada respuesta del Push Service

| Código | Significado | Acción |
|---|---|---|
| 201 / 200 | aceptado para entrega | nada |
| **404 / 410** | la suscripción murió (navegador la revocó, datos del sitio borrados, app desinstalada) | `revoked_at = now()`, no se reintenta nunca más |
| 429 | estamos mandando demasiado rápido | log, reintento en el próximo ciclo |
| 5xx | el Push Service está caído | log, reintento en el próximo ciclo |
| 400 | payload o cabeceras mal armados | log de error: bug nuestro |
| 403 | la clave VAPID no coincide con la que autorizó la suscripción | log de error: las claves se rotaron |
| sin código (timeout, DNS) | no hubo respuesta | reintentable: no hay evidencia de baja |

La diferencia entre la fila 2 y las filas 3–4 es el corazón del módulo. Un 410
tratado como transitorio llena la base de endpoints muertos que se reintentan
para siempre; un 503 tratado como muerte desuscribe a gente que no hizo nada, y
esa gente se entera cuando **no** le llega el recordatorio del turno. Está
cubierto por `tests/unit/push-servidor.test.ts`.

Un envío **nunca lanza**: `enviarPush` devuelve un `ResultadoEnvio` discriminado
(mismo criterio que `lib/auditoria.ts`). El fallo de una notificación no puede
tumbar el barrido que le está mandando a otras diez personas.

---

## 6. Probarlo de punta a punta

### En el navegador de escritorio

`localhost` cuenta como contexto seguro, así que Web Push funciona sin HTTPS:

1. `npm run dev`
2. Entrar a `/inicio`, tocar **Activar recordatorios**, aceptar el permiso.
3. Tocar **Enviar prueba (dev)** — el botón solo existe en desarrollo.

### En un Android real (lo que de verdad prueba el circuito)

```bash
adb reverse tcp:3000 tcp:3000     # el celular ve el dev server como localhost:3000
adb reverse tcp:54321 tcp:54321   # y el Supabase local
adb shell am start -a android.intent.action.VIEW \
    -d "http://localhost:3000/inicio" com.android.chrome
```

`localhost` a través de `adb reverse` **es contexto seguro** en Chrome Android:
no hace falta HTTPS ni un túnel.

Verificar la fila con:

```bash
docker exec -i supabase_db_historialclinico psql -U postgres -d postgres \
  -c "select left(endpoint,44), revoked_at, last_seen_at from public.push_subscriptions order by created_at desc;"
```

### Chrome puede tapar la notificación con un aviso de "Posible spam"

Chrome tiene un clasificador en el dispositivo que reemplaza la notificación
del sitio por una tarjeta propia —"Chrome detectó posible spam de
localhost:3000"— con las opciones **Anular suscripción** / **Mostrar
notificación**. **No es un fallo de la aplicación**: es la protección
antiabuso, y se dispara con facilidad en un origen `http://localhost`
desconocido que manda varias veces el mismo contenido. Tocando "Mostrar
notificación" aparece la real, y a partir de "Permitir siempre" deja de
interceptar. Conviene saberlo antes de perder media hora depurando un service
worker que está bien.

### Probar el caso 410

1. Activar las notificaciones (fila A).
2. Desregistrar el service worker desde el navegador —lo que da de baja la
   suscripción en el Push Service pero no en nuestra base— y volver a activar
   (fila B).
3. Tocar **Enviar prueba (dev)**: el envío a la fila A vuelve 404/410 y queda
   con `revoked_at` seteado, mientras la fila B recibe la notificación.

Así se verificó el 2026-08-13: fila A revocada automáticamente a las 17:17:36,
fila B entregada. La baja manual desde el botón **Desactivar** se verificó
aparte (17:21:19).

---

## 7. Contrato con las tareas que vienen

- **6.4 (recordatorios de turnos)**, **Sprint 7 (medicación)** y **Sprint 9
  (presión)** consumen `enviarPushAUsuario(userId, payload)` y **no** hablan
  con `web-push` ni con la tabla: toda la política de bajas vive en
  `lib/push/servidor.ts`.
- El `tag` del payload es la antiduplicación **del lado del dispositivo** (dos
  avisos con el mismo tag se reemplazan). Convención: `turno-{id}-{ventana}`,
  `medicacion-{id}`, `presion-{id}`. La antiduplicación del lado del servidor
  —no volver a mandar lo ya mandado— es responsabilidad de cada job.
- El `url` del payload tiene que ser una **ruta relativa** de la app. Lo valida
  el servidor (`serializarPayload`) y lo vuelve a validar el service worker: un
  push no puede abrir un origen ajeno.
- Los envíos programados corren **sin sesión**, con `service_role`. Quien llama
  es responsable de haber resuelto que a ese `userId` le corresponde recibir
  ese aviso, cruzando `family_permissions` si hace falta.
- Los íconos de `public/` son provisorios: la tarea de PWA instalable
  (Sprint 8/11) define el set completo junto al `manifest.webmanifest` y
  reemplaza `scripts/generar-iconos-push.mjs`.
