# Pruebas en dispositivo Android real

Sprint 11, tarea 11.7. Recorrido guiado de los seis flujos del ROADMAP (cámara,
push, deep links, instalación PWA, modo avión, dictado por voz) en el Samsung
Galaxy A71 (SM-A715F, Android 13, Chrome) usado en todo el proyecto, vía ADB
(`adb reverse tcp:3000`). Sesión de María Gómez (`can_manage` sobre Roberto
Gómez), reautenticada hoy con la receta ADB de
`docs/capturas/dispositivo-real/README.md` porque la sesión anterior había
vencido.

Este documento **cita** la evidencia ya verificada en sprints anteriores en
vez de repetirla, y añade evidencia nueva de hoy (2026-08-14) donde hacía
falta re-confirmar contra el build actual o cerrar un flujo que no tenía
captura propia todavía. Las capturas nuevas están en
`docs/capturas/dispositivo-real/` con el prefijo `sprint11-qa-*` y quedan
listadas en el README de esa carpeta.

## Nota metodológica: dev vs. prod durante esta tarea

A mitad de la verificación de los flujos 4 y 5 se detectó que el servidor que
estaba respondiendo en el puerto 3000 (heredado de una sesión anterior, que
el README de 11.3 daba por "`prod` dejado corriendo a propósito") en realidad
era **`next dev`**, no `next start`. La pista fue indirecta: `/sos` sin red
abrió con todo el contenido correcto pero **sin CSS** — algo que nunca había
pasado en las evidencias de 8.4/8.5/11.3. La causa raíz, confirmada con
`curl -I` contra los chunks de `/_next/static/`, es que `next dev` sirve esos
archivos con `Cache-Control: no-cache, must-revalidate`, mientras que
`estrategiaEstatico` en `public/sw.js` solo cachea un estático si su
`Cache-Control` contiene `immutable` (`esEstaticoGuardable`, `sw.js` línea
487) — una guarda deliberada y correcta, documentada en el propio archivo,
para no confiar en contenido de dev que puede cambiar en cualquier momento.
El process command line (`Get-CimInstance Win32_Process`) confirmó que el
proceso del puerto 3000 colgaba de `next dev`, no de `next start`; los
heurísticos usados antes (presencia de `BUILD_ID`, ausencia de
`react-refresh` en el HTML) no alcanzan para distinguirlo cuando queda un
`BUILD_ID` viejo en disco de un build anterior.

**No es un bug de la aplicación** — es la guarda de `esEstaticoGuardable`
funcionando exactamente como se diseñó — pero sí era una verificación
inválida para el criterio de esta tarea (que pide "prod" explícitamente para
los flujos 4 y 5). Se corrigió deteniendo el proceso, corriendo
`npm run build` + `npm run start` limpios, confirmando con
`curl -I .../*.css` que el `Cache-Control` de un build real es
`public, max-age=31536000, immutable`, y volviendo a hacer los flujos 4 y 5
contra ese servidor. Las capturas `sprint11-qa-instalar-menu.png` y
`sprint11-qa-offline-sos.png` son de esa segunda corrida, ya contra el build
de producción real. Al cerrar la tarea el servidor se devolvió a `npm run dev`
(criterio de cierre de esta tarea).

**Tarea derivada:** documentar en `docs/pruebas-dispositivo.md` o en la
receta de `adb-mobile-testing` un chequeo explícito de
`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | select CommandLine`
(o `ps` equivalente) antes de dar por válida cualquier verificación de
instalabilidad u offline contra "prod", en vez de inferirlo por heurísticas
sobre el HTML servido.

## Checklist de los 6 flujos

| # | Flujo | Estado |
|---|---|---|
| 1 | Cámara | ✅ OK — verificado hoy |
| 2 | Push | ✅ OK — verificado hoy |
| 3 | Deep links | ✅ OK — verificado hoy |
| 4 | Instalación PWA | ✅ OK — evidencia citada (11.1) + re-confirmación hoy contra build de producción real |
| 5 | Modo avión | ✅ OK — evidencia citada (8.4/8.5/11.3) + pasada de humo hoy contra build de producción real |
| 6 | Dictado por voz | ✅ OK por disponibilidad de API + código compartido — dictado audible marcado NO AUTOMATIZABLE (incidencia informativa) |

### 1. Cámara (`/estudios/nuevo` → "Sacar foto")

**Ya verificado en el Sprint 4** (`docs/capturas/dispositivo-real/README.md`,
sección "Sprint 4 — pantalla de revisión"): el flujo feliz completo —cámara
nativa del Galaxy, compresión client-side 6,2 MB → 145,1 KB, subida,
fallback sin luz— quedó probado de punta a punta con foto real.

**Re-confirmación de hoy:** con la sesión de María sobre el perfil de
Roberto, `/estudios/nuevo` → tocar "Sacar foto" abrió la app de cámara nativa
de Samsung directo, sin selector intermedio, tal como documenta el Sprint 4.
No se sacó foto (no hacía falta, y así no se gasta una corrida de Gemini) —
se confirmó la cámara abierta y se salió con `KEYCODE_BACK` sin capturar
nada. La captura `sprint11-qa-camara-nativa.png` está recortada a la barra
de controles de la cámara (configuración, flash, temporizador, relación de
aspecto, HDR) para no exponer el living del dueño del dispositivo, que
quedaba de fondo en el visor.

### 2. Push (`push_subscriptions` + notificación real)

**Estado al empezar:** `push_subscriptions` solo tenía la fila ficticia del
seed (`bb0e8400-...440001`, endpoint `.../ficticio-seed-token`) — la
suscripción real del teléfono había quedado huérfana tras un `db reset`
anterior, el mismo caso 3 de `docs/push.md` §7 que ya documentaron los
cierres de 7.4 y 9.3.

**Reposición por la UI real** (no por SQL, a diferencia de 7.4): banner de
`/inicio` → "Desactivar" → "Activar recordatorios". El primer intento con
`element.click()` vía CDP no tuvo efecto (Chrome no lo trata como gesto de
usuario para `pushManager.subscribe`); con un TAP real por ADB sobre las
coordenadas exactas del botón (leídas de `uiautomator dump`, no estimadas)
funcionó al toque. Quedó una fila nueva y real:

```
id: 8e0811b7-51f4-4ab1-9788-10e3d71c12d9
endpoint: https://fcm.googleapis.com/fcm/send/e1GXCuAvziA:APA91bG...
revoked_at: NULL
created_at: 2026-08-14 16:29:22 UTC
```

**Push real nuevo:** botón "Enviar prueba (dev)" → `POST /api/push/probar`
→ "Push de prueba enviado a 1 dispositivo(s)" a las 13:30:00. La notificación
"Prueba de recordatorios" apareció en la bandeja del sistema a las 13:30
(`sprint11-qa-push-bandeja.png`) — dentro del mismo minuto, consistente con
el "menos de 15 segundos" que documentó 9.3 para el circuito completo VAPID →
aes128gcm → FCM → service worker → bandeja.

La suscripción real se dejó **activa a propósito** al cerrar la tarea (mismo
criterio que 7.4/9.3): sirve de checkpoint para quien retome push en el
Sprint 12.

### 3. Deep links (push → pantalla, y `/medicacion/enlace` + `/signos/enlace` por URL directa)

**3a. Tocar la notificación real del flujo 2.** El payload de
`/api/push/probar` manda `url: "/turnos"` a propósito (para probar que
`data.url` llega hasta `notificationclick`, no `/inicio`). Un TAP real sobre
la notificación en la bandeja (coordenadas de `uiautomator dump`) aterrizó en
`localhost:3000/turnos` con la sesión de María sobre Roberto intacta
(`sprint11-qa-deeplink-turnos.png`).

**3b. `/medicacion/enlace?perfil=<uuid>` por URL directa**, partiendo
deliberadamente del perfil **propio** de María (no de Roberto, para que el
cambio de perfil sea parte de lo que se prueba y no un caso trivial "ya
estaba ahí"): `am start -a android.intent.action.VIEW -d
"http://localhost:3000/medicacion/enlace?perfil=660e8400-e29b-41d4-a716-446655440003"`
cambió el perfil activo de "Tu historial" (María) a "Viendo a Roberto Gómez"
y aterrizó en `/medicacion` mostrando el Enalapril y el Glucophage de Roberto
(`sprint11-qa-enlace-medicacion.png`) — exactamente el bug que
`app/(app)/(con-nav)/medicacion/enlace/route.ts` existe para evitar (ver su
propio docstring).

**3c. `/signos/enlace?perfil=<uuid>`**, mismo patrón: desde el perfil propio
de María, la URL directa cambió el perfil activo a Roberto y aterrizó en
`/signos` con el banner "Hay 2 alertas de signos vitales sin ver" de Roberto
visible (`sprint11-qa-enlace-signos.png`).

### 4. Instalación PWA

**Ya verificado en el Sprint 11.1**
(`docs/capturas/dispositivo-real/README.md`, sección "Sprint 11 · manifest,
íconos e instalabilidad"): menú "Instalar y crear acceso directo" presente,
manifest válido, íconos correctos. **Límite estructural documentado**: el
WebAPK no llega a acuñarse porque Chrome arma el paquete en un servicio de
Google en la nube que no puede alcanzar `http://localhost:3000` — solo el
teléfono, vía el túnel `adb reverse`, puede. Ese límite no se resuelve en
esta tarea; queda para el smoke de producción del Sprint 12, donde el origen
sí será alcanzable desde internet.

**Re-confirmación de hoy** (ver la nota metodológica de arriba: la primera
pasada fue inválida por estar contra `next dev`, se rehizo contra
`next build && npm run start` real): menú ⋮ de Chrome sobre `/inicio` →
"Instalar y crear acceso dire..." presente en la lista
(`sprint11-qa-instalar-menu.png`), confirmando que el manifest sigue pasando
el chequeo de instalabilidad de Chrome con el build actual.

### 5. Modo avión

**Ya verificado en los Sprints 8.4, 8.5 y 11.3** (evidencias de HOY mismo,
2026-08-14): offline real (`adb reverse --remove` + `adb shell svc wifi
disable`, no solo cortar el túnel — el matiz que 8.5 dejó documentado: el
túnel USB no depende del WiFi) en `/sos`, `/coberturas`, `/turnos` y
`/medicacion`, las cuatro con estilos, credencial y banner "Sin conexión"
completos.

**Pasada de humo de hoy** (contra el build de producción real, ver nota
metodológica): con `/sos` precargada online, corte real
(`adb reverse --remove tcp:3000 tcp:54321` + `adb shell svc wifi disable`,
confirmado con `dumpsys connectivity` en 0 redes conectadas) y reload de la
misma pestaña: `/sos` abrió completa, con estilos, la banda amarilla
"Sin conexión — estás viendo datos guardados" arriba, y la hora del sistema
(13:57) visible en la barra de estado como evidencia de que la captura es de
ese momento (`sprint11-qa-offline-sos.png`). Restaurado el WiFi y el túnel,
`/sos` recargó y el indicador desapareció.

*(De paso, este corte también volvió a probar la primera parte de la receta
de login por ADB del README: la sesión del teléfono había vencido al llegar
a esta tarea y se restableció con esa misma receta sin tocar ninguna
credencial guardada del dueño del equipo — ver la hoja del administrador de
contraseñas de Google descartada con BACK, nunca con "Guardar".)*

### 6. Dictado por voz

**Ya verificado en el Sprint 5** (`docs/capturas/dispositivo-real/README.md`,
sección "Sprint 5 — filtros y búsqueda con dictado"): el botón de micrófono
se ve junto al buscador de `/estudios` en el dispositivo real, confirmando
que Chrome Android expone la Web Speech API.

**Re-confirmación de hoy, por disponibilidad de API** (no había quien hablara
frente al equipo para dictar de verdad): vía CDP, `Runtime.evaluate` contra
la pestaña activa del teléfono devolvió:

```json
{"webkitSpeechRecognition": true, "SpeechRecognition": true, "tipo": "function"}
```

Confirma que ambos constructores existen y son invocables en este Chrome
Android real — no un mock ni una inferencia por user-agent. El botón de
micrófono se volvió a ver junto al buscador de `/estudios`
(`sprint11-qa-dictado-boton.png`).

**Camino de código compartido con tipeo**, verificado por lectura de
`hooks/use-reconocimiento-voz.ts` y `components/base/campo-texto.tsx`: el
hook solo instancia `SpeechRecognition` dentro de `iniciar()`, llamado por
gesto del usuario; el resultado final (`isFinal`) llega a
`campo-texto.tsx#manejarTranscripcion`, que inserta el texto exactamente
como si viniera del teclado (dispara el mismo `onChange` que el tipeo
manual) — es el mismo camino que Sprint 5 usó para "ejercitar" el filtro sin
un micrófono real, y sigue intacto.

**El dictado audible real queda como NO AUTOMATIZABLE** en este banco de
pruebas (no hay una persona ni un altavoz reproduciendo voz frente al
Galaxy) — ver tabla de incidencias.

## Tabla de incidencias

| Incidencia | Origen | Tarea derivada |
|---|---|---|
| WebAPK no se acuña contra `localhost` (share-sheet / long-press de ícono instalado no verificables) | 11.1, re-confirmado hoy (11.7) | Smoke de producción del Sprint 12, contra un origen alcanzable desde internet |
| Dictado por voz audible no verificable sin una persona hablando frente al equipo | Sprint 5, re-confirmado hoy (11.7) — verificado por disponibilidad de API + código compartido con tipeo | Verificación manual del usuario cuando pruebe la app en su propio uso diario |
| LCP en local no cumple el umbral de 2.5s en `/inicio`, `/estudios`, `/turnos` (diagnóstico: sobrestimación de Lantern/Lighthouse en simulación móvil, no un problema de bundle — `docs/auditoria-performance.md` §5) | 11.6 | Re-medición de Lighthouse contra el deploy real del Sprint 12 |
| El servidor de esta sesión de pruebas estaba en `next dev`, no `next start`, pese al README de 11.3 dar "prod" por dejado corriendo — invalidó la primera pasada de los flujos 4 y 5 (detectado y corregido en esta misma tarea) | 11.7 (esta tarea) | Documentar el chequeo de `CommandLine` del proceso en la receta de pruebas en dispositivo (ver nota metodológica arriba) |

## Suites de cierre

Con el servidor de vuelta en `npm run dev` (sin tocar código en esta tarea):

- `npm run test -- --run` → **693/693 PASS** (41 archivos)
- `npx tsc --noEmit` → limpio, sin salida
- `npx eslint .` → limpio, sin salida

`adb reverse` restaurado (`tcp:3000`, `tcp:54321`), WiFi del teléfono
reactivado, sesión de María sobre el perfil de Roberto intacta.


## Resolución del warning de script tag (Sprint 12)

El error de consola “Encountered a script tag while rendering React component” (visto en /turnos/nuevo, /inicio y otras) es el script anti-parpadeo de next-themes chocando con el validador de hidratación de la build de DESARROLLO de React 19. Evidencia: el string del warning solo existe en los chunks de dev (.next/dev) — no aparece en .next/static (producción) ni en react-dom-client.production.js. En producción el código del warning no se envía. Sin acción de código necesaria.
