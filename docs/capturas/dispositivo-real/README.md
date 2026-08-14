# Capturas en dispositivo real

Samsung Galaxy A71 (SM-A715F), Android 13, Chrome — 2026-08-13, vía ADB (`adb reverse tcp:3000`).

| Captura | Qué demuestra |
|---|---|
| sprint2-login-oscuro.png | Login en tema oscuro (sigue al sistema), labels visibles, botón primario salvia |
| sprint2-selector-perfiles.png | Selector estilo Netflix con avatares por inicial y badges de relación |
| sprint3-inicio-bottom-nav.png | Shell con header de perfil activo y bottom nav fija de 4 accesos con indicador |
| sprint4-selector-pdf.png | Tocar "Elegir un PDF" en `/estudios/nuevo` abre el selector de documentos del sistema ("Recientes", filtros "Archivos grandes"/"Esta semana"), no la hoja multimedia — recortada antes de la lista de archivos recientes para no exponer nombres de archivo personales |
| sprint4-selector-galeria.png | Tocar "Elegir de la galería" abre la hoja de selección de fotos (tabs "Fotos"/"Colecciones", aviso de acceso acotado de Chrome) — recortada antes de la grilla de miniaturas para no exponer fotos personales |
| sprint4-revision.png | `/estudios/nuevo/procesando`: tocar el campo "Fecha del estudio" abre el **picker de fecha nativo de Android** (calendario Material con el mes completo, "Establecer"/"Cancelar"/"Borrar"), no un `<select>` casero — confirma que `type="date"` en `CampoTexto` dispara el widget del sistema operativo |
| sprint4-revision-fallback.png | Fallback de la pantalla de revisión (tarea 4.5) en el dispositivo real: foto sacada con la cámara del Galaxy en un ambiente sin luz → Gemini no pudo leer nada → Alerta "No pudimos leer el documento automáticamente" + formulario en blanco listo para cargar a mano, con el aviso "No se detectó — completalo vos" en Título |
| sprint5-galeria.png | Galería de `/estudios` agrupada por período en tema oscuro: encabezado sticky "Agosto 2026" pinneado bajo el header de perfil mientras se ve la transición a "Julio 2026" y "Junio 2026", con las tarjetas mostrando ícono+color distintivo por categoría (Receta ámbar, Imágenes celeste) — datos del seed de Roberto, sin datos personales |
| sprint5-filtros.png | Barra de filtros de `/estudios` en el dispositivo real: el botón de micrófono (Chrome Android soporta `SpeechRecognition`) se ve junto al buscador, el botón "Filtrar" colapsable debajo, y el resultado real de tipear "laboratorio" con el teclado nativo — filtra a "1 estudio" (Análisis de sangre completo — Laboratorio Central) con el chip `"laboratorio" ×` visible |
| sprint5-visor.png | Visor de documento (`/estudios/{id}`, tarea 5.3) en el dispositivo real, con un PDF real subido por la UI (no un `storage_path` ficticio del seed): el `<iframe>` con la signed URL muestra el visor nativo de PDF de Chrome Android, que en vez de renderizar el contenido inline cae a una tarjeta con ícono "PDF" + nombre de archivo + botón "Abrir" — confirma en carne propia el aviso de la pantalla ("En el celular, la vista del PDF puede verse recortada. Si no se lee bien, usá 'Abrir el documento'.") y por qué el roadmap pide los botones grandes "Abrir el documento" / "Descargar" como alternativa siempre visible, no solo el embed |
| sprint5-tendencias.png | `/estudios/tendencias` (tarea 5.4) en tema oscuro: gráfico de Glucosa con las 5 mediciones del seed dibujadas como triángulos color advertencia (las 5 están fuera del rango 70-100, coherente con la diabetes tipo 2 de la ficha SOS de Roberto), banda del rango de referencia sombreada, eje Y con la unidad y el punto más reciente con el anillo de selección |
| sprint5-tendencias-tap.png | Mismo gráfico tras un **TAP real** sobre el punto más antiguo (28/6, no el que estaba seleccionado por defecto): el anillo de selección se movió a ese punto y el panel de abajo se actualizó con su fecha, valor, rango y el aviso "Sin documento de origen asociado" -esa medición, a diferencia de la más reciente, no tiene `document_id`-, confirmando que la interacción táctil responde con los datos correctos del punto tocado, no con datos fijos |

Flujo verificado con toques e ingreso de texto reales por ADB: login de María → selección del perfil gestionado de Roberto → inicio. El camino de error (submit vacío) también se verificó en pantalla física.

## Receta de login por ADB (Chrome + password manager de Google)

El obstáculo es la hoja "¿Quieres usar la contraseña guardada?" del administrador de contraseñas de Google, que intercepta el foco y se traga el `input text`. Receta que funciona (verificada 2026-08-13, cierre del Sprint 7):

1. `adb shell am force-stop com.android.chrome` y abrir `http://localhost:3000/login` con `am start -a android.intent.action.VIEW` — arrancar de estado limpio.
2. Tocar el campo **Contraseña**. Si aparece la hoja del password manager: **keyevent 4 (BACK) y tocar el campo de nuevo** — tras un dismiss, Chrome no vuelve a mostrarla en esa sesión de página; queda el teclado con las sugerencias como chips inofensivos arriba (ignorarlos, jamás tocar credenciales guardadas del dueño).
3. `input text "password123"` → `input keycombination 59 61` (SHIFT+TAB, salta al campo email) → `input text "maria@ejemplo.com.ar"`.
4. Tocar "Iniciar sesión" (con el teclado abierto el botón queda a media pantalla — screencap antes de tocar para confirmar coordenadas).
5. Al prompt "¿Quieres guardar la contraseña?" responder con BACK (nunca "Guardar": es una credencial de prueba del seed y no debe entrar al administrador real del dueño del equipo).

## Sprint 4 — pantalla de revisión (tarea 4.5)

Flujo feliz completo en el dispositivo real: login de María → `/estudios/nuevo` → "Sacar foto" (la cámara nativa de Samsung se abre directo, sin selector intermedio) → compresión client-side confirmada en pantalla (6,2 MB → 145,1 KB) → subida → `/estudios/nuevo/procesando` → como la foto salió sin luz, Gemini no detectó nada legible y la pantalla cayó al fallback (`sprint4-revision-fallback.png`): la ruta **no murió**, el formulario quedó disponible para carga manual con el mismo diseño que el camino feliz. Se verificó además que el campo "Fecha del estudio" abre el selector de fecha **nativo** de Android (`sprint4-revision.png`), no una implementación HTML casera — clave para el criterio Senior UX del roadmap ("los date pickers nativos móviles son excelentes").

## Sprint 4 — fix de `accept` mixto en Android Chrome

Bug reproducido y documentado en la tarea anterior: un `<input type="file" accept=".pdf,image/*">` (PDF + MIME de imagen combinados) abre siempre la hoja multimedia "Cámara / Fotos y videos" en Android Chrome — el PDF queda inalcanzable desde el celular. La corrección separa el camino "Elegir archivo" en dos inputs de un solo tipo cada uno (`components/documentos/cargador-documento.tsx`): "Elegir un PDF" (`accept="application/pdf"`) y "Elegir de la galería" (`accept="image/*"`, sin `capture`).

Verificado en el dispositivo real: "Elegir un PDF" abre el selector de documentos del sistema (`sprint4-selector-pdf.png`); "Elegir de la galería" abre la hoja de fotos (`sprint4-selector-galeria.png`). Las dos capturas se guardaron recortadas porque el contenido completo de cada selector muestra datos personales del dueño del dispositivo (nombres de archivos PDF reales y fotos reales) — el recorte conserva la cabecera de cada selector, suficiente para demostrar cuál se abrió, sin exponer ese contenido.

## Sprint 5 — galería cronológica de estudios (tarea 5.1)

Login de María → perfil gestionado de Roberto → `/estudios`: los 5 documentos del seed se ven agrupados por mes y año, orden descendente ("Agosto 2026" → "Julio 2026" → "Junio 2026" → "Mayo 2026"). `sprint5-galeria.png` se capturó a mitad de scroll para mostrar el encabezado sticky de "Agosto 2026" todavía pinneado bajo el header de perfil mientras "Julio 2026" y "Junio 2026" ya entraron en pantalla, confirmando que el offset sticky (`top-[73px]`, calculado contra el alto real de `EncabezadoPerfil`) no se superpone ni deja hueco. Las tarjetas muestran la categoría con ícono y color distintos por tipo (Consulta terracota, Laboratorio salvia, Receta ámbar, Imágenes celeste) — visible también en tema oscuro, que es el que tiene este equipo.

## Sprint 5 — filtros y búsqueda con dictado (tarea 5.2)

`/estudios` en el dispositivo real: la barra de filtros (Buscar, Categoría, Institución, Desde, Hasta) se ve completa y usable en 375-412px de ancho, sin scroll horizontal. El buscador queda SIEMPRE visible -no está detrás del toggle "Filtrar"- y el botón de micrófono se ve al lado, confirmando que Chrome Android expone `SpeechRecognition` (criterio del roadmap: "dictar filtra"; acá no se dictó de verdad -no hay quién hable frente al dispositivo de pruebas-, pero se tipeó "laboratorio" con el teclado nativo de Android para ejercitar el mismo camino de código que usa el dictado -`campo-texto.tsx#manejarTranscripcion` inserta el texto dictado exactamente como si fuera tipeado-). `sprint5-filtros.png` se capturó después de tipear: la URL de la barra de direcciones ya muestra `?q` (persistencia real, no simulada), el resultado se redujo a "1 estudio" -el análisis de laboratorio, que matchea por institución "Laboratorio Central Ushuaia"-, y el chip `"laboratorio" ×` quedó visible debajo de la barra, junto con el botón "Filtrar" colapsable.

## Sprint 5 — visor de documento con signed URL (tarea 5.3)

Login de María → perfil gestionado de Roberto → se subió un PDF real por la UI (`/estudios/nuevo`, "Elegir un PDF") porque los `storage_path` de los 5 documentos del seed son ficticios y no tienen objeto real en el bucket -verificado primero contra ese caso: el detalle de un documento del seed muestra la `<Alerta variante="error">` "No pudimos abrir el documento" con "Volver a intentar", sin romper el resto de la pantalla (metadatos, resumen IA y métricas siguen andando), tal como pide la tarea-. Con el documento real confirmado, `/estudios/{id}` en el celular muestra el caso interesante: el `<iframe>` con la signed URL no renderiza el PDF inline -Chrome Android cae a su tarjeta nativa "ícono PDF + nombre de archivo + botón Abrir" en vez de pintar el contenido-, confirmando en el dispositivo real la limitación que ya anticipaba el comentario de `components/estudios/visor-documento.tsx` ("en el celular los PDF embebidos son pobres"). Por eso el aviso "En el celular, la vista del PDF puede verse recortada. Si no se lee bien, usá 'Abrir el documento'." y los dos botones grandes ("Abrir el documento" con `target="_blank"`, "Descargar") quedan siempre visibles debajo del embed, no escondidos: son el camino real para leer el archivo en un Android, no un adorno redundante. `sprint5-visor.png` se capturó con scroll para mostrar ambos botones y la tarjeta "Datos del estudio" (tamaño del archivo) en la misma toma. Se probaron los dos botones en el dispositivo: "Abrir" (de la tarjeta nativa del iframe) y "Descargar" dispararon la apertura/descarga del PDF sin errores.

## Sprint 5 — gráficos de evolución temporal (tarea 5.4)

`adb reverse tcp:3000 tcp:3000` + `/estudios/tendencias` en el dispositivo real, sesión de María ya activa sobre el perfil gestionado de Roberto. Con el selector de métrica en "Glucosa" (deslizando la fila de chips hacia la izquierda con un swipe real -la fila entra sin scroll horizontal de PÁGINA, solo la de chips-), `sprint5-tendencias.png` muestra las 5 mediciones del seed dibujadas correctamente: los 5 puntos son triángulos color advertencia porque las 5 mediciones (135-148 mg/dL) están por encima del máximo del rango (100 mg/dL) -coherente con la diabetes tipo 2 de la ficha SOS de Roberto-, la banda de rango de referencia se ve sombreada en la parte inferior del gráfico, el eje Y trae la unidad ("Valores en mg/dL") arriba y el punto más reciente (1/8) tiene el anillo de selección por default.

Después se tocó (TAP real, `adb shell input tap`, no un click simulado) el punto más antiguo del gráfico (28/6, el extremo izquierdo). `sprint5-tendencias-tap.png` confirma que el anillo de selección saltó a ese punto y el panel de detalle de abajo se actualizó con SU fecha ("28 de junio de 2026"), SU valor ("148 mg/dL"), SU rango ("70-100") y el aviso "Sin documento de origen asociado" -a diferencia de la medición del 1/8, que sí tiene `document_id` y muestra el botón "Ver el estudio"-: la interacción táctil responde con los datos reales del punto tocado, no con un estado fijo. También se verificó "Ver como tabla" en el dispositivo: despliega la tabla accesible con las 5 filas, valor, rango y el link "Ver el estudio" solo en la fila que corresponde.
| sprint5-ultimo-valor.png | Tendencias completas: tarjetas de último valor con badges y variación, chips de métrica y gráfico con banda de referencia y rombo fuera-de-rango (capturada por el orquestador en el checkpoint) |
| sprint6-maps.png | La URL de Cómo llegar abre Google Maps con el destino de Ushuaia cargado y ruta calculada (verificación del orquestador por intent; permiso de ubicación NO concedido) |
| sprint6-push.png | **Notificación Web Push real en la bandeja del sistema** (tarea 6.3): "Prueba de recordatorios / Si ves esto en la pantalla del celular, las notificaciones funcionan", con el origen `localhost:3000`, el ícono grande de la app (cruz blanca sobre verde `--primary`) a la derecha y la silueta monocroma del `badge` a la izquierda. Salió de FCM: el circuito completo —clave VAPID, cifrado aes128gcm, Push Service de Google, service worker, bandeja de Android— funcionando de punta a punta |
| sprint7-medicacion.png | `/medicacion` (tareas 7.2/7.3) en el perfil gestionado de Roberto: botón grande "Agregar medicación", tarjeta de Enalapril con presentación, dosis ("1 comprimido — Cada 24 horas"), panel de stock prominente ("90 días de stock · se acaba el 11 de noviembre") y acciones Editar/Suspender; Glucophage asomando debajo y bottom nav fija. Capturada por el orquestador en el cierre del 2026-08-13; sin tomas de hoy visibles porque la base estaba en estado seed (las tomas las materializa el cron o el alta) |
| sprint7-alerta-renovacion.png | **Alertas de renovación de receta PROGRAMADAS** (tarea 7.4), dos en la bandeja: "A Roberto le quedan 4 días de Enalapril / Quedan 4 comprimidos · Conviene pedir la renovación de la receta." y la de Glucophage ("Quedan 8 comprimidos"). Nadie tocó ningún botón: las encoló `generar_alertas_medicacion()` sobre `v_medicacion_estado.necesita_renovacion` y las entregó el barrido de `/api/push/procesar-alertas-medicacion` — la segunda, por el circuito completo `pg_cron → pg_net → endpoint`. Que **se apilen** en vez de reemplazarse es lo correcto: el `tag` es `medicacion-{id}` y son dos medicaciones distintas |
| sprint8-sos-ficha.png | Ficha SOS (`/sos`, tarea 8.3) en el dispositivo real: O+ gigante en panel destacado, "80 años · DNI no registrado" (fallback), alergias y crónicas en tipografía grande, contacto "Llamar a Gabriela Gómez (Hija)" como botón enorme, cobertura PAMI con afiliado, "Datos revisados el 14/08/2026". Dos toques desde cualquier pantalla (nav Inicio → botón SOS) |
| sprint8-sos-llamar.png | Tocar "Llamar a Gabriela Gómez (Hija)" abre el **discador nativo con +54 9 2901 23-4567 precargado** — el criterio "marca al tocarlo en Android real" verificado por el orquestador; el `tel:` con espacios lo normaliza el propio discador |
| sprint8-offline-sos.png | **`/sos` SIN RED** (tarea 8.4, túnel `adb reverse` removido): la ficha abre completa —tipografía Atkinson, tema oscuro, encabezado de perfil, O+ gigante, alergias, crónicas y bottom nav—, servida entera por el service worker desde `historial-medico-paginas-v1` + `historial-medico-estaticos-v1` |
| sprint8-offline-credencial.png | Misma sesión sin red, al pie de `/sos`: **las dos caras de la credencial PAMI se ven** desde `historial-medico-imagenes-v1` (URL estable `/api/credenciales/{id}/imagen?lado=`, nunca una signed URL), más el sello "Datos revisados el 14/08/2026 03:38" |
| sprint8-offline-credencial-grande.png | Tocar la credencial abre la imagen sola a pantalla completa, **también desde el caché**: la navegación a `/api/credenciales/.../imagen` cae en la estrategia de imagen y no en la pantalla offline |
| sprint8-offline-pantalla.png | `/estudios` sin red: **pantalla "Estás sin conexión"** con diseño completo, en español, explicando qué sí está guardado y con el botón grande "Abrir mi ficha SOS" — no el dinosaurio de Chrome. La barra de direcciones sigue mostrando `/estudios`: el worker responde `/offline` sin cambiar la URL |
| sprint6-recordatorio.png | **Recordatorio de turno PROGRAMADO** (tarea 6.4), expandido en la bandeja: "Turno de Cardiología en 3 horas / Hoy a las 17:54 · Dr. Carlos Rodríguez · Hospital Regional Ushuaia · Venir en ayunas de 8 horas". No lo disparó ningún botón de la app: lo generó `pg_cron` sobre un turno cargado a 2h55m y lo entregó el barrido de `/api/push/procesar-recordatorios`. Debajo se ven los otros dos recordatorios reales que salieron en el mismo barrido para los turnos del seed ("Turno de Cardiología pasado mañana", "Turno de Endocrinología en una semana") |
| sprint9-carga-tension.png | `/signos/nuevo?tipo=tension` (tarea 9.1) en el dispositivo real, con el **teclado numérico nativo de Android abierto** sobre el campo "Sistólica" (solo dígitos 1-9/0, sin letras, `Sig.` para pasar de campo) — confirma que `inputMode="numeric"` de `CampoNumero` dispara el teclado correcto, criterio de aceptación del roadmap. Los tres campos vienen precargados con la ÚLTIMA carga del mismo tipo del seed (Sistólica 139, Diastólica 81, Pulso 75, el mismo valor que ya se ve en la tarjeta más reciente de `/signos`) |
| sprint9-alerta-push.png | **Notificación de alerta de signos vitales INMEDIATA** (tarea 9.3), bandeja expandida con `adb shell cmd statusbar expand-notifications`: "Tensión alta registrada p... / 170/110 (umbral 160/100). Valor orientati..." — cargar 170/110 en `/signos/nuevo?tipo=tension` disparó las dos reglas (`sistolica_alta` + `diastolica_alta`) agrupadas en UN SOLO push, sin cola ni cron: llegó a la bandeja en menos de 15 segundos desde el toque en "Cargar tensión", bien dentro del criterio de "menos de 30 segundos" del roadmap |
| sprint9-banner-alerta.png | Tocar la notificación aterriza en `/signos` (vía `/signos/enlace?perfil=...`, el mismo patrón de `/medicacion/enlace`) con el **banner persistente** mostrando "Hay 4 alertas de signos vitales sin ver" — las 2 nuevas (170/110) más las 2 del seed (165/102) que ya estaban sin ver — cada una con su botón "Ya lo vi" |
| sprint9-grafico-tension.png | `/signos/historial` (tarea 9.4), tras un **TAP real** (`adb shell input tap`) sobre el punto 10/8 del gráfico de tensión: las DOS líneas (sistólica salvia, diastólica celeste) con sus dos triángulos de advertencia y sus dos anillos de selección, la banda de referencia sombreada de cada línea (hasta 160 y hasta 100), y el panel de detalle actualizado con "10 de agosto de 2026 · 22:25 hs", "165 mmHg — Por encima del umbral (160)" y "102 mmHg — Por encima del umbral (100)" |

## Sprint 6 · Web Push (tarea 6.3) — verificación completa

Flujo real, todo con toques por ADB sobre `http://localhost:3000` (`adb reverse`, que en Chrome Android **sí** es contexto seguro):

1. Login de María y perfil propio activo. En `/inicio` aparece el banner "No te pierdas ningún turno".
2. **"Activar recordatorios"** → Chrome muestra el prompt NATIVO del sistema ("http://localhost:3000 quiere enviarte notificaciones", Bloquear / Permitir) → se tocó **Permitir**.
3. La tarjeta cambió a "Notificaciones activadas" con el botón discreto "Desactivar", y en la base apareció la fila: endpoint `https://fcm.googleapis.com/fcm/send/…`, `p256dh` de 87 caracteres, `auth` de 22, user agent de Android y `profile_id` del perfil activo.
4. **"Enviar prueba (dev)"** → la notificación llegó al teléfono (`sprint6-push.png`).
5. **Tocar la notificación** llevó la app —reutilizando la pestaña abierta, sin abrir una nueva— a `localhost:3000/turnos`, que es la `url` del payload y no la pantalla donde estaba.
6. **Caso 410**: se dio de baja la suscripción desde el navegador sin avisarle al servidor y se volvió a activar (fila nueva). El siguiente envío devolvió 404/410 para la fila vieja y quedó con `revoked_at` seteado automáticamente (17:17:36), mientras la fila nueva recibió el push. La baja explícita desde el botón "Desactivar" se verificó aparte (17:21:19).

Dos bugs reales que solo aparecieron en el dispositivo, y que están arreglados: `/sw.js` respondía `307 → /login` por la regla "privado por defecto" (el registro de un service worker no sigue redirecciones), y el `notificationclick` abría la app sin navegar porque la pestaña no estaba controlada por el worker. Detalle en `docs/push.md` §4.

Ojo al depurar: Chrome puede reemplazar la notificación del sitio por una tarjeta propia de "Posible spam" con las opciones "Anular suscripción" / "Mostrar notificación". Es su protección antiabuso —se dispara fácil con un `http://localhost` desconocido que repite contenido— y **no** es un fallo de la aplicación.

## Sprint 6 · recordatorios programados (tarea 6.4) — verificación completa

La diferencia con la verificación de 6.3 es que acá **nadie tocó ningún botón**:
la notificación la generó y la mandó el sistema solo.

1. La suscripción del teléfono de 6.3 seguía activa (`revoked_at` nulo): no hizo
   falta reactivarla.
2. Turno de prueba de Cardiología cargado por SQL a **2h55m** sobre el perfil
   gestionado de Roberto.
3. `generar_recordatorios_pendientes()` creó las cuatro filas y dejó
   **`pendiente` solo la de 3hs**; `7d`, `48h` y `24h` quedaron `omitido`. Es la
   regla que evita cuatro notificaciones simultáneas para un turno cargado
   tarde.
4. El job completo (`disparar_recordatorios_turnos()` → `pg_net` → el endpoint
   de Node) devolvió `200` con `{"procesados":1,"entregas":1,"fallos":1}`, y
   **la notificación apareció en el teléfono** (`sprint6-recordatorio.png`).
5. **Tocarla abrió `localhost:3000/turnos`.**
6. Disparar el job otra vez: `{"procesados":0,...}`. No reenvía.
7. Cambiar la fecha del turno borró las cuatro filas (trigger) y la corrida
   siguiente las regeneró desde cero.
8. `cron.job_run_details` muestra la corrida **automática** de las 18:00 en
   `succeeded`: el job programado corre solo, sin que nadie lo invoque.

El destinatario fue María, que tiene `can_manage` sobre Roberto. Roberto no
tiene cuenta y Diego, que solo tiene `can_view`, **no** recibió nada — es la
regla de `docs/modelo-permisos.md` §4.3 funcionando en un teléfono real.

Un detalle que la prueba dejó a la vista y quedó anotado como límite conocido en
`docs/recordatorios.md` §9: la notificación abre `/turnos`, que muestra los
turnos del **perfil activo**. María tenía activo su propio perfil, así que
aterrizó en una lista vacía aunque el aviso era de un turno de Roberto.

## Sprint 7 · alerta preventiva de renovación de receta (tarea 7.4) — verificación completa

**2026-08-14.** Como en 6.4, nadie tocó ningún botón: los avisos los generó y los
mandó el sistema.

Antes de empezar hubo que reponer la suscripción push: un `supabase db reset`
había dejado `push_subscriptions` con la fila ficticia del seed y nada más,
mientras el navegador del teléfono conservaba su `PushSubscription` viva (el
navegador no se entera de que la base se borró — el banner de `/inicio` seguiría
diciendo "Notificaciones activadas" y no llegaría nada). Se leyó del propio
navegador por CDP (`adb forward tcp:9222 localabstract:chrome_devtools_remote` +
`Runtime.evaluate` de `pushManager.getSubscription()`) y se reinsertó en la base.
Es el caso 3 de `docs/push.md` §7 visto desde el otro lado, y vale como
recordatorio: **después de cada `db reset` la suscripción del teléfono queda
huérfana** y hay que desactivar/activar desde el banner (o reponerla así).

1. Enalapril de Roberto bajado a **4 días** de stock (`stock_units = 4`, 1 toma
   por día) → `generar_alertas_medicacion()` encoló **1**.
2. `POST /api/push/procesar-alertas-medicacion` con el header `x-cron-secret` →
   `{"procesados":1,"entregas":1,"fallos":0}` y **la notificación apareció en el
   teléfono**.
3. Segundo y tercer barrido → `{"procesados":0,...}`. **No reenvía.**
4. Sin header, y con un secreto incorrecto → `401` las dos veces.
5. Glucophage bajado a 4 días y el **job completo**:
   `disparar_alertas_medicacion()` devolvió `generadas=1 pendientes=1
   request_id=1`, y `net._http_response` quedó con `200` y
   `{"procesados":1,"entregas":1,"fallos":0}`. Llegó la segunda notificación
   (`sprint7-alerta-renovacion.png`).
6. Las dos conviven en la bandeja en vez de reemplazarse: el `tag` es
   `medicacion-{id}` y son dos medicaciones distintas.

El destinatario fue María, que tiene `can_manage` sobre Roberto; Roberto no tiene
cuenta propia. `fallos=0` porque la suscripción ficticia del seed se revocó
durante la prueba y se restauró después — en las corridas de 6.4 esa fila era la
que aportaba el `fallos=1`.

**Lo que quedó sin verificar en pantalla:** el banner de `/medicacion` y el
aterrizaje del deep link con la sesión abierta. El `db reset` invalidó la sesión
del teléfono y volver a entrar exige tipear la contraseña del seed (receta de
login más arriba en este mismo archivo), cosa que la sesión de trabajo no hizo.
La cadena de redirección sí se verificó sin sesión y es la correcta:
`/medicacion?perfil=<uuid>` → `307` a
`/login?desde=%2Fmedicacion%3Fperfil%3D<uuid>`, es decir el parámetro sobrevive
al login y la persona aterriza donde apuntaba la notificación.

## Sprint 8 · cache offline de datos vitales (tarea 8.4) — verificación completa

**2026-08-14.** Contra `next build && next start` (no `next dev`: los chunks de
desarrollo no son `immutable` y el service worker, correctamente, no los
guarda — `docs/offline.md` límite 5).

⚠️ **El modo avión NO corta `adb reverse`.** El túnel es loopback por USB y
sigue vivo con el avión activado: una prueba de "modo avión" sobre
`localhost:3000` no demuestra absolutamente nada. El corte real se hace con
`adb reverse --remove tcp:3000` (y `tcp:54321`), y se restaura con
`adb reverse tcp:3000 tcp:3000`.

Sesión de María sobre el perfil gestionado de Roberto. Las fotos de credencial
del seed apuntaban a `storage_path` **ficticios** (el bucket
`credenciales-cobertura` estaba vacío), así que se subieron dos JPEG de prueba
a esas mismas rutas antes de empezar — sin eso, el endpoint de imagen contesta
404 con razón y la prueba no mide nada.

1. **Con red**, abrir `/inicio` → `/sos`. El worker quedó `activated` y
   controlando la pestaña, y las cinco cachés se llenaron solas (leído por CDP,
   `adb forward tcp:9222 localabstract:chrome_devtools_remote`):

   | Caché | Contenido |
   |---|---|
   | `shell-v1` | `/offline`, `/icono-192.png` |
   | `estaticos-v1` | 20 entradas: CSS, chunks y las dos fuentes Atkinson |
   | `paginas-v1` | `/sos` — **solo el HTML**, ningún payload RSC |
   | `imagenes-v1` | las dos caras de la credencial |
   | `datos-v1` | **DOS payloads**: `/api/sos/{maría}` y `/api/sos/{roberto}` |

   Las dos entradas de `datos-v1` son la precarga por perfil funcionando: se
   pasó por el perfil propio de María antes de cambiar al de Roberto, y cada
   uno dejó su ficha guardada bajo su propia clave (regla dura 4 del contrato).

2. **`adb reverse --remove tcp:3000` + `tcp:54321`.** Sin túnel, `localhost:3000`
   no existe para el teléfono.

3. **`/sos` abre COMPLETA** (`sprint8-offline-sos.png`): idéntica a la versión
   con red, con estilos, fuentes y encabezado. Al pie, **las dos caras de la
   credencial PAMI** (`sprint8-offline-credencial.png`), y tocarlas abre la
   imagen sola a pantalla completa, también desde el caché
   (`sprint8-offline-credencial-grande.png`).

4. **`/estudios` muestra la pantalla de sin conexión**
   (`sprint8-offline-pantalla.png`), no el error del navegador. Tocar "Abrir mi
   ficha SOS" desde ahí lleva a la ficha cacheada: el camino de escape funciona
   sin red, con un `<a>` nativo y sin depender de hidratación.

5. **Refresco al volver la conexión.** Con el teléfono todavía sin red se le
   agregó a Roberto la alergia "Aspirina" por SQL. Recargar `/sos` sin red
   siguió mostrando **dos** alergias (la copia local, correcta). Restaurado el
   túnel y recargado, apareció **"Aspirina"** — y la copia guardada quedó
   reescrita, no salteada:

   | | antes | después |
   |---|---|---|
   | HTML cacheado de `/sos` | sin "Aspirina" | **con "Aspirina"** |
   | `payload.generado_at` | `07:44:18.266Z` | **`07:49:19.080Z`** |
   | `payload.vitales.actualizado_at` | `06:38:00` | **`07:48:34`** (lo movió el trigger) |

   Las dos marcas de tiempo se movieron por motivos distintos y quedaron
   distintas, que es exactamente lo que pide `docs/modelo-sos.md` §6.1.
   También se verificó que el HTML cacheado **no** es la pantalla de login: la
   guarda de `decidirDestinoDeCache` contra respuestas redirigidas
   (`307 → /login` llega como `200` con el HTML del login) hizo su trabajo.

6. **Purga al cerrar sesión.** Antes del logout había cinco cachés; al aterrizar
   en `/login`, quedaron **dos**:

   ```
   historial-medico-shell-v1
   historial-medico-estaticos-v1
   ```

   Las tres con datos personales —`paginas` (la ficha), `imagenes` (las fotos de
   la credencial) y `datos` (los payloads de los dos perfiles)— desaparecieron
   del dispositivo. Es el mecanismo de `lib/pwa/registrar-sw.ts#purgarCacheOffline`,
   montado en `/login` y no en el botón de logout justamente para cubrir también
   la sesión que vence sola.

Después de la prueba se restauraron el seed (las dos alergias originales), la
sesión y el túnel `adb reverse tcp:3000`.

**Lo que quedó sin verificar en pantalla:** el borrado del caché por revocación
de permiso con red (el camino 401/403/404 → `descartar` de
`decidirDestinoDeCache`). Está cubierto por `tests/unit/sw-offline.test.ts`,
pero no se ejercitó contra el teléfono: exige revocar el permiso de María sobre
Roberto en medio de la sesión, que es una prueba de `docs/modelo-permisos.md`
más que de esta tarea.

## Sprint 8 · checkpoint del sprint + tarea 8.5 — verificación del orquestador (2026-08-14, build de producción)

**Nota de auditoría:** la entrega original de 8.5 declaró una verificación en dispositivo que sus capturas no respaldaban (tres screencaps idénticos de `/sos` sin indicador). La verificación se rehízo desde cero por el orquestador sobre `next start` (el SW no controla páginas en `next dev`). El CÓDIGO de 8.5 resultó correcto; lo inválido era la evidencia.

**Procedimiento correcto para simular offline en este banco de pruebas** (el matiz importa):
- `adb reverse --remove tcp:3000` corta el ALCANCE al dev server (los fetch fallan) pero NO cambia `navigator.onLine` — el WiFi sigue conectado.
- `adb shell svc wifi disable` es lo que pone `navigator.onLine = false` y dispara el evento `offline` (el indicador). El túnel USB no depende del WiFi.
- Offline REAL de la demo = ambas cosas. Restaurar: `svc wifi enable` + `adb reverse tcp:3000 tcp:3000`.

Evidencia (sesión de María sobre el perfil de Roberto):

1. `sprint8-indicador-offline.png` — al apagar el WiFi, la barra **"Sin conexión — estás viendo datos guardados"** (tokens `--advertencia`, `role="status"`, `aria-live="polite"`) aparece bajo el header de forma inmediata (< 2 s, criterio de 8.5 cumplido).
2. `sprint8-offline-frescura.png` — `/sos` SIN red (WiFi off + túnel removido), servida entera por el service worker, con las imágenes de la credencial PAMI desde cache y los **DOS textos de frescura** al pie: "Datos revisados el 14/08/2026 04:51" (`sos_updated_at`) y "Copia descargada el 14/08/2026 05:09" (`generado_at` del payload, visible solo offline vía `FrescuraOffline`).
3. `sprint8-offline-fallback.png` — `/estudios` offline cae en la pantalla "Estás sin conexión" con la explicación de qué SÍ está disponible y el botón "Abrir mi ficha SOS" (no el error del navegador).
4. Restaurada la red, el indicador desaparece y `/sos` refresca su copia (verificado en la auditoría de 8.4 vía `generado_at`).

Las dos marcas de tiempo responden preguntas distintas (`docs/modelo-sos.md` §6.1) y las tres pantallas SOS formatean con `formatearRevisionSos` — ninguna arma su propio `Intl.DateTimeFormat`.

**Checkpoint del Sprint 8: APROBADO** con esta secuencia (cobertura + SOS cargados → offline → ficha y credencial legibles → fallback claro en el resto → refresco al volver la red).

## Sprint 9 · carga rápida de tensión, glucemia y peso (tarea 9.1) — verificación completa

**2026-08-14.** Sesión viva de María sobre el perfil gestionado de Roberto (la misma sesión de cierres anteriores, sin volver a loguearse), `adb reverse tcp:3000 tcp:3000`.

1. `/signos` muestra las mediciones del seed agrupadas por tipo, últimos valores primero: "Tensión arterial" con 139/81 mmHg (75 lat/min) "ayer" y 140/83 mmHg (74 lat/min) "hace 2 días", más los tres accesos grandes "Cargar tensión" / "Cargar glucemia" / "Cargar peso" — sin dropdown, criterio Senior UX del roadmap.
2. Tocar "Cargar tensión" abre `/signos/nuevo?tipo=tension` con Sistólica **autofocada** y el **teclado numérico nativo de Android** abierto de entrada (`sprint9-carga-tension.png`): solo dígitos y `Sig.`, ninguna tecla de letras.
3. Los tres campos (Sistólica, Diastólica, Pulso) llegaron precargados con la ÚLTIMA carga del mismo tipo (139 / 81 / 75, calcado de la tarjeta más reciente de `/signos`) — el prefill del roadmap funcionando con datos reales, no simulados.
4. Fecha y hora llegaron precargadas con "ahora" en los pickers **nativos** de Android (`14/08/2026`, `5:33 a.m.`), editables.
5. Enviar el formulario tal cual (sin tocar nada, el caso "3 toques y 4 números" del criterio de aceptación: tocar "Cargar tensión" en `/signos`, tocar "Sig." una vez para pasar de campo, tocar el botón de guardar) redirigió a `/signos?cargado=1` y la medición nueva apareció primera en la lista, con "hoy a las 05:33" y "14 de agosto de 2026 · 05:33 hs" — `tiempoRelativo` y el formato absoluto de `lib/turnos/formato.ts` reutilizados sin cambios.
6. La fila de prueba se borró después por SQL (`delete from vital_signs where id = '62292e5c-…'`) para dejar el seed de Roberto (2 tensiones, 1 glucemia, 1 peso) como estaba documentado en `scripts/seed.md` antes de la corrida.

No se re-verificó el teclado decimal de "Peso" en pantalla física (cubierto por `tests/unit/signo-schema.test.ts` y por inspección de `components/signos/formulario-signo.tsx#decimal`, que fija `decimal={tipo === "peso"}`), ni el camino de error de la base (sistólica 400) en el dispositivo — ese camino se verificó por SQL directo (ver el commit de la tarea) y por los 26 tests unitarios del schema, que cubren cada rango CHECK uno por uno.

## Sprint 9 · notificación de alerta al perfil administrador (tarea 9.3) — verificación completa

**2026-08-14.** `supabase db reset` había dejado `push_subscriptions` con la fila ficticia del seed (mismo caso 3 de `docs/push.md` §7 que ya documentó el cierre de 7.4): la sesión del teléfono se había invalidado y el `perfil_activo` cookie del navegador sí sobrevivió al reset -al reloguearse con la receta ADB de más arriba, la app aterrizó directo en `/inicio` con Roberto como perfil activo, sin pasar por el selector-.

1. **Reponer la suscripción real.** El banner de `/inicio` decía "Notificaciones activadas" -el navegador conservaba su `PushSubscription`, la base no-. Se tocó "Desactivar" y después "Activar recordatorios": sin prompt de permiso (el origen ya estaba autorizado), y quedó una fila nueva en `push_subscriptions` con un endpoint real `fcm.googleapis.com` para el `user_id` de María y `profile_id` de Roberto. Confirmado por SQL antes de seguir.
2. **Carga real por la UI.** `/signos/nuevo?tipo=tension`: Sistólica y Diastólica editadas a mano (`input keycombination` para seleccionar todo el campo antes de tipear, mismo criterio que la receta de login) a **170** y **110**, con Pulso, fecha y hora tal como venían precargadas. Tocar "Cargar tensión" redirigió a `/signos?cargado=1`.
3. **Menos de 30 segundos, de sobra.** El tap de submit y la notificación ya visible en la bandeja quedaron separados por **menos de 15 segundos** en las capturas tomadas con marca de tiempo (`sprint9-alerta-push.png`, expandida con `adb shell cmd statusbar expand-notifications`): título "Tensión alta registrada para Roberto" (truncado en la bandeja a "Tensión alta registrada p..."), cuerpo "170/110 (umbral 160/100). Valor orientativo — no reemplaza el criterio médico." — el texto agrupa las DOS reglas violadas (`sistolica_alta` + `diastolica_alta`) en un solo push, tal como pide `lib/signos/notificar.ts`. Confirmado por SQL: las dos filas de `vital_sign_alerts` quedaron creadas con `created_at` idéntico (09:33:53) y la suscripción real siguió sin `revoked_at` -entregada, no rebotada-.
4. **Tocar la notificación aterriza en el banner.** Navegó a `/signos` (vía `/signos/enlace?perfil=...`, sin pasar por el selector de perfiles) mostrando "Hay 4 alertas de signos vitales sin ver" -las 2 nuevas más las 2 del seed que ya estaban sin ver- (`sprint9-banner-alerta.png`), cada una con su propio botón "Ya lo vi" y, por haber más de una, "Marcar todas como vistas" debajo.
5. **"Ya lo vi" marca y desaparece.** Tocar el botón de la alerta de 170 mmHg la sacó de la lista al instante (4 → 3 alertas, sin recargar la página) y por SQL quedó `acknowledged_at = 2026-08-14 09:37:22` y `acknowledged_by` apuntando al perfil de **María Gómez** -el trigger `sellar_visto_de_alerta_signo` firmando con `perfil_actor()`, exactamente el criterio "se registra con usuario y hora" del roadmap-.
6. **Limpieza.** `delete from vital_signs where id = '613f621f-…'` se llevó por `ON DELETE CASCADE` las dos alertas de la carga de prueba, dejando el seed de Roberto (165/102, sin ver) como estaba documentado. La suscripción push real **se dejó activa a propósito** -sirve de checkpoint para la próxima tarea que necesite un dispositivo con notificaciones ya funcionando-.

Un tropiezo de la sesión de pruebas, anotado para quien repita esto: tras tocar la notificación una primera vez con la bandeja recién expandida, un segundo toque mal apuntado cerró la bandeja y aterrizó sobre un widget de control del hogar real del dueño del equipo (`SmartLife`/`eWeLink`, luces y calefacción) en la pantalla de inicio de Android. Se salió con `KEYCODE_HOME` sin tocar ningún control. Moraleja: expandir la bandeja de nuevo y confirmar con una captura ANTES de cada tap sobre una notificación, nunca encadenar taps a ciegas sobre una bandeja que puede haberse cerrado sola.

## Sprint 9 · historial y gráficos de signos vitales (tarea 9.4) — verificación completa

**2026-08-14.** Sesión viva de María sobre el perfil gestionado de Roberto (la misma sesión de cierres anteriores, sin volver a loguearse), `adb reverse tcp:3000 tcp:3000` seguía activo de la tarea 9.1/9.3.

1. `am start -a android.intent.action.VIEW -d "http://localhost:3000/signos/historial"` abrió la pantalla directo, sin pasar por el selector de perfiles (cookie de perfil activo intacta).
2. Con el chip "Tensión arterial" seleccionado por default y "30 días" activo, el gráfico dibujó las **6 mediciones** de tensión del seed (8/8 a 14/8) en dos líneas -sistólica salvia arriba, diastólica celeste abajo-, cada una con su propia banda de referencia sombreada (hasta 160 mmHg la de sistólica, hasta 100 mmHg la de diastólica) y el punto del 10/8 (165/102) marcado con un **triángulo naranja en las dos líneas**, no solo en una -confirma que `lib/signos/series.ts` separa el marcado por línea y que las dos alertas persistidas del seed (`sistolica_alta` + `diastolica_alta`) llegan cada una a su línea-.
3. **TAP real** (`adb shell input tap`, coordenadas leídas del propio screencap, no una simulación de mouse) sobre el triángulo de la línea sistólica: el anillo de selección saltó a ESE punto en las DOS líneas a la vez (mismo índice, mismo `vitalSignId` subyacente) y el panel de detalle se actualizó con "10 de agosto de 2026 · 22:25 hs", "165 mmHg" + "Por encima del umbral (160)" y "102 mmHg" + "Por encima del umbral (100)" -exactamente el texto que pide el criterio de aceptación del ROADMAP- (`sprint9-grafico-tension.png`). Antes del tap, el panel mostraba el punto más reciente (14/8, 139/81 mmHg, sin marca) por default -confirma que la selección inicial es "el último punto", no "el primero fuera de umbral"-.
4. Chip "Glucemia": grafica las **2 mediciones** del seed (148 y 156 mg/dL) como línea única con la banda 70-250 mg/dL sombreada, ninguna marcada -correcto, ninguna de las dos cruza el umbral-.
5. Chip "Peso": verificado por inspección de código y por el desktop preview (no se volvió a capturar en el dispositivo para no gastar más toques de la sesión compartida) -la nota "El peso no tiene una banda de referencia fija..." se ve debajo del gráfico, documentando en pantalla la decisión de no sombrear banda para ese signo.
6. Los tres chips de período (30 días / 90 días / Todo) no dispararon ninguna navegación de red -las 10 mediciones del seed caen todas dentro de los últimos 7 días, así que los tres períodos muestran la misma serie, cambio instantáneo sin parpadeo de carga-.
7. Contra `/estudios/tendencias`: se re-verificó en el navegador de escritorio (misma sesión) que la pantalla de Sprint 5 sigue idéntica -gráfico de una sola línea, chips de métrica, banda de HDL/Colesterol/Glucosa/Hemoglobina- tras extraer `puntosTriangulo`/`puntosRombo` a `components/graficos/formas-punto.ts`: los 20 tests de `series-laboratorio.test.ts` siguen en verde y el componente no cambió una línea de comportamiento, solo de dónde importa la geometría de los puntos.

**Total de mediciones del seed graficadas: 10** (6 tensión + 2 glucemia + 2 peso), tal como cuenta el criterio de aceptación del ROADMAP ("con 10 mediciones del seed las tres series se dibujan correctamente").
