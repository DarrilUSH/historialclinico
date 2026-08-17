# Densidad: el modo de letra chica

> Sprint 13, tarea 13.1; **retokenizado y con el default invertido en el Sprint
> 14, tarea 14.1**. Este documento es **el contrato** que tienen que respetar
> las tandas de rediseño vista por vista. Si vas a tocar una pantalla en modo
> compacto, lo que necesitas saber está en la §4, la §5 y la §5-bis.

La app tiene dos modos de densidad visual:

| Modo | Qué es | Estado |
|---|---|---|
| `chica` | Densidad nativa (Sprint 14): 14px de cuerpo, 12-13px el secundario, objetivos táctiles de 40px, espaciado en unidad de 3,5px, radios de 10px, bottom nav de 64px. | **Default desde el Sprint 14.** |
| `grande` | El diseño Senior UX de los Sprints 0 a 12: 18px de cuerpo, objetivos táctiles de 48px, aire generoso. | Opcional, a un toque del botón A/a. **No cambia ni un píxel.** |

El escenario que resuelve, tal como lo fija el ROADMAP: **María (49, ve bien)
usa la app densa y Roberto (80) la usa grande, cada uno sin enterarse del modo
del otro.**

## Por qué el default se invirtió en el Sprint 14

Hasta el Sprint 13, el default era `grande` y era la decisión correcta con la
información de entonces: el modo compacto era una REDUCCIÓN del grande (-12%
abajo, -24% arriba), o sea "la misma app apretada". Con esa v1 en producción, el
veredicto del usuario fue **"sigue siendo enorme"**, y tenía razón por una
cuestión de origen: una escala derivada de 18px de cuerpo aterriza en 16px de
cuerpo, que es el cuerpo cómodo de una app de ESCRITORIO, no el de una de
celular.

El Sprint 14 no achicó más lo mismo: reconstruyó la escala compacta sobre las
métricas de Material 3 y de iOS HIG (§5-bis). Con esa v2, el modo compacto dejó
de ser "lo grande apretado" y pasó a ser la densidad que cualquiera reconoce
como la de una app de celular — y ése es el default razonable para quien abre la
aplicación por primera vez.

Lo que **no** cambió, y conviene decirlo porque es una app pensada para adultos
mayores: el modo grande sigue intacto hasta el píxel, sigue estando a UN toque
(el botón A/a del encabezado, siempre visible, más la pregunta del selector de
perfiles), y elegirlo queda guardado en la fila de la cuenta y viaja a todos sus
dispositivos. Sigue sin haber heurística por edad, `role` ni user-agent: lo
único que el default decide es qué se ve **mientras nadie eligió nada**.

---

## 1. La preferencia es de quien MIRA, no de quien es mirado

Esta es la única idea que hay que tener clara antes de tocar cualquier cosa de
este sistema.

`profiles.display_density` vive en la tabla de perfiles, pero **no describe al
paciente**: describe a la cuenta que tiene la pantalla adelante. Vive ahí por
una razón puramente física —`profiles` es la única tabla del esquema con
`user_id`, o sea la única forma de decir "esta fila es de esta cuenta"— y no
porque sea información clínica.

La consecuencia práctica:

```
María (display_density = 'chica') entra al perfil gestionado de Roberto
(display_density = 'grande', que además es inerte porque no tiene cuenta)
        ↓
La app se ve CHICA. Manda la fila de María.
```

La fila que se lee es siempre `profiles where user_id = auth.uid()`. **El perfil
activo no interviene nunca.** Confundir las dos cosas es el bug que todo este
subsistema está escrito para prevenir, y por eso el modo viaja al encabezado
como una prop propia (`tamano`) en vez de salir de `perfil.display_density`:
si alguien lo leyera del perfil, María vería el tamaño que eligió Roberto.

Reparto con la otra cookie del proyecto:

| | Pregunta que responde | Dónde vive | Módulo |
|---|---|---|---|
| Perfil activo | ¿A quién estoy mirando? | Cookie `perfil_activo` + revalidación de permiso en cada lectura | `lib/perfil-activo.ts` |
| Modo de letra | ¿Quién está mirando? | Cookie espejo `tamano` + fila de la cuenta | `lib/densidad/servidor.ts` |

---

## 2. Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Columna | `supabase/migrations/20260814120000_preferencia_tamano.sql` | `profiles.display_density`, enum `('grande','chica')`, trigger de protección y CHECK de perfiles gestionados |
| Default | `supabase/migrations/20260817150000_default_chica.sql` | Mueve el `DEFAULT` a `chica`, backfillea las filas que heredaron el viejo y recrea el CHECK contra el default nuevo |
| Vocabulario | `lib/densidad/tamano.ts` | Tipo, default, nombre de la cookie, glifos y etiquetas, `esTamano`, `alternar` |
| Resolución | `lib/densidad/servidor.ts` | `obtenerTamano()`, cookie espejo, `persistirTamano()` |
| Atributo | `app/layout.tsx` | `<html data-tamano="…">`, resuelto **server-side** |
| Tokens | `app/globals.css` §5 | Todo lo que cambia entre modos |
| Variante | `app/globals.css` (`@custom-variant chica`) | `chica:` para el rediseño por vista |
| Conmutador permanente | `components/navegacion/boton-tamano.tsx` | Botón A/a del encabezado (Client Component) |
| Conmutador explícito | `components/perfiles/pregunta-tamano.tsx` | "¿Cómo preferís ver la app?" en el selector |
| Acción | `app/(app)/actions.ts` | `cambiarTamano` |
| Verificación | `scripts/verificar-contraste.mjs` | Contraste en 4 combinaciones + invariantes del modo compacto |

---

## 3. Cómo se resuelve el modo en cada request

```
cookie `tamano` válida ──sí──> ese modo                    (camino del 99%, sin base)
        │no
        ▼
   ¿hay sesión? ──no──> chica                              (login, registro, offline, /)
        │sí
        ▼
   profiles.display_density where user_id = auth.uid()
        │
        ├─ hay valor ──> ese modo (+ se escribe la cookie si el contexto lo permite)
        └─ no hay    ──> chica
```

(Las dos hojas dicen `chica` porque las dos son `TAMANO_POR_DEFECTO`, que el
Sprint 14 movió ahí. Verificado en el dispositivo real:
`curl http://localhost:3000/login` sin cookie devuelve `data-tamano="chica"`, y
con `-b tamano=grande` devuelve `data-tamano="grande"`.)

**La fuente de verdad es la fila, no la cookie.** La cookie es un espejo
`httpOnly` que existe para que el layout raíz —que corre en cada request de
cada ruta— no pague un viaje a la base. Se sincroniza en los tres momentos en
que la base es autoritativa:

- **al iniciar sesión** (`iniciarSesion`) — es lo que hace que la preferencia
  *viaje entre dispositivos*: María entrando por primera vez desde la tablet ve
  la letra chica que eligió en el celular;
- **al registrarse** (`registrarse`);
- **al cambiar el modo** (`cambiarTamano`).

Y se **borra al cerrar sesión**, por el mismo motivo que la de perfil activo: en
un navegador compartido, la próxima persona no hereda nada de la anterior.

> **Consecuencia declarada.** Como la cookie tiene prioridad sobre la base, un
> cambio hecho en otro dispositivo se ve en éste recién en el próximo inicio de
> sesión. Es el comportamiento correcto para una preferencia de interfaz —nadie
> espera que se le achique la letra del celular porque tocó un botón en la
> computadora— y es lo que permite que la resolución sea gratis.

### Sin flash, y qué cuesta

El atributo llega **ya escrito en el HTML**, así que no hay un primer pintado
con el tamaño equivocado. La alternativa (un script de cliente, como hace
next-themes) no sirve acá: next-themes puede porque su fuente es `localStorage`,
que es síncrono; la nuestra es una fila de Postgres.

El precio es que leer la cookie hace dinámico todo el árbol: las siete rutas que
`next build` prerenderizaba estáticas (`/`, `/_not-found`, `/estado`,
`/estilos`, `/offline`, `/recuperar`, `/registro`) pasan a renderizarse a
demanda. Se acepta a conciencia: son rutas frías, no hay CDN delante, y en esta
PWA el cacheado real lo hace el service worker.

---

## 4. Las reglas duras del rediseño

**1. El modo grande no se toca.** Ni un píxel. Si una tanda cambia algo que se
ve en `grande`, es un bug de la tanda, aunque mejore la pantalla. La captura
comparativa del criterio de aceptación de cada tanda existe para eso.

**2. Piso táctil de 40px en compacta.** Nada interactivo baja de ahí. Los
tokens ya lo garantizan (`--spacing-tactil` compacto es `max(40px, 2.25rem)`);
lo que no hay que hacer es pisarlos con alturas literales (`h-9`, `h-8`).
`scripts/verificar-contraste.mjs` verifica el piso del token en cada corrida.

**3. Tres pisos, y ya no son el mismo número** (cambió en el Sprint 14):

| Piso | Valor | Dónde vive | Por qué |
|---|---|---|---|
| Cuerpo de texto | **14px** (`text-base`) | `app/globals.css` §5 | `body-medium` de Material 3. Debajo de ahí deja de ser densidad y empieza a ser letra chica de contrato. |
| Texto secundario | **12px** (`text-xs`) | `app/globals.css` §5 | `body-small` de Material 3 / `caption` de iOS. |
| **Campos de formulario** | **16px** | Regla SIN CAPA al final de §5 | iOS Safari hace zoom automático al enfocar un `input`, `select` o `textarea` con menos de 16px. |

Hasta el Sprint 13 los tres eran el mismo piso, porque el cuerpo medía 16px y
los primitivos de `components/ui/` usan `text-base`. **Atar el cuerpo de la app
entera a una restricción de tres elementos de formulario es exactamente lo que
hacía que la v1 se sintiera de escritorio**, así que la v2 los separó: el cuerpo
bajó a 14px y el piso de los campos se mudó a una regla propia,

```css
html[data-tamano="chica"] :is(input, select, textarea) {
  font-size: max(16px, 0.8889rem);
}
```

que va **fuera de toda capa** a propósito. Una regla en `@layer base` perdería:
Tailwind 4 declara `@layer theme, base, components, utilities` y en el orden de
capas gana la última sin importar la especificidad, así que el `text-base` de
los primitivos le ganaría. El CSS sin capa gana sobre todas las capas, que es lo
que corresponde para un piso de accesibilidad que no debe poder pisarse desde la
clase de una pantalla.

`scripts/verificar-contraste.mjs` verifica las tres invariantes en cada corrida.

**4. Un color redefinido en compacta se redefine en los DOS temas.** Ver §6.

**5. La densidad no saca contenido.** Compactar es reorganizar, no esconder: si
una tarjeta muestra menos datos en modo chico, eso no es densidad, es otra
pantalla. Las etiquetas de texto de la bottom nav, los descargos clínicos y las
confirmaciones de acciones destructivas siguen enteros en los dos modos.

**6. El movimiento no cambia.** `prefers-reduced-motion`, las duraciones y las
curvas son las mismas. La densidad es una decisión de espacio, no de tiempo.

---

## 5. Cómo escribir una pantalla en los dos modos

### Lo que sale gratis

La mayor parte del trabajo **no hay que hacerla**: las utilidades de Tailwind 4
resuelven los tokens en tiempo de uso, así que `text-lg`, `p-4`, `gap-3`,
`rounded-xl`, `min-h-tactil` y `size-10` ya miden distinto en cada modo sin
tocar el markup.

| Token | Grande | Chica v1 (Sprint 13) | **Chica v2 (Sprint 14)** |
|---|---|---|---|
| `--text-xs` … `--text-6xl` | 16 / 17 / 18 / 21 / 24 / 28 / 32 / 39 / 48 / 58 px | 14 / 15 / 16 / 18 / 20 / 23 / 26 / 31 / 37 / 44 px | **12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 30 / 36 px** |
| interlineado del cuerpo | 1.6 (28,8px) | 1.5 (24px) | **1.4 (19,6px)** |
| `--spacing` (unidad de toda la escala) | 0.25rem = 4,5px | 0.2222rem = 4px | **0.1944rem = 3,5px** |
| `--spacing-tactil` | `max(48px, 2.75rem)` | `max(40px, 2.25rem)` | `max(40px, 2.25rem)` (sin cambio) |
| `--spacing-tactil-amplio` | `max(56px, 3.25rem)` | `max(48px, 2.75rem)` | **`max(44px, 2.5rem)`** |
| `--spacing-sos-boton` | `max(64px, 3.75rem)` | `max(56px, 3.25rem)` | `max(56px, 3.25rem)` (excepción deliberada) |
| `--spacing-bottom-nav` | 4.75rem = 85,5px | 4rem = 72px | **3.5556rem = 64px** |
| `--radius` | 0.75rem = 13,5px | 0.625rem = 11,25px | **0.5556rem = 10px** |
| `--card-spacing` (padding y gap de tarjeta) | 5 unidades = 22,5px | 5 unidades = 20px | **3,5 unidades = 12,25px** |
| `--muted-foreground`, `--borde-sutil` | base | endurecidos | endurecidos un escalón más (§6) |

Dos de esos tokens no salen del bloque §5 sino de una clase `chica:` en el
primitivo, porque no son tokens globales sino propiedades de un componente:

- `--card-spacing` en `components/ui/card.tsx` y `components/base/tarjeta.tsx`;
- el piso táctil de `size="sm"` / `size="icon-sm"` en `components/ui/button.tsx`
  y de `data-[size=sm]` en `components/ui/select.tsx`. **Esto último es
  obligatorio y hay que tenerlo presente al escribir pantallas nuevas:** con la
  unidad de espaciado en 3,5px, `h-10` mide 35px y ya no cumple el piso de 40px
  (con la unidad en 4px de la v1 medía 40px justos). Alturas de controles **por
  token** (`min-h-tactil`, `size-tactil`, `objetivo-tactil`), nunca literales.

La raíz (`html { font-size: 112.5% }`) **es la misma en los dos modos**: la
escala compacta se define token por token, no bajando la raíz. Así la promesa
de "todo crece si agrandaste la tipografía del sistema operativo" sigue en pie
también en compacta, y la reducción puede ser progresiva —cada escalón cede lo
que puede ceder— en vez de un zoom uniforme.

---

## 5-bis. El benchmark nativo y de dónde sale cada número de la v2

La v1 se construyó reduciendo la escala grande. La v2 se construyó al revés:
partiendo de lo que miden las apps nativas y buscando el escalón de nuestra
escala que cae ahí.

### Las dos referencias

| Métrica | Material 3 (Android) | iOS HIG | **Chica v2** |
|---|---|---|---|
| Cuerpo de texto | `body-medium` 14sp / 20sp | `body` 17pt; **15pt (`subhead`) en listas densas** | **14px / 19,6px** |
| Texto secundario | `body-small` 12sp | `footnote` 13pt, `caption1` 12pt | **12-13px** |
| Título de tarjeta | `title-medium` 16sp | `headline` 17pt | **16px** |
| Título de pantalla | `headline-small` 24sp / `title-large` 22sp | `title3` 20pt | **20px** |
| Ítem de lista | 56-72dp | fila de tabla 44pt | 40px (piso táctil) + contenido |
| Barra de navegación inferior | nav bar 80dp | tab bar 49pt | **64px** |
| Margen de pantalla | 16dp | 16pt | 14px (`p-4`) |
| Padding de tarjeta | 16dp; **12dp en denso** | 16pt | **12,25px** |
| Radio de tarjeta | `corner-medium` 12dp | ~10pt (tabla agrupada) | **10px** (`rounded-lg`), 14px (`rounded-xl`) |
| Botón estándar | 40dp | 44pt mínimo táctil | **40,5px** (44-45px el `lg`) |
| Ícono de navegación | 24dp | 25-30pt | **24,5px** (`size-7`) |
| Objetivo táctil mínimo | 48dp | 44pt | **40px** (el piso que fija el ROADMAP) |

Las unidades son intercambiables a efectos prácticos: 1dp de Android y 1pt de
iOS equivalen a 1px de CSS en el navegador del dispositivo (el Galaxy A71
reporta `innerWidth === 411`, que son sus 411dp).

### Las decisiones, y qué se resignó en cada una

1. **Cuerpo en 14px, no en 15 ni en 13.** 14 es `body-medium`, el caballo de
   batalla de cualquier interfaz Android densa. 15 (el `subhead` que iOS usa en
   listas apretadas) habría dejado la app a mitad de camino del pedido; 13 está
   por debajo del piso del ROADMAP y ya se lee como letra de contrato. Se
   resigna: quien tenga vista cansada y no toque el A/a arranca con menos letra
   que antes — de ahí que el conmutador sea permanente y que la elección se
   recuerde.
2. **Secundario en 12-13px.** `text-sm` (13px) es el `footnote` de iOS y es el
   que llevan las bajadas y las ayudas; `text-xs` (12px) es `body-small`/
   `caption` y es el piso, reservado a chips, badges y etiquetas de nav.
3. **Títulos aplanados.** El título de pantalla cede el 38% (32 → 20px) y el
   cuerpo solo el 22%. Es la diferencia entre una escala y un zoom: arriba
   sobra aire, abajo no. `text-xl` (16px) queda exactamente en `title-medium`.
4. **Unidad de espaciado en 3,5px.** Los escalones que la app usa de verdad
   caen en 7 / 10,5 / 14 / 17,5px: la grilla de 8/12/16 de Material corrida un
   12% hacia adentro, que es lo que un modo compacto debería ser. Se resigna
   que `h-10` deje de cumplir el piso táctil solo (ver arriba).
5. **Bottom nav en 64px.** Entre la tab bar de iOS (49pt, sin etiqueta grande)
   y la nav bar de Material (80dp): 64px entra el ícono de 24,5px más la
   etiqueta de 12px —que **nunca se saca**, regla Senior UX del ROADMAP— con
   10px de aire.
6. **El SOS no se toca.** Sigue en 58,5px. Con todo lo demás 20-38% más chico,
   mantenerlo lo vuelve todavía más dominante (1,44× el objetivo táctil).

### Lo que la retokenización PUEDE y NO PUEDE dar

Medido en el Galaxy A71 real (411px de ancho CSS), misma página y mismo DOM, la
v2 contra la v1 en modo compacto:

| Medición | Chica v1 | Chica v2 | Ratio |
|---|---|---|---|
| `/estilos` — alto total del documento | 8453px | 6816px | **1,24×** |
| `/estilos` — alto de las 7 tarjetas simples | 129-138px | 96-103px | **1,32-1,35×** |
| `/login` — alto de la tarjeta del formulario | 429px | 362px | **1,18×** |
| `/offline` — alto total del documento | 861px | 775px | **entra entera sin scroll** (el viewport mide 775px) |

**El techo de la retokenización está entre 1,25× y 1,35×, y es un techo
estructural, no una falta de agresividad.** La razón se ve en un botón: mide
40,5px, de los cuales 19,6px son la caja de línea de su etiqueta y el resto es
el piso táctil de 40px que el ROADMAP fija y que la v2 no mueve. Los controles
—botones, campos, ítems de nav, filas tocables— no se achican, y en una pantalla
como `/medicacion` son una fracción grande del alto.

El resto del camino hacia el objetivo del sprint es **reorganización**, no
tokens: pasar tarjetas a filas, grillas a 2-3 columnas, bloques de 3 líneas a 1.
Eso es exactamente lo que el ROADMAP le asigna a las tandas de la tarea 14.2, y
esta retokenización es el piso sobre el que esas tandas trabajan.

### Lo que sí hay que escribir: la variante `chica:`

Para lo que un token no puede expresar: **estructura**.

```tsx
// Una columna en grande, dos en compacto.
<div className="grid grid-cols-1 gap-4 chica:grid-cols-2">

// Apilado en grande, en línea en compacto.
<div className="flex flex-col chica:flex-row chica:items-center">

// Un resumen de tres líneas que en compacto se recorta a dos.
<p className="line-clamp-3 chica:line-clamp-2">
```

Se compila a `&:is([data-tamano="chica"], [data-tamano="chica"] *)`, el mismo
molde que `dark:`. Se combina con los demás modificadores en cualquier orden:
`chica:sm:grid-cols-3`, `dark:chica:border-borde-sutil`.

### No existe `grande:`, y es a propósito

El modo grande es el que no se toca. Una utilidad `grande:algo` sería, por
definición, un cambio en el modo grande. Todo lo que se querría escribir con
ella se expresa como **base + `chica:` que la corrige**:

```tsx
// NO:  grande:grid-cols-1 chica:grid-cols-2
// SÍ:  grid-cols-1 chica:grid-cols-2
```

Si alguna vez hiciera falta de verdad, se agrega el `@custom-variant` y se
documenta acá el caso concreto que lo justificó. Hasta entonces, su ausencia es
la barandilla.

### Cómo probar las dos

1. `npm run dev`, entrar con una cuenta y tocar el botón **A/a** del encabezado.
   Cambia al instante, sin recargar.
2. Recargar (F5): el tamaño tiene que quedarse. Si parpadea, el atributo no está
   llegando en el HTML — revisar que el layout raíz siga siendo `async`.
3. Comparar contra la captura del modo grande de la pantalla que estás tocando
   (`docs/capturas/dispositivo-real/`). Cualquier diferencia en grande es un bug.
4. `node scripts/verificar-contraste.mjs` antes de cerrar.

Para forzar un modo sin tocar la base durante el desarrollo, alcanza con cambiar
el atributo en el inspector: `document.documentElement.dataset.tamano = "chica"`.
No persiste, pero sirve para iterar CSS.

---

## 6. La trampa de especificidad (leer antes de tocar un color)

`.dark` y `data-tamano` viven en el **mismo elemento**, el `<html>`. Eso deja
esta escalera de especificidad:

```
:root                              0-1-0
.dark                              0-1-0   (mismo peso que :root, gana por orden)
html[data-tamano="chica"]          0-1-1   ← le gana a .dark
html.dark[data-tamano="chica"]     0-2-1
```

Consecuencia: **un color que se redefina solo en el bloque compacto claro se
aplica también en oscuro, con el valor claro.** El tema oscuro se rompería en
silencio.

Por eso la regla 4 de la §4 y por eso `scripts/verificar-contraste.mjs` falla si
algún token de color del bloque `html[data-tamano="chica"]` no tiene su gemelo
en `html.dark[data-tamano="chica"]`.

El mismo mecanismo obligó a repetir el override en `@media (prefers-contrast:
more)`: las media queries no suman especificidad, así que sin re-declararlo ahí,
pedir "más contraste" en el sistema operativo **y** usar el modo compacto daría
menos contraste que pedirlo en el modo grande.

### Compensación de contraste del modo compacto

WCAG mide contraste sin mirar el tamaño (salvo por el corte de "texto grande"),
pero la percepción sí: los mismos trazos, más finos y más juntos, se leen peor.
Dos tokens se endurecen en compacta:

| Token | Por qué | Claro | Oscuro |
|---|---|---|---|
| `--muted-foreground` | El texto secundario pasa de 17px (grande) a 13px (v2) | 6,40:1 → **7,87:1** | 8,34:1 → **9,91:1** |
| `--borde-sutil` | La hairline separa filas más juntas | 1,41:1 → 1,56:1 | 1,51:1 → 1,82:1 |

(Ratios medidos contra `--background`. `--borde-sutil` es decorativo: no
delimita controles y no tiene mínimo AA.)

El Sprint 14 endureció los dos un escalón más que la v1 —el secundario pasó de
15px a 13px, así que el argumento perceptual que justificaba la compensación
vale más, no menos—. Ninguno de los cuatro valores es un color nuevo: mismo tono
y mismo croma, con la luminosidad corrida hacia el contraste.

---

## 7. Contraste dual: qué cambió en el verificador

`node scripts/verificar-contraste.mjs` mide **4 combinaciones** (claro × oscuro
× grande × chica) = **196 pares obligatorios**, más cinco invariantes
estructurales del modo compacto: paridad claro/oscuro de los colores compactos,
piso táctil de 40px, piso de 16px de los CAMPOS de formulario (§4 regla 3) y los
dos pisos de legibilidad del Sprint 14 (cuerpo ≥ 14px, secundario ≥ 12px).

El cambio de fondo: los pares de **texto** ya no declaran un umbral fijo sino
**el escalón de la escala en el que se usan** (el más chico, que es el que
manda). El script lee los tamaños reales del CSS y deriva el umbral por
densidad, porque el corte de WCAG entre "texto grande" (3:1) y "texto normal"
(4,5:1) está en 18pt = 24px —o 14pt = 18,66px en negrita— y `text-xl` mide 24px
en grande y 20px en compacta. Los pares que no son texto declaran `GRAFICO`:
WCAG 1.4.11 les pide 3:1 sin mirar el tamaño.

**Resultado desde el Sprint 14: hay UN par que cambia de umbral, y es el motivo
por el que este check existe.**

| Par | Grande | Chica v2 | Ratio medido |
|---|---|---|---|
| `sos-foreground` / `sos` (etiqueta del botón SOS, `text-xl font-bold`) | 24px negrita ⇒ **3:1** | 16px negrita ⇒ **4,5:1** | 5,77:1 claro · 4,94:1 oscuro |

El corte de WCAG para "texto grande" en negrita está en 14pt = 18,66px:
`text-xl` medía 24px en grande y 20px en la chica v1 (los dos por encima), y en
la v2 mide 16px (por debajo). El par pasa a exigir 4,5:1 y **cumple sin tocar un
solo color**, con 0,44 puntos de margen en el caso más ajustado (oscuro). El
script lo lista por nombre al final de cada corrida.

Hasta el Sprint 13 esto era una hipótesis ("ningún par depende del tamaño");
ahora es un caso real. Con un umbral fijo por par —el diseño anterior al Sprint
13— la retokenización lo habría aflojado en silencio.

Al agregar un par nuevo al array `GRUPOS`: si es texto, `texto("escalón")` con
el escalón **más chico** en que aparece, y `{ negrita: true }` solo si es
`font-bold` (700) — `font-semibold` (600) no cuenta, es la lectura conservadora
deliberada.

---

## 8. Permisos: quién puede cambiar el modo

**Solo el titular de la cuenta**, ni siquiera quien administra su perfil.

La política `profiles_update_administrador` autoriza el `UPDATE` de `profiles`
al titular **o a cualquier `can_manage`**, y para el resto de las columnas eso
es lo correcto y buscado (María corrige la ficha SOS de Roberto). Para esta
columna es incorrecto: es una preferencia de espectador, no un dato del
paciente.

Ni un privilegio de columna (mira columnas, no filas) ni una política RLS (no
puede comparar `new` contra `old`) pueden expresar esa regla. La impone el
trigger `profiles_proteger_densidad`, que **rechaza con 42501** —no conserva en
silencio— porque ninguna pantalla legítima manda `display_density` en el
`UPDATE` de un perfil ajeno: un intento es un bug o un abuso, y conviene que
haga ruido. Un `UPDATE` de terceros que no toque la columna sigue funcionando
igual que antes.

Un perfil **gestionado** (`user_id is null`) no tiene cuenta, nunca mira nada y
su preferencia no significa nada: el CHECK `profiles_densidad_solo_con_cuenta`
la clava en el default, incluso para `service_role`.

> ⚠️ **El literal del CHECK y el DEFAULT de la columna se mueven juntos.** El
> CHECK no dice "los gestionados son grandes", dice "los gestionados se quedan
> en el default": si los dos se desalinearan, `/familia` no podría crear un
> perfil gestionado, porque su INSERT no nombra la columna y tomaría del default
> un valor que el CHECK rechaza. El Sprint 14 los movió juntos (migración
> `20260817150000_default_chica.sql` §1 y §4) y el seed escribe el valor de
> Roberto a mano para que un desalineado futuro se caiga en el `db reset` en vez
> de quedar en silencio.
>
> Esto es también por qué **Roberto no puede estar en `grande`** aunque sea la
> persona mayor del guion: no tiene cuenta. En el seed, el papel de "quien
> prefiere el modo grande" lo cumple la cuenta de Diego, que sí puede tener
> preferencia — y así las dos cuentas del seed miran el MISMO perfil (el de
> Roberto) con densidades distintas, que es la §1 de este documento hecha
> fixture.

**Lo que sí es visible:** `profiles_select_visible` devuelve la fila entera, así
que un autorizado sobre María puede leer que María usa letra chica. Se acepta a
propósito: no es un dato de salud ni un identificador, y esconder una sola
columna exigiría romper el `select *` con el que todo el proyecto consulta
`profiles`.

Los casos están en `scripts/test-rls.sql` **BLOQUE 17** (14 casos): el titular
cambia la suya, el administrador ajeno no puede, la edición legítima de terceros
sigue intacta, un perfil sin cuenta no admite preferencia, toda fila que no
eligió arranca en el default nuevo, la elección explícita del seed sobrevive, y
las tres piezas (enum, CHECK, trigger) existen de verdad.

Todos los casos que antes escribían `'chica'` ahora escriben `'grande'` y
viceversa, y no es cosmético: desde que `chica` es el default, un caso que
escriba `'chica'` no distingue "se escribió" de "estaba así", y el trigger
—que compara con `is distinct from`— ni siquiera se despertaría.

---

## 9. Deuda y decisiones postergadas

- **Solo dos modos.** No hay "extra grande". Si aparece, es una migración
  (`alter type … add value`) y el `Record<Tamano, …>` de `lib/densidad/tamano.ts`
  deja en rojo cada lugar que haya que completar.
- **Sin heurística.** El modo no se deduce de la edad, del `role` ni del
  user-agent. Lo elige la persona, siempre.
- **No hay forma de distinguir "elegido" de "heredado"** (Sprint 14). El backfill
  del default pudo pisar todas las filas en `grande` porque, hasta ese momento,
  ninguna lo había elegido: era el valor que heredaron del `ALTER TABLE`. Desde
  ese deploy deja de ser cierto, y por lo tanto **ninguna migración futura puede
  volver a hacer lo mismo**. Si algún día hiciera falta mover el default otra
  vez, primero hay que agregar una columna (`density_chosen_at`, o un tercer
  valor `sin_elegir`) que separe las dos cosas. Hoy no existe, y hoy no hace
  falta.
- **El orden de las opciones del selector ya no es "el default primero"**
  (`TAMANOS`). Invertirlo movería de lugar los dos botones de
  `components/perfiles/pregunta-tamano.tsx` **también en el modo grande**, y eso
  viola la regla 1 de la §4. Queda de más accesible a más denso.
- **Sin sincronización en vivo entre dispositivos** (§3). Deliberado.
- **Las sombras y el tracking no cambian** entre modos. Podrían: una sombra
  ajustada a una tarjeta más chica se vería mejor. Se dejó afuera para no ampliar
  la superficie de la tarea de fundaciones; el token está disponible para las
  tandas si alguna lo justifica en una pantalla concreta.
