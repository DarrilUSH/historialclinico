# Densidad: el modo de letra chica

> Sprint 13, tarea 13.1. Este documento es **el contrato** que tienen que
> respetar las cinco tandas de rediseño vista por vista. Si vas a tocar una
> pantalla en modo compacto, lo que necesitas saber está en la §4 y la §5.

La app tiene dos modos de densidad visual:

| Modo | Qué es | Estado |
|---|---|---|
| `grande` | El diseño Senior UX de los Sprints 0 a 12: 18px de cuerpo, objetivos táctiles de 48px, aire generoso. | **Default. No cambia ni un píxel.** |
| `chica` | Compacto: 16px de cuerpo, objetivos de 40px, espaciado en grilla de 4px. | Opcional, para quien ve bien y lo pide. |

El escenario que resuelve, tal como lo fija el ROADMAP: **María (49, ve bien)
usa la app densa y Roberto (80) la usa grande, cada uno sin enterarse del modo
del otro.**

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
| Columna | `supabase/migrations/20260814120000_preferencia_tamano.sql` | `profiles.display_density`, enum `('grande','chica')`, default `grande` |
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
   ¿hay sesión? ──no──> grande                             (login, registro, offline, /)
        │sí
        ▼
   profiles.display_density where user_id = auth.uid()
        │
        ├─ hay valor ──> ese modo (+ se escribe la cookie si el contexto lo permite)
        └─ no hay    ──> grande
```

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

**3. `text-base` no baja de 16px.** iOS Safari hace zoom automático al enfocar
un campo cuya letra mida menos de 16px, y los primitivos de `components/ui/`
usan `text-base`. Es un piso duro, no una preferencia. Si hace falta apretar
más, se aprieta el espaciado.

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

| Token | Grande | Chica |
|---|---|---|
| `--text-xs` … `--text-6xl` | 16 / 17 / 18 / 21 / 24 / 28 / 32 / 39 / 48 / 58 px | 14 / 15 / 16 / 18 / 20 / 23 / 26 / 31 / 37 / 44 px |
| `--spacing` (unidad de toda la escala) | 0.25rem = 4,5px | 0.2222rem = 4px |
| `--spacing-tactil` | `max(48px, 2.75rem)` | `max(40px, 2.25rem)` |
| `--spacing-tactil-amplio` | `max(56px, 3.25rem)` | `max(48px, 2.75rem)` |
| `--spacing-sos-boton` | `max(64px, 3.75rem)` | `max(56px, 3.25rem)` |
| `--spacing-bottom-nav` | 4.75rem = 85,5px | 4rem = 72px |
| `--radius` | 0.75rem = 13,5px | 0.625rem = 11,25px |
| `--muted-foreground`, `--borde-sutil` | base | endurecidos (§6) |

La raíz (`html { font-size: 112.5% }`) **es la misma en los dos modos**: la
escala compacta se define token por token, no bajando la raíz. Así la promesa
de "todo crece si agrandaste la tipografía del sistema operativo" sigue en pie
también en compacta, y la reducción puede ser progresiva —los escalones chicos
ceden 12% y los grandes hasta 24%— en vez de un zoom uniforme que estropearía
el cuerpo de texto para achicar un titular.

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
| `--muted-foreground` | El texto secundario pasa de 17px a 15px | 6,40:1 → **7,39:1** | 8,34:1 → **9,41:1** |
| `--borde-sutil` | La hairline separa filas más juntas | 1,41:1 → 1,52:1 | 1,51:1 → 1,71:1 |

(`--borde-sutil` es decorativo: no delimita controles y no tiene mínimo AA.)

---

## 7. Contraste dual: qué cambió en el verificador

`node scripts/verificar-contraste.mjs` mide ahora **4 combinaciones** (claro ×
oscuro × grande × chica) = **196 pares obligatorios**, más tres invariantes
estructurales del modo compacto (paridad claro/oscuro, piso táctil de 40px, piso
de 16px del cuerpo).

El cambio de fondo: los pares de **texto** ya no declaran un umbral fijo sino
**el escalón de la escala en el que se usan** (el más chico, que es el que
manda). El script lee los tamaños reales del CSS y deriva el umbral por
densidad, porque el corte de WCAG entre "texto grande" (3:1) y "texto normal"
(4,5:1) está en 18pt = 24px —o 14pt = 18,66px en negrita— y `text-xl` mide 24px
en grande y 20px en compacta. Los pares que no son texto declaran `GRAFICO`:
WCAG 1.4.11 les pide 3:1 sin mirar el tamaño.

**Resultado actual: ningún par cambia de umbral entre densidades**, porque el
sistema no se apoya en el 3:1 de "texto grande" para ningún par de texto —todos
exigen 4,5:1 en los dos modos—. Eso no era sabido, era una suposición; ahora es
una afirmación que el script comprueba en cada corrida y que dejaría de valer en
el momento en que una tanda introdujera un par que sí dependa del tamaño.

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

**Lo que sí es visible:** `profiles_select_visible` devuelve la fila entera, así
que un autorizado sobre María puede leer que María usa letra chica. Se acepta a
propósito: no es un dato de salud ni un identificador, y esconder una sola
columna exigiría romper el `select *` con el que todo el proyecto consulta
`profiles`.

Los casos están en `scripts/test-rls.sql` **BLOQUE 17** (13 casos): el titular
cambia la suya, el administrador ajeno no puede, la edición legítima de terceros
sigue intacta, un perfil sin cuenta no admite preferencia, y las tres piezas
(enum, CHECK, trigger) existen de verdad.

---

## 9. Deuda y decisiones postergadas

- **Solo dos modos.** No hay "extra grande". Si aparece, es una migración
  (`alter type … add value`) y el `Record<Tamano, …>` de `lib/densidad/tamano.ts`
  deja en rojo cada lugar que haya que completar.
- **Sin heurística.** El modo no se deduce de la edad, del `role` ni del
  user-agent. Lo elige la persona, siempre.
- **Sin sincronización en vivo entre dispositivos** (§3). Deliberado.
- **Las sombras y el tracking no cambian** entre modos. Podrían: una sombra
  ajustada a una tarjeta más chica se vería mejor. Se dejó afuera para no ampliar
  la superficie de la tarea de fundaciones; el token está disponible para las
  tandas si alguna lo justifica en una pantalla concreta.
