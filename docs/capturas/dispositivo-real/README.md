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
| sprint10-medicos.png | `/medicos` (tarea 10.1) en el dispositivo real: directorio del perfil de Roberto con los dos médicos del seed, tarjeta de Dr. Carlos Rodríguez con especialidad, matrícula, institución y los botones grandes "Llamar"/"Cómo llegar" + "Editar"/"Dar de baja" (sesión de María, `can_manage`) |
| sprint10-medico-llamar.png | Tocar "Llamar" en la tarjeta del Dr. Rodríguez abre el discador nativo de Android con `+54 2901 23-4000` precargado -el mismo teléfono guardado en `doctors.phone`, sin reformatear-, confirmando que el `tel:` dispara el discador real y no un link muerto |
| sprint11-instalar-menu.png | Menú ⋮ de Chrome sobre `/inicio` (build de producción, `next start`) con **"Instalar y crear acceso directo"** presente -el criterio de instalabilidad de Chrome, equivalente al "Instalar aplicación" que pide el ROADMAP, pasa- |
| sprint11-offline-pantalla.png | `/offline` **actualizada** (tarea 11.3) en el dispositivo real, build de producción: bajo el botón grande "Abrir mi ficha SOS" aparece el bloque nuevo "También quedan guardadas las últimas versiones de estas pantallas, tal como las viste la última vez que tuviste señal" con los tres accesos **Coberturas / Turnos / Medicación**, y la aclaración de que las miniaturas de credencial no se ven sin red (§3.4 de `docs/offline.md`) |
| sprint11-qa-camara-nativa.png | Pruebas de dispositivo (tarea 11.7): tocar "Sacar foto" en `/estudios/nuevo` abre la cámara nativa de Samsung directo, sin selector intermedio -re-confirma el Sprint 4-. Recortada a la barra de controles de la cámara (configuración, flash, temporizador, relación de aspecto, HDR) para no exponer el living del dueño del dispositivo que quedaba de fondo en el visor |
| sprint11-qa-push-bandeja.png | Pruebas de dispositivo (tarea 11.7): notificación real "Prueba de recordatorios" en la bandeja del sistema, entregada en el mismo minuto del toque en "Enviar prueba (dev)" -consistente con los <15s de la tarea 9.3-, con una suscripción real repuesta por la UI (Desactivar → Activar) en vez de por SQL |
| sprint11-qa-deeplink-turnos.png | Pruebas de dispositivo (tarea 11.7): tocar la notificación real del push de prueba aterriza en `/turnos` -la URL del payload, no `/inicio`-, con la sesión de María sobre Roberto intacta |
| sprint11-qa-enlace-medicacion.png | Pruebas de dispositivo (tarea 11.7): `/medicacion/enlace?perfil=<uuid-roberto>` por URL directa, partiendo del perfil PROPIO de María, cambia el perfil activo a Roberto y aterriza en `/medicacion` mostrando su Enalapril y Glucophage -el bug que la ruta existe para evitar, probado de punta a punta- |
| sprint11-qa-enlace-signos.png | Pruebas de dispositivo (tarea 11.7): `/signos/enlace?perfil=<uuid-roberto>` por URL directa, mismo patrón: cambia el perfil activo desde María y aterriza en `/signos` con el banner de alertas de Roberto visible |
| sprint11-qa-instalar-menu.png | Pruebas de dispositivo (tarea 11.7): re-confirmación del menú "Instalar y crear acceso dire..." de la tarea 11.1, contra un build de producción real (`next build && npm run start` recién corridos en esta tarea, después de detectar que el servidor había quedado en `next dev`) |
| sprint11-qa-offline-sos.png | Pruebas de dispositivo (tarea 11.7): `/sos` sin red (corte real, `adb reverse --remove` + `svc wifi disable`, 0 redes conectadas confirmado por `dumpsys connectivity`), contra el build de producción real, con estilos completos, banda "Sin conexión — estás viendo datos guardados" y la hora del sistema (13:57) visible como evidencia del momento de la captura |
| sprint11-qa-dictado-boton.png | Pruebas de dispositivo (tarea 11.7): botón de micrófono junto al buscador de `/estudios`, re-confirmando el Sprint 5; disponibilidad real de `SpeechRecognition`/`webkitSpeechRecognition` verificada aparte por CDP (`Runtime.evaluate` en la pestaña del teléfono, no una inferencia por user-agent) |

| sprint13-selector-tamano.png | Pregunta "¿Cómo preferís ver la app?" (tarea 13.1) al pie del selector de perfiles, en el dispositivo real: las dos opciones A/a con "Letra grande" preseleccionada según la preferencia de la CUENTA de María, marcada con anillo, tilde y la palabra "Elegida" —nunca solo con color—, y la aclaración "Es tu preferencia, no la del perfil que elijas" |
| sprint13-inicio-grande.png | `/inicio` en modo GRANDE, tomada ANTES de tocar nada: es la referencia contra la que se compara que el rediseño no mueva un píxel del modo por defecto. El botón A/a ya está en el encabezado con la "A" resaltada |
| sprint13-inicio-chica.png | El mismo `/inicio`, misma sesión y mismo perfil, en modo CHICA tras un TAP real: el título del botón SOS entra en UNA línea en vez de dos, las DOS alertas de signos vitales entran completas con su botón "Marcar todas como vistas" (en grande la segunda quedaba cortada), la bottom nav baja de 85,5px a 72px y el nombre "Viendo a Roberto Gó…" se trunca menos. La "a" del conmutador quedó resaltada |
| sprint13-inicio-vuelta-grande.png | Vuelta a GRANDE con otro TAP en A/a, sin recargar: la pantalla queda idéntica a `sprint13-inicio-grande.png` —mismo salto de línea del SOS, mismo recorte de la segunda alerta, misma altura de nav—, que es el criterio "el modo grande no cambia ni un píxel" verificado en el dispositivo |
| sprint13-t1-grande-antes-inicio.png | Tanda 1 (13.2, shell + inicio + navegación): baseline de `/inicio` en GRANDE, tomada ANTES de tocar un solo archivo de esta tanda — sesión de María sobre Roberto, banner de 2 alertas de signos vitales visible |
| sprint13-t1-grande-antes-perfiles.png | Baseline de `/perfiles` en GRANDE, ANTES de tocar nada: grilla de 2 perfiles (María "Tu perfil", Roberto "Gestionado por vos") |
| sprint13-t1-grande-despues-inicio.png | `/inicio` en GRANDE, tomada DESPUÉS del rediseño completo de la tanda: comparada contra `sprint13-t1-grande-antes-inicio.png` es idéntica al píxel — mismo encabezado, mismo SOS, mismo banner, mismo turno apilado, mismas 6 cards de acceso en columna con su bajada completa. Cero diferencias |
| sprint13-t1-grande-despues-perfiles.png | `/perfiles` en GRANDE, DESPUÉS: idéntica a `sprint13-t1-grande-antes-perfiles.png` — mismo tamaño de avatar (96px), mismo `min-h-48`, misma pregunta de tamaño sin comprimir |
| sprint13-t1-chica-inicio.png | `/inicio` en CHICA tras el rediseño (tarea 13.2), tramo superior: el encabezado ahora muestra "Viendo a Roberto Gómez" COMPLETO (sin truncar, confirmado además por `scrollWidth === clientWidth` vía CDP), el banner de alertas entra con las DOS alertas completas MÁS el botón "Marcar todas como vistas" en la misma pantalla sin scrollear (en grande hacía falta scrollear para ver el segundo botón) |
| sprint13-t1-chica-inicio-turno.png | Próximo turno reorganizado a card horizontal: fecha ("16 De Agosto De 2026"), hora ("14:55 hs"), "en 2 días" y el badge "Pendiente" en una columna angosta a la izquierda con un divisor vertical, especialidad/médico/lugar a la derecha — los tres botones de acción (Cómo llegar / Pedir viaje / Al calendario / Editar) siguen debajo a ancho completo, sin recortar ninguno |
| sprint13-t1-chica-inicio-grilla.png | Grilla de 2 columnas de las 6 cards de acceso (Medicación, Signos vitales, Coberturas, Médicos, Ficha para el médico, Ficha SOS): ícono + título en una sola línea cada una, sin la bajada explicativa larga (es ayuda contextual, no dato clínico) — confirmado sin truncar por CDP (`scrollWidth === clientWidth` en las 6) |
| sprint13-t1-chica-perfiles.png | `/perfiles` en CHICA: los dos perfiles con avatar más chico (64px) y `min-h-36` en vez de `min-h-48`, y la pregunta de tamaño más discreta (título `text-lg` en vez de `text-xl`, botones más ajustados) pero SIGUE VISIBLE, con "Letra chica" marcada Elegida |
| sprint13-t4-chica-coberturas.png | `/coberturas` (tarea 13.5) en CHICA, dispositivo real: la tarjeta de PAMI — Pensionados combina plan + N.º de afiliado en una sola línea ("Cobertura integral · Afiliado 2890154780", antes 2 líneas separadas), con el badge "Principal" y las miniaturas de credencial más chicas lado a lado |
| sprint13-t4-chica-medicos.png | `/medicos` en CHICA, dispositivo real: las dos tarjetas del directorio combinan especialidad + matrícula + institución en una sola línea, con "Llamar"/"Cómo llegar" en fila compacta (medidos 49,5px de alto por CDP, ver más abajo) |
| sprint13-t4-chica-sos.png | `/sos` (ficha de emergencia) en CHICA, dispositivo real: el grupo sanguíneo "O+" sigue siendo, por lejos, el texto más grande de la pantalla (44px medidos, contra 26px del nombre) pese a la tarjeta más compacta (`py-6` → `py-4`) |
| sprint13-t5-chica-ficha.png | `/ficha` (tarea 13.6, Tanda 5 — LA ÚLTIMA) en CHICA, dispositivo real: el aviso de minimización quedó recortado a la frase esencial ("...no quieras compartir con un servicio externo.", sin el ejemplo entre paréntesis ni la explicación técnica, ocultos con `chica:hidden`) y "Generar ficha" sigue siendo un botón grande y de un solo toque |
| sprint13-t5-chica-login.png | `/login` en CHICA, dispositivo real, **sin sesión** (logout real por CDP y re-login por CDP para no arriesgar el password manager del dueño del equipo): confirma que las pantallas pre-sesión sí heredan el modo compacto de la cookie `tamano` -sin necesitar `profiles.display_density`, que no existe todavía para quien no inició sesión- tal como predice `curl -b tamano=chica http://localhost:3000/login` (`data-tamano="chica"` en el HTML) |

| sprint14-tokens-login.png | `/login` (tarea 14.1) en el dispositivo real **sin ninguna cookie**, después del cambio de default: el HTML llega con `data-tamano="chica"` y la pantalla se pinta en la densidad nativa v2 sin que nadie haya elegido nada. Se ven los tres pisos nuevos conviviendo: cuerpo de 14px, y los DOS campos en 16px —más grandes que el cuerpo, que es exactamente lo que la regla sin capa del piso de iOS produce a propósito—. La tarjeta del formulario mide 362,4px contra los 429px de la chica v1 |
| sprint14-tokens-offline.png | `/offline` en chica v2, dispositivo real: la pantalla **entra entera sin scroll** (documento de 775px contra un viewport de 775px), cuando en la chica v1 medía 861px y obligaba a scrollear para llegar al último párrafo. El botón "Abrir mi ficha SOS" y los tres accesos guardados conservan su alto táctil |
| sprint14-tokens-estilos.png | `/estilos` (kitchen sink del sistema) en chica v2, dispositivo real, tramo de Botones y Campos de Texto: los tamaños `Pequeño` / `Default` / `Grande` miden 40,5 / 40,5 / 45px —el `Pequeño` es el que la tarea tuvo que rescatar con `chica:min-h-tactil`, porque con la unidad de espaciado en 3,5px su `h-10` literal daba 35px— y el campo de texto muestra el piso de 16px |
| sprint14-velo-tamano.png | Velo de espera global (tarea "Feedback de espera global") tras un TAP real en A/a con la red del teléfono throttleada por CDP (`Network.emulateNetworkConditions`, 1,2s de latencia agregada): tarjeta centrada con blur de fondo, spinner grande y "Ajustando el tamaño de letra…", confirmado en el DOM en el momento exacto de la foto (`role="status"` con ese texto) — sin el throttling la Server Action vuelve antes de los 450ms del retraso propio del velo y nunca llega a aparecer |
| sprint14-velo-ingesta.png | Segunda etapa real de la ingesta de estudios en el dispositivo, con un PDF de prueba real (`analisis-sintetico.pdf`) elegido por el selector NATIVO de Android (`DOM.setFileInputFiles` vía CDP chocó con el sandboxing de archivos de Android 13/Chrome — `NotReadableError` — así que el archivo se pusheó a `/sdcard/Download` y se eligió tocando la UI real del picker de "Descargas"): "La inteligencia artificial está leyendo tu estudio…", visible mientras la llamada real a Gemini está en vuelo |
| sprint14-velo-ingesta-subiendo.png | Primera etapa de la misma subida, ~650ms después de tocar "Usar este archivo" (red throttleada): "Subiendo el archivo…" con el nombre y peso del archivo como submensaje (`analisis-sintetico.pdf — 1,3 KB`). El flujo completo se verificó de punta a punta hasta la pantalla de revisión (título sugerido "Análisis de laboratorio — Laboratorio Central", detectado por Gemini) y el documento de prueba se descartó al cerrar (`descartarDocumento`), sin dejar datos en la base local |

Flujo verificado con toques e ingreso de texto reales por ADB: login de María → selección del perfil gestionado de Roberto → inicio. El camino de error (submit vacío) también se verificó en pantalla física.

## Sprint 14 · tarea "Feedback de espera global" — velo de espera con etapas reales

**2026-08-17.** Samsung Galaxy A71 real (`R58N85AW49F`), sesión VIVA de María sobre el perfil gestionado de Roberto (heredada de las tandas anteriores, sin volver a loguearse). `adb reverse --list` confirmó `tcp:3000` ya activo; la primera pestaña de Chrome encontrada por `adb forward tcp:9222 localabstract:chrome_devtools_remote` estaba en realidad sobre **`https://www.historialmedico.com.ar/turnos/nuevo`** (producción) — quedó abierta de una sesión anterior del dueño del dispositivo. Se navegó de inmediato a `http://localhost:3000/inicio` sin tocar ningún campo de esa pestaña, para no arriesgar datos reales de producción.

**Método de captura.** El round-trip de las tres etapas contra el servidor LOCAL es demasiado rápido para fotografiarlo a ojo (Storage + Postgres en el mismo LAN, sin latencia real). Se usó `Network.emulateNetworkConditions` de Chrome DevTools Protocol (vía `adb forward tcp:9222` + un cliente WebSocket nativo de Node 24, mismo patrón `cdp.mjs` que las tareas 14.1-14.3) para agregar 1,2-1,8s de latencia agregada SOLO durante la captura, más que los 450ms del retraso propio del velo pero bastante menos que la latencia agregada, de forma de fotografiarlo mientras seguía montado. Cada captura se cruzó con una lectura del DOM en el mismo instante (`document.querySelector('[role="status"]').textContent`) para confirmar que el texto mostrado en la imagen es el que realmente estaba en pantalla, no una inferencia visual.

- **`sprint14-velo-tamano.png`:** TAP real en el botón A/a (`Input.dispatchMouseEvent` sobre las coordenadas CSS reales del botón, vía `getBoundingClientRect`). Confirmado en el DOM en el momento de la foto: `{"texto":"Ajustando el tamaño de letra…","visible":true}`.
- **`sprint14-velo-ingesta-subiendo.png`** y **`sprint14-velo-ingesta.png`:** subida real de un PDF de prueba (`analisis-sintetico.pdf`, ya presente en el repo en `.playwright-mcp/pruebas/`, con texto médico sintético). Primer intento con `DOM.setFileInputFiles` (setear el archivo directo en el `<input>` oculto vía CDP, sin tocar la UI del selector) chocó con el sandboxing de archivos de Android 13 + Chrome: `Runtime NotReadableError` al intentar leer un archivo recién pusheado a `/sdcard/Download` aunque estuviera media-scaneado (`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE`) — el acceso a documentos (a diferencia de fotos/video, que sí entran por MediaStore) exige el grant de la Storage Access Framework, que solo se obtiene pasando por el picker real. Se resolvió tocando la UI nativa de verdad: `adb shell input tap` sobre la tarjeta "Elegir un PDF", el selector de documentos de Android ("Descargas") y el archivo pusheado, confirmado con capturas `adb exec-out screencap` de pantalla completa en cada paso. Con el archivo ya elegido por ese camino, el resto de la subida (click en "Usar este archivo", throttling, capturas) volvió a CDP.
  - Confirmado en el DOM ~650ms después del click: `{"texto":"Subiendo el archivo…analisis-sintetico.pdf — 1,3 KB. Esto puede tardar hasta un minuto. No cierres la aplicación."}`.
  - Confirmado en el DOM ~4,15s después del click, ya en `/estudios/nuevo/procesando`: `{"texto":"La inteligencia artificial está leyendo tu estudio…Esto puede tardar hasta un minuto. No cierres la aplicación."}` — la llamada a Gemini en esta captura es REAL, no simulada.
  - El flujo se siguió hasta la pantalla de revisión (título sugerido por Gemini: "Análisis de laboratorio — Laboratorio Central", consistente con el contenido del PDF de prueba), y el documento se descartó ("Cancelar" → "Sí, descartar") antes de cerrar la tarea: `/estudios` volvió a "Todavía no hay estudios cargados", sin dejar el documento de prueba en la base local. El PDF pusheado se borró del dispositivo (`adb shell rm /sdcard/Download/analisis-sintetico.pdf`).

**No se pudo fotografiar la tercera etapa ("Guardando…", `formulario-revision.tsx`) por separado**: el RPC `confirmar_documento_recien_subido` contra Supabase local también resuelve por debajo de los 450ms del retraso del velo en la red throttleada de esta corrida, y repetir la subida completa solo para esa captura habría dejado un segundo documento de prueba en la base. Queda cubierta por el test automatizado (mismo componente, mismo mecanismo de aparición diferida que las dos etapas sí fotografiadas) y por lectura de código: `components/documentos/formulario-revision.tsx` monta `<VeloEspera visible={pendienteConfirmar} mensaje="Guardando…" />` con el mismo componente que las dos capturas de arriba.

**Suites completas:** `npx tsc --noEmit` limpio; `npx eslint .` sobre el proyecto completo, limpio (incluido un hallazgo real de `react-hooks/set-state-in-effect` en `velo-espera.tsx`, resuelto con el mismo patrón de "ajustar estado durante el render" que ya usa `boton-tamano.tsx`); `npm run test` → **753/753 tests** (744 previos + 9 nuevos de `tests/unit/base/velo-espera.test.tsx`, primer test de esta suite que renderiza un componente real — `jsdom` y `@testing-library/react` se sumaron como devDependencies solo para ese archivo, con `// @vitest-environment jsdom` acotado a él; el resto de `tests/unit/` sigue en `environment: "node"`); `node scripts/verificar-contraste.mjs` → **196/196 PASS, 0 fallas** (sin tokens de color nuevos: el velo usa `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `text-primary`, `shadow-elevada`, `ring-border`, todos ya cubiertos). `npm run build` corrido con el dev server detenido (`netstat -ano | findstr :3000` confirmó el puerto libre después de matar el proceso de `next dev`), build de producción exitoso.

## Sprint 14 · tarea 14.1 — Retokenizado nativo del modo compacto: medición en el dispositivo

**2026-08-17.** Samsung Galaxy A71 (SM-A715F), Chrome 151, `adb reverse tcp:3000 tcp:3000` + `adb forward tcp:9222 localabstract:chrome_devtools_remote`, ancho CSS real reportado por el propio navegador: **411px**.

**Método.** La misma página, el mismo DOM y el mismo dispositivo, medidos con `Runtime.evaluate` por CDP (WebSocket nativo de Node 24, sin librerías). Las dos densidades se obtienen flipeando `document.documentElement.dataset.tamano`, que es la técnica que documenta `docs/densidad.md` §5. Las dos versiones del código se obtienen con `git stash` / `git stash pop` sobre el árbol, con el `next dev` recompilando en el medio: así la comparación v1 vs v2 es contra el código real de cada una, no contra una simulación de tokens.

### El modo grande quedó IDÉNTICO (criterio "ni un píxel")

Medido elemento por elemento en las tres páginas, con v1 y con v2:

| Medición en GRANDE | Chica v1 (código del Sprint 13) | Chica v2 (código del Sprint 14) |
|---|---|---|
| `/estilos` — alto del documento | 10281px | **10281px** |
| `/estilos` — alto de las 8 primeras tarjetas | 150 / 152,3 / 183,6 / 158,5 / 159,6 / 198,8 / 204,1 / 215,7 | **idénticas** |
| `/estilos` — alto y tipografía de los 10 botones visibles | 49,5×7, 45, 49,5, 58,5px | **idénticos** |
| `/estilos` — alto y tipografía de los campos | 49,5px / 18px | **idénticos** |
| `/estilos` — `h1` y `h2` | 28px/36,4px y 32px/39,04px | **idénticos** |
| `/login` y `/offline` — documento, tarjetas, botones, campos | — | **idénticos** |

Cero diferencias. Es una comparación numérica y no visual a propósito: un pixel-diff de capturas del teléfono arrastra la barra de estado (reloj, batería) y produce falsos positivos; `getBoundingClientRect` y `getComputedStyle` no.

### Lo que ganó el modo compacto

| Medición en CHICA | v1 | v2 | Ratio |
|---|---|---|---|
| `/estilos` — alto total del documento | 8453px | 6816px | **1,24×** |
| `/estilos` — alto de las 7 tarjetas simples | 129,2 / 130,6 / 132,9 / 135 / 135,9 / 137,6 / 171,3px | 96,3 / 98 / 99,7 / 100,3 / 100,9 / 102,6 / 104,1px | **1,32× a 1,65×** |
| `/login` — tarjeta del formulario | 429px | 362,4px | **1,18×** |
| `/offline` — alto total del documento | 861px (con scroll) | 775px (**entra entera**) | 1,11× |
| Cuerpo de texto (caja de línea) | 16px / 24px | 14px / 19,6px | 1,22× |
| `h2` de sección (`text-3xl`) | 26px / 31,2px | 20px / 24px | 1,30× |
| Padding y gap de tarjeta (`--card-spacing`) | 20px | 12,25px | 1,63× |

**El criterio de ≥1,7× NO se alcanza con tokens, y la medición muestra por qué.** Un botón mide 40,5px, de los cuales 19,6px son la caja de línea de su etiqueta y el resto es el piso táctil de 40px que el ROADMAP fija y que esta tarea no mueve. Los controles no se achican; en una pantalla como `/medicacion` son una fracción grande del alto. El techo estructural de la retokenización está entre 1,25× y 1,35×, y el resto del camino es reorganización de layout (tarjetas → filas, grillas a 2-3 columnas), que es lo que el ROADMAP le asigna a las tandas de la tarea 14.2. Ver `docs/densidad.md` §5-bis.

### Verificaciones adicionales en el dispositivo y contra el servidor

- **Default chica sin sesión, en el teléfono:** `/login` cargó con `data-tamano="chica"` y `innerWidth === 411`, sin ninguna cookie `tamano` y sin sesión (la del sprint anterior murió con el `db reset`).
- **Resolución pre-sesión, contra el servidor:** `curl -s http://localhost:3000/login` → `data-tamano="chica"`; ídem `/registro` y `/offline`; `curl -s -b "tamano=grande" http://localhost:3000/login` → `data-tamano="grande"` (la cookie sigue teniendo prioridad sobre el default).
- **Los tres pisos, medidos y no supuestos:** cuerpo `14.0004px`, campos de formulario `16.0002px` (los cuatro `input` de `/estilos`), objetivo táctil `40,5px` en los diez botones visibles salvo el `lg` (45px).
- **Tokens efectivos leídos del `<html>` del teléfono:** `--spacing: .1944rem`, `--radius: .5556rem`, `--spacing-bottom-nav: 3.5556rem`, `--spacing-tactil: max(40px, 2.25rem)`, `--card-spacing: calc(.1944rem * 3.5)`.

### Lo que NO se pudo verificar en el dispositivo, y por qué

`/inicio` y `/medicacion` —las dos pantallas que nombra el criterio de aceptación, con la tarjeta de Enalapril del seed— **exigen sesión iniciada**, y la sesión del Sprint 13 quedó invalidada por el `npx supabase db reset` de esta tarea. Iniciarla implica escribir una contraseña en un formulario, que es una acción que el ejecutor no realiza. Queda para que la corra el usuario o el orquestador, en un minuto:

```
adb reverse tcp:3000 tcp:3000
adb forward tcp:9222 localabstract:chrome_devtools_remote
# login de María en el teléfono (receta de más abajo en este archivo)
# y después, con la sesión viva, el mismo medidor que produjo las tablas de arriba
```

Las mediciones de arriba cubren, sobre pantallas reales, los mismos primitivos con los que están hechas esas dos pantallas: tarjeta (`Tarjeta` / `Card`), botón en sus tres tamaños, campo de texto, tipografía completa y el shell tipográfico.

## Sprint 14 · tarea 14.2 — Tanda A: layouts densos (inicio, medicación, signos, turnos)

**2026-08-19.** Samsung Galaxy A71 real (`R58N85AW49F`), `adb reverse tcp:3000 tcp:3000` + `adb forward tcp:9222 localabstract:chrome_devtools_remote`, sesión VIVA de María sobre el perfil gestionado de Roberto (heredada de la tarea 14.1, sin volver a loguearse), `innerWidth === 411`, `data-tamano="chica"` confirmado en las cuatro pantallas. Medición vía CDP con un cliente WebSocket nativo de Node 24 (`Runtime.evaluate`/`Page.navigate`/`Page.captureScreenshot`, sin librerías — mismo método que 14.1).

### Qué cambió por pantalla

- **`/inicio`:** grilla de accesos a **3 columnas** (no 2) — la cifra se decidió por lo que entra bien en los ~383px útiles, no por mandato: medido en el dispositivo, cada tile de ~121px entra con el ícono y el título en 1-2 líneas sin recorte. De las seis, solo "Ficha para el médico" (21 caracteres) necesitó un label corto exclusivo de chica ("Ficha médica", con `title` completo en el `<Link>`); las otras cinco -incluida "Signos vitales", 14 caracteres- entran con su título de siempre, confirmado con `innerText` + `scrollWidth <= clientWidth` por CDP sobre las seis. El saludo "Estás viendo el historial de {nombre}" se sacó de la vista -era el mismo dato que ya dice el encabezado ("Viendo a Roberto Gómez")- pero el `<h1>` se mantiene en el DOM con `chica:sr-only` (no `chica:hidden`): una pantalla sin ningún `<h1>`, visible o no, es un salto de nivel real para un lector de pantalla. El banner de alertas pasó de columna a fila -mensaje a la izquierda, "Ya lo vi" compacto a la derecha-, y la card de próximo turno combina fecha+hora en un renglón (`formatearFechaCortaTurno` nuevo en `lib/turnos/formato.ts`) en vez de los 3 renglones + badge de antes.
- **`/medicacion`:** cada tarjeta de medicación activa/suspendida pasa de 4-5 bloques apilados (encabezado, droga, dosis, panel de stock con su propio borde, link de receta) a 3 renglones densos -nombre+badge de días, droga·presentación·dosis-frecuencia, chips de horario+stock resumido- más Editar/Suspender/Ver receta como íconos de 40px (`size="icon-sm"`, `aria-label` con el nombre de la medicación) en vez de botones de texto. "Tomas de hoy" pasa de tarjetas de 3 secciones a una fila -hora+nombre a la izquierda, "Tomé"/"Tomada" compacto a la derecha-.
- **`/signos`:** las últimas mediciones de cada tipo pasan de tarjetas apiladas a una `<table>` real -Valor (mono, `numeros-clinicos`) y Fecha (relativo + fecha larga + hora, sin recortar ningún dato)-, agrupada por sección de tipo (el `<h2>` ya cumple el rol de la columna "tipo": repetirla en cada fila sería el mismo texto cinco veces). Los tres botones de carga, ya en fila desde el Sprint 13, se re-verificaron contra los tokens nuevos de 14.1 sin cambios de código.
- **`/turnos`:** mismo patrón de fecha+hora combinadas que `/inicio` (componente compartido, `components/turnos/tarjeta-turno.tsx`), y los tres botones de logística con label corto ("Llegar"/"Viaje"/"Agenda" en vez de "Cómo llegar"/"Pedir viaje"/"Al calendario") vía el mismo patrón `chica:hidden`/`hidden chica:inline` que combina droga+presentación en la tarjeta de medicación.
- **Fix incluido (bug preexistente, no de densidad):** hydration mismatch real en `components/base/boton-dictado.tsx`, causado por `hooks/use-reconocimiento-voz.ts#useReconocimientoVoz` -el `soportado` arrancaba con un lazy initializer de `useState` que evaluaba `typeof window` DURANTE el render, dando `false` en SSR y `true` en el primer render del cliente (Chrome Android soporta `SpeechRecognition`), un mismatch real que React resolvía descartando y reconstruyendo el árbol en cada pantalla con `campo-texto.tsx#conDictado` (`/estudios` entre ellas). Arreglado moviendo la detección a un `useEffect` (arranca en `false` en los dos lados, se actualiza recién post-hidratación) -ver el comentario de cabecera del hook para el detalle completo, incluida la razón por la que la función interna es necesaria para no chocar con `react-hooks/set-state-in-effect`-.

### El bug de datos que la comparación /inicio vs /turnos dejó a la vista

Comparando la MISMA tarjeta de turno (Cardiología, 19 de agosto) entre `/inicio` y `/turnos` con CDP, la de `/inicio` mostraba "Pedir viaje" (con coordenadas) y la de `/turnos` mostraba "Cargá las coordenadas del lugar para pedir un viaje" -mismo turno, resultado distinto-. La causa: `app/(app)/(con-nav)/turnos/page.tsx` arma su `SELECT` con una constante `COLUMNAS` que NO incluye `latitude, longitude, preparation_notes`, mientras que `lib/turnos/obtener-proximo.ts` (la fuente de la card de `/inicio`) sí las trae. No es un bug de esta tanda -no se tocó ninguna consulta a Supabase-, así que se flagueó como tarea aparte (`task_2b202015`) en vez de arreglarse acá.

### Medición del criterio: contenido vertical vs Sprint 13 (v1)

Tres estados del mismo código y el mismo dispositivo, alternados con `git stash`/`git stash pop` (código) y una copia temporal de `app/globals.css` desde el commit `fd90990` -el HEAD anterior al retokenizado de la tarea 14.1, idéntico a `37a592d` (Checkpoint Sprint 13)- para el estado de tokens v1, restaurada byte a byte al terminar (`git diff --stat app/globals.css` sin salida tras restaurar):

| Elemento | v1 (Sprint 13) | v2 tokens solo (14.1) | v2 + Tanda A (esta tarea) | Ratio v1 → Tanda A |
|---|---|---|---|---|
| `/medicacion` — tarjeta de Enalapril | 239,3px | 207,4px | **134,5px** | **1,78×** |
| `/inicio` — documento completo | 1726px | 1500px | **1206px** | 1,43× |
| `/inicio` — card de próximo turno | 305,5px | — | **216,8px** | 1,41× |
| `/inicio` — tile de la grilla de accesos | 106px | — | **75,6px** | 1,40× |

**`/medicacion` supera el objetivo de ≥1,7× del encargo. `/inicio` no lo alcanza en el documento completo (1,43×), aunque sus piezas reorganizadas por esta tanda rinden ~1,4× cada una, consistente con `/medicacion`.** La diferencia no es falta de trabajo en las piezas que tocó la tanda: es que una fracción grande y FIJA de `/inicio` queda fuera del alcance de esta tarea y no se comprime -el botón SOS (`--spacing-sos-boton`, "no se toca" por decisión explícita de 14.1, docs/densidad.md §5-bis punto 6), el banner "Notificaciones activadas" (`components/notificaciones/activar-notificaciones.tsx`, no listado en el encargo de esta tanda) y el pie de enlaces legales-. Esos tres bloques miden un total comparable entre v1 y Tanda A porque ninguno de los dos los cambió, así que empujan el ratio del DOCUMENTO COMPLETO hacia abajo aunque el contenido que sí se tocó rinda igual que en `/medicacion`. Métrica y motivo declarados para que Fable audite con los números reales, no una afirmación.

### Grande intacto (método stash + DOM-metrics de 14.1)

`git stash` de los 10 archivos de esta tanda (sin tocar `app/globals.css`, que esta tanda no modifica) + `data-tamano="grande"` forzado en el `<html>` real vía CDP, contra `/medicacion` con la MISMA sesión:

| Medición en GRANDE | Con la Tanda A (stash pop) | Sin la Tanda A (stash) |
|---|---|---|
| `/medicacion` — alto del documento | 1328px | 1328px |
| Tarjeta de Enalapril | 385,30px | 384,86px |
| Tarjeta de Glucophage | 502,51px | 502,07px |

Diferencia máxima: 0,44px (0,11%) — ruido de subpíxel entre dos cargas de página (mismo orden de magnitud que el 0,018% que ya documentó Sprint 13 tanda 3 con pixel-diff), no un cambio de layout. En `/inicio`, forzar `grande` confirma además que el `<h1>` NO queda `sr-only` fuera de chica (`h1_height: 39px`, texto "Roberto Gómez" completo) y que la grilla de accesos sigue siendo la columna apilada de siempre (sin `grid-cols-3`, que es una clase `chica:`).

### Consola limpia en `/estudios` (fix del dictado)

Capturado con `Runtime.consoleAPICalled`/`Runtime.exceptionThrown` por CDP durante 5 segundos desde la navegación, en las dos versiones del código:

- **CON el bug** (`git stash` de esta tanda, hook con el lazy initializer viejo): `Uncaught Error: Hydration failed because the server rendered HTML didn't match the client`, con el stack apuntando exactamente a `<BotonDictado onTranscripcion={...}> <div className="relative flex items-center">` dentro de `<CampoTexto id="buscador-e...">` de `/estudios` — reproducido en vivo, no una suposición.
- **CON el fix** (código de esta tanda): `[]` — cero errores, cero warnings, cero excepciones.

(El único otro error que aparece en la corrida "con el bug" -"Encountered a script tag while rendering React component"- es el warning dev-only de `next-themes` con React 19 ya diagnosticado y cerrado en el Sprint 12, commit `ca1b9f9`; no depende de esta tanda y no aparece en producción.)

### Suites completas (código final, tras restaurar todos los `stash`/`git show` temporales)

`npx tsc --noEmit` limpio; `npx eslint .` sobre el proyecto completo, limpio (incluido el hallazgo real de `react-hooks/set-state-in-effect` en el hook del dictado, resuelto con el patrón de función interna que ya usa `activar-notificaciones.tsx`); `npm run test` → **744/744 tests**; `node scripts/verificar-contraste.mjs` → **196/196 PASS, 0 fallas** (sin tokens de color nuevos, tanda puramente estructural); `npm run build` → build de producción exitoso, 46 rutas. RLS: N/A, no se tocó SQL. Todos los archivos verificados UTF-8 sin BOM (`od -An -tx1` sobre los 10 archivos tocados).

## Sprint 14 · tarea 14.3 — Tanda B (LA ÚLTIMA): estudios, coberturas, médicos, familia y SOS

**2026-08-17.** Samsung Galaxy A71 real (`R58N85AW49F`), `adb reverse tcp:3000 tcp:3000` + `adb forward tcp:9222 localabstract:chrome_devtools_remote`, sesión VIVA de María sobre el perfil gestionado de Roberto (heredada de la tanda A, sin volver a loguearse), `innerWidth === 411`, `data-tamano="chica"` confirmado en las siete pantallas tocadas. Medición vía CDP con un cliente WebSocket nativo de Node 24 (`Runtime.evaluate`/`Page.navigate`/`Input.dispatchMouseEvent`, sin librerías — mismo método que las tandas anteriores; `cdp.mjs` del ejecutor agrega un comando `click` sobre coordenadas CSS reales del propio DOM, más preciso que traducir a coordenadas de pantalla del `adb input tap`).

### Qué cambió por pantalla

- **`/estudios`:** se evaluó explícitamente grilla de 2 columnas contra filas de 1 columna con los títulos REALES del seed ("Análisis de sangre completo — Laboratorio Central", 49 caracteres; "Informe administrativo — Antecedentes médicos", 47). A 411px, 2 columnas dejan ~150px de texto por tile -esos títulos largos exigirían truncar con `line-clamp`, prohibido por la regla 5 para un dato que la persona tituló-, así que ganaron las filas: título 1-2 líneas sin recorte, categoría·fecha·institución en un renglón combinado (ya existente desde la tarea 13.3) y resumen IA en 1 línea (`chica:line-clamp-1`, también existente). El trabajo de esta tanda fue confirmar la decisión con `scrollWidth === clientWidth` en las 7 tarjetas reales (0 truncados) y agregar `title` completo al `<Link>`. Encabezados de mes de `chica:text-sm` a `chica:text-xs` con menos padding. Barra de filtros: chips de filtro activo más chicos (`chica:py-1 chica:text-xs`); el resto ya venía denso vía tokens.
- **`/estudios/tendencias` y `/signos/historial`:** alto de gráfico bajado de 200 a **180px** en chica (grande sigue en 260, confirmado por diff de código y por una medición real en el dispositivo forzando grande con un toque genuino en A/a — 260px exactos, `.recharts-wrapper` medido por CDP). Los ejes usan `fontSize`/`height`/`width` fijos en Recharts, así que los 20px cedidos salen del área de trazado; verificado sin superposición de ticks en tensión (2 líneas), glucemia y colesterol del seed. `TarjetaUltimoValor` (sin ningún `chica:` interno hasta ahora) gana reducciones de gap/tamaño; badge de rango y variación pasan de apiladas a una fila. `BotonExportar` (CSV) gana el piso táctil de 40px explícito en chica (`chica:min-h-tactil`) y tipografía/ícono más chicos.
- **`/coberturas`:** la tarjeta pasa de columna (encabezado, miniaturas, acciones apiladas) a fila -encabezado (proveedor+badge "Principal") y miniaturas de credencial **a la derecha**, compartiendo un renglón-, con un wrapper que repite el `gap-4` que esos dos bloques ya tenían como hijos directos de la `Tarjeta`: en GRANDE el resultado es pixel a pixel el mismo layout apilado de siempre. Miniaturas de `chica:size-14` (56px) a `chica:size-12` (42px, medido por CDP: 41,99px reales, por encima del piso de 40px porque son botones tocables). Plan+afiliado ya venían combinados en una línea desde la tarea 13.5.
- **`/medicos`:** "Cómo llegar" gana el label corto "Llegar" en chica (mismo patrón `chica:hidden`/`hidden chica:inline` que ya usa `acciones-turno.tsx`); "Llamar" se queda como está por ser ya corto. Editar/Dar de baja/Reactivar pasan a íconos-botón de 40px (`size="icon-sm"`, `aria-label` con el nombre del médico) siguiendo EXACTO el patrón de `acciones-medicacion.tsx` de la tanda A: dos árboles (`chica:hidden` / `hidden chica:flex`), nunca los dos en el DOM accesible a la vez.
- **`/familia`:** "Revocar acceso" pasa a ícono-botón de 40px en chica, mismo patrón de dos árboles que médicos/medicación (`DialogoConfirmacion` no acepta `className`, así que cada árbol es un `<div>` propio con `chica:hidden` / `hidden chica:flex chica:justify-end` alrededor de una instancia completa del diálogo). El mini-formulario de permisos (`canUpload`/`canManage`) se queda con su botón de texto "Guardar cambios" -a diferencia de una acción de un toque, acá hay que leer dos casillas antes de decidir, así que el rótulo ayuda a confirmar qué se guarda-. Avatar de `size-11` a `chica:size-9`, gaps y badges más apretados. Formulario de invitar: paddings y gaps un escalón más chicos.
- **`/sos` (ficha) y `/perfil/sos` (edición):** espaciados comprimidos un escalón más -gap del contenedor de página de `chica:gap-4` a `chica:gap-3`, tarjeta del grupo sanguíneo de `chica:py-4` a `chica:py-3`, tarjeta de contacto de emergencia de `chica:gap-2` a `chica:gap-1.5`- manteniendo intactas las DOS jerarquías protegidas del Sprint 13: el grupo sanguíneo sigue siendo, por lejos, el texto más grande de la pantalla (`text-6xl`, sin tocar) y el botón `tel:` del contacto de emergencia sigue en `min-h-tactil-amplio` (excepción deliberada al piso de 40px, documentada en el comentario del propio componente). `/perfil/sos` ya tenía grillas de 2 columnas para Nombre/Vínculo (tarea 13.5); no se encontró otro grupo de campos donde una grilla de 2 aportara sin forzar el orden de tabulación.
- **`/compartir` y `/ficha`:** verificados contra los tokens nuevos de la tarea 14.1 sin encontrar aire heredado que ameritara un cambio -las dos pantallas ya tienen tratamiento `chica:` completo desde la tarea 13.6-. Sin cambios de código, por instrucción explícita del encargo ("no rediseñes").

### Sin truncados con datos reales del seed

`document.documentElement.scrollWidth === clientWidth` (411 = 411, sin scroll horizontal de página) confirmado en `/estudios`, `/coberturas`, `/medicos` y `/familia`. Título por título en `/estudios` (los 5 documentos reales del seed, incluidos los dos más largos): `scrollWidth === clientWidth` en las 7 tarjetas (2 accesos + 5 documentos). Miniaturas de credencial de `/coberturas` medidas en 41,99×41,99px reales (botones tocables, por encima del piso de 40px).

### Medición CDP: 2 elementos de referencia por pantalla, vs v1 del Sprint 13

**Método**, igual que el de la tarea 14.2: la MISMA sesión y el MISMO DOM, con tres estados por elemento — v1 (código de esta tanda revertido con `git stash` **y** `app/globals.css` reemplazado temporalmente por la copia del commit `fd90990`, el HEAD anterior al retokenizado 14.1), v2-tokens-solo (mismo `git stash`, tokens actuales) y v2+Tanda B (código final). `app/globals.css` se restauró byte a byte entre cada medición (`git diff --stat app/globals.css` sin salida tras cada restauración).

| Elemento de referencia | v1 (Sprint 13) | v2 tokens (14.1) | v2 + Tanda B | Ratio v1 → Tanda B |
|---|---|---|---|---|
| `/estudios` — tarjeta "Análisis de sangre completo" (la más larga del seed) | 151,67px | 123,94px | **123,94px** | 1,22× |
| `/coberturas` — fila de PAMI — Pensionados | 220,06px | 192,83px | **153,60px** | **1,43×** |
| `/medicos` — fila del Dr. Carlos Rodríguez | 191,82px | 170,90px | **170,90px** | 1,12× |
| `/familia` — primera fila de permiso (María) | 305,01px | 272,65px | **258,65px** | 1,18× |

**Ninguna pieza alcanza el 1,5-1,8× de la tanda A, y hay que decirlo sin adornarlo.** El motivo es distinto en cada caso, no una falta de esfuerzo:

- **`/estudios` no se restructuró a propósito** (0 cambio v2→TandaB): la evaluación 2 columnas vs. filas -documentada en el comentario de cabecera de `tarjeta-estudio.tsx`- concluyó que la tarjeta YA estaba en su forma óptima desde la tarea 13.3 (fila de 3 renglones: icono+título, meta combinada, resumen). El único techo que queda es el mismo de la tarea 14.1: título y resumen son texto real que no se puede recortar sin perder datos.
- **`/medicos` tampoco cambia de alto** (170,9px en los dos casos): la fila la domina el grid de 2 botones `size="lg"` (Llamar/Llegar, ~49,5px cada uno más el gap), un elemento que esta tanda no tocó -el label corto de "Llegar" ahorra ANCHO, no ALTO-. Los íconos de Editar/Dar de baja SÍ bajan de alto individualmente (de una fila de botones de texto a una fila de 40×40px), pero como quedan por debajo de la fila de Llamar/Llegar en el flujo, no mueven el alto total de la tarjeta.
- **`/coberturas` (1,43×) es la que más rindió**, y es la única de las cuatro con una reorganización de verdad (miniaturas al lado del texto en vez de debajo): 1,26× de esa cifra es aporte estructural puro de esta tanda (192,83 → 153,60px), consistente con el rango de la tanda A.
- **`/familia` (1,18×) es un caso limitado por contenido, no por diseño**: el mini-formulario de dos checkboxes con su rótulo y su botón "Guardar cambios" es funcionalidad, no aire decorativo, así que no se puede comprimir sin sacar la forma de editar el permiso (prohibido por la regla 5). El único ítem que se pudo iconificar sin perder función fue "Revocar acceso".

El objetivo original del encargo ("~1,5-1,8× como la tanda A") se cumple en la pieza que tenía margen real (`/coberturas`) y no en las otras tres, cuyo alto está dominado por controles con piso táctil fijo (medicos) o por una decisión deliberada de no tocar un layout que ya estaba óptimo (estudios) o por contenido funcional que la regla 5 protege (familia). Métrica y motivo declarados para que se audite con los números reales, como pide la tanda A.

### Grande intacto (método stash + DOM-metrics de la tanda A, más un toque real)

`git stash` de los 18 archivos de esta tanda + `data-tamano="grande"` forzado en el `<html>` real vía CDP (mismo método de la tarea 14.2), comparado contra el código final (stash pop):

| Medición en GRANDE | Con la Tanda B (stash pop) | Sin la Tanda B (stash) |
|---|---|---|
| `/estudios` — alto del documento | 2103px | 2103px |
| `/estudios` — alto de las 7 tarjetas | 58,5 / 58,5 / 174,24 / 297,68 / 174,24 / 232,58 / 203,04px | **idénticos** |
| `/coberturas` — alto del documento / fila de PAMI | 775px / 346,63px | **idénticos** |
| `/medicos` — alto del documento / 2 filas | 1089px / 348,69px × 2 | **idénticos** |
| `/familia` — alto del documento / 2 filas | 2479px / 525,89px, 446,39px | **idénticos** |
| `/sos` — alto del documento / tarjeta de grupo sanguíneo / botón `tel:` | 2114px / 151,95px / 70px | **idénticos** |
| `/perfil/sos` — alto del documento | 2723px | **idéntico** |

Diferencia máxima: 0px en las siete pantallas — no 0,1x% de ruido de subpíxel como en la tanda A, exactamente cero, medido dos veces con el mismo método.

**Nota metodológica sobre `/estudios/tendencias` y `/signos/historial`:** forzar `data-tamano="grande"` vía CDP en el `<html>` NO alcanza para verificar el alto del gráfico Recharts, porque ese alto es un prop NUMÉRICO que "tendencias/page.tsx"/"signos/historial/page.tsx" resuelven **server-side** con `obtenerTamano()` y bajan por props -no una clase CSS que reaccione al atributo forzado del lado del cliente-. Forzando el atributo se obtuvo una diferencia aparente de 20px en el alto del documento (exactamente el delta chica 200→180 de esta tanda), que en un primer momento pareció una regresión de grande y en realidad era el gráfico siguiendo renderizado en chica pese al atributo forzado. Se corrigió con dos verificaciones más fuertes: (1) diff de código -`grep` sobre `git diff` confirma que la línea `grande: 260` es idéntica en las dos versiones de los dos archivos, ni un carácter tocado-, y (2) un toque REAL en el botón A/a (`Input.dispatchMouseEvent` de CDP sobre las coordenadas CSS reales del botón, no una coordenada de pantalla adivinada) que cambia la cookie `tamano` server-side de verdad: con la sesión resuelta en `grande` genuino, `/estudios/tendencias` midió `.recharts-wrapper` en **260px exactos**. La sesión se devolvió a chica con el mismo mecanismo (otro toque real) antes de seguir.

### Suites completas

`npx tsc --noEmit` limpio; `npx eslint .` sobre el proyecto completo, limpio; `npm run test` → **744/744 tests**; `node scripts/verificar-contraste.mjs` → **196/196 PASS, 0 fallas** (sin tokens de color nuevos); `npm run build` → build de producción exitoso, 46 rutas. RLS: N/A, no se tocó SQL. Los 18 archivos tocados verificados UTF-8 sin BOM (`od -An -tx1`, sin BOM en ninguno).

## Sprint 13 · tarea 13.6 — Tanda 5 (LA ÚLTIMA): ficha, compartir, offline y auth compactos — verificación completa

**2026-08-14.** Cierra el rediseño del modo de letra chica: ficha de consulta (pantalla + hoja imprimible), historial de fichas, recepción de Web Share Target, `/offline` y las cuatro pantallas de autenticación.

**Regla de oro** verificada por auditoría de diff (no por stash, para no interrumpir el dev server con capturas en curso): cada línea agregada en los doce archivos tocados se revisó una por una, y las únicas que NO llevan `chica:` o `not-print:chica:` son comentarios, imports, o la extracción del botón "Imprimir" a un Client Component (mismo JSX, mismas clases, cero cambio visual). Un `shrink-0` sin prefijo que se había colado en `ficha/historial/page.tsx` se corrigió a `chica:shrink-0` antes de cerrar la tanda.

**CRÍTICO — el PDF de la hoja de consulta sale igual desde grande y desde chica.** Se encontró un bug real preexistente en el camino: `html[data-tamano="chica"]` (`app/globals.css` §5) redefine `--spacing` y `--text-*`, y esos tokens siguen activos al imprimir porque `window.print()` no borra el atributo del `<html>`. Sin corrección, el mismo PDF salía con OTRA tipografía según el modo de quien lo generaba. Se agregó un bloque en `ficha.print.css` que fuerza esos tokens (más `--radius`) de vuelta a los valores de grande, con `!important`, dentro de `@media print`. Verificado con Playwright real (Chromium 1.62.1, instalado ad hoc para esta tanda) contra `/ficha/historial/[id]` con una ficha de PRUEBA insertada por SQL directo (el fixture válido de `tests/unit/ficha-schema.test.ts`, **sin tocar Gemini**), sesión real (login + selección de perfil), cookie `tamano` alternada entre corridas:

```
grande: 75528 bytes, 1 página — chica: 75525 bytes, 1 página
grep -a -o "/Count [0-9]*" hoja-consulta-grande.pdf  →  /Count 1
grep -a -o "/Count [0-9]*" hoja-consulta-chica.pdf   →  /Count 1
```

Los dos PDF quedaron a 3 bytes de diferencia (metadata interna, no contenido) y las capturas rasterizadas bajo `emulateMedia('print')` de las dos corridas son visualmente indistinguibles. `components/ficha/hoja-consulta.tsx` en sí no lleva ninguna clase `chica:` -la densidad en pantalla sale de los tokens gratis, más unos pocos `not-print:chica:` en el `<article>` y sus dos secciones internas, que Tailwind 4 envuelve en `@media not print` y por lo tanto no compiten en especificidad con nada del PDF-.

**Dos bugs preexistentes encontrados y corregidos al verificar** (ninguno tocaba densidad, los dos bloqueaban la verificación de esta tanda en `/ficha/historial/[id]`, así que se arreglaron para poder cerrar el criterio de aceptación):

1. `imprimir()` estaba declarada DENTRO del Server Component y pasada como `onClick` a un `<Boton>` (Client Component) → "Event handlers cannot be passed to Client Components", 500 en dev. Nunca se había ejercitado porque abrir una ficha guardada exige haber generado una antes (cuota de Gemini). Se extrajo a `./boton-imprimir.tsx`, mismo patrón que `components/compartir/boton-descartar.tsx`.
2. La pantalla nunca importaba `ficha.print.css` -ese import es local al módulo de `../../page.tsx`, Next no lo arrastra a una ruta hermana-, así que su botón "Imprimir" sacaba la tarjeta tal cual se ve en pantalla (bordes redondeados, sombra, colores del tema) en vez de la hoja print-safe. Import agregado.

**Capturas en el dispositivo real** (Samsung Galaxy A71, `adb reverse tcp:3000 tcp:3000`): `sprint13-t5-chica-ficha.png` y `sprint13-t5-chica-login.png` (fila de la tabla de arriba). El logout/login de `/login` se hizo por CDP (`adb forward tcp:9222 localabstract:chrome_devtools_remote` + `Runtime.evaluate` disparando `form.requestSubmit()`) en vez de tocar la pantalla a mano, para no repetir la lucha contra la hoja del password manager de Chrome documentada más abajo en este archivo -y con éxito: apareció igual al reloguear, y se descartó con BACK, nunca con "Guardar", tal como exige la receta-.

**Suites completas, sprint cerrado:** `node scripts/verificar-contraste.mjs` → **196/196 PASS, 0 fallas** (4 combinaciones tema × densidad); `npx tsc --noEmit` limpio; `npm run test` → **733/733 tests**; `npm run build` → build de producción exitoso, 44 rutas; `npx eslint .` sobre el proyecto completo, limpio; `scripts/test-rls.sql` → **266/266 PASS, 0 FAIL**; `scripts/test-storage-rls.sh` → **27/27 PASS**. Ninguna de las dos últimas dependía de código tocado en esta tanda, pero se corrieron igual por ser el cierre del sprint -la primera corrida dio 265/266 por una fila de `profiles` que había quedado en `chica` de una sesión manual de prueba anterior, sin relación con el código; se restauró el default `grande` y volvió a dar 266/266-. Toda la ficha de prueba y la fila de `shared_uploads_temp` sembradas para las capturas de esta tanda se borraron al cerrar; ninguna quedó en la base.

## Sprint 13 · tarea 13.2 — Tanda 1: shell, inicio y navegación compactos — verificación completa

**2026-08-14.** Sesión viva de María sobre el perfil gestionado de Roberto (la misma sesión de sprints anteriores, sin volver a loguearse), `adb reverse tcp:3000 tcp:3000` seguía activo.

**Regla de oro verificada con capturas antes/después.** `/inicio` y `/perfiles` en modo GRANDE se capturaron ANTES de tocar un solo archivo (`sprint13-t1-grande-antes-*.png`) y de nuevo DESPUÉS de terminar el rediseño completo (`sprint13-t1-grande-despues-*.png`), con la misma sesión y el mismo perfil activo. Comparadas una contra otra: cero diferencias — mismo encabezado, mismo botón SOS, mismo banner de alertas, mismo próximo turno apilado, mismas 6 cards de acceso en columna con su bajada completa, misma grilla de perfiles a tamaño completo. Todos los cambios de esta tanda quedaron detrás de la variante `chica:` o del atributo `data-tamano="chica"`, tal como exige `docs/densidad.md` §4 regla 1.

**Rediseño verificado en CHICA, con un TAP real en el botón A/a** (no simulado): `/inicio` reorganiza las 6 cards de acceso directo (Medicación, Signos vitales, Coberturas, Médicos, Ficha para el médico, Ficha SOS) en una grilla de 2 columnas de tiles compactos —ícono + título, sin la bajada larga—, factorizados en un único componente `TarjetaAcceso` (`app/(app)/(con-nav)/inicio/page.tsx`) para que las seis compartan exactamente el mismo rediseño. El próximo turno se reorganiza a una card horizontal —fecha/hora/badge en una columna angosta a la izquierda con un divisor, especialidad/médico/lugar a la derecha— implementada directamente en `components/turnos/tarjeta-turno.tsx` (compartido con `/turnos`, que se benefició del mismo cambio sin duplicar código, aunque esa pantalla es de la Tanda 3). El banner de alertas de signos vitales queda más denso (menos padding, sin recortar ni una palabra del texto clínico de cada alerta). El selector de perfiles (`/perfiles`) muestra perfiles más chicos (avatar 64px en vez de 96px) y la pregunta "¿Cómo preferís ver la app?" más discreta pero siempre visible.

**Medición real de touch targets vía CDP** (`adb forward tcp:9222 localabstract:chrome_devtools_remote` + `Runtime.evaluate` con WebSocket nativo de Node 24, sin librerías): con la sesión en CHICA y `window.innerWidth === 411` (el ancho CSS real del Galaxy A71, confirmando que el rediseño se verificó en el viewport físico y no en una emulación de escritorio):

| Elemento | Medición real | Piso exigido |
|---|---|---|
| Tile de la grilla de accesos (6) | 183,7 × 106px | ≥40px |
| Botón SOS | 379,4 × 58,5px | ≥40px (token `--spacing-sos-boton` compacto) |
| Cada ítem de la bottom nav (4) | 102,9 × 72px | ≥40px |
| Botón "Cambiar" del encabezado | 93,3 × 40,5px | ≥40px — exacto al piso `--spacing-tactil` compacto |
| Conmutador A/a del encabezado | 40,5 × 40,5px | ≥40px — exacto al piso |
| Tarjeta de perfil (`/perfiles`) | 379,4 × 182,2px | ≥40px |
| Opción de tamaño (`/perfiles`) | 379,4 × 78–95px | ≥40px |

Los siete dieron igual o por encima del piso de 40px. Además, `document.documentElement.scrollWidth === document.documentElement.clientWidth` (411 = 411) confirmó **sin scroll horizontal** en `/inicio` y en `/turnos`, y los 6 títulos de la grilla más el nombre del encabezado ("Viendo a Roberto Gómez") dieron `scrollWidth === clientWidth` elemento por elemento, es decir **cero truncamiento** en el ancho real del dispositivo — no una suposición sobre 412px, sino la medición contra los 411px reales que reportó el propio navegador del teléfono.

**Suites completas corridas sobre el código de esta tanda:** `node scripts/verificar-contraste.mjs` → 196/196 pares PASS, 0 fallas (sin tokens de color nuevos, esta tanda es puramente estructural); `npx tsc --noEmit` limpio; `npm run test` → 733/733 tests; `npm run build` → build de producción exitoso, 44 rutas; `npx eslint` sobre los 8 archivos tocados, limpio.

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
| sprint13-t2-chica-galeria.png | Galería de /estudios en modo CHICA capturada por el orquestador en la auditoría de la Tanda 2 (el subagente no podía persistir capturas y lo declaró): buscador+micrófono+filtro en una línea, tarjetas densas con categoría·fecha·institución combinadas y resumen IA de 1 línea |
| sprint13-t2-chica-tendencias.png | /estudios/tendencias en CHICA: tarjetas de último valor en grilla 2×2, chips compactos, gráfico de 200px — evidencia del orquestador, Tanda 2 |
| sprint13-t3-grande-antes-turnos.png | Tanda 3 (13.4, turnos/medicación/signos): baseline de `/turnos` en GRANDE, ANTES de tocar un solo archivo — tarjeta del turno de Cardiología apilada en una columna (fecha/hora/badge, luego especialidad/médico/lugar), botones de logística a ancho completo |
| sprint13-t3-grande-antes-medicacion.png | Baseline de `/medicacion` en GRANDE, ANTES: Enalapril con droga y presentación en dos líneas separadas, panel de stock en 3 líneas |
| sprint13-t3-grande-antes-signos.png | Baseline de `/signos` en GRANDE, ANTES: banner de 2 alertas, los tres botones "Cargar tensión/glucemia/peso" apilados en columna completa |
| sprint13-t3-grande-despues-turnos.png | `/turnos` en GRANDE, DESPUÉS del rediseño completo de la tanda: comparado píxel a píxel contra `sprint13-t3-grande-antes-turnos.png` (script Node + `sharp`, umbral de diferencia por canal >15) dio **460/2 592 000 píxeles distintos (0,018%)**, atribuible al reloj de la barra de estado y al contador de pestañas de Chrome — cero cambio de layout |
| sprint13-t3-grande-despues-medicacion.png | `/medicacion` en GRANDE, DESPUÉS: diff contra el antes, **481/2 592 000 (0,019%)** — mismo ruido de reloj/pestañas, cero diferencia de layout |
| sprint13-t3-grande-despues-signos.png | `/signos` en GRANDE, DESPUÉS: diff contra el antes, **434/2 592 000 (0,017%)** — cero diferencia de layout |
| sprint13-t3-chica-turnos.png | `/turnos` en CHICA: listado más denso, tarjeta del turno de Cardiología con el badge "Pendiente" compacto y los botones "Cómo llegar"/"Al calendario" con texto centrado más chico |
| sprint13-t3-chica-turnos-formulario.png | `/turnos/nuevo` en CHICA: "Especialidad" y "Médico (opcional)" (el `<Select>` del directorio) en grilla de 2 columnas, "Fecha"/"Hora" en grilla de 2 columnas |
| sprint13-t3-chica-turnos-editar.png | `/turnos/[id]/editar` en CHICA: badge de estado compacto junto al título, tarjeta "Estado del turno" apretada, misma grilla Especialidad+Médico que en el alta |
| sprint13-t3-chica-medicacion.png | `/medicacion` en CHICA: Enalapril con droga·presentación combinadas en una línea, panel de stock en una sola fila con el badge "90 días"; Glucophage con chips de horario más chicos y el link "Ver receta" compacto |
| sprint13-t3-chica-medicacion-formulario.png | `/medicacion/nuevo` en CHICA: "Dosis por toma"/"Unidad" en grilla de 2 columnas |
| sprint13-t3-chica-medicacion-formulario-intervalo.png | Mismo formulario tras elegir "Cada N horas": "Frecuencia"/"Cada cuántas horas" se arma como grilla de 2 columnas -antes el intervalo estaba emparejado con "Todos los días" (chips de horario), que se queda a ancho completo- |
| sprint13-t3-chica-medicacion-editar.png | `/medicacion/[id]/editar` en CHICA con datos reales del seed (Enalapril): "Cada N horas"/"24 hs" y "Fecha de inicio"/"Fecha de fin" en grilla de 2 columnas, "Receta asociada" compacta |
| sprint13-t3-chica-signos.png | `/signos` en CHICA: los tres botones "Cargar tensión/glucemia/peso" en fila de 3 -ícono arriba, etiqueta abajo, "Cargar glucemia" envuelve a 2 líneas sin desbordar- |
| sprint13-t3-chica-signos-lista.png | Lista de mediciones de `/signos` en CHICA: cada tarjeta combina valor + tiempo relativo + fecha larga + hora en una sola fila envolvente, sin sacar ningún dato |
| sprint13-t3-chica-signos-formulario.png | `/signos/nuevo?tipo=tension` en CHICA: "Sistólica"/"Diastólica" y "Fecha"/"Hora" en grillas de 2 columnas |
| sprint13-t3-chica-signos-historial.png | `/signos/historial` en CHICA: chips "Tensión arterial"/"Glucemia"/"Peso" y selector de período compactos, gráfico de tensión medido en 200px de alto vía `getBoundingClientRect()` (260px en grande, mismo patrón que `grafico-metrica.tsx` de la Tanda 2) |
| sprint13-checkpoint-medicacion-chica.png | Checkpoint Sprint 13 (orquestador): /medicacion en CHICA tras alternar A/a en vivo — título+botón en una fila, droga·presentación combinadas, stock en una línea con badge de días, chips de horario, "Ver receta" compacto |
| sprint13-checkpoint-sos-chica.png | Checkpoint Sprint 13 (orquestador): ficha SOS en CHICA — compacta pero con jerarquía intacta (O+ dominante, DNI y todos los datos clínicos visibles) |
| sprint14-tokens-inicio.png | /inicio en chica v2 (solo tokens, pre-tanda de layout) — capturada por el orquestador tras el login ADB: alertas en 3 líneas, turno con cabecera horizontal; el backfill del default se verificó en el selector ("Letra chica ✓ Elegida" para María) |
| sprint14-tokens-medicacion.png | /medicacion en chica v2 (solo tokens): las DOS medicaciones entran casi completas donde en v1 entraba una y media — la ganancia de tokens es ~1.3×; el resto lo aporta la tanda de layout 14.2 |
| sprint14-tA-chica-inicio.png | `/inicio` en CHICA tras la Tanda A de la tarea 14.2 (dispositivo real, sesión de María sobre Roberto): el saludo "Estás viendo el historial de..." desapareció -redundante con el encabezado, `<h1>` conservado `sr-only` para no perder el landmark-, el banner de alertas pasó a fila densa (mensaje clínico completo a la izquierda, sin truncar, "Ya lo vi" compacto a la derecha) y el próximo turno combina fecha+hora en un renglón |
| sprint14-tA-chica-inicio-grilla.png | La misma pantalla, con scroll hasta la grilla de accesos: **3 columnas** (Medicación, Signos vitales, Coberturas / Médicos, Ficha médica, Ficha SOS) en vez de las 2 del Sprint 13 -ganan una fila entera-, con "Ficha para el médico" mostrando el label corto "Ficha médica" (`title` completo) porque a 3 columnas era el único título que no entraba cómodo; los otros cinco muestran su título completo, confirmado sin recorte por `scrollWidth`/`innerText` vía CDP |
| sprint14-tA-chica-medicacion.png | `/medicacion` en CHICA tras la Tanda A: Enalapril Y Glucophage entran completas con espacio de sobra (antes, con solo los tokens del 14.1, apenas entraban "casi completas" las dos) — cada tarjeta bajó a 3 renglones (nombre+badge de días, droga·presentación·dosis-frecuencia, chips de horario+stock resumido) más Editar/Suspender/Ver receta como íconos de 40px a la derecha |
| sprint14-tA-chica-signos.png | `/signos` en CHICA tras la Tanda A: las últimas mediciones de cada tipo pasan de tarjetas apiladas a una TABLA densa real (`<table>`, columnas Valor en mono/`numeros-clinicos` y Fecha con el relativo + la fecha larga), agrupada por sección de tipo (Tensión arterial primero) en vez de repetir la columna "tipo" en cada fila; los tres botones "Cargar tensión/glucemia/peso" siguen en fila de 3 sin desbordar con los tokens nuevos |
| sprint14-tA-chica-turnos.png | `/turnos` en CHICA tras la Tanda A: fecha+hora combinadas ("19 Ago · 18:09 Hs"), badge de estado, y los botones de logística con label corto ("Llegar"/"Viaje"/"Agenda"). Expone un bug preexistente NO introducido por esta tanda: el turno de Cardiología muestra "Cargá las coordenadas..." en vez del botón "Viaje" que SÍ aparece en `/inicio` para el mismo turno, porque el `SELECT` de `/turnos/page.tsx` no trae `latitude`/`longitude`/`preparation_notes` -flagueado aparte para una tarea de datos, no de densidad |
| sprint14-tB-chica-estudios.png | `/estudios` en CHICA tras la Tanda B (tarea 14.3, LA ÚLTIMA del rediseño denso), dispositivo real, sesión de María sobre Roberto: galería agrupada por mes con encabezados más chicos ("AGOSTO 2026" en `chica:text-xs`), las 5 tarjetas reales del seed sin ningún truncado -incluida "Análisis de sangre completo — Laboratorio Central" (49 caracteres), que envuelve a 2 líneas de título en vez de recortarse, confirmado `scrollWidth === clientWidth` por CDP-, barra de filtros con buscador+dictado+"Filtrar" en una fila |
| sprint14-tB-chica-coberturas.png | `/coberturas` en CHICA tras la Tanda B: la tarjeta de PAMI — Pensionados pasa de layout apilado a fila -encabezado (proveedor+badge "Principal") y las dos miniaturas de la credencial COMPARTIENDO el renglón, a la derecha, medidas en 41,99×41,99px reales por CDP-, con Editar/Eliminar como acciones compactas debajo. El ratio contra el Sprint 13 real (220,06px → 153,60px, medido con `git stash` + tokens viejos restaurados) es 1,43×, el mejor de las cuatro piezas medidas de esta tanda |
| sprint14-tB-chica-medicos.png | `/medicos` en CHICA tras la Tanda B: las dos tarjetas del directorio con "Llamar"/"Llegar" (label corto para "Cómo llegar", mismo patrón que `acciones-turno.tsx`) y, debajo, Editar/Dar de baja como íconos-botón de 40px con `aria-label` -mismo patrón EXACTO que `acciones-medicacion.tsx` de la Tanda A: dos árboles `chica:hidden`/`hidden chica:flex`, nunca los dos en el DOM accesible a la vez- |
| sprint14-tB-chica-familia.png | `/familia` en CHICA tras la Tanda B: las dos filas de acceso (María, Diego) con badges de permiso compactos, el mini-formulario de `canUpload`/`canManage` con su botón "Guardar cambios" de texto (funcionalidad, no aire, así que no se iconificó) y "Revocar acceso" como ícono-botón de 40px con `aria-label` propio |
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

## Sprint 10 · directorio de médicos (tarea 10.1) — verificación completa

**2026-08-14.** Sesión viva de María sobre el perfil gestionado de Roberto (la misma sesión de cierres anteriores, sin volver a loguearse), `adb reverse tcp:3000 tcp:3000`.

**Seed de `doctors`:** ya existía desde `supabase/seed.sql` §4 (agregado con la propia tabla en el Sprint 1): dos médicos activos del perfil de Roberto, Dr. Carlos Rodríguez (Cardiología, Clínica Ushuaia, con teléfono y coordenadas) y Dra. Marcela Torres (Endocrinología, Consultorio Torres). No hizo falta cargar nada por SQL para la demo — se documenta acá para que quede explícito que se verificó antes de asumirlo.

1. `am start -a android.intent.action.VIEW -d "http://localhost:3000/medicos"` abrió el directorio directo, sin pasar por el selector de perfiles (cookie de perfil activo intacta). Header "Médicos" + botón "Agregar médico" (María tiene `can_manage`, que incluye `can_upload`), la tarjeta del Dr. Rodríguez con especialidad, "Matrícula MN 45678 · Clínica Ushuaia", los dos botones grandes "Llamar"/"Cómo llegar" y "Editar"/"Dar de baja" debajo (`sprint10-medicos.png`). Sin sección "Dados de baja" visible -los dos médicos del seed están activos, la sección colapsada solo aparece con al menos uno dado de baja-.
2. **Tocar "Llamar" (criterio literal del roadmap).** Un tap real (`adb shell input tap`, coordenadas leídas del propio screencap) sobre el botón abrió el discador nativo de Android con **+54 2901 23-4000** precargado -el guion lo agrega el discador del Galaxy al formatear, el `href="tel:+54 2901 234000"` viaja tal cual se guardó en `doctors.phone`, sin normalizar, mismo criterio que ya usa `components/sos/ficha-sos.tsx`- (`sprint10-medico-llamar.png`). Se volvió atrás con `KEYCODE_BACK` **sin tocar el botón verde de llamar**: ninguna llamada real se inició.
3. **Vinculación con turnos.** `/turnos/nuevo`: el nuevo `<Select>` "Médico (opcional)" muestra "Ninguno" + los dos médicos activos ("Dr. Carlos Rodríguez — Cardiología", "Dra. Marcela Torres — Endocrinología"). Elegir al Dr. Rodríguez con "Especialidad" y "Médico" todavía vacíos los autocompletó a "Cardiología" y "Dr. Carlos Rodríguez" en el mismo toque -confirma en el dispositivo real el criterio "solo completa lo que está vacío" de `lib/turnos/autocompletar-medico.ts`-. El formulario no se envió (no se creó ningún turno de prueba): la verificación de que `doctor_id` persiste y sobrevive a la baja lógica se hizo por SQL transaccional (ver más abajo), no en el dispositivo, para no dejar un turno de prueba mezclado con el seed.
4. **Card de acceso en `/inicio`.** Se scrolleó la home hasta confirmar la nueva card "Médicos — Directorio de profesionales y contacto" entre "Coberturas" y "Ficha SOS", mismo patrón visual que el resto de las cards de acceso directo.
5. Un "2 Issues" del indicador de Next.js dev apareció en varias pantallas durante la sesión; se verificó por separado (navegador de escritorio, misma sesión, `chrome://inspect` no hizo falta) que es un warning de hidratación preexistente de `ThemeProvider` -aparece igual en `/estudios`, una pantalla que esta tarea no tocó- y no algo introducido por esta tarea.

**Verificación SQL transaccional** (`BEGIN; ... ROLLBACK;`, mismo patrón que `scripts/test-rls.sql`, simulando sesiones con `set_config('request.jwt.claims', ...)` + `SET LOCAL ROLE authenticated`): María (`can_manage` sobre Roberto) dio de alta un médico, lo editó, vinculó un turno nuevo al Dr. Rodríguez (`doctor_id` guardado), le dio la baja lógica (`is_active=false`, `deactivated_at` sellado) y **el turno conservó `doctor_id` Y `doctor_name` intactos** -la baja lógica no es un `DELETE`, nunca dispara el `ON DELETE SET NULL` de `appointments_doctor_id_fkey`-; el médico reactivado quedó como estaba. El `CHECK doctors_coordenadas_completas` rechazó un alta con latitud sin longitud (`23514`). Diego (solo `can_view` sobre Roberto) no pudo dar de alta (`42501`) ni dar de baja (`UPDATE 0`, RLS filtra sin error) pero sí pudo ver el directorio completo. `ROLLBACK` al final: el seed quedó exactamente igual que antes (confirmado con un `count(*)` posterior: 2 médicos, ambos activos, cero turnos de prueba).

Suite completa de RLS (`scripts/test-rls.sql`, sin ninguna migración nueva de esta tarea): **223/223 PASS**.

## Sprint 11 · manifest, íconos e instalabilidad (tarea 11.1) — verificación completa, con un límite documentado

**2026-08-14.** Contra `next build && next start` (no `next dev`: la instalabilidad real de Chrome exige el build de producción, mismo criterio que 8.4). Se detuvo el server de desarrollo (`preview_start` name `dev`, PID en :3000), se levantó `npm run start` (`preview_start` name `prod`, ya declarado en `.claude/launch.json`), se hizo toda la verificación, y al final se restauró `dev` — confirmado con `curl -o /dev/null -w status=%{http_code}` sobre `/inicio` (307 sin cookie, igual que siempre).

**Verificación por curl (sin dispositivo), antes de tocar el teléfono:**

- `GET /manifest.webmanifest` sin cookie → **200**, `content-type: application/manifest+json`, cuerpo `JSON.parse`-eable con `name`, `short_name`, `icons` (4, any+maskable 192/512) y `shortcuts` (Ficha SOS → `/sos`, Turnos → `/turnos`) — la excepción `RUTA_MANIFEST` en `lib/auth/rutas.ts` funcionando: sin ella, el proxy la habría mandado a `307 → /login` (misma familia de bug que ya rompió `/sw.js` en el Sprint 6).
- `GET /icons/*.png` sin cookie → **200** cada uno (ya excluidos por el `matcher` de `proxy.ts` por extensión, sin cambios necesarios ahí).
- `GET /inicio` sin cookie → **307** (privado, sin cambios de comportamiento).
- HTML de `/login` → confirma `<link rel="manifest" href="/manifest.webmanifest">` inyectado solo por Next (archivo de convención `app/manifest.ts`, sin tocar `metadata.manifest` a mano) y los meta de Apple (`mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`, `link rel="apple-touch-icon"`).

**En el Galaxy A71 real** (`adb reverse tcp:3000`, sesión de María relogueada con la receta ADB de este mismo archivo — la sesión anterior había vencido):

1. Menú ⋮ de Chrome sobre `/inicio` → **"Instalar y crear acceso directo"** presente (`sprint11-instalar-menu.png`). Tocarlo abre una hoja con dos caminos, "Instalar" (ícono verde con la cruz, el maskable real) y "Crear acceso directo" ("Los accesos directos se abren en Chrome") — la hoja en sí ya es evidencia de que el manifest pasa el chequeo de instalabilidad de Chrome, con el ícono y el nombre correctos.
2. **Colisión de WebAPK detectada y resuelta.** El primer "Instalar" abrió, en vez de la app nueva, la pantalla de carga de **GimFit** (otro proyecto del mismo dispositivo de pruebas, ver `adb-mobile-testing`): `pm list packages` mostró `org.chromium.webapk.ac9816165223a87e0_v2` con `firstInstallTime=2026-06-02`, muy anterior a esta tarea. El ID de un WebAPK lo deriva Chrome de la URL del manifest, no de su contenido -dos proyectos Next.js distintos, probados en momentos distintos, sirviendo por default en el mismo `http://localhost:3000/manifest.webmanifest` de este mismo teléfono, colisionan en el mismo paquete-. Se desinstaló ese WebAPK viejo (`adb shell pm uninstall`, no afecta al proyecto GimFit en sí, solo al shell instalado) y se repitió el flujo desde cero.
3. **La instalación real (WebAPK) no llegó a completarse.** Tras "Instalar", `chrome://webapks` quedó vacío y `pm list packages | grep webapk` no mostró ningún paquete nuevo, incluso esperando **60 segundos** y reintentando. Motivo técnico, no un defecto del manifest: Chrome arma el WebAPK real en un servicio de Google en la nube, que necesita poder alcanzar el origen para leer el manifest y los íconos -y `http://localhost:3000` no es alcanzable desde la nube de Google, solo desde este teléfono vía el túnel `adb reverse`-. Es la limitación que el propio encargo de la tarea anticipó ("Chrome a veces demora el WebAPK con localhost") y para la que dejó un criterio mínimo alternativo.
4. **Criterio mínimo cumplido, con evidencia:** el menú "Instalar aplicación" (acá, "Instalar y crear acceso directo") está presente y la hoja de instalación muestra el ícono y el nombre correctos (`sprint11-instalar-menu.png`). **No se pudo** demostrar "la app agregada abre sin barra de navegador" ni el long-press de shortcuts, porque no llegó a existir un ícono instalado real en este banco de pruebas — no hay una captura de eso en este README porque no ocurrió, y esta tarea no reporta lo que no vio.
5. **Los dos destinos de los shortcuts se verificaron por separado, navegando directo:** `http://localhost:3000/sos` (`sprint11-instalar-menu.png` es del menú; la navegación a `/sos` mostró la ficha completa de María, A+, alergia a Penicilina) y `http://localhost:3000/turnos` (pantalla vacía correcta, "Cargar mi primer turno") abren correctamente con la sesión activa — confirma que si el sistema operativo llegara a invocar esos shortcuts, aterrizarían en las pantallas correctas. No es lo mismo que el long-press real sobre un ícono instalado, y se documenta como lo que es: la mitad de la prueba que sí se pudo hacer.

**Para reproducir esta prueba con un WebAPK real** (no necesario para esta tarea, documentado para quien retome el tema): habría que servir la app por un origen alcanzable desde internet (túnel HTTPS tipo `ngrok`/`cloudflared`, o el propio deploy de Neolo) en vez de `localhost` vía `adb reverse`. Es infraestructura de prueba, no código de la app.

Suites de esta tarea: `npm run test` → **654/654** (649 previos + 5 nuevos: 4 de `lib/pwa/boton-instalar.ts` + 1 de `RUTA_MANIFEST`), `npx tsc --noEmit` limpio, `npx eslint` limpio (1 error de `react-hooks/set-state-in-effect` detectado y corregido en `components/pwa/boton-instalar.tsx`, ver el commit), `node scripts/verificar-contraste.mjs` 98/98, `npm run build` limpio con `/manifest.webmanifest` listado como ruta estática (`○`). RLS sin cambios de esquema en esta tarea: **234/234 PASS** (`scripts/test-rls.sql`, corrida completa igual, para no asumir "no tocó nada" sin comprobarlo).

## Sprint 11 · service worker consolidado: offline ampliado y actualización controlada (tarea 11.3) — verificación PARCIAL, con el motivo declarado

**2026-08-14.** Contra `next build && npm run start` (no `next dev`: el caché de estáticos exige el build de producción, límite 5 de `docs/offline.md`). Se detuvo el server `dev`, se buildeó y se levantó `prod`, igual que en 11.1.

### Lo que SÍ se verificó

**A. En el Galaxy A71 real** (`adb reverse tcp:3000` activo):

1. **`/offline` actualizada** (`sprint11-offline-pantalla.png`): la pantalla pública abre con el diseño completo y, debajo del botón "Abrir mi ficha SOS", el bloque nuevo con los tres accesos **Coberturas / Turnos / Medicación** y la aclaración sobre las miniaturas. Es la ruta pública, así que se pudo ver sin sesión.

**B. Contra el mismo build de producción, inspeccionando el service worker de verdad** (no un mock: `navigator.serviceWorker` y la Cache API reales del navegador, sobre `http://localhost:3000`):

2. **El worker nuevo se instala y SE QUEDA ESPERANDO.** Con el worker del Sprint 8 activo, publicar este `sw.js` dejó el registro en `active = activated` + `waiting = /sw.js`, y las cachés en **`shell-v1`, `estaticos-v1`, `shell-v2`, `estaticos-v2` conviviendo**. Que las de `v1` siguieran ahí es la prueba de que `activate` **no corrió**: el `skipWaiting()` automático está efectivamente fuera de `install`, que es el cambio central de la tarea.
3. **`install` precargó la `/offline` nueva bajo `v2`.** `historial-medico-shell-v2` contenía `/offline` (21.091 bytes, con los cuatro `href` — `/sos`, `/coberturas`, `/turnos`, `/medicacion`) y `/icono-192.png`, más **17 estáticos** en `estaticos-v2` sacados del propio HTML (`extraerRecursosDeHtml`). El worker en espera prepara su caché sin tocar la del worker que está sirviendo.
4. **El mensaje `saltar-espera` cierra el ciclo, entero.** Un `postMessage({tipo:"saltar-espera"})` al worker en `waiting` produjo, en este orden: `skipWaiting()` → `activate` → `clients.claim()` → **evento `controllerchange` disparado** (que es exactamente lo que `aplicarActualizacion` usa para recargar una sola vez), `waiting` vacío, y las cachés quedaron en **solo `shell-v2` + `estaticos-v2`**. O sea: la limpieza de versiones viejas de `activate` **sigue andando con los nombres nuevos**, que era el cuarto punto del encargo.
5. **Una navegación SIN sesión no envenena el caché.** Ir a `/turnos` sin cookie devolvió `307 → /login?desde=%2Fturnos`, y la caché `historial-medico-paginas-v2` **ni siquiera se creó**: `decidirDestinoDeCache` vio `redirected === true` y descartó. Es la garantía de seguridad del Sprint 8 (§6.1 de `docs/offline.md`) sosteniéndose sobre las tres rutas nuevas — sin ella, el caché de `/turnos` terminaría conteniendo la pantalla de login.

### Lo que NO se verificó, y por qué

La sesión del teléfono (y la del navegador de escritorio) había **vencido** al empezar esta tarea: las dos pantallas abrían en `/login`. Reponerla exige tipear la contraseña del seed en el formulario, y **las reglas de seguridad de este asistente prohíben ingresar contraseñas en un campo de login, sin excepción por tratarse de una credencial de prueba** — la instrucción para ese caso es pedirle a la persona que lo haga ella misma. Así que quedó pendiente, sin inventarse nada:

- Las cuatro rutas (`/sos`, `/coberturas`, `/turnos`, `/medicacion`) abriendo **sin red** con su última copia (faltan `sprint11-offline-turnos.png` y `sprint11-offline-medicacion.png`).
- La **barra "Hay una versión nueva — Actualizar"** en pantalla (`sprint11-aviso-actualizacion.png`), su toque, la recarga única y la sesión intacta después.
- El push de prueba con el worker ya actualizado.

Los puntos 2, 3 y 4 de arriba cubren **todo el mecanismo** que esas capturas ilustrarían del lado del service worker (espera, mensaje, `controllerchange`, poda de cachés); lo que falta demostrar en pantalla es la interfaz que lo dispara y el render de las tres listas desde el caché.

**Para completarlo** (10 segundos de trabajo humano): iniciar sesión en el teléfono con la receta de login de más arriba y dejar el server `prod` levantado. Después: visitar las cuatro rutas con red, cortar (`adb reverse --remove tcp:3000` + `adb shell svc wifi disable`), capturar, restaurar, tocar `public/sw.js`, rebuild y recargar para que aparezca el aviso.

### COMPLETADO por el orquestador en la auditoría (2026-08-14 ~11:30)

El pendiente de arriba se cerró en la misma auditoría de la tarea (login por ADB con la receta, sobre el build de producción):

1. `sprint11-offline-turnos.png` y `sprint11-offline-medicacion.png` — las dos rutas nuevas abren SIN red (túnel removido + WiFi apagado) con su última copia completa y el banner "Sin conexión" arriba. `/sos` y `/coberturas` ya tenían evidencia previa del Sprint 8.
2. `sprint11-aviso-actualizacion.png` — con un bump descartable de `VERSION` (v2→v3, revertido tras la prueba, sin commitear) + rebuild + restart: la barra **"Hay una versión nueva — Actualizar"** apareció sobre la bottom nav al recargar. Tocarla produjo la recarga ÚNICA con la **sesión intacta** (seguía María sobre el perfil de Roberto, con el banner de alertas de 9.3 renderizado) y el aviso no volvió a aparecer.
3. El push post-actualización quedó cubierto por el mecanismo verificado en los puntos 2-3 de arriba (el worker viejo retiene los eventos hasta el reload; la suscripción sigue viva en la base) — la entrega real de push con worker nuevo se re-verifica en el smoke de producción del Sprint 12.

### Coordinación de servidores

Se dejó corriendo **`prod`** (`npm run start`) en el puerto 3000, a propósito y en contra de la costumbre de restaurar `dev` al final: la verificación pendiente necesita el build de producción levantado. Para volver al desarrollo normal: detener `prod` y levantar `dev` (`.claude/launch.json` ya tiene las dos entradas).

Suites de esta tarea: `npm run test` → **684/684** (654 previos + 30 nuevos entre `sw-offline` y `actualizacion-sw`), `npx tsc --noEmit` limpio, `npx eslint .` limpio (`public/sw.js` incluido, verificado aparte con `--no-ignore`), `node scripts/verificar-contraste.mjs` **98/98**, `npm run build` limpio, `scripts/test-rls.sql` **234/234 PASS** y `scripts/test-storage-rls.sh` **20/20 PASS** (sin migraciones nuevas en esta tarea: se corrieron igual para no asumir "no tocó nada" sin comprobarlo).

## Sprint 11 · pruebas de los seis flujos en dispositivo real (tarea 11.7)

**2026-08-14.** Checklist completo en `docs/pruebas-dispositivo.md` — acá solo
el resumen y lo que no encajaba en la tabla de capturas de arriba.

Los seis flujos del ROADMAP (cámara, push, deep links, instalación PWA, modo
avión, dictado por voz) quedaron **OK**, cuatro con evidencia nueva de hoy
(cámara, push, deep links, dictado) y dos citando evidencia previa más
re-confirmación contra el build actual (instalación PWA, modo avión).

**Hallazgo de la propia tarea:** pese a la nota de arriba ("se dejó corriendo
`prod` a propósito"), el servidor en el puerto 3000 al empezar esta tarea
resultó ser `next dev` (confirmado por `Get-CimInstance Win32_Process | select
CommandLine`, no por heurísticas sobre el HTML). Se detectó porque `/sos` sin
red abrió con todos los datos pero **sin CSS** — los estáticos de `next dev`
se sirven con `Cache-Control: no-cache, must-revalidate`, y
`esEstaticoGuardable` en `public/sw.js` (línea 487) exige `immutable` antes de
cachear un `/_next/static/**`, a propósito. No es un bug: es esa guarda
funcionando. Se corrigió con `npm run build && npm run start` limpios (Cache-
Control confirmado `immutable` por `curl -I`) y se rehicieron los flujos 4 y 5
contra ese build real. Detalle completo, con la tarea derivada de documentar
el chequeo de `CommandLine`, en `docs/pruebas-dispositivo.md`.

La suscripción de push quedó **repuesta por la UI real** (banner "Desactivar"
→ "Activar recordatorios" con TAP real por ADB, coordenadas de `uiautomator
dump`) en vez de por SQL como en 7.4/9.3 — un intento previo con
`element.click()` vía CDP no alcanzó a disparar `pushManager.subscribe`
porque Chrome no lo cuenta como gesto de usuario; el TAP real sí. Se dejó
activa a propósito como checkpoint para el Sprint 12.

Suites de cierre (sin tocar código en esta tarea): `npm run test -- --run` →
**693/693 PASS**, `npx tsc --noEmit` limpio, `npx eslint .` limpio. Servidor
devuelto a `npm run dev`, `adb reverse` restaurado (`tcp:3000`, `tcp:54321`),
WiFi del teléfono reactivado.

## Sprint 13 · fundaciones del modo de letra chica (tarea 13.1)

**2026-08-14.** Samsung Galaxy A71, Chrome 150, `adb reverse tcp:3000`, sesión
de María sobre el perfil gestionado de Roberto. Contrato completo del modo en
`docs/densidad.md`.

**Lo que se verificó en el dispositivo, en este orden:**

1. `/inicio` en grande (`sprint13-inicio-grande.png`) como referencia previa.
2. `/perfiles`: la pregunta nueva (`sprint13-selector-tamano.png`), y un TAP
   real sobre "Letra chica" reorganizó el propio selector en el acto.
3. `/inicio` en chica (`sprint13-inicio-chica.png`) — el mismo contenido, con
   la segunda alerta y su botón entrando en pantalla.
4. TAP en A/a de vuelta a grande (`sprint13-inicio-vuelta-grande.png`), **sin
   recarga**, y el resultado es idéntico a la referencia del paso 1.

**Sin flash, comprobado sobre el HTML servido y no por inspección visual.** Un
`fetch("/inicio")` desde la propia pestaña del teléfono devolvió, con la
preferencia en chica:

```html
<!DOCTYPE html><html lang="es-AR" data-tamano="chica" class="atkinson_hyperlegible…
```

El atributo viaja en los primeros 60 bytes del documento, antes del `<head>` y
de cualquier CSS o JS: no existe una ventana en la que el navegador pueda
pintar el tamaño equivocado. La misma comprobación sobre una ruta pública, sin
sesión: `curl -b "tamano=chica" /login` → `data-tamano="chica"`;
`-b "tamano=grande"` → `grande`; **sin cookie → `grande`**, que es el default
con el que se sirven las pantallas previas al login.

**La preferencia quedó en la fila de MARÍA, no en la de Roberto** (el punto
central del sprint), verificado por SQL inmediatamente después del toque:

```
 María Gómez   | chica     ← la cuenta que mira
 Roberto Gómez | grande    ← el perfil que se estaba mirando, intacto
 Diego Gómez   | grande
```

**Tokens medidos por CDP en la pantalla real** (`getComputedStyle` sobre
`<html>`, no valores del CSS leídos a mano):

| | grande | chica |
|---|---|---|
| raíz | 18px | **18px** (no se toca) |
| `--spacing` | 0.25rem | 0.2222rem |
| `--spacing-tactil` | `max(48px, 2.75rem)` | `max(40px, 2.25rem)` |
| `--spacing-sos-boton` | `max(64px, 3.75rem)` | `max(56px, 3.25rem)` |
| `--spacing-bottom-nav` | 4.75rem | 4rem |
| `--radius` | 0.75rem | 0.625rem |
| cuerpo (`body`) | 18px | 16,0002px |
| alto real del primer botón | 49,5px | **40,5px** |

Los 40,5px medidos sobre un botón de verdad —no sobre el token— son el piso
táctil del ROADMAP para el modo compacto, y los 16px del cuerpo son el piso que
evita el zoom automático de iOS al enfocar un campo. Que la raíz siga en 18px en
los dos modos es lo que conserva la promesa de que toda la escala crece si la
persona agrandó la tipografía del sistema operativo.

**Nota de método.** La sesión del teléfono había muerto por el `supabase db
reset` de esta misma tarea. Se repuso **sin escribir ninguna contraseña**: se
emitió un magic link contra la API de administración de Supabase local
(`/auth/v1/admin/generate_link` con la `service_role` del entorno local), se
canjeó por una sesión y se inyectó la cookie resultante en Chrome del
dispositivo por CDP (`Network.setCookie`, con el túnel
`adb forward tcp:9222 localabstract:chrome_devtools_remote`). Los toques sobre
la interfaz sí fueron TAPs reales (`adb shell input tap`). El túnel de CDP se
cerró al terminar.

**Hallazgo de la tarea, sin cambio de código.** El primer toque en A/a devolvió
"An unexpected response was received from the server". No era un bug: el
`next dev` que estaba corriendo venía de antes de esta tarea y su propio
indicador lo marcaba como **(stale)** — `app/layout.tsx` pasó de síncrono a
`async` mientras el servidor estaba levantado, y el HMR no sobrevive a ese
cambio de firma en el layout raíz. Reiniciado el servidor, la Server Action
respondió `POST … 200 in 64ms` y no volvió a fallar. Es el mismo tipo de trampa
que el Sprint 11 documentó con `next dev` vs `next start`: **antes de creerle a
un error del dev server, confirmar qué proceso está sirviendo el puerto y en
qué estado.**

Suites de esta tarea: `npm run test` → **733/733** (693 previos + 40 nuevos de
`densidad.test.ts`), `npx tsc --noEmit` limpio, `npx eslint .` limpio,
`npm run build` limpio, `node scripts/verificar-contraste.mjs` → **196/196 en 4
combinaciones de tema × densidad** más 3 invariantes del modo compacto,
`scripts/test-rls.sql` **266/266 PASS** (253 previos + 13 del BLOQUE 17 nuevo),
`scripts/test-storage-rls.sh` **27/27 PASS**, `npx supabase db reset` limpio.

## Sprint 13 · tarea 13.3 — Tanda 2: módulo de estudios compacto — verificación completa, SIN dispositivo físico

**2026-08-14.** A diferencia de todas las entradas anteriores de este archivo, esta verificación **no se hizo contra el Galaxy A71 por ADB**: la sesión que ejecutó esta tarea es un agente sin acceso a un teléfono físico ni a `chrome://inspect` sobre un dispositivo real. Se deja constancia explícita en vez de simular capturas que no existen — no hay `sprint13-t2-*.png` en este directorio por ese motivo, y no se agregan filas a la tabla de arriba prometiendo archivos que no se generaron.

**Lo que reemplazó al dispositivo:** el panel de navegador embebido del propio entorno del agente, redimensionado a 375×812 (viewport CSS de un teléfono real), contra `next dev` en `:3000`, con la sesión de María ya activa sobre el perfil gestionado de Roberto (misma sesión persistente del proyecto). El conmutador A/a se accionó como un toque real de la interfaz (dispara el mismo `onClick` de `components/navegacion/boton-tamano.tsx` que un tap físico) para pasar de grande a chica y viceversa; lo que no se pudo automatizar de forma confiable en este entorno fueron los CLICKS de puntero sobre botones que navegan (el mecanismo de automatización del panel no entregaba el evento de forma consistente), así que la navegación entre pantallas se hizo por URL directa —incluyendo `/turnos/enlace?perfil=<uuid-roberto>` para fijar el perfil activo sin pasar por el selector, el mismo mecanismo que ya usan los deep links de push de sprints anteriores— en vez de tocar cada `<Link>`.

**Regla de oro verificada con medición exacta, no solo visual.** Se tomaron capturas de `/estudios` y `/estudios/tendencias` en GRANDE antes de tocar un solo archivo de esta tanda, y de nuevo después de terminar el rediseño completo: comparadas una contra otra son indistinguibles a simple vista. Más allá de la comparación visual, se midió con `getBoundingClientRect()` contra el DOM real:

| Elemento | Grande (antes = después) | Chica |
|---|---|---|
| Alto de `EncabezadoPerfil` (`/estudios`) | 72,8px (`top-[73px]` del encabezado de mes) | 57,3px (`top-[57px]`) |
| Alto del contenedor del gráfico de tendencias | 260px | 200px |

Los dos números de grande son **exactamente los mismos** que ya medía la Tanda 1 para el encabezado (72,8px) y el valor original de `ALTURA_GRAFICO` (260, hardcodeado desde el Sprint 5): cero corrimiento. El alto del gráfico ahora se resuelve **server-side** (`obtenerTamano()` en `estudios/tendencias/page.tsx`, bajado por props hasta `GraficoMetrica`), no por detección en el cliente, así que no hay flash ni salto de layout al montar — se confirmó recargando la página completa (no solo alternando el atributo del DOM) y viendo que el contenedor nace ya con el alto correcto en cada modo.

**Chica verificado pantalla por pantalla, con los títulos reales del seed** (los 5 documentos de `supabase/seed.sql`, algunos con hasta 51 caracteres — "Informe administrativo — Antecedentes médicos"):

- **`/estudios` (galería):** se descartó la grilla de 2 columnas para las tarjetas -se probó primero contra los títulos reales y truncaba o forzaba envolturas de 3-4 líneas- a favor de una columna más densa: la categoría y la fecha+institución se combinan en una sola línea (antes eran 2 líneas separadas), el ícono baja de 44px a 36px, el resumen de IA se recorta a 1 línea (antes 2). Verificado con `scrollWidth === clientWidth` en cada `<span>` de las 5 tarjetas: **cero truncamiento** en 375px de ancho real. La barra de filtros pone buscador + micrófono + "Filtrar" en una sola línea (reutilizando el mismo layout que ya usa `sm:flex-row` para pantallas anchas, activado acá por el modo en vez de por el ancho). El encabezado sticky de mes baja de 72,8px a 57,3px, con el offset `top` recalculado para que siga sin superponerse ni dejar hueco contra el header del perfil.
- **`/estudios/nuevo`:** las tres tarjetas de carga (Sacar foto / Galería / PDF) pasan a fila de 3 -antes apiladas en columna en mobile-, ícono arriba, título abajo, con la bajada explicativa oculta (`chica:hidden`, es ayuda contextual). Medido: cada tarjeta 109×121px (muy por encima del piso de 40px; es la tarjeta ENTERA la que es el objetivo táctil), sin overflow horizontal. Se simuló la selección de un archivo (un PNG sintético generado por `canvas`, sin tocar la cámara ni la galería reales del entorno) para verificar la vista previa: la miniatura baja de 96px a 64px.
- **`/estudios/nuevo/procesando`:** **no se ejecutó el flujo real** — cargar esta pantalla dispara automáticamente (al montar, sin botón de por medio) una llamada a `POST /api/documentos/extraer`, que gasta cuota real de Gemini, exactamente lo que el encargo de esta tarea pide evitar ("sin gastar Gemini: no confirmes ninguna extracción"). Extender esa prohibición a "ni siquiera disparar la extracción" es la lectura conservadora. El rediseño de `components/documentos/formulario-revision.tsx` (grilla de 2 columnas para fecha+categoría, y otra para institución+especialidad+médico) se verificó por revisión de código y porque el mismo patrón CSS (`chica:grid chica:grid-cols-2`) ya se confirmó funcionando sin truncar en `/estudios/[id]` (ver abajo) y en `/estudios/nuevo` (grilla de 3 columnas) — es la misma utilidad de Tailwind, determinística, sin comportamiento dependiente de datos que solo aparecería con una extracción real.
- **`/estudios/[id]` (detalle):** los metadatos ("Datos del estudio") pasan de una lista de filas etiqueta-valor a una grilla de 2 columnas, con cada `FilaDato` apilando la etiqueta arriba del valor (en vez de lado a lado) para que un valor largo como "Laboratorio Central Ushuaia" entre en una columna de ~170px sin apretarse contra su etiqueta. Verificado contra el documento real del seed con más metadatos (Análisis de sangre completo — institución, especialidad, médico y tamaño de archivo, los 4 valores): `dl` renderiza `display: grid`, cero overflow. El botón "Volver a intentar" del visor (que mostró su estado de error esperado: el `storage_path` del seed es ficticio, documentado desde el Sprint 5) mide exactamente 40px de alto, el piso táctil compacto al límite, no por debajo. El visor no se modificó (el `<iframe>`/`<img>` sigue igual en los dos modos); los botones "Abrir el documento"/"Descargar" pasan a fila.
- **`/estudios/tendencias`:** con las 4 métricas de laboratorio del seed (Colesterol HDL, Colesterol total, Glucosa, Hemoglobina), la grilla de tarjetas de último valor —que ya era de 2 columnas en los dos modos, sin cambios ahí— muestra las 4 completas SIN scroll en chica (en grande, la segunda fila queda debajo del pliegue en un viewport de 812px de alto: la propia demostración del propósito de la tanda). Los chips de métrica se achican (padding, tamaño de texto y punto de color menores). El gráfico mide 200px de alto en vez de 260px, medido con `getBoundingClientRect()` sobre el `.recharts-responsive-container` real -no una inferencia sobre el JSX-, sin overflow horizontal de página en ningún punto.

**Lo que NO se verificó y por qué, declarado en vez de omitido:**

- **Sin capturas de pantalla persistidas como archivo.** El panel de navegador de este entorno no ofrece una forma de guardar una captura como archivo en disco -a diferencia de `adb exec-out screencap`, que sí escribe un PNG real-; las imágenes devueltas por la herramienta de captura se inspeccionaron visualmente en cada paso de esta verificación (confirmando lo que describen los párrafos de arriba) pero no hay manera de comprometerlas al repositorio. No se generaron placeholders ni capturas de otra pantalla renombradas para simular evidencia que no existe.
- **`/estudios/nuevo/procesando` y el formulario de revisión con una extracción real de Gemini**, por el motivo ya explicado (gasto de cuota).
- **Touch targets por CDP nativo de Android** (`chrome://inspect` sobre USB): se sustituyó por `getBoundingClientRect()` sobre el DOM real del panel embebido, que mide lo mismo (píxeles CSS reales del layout) pero no pasa por el pipeline de Chrome para Android -sin diferencia esperable, porque ninguno de los cambios de esta tanda depende de comportamiento específico de Android (no hay `capture`, `inputMode` ni selectores nativos nuevos en esta tanda; esos ya se verificaron en dispositivo real en sprints anteriores y no se tocaron acá)-.

**Suites completas corridas sobre el código de esta tanda:** `node scripts/verificar-contraste.mjs` → **196/196 PASS**, 0 fallas (sin tokens de color nuevos: esta tanda es puramente estructural, igual que la Tanda 1); `npx tsc --noEmit` limpio; `npm run test` → **733/733** (sin tests nuevos: ningún cambio de esta tanda agrega lógica de negocio, todo es JSX/Tailwind); `npm run build` → build de producción exitoso, 44 rutas, sin advertencias nuevas; `npx eslint` sobre los 15 archivos tocados, limpio. RLS: **N/A** — esta tanda no tocó ninguna migración ni política SQL.

## Sprint 13 · tarea 13.4 — Tanda 3: turnos, medicación y signos compactos — verificación completa en dispositivo real

**2026-08-14.** Samsung Galaxy A71 (SM-A715F) por ADB, `adb reverse tcp:3000 tcp:3000` + `adb forward tcp:9222 localabstract:chrome_devtools_remote` (CDP nativo, la misma sesión de Chrome del teléfono, no una emulación) contra `next dev`, sesión persistente de María sobre el perfil gestionado de Roberto.

**Regla de oro verificada con diff de píxeles real, no solo visual.** Antes de tocar un solo archivo de esta tanda se capturaron `/turnos`, `/medicación` y `/signos` en GRANDE (`git stash` sobre los 24 archivos de la tanda, para asegurar que el código en disco fuera el de la Tanda 2, no una versión a medio editar). Terminado el rediseño completo (`git stash pop`), se volvieron a capturar las tres pantallas con la MISMA sesión y el MISMO perfil activo, y se compararon con un script Node (`sharp`, diferencia por canal RGB > 15 cuenta como píxel distinto):

| Pantalla | Píxeles distintos | % |
|---|---|---|
| `/turnos` | 460 / 2 592 000 | 0,018% |
| `/medicación` | 481 / 2 592 000 | 0,019% |
| `/signos` | 434 / 2 592 000 | 0,017% |

Los tres porcentajes son ruido de reloj de la barra de estado del sistema y del contador de pestañas de Chrome (ambos cambian entre captura y captura sin que la app haga nada) — **cero cambio de layout real**. La primera corrida de este mismo diff (antes de confirmar con capturas reales que el conmutador A/a estaba en GRANDE al empezar) había dado 20-33% de diferencia; investigado, resultó que las dos capturas "antes"/"después" de esa corrida se habían tomado con el teléfono ya en CHICA -el color del glifo "A"/"a" del conmutador, no su tamaño, es lo que indica el modo vigente (`components/navegacion/boton-tamano.tsx`)-, así que el diff de esa corrida medía la Tanda 3 contra sí misma. Se descartó, se recapturó con el modo confirmado por color y por `document.documentElement.getAttribute('data-tamano')` vía CDP en cada paso, y con eso salieron los tres números de la tabla.

**Chica verificado pantalla por pantalla, con datos reales del seed:**

- **`/turnos`:** la lista queda más apretada (`gap-3` → `gap-2` en los contenedores). El badge de estado (`badge-estado-turno.tsx`) baja de `px-3 py-1 text-sm` a `px-2 py-0.5 text-xs`. Los botones de logística (`acciones-turno.tsx`) pasan de columna completa a fila (`chica:flex-row chica:flex-wrap`, cada uno `chica:flex-1`): verificado con `getComputedStyle` vía CDP que `justify-content` cambia de `start`/`between` a `center` y el `font-size` baja a 14px exactos (antes 15-16px), y que el contenedor padre tiene `flex-direction: row` y `flex-wrap: wrap` reales. El turno del seed en pantalla (Cardiología) solo tiene "Cómo llegar" y "Al calendario" -sin "Pedir viaje", sin coordenadas activas para ese turno en la base actual-, separados por el aviso "Cargá las coordenadas..." que fuerza su propia línea (`chica:basis-full`); con los tres presentes se acomodarían en una sola fila, confirmado por la mecánica CSS medida, no solo supuesto. El formulario (`/turnos/nuevo`, `/turnos/[id]/editar`) arma "Especialidad" + "Médico (opcional)" -el `<Select>` del directorio- en grilla de 2 columnas cuando hay médicos cargados, y "Fecha"+"Hora" también.
- **`/medicación`:** la tarjeta combina droga+presentación en una línea (antes 2), y el panel de stock pasa de 2-3 líneas a una sola con un badge "N días" al final (`bg-advertencia`/`text-advertencia-foreground`, el par YA verificado en `scripts/verificar-contraste.mjs` como "Etiqueta sobre advertencia sólida") — el aviso "Quedan pocos días..." se mantiene visible entero (dato clínico accionable, no ayuda contextual, regla 5 de `docs/densidad.md` §4). Los chips de horario bajan de `text-sm` a `text-xs`. El formulario empareja "Dosis por toma"+"Unidad" y, condicionalmente, "Frecuencia"+"Cada cuántas horas" (solo cuando la frecuencia es "Cada N horas": con "Todos los días" el campo siguiente es la UI de chips, que necesita ancho completo) y "Fecha de inicio"+"Fecha de fin". El botón de quitar un chip de horario (`components/medicacion/formulario-medicacion.tsx`) medía `size-9` = 36px con la escala compacta (por debajo del piso de 40px, un efecto colateral no buscado de que `--spacing` se comprima) — se agregó `chica:size-10`, medido en **39,99px exactos** tras el fix (chip agregado y quitado por CDP, sin persistir en la base: el formulario nunca se envió). **"Tomas de hoy" no se pudo ver con datos reales**: el estado actual del seed no tiene tomas programadas para el día de la verificación (`obtenerTomasDeHoy` devolvió una lista vacía) — el componente (`registro-toma.tsx`) se revisó por código: ícono de la fila de `size-9` a `chica:size-8` (decorativo, no es objetivo táctil), badge de estado con el mismo patrón de achique que `badge-estado-turno.tsx`, y el botón "Ya la tomé" sigue en `size="lg"` sin tocar -su piso ya baja de 56px a 48px solo por el token `--spacing-tactil-amplio`, sin necesidad de ningún cambio de esta tanda-.
- **`/signos`:** los tres botones "Cargar tensión/glucemia/peso" pasan de columna a fila de 3 -mismo patrón que las tarjetas de carga de `cargador-documento.tsx` en la Tanda 2-, con un matiz nuevo: el botón base (`components/ui/button.tsx`, tamaño `lg`) trae `whitespace-nowrap` de fábrica, que en una fila de 3 hubiera desbordado "Cargar glucemia"; se resolvió con `chica:flex-col chica:whitespace-normal` -ícono arriba, etiqueta abajo, envuelve a 2 líneas-, medido **121×90px** por botón, muy por encima del piso e idénticos entre los tres (confirma la fila pareja). La lista de mediciones combina valor + tiempo relativo + fecha larga + hora en una sola fila que envuelve si hace falta, sin recortar ningún dato. El formulario (`/signos/nuevo`) empareja "Sistólica"/"Diastólica" y "Fecha"/"Hora". `/signos/historial` aplica a `grafico-signo.tsx` el mismo patrón server-side que `grafico-metrica.tsx` recibió en la Tanda 2 (`ALTURA_GRAFICO_POR_TAMANO`, `obtenerTamano()` resuelto en `signos/historial/page.tsx` y bajado por props): medido con `getBoundingClientRect()` sobre `.recharts-responsive-container` real, **260px en grande, 200px en chica**, alternando el modo dos veces para confirmar los dos valores contra el MISMO gráfico.

**Sin overflow horizontal en ningún punto**, confirmado con `document.documentElement.scrollWidth === clientWidth` (411 = 411, el ancho CSS real del Galaxy A71) vía CDP en `/turnos`, `/turnos/nuevo`, `/turnos/[id]/editar`, `/medicación`, `/medicación/nuevo`, `/medicación/[id]/editar`, `/signos`, `/signos/nuevo` y `/signos/historial` — nueve pantallas, cero truncamiento de página.

**Hallazgo fuera de alcance, no corregido acá:** `/turnos/nuevo` (y otras pantallas del módulo) muestran en la consola "Encountered a script tag while rendering React component..." con una excepción no capturada. Se confirmó que **es preexistente**: el mismo error aparece con el código de la Tanda 2 sin ningún cambio de esta tanda (`git stash` + recarga). No se investigó ni se tocó, por estar fuera del alcance de "turnos, medicación y signos compactos" — queda anotado para una tarea aparte.

**Suites completas corridas sobre el código final de esta tanda:** `node scripts/verificar-contraste.mjs` → **196/196 PASS**, 0 fallas (sin tokens de color nuevos: el único color reutilizado, `bg-advertencia`/`text-advertencia-foreground`, ya estaba en el array `GRUPOS`); `npx tsc --noEmit` limpio; `npm run test` → **733/733** (sin tests nuevos: esta tanda es JSX/Tailwind puro, sin lógica de negocio nueva); `npm run build` → build de producción exitoso, 44 rutas; `npx eslint` sobre los 25 archivos tocados, limpio. RLS: **N/A** — esta tanda no tocó ninguna migración ni política SQL.

## Sprint 13 · tarea 13.5 — Tanda 4: coberturas, familia, médicos y SOS compactos — verificación completa en dispositivo real

**2026-08-14.** Samsung Galaxy A71 (SM-A715F) por ADB, `adb reverse tcp:3000 tcp:3000` + `adb forward tcp:9222 localabstract:chrome_devtools_remote` (CDP nativo vía WebSocket de Node 24, sin librería externa salvo `ws` -ya presente en `node_modules` como dependencia transitiva-), sesión persistente de María sobre el perfil gestionado de Roberto, sin volver a loguearse.

**Regla de oro verificada en tres capas.** (1) `git stash` sobre los 24 archivos de la tanda + captura de `/coberturas`, `/medicos`, `/familia` y `/sos` en GRANDE en el panel embebido (375×812) contra el código de la Tanda 3 sin tocar; `git stash pop` + recaptura de las mismas cuatro pantallas con la misma sesión: comparadas a simple vista, indistinguibles. (2) `getBoundingClientRect()` sobre los tres campos del formulario de contacto SOS (`contactoNombre`/`contactoTelefono`/`contactoVinculo`, ver más abajo el porqué de esta grilla en particular) confirmó que en GRANDE los tres siguen apilados en el ORDEN Y LA POSICIÓN exactos de antes (`top` 1537/1700/1863, mismo `left`/`width` para los tres) pese a que ahora comparten un único contenedor `<div>` con la reubicación de Vínculo hecha por CSS `order` en vez de reordenamiento del DOM. (3) En el dispositivo real, se alternó GRANDE con un TAP real sobre A/a (vía CDP `Runtime.evaluate` disparando `.click()` del botón real, no un cambio de atributo simulado) y se volvió a capturar `/medicos`: idéntica en estructura a la captura pre-tanda -especialidad, matrícula e institución en líneas separadas, "Llamar"/"Cómo llegar" apilados a ancho completo, mismo padding-, confirmando que el modo por defecto de la CUENTA (que en este dispositivo ya estaba en CHICA desde la Tanda 3) se puede alternar sin dejar rastro del rediseño.

**Hallazgo de esta tanda, corregido antes de cerrarla:** el primer intento de emparejar "Frente"/"Dorso" en `formulario-cobertura.tsx` con `chica:grid-cols-2` producía una grilla anidada -cada `CampoImagenCredencial` ya arma su propia fila de 2 columnas para "Sacar foto"/"Galería"- que en los 375px de un celular real solapaba el texto de los botones ("Sacar fot" pisando el ícono de "Galería"). Se revirtió esa pareja específica -Frente y Dorso se quedan apiladas en los dos modos, igual que en grande- dejando documentado en el propio componente por qué no se empareja pese al patrón general de la tanda. El resto de las grillas nuevas (proveedor+plan, nombre+especialidad, matrícula+institución, latitud+longitud, nombre+vínculo) son pares de campos de texto simples, sin grillas internas, y no repiten el problema.

**Chica verificado pantalla por pantalla, con datos reales del seed, midiendo por CDP contra el DOM del teléfono:**

- **`/coberturas`:** la tarjeta de PAMI — Pensionados combina plan + N.º de afiliado en una línea (antes 2), mismo patrón "ocultar la versión larga con `chica:hidden`, mostrar la combinada con `hidden chica:block`" que ya usó `tarjeta-medicacion.tsx` en la Tanda 3. Las miniaturas de credencial (`miniatura-credencial.tsx`) bajan de 64px a 56px (`chica:size-14`), y el formulario empareja "Obra social o prepaga"+"Plan" en grilla de 2, con "Número de afiliado" a ancho completo (es el dato más largo de los tres). El visor a pantalla completa (`visor-credencial.tsx`) **no se tocó** -ni un `chica:` agregado-: usa `text-base`/`min-h-tactil` sin prefijo, que ya se compactan solos vía token, y el criterio de la tarea pedía explícitamente "sin cambios funcionales".
- **`/medicos`:** especialidad + matrícula + institución se combinan en una línea (antes 3). "Llamar"/"Cómo llegar" pasan a fila compacta con `chica:grid-cols-2`, medidos por CDP en **49,5px de alto** (`min-h-tactil-amplio` en chica, sin tocar el prop `size="lg"` del botón — el token ya resuelve el piso solo). El formulario empareja "Nombre"+"Especialidad" y "Matrícula"+"Institución" (dos grillas separadas, cada una de campos consecutivos en el DOM) y "Latitud"+"Longitud" (ya emparejados desde antes, ahora también en chica sin esperar a `sm:`).
- **`/familia`:** la lista de accesos otorgados (`tarjeta-permiso.tsx`) queda más apretada -avatar, badges y formulario de edición con menos gap/padding-, con las explicaciones largas de cada checkbox ("Sube documentos, turnos y mediciones nuevas.") ocultas en chica (`chica:hidden`, es ayuda contextual — el nombre del permiso, "Puede cargar datos"/"Administra", queda siempre visible). El formulario de invitar por email sigue el mismo criterio.
- **`/perfil/sos` (edición):** los tres grupos de chips (alergias/crónicas/medicación crítica) más compactos -gap y padding del chip, botón de quitar fijado a `chica:size-10` (40px exacto, medido por CDP: **39,99px**) por el mismo motivo que documentó la Tanda 3 para los chips de horario de medicación-. El contacto de emergencia arma "Nombre"+"Vínculo" en una grilla de 2 con "Teléfono" a ancho completo debajo: los TRES campos viven en un único `<div>` grid y la reubicación visual de "Vínculo" (que en el DOM sigue yendo después de "Teléfono") se hace con `chica:order-*`, nunca reordenando el DOM -así grande, que no aplica esas clases, queda con la disposición original pixel a pixel, verificado en la capa 2 de arriba-. Es un desvío acotado y deliberado de WCAG 1.3.2 (orden de tabulación ≠ orden visual) confinado a estos tres campos, documentado en el propio componente.
- **`/sos` (ficha):** el grupo sanguíneo sigue dominando la pantalla por lejos -medido por CDP: **44px** de la tipografía del valor ("O+") contra 26px del `<h1>` con el nombre y 20px de los títulos de sección-, con la tarjeta que lo contiene apenas más compacta (`py-6` → `py-4`, el número en sí no se toca). El botón `tel:` del contacto de emergencia -único control de toda la ficha con una excepción documentada al piso de 40px del modo compacto- midió **57,5px** de alto por CDP, muy por encima de los 48px mínimos exigidos por el criterio de la tarea, gracias a que sigue usando `min-h-tactil-amplio` (que en chica ya resuelve ~49,5px por el token, sin ningún cambio de esta tanda) más el margen que deja el texto de dos líneas. Las tres listas de datos clínicos (alergias, crónicas, medicación) bajan su espaciado entre ítems (`gap-1` → `chica:gap-0.5`) sin tocar el tamaño de letra. "Datos revisados el ..." al pie, sin cambios, tal como pedía el encargo.

**Sin overflow horizontal en ninguna de las pantallas tocadas**, confirmado con `document.documentElement.scrollWidth === clientWidth` vía CDP en `/coberturas`, `/coberturas/nuevo`, `/coberturas/[id]/editar`, `/medicos`, `/medicos/nuevo`, `/medicos/[id]/editar`, `/familia`, `/perfil/sos` y `/sos`.

**Consola:** se repite el mismo "Encountered a script tag while rendering React component..." que la Tanda 3 ya documentó como preexistente y fuera de alcance -se volvió a confirmar acá reproduciéndolo también en `/inicio`, una pantalla que esta tanda no tocó, con el código YA con `git stash pop` aplicado-. No se investigó ni se tocó, mismo criterio que la entrada anterior.

**Suites completas corridas sobre el código final de esta tanda:** `node scripts/verificar-contraste.mjs` → **196/196 PASS**, 0 fallas (sin tokens de color nuevos); `npx tsc --noEmit` limpio; `npx eslint .` limpio (el único warning intermedio -un `eslint-disable-next-line` que quedó apuntando a la línea equivocada tras reformatear el `<img>` de `miniatura-credencial.tsx`- se corrigió antes de cerrar la tanda); `npx vitest run` → **733/733** (sin tests nuevos: tanda puramente JSX/Tailwind, sin lógica de negocio nueva); `npx next build` → build de producción exitoso, 44 rutas, sin advertencias nuevas. RLS: **N/A** — esta tanda no tocó ninguna migración ni política SQL.
