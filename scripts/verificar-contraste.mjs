#!/usr/bin/env node
/**
 * Verificador de contraste WCAG 2.1 AA del sistema de diseño.
 *
 *   node scripts/verificar-contraste.mjs
 *
 * Lee los tokens OKLCH directamente de `app/globals.css` (bloques `:root` y
 * `.dark` de nivel superior), los convierte a sRGB, calcula la luminancia
 * relativa según WCAG y mide el ratio de cada par fondo/texto que la app usa
 * de verdad. Sale con código 1 si algún par obligatorio no llega al mínimo.
 *
 * Umbrales (WCAG 2.1 AA):
 *   - texto normal (< 24px, o < 18.66px en negrita): 4.5:1
 *   - texto grande (>= 24px) y objetos gráficos / bordes de control: 3:1
 *
 * Al ser la fuente de verdad el propio CSS, el script no se desincroniza:
 * cambiar un token y volver a correrlo alcanza para saber si sigue pasando.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = resolve(RAIZ, "app/globals.css");

/* -------------------------------------------------------------------------
   Conversión de color: OKLCH -> OKLab -> sRGB lineal -> sRGB -> luminancia
   ------------------------------------------------------------------------- */

/** @returns {{r:number,g:number,b:number,fueraDeGama:boolean}} canales 0..1 */
function oklchASrgb(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lineal = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  const fueraDeGama = lineal.some((c) => c < -0.0005 || c > 1.0005);
  const [r, g, bb] = lineal.map((c) => codificarGamma(Math.min(1, Math.max(0, c))));
  return { r, g, b: bb, fueraDeGama };
}

function codificarGamma(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function decodificarGamma(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG, calculada sobre el color realmente renderizado. */
function luminancia({ r, g, b }) {
  // Se cuantiza a 8 bits porque eso es lo que termina en pantalla.
  const canales = [r, g, b].map((c) => decodificarGamma(Math.round(c * 255) / 255));
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
}

function ratio(colorA, colorB) {
  const la = luminancia(colorA);
  const lb = luminancia(colorB);
  const [claro, oscuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

function aHex({ r, g, b }) {
  const h = (c) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}`;
}

/* -------------------------------------------------------------------------
   Lectura de tokens desde app/globals.css
   ------------------------------------------------------------------------- */

/**
 * Extrae los `--token: oklch(...)` del primer bloque de nivel superior cuyo
 * selector coincide (los bloques dentro de `@media` van indentados y por eso
 * no matchean el ancla de columna 0).
 */
function leerBloque(css, selector) {
  const inicio = css.search(new RegExp(`^${selector} \\{$`, "m"));
  if (inicio === -1) throw new Error(`No se encontró el bloque "${selector}" en ${CSS}`);
  const fin = css.indexOf("\n}", inicio);
  const cuerpo = css.slice(inicio, fin);

  const tokens = new Map();
  const re = /--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/gi;
  let m;
  while ((m = re.exec(cuerpo)) !== null) {
    const color = oklchASrgb(Number(m[2]), Number(m[3]), Number(m[4]));
    tokens.set(m[1], {
      ...color,
      oklch: `oklch(${m[2]} ${m[3]} ${m[4]})`,
      hex: aHex(color),
    });
  }
  return tokens;
}

/* -------------------------------------------------------------------------
   Pares a verificar (los que la app usa de verdad)
   ------------------------------------------------------------------------- */

const NORMAL = { minimo: 4.5, etiqueta: "texto normal" };
const GRANDE = { minimo: 3, etiqueta: "texto grande / componente" };
const INFO = { minimo: 0, etiqueta: "decorativo (informativo)" };

/** @type {{grupo:string, pares:[string,string,typeof NORMAL,string][]}[]} */
const GRUPOS = [
  {
    grupo: "Texto sobre superficies",
    pares: [
      ["foreground", "background", NORMAL, "Texto primario sobre el fondo de página"],
      ["foreground", "card", NORMAL, "Texto primario sobre tarjeta"],
      ["foreground", "popover", NORMAL, "Texto primario sobre superficie elevada"],
      ["foreground", "muted", NORMAL, "Texto primario sobre superficie hundida"],
      ["muted-foreground", "background", NORMAL, "Texto secundario sobre el fondo"],
      ["muted-foreground", "card", NORMAL, "Texto secundario sobre tarjeta"],
      ["muted-foreground", "muted", NORMAL, "Texto secundario sobre superficie hundida"],
      ["sidebar-foreground", "sidebar", NORMAL, "Texto de la barra lateral"],
    ],
  },
  {
    grupo: "Marca y acciones",
    pares: [
      ["primary-foreground", "primary", NORMAL, "Etiqueta del botón primario"],
      ["primary", "background", NORMAL, "Enlace / ícono de marca sobre el fondo"],
      ["primary", "card", NORMAL, "Enlace / ícono de marca sobre tarjeta"],
      ["primary", "background", GRANDE, "Relleno del botón primario contra el fondo"],
      ["secondary-foreground", "secondary", NORMAL, "Etiqueta del botón secundario"],
      ["accent-foreground", "accent", NORMAL, "Texto sobre el acento cálido"],
      ["sidebar-primary-foreground", "sidebar-primary", NORMAL, "Acción activa en la barra lateral"],
      ["sidebar-accent-foreground", "sidebar-accent", NORMAL, "Ítem resaltado en la barra lateral"],
    ],
  },
  {
    grupo: "Estados semánticos",
    pares: [
      ["destructive", "background", NORMAL, "Texto de error sobre el fondo"],
      ["destructive", "card", NORMAL, "Texto de error sobre tarjeta"],
      ["destructive-foreground", "destructive", NORMAL, "Etiqueta sobre destructivo sólido"],
      ["exito-fuerte", "exito-suave", NORMAL, "Texto de alerta de éxito"],
      ["exito-foreground", "exito", NORMAL, "Etiqueta sobre éxito sólido"],
      ["exito", "background", GRANDE, "Ícono / borde de éxito sobre el fondo"],
      ["advertencia-fuerte", "advertencia-suave", NORMAL, "Texto de alerta de advertencia"],
      ["advertencia-foreground", "advertencia", NORMAL, "Etiqueta sobre advertencia sólida"],
      ["advertencia", "background", GRANDE, "Ícono / borde de advertencia sobre el fondo"],
    ],
  },
  {
    grupo: "Botón SOS (Sprint 8)",
    pares: [
      ["sos-foreground", "sos", NORMAL, "Etiqueta SOS sobre el rojo señal"],
      ["sos", "background", GRANDE, "Botón SOS contra el fondo de página"],
      ["sos", "card", GRANDE, "Botón SOS contra una tarjeta"],
      ["sos-borde", "background", GRANDE, "Contorno del botón SOS contra la página"],
    ],
  },
  {
    grupo: "Bordes, foco y controles",
    pares: [
      ["border", "background", GRANDE, "Borde de control sobre el fondo"],
      ["border", "card", GRANDE, "Borde de control sobre tarjeta"],
      ["input", "background", GRANDE, "Borde de campo sobre el fondo"],
      ["input", "card", GRANDE, "Borde de campo sobre tarjeta"],
      ["ring", "background", GRANDE, "Anillo de foco sobre el fondo"],
      ["ring", "card", GRANDE, "Anillo de foco sobre tarjeta"],
      ["borde-sutil", "card", INFO, "Hairline interna (no delimita controles)"],
    ],
  },
  {
    grupo: "Avatares de perfil",
    pares: [
      ["avatar-foreground", "avatar-1", NORMAL, "Iniciales sobre avatar 1 (salvia)"],
      ["avatar-foreground", "avatar-2", NORMAL, "Iniciales sobre avatar 2 (petróleo)"],
      ["avatar-foreground", "avatar-3", NORMAL, "Iniciales sobre avatar 3 (terracota)"],
      ["avatar-foreground", "avatar-4", NORMAL, "Iniciales sobre avatar 4 (ciruela)"],
      ["avatar-foreground", "avatar-5", NORMAL, "Iniciales sobre avatar 5 (oliva)"],
      ["avatar-foreground", "avatar-6", NORMAL, "Iniciales sobre avatar 6 (índigo)"],
      ["avatar-foreground", "avatar-7", NORMAL, "Iniciales sobre avatar 7 (ámbar)"],
      ["avatar-foreground", "avatar-8", NORMAL, "Iniciales sobre avatar 8 (arcilla)"],
      ["avatar-1", "card", GRANDE, "Círculo del avatar contra la tarjeta"],
    ],
  },
  {
    grupo: "Series de datos",
    pares: [
      ["chart-1", "background", GRANDE, "Serie 1 sobre el fondo"],
      ["chart-2", "background", GRANDE, "Serie 2 sobre el fondo"],
      ["chart-3", "background", GRANDE, "Serie 3 sobre el fondo"],
      ["chart-4", "background", GRANDE, "Serie 4 sobre el fondo"],
      ["chart-5", "background", GRANDE, "Serie 5 sobre el fondo"],
    ],
  },
];

/* -------------------------------------------------------------------------
   Ejecución
   ------------------------------------------------------------------------- */

const css = readFileSync(CSS, "utf8");
const temas = [
  { nombre: "TEMA CLARO", tokens: leerBloque(css, ":root") },
  { nombre: "TEMA OSCURO", tokens: leerBloque(css, "\\.dark") },
];

let fallas = 0;
let verificados = 0;
const fueraDeGama = new Set();

const anchoPar = 46;
const anchoDesc = 44;

for (const { nombre, tokens } of temas) {
  console.log(`\n${"=".repeat(112)}`);
  console.log(`  ${nombre}  (${tokens.size} tokens OKLCH leídos de app/globals.css)`);
  console.log("=".repeat(112));

  for (const [nombreToken, color] of tokens) {
    if (color.fueraDeGama) fueraDeGama.add(`${nombre}: --${nombreToken} ${color.oklch}`);
  }

  for (const { grupo, pares } of GRUPOS) {
    console.log(`\n  ${grupo}`);
    console.log(
      `  ${"par (texto sobre fondo)".padEnd(anchoPar)}${"uso".padEnd(anchoDesc)}${"hex".padEnd(18)}${"ratio".padStart(8)}  estado`
    );
    console.log(`  ${"-".repeat(anchoPar + anchoDesc + 18 + 8 + 9)}`);

    for (const [frente, fondo, umbral, descripcion] of pares) {
      const cf = tokens.get(frente);
      const cb = tokens.get(fondo);
      if (!cf || !cb) {
        console.log(`  FALTA TOKEN: --${frente} o --${fondo}`);
        fallas++;
        continue;
      }
      const r = ratio(cf, cb);
      const informativo = umbral.minimo === 0;
      const pasa = r >= umbral.minimo;
      if (!informativo) {
        verificados++;
        if (!pasa) fallas++;
      }
      const estado = informativo
        ? `-- ${umbral.etiqueta}`
        : pasa
          ? `PASS AA (min ${umbral.minimo})`
          : `FAIL AA (min ${umbral.minimo})`;
      console.log(
        `  ${`${frente} / ${fondo}`.padEnd(anchoPar)}${descripcion.padEnd(anchoDesc)}${`${cf.hex} / ${cb.hex}`.padEnd(18)}${`${r.toFixed(2)}:1`.padStart(8)}  ${estado}`
      );
    }
  }
}

console.log(`\n${"=".repeat(112)}`);
if (fueraDeGama.size > 0) {
  console.log("  AVISO: tokens fuera de la gama sRGB (el navegador los va a recortar):");
  for (const t of fueraDeGama) console.log(`    - ${t}`);
} else {
  console.log("  Gama sRGB: todos los tokens caen dentro de sRGB, sin recorte.");
}
console.log(`  Pares obligatorios verificados: ${verificados}`);
console.log(`  Fallas: ${fallas}`);
console.log("=".repeat(112));

if (fallas > 0) {
  console.error("\nRESULTADO: hay pares que no llegan a WCAG AA. Ajustar los tokens en app/globals.css.\n");
  process.exit(1);
}
console.log("\nRESULTADO: todos los pares cumplen WCAG 2.1 AA.\n");
