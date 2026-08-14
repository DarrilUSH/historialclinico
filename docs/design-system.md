# Sistema de diseño: "Salvia y Ámbar"

Sprint 3. Este documento es la fuente de verdad del lenguaje visual de Historial
Médico. Los valores viven en `app/globals.css`; acá se explica **por qué** son
esos y **cómo usarlos**.

- Verificación de contraste: `node scripts/verificar-contraste.mjs`
- Última corrida: **98 pares obligatorios, 0 fallas, todo dentro de gama sRGB**

---

## 1. La identidad y su porqué

La app la usan dos personas a la vez: alguien de 70 u 80 años que quiere ver su
próximo turno o mostrarle un estudio al médico, y un hijo o hija que carga los
documentos desde el celular en la sala de espera. Ninguno de los dos está
navegando por gusto. Casi siempre hay una preocupación de salud atrás. Eso
descarta de entrada tres direcciones que hoy son el default: el azul corporativo
frío de home banking, el degradado violeta de producto de IA, y el beige y
bronce artesanal de marca premium. Ninguna transmite lo que hace falta acá, que
es **calma, confianza clínica y calidez humana**, en ese orden.

La paleta arranca de un **verde salvia profundo** (`#276D56`). El verde es el
color de la salud sin ser el verde quirófano ni el verde farmacia de cartel
luminoso: bajado de croma y llevado hacia el petróleo, deja de gritar y empieza
a sostener. Es el color de las acciones, de los enlaces y del estado activo, y
es el único color de marca de la app: no hay un segundo azul apareciendo en la
pantalla 7. Los neutros no son grises: son **papel de consultorio**, blancos con
un susurro de verde (hue 150, croma 0.006) que hacen que la superficie no se
sienta hospitalaria ni de formulario. Ningún fondo es blanco puro y ningún texto
es negro puro, porque los extremos matan la profundidad y cansan la vista en
lecturas largas.

El calor lo pone un **ámbar arena** (`#F7E3C2`) que funciona como superficie de
realce, nunca como botón. Es la diferencia entre una app que se siente clínica y
una que se siente cuidada: el ámbar aparece en los hovers de menú, en los
resaltados y en la selección de texto, y alcanza para que el verde no quede
solo. Por encima de todo eso hay una decisión que no es estética sino funcional:
el **rojo SOS** (`#C70A18`) está reservado al botón de emergencia del Sprint 8 y
es deliberadamente distinto del rojo destructivo de "borrar" (`#B32228`), más
saturado y más luminoso. Cuando alguien busca ese botón en una urgencia, no
puede dudar ni medio segundo entre dos rojos parecidos.

La tipografía cierra la idea. **Atkinson Hyperlegible Next** la diseñó el
Braille Institute para personas con baja visión: diferencia de forma inequívoca
`I` de `l` de `1`, `0` de `O`, `b` de `d`, abre las contraformas y engrosa los
remates. En una app donde un error de lectura puede ser una dosis mal
interpretada, esa es la decisión tipográfica correcta, y encima tiene carácter
propio: es humanista y cálida, no la enésima grotesca neutra. La base es 18px,
no 16px, y el interlineado de cuerpo es 1.6.

**Diales aplicados:** variación de diseño moderada (la app es una herramienta,
no un portfolio), movimiento bajo (público sensible al mareo y al deterioro
cognitivo), densidad visual baja (aire y respiración, una decisión por
pantalla).

---

## 2. Tabla completa de tokens

Todos los valores están en OKLCH; el hexadecimal es el sRGB equivalente que
termina en pantalla. Ningún token queda fuera de gama sRGB (el script lo
verifica en cada corrida).

### 2.1 Superficies y texto

| Token | Rol | Claro (OKLCH) | Claro | Oscuro (OKLCH) | Oscuro |
|---|---|---|---|---|---|
| `--background` | Fondo de página | `oklch(0.972 0.006 150)` | `#F3F7F4` | `oklch(0.198 0.014 168)` | `#0F1814` |
| `--card` | Superficie (tarjetas, listas) | `oklch(0.993 0.0025 150)` | `#FCFDFC` | `oklch(0.242 0.015 168)` | `#19221E` |
| `--popover` | Superficie elevada (diálogos, menús) | `oklch(0.999 0.001 150)` | `#FEFFFE` | `oklch(0.282 0.016 168)` | `#222C28` |
| `--muted` | Superficie hundida (wells, chips) | `oklch(0.94 0.009 150)` | `#E7EDE8` | `oklch(0.295 0.015 168)` | `#262F2B` |
| `--foreground` | Texto primario | `oklch(0.245 0.02 168)` | `#17241F` | `oklch(0.956 0.008 150)` | `#EDF2EE` |
| `--card-foreground` | Texto sobre tarjeta | `oklch(0.245 0.02 168)` | `#17241F` | `oklch(0.956 0.008 150)` | `#EDF2EE` |
| `--popover-foreground` | Texto sobre superficie elevada | `oklch(0.245 0.02 168)` | `#17241F` | `oklch(0.956 0.008 150)` | `#EDF2EE` |
| `--muted-foreground` | Texto secundario | `oklch(0.465 0.02 165)` | `#4F5D57` | `oklch(0.755 0.018 155)` | `#A7B3AB` |

### 2.2 Marca y acciones

| Token | Rol | Claro (OKLCH) | Claro | Oscuro (OKLCH) | Oscuro |
|---|---|---|---|---|---|
| `--primary` | Acción principal, enlace, activo | `oklch(0.485 0.08 168)` | `#276D56` | `oklch(0.81 0.095 168)` | `#80D5B5` |
| `--primary-foreground` | Etiqueta sobre primario | `oklch(0.988 0.004 150)` | `#F9FCFA` | `oklch(0.215 0.035 168)` | `#061F16` |
| `--secondary` | Acción de segundo orden | `oklch(0.928 0.016 155)` | `#DFEBE3` | `oklch(0.31 0.018 168)` | `#28332F` |
| `--secondary-foreground` | Etiqueta sobre secundario | `oklch(0.3 0.028 168)` | `#20322B` | `oklch(0.956 0.008 150)` | `#EDF2EE` |
| `--accent` | Realce cálido (hover, destacado) | `oklch(0.923 0.048 80)` | `#F7E3C2` | `oklch(0.335 0.042 72)` | `#44331E` |
| `--accent-foreground` | Texto sobre realce | `oklch(0.33 0.07 58)` | `#4F2B0A` | `oklch(0.92 0.062 82)` | `#FAE1B6` |

### 2.3 Estados semánticos

| Token | Rol | Claro (OKLCH) | Claro | Oscuro (OKLCH) | Oscuro |
|---|---|---|---|---|---|
| `--destructive` | Borrar, revocar | `oklch(0.5 0.18 25)` | `#B32228` | `oklch(0.69 0.175 25)` | `#F56762` |
| `--destructive-foreground` | Etiqueta sobre destructivo | `oklch(0.985 0.006 30)` | `#FEF9F8` | `oklch(0.19 0.05 25)` | `#260908` |
| `--exito` | Confirmación (ícono, borde) | `oklch(0.495 0.105 150)` | `#2D7240` | `oklch(0.76 0.125 150)` | `#73C786` |
| `--exito-foreground` | Etiqueta sobre éxito sólido | `oklch(0.99 0.005 150)` | `#F9FDFA` | `oklch(0.19 0.045 150)` | `#031908` |
| `--exito-suave` | Fondo de alerta de éxito | `oklch(0.935 0.048 150)` | `#D4F3D9` | `oklch(0.305 0.052 150)` | `#1A3621` |
| `--exito-fuerte` | Texto sobre `exito-suave` | `oklch(0.365 0.085 150)` | `#144A25` | `oklch(0.85 0.115 150)` | `#96E3A6` |
| `--advertencia` | Atención (ícono, borde) | `oklch(0.64 0.145 62)` | `#C97409` | `oklch(0.81 0.14 78)` | `#F2B54A` |
| `--advertencia-foreground` | Etiqueta sobre advertencia sólida | `oklch(0.24 0.055 60)` | `#321801` | `oklch(0.22 0.05 60)` | `#2B1401` |
| `--advertencia-suave` | Fondo de alerta de atención | `oklch(0.945 0.05 82)` | `#FEEAC8` | `oklch(0.32 0.055 70)` | `#452D10` |
| `--advertencia-fuerte` | Texto sobre `advertencia-suave` | `oklch(0.405 0.09 62)` | `#6B3C05` | `oklch(0.87 0.12 82)` | `#FCCD73` |

### 2.4 SOS (reservado al botón de emergencia del Sprint 8)

| Token | Rol | Claro (OKLCH) | Claro | Oscuro (OKLCH) | Oscuro |
|---|---|---|---|---|---|
| `--sos` | Relleno del botón de emergencia | `oklch(0.525 0.21 27)` | `#C70A18` | `oklch(0.56 0.2 27)` | `#D02C2A` |
| `--sos-foreground` | Etiqueta SOS | `oklch(0.985 0.006 30)` | `#FEF9F8` | `oklch(0.985 0.006 30)` | `#FEF9F8` |
| `--sos-borde` | Contorno contra la página | `oklch(0.43 0.17 27)` | `#970911` | `oklch(0.7 0.19 27)` | `#FF655A` |

**Regla dura:** `--sos` no se usa para nada más. Ni alertas, ni badges, ni
decoración. Para acciones peligrosas comunes existe `--destructive`.

### 2.5 Bordes, campos y foco

| Token | Rol | Claro (OKLCH) | Claro | Oscuro (OKLCH) | Oscuro |
|---|---|---|---|---|---|
| `--border` | Borde de control y de tarjeta | `oklch(0.64 0.018 158)` | `#849088` | `oklch(0.53 0.022 168)` | `#607069` |
| `--borde-sutil` | Hairline interna (separadores) | `oklch(0.878 0.012 155)` | `#D1D9D3` | `oklch(0.36 0.016 168)` | `#35403B` |
| `--input` | Borde de campo de formulario | `oklch(0.6 0.02 160)` | `#76847C` | `oklch(0.56 0.024 168)` | `#677972` |
| `--ring` | Anillo de foco | `oklch(0.47 0.095 168)` | `#016B50` | `oklch(0.76 0.09 168)` | `#75C4A6` |

`--border` es deliberadamente fuerte: en esta app el borde delimita un control y
tiene que cumplir 3:1. Cuando la línea solo separa contenido dentro de una misma
superficie (pie de tarjeta, divisor de lista) va `--borde-sutil`, que es
decorativo y no necesita ratio.

### 2.6 Avatares de perfil

Ocho tonos de la misma familia cromática, elegidos para ser distinguibles entre
sí de un vistazo sin salirse del registro sobrio. En tema oscuro suben de
luminosidad y el texto se invierte (`--avatar-foreground` cambia con el tema),
así el contraste se mantiene sin tocar código.

| Token | Nombre | Claro | Oscuro |
|---|---|---|---|
| `--avatar-foreground` | Iniciales | `#FAFDFA` | `#051811` |
| `--avatar-1` | Salvia | `#1D6A4B` | `#6FAE8F` |
| `--avatar-2` | Petróleo | `#0D6277` | `#69A9BE` |
| `--avatar-3` | Terracota | `#9B4424` | `#D28F71` |
| `--avatar-4` | Ciruela | `#713960` | `#BD88AB` |
| `--avatar-5` | Oliva | `#576429` | `#9EAC73` |
| `--avatar-6` | Índigo | `#3F487E` | `#8D98CB` |
| `--avatar-7` | Ámbar | `#845A0F` | `#CAA46A` |
| `--avatar-8` | Arcilla | `#843B3E` | `#CC8583` |

### 2.7 Series de datos

Para los gráficos de peso, presión y glucemia. Cinco series, todas ≥ 3:1 contra
el fondo en ambos temas.

| Token | Claro | Oscuro |
|---|---|---|
| `--chart-1` | `#276D56` | `#72CCAB` |
| `--chart-2` | `#1C6B91` | `#67B5E1` |
| `--chart-3` | `#A25F12` | `#F5AD5A` |
| `--chart-4` | `#9F422B` | `#EC8E76` |
| `--chart-5` | `#5A467D` | `#AE96DA` |

El color nunca es la única señal: toda serie lleva además etiqueta directa o
marcador de forma distinta.

---

## 3. Ratios de contraste medidos

Salida de `node scripts/verificar-contraste.mjs`. El script lee los tokens
directamente de `app/globals.css`, los convierte OKLCH → sRGB → luminancia
relativa WCAG y mide cada par. Los valores fueron cruzados contra
`getComputedStyle` en Chromium sobre el dev server y coinciden hasta el segundo
decimal.

Mínimos WCAG 2.1 AA: **4.5:1** texto normal, **3:1** texto grande (≥ 24px) y
objetos gráficos o bordes de control.

### 3.1 Tema claro

| Par (texto / fondo) | Uso | Ratio | Mín. | Estado |
|---|---|---|---|---|
| `foreground` / `background` | Texto primario sobre el fondo | 14.84:1 | 4.5 | PASS |
| `foreground` / `card` | Texto primario sobre tarjeta | 15.74:1 | 4.5 | PASS |
| `foreground` / `popover` | Texto primario sobre superficie elevada | 16.01:1 | 4.5 | PASS |
| `foreground` / `muted` | Texto primario sobre superficie hundida | 13.51:1 | 4.5 | PASS |
| `muted-foreground` / `background` | Texto secundario sobre el fondo | 6.40:1 | 4.5 | PASS |
| `muted-foreground` / `card` | Texto secundario sobre tarjeta | 6.78:1 | 4.5 | PASS |
| `muted-foreground` / `muted` | Texto secundario sobre superficie hundida | 5.82:1 | 4.5 | PASS |
| `sidebar-foreground` / `sidebar` | Texto de la barra lateral | 14.16:1 | 4.5 | PASS |
| `primary-foreground` / `primary` | Etiqueta del botón primario | 5.97:1 | 4.5 | PASS |
| `primary` / `background` | Enlace o ícono de marca sobre el fondo | 5.70:1 | 4.5 | PASS |
| `primary` / `card` | Enlace o ícono de marca sobre tarjeta | 6.04:1 | 4.5 | PASS |
| `primary` / `background` | Relleno del botón primario contra el fondo | 5.70:1 | 3 | PASS |
| `secondary-foreground` / `secondary` | Etiqueta del botón secundario | 11.03:1 | 4.5 | PASS |
| `accent-foreground` / `accent` | Texto sobre el acento cálido | 9.94:1 | 4.5 | PASS |
| `sidebar-primary-foreground` / `sidebar-primary` | Acción activa en la barra lateral | 5.97:1 | 4.5 | PASS |
| `sidebar-accent-foreground` / `sidebar-accent` | Ítem resaltado en la barra lateral | 9.94:1 | 4.5 | PASS |
| `destructive` / `background` | Texto de error sobre el fondo | 6.11:1 | 4.5 | PASS |
| `destructive` / `card` | Texto de error sobre tarjeta | 6.48:1 | 4.5 | PASS |
| `destructive-foreground` / `destructive` | Etiqueta sobre destructivo sólido | 6.33:1 | 4.5 | PASS |
| `exito-fuerte` / `exito-suave` | Texto de alerta de éxito | 8.66:1 | 4.5 | PASS |
| `exito-foreground` / `exito` | Etiqueta sobre éxito sólido | 5.69:1 | 4.5 | PASS |
| `exito` / `background` | Ícono o borde de éxito sobre el fondo | 5.41:1 | 3 | PASS |
| `advertencia-fuerte` / `advertencia-suave` | Texto de alerta de advertencia | 7.84:1 | 4.5 | PASS |
| `advertencia-foreground` / `advertencia` | Etiqueta sobre advertencia sólida | 4.73:1 | 4.5 | PASS |
| `advertencia` / `background` | Ícono o borde de advertencia sobre el fondo | 3.24:1 | 3 | PASS |
| `sos-foreground` / `sos` | Etiqueta SOS sobre el rojo señal | 5.77:1 | 4.5 | PASS |
| `sos` / `background` | Botón SOS contra el fondo de página | 5.57:1 | 3 | PASS |
| `sos` / `card` | Botón SOS contra una tarjeta | 5.91:1 | 3 | PASS |
| `sos-borde` / `background` | Contorno del botón SOS contra la página | 8.22:1 | 3 | PASS |
| `border` / `background` | Borde de control sobre el fondo | 3.07:1 | 3 | PASS |
| `border` / `card` | Borde de control sobre tarjeta | 3.26:1 | 3 | PASS |
| `input` / `background` | Borde de campo sobre el fondo | 3.62:1 | 3 | PASS |
| `input` / `card` | Borde de campo sobre tarjeta | 3.84:1 | 3 | PASS |
| `ring` / `background` | Anillo de foco sobre el fondo | 6.03:1 | 3 | PASS |
| `ring` / `card` | Anillo de foco sobre tarjeta | 6.40:1 | 3 | PASS |
| `avatar-foreground` / `avatar-1` | Iniciales sobre avatar salvia | 6.37:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-2` | Iniciales sobre avatar petróleo | 6.76:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-3` | Iniciales sobre avatar terracota | 6.31:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-4` | Iniciales sobre avatar ciruela | 8.34:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-5` | Iniciales sobre avatar oliva | 6.29:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-6` | Iniciales sobre avatar índigo | 8.40:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-7` | Iniciales sobre avatar ámbar | 5.94:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-8` | Iniciales sobre avatar arcilla | 7.66:1 | 4.5 | PASS |
| `avatar-1` / `card` | Círculo del avatar contra la tarjeta | 6.40:1 | 3 | PASS |
| `chart-1` / `background` | Serie 1 sobre el fondo | 5.70:1 | 3 | PASS |
| `chart-2` / `background` | Serie 2 sobre el fondo | 5.45:1 | 3 | PASS |
| `chart-3` / `background` | Serie 3 sobre el fondo | 4.64:1 | 3 | PASS |
| `chart-4` / `background` | Serie 4 sobre el fondo | 5.91:1 | 3 | PASS |
| `chart-5` / `background` | Serie 5 sobre el fondo | 7.45:1 | 3 | PASS |
| `borde-sutil` / `card` | Hairline interna | 1.41:1 | (decorativo) | informativo |

### 3.2 Tema oscuro

| Par (texto / fondo) | Uso | Ratio | Mín. | Estado |
|---|---|---|---|---|
| `foreground` / `background` | Texto primario sobre el fondo | 15.96:1 | 4.5 | PASS |
| `foreground` / `card` | Texto primario sobre tarjeta | 14.38:1 | 4.5 | PASS |
| `foreground` / `popover` | Texto primario sobre superficie elevada | 12.71:1 | 4.5 | PASS |
| `foreground` / `muted` | Texto primario sobre superficie hundida | 12.16:1 | 4.5 | PASS |
| `muted-foreground` / `background` | Texto secundario sobre el fondo | 8.34:1 | 4.5 | PASS |
| `muted-foreground` / `card` | Texto secundario sobre tarjeta | 7.51:1 | 4.5 | PASS |
| `muted-foreground` / `muted` | Texto secundario sobre superficie hundida | 6.35:1 | 4.5 | PASS |
| `sidebar-foreground` / `sidebar` | Texto de la barra lateral | 15.04:1 | 4.5 | PASS |
| `primary-foreground` / `primary` | Etiqueta del botón primario | 9.96:1 | 4.5 | PASS |
| `primary` / `background` | Enlace o ícono de marca sobre el fondo | 10.42:1 | 4.5 | PASS |
| `primary` / `card` | Enlace o ícono de marca sobre tarjeta | 9.39:1 | 4.5 | PASS |
| `primary` / `background` | Relleno del botón primario contra el fondo | 10.42:1 | 3 | PASS |
| `secondary-foreground` / `secondary` | Etiqueta del botón secundario | 11.55:1 | 4.5 | PASS |
| `accent-foreground` / `accent` | Texto sobre el acento cálido | 9.50:1 | 4.5 | PASS |
| `sidebar-primary-foreground` / `sidebar-primary` | Acción activa en la barra lateral | 9.96:1 | 4.5 | PASS |
| `sidebar-accent-foreground` / `sidebar-accent` | Ítem resaltado en la barra lateral | 9.50:1 | 4.5 | PASS |
| `destructive` / `background` | Texto de error sobre el fondo | 6.03:1 | 4.5 | PASS |
| `destructive` / `card` | Texto de error sobre tarjeta | 5.43:1 | 4.5 | PASS |
| `destructive-foreground` / `destructive` | Etiqueta sobre destructivo sólido | 6.22:1 | 4.5 | PASS |
| `exito-fuerte` / `exito-suave` | Texto de alerta de éxito | 8.68:1 | 4.5 | PASS |
| `exito-foreground` / `exito` | Etiqueta sobre éxito sólido | 8.93:1 | 4.5 | PASS |
| `exito` / `background` | Ícono o borde de éxito sobre el fondo | 8.82:1 | 3 | PASS |
| `advertencia-fuerte` / `advertencia-suave` | Texto de alerta de advertencia | 8.63:1 | 4.5 | PASS |
| `advertencia-foreground` / `advertencia` | Etiqueta sobre advertencia sólida | 9.54:1 | 4.5 | PASS |
| `advertencia` / `background` | Ícono o borde de advertencia sobre el fondo | 9.89:1 | 3 | PASS |
| `sos-foreground` / `sos` | Etiqueta SOS sobre el rojo señal | 4.94:1 | 4.5 | PASS |
| `sos` / `background` | Botón SOS contra el fondo de página | 3.51:1 | 3 | PASS |
| `sos` / `card` | Botón SOS contra una tarjeta | 3.16:1 | 3 | PASS |
| `sos-borde` / `background` | Contorno del botón SOS contra la página | 6.25:1 | 3 | PASS |
| `border` / `background` | Borde de control sobre el fondo | 3.46:1 | 3 | PASS |
| `border` / `card` | Borde de control sobre tarjeta | 3.12:1 | 3 | PASS |
| `input` / `background` | Borde de campo sobre el fondo | 3.92:1 | 3 | PASS |
| `input` / `card` | Borde de campo sobre tarjeta | 3.53:1 | 3 | PASS |
| `ring` / `background` | Anillo de foco sobre el fondo | 8.79:1 | 3 | PASS |
| `ring` / `card` | Anillo de foco sobre tarjeta | 7.92:1 | 3 | PASS |
| `avatar-foreground` / `avatar-1` | Iniciales sobre avatar salvia | 7.10:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-2` | Iniciales sobre avatar petróleo | 7.00:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-3` | Iniciales sobre avatar terracota | 6.91:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-4` | Iniciales sobre avatar ciruela | 6.35:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-5` | Iniciales sobre avatar oliva | 7.51:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-6` | Iniciales sobre avatar índigo | 6.54:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-7` | Iniciales sobre avatar ámbar | 7.88:1 | 4.5 | PASS |
| `avatar-foreground` / `avatar-8` | Iniciales sobre avatar arcilla | 6.33:1 | 4.5 | PASS |
| `avatar-1` / `card` | Círculo del avatar contra la tarjeta | 6.31:1 | 3 | PASS |
| `chart-1` / `background` | Serie 1 sobre el fondo | 9.42:1 | 3 | PASS |
| `chart-2` / `background` | Serie 2 sobre el fondo | 7.99:1 | 3 | PASS |
| `chart-3` / `background` | Serie 3 sobre el fondo | 9.48:1 | 3 | PASS |
| `chart-4` / `background` | Serie 4 sobre el fondo | 7.49:1 | 3 | PASS |
| `chart-5` / `background` | Serie 5 sobre el fondo | 7.04:1 | 3 | PASS |
| `borde-sutil` / `card` | Hairline interna | 1.51:1 | (decorativo) | informativo |

**Total: 98 pares obligatorios, 0 fallas.** Si un cambio de token rompe alguno,
el script sale con código 1.

---

## 4. Tipografía

**Familias.** `Atkinson Hyperlegible Next` (variable, 200 a 800) para todo el
texto y `Atkinson Hyperlegible Mono` para cifras clínicas. Se cargan con
`next/font` en `app/layout.tsx`, autoalojadas: no hay pedidos a Google en
runtime.

**Raíz.** `html { font-size: 112.5% }`. Con la configuración por defecto del
navegador eso es exactamente **18px**, y si la persona ya agrandó la tipografía
del sistema, toda la escala crece con ella. `1rem = 18px`. La raíz no cambia
entre modos de densidad: los 18px son comunes al modo grande y al compacto:
lo que varía es cuánto ocupa cada escalón `text-*` dentro de esa raíz.

La tabla siguiente es la escala del **modo grande**, el default de la app y el
que ve la enorme mayoría de las cuentas. Ninguno de sus valores cambia con el
modo de densidad.

| Utilidad | Tamaño | px | Interlineado | Uso |
|---|---|---|---|---|
| `text-xs` | 0.8889rem | 16px | 1.5 | Piso absoluto. Metadatos, insignias. Nada baja de acá |
| `text-sm` | 0.9444rem | 17px | 1.55 | Texto de apoyo, ayudas de campo |
| `text-base` | 1rem | **18px** | **1.6** | Cuerpo por defecto |
| `text-lg` | 1.1667rem | 21px | 1.55 | Bajada, texto destacado |
| `text-xl` | 1.3333rem | 24px | 1.4 | Título de tarjeta y de diálogo |
| `text-2xl` | 1.5556rem | 28px | 1.3 | Título de sección |
| `text-3xl` | 1.7778rem | 32px | 1.22 | Título de pantalla |
| `text-4xl` | 2.1667rem | 39px | 1.15 | Título grande |
| `text-5xl` | 2.6667rem | 48px | 1.1 | Cifra destacada, portada |
| `text-6xl` | 3.2222rem | 58px | 1.05 | Reservado (SOS, números de emergencia) |

La escala se comprime abajo a propósito: entre `text-xs` y `text-base` hay solo
2px de diferencia porque el sistema se niega a tener texto chico. Lo que en
otros proyectos sería "letra chica" acá sigue siendo legible.

### 4.1 Modo compacto ("letra chica", Sprint 13)

La cuenta puede activar un segundo modo, gobernado por el atributo
`data-tamano="chica"` en `<html>` (contrato completo en la sección 10). No es
un zoom sobre la escala de arriba: la reducción es progresiva y no uniforme,
más floja abajo -donde el límite es la legibilidad- y más fuerte arriba -donde
el límite es solo el aire de la pantalla-, así que ningún escalón pierde más
de lo que puede permitirse perder.

| Utilidad | Tamaño | px | Interlineado | Δ vs. grande |
|---|---|---|---|---|
| `text-xs` | 0.7778rem | 14px | 1.45 | -12% |
| `text-sm` | 0.8333rem | 15px | 1.45 | -12% |
| `text-base` | 0.8889rem | **16px** | **1.5** | -11% |
| `text-lg` | 1rem | 18px | 1.45 | -14% |
| `text-xl` | 1.1111rem | 20px | 1.35 | -17% |
| `text-2xl` | 1.2778rem | 23px | 1.25 | -18% |
| `text-3xl` | 1.4444rem | 26px | 1.2 | -19% |
| `text-4xl` | 1.7222rem | 31px | 1.12 | -21% |
| `text-5xl` | 2.0556rem | 37px | 1.08 | -23% |
| `text-6xl` | 2.4444rem | 44px | 1.05 | -24% |

`text-base` tiene un piso duro que no se cruza en ningún modo: 16px. Por
debajo de eso, iOS Safari hace zoom automático al enfocar un campo de
formulario, y los primitivos de `components/ui/` usan `text-base` en todos sus
campos. Si algún día hace falta apretar más el modo compacto, se aprieta
espaciado, no este escalón.

Vale la pena notar el patrón, porque no es casualidad: cada escalón chico cae,
aproximadamente, sobre el escalón anterior de la escala grande (`text-lg`
chica son 18px, lo mismo que `text-base` grande). Es lo que hace que la app se
lea como la misma app en los dos modos, y no como una versión distinta con
menos jerarquía.

**Tracking.** Los valores por defecto de Tailwind aprietan demasiado para
lectura senior. `tracking-tight` pasa de -0.025em a **-0.006em**, y el `body`
lleva un `letter-spacing: 0.005em` que abre apenas el texto de cuerpo.

**Cifras clínicas.** `time`, `output` y cualquier elemento con `data-numerico`
llevan `tabular-nums lining-nums` de fábrica. Para el resto está la utilidad
`numeros-clinicos`, que además fija `slashed-zero`. Toda columna de valores,
dosis o fechas la usa: sin cifras de ancho fijo, comparar dos análisis es
imposible.

---

## 5. Espaciado, objetivos táctiles, radios y sombras

**Unidad de espaciado.** Toda la escala de espaciado de Tailwind 4 (`p-4`,
`gap-3`, `size-10`, y también `--card-spacing` de las tarjetas de shadcn)
resuelve `calc(var(--spacing) * N)`. En el **modo grande** es el default de
Tailwind, sin redefinir: `0.25rem`, que con la raíz de 18px de esta app son
4,5px. Ese valor no cambia.

**Objetivo táctil.** WCAG 2.5.5 y las reglas Senior UX del proyecto piden 48px
en el modo grande. El token los garantiza y los deja crecer:

```css
--spacing-tactil: max(48px, 2.75rem);        /* 49.5px por defecto */
--spacing-tactil-amplio: max(56px, 3.25rem); /* 58.5px por defecto */
```

Utilidades generadas: `min-h-tactil`, `size-tactil`, `h-tactil-amplio`,
`size-tactil-amplio`, etc. Además hay `objetivo-tactil`, que fija alto y ancho
mínimos de una sola vez para controles que no pasan por los primitivos de
`components/ui/`.

Se usa `min-height` y no `height` a propósito: si alguien pasa `h-10` por
`className`, el mínimo táctil sigue mandando.

### 5.1 Modo compacto: espaciado, táctil y radios

Ninguno de los valores del modo grande de arriba cambia ni un píxel cuando la
cuenta activa el modo compacto (`data-tamano="chica"`, sección 10): lo que
sigue son los tokens que solo existen, redefinidos, dentro de ese modo.

`--spacing` baja de 0.25rem (4,5px) a `0.2222rem` (4px), -11%: la misma
proporción que la tipografía, para que la relación entre texto y aire no se
distorsione, y cae justo sobre la grilla de 4px. Como es la unidad de la que
cuelga toda la escala de Tailwind, este único cambio comprime paddings, gaps,
márgenes y tamaños de ícono de la app entera de una sola vez.

Los tres tokens táctiles y la bottom nav bajan con el mismo criterio, sin
perforar nunca el piso de 40px que fija el ROADMAP para el modo compacto:

| Token | Grande | Chica | Uso |
|---|---|---|---|
| `--spacing-tactil` | `max(48px, 2.75rem)` → 49,5px | `max(40px, 2.25rem)` → 40,5px | Piso de cualquier control interactivo |
| `--spacing-tactil-amplio` | `max(56px, 3.25rem)` → 58,5px | `max(48px, 2.75rem)` → 49,5px | Controles de mayor jerarquía |
| `--spacing-sos-boton` | `max(64px, 3.75rem)` → 67,5px | `max(56px, 3.25rem)` → 58,5px | Botón de emergencia (Sprint 8). Reservado a ese único uso |
| `--spacing-bottom-nav` | `4.75rem` → 85,5px | `4rem` → 72px | Alto de la bottom nav fija; el shell la reserva también como padding inferior del contenido |

La escalera queda desplazada un escalón, y es lo elegante del caso: el
objetivo "amplio" del modo compacto (49,5px) es, en la práctica, el objetivo
normal del modo grande. Nadie termina con un control más chico que el piso
compacto ni con uno que la mano no encuentre. El botón SOS, además, sigue
siendo por lejos el control más grande de la app en los dos modos: la
distancia relativa contra el objetivo táctil normal incluso crece en
compacta (1,44× contra 1,36× en grande), así que nunca se confunde con un
botón común.

**Radios.** `--radius: 0.75rem` (13.5px) en el modo grande, sin cambios. La
escala del preset deriva de ahí: `rounded-sm` 8.1px, `rounded-md` 10.8px,
`rounded-lg` 13.5px (botones y campos), `rounded-xl` 18.9px (tarjetas y
diálogos), `rounded-2xl` 24.3px (tarjetas de perfil). Generosos, nunca
pastilla completa salvo en insignias y avatares. En el modo compacto
`--radius` baja a `0.625rem` (11,25px); toda la escala derivada se recalcula
sola porque el bloque `@theme inline` de la sección 3 la define como
múltiplos de este token -una tarjeta más chica con un radio que no acompaña
se ve desproporcionada, la curva se come el contenido-.

**Sombras.** Dos niveles, teñidos al verde del fondo. Nada de negro puro ni de
glassmorphism. No cambian entre modos de densidad.

| Utilidad | Uso |
|---|---|
| `shadow-suave` | Tarjetas, listas, formularios en reposo |
| `shadow-elevada` | Diálogos, y estado hover de una tarjeta accionable |

---

## 6. Movimiento

El público incluye personas con vértigo, mareo o deterioro cognitivo. El
movimiento acá informa, nunca decora.

| Token | Valor | Uso |
|---|---|---|
| `--duracion-rapida` | 150ms | Hover, foco, cambio de color |
| `--duracion-media` | 220ms | Elevación de tarjeta, aparición de panel |
| `--duracion-lenta` | 250ms | Techo del sistema. Nada dura más |
| `--curva-salida` / `ease-salida` | `cubic-bezier(0.16, 1, 0.3, 1)` | Por defecto: arranca rápido, frena suave |
| `--curva-entrada` / `ease-entrada` | `cubic-bezier(0.32, 0.72, 0, 1)` | Elementos que entran a escena |

Reglas:

- Solo se animan `transform` y `opacity`. Nunca `width`, `height`, `top`, `left`.
- Nada de animaciones infinitas, parallax ni scroll hijack.
- `prefers-reduced-motion: reduce` apaga todo (bloque global en `globals.css`:
  animaciones y transiciones bajan a 0.01ms y `scroll-behavior` pasa a `auto`).
- `prefers-contrast: more` endurece bordes, campos y texto secundario en ambos
  temas.

---

## 7. Temas claro y oscuro

El tema lo gobierna la clase `.dark` en `<html>`, que escribe next-themes desde
`components/tema/proveedor-tema.tsx` con `attribute="class"` y
`defaultTheme="system"`. Una sola fuente de verdad: los tokens y las utilidades
`dark:` de los componentes cambian juntos, nunca por separado. El script
bloqueante de next-themes aplica la clase antes del primer pintado, así que no
hay parpadeo. Cuando se agregue el conmutador de tema en la interfaz, alcanza
con `useTheme()`.

El oscuro no es una inversión del claro:

- El fondo es un **verde noche desaturado** (`#0F1814`), no negro. Menos
  fatiga en lectura larga y coherencia con la marca.
- Las superficies suben en escalones reales (`#0F1814` → `#19221E` → `#222C28`),
  así la jerarquía de profundidad se lee igual que en claro.
- El primario **se aclara** (`#276D56` → `#80D5B5`) y el texto sobre él se
  oscurece: la marca sigue siendo la misma salvia y el botón sigue siendo lo que
  más resalta de la pantalla.
- Los bordes son deliberadamente visibles (3.1:1 contra tarjeta). Este es un
  tema de alto contraste, no un tema oscuro elegante.
- Los avatares invierten: fondo claro con iniciales oscuras.

---

## 8. Cómo usar los tokens en componentes nuevos

**Nunca escribir un color literal.** Nada de `bg-slate-100`, `text-gray-500`,
`#276D56` ni `bg-green-600`. Si hace falta un color que no existe como token, se
agrega el token a `app/globals.css` (claro y oscuro), se agrega el par al array
`GRUPOS` de `scripts/verificar-contraste.mjs` y se corre el script antes de
usarlo.

**Elegir el token por su rol, no por su aspecto:**

| Necesito | Uso |
|---|---|
| Fondo de página | `bg-background` |
| Tarjeta, fila de lista, formulario | `bg-card text-card-foreground` |
| Diálogo, menú, popover | `bg-popover text-popover-foreground` |
| Well, chip, área hundida | `bg-muted` |
| Acción principal | `bg-primary text-primary-foreground` |
| Enlace, ícono de marca | `text-primary` |
| Acción secundaria | `bg-secondary text-secondary-foreground` |
| Realce cálido, hover de ítem | `bg-accent text-accent-foreground` |
| Texto de apoyo | `text-muted-foreground` |
| Borrar, revocar | `variant="destructive"` o `text-destructive` |
| Alerta de éxito | `border-exito/40 bg-exito-suave text-exito-fuerte` |
| Alerta de atención | `border-advertencia/40 bg-advertencia-suave text-advertencia-fuerte` |
| Botón de emergencia (solo ese) | `bg-sos text-sos-foreground border-sos-borde` |
| Borde de control o tarjeta | `border-border` |
| Separador interno | `border-borde-sutil` |
| Cifra clínica | `numeros-clinicos` |
| Control fuera de `components/ui/` | `objetivo-tactil` |

**Reglas de composición:**

1. **Un solo acento.** El primario salvia es el color de acción de toda la app.
   No aparece un azul de CTA en una pantalla nueva.
2. **El color nunca es la única señal.** Todo estado lleva ícono y texto además
   de color. Un error rojo sin la palabra "error" no sirve.
3. **Etiqueta siempre visible.** El placeholder no es una etiqueta, nunca.
4. **Etiqueta arriba, ayuda debajo, error debajo del campo.** Nada de mensajes
   flotantes ni tooltips como único canal.
5. **Los tamaños vienen de los primitivos.** `components/ui/` ya trae 18px,
   altura táctil y foco visible. Si hace falta pasar una clase de tamaño, va
   como excepción documentada, no como costumbre.
6. **`text-xs` es el piso -de cada modo-.** 16px en el modo grande, 14px en el
   compacto (sección 10). Si algo "necesita" ser más chico que el piso del
   modo activo, el problema es la densidad de la pantalla, no el tamaño de la
   letra. Hay, además, un piso que ningún modo cruza: `text-base` nunca baja
   de 16px, porque iOS Safari hace zoom automático al enfocar un campo de
   formulario con letra menor a eso, y los primitivos de `components/ui/`
   usan `text-base` en todos sus campos.
7. **Foco visible siempre.** Existe una regla global de `:focus-visible` con
   contorno de 3px y offset de 2px para cualquier elemento que no pase por los
   primitivos. Nunca `outline: none` sin reemplazo.

---

## 9. Verificación

```bash
node scripts/verificar-contraste.mjs   # 196 pares AA en 4 combinaciones de tema × densidad, sale 1 si alguno falla
npx tsc --noEmit
npm run test
npm run build
```

Medido en el navegador sobre el dev server (Chromium, `getComputedStyle`):

- `documentElement.fontSize` = **18px**, `body.fontSize` = **18px**,
  `body.lineHeight` = **28.8px** (1.6).
- `body.fontFamily` = `"Atkinson Hyperlegible Next", ui-sans-serif, system-ui,
  sans-serif`.
- Botón primario de `/login`: fondo `#276D56`, etiqueta `#F9FCFA`, alto 54px,
  `min-height` 49.5px, radio 13.5px, transición 150ms con
  `cubic-bezier(0.16, 1, 0.3, 1)`.
- Campo de email: 18px, alto 54px, `min-height` 49.5px, borde `#76847C`.
- `/perfiles` en claro: h1 32px con 14.84:1, avatar 6.76:1, insignia de relación
  5.22:1 (compuesta sobre el fondo real, respetando el alfa).
- `/perfiles` en oscuro: h1 15.96:1, avatar 8.50:1, borde de tarjeta 3.12:1.

---

## 10. Densidad (modo de letra chica)

Sprint 13 agregó un segundo eje además del tema claro/oscuro: el modo de
densidad, con dos valores, grande (default) y chica (compacto). No es una
preferencia cosmética menor -es una segunda escala completa, con su propia
tipografía (sección 4.1), su propio espaciado y sus propios objetivos
táctiles y radios (sección 5.1)-, pensada para cuentas que prefieren ver más
contenido por pantalla a costa de algo de aire, sin resignar ninguna garantía
de accesibilidad que tiene el modo grande.

**Dónde vive.** El atributo `data-tamano` en `<html>` gobierna el modo, en el
mismo elemento donde next-themes pone la clase `.dark`: son dos ejes
independientes que conviven en el mismo lugar. Lo escribe el layout raíz
(`app/layout.tsx`) del lado del servidor, a partir de la preferencia de la
cuenta logueada (`lib/densidad/servidor.ts`), así que llega resuelto en el
HTML inicial y no hay parpadeo al cargar -el mismo motivo por el que
next-themes aplica `.dark` con un script bloqueante antes del primer
pintado-. Los tokens que cambian entre modos viven en `app/globals.css`,
sección 5 ("DENSIDAD COMPACTA").

**El variant `chica:`.** Para lo que un token global no alcanza a expresar
-cambiar una grilla de dos columnas a una, pasar de `flex-col` a `flex-row`,
recortar un texto con `line-clamp-2` que en el modo grande no hace falta
recortar- existe el custom variant `chica:`, definido como
`&:is([data-tamano="chica"], [data-tamano="chica"] *)`. El escalado de
tipografía y espaciado no lo necesita: sale solo, porque las utilidades de
Tailwind leen esos tokens en tiempo de uso.

**Por qué no existe `grande:`.** Es deliberado. El modo grande es el que no
se toca -es el default de la app y el que ve la enorme mayoría de las
cuentas-, así que una utilidad `grande:algo` sería, por definición, un cambio
en el modo grande, que es exactamente lo que este sistema existe para evitar.
Lo que haría falta expresar con ella siempre se puede escribir al revés: una
clase base pensada para el modo grande, corregida con `chica:` cuando el modo
compacto la necesita distinta.

**La regla dura.** Nunca se toca un solo píxel del modo grande al trabajar en
el modo compacto, y el piso táctil del modo compacto nunca baja de 40px. Todo
lo demás -qué vista se rediseña primero, cómo se prueba cada una, qué
invariantes estructurales verifica `node scripts/verificar-contraste.mjs`
además de los 196 pares de color en las cuatro combinaciones de tema y
densidad- está en `docs/densidad.md`, el contrato completo para el rediseño
vista por vista.
