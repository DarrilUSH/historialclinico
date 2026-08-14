# Auditoría de accesibilidad WCAG 2.1 AA

Sprint 11, tarea 11.5. Auditoría completa de la PWA contra WCAG 2.1 nivel AA,
con las correcciones aplicadas en el mismo pasaje.

- **Fecha:** 2026-08-14
- **Alcance:** toda la app servida (`next dev` en `:3000`, Supabase local, seed
  con los perfiles María y Roberto Gómez), 128 componentes `.tsx` y
  `app/globals.css`.
- **Veredicto:** **sin hallazgos críticos ni altos abiertos.** Los 4 hallazgos
  altos y los 4 medios encontrados están corregidos y verificados en el HTML
  servido. Quedan 3 bajos documentados con plan (§7).

> **Por qué esta auditoría importa más que el promedio.** El público objetivo
> son adultos mayores. Acá la accesibilidad no es una casilla de compliance: es
> la función central del producto. Un foco que se pierde no es una molestia,
> es una persona de 80 años que no encuentra dónde estaba y abandona la carga
> de su medicación.

---

## 1. Metodología

### 1.1 Reemplazo del criterio de la skill `a11y-audit`

El roadmap pedía correr la skill `a11y-audit`. La skill se invocó, y su
catálogo de checks (A–L) se usó como **guion de cobertura**, pero su
implementación no aplica a este proyecto: hace `Glob` sobre `**/*.php`,
`**/*.html`, `**/*.css`, `**/*.js` y cruza `<img>` / `<label for>` / `<h1>` con
expresiones regulares sobre archivos de plantilla. Este proyecto es Next.js 16
con React Server Components: **no hay un solo `.php` ni `.html`**, el markup se
compone en `.tsx` a través de primitivos (`components/ui/`) y librerías
headless (Base UI), y buena parte de los atributos de accesibilidad
—`aria-hidden` del ícono del `Select`, `aria-expanded` del trigger, el
`role="dialog"` del diálogo— **los inyecta la librería en runtime y no existen
en el código fuente**.

Mismo criterio que la tarea 11.1 aplicó con `pwa-audit`.

| Check de la skill | Cómo se reemplazó acá |
|---|---|
| A. `lang` en `<html>` | `getComputedStyle`/DOM sobre el HTML servido en las 9 rutas de §5 |
| B. Imágenes y SVG | Barrido de `<img>` en el DOM servido + revisión de los 8 usos en fuente |
| C. Formularios | Enumeración de `input/select/textarea` con `element.labels`, `aria-describedby`, `aria-invalid` en el DOM real |
| D. Jerarquía de headings | Recolección de `h1..h6` **renderizados** y detección programática de saltos de nivel |
| E. Landmarks | `document.querySelectorAll('main,[role=main]')` por ruta (fuente: `CardTitle` es un `<div>`, invisible a un grep de `<h1>`) |
| F. Skip link | Verificado con **Tab real**, no por grep: importa que sea la *primera* parada |
| G. Foco visible | Medición de estilo computado enfocado vs. clon sin foco (§1.3) |
| H. ARIA mal usado | `tabindex` positivos, `aria-hidden` sobre focusables, `role=button` en `div` |
| I. Contraste | **No se rehízo**: `scripts/verificar-contraste.mjs` ya mide 98 pares AA con conversión OKLCH→sRGB→luminancia. La heurística por hex de la skill es estrictamente peor |
| J. Color como única señal | Revisión de estados: `Alerta` lleva ícono + texto, la bottom nav marca activo por color **y** barra superior |
| K. Movimiento | Emulación real de `prefers-reduced-motion` (§6) |
| L. Navegación por teclado | Recorrido completo con Tab/Enter/Escape/flechas (§4) |

### 1.2 Herramientas

Playwright (Chromium) contra el dev server, con sesión real
(`maria@ejemplo.com.ar`, perfil activo Roberto Gómez). Todo lo que se afirma
acá está medido sobre el **HTML servido**, no leído del código fuente. Dos
barridos de código en paralelo cubrieron los 128 `.tsx` para localizar
candidatos; **cada candidato se confirmó o descartó en el navegador**.

### 1.3 Dos correcciones al método (y por qué importan)

El arnés de medición de foco dio falsos resultados dos veces antes de quedar
confiable. Se documentan porque cualquier auditoría futura va a chocar con lo
mismo:

1. **Modalidad de teclado.** `element.focus()` por script **no** hace que
   `:focus-visible` matchee si la última interacción real fue un click de
   mouse. Con el foco puesto por script después de un click, todos los
   controles parecían no tener indicador. Se resolvió disparando **una tecla
   Tab real** antes del barrido: a partir de ahí Chromium considera la
   modalidad "teclado" y el foco programático sí matchea `:focus-visible`.
2. **Transiciones en curso.** Los primitivos tienen `transition-all
   duration-150`. Al medir inmediatamente después de enfocar, el anillo está a
   alpha 0 y `box-shadow` se lee como `rgba(0,0,0,0) 0px 0px 0px 0px`: parece
   ausente. Se resolvió esperando 200 ms.
3. **Sombra en reposo.** Comparar `boxShadow !== 'none'` da falso positivo en
   cualquier elemento con `shadow-suave` propio. Se resolvió **clonando** el
   elemento sin foco en el mismo padre y comparando el estilo computado del
   original enfocado contra el del clon.

Un cuarto falso positivo vino del cálculo de nombre accesible: un `<a>` cuyo
único hijo es `<img alt="…">` tiene `innerText` vacío, y el arnés lo reportaba
como "sin nombre" (las credenciales de `/sos`). Se verificó con un caso de
control inyectado en la página —imagen rota y imagen que carga— que Playwright
las resuelve como `getByRole('link', { name: 'ALT DE IMAGEN ROTA' })`: el link
**sí** toma el `alt`, incluso con la imagen en 404. No era un hallazgo.

**Trampa del entorno, para la próxima auditoría.** Emular una media query en
Playwright para probar `prefers-reduced-motion` puede dejar el navegador con
`media: 'print'` activo. Con print emulado, `/ficha` renderiza a ancho completo
—correcto: es su hoja imprimible— y parece una regresión de layout. Se detectó
al medir (`matchMedia('print').matches === true`) en vez de confiar en la
captura. **Toda medición de §5 y §6.1 se rehízo con `emulateMedia({ media:
'screen' })` explícito y con `esPrint: false` verificado en cada ruta.**

---

## 2. Hallazgos por severidad

Severidad: **Alta** = barrera real de uso o incumplimiento AA verificado;
**Media** = incumplimiento de nivel A/AA de impacto acotado o desvío del
estándar propio del proyecto; **Baja** = mejora sin incumplimiento.

### 2.1 Altos (4) — todos corregidos

#### A-1 · Enter en el campo de horarios enviaba el formulario en vez de agregar el horario

- **Dónde:** `components/medicacion/formulario-medicacion.tsx`, `CampoHorarios`
  (selector `#horario-nuevo`).
- **Qué falló:** el `<input type="time">` no tenía manejador de `Enter`. Dentro
  de un `<form>`, Enter dispara el envío implícito. Medido: se escribe `08:00`,
  se aprieta Enter → **no se agrega ningún chip**, el formulario intenta
  guardarse y el foco salta a `#nombre` por la validación nativa. El gesto más
  natural del teclado quedaba roto justo en el campo que define cuándo tomar un
  medicamento.
- **Criterio:** 2.1.1 Teclado / 3.2.2 Al recibir entradas.
- **Fix aplicado:** `onKeyDown` con `preventDefault()` + `agregar()`, el mismo
  manejador que `components/sos/formulario-sos.tsx` ya tenía. El defecto era una
  inconsistencia entre dos formularios hermanos, no un patrón ausente.

#### A-2 · El foco se perdía al `<body>` al agregar o quitar un chip

- **Dónde:** `formulario-medicacion.tsx` (horarios) y `formulario-sos.tsx`
  (alergias, enfermedades crónicas, medicación crítica).
- **Qué falló:** al agregar, el botón "Agregar" queda `disabled` (ya no hay nada
  que agregar) y **un botón deshabilitado no puede retener el foco**; al quitar,
  el botón del aspa desaparece del DOM con su chip. En los dos casos
  `document.activeElement` pasaba a ser `<body>`: medido y confirmado
  (`esBody: true`). Alguien cargando tres horarios con teclado era devuelto al
  principio del documento entre horario y horario, y tenía que volver a tabular
  ~11 controles.
- **Criterio:** 2.4.3 Orden del foco.
- **Fix aplicado:** se devuelve el foco al campo de entrada tras agregar y tras
  quitar, en los dos formularios.

#### A-3 · Cuatro pantallas sin `<h1>` y sin `<main>`

- **Dónde:** `/login`, `/registro`, `/recuperar`, `/recuperar/confirmar`.
- **Qué falló:** dos causas. (a) `app/(auth)/layout.tsx` renderizaba un `<div>`,
  así que estas cuatro rutas eran las únicas de la app **sin ningún landmark**.
  (b) `CardTitle` (`components/ui/card.tsx`) renderiza un `<div>`, y estas
  pantallas usan la tarjeta como pantalla completa: el título "Iniciar sesión"
  era un `div`. Medido en `/login`: `landmarks: []`, `headings: []` — **cero
  encabezados en toda la página**. Un lector de pantalla no tenía dónde saltar
  ni cómo orientarse en la pantalla de entrada al producto.
- **Criterio:** 1.3.1 Información y relaciones / 2.4.6 Encabezados y etiquetas.
- **Fix aplicado:** `<main>` en el layout de auth; `CardTitle` acepta `como`
  (`"div" | "h1" | "h2" | "h3"`, default `"div"`) y `FormularioAuth` pasa
  `como="h1"`. **Sin cambio visual**: el h1 mide 28px/600, exactamente lo que
  daba `text-2xl` en el `div`.

#### A-4 · Botón de cerrar de todos los diálogos anunciado en inglés

- **Dónde:** `components/ui/dialog.tsx` — `<span className="sr-only">Close</span>`.
- **Qué falló:** ese `sr-only` es el **único** nombre accesible del botón, y
  `DialogoConfirmacion` nunca pisa `showCloseButton`, así que aparecía en los 9
  flujos de confirmación de la app (suspender medicación, revocar acceso,
  cancelar turno, dar de baja un médico…). Un lector de pantalla en castellano
  anunciaba "Close, botón". Confirmado en vivo antes del fix:
  `controles: ["Volver", "Sí, suspender", "Close"]`.
- **Criterio:** 3.1.2 Idioma de las partes.
- **Fix aplicado:** `"Cerrar"`, más `aria-hidden="true"` en el `<XIcon>`.
  Verificado después: `controles: ["Volver", "Sí, suspender", "Cerrar"]`,
  `hayIngles: false`.

### 2.2 Medios (4) — todos corregidos

#### M-1 · Sin mecanismo para saltear bloques repetidos

- **Qué falló:** no existía skip link en todo el proyecto. Cada pantalla del
  shell repite encabezado de perfil + barra de conexión antes del contenido.
- **Criterio:** 2.4.1 Evitar bloques (**nivel A**).
- **Fix aplicado:** enlace "Saltar al contenido" en
  `app/(app)/(con-nav)/layout.tsx`, `sr-only` hasta recibir foco, apuntando a
  `#contenido-principal` (el `<main>`, con `tabIndex={-1}` para que el foco se
  mueva de verdad y no solo el scroll).
- **Detalle que la verificación cazó:** con el aviso "Hay una versión nueva" en
  pantalla, el botón "Actualizar" se comía la primera Tab y el salto quedaba
  segundo. Se movió el enlace **antes** de `RegistroServiceWorker` en el árbol.
  Verificado: primera Tab = "Saltar al contenido" (202×50 px, visible), Enter
  mueve el foco a `MAIN#contenido-principal`.
  Evidencia: `docs/capturas/a11y/skip-link-primera-tab.png`.

#### M-2 · Salto de nivel de encabezado (h1 → h3) en tres listados

- **Dónde:** `/coberturas`, `/medicos`, `/medicacion`.
- **Qué falló:** el título de cada tarjeta era `<h3>` y el único `<h2>` de esas
  pantallas vivía en el **estado vacío**, que por definición nunca coexiste con
  la lista. En `/medicacion` el `<h2>` "Tomas de hoy" es condicional
  (`SeccionTomasDeHoy` devuelve `null` sin dosis programadas), así que cualquier
  día sin tomas quedaba `h1 → h3`. Medido en vivo: `H1:Medicación`,
  `H3:Enalapril`, `H3:Glucophage`.
- **Criterio:** 1.3.1 Información y relaciones.
- **Fix aplicado:** `h3` → `h2` en `tarjeta-cobertura.tsx`, `tarjeta-medico.tsx`
  y `tarjeta-medicacion.tsx` (las dos variantes, activa y suspendida). El tamaño
  lo sigue fijando `text-lg`/`text-base`: **sin cambio visual**.

#### M-3 · Cuatro rutas sin landmark `<main>`

- **Dónde:** `/ficha`, `/ficha/historial`, `/ficha/historial/[id]`, `/compartir`.
- **Qué falló:** `app/(app)/(sin-nav)/` no tenía `layout.tsx`, así que sus rutas
  colgaban del layout raíz sin ningún landmark. Incluye **la hoja imprimible**,
  una de las dos pantallas críticas del producto.
- **Criterio:** 1.3.1.
- **Fix aplicado:** `app/(app)/(sin-nav)/layout.tsx` con `<main className="flex
  flex-1 flex-col">`, y los dos `<main>` que `/perfiles` se auto-proveía bajados
  a `<div>` para no anidar landmarks. Verificado: exactamente **1 `<main>`** en
  las 9 rutas de §5.

#### M-4 · Objetivo táctil del aspa de los chips por debajo del estándar propio

- **Qué falló:** el botón de quitar chip medía **27×27 px** (`size-6`). Cumple
  WCAG 2.2 SC 2.5.8 (mínimo 24), pero el estándar del proyecto
  (`docs/design-system.md` §5, Senior UX) pide 48, y es el control que más se
  falla con temblor esencial o dedo grueso.
- **Fix aplicado:** `size-9` (40 px medidos: 41×41) en los chips de horarios y
  en los de la ficha SOS, con anillo de foco explícito. El chip crece apenas
  porque el padding derecho baja de `pr-2` a `pr-1.5`.

### 2.3 Bajos — corregidos en el pasaje

- **B-1 · `lang="es"` → `lang="es-AR"`** (`app/layout.tsx`). Toda la app está en
  castellano rioplatense; la etiqueta de región es lo que usa el lector de
  pantalla para elegir voz y pronunciación (3.1.1).
- **B-2 · Íconos decorativos sin `aria-hidden`** en `components/ui/checkbox.tsx`,
  los 5 íconos de estado de `components/ui/sonner.tsx` y el `ChevronRightIcon`
  de `app/(app)/(sin-nav)/ficha/historial/page.tsx`. El resto del proyecto ya
  seguía la regla (221 de ~280 usos la tenían explícita; casi todo el resto
  heredaba `aria-hidden` del contenedor).

---

## 3. Lo que se revisó y **no** era un hallazgo

Documentado para que una auditoría futura no vuelva a levantarlo:

| Sospecha | Veredicto |
|---|---|
| Links de credencial en `/sos` sin nombre accesible | **Falso positivo del arnés.** El `<a>` toma el `alt` del `<img>`; verificado con caso de control, incluso con la imagen en 404 |
| `<input>` con valor `daily` / `O+` expuesto como campo suelto | **No.** Es el input de submit de Base UI Select: `tabindex="-1"` + `aria-hidden="true"`, fuera del orden de tabulación y del árbol de accesibilidad |
| Chevron del `Select` sin `aria-hidden` en el fuente | **No.** `SelectPrimitive.Icon` lo inyecta en runtime; el HTML servido tiene `aria-hidden="true"`. Ejemplo exacto de por qué se audita el HTML servido |
| Checkbox de `/familia` de 27×27 sin foco visible | **No, por dos motivos.** (a) El anillo sí aplica: `oklab(…/0.5) 0 0 0 3px` más cambio de borde a `--ring`; el barrido lo perdía por medir a 120 ms con transición de 150 ms. (b) El control está dentro de un `<label>` de **261×79 px**, que es el área real de activación |
| Puntos de los gráficos (`<g onClick>`) sin acceso por teclado | **Conforme por alternativa.** El SVG es `aria-hidden` dentro de un `role="img"` con resumen en `aria-label`, y hay una **tabla real** en un `<details>` "Ver como tabla", 100% operable por teclado. Está documentado en la cabecera de `grafico-signo.tsx` |
| Banners de renovación y de alerta sin `aria-live` | **Decisión correcta.** Usan `Alerta … estatica`: son avisos permanentes; con `role="alert"` un lector los anunciaría en **cada** carga de página |
| Imágenes sin `alt` o con `alt` genérico | **Ninguna.** Los 8 `<img>` del proyecto tienen `alt` descriptivo con proveedor y lado ("Credencial de PAMI — Pensionados — frente") o título del documento |
| Campos sin label | **Ninguno.** `CampoTexto`/`CampoNumero`/`CampoTextarea` resuelven `htmlFor`+`id`+`aria-describedby`+`aria-invalid` una sola vez; los `<input type="hidden">` de los chips son ocultos de verdad y no ensucian el árbol |
| `role="button"` sobre `div`/`span` | **Ninguno.** `TarjetaInteractiva` siempre renderiza `<button type="button">` real |
| `tabindex` positivos | **Ninguno.** |

---

## 4. Recorrido completo del flujo principal SOLO con teclado

Tab / Shift+Tab / Enter / Escape / flechas. Sin mouse. Ejecutado con teclas
reales de Playwright sobre la sesión seed.

| # | Paso | Teclas | Resultado |
|---|---|---|---|
| 1 | `/login` — foco al correo | Tab | Campo con label asociado "Correo electrónico" · OK |
| 2 | Contraseña y envío | Tab, Enter | Entra a `/perfiles` · OK |
| 3 | `/perfiles` — tarjeta "María Gómez" | Tab | Anillo de foco visible (evidencia: `foco-visible-perfiles.png`) · OK |
| 4 | Elegir "Roberto Gómez" | Tab, Enter | Entra a `/inicio` · OK |
| 5 | `/inicio` — salto de contenido | Tab | **Primera parada = "Saltar al contenido"** (tras el fix M-1) · OK |
| 6 | Saltar al `<main>` | Enter | Foco en `MAIN#contenido-principal` · OK |
| 7 | Llegar a "SOS · Ficha de emergencia" | Tab ×4 | 432×68 px, nombre y foco correctos · OK |
| 8 | Abrir la ficha SOS | Enter | Entra a `/sos` · OK |
| 9 | `/sos` — 10 paradas | Tab | 0 sin nombre, 0 sin foco. h1 + 6 h2, 1 `<main>` · OK |
| 10 | Volver | Tab a "Inicio" (bottom nav), Enter | Vuelve a `/inicio`; `aria-current="page"` en la pestaña activa · OK |
| 11 | Ir a medicación | Tab a "Medicación", Enter | Entra a `/medicacion` · OK |
| 12 | `/medicacion` — 13 paradas | Tab | 0 sin nombre, 0 sin foco · OK |
| 13 | Abrir "Nueva medicación" | Enter | Entra a `/medicacion/nuevo` · OK |
| 14 | Recorrer el formulario | Tab | 22 paradas, todas con label asociado · OK |
| 15 | **Select "Frecuencia"** — abrir | Enter | `aria-expanded=true`, foco en la opción seleccionada · OK |
| 16 | Select — navegar | ↓ | Pasa a "Cada N horas"; opción enfocada distinguida por fondo **y** color de texto (`accent-foreground`/`accent`, 9.94:1) · OK |
| 17 | Select — cancelar | Escape | Cierra, **foco vuelve al trigger**, valor sin cambios · OK |
| 18 | **Chips de horario** — cargar 08:00 | dígitos, Enter | Chip agregado, **foco queda en el campo** (tras A-1 y A-2) · OK |
| 19 | Chips — cargar 12:30 y 20:00 | dígitos, Enter ×2 | 3 chips: `["08:00","12:30","20:00"]`, foco siempre en el campo · OK |
| 20 | Chips — quitar el del medio | Tab al aspa, Enter | Queda `["08:00","20:00"]`, **foco devuelto al campo** · OK |
| 21 | Chips — seguir cargando tras quitar | dígitos, Enter | `["07:30","08:00","20:00"]` · OK |
| 22 | **Diálogo de confirmación** — abrir | Enter en "Suspender" | `role="dialog"`, `aria-labelledby` + `aria-describedby`, título `h2` · OK |
| 23 | Diálogo — foco inicial | — | En "Volver" (opción segura, no la destructiva) · OK |
| 24 | Diálogo — trampa de foco | Tab ×3 | Cicla dentro del diálogo, nunca se escapa · OK |
| 25 | Diálogo — cerrar | Escape | Cierra y **devuelve el foco al disparador exacto** · OK |
| 26 | Ir a turnos | Tab a "Turnos", Enter | `/turnos`: 15 paradas, 0 sin nombre, 0 sin foco · OK |
| 27 | Ir a familia | Tab a "Familia", Enter | `/familia`: 27 paradas, 0 sin nombre, 0 sin foco · OK |

**Sin trampas de foco en ningún punto del recorrido.** Las únicas trampas son
las deseadas: la del diálogo modal, que libera con Escape.

**Nota sobre `<input type="time">` (comportamiento nativo, no defecto).**
Chromium le maneja segmentos internos (hora/minuto) y Tab los recorre antes de
salir del campo. Además, los dígitos entran en el segmento **activo**: como
después de agregar un horario el foco nunca sale del campo, un `focus()` a
secas es un no-op y el puntero de segmento se queda en los minutos —tipear
"2000" llenaba minutos dos veces, la hora quedaba vacía, y un `input[type=time]`
solo reporta `value` con todos los segmentos completos, así que el campo
devolvía `""` y "Agregar" no hacía nada. El segundo horario era imposible de
cargar. Se resolvió con `blur()` + `focus()` dentro de un
`requestAnimationFrame` (verificado: con reset "2000" da "20:00"; sin reset da
`""`).

---

## 5. Foco visible, semántica y nombres accesibles — resultado por pantalla

Barrido programático: para cada control se enfoca, se espera a que termine la
transición y se compara el estilo computado contra un clon sin foco.

| Ruta | Paradas | Sin nombre | Sin foco visible | `<main>` | Encabezados | Skip link |
|---|---|---|---|---|---|---|
| `/login` | 5 | 0 | 0 | 1 | `h1` | — (sin bloques repetidos) |
| `/registro` | 6 | 0 | 0 | 1 | `h1` | — |
| `/recuperar` | 3 | 0 | 0 | 1 | `h1` | — |
| `/perfiles` | 3 | 0 | 0 | 1 | `h1` | — |
| `/inicio` | 23 | 0 | 0 | 1 | `h1` | sí |
| `/sos` | 10 | 0 | 0 | 1 | `h1`,`h2`×6 | sí |
| `/medicacion` | 13 | 0 | 0 | 1 | `h1`,`h2`×2 | sí |
| `/medicacion/nuevo` | 21 | 0 | 0 | 1 | `h1` | sí |
| `/coberturas` | 12 | 0 | 0 | 1 | `h1`,`h2` | sí |
| `/medicos` | 16 | 0 | 0 | 1 | `h1`,`h2`×2 | sí |
| `/turnos` | 15 | 0 | 0 | 1 | `h1`,`h2` | sí |
| `/familia` | 21 | 0 | 0 | 1 | `h1`,`h2`×2 | sí |
| `/perfil/sos` | 26 | 0 | 0 | 1 | `h1`,`h2` | sí |
| `/ficha` | 2 | 0 | 0 | 1 | `h1` | — |

**176 paradas de teclado medidas una por una en 14 rutas: 0 sin nombre
accesible, 0 sin indicador de foco.** `lang="es-AR"` y **exactamente un
`<main>`** en las 14. **Cero saltos de nivel de encabezado** tras M-2
(detectados programáticamente comparando cada nivel con el anterior).

El conteo de paradas varía en ±2 entre corridas según esté visible o no el
aviso "Hay una versión nueva" del service worker (aporta su botón
"Actualizar"). Los ceros de las dos columnas del medio no varían.

### 5.1 Objetivos táctiles (spot-check de 10 controles clave)

| Control | Pantalla | Medido | Estado |
|---|---|---|---|
| Botón SOS | `/inicio` | 432×68 | OK (token `min-h-sos-boton`) |
| Tarjeta de perfil | `/perfiles` | 367×289 | OK |
| Pestañas de la bottom nav | shell | 189×86 | OK |
| Tarjetas de acceso ("Medicación", "Signos"…) | `/inicio` | 432×100 | OK |
| "Llamar a Gabriela Gómez" | `/sos` | 675×59 | OK |
| Enlace "Cambiar" del encabezado | shell | 117×50 | OK |
| "Saltar al contenido" (enfocado) | shell | 202×50 | OK |
| Aspa de quitar chip | `/medicacion/nuevo`, `/perfil/sos` | 41×41 | OK tras M-4 (era 27×27) |
| Casilla de permiso (área real del `<label>`) | `/familia` | 261×79 | OK |
| Campo de hora | `/medicacion/nuevo` | 496×50 | OK |

---

## 6. Zoom al 200% y movimiento reducido

### 6.1 Zoom 200%

Viewport 640×400, equivalente a 1280×800 con zoom al 200%. Se midió
`documentElement.scrollWidth > clientWidth` y todo elemento cuyo borde derecho
supera el ancho del viewport (excluyendo `position: fixed`).

| Pantalla | Scroll horizontal | Elementos desbordados | Bottom nav usable |
|---|---|---|---|
| `/inicio` | **no** | 0 | sí (86 px) |
| `/sos` | **no** | 0 | sí |
| `/medicacion` | **no** | 0 | sí |
| `/estudios` | **no** | 0 | sí |
| `/signos/historial` (gráficos) | **no** | 0 | sí |
| `/medicacion/nuevo` | **no** | 0 | sí |
| `/perfil/sos` | **no** | 0 | sí |

**Sin contenido cortado y sin scroll horizontal de página en ninguna.** Los
gráficos de `/signos/historial` se reajustan dentro de su contenedor, sin
empujar la página. Verificado **después** de aplicar los fixes (el skip link y
los chips más grandes no introdujeron desbordes).
Evidencia: `docs/capturas/a11y/zoom-200-signos-historial.png`.

### 6.2 `prefers-reduced-motion`

`app/globals.css` ya traía el bloque global correcto. Se verificó que llega al
CSS servido y que **efectivamente gana**, emulando la media query:

| Estado | `transition-duration` | `animation-duration` |
|---|---|---|
| Normal | `0.15s` | `0s` |
| `prefers-reduced-motion: reduce` | **`1e-05s`** | **`1e-05s`** |

Cuatro reglas cubren el caso: el bloque global `*, ::before, ::after` con
`!important` (incluye `animation-iteration-count: 1`, que corta el
`animate-spin` de los spinners y cualquier animación infinita), una regla propia
de `sonner` para los toasts, una de `shimmer`, y `prefers-contrast: more` que
endurece bordes y texto secundario. **Sin hallazgos: no hizo falta agregar
nada.**

---

## 7. Hallazgos bajos abiertos, con plan

Ninguno incumple WCAG 2.1 AA. Se documentan para el pulido posterior.

1. **Errores de servidor no asociados al campo.**
   `formulario-medicacion.tsx` y `formulario-signo.tsx` muestran un único
   `<Alerta variante="error">` global. La alerta **sí** lleva `role="alert"` y se
   anuncia al aparecer, y el caso frecuente —campo obligatorio vacío— lo cubre
   la validación nativa del navegador, que **sí** está asociada al campo:
   medido, el foco salta a `#nombre` con `validationMessage: "Completa este
   campo"` y `:invalid`. Lo que falta es señalar *qué* campo rechazó el servidor
   cuando el error viene de Zod. **Por qué no se corrigió acá:**
   `EstadoMedicacionAccion` y `EstadoSignoAccion` son `{ error: string | null }`
   — hace falta cambiar el contrato de las Server Actions a un mapa de errores
   por campo, lo que excede una auditoría de accesibilidad y toca lógica de
   dominio. `CampoTexto`/`CampoNumero` **ya soportan** `error` +
   `aria-describedby` por campo (se usa en `formulario-auth.tsx`): el trabajo es
   del lado de la acción, no del componente. Criterio afectado: 3.3.1, de forma
   parcial.
2. **Botones `size="sm"` a 45 px** (`components/ui/button.tsx`): "Cómo llegar",
   "Pedir viaje", "Al calendario", "Ya lo vi", "Instalar la app". Cumplen WCAG
   2.1 AA (2.5.5 es AAA) y WCAG 2.2 AA (2.5.8 pide 24), pero quedan 3 px por
   debajo del `min-h-tactil` del sistema de diseño. Subirlos toca la densidad de
   varias pantallas a la vez; conviene resolverlo junto con el pulido visual, no
   dentro de esta auditoría.
3. **Enlaces de volver a 22–26 px de alto** ("Volver a medicación", "Ir a
   coberturas"). Son enlaces de texto —exentos de 2.5.8— y siempre hay una ruta
   alternativa por la bottom nav. Se anota por el público objetivo.

---

## 8. Archivos modificados

| Archivo | Cambio |
|---|---|
| `app/layout.tsx` | `lang="es-AR"` |
| `app/(auth)/layout.tsx` | `<div>` → `<main>` |
| `app/(app)/(sin-nav)/layout.tsx` | **Nuevo**: landmark `<main>` del grupo |
| `app/(app)/(sin-nav)/perfiles/page.tsx` | `<main>` → `<div>` (lo aporta el layout) |
| `app/(app)/(con-nav)/layout.tsx` | Skip link + `id`/`tabIndex` en `<main>` |
| `app/(app)/(sin-nav)/ficha/historial/page.tsx` | `aria-hidden` en el chevron |
| `app/(auth)/recuperar/confirmar/page.tsx` | `CardTitle como="h1"` |
| `components/ui/card.tsx` | Prop `como` en `CardTitle` |
| `components/ui/dialog.tsx` | "Close" → "Cerrar" (×2) + `aria-hidden` |
| `components/ui/checkbox.tsx`, `components/ui/sonner.tsx` | `aria-hidden` en íconos decorativos |
| `components/auth/formulario-auth.tsx` | `CardTitle como="h1"` |
| `components/medicacion/formulario-medicacion.tsx` | Enter agrega chip, foco devuelto, aspa 27→40 px |
| `components/sos/formulario-sos.tsx` | Foco devuelto, aspa 27→40 px |
| `components/coberturas/tarjeta-cobertura.tsx` | `h3` → `h2` |
| `components/medicos/tarjeta-medico.tsx` | `h3` → `h2` |
| `components/medicacion/tarjeta-medicacion.tsx` | `h3` → `h2` (×2) |

No se tocó SQL: RLS y Storage quedan intactos.

---

## 9. Verificación

```
npm run test                          693/693 (41 archivos)
npx tsc --noEmit                      limpio
npx eslint .                          limpio
npm run build                         limpio (44 páginas)
node scripts/verificar-contraste.mjs  98 pares AA, 0 fallas
scripts/test-rls.sql                  253/253 PASS, 0 FAIL
scripts/test-storage-rls.sh           27/27 PASS, 0 FAIL
```

Las dos últimas se corrieron aunque esta tarea no toca SQL (confirmado:
`git show --stat` no incluye ningún `.sql` ni nada bajo `supabase/`), para dejar
constancia de que el arnés quedó intacto.

**Veredicto final: sin hallazgos críticos ni altos abiertos.** El recorrido del
flujo principal se completa solo con teclado, y al 200% de zoom no hay contenido
cortado ni scroll horizontal en ninguna de las pantallas auditadas.
