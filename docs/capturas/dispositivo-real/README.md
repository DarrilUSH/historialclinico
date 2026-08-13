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

Flujo verificado con toques e ingreso de texto reales por ADB: login de María → selección del perfil gestionado de Roberto → inicio. El camino de error (submit vacío) también se verificó en pantalla física.

## Sprint 4 — pantalla de revisión (tarea 4.5)

Flujo feliz completo en el dispositivo real: login de María → `/estudios/nuevo` → "Sacar foto" (la cámara nativa de Samsung se abre directo, sin selector intermedio) → compresión client-side confirmada en pantalla (6,2 MB → 145,1 KB) → subida → `/estudios/nuevo/procesando` → como la foto salió sin luz, Gemini no detectó nada legible y la pantalla cayó al fallback (`sprint4-revision-fallback.png`): la ruta **no murió**, el formulario quedó disponible para carga manual con el mismo diseño que el camino feliz. Se verificó además que el campo "Fecha del estudio" abre el selector de fecha **nativo** de Android (`sprint4-revision.png`), no una implementación HTML casera — clave para el criterio Senior UX del roadmap ("los date pickers nativos móviles son excelentes").

## Sprint 4 — fix de `accept` mixto en Android Chrome

Bug reproducido y documentado en la tarea anterior: un `<input type="file" accept=".pdf,image/*">` (PDF + MIME de imagen combinados) abre siempre la hoja multimedia "Cámara / Fotos y videos" en Android Chrome — el PDF queda inalcanzable desde el celular. La corrección separa el camino "Elegir archivo" en dos inputs de un solo tipo cada uno (`components/documentos/cargador-documento.tsx`): "Elegir un PDF" (`accept="application/pdf"`) y "Elegir de la galería" (`accept="image/*"`, sin `capture`).

Verificado en el dispositivo real: "Elegir un PDF" abre el selector de documentos del sistema (`sprint4-selector-pdf.png`); "Elegir de la galería" abre la hoja de fotos (`sprint4-selector-galeria.png`). Las dos capturas se guardaron recortadas porque el contenido completo de cada selector muestra datos personales del dueño del dispositivo (nombres de archivos PDF reales y fotos reales) — el recorte conserva la cabecera de cada selector, suficiente para demostrar cuál se abrió, sin exponer ese contenido.
