#!/usr/bin/env node
/**
 * Verificador del sistema de diseño: contraste WCAG 2.1 AA en las CUATRO
 * combinaciones de tema × densidad, más las invariantes estructurales del modo
 * compacto.
 *
 *   node scripts/verificar-contraste.mjs
 *
 * Lee los tokens directamente de `app/globals.css` —es la única fuente de
 * verdad, así que el script no se puede desincronizar— y sale con código 1 si
 * algo no cumple.
 *
 * ── QUÉ CAMBIÓ EN EL SPRINT 13 Y POR QUÉ
 *
 * Hasta el Sprint 12 cada par declaraba su umbral a mano: `NORMAL` (4,5:1) o
 * `GRANDE` (3:1). Eso funcionaba mientras existía UNA sola escala tipográfica.
 * Con el modo de letra chica (`app/globals.css` §5) la misma clase mide
 * distinto según la densidad —`text-xl` es 24px en grande y 20px en compacta—,
 * y el corte de WCAG entre "texto grande" y "texto normal" está justo ahí: a
 * 18pt (24px), o a 14pt (18,66px) si es negrita. Un par que se apoyaba en el
 * 3:1 de texto grande puede cruzar al 4,5:1 de texto normal con solo cambiar
 * de modo.
 *
 * Por eso los pares de TEXTO ya no declaran un umbral sino **el escalón de la
 * escala en el que se usan** (el más chico, que es el que manda), y el script
 * calcula el umbral por densidad leyendo los tamaños reales del CSS. Los pares
 * que no son texto declaran `GRAFICO`: WCAG 1.4.11 les pide 3:1 y no le
 * importa el tamaño, así que no dependen de la densidad.
 *
 * ── LA TRAMPA DE ESPECIFICIDAD QUE ESTE SCRIPT VIGILA
 *
 * `html[data-tamano="chica"]` (0-1-1) le gana a `.dark` (0-1-0), porque los dos
 * atributos viven en el mismo `<html>`. Consecuencia: un token de COLOR que se
 * redefina solo en el bloque compacto claro se aplicaría también en oscuro, con
 * el valor claro, y el tema oscuro se rompería en silencio. La sección de
 * invariantes exige que todo color del bloque compacto claro tenga su gemelo en
 * `html.dark[data-tamano="chica"]`.
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
   Lectura de bloques de app/globals.css
   ------------------------------------------------------------------------- */

/**
 * Devuelve el cuerpo del primer bloque de NIVEL SUPERIOR cuyo selector
 * coincide. El ancla de columna 0 es lo que deja afuera los bloques anidados
 * dentro de `@media` (que van indentados), y por eso el override de
 * `prefers-contrast: more` no contamina la medición del caso general.
 *
 * @param {string} selector Regex ya escapada del selector, sin llave.
 * @param {{obligatorio?: boolean}} opciones
 * @returns {string|null}
 */
function cuerpoDeBloque(css, selector, { obligatorio = true } = {}) {
  const inicio = css.search(new RegExp(`^${selector} \\{$`, "m"));
  if (inicio === -1) {
    if (obligatorio) throw new Error(`No se encontró el bloque "${selector}" en ${CSS}`);
    return null;
  }
  const fin = css.indexOf("\n}", inicio);
  return css.slice(inicio, fin);
}

/** Colores OKLCH declarados en un bloque. @returns {Map<string, object>} */
function leerColores(cuerpo) {
  const tokens = new Map();
  if (cuerpo === null) return tokens;

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

/** Tamaños `--text-*` en rem declarados en un bloque. @returns {Map<string, number>} */
function leerTamanos(cuerpo) {
  const tamanos = new Map();
  if (cuerpo === null) return tamanos;

  const re = /--text-([a-z0-9]+):\s*([\d.]+)rem/gi;
  let m;
  while ((m = re.exec(cuerpo)) !== null) {
    tamanos.set(m[1], Number(m[2]));
  }
  return tamanos;
}

/**
 * Píxeles de la raíz. `html { font-size: 112.5% }` sobre los 16px por defecto
 * del navegador da los 18px del sistema. Se lee en vez de asumirse: si alguien
 * mueve la raíz, los umbrales de "texto grande" se recalculan solos.
 */
function leerRaizPx(css) {
  const m = css.match(/font-size:\s*([\d.]+)%/);
  if (!m) throw new Error(`No se encontró el font-size de la raíz en ${CSS}`);
  return (16 * Number(m[1])) / 100;
}

/* -------------------------------------------------------------------------
   Umbrales
   ------------------------------------------------------------------------- */

/**
 * WCAG 2.1 define "texto grande" en PUNTOS: 18pt, o 14pt en negrita. A 96dpi
 * (la referencia de CSS) eso es 24px y 18,66px. Por encima del corte alcanza
 * con 3:1; por debajo hacen falta 4,5:1.
 *
 * `font-semibold` (600) NO cuenta como negrita para este corte: WCAG habla de
 * "bold", y el peso que engrosa el trazo lo suficiente es el 700. Es una
 * lectura conservadora y deliberada — equivocarse para el lado exigente en un
 * umbral de accesibilidad no cuesta nada.
 */
const PX_GRANDE_NORMAL = 24;
const PX_GRANDE_NEGRITA = 18.66;

/**
 * Par de TEXTO: declara el escalón de la escala en el que se usa. Cuando un
 * mismo par aparece en varios tamaños se declara **el más chico**, que es el
 * que impone el umbral más exigente.
 */
const texto = (escalon, { negrita = false } = {}) => ({
  clase: "texto",
  escalon,
  negrita,
});

/**
 * Par que NO es texto: relleno de botón, borde de control, anillo de foco,
 * serie de un gráfico. WCAG 1.4.11 ("Contraste de contenido no textual") pide
 * 3:1 sin mirar el tamaño, así que estos pares valen igual en las dos
 * densidades.
 */
const GRAFICO = { clase: "grafico" };

/** Se mide y se informa, pero no obliga: separadores decorativos. */
const INFO = { clase: "info" };

/** Resuelve el umbral concreto de un par para una densidad dada. */
function umbralDe(spec, pxPorEscalon) {
  if (spec.clase === "info") {
    return { minimo: 0, etiqueta: "decorativo" };
  }
  if (spec.clase === "grafico") {
    return { minimo: 3, etiqueta: "no textual" };
  }

  const px = pxPorEscalon.get(spec.escalon);
  if (px === undefined) {
    throw new Error(`El escalón "${spec.escalon}" no existe en la escala tipográfica`);
  }

  const corte = spec.negrita ? PX_GRANDE_NEGRITA : PX_GRANDE_NORMAL;
  const esGrande = px >= corte;
  const px1 = px.toFixed(px % 1 === 0 ? 0 : 1);

  return {
    minimo: esGrande ? 3 : 4.5,
    etiqueta: `${px1}px${spec.negrita ? " neg." : ""} ${esGrande ? "grande" : "normal"}`,
  };
}

/* -------------------------------------------------------------------------
   Pares a verificar (los que la app usa de verdad)
   ------------------------------------------------------------------------- */

/** @type {{grupo:string, pares:[string,string,object,string][]}[]} */
const GRUPOS = [
  {
    grupo: "Texto sobre superficies",
    pares: [
      ["foreground", "background", texto("xs"), "Texto primario sobre el fondo de página"],
      ["foreground", "card", texto("xs"), "Texto primario sobre tarjeta"],
      ["foreground", "popover", texto("xs"), "Texto primario sobre superficie elevada"],
      ["foreground", "muted", texto("xs"), "Texto primario sobre superficie hundida"],
      ["muted-foreground", "background", texto("xs"), "Texto secundario sobre el fondo"],
      ["muted-foreground", "card", texto("xs"), "Texto secundario sobre tarjeta"],
      ["muted-foreground", "muted", texto("xs"), "Texto secundario sobre superficie hundida"],
      ["sidebar-foreground", "sidebar", texto("xs"), "Texto de la barra lateral"],
    ],
  },
  {
    grupo: "Marca y acciones",
    pares: [
      ["primary-foreground", "primary", texto("sm"), "Etiqueta del botón primario"],
      ["primary", "background", texto("xs"), "Enlace / ícono de marca sobre el fondo"],
      ["primary", "card", texto("xs"), "Enlace / ícono de marca sobre tarjeta"],
      ["primary", "background", GRAFICO, "Relleno del botón primario contra el fondo"],
      ["secondary-foreground", "secondary", texto("sm"), "Etiqueta del botón secundario"],
      ["accent-foreground", "accent", texto("sm"), "Texto sobre el acento cálido"],
      ["sidebar-primary-foreground", "sidebar-primary", texto("sm"), "Acción activa en la barra lateral"],
      ["sidebar-accent-foreground", "sidebar-accent", texto("sm"), "Ítem resaltado en la barra lateral"],
    ],
  },
  {
    grupo: "Estados semánticos",
    pares: [
      ["destructive", "background", texto("xs"), "Texto de error sobre el fondo"],
      ["destructive", "card", texto("xs"), "Texto de error sobre tarjeta"],
      ["destructive-foreground", "destructive", texto("sm"), "Etiqueta sobre destructivo sólido"],
      ["exito-fuerte", "exito-suave", texto("sm"), "Texto de alerta de éxito"],
      ["exito-foreground", "exito", texto("sm"), "Etiqueta sobre éxito sólido"],
      ["exito", "background", GRAFICO, "Ícono / borde de éxito sobre el fondo"],
      ["advertencia-fuerte", "advertencia-suave", texto("sm"), "Texto de alerta de advertencia"],
      ["advertencia-foreground", "advertencia", texto("sm"), "Etiqueta sobre advertencia sólida"],
      ["advertencia", "background", GRAFICO, "Ícono / borde de advertencia sobre el fondo"],
    ],
  },
  {
    grupo: "Botón SOS (Sprint 8)",
    pares: [
      // `components/inicio/boton-sos.tsx`: `text-xl font-bold`. En grande son
      // 24px y en compacta 20px; las dos veces por encima del corte de 14pt en
      // negrita, así que el par se mide contra 3:1 en los dos modos. Está a
      // 1,3px del corte en compacta: si una tanda le sacara la negrita o le
      // bajara el escalón, este par pasaría a exigir 4,5:1 y el script lo diría
      // acá mismo en vez de dejarlo pasar.
      ["sos-foreground", "sos", texto("xl", { negrita: true }), "Etiqueta SOS sobre el rojo señal"],
      ["sos", "background", GRAFICO, "Botón SOS contra el fondo de página"],
      ["sos", "card", GRAFICO, "Botón SOS contra una tarjeta"],
      ["sos-borde", "background", GRAFICO, "Contorno del botón SOS contra la página"],
    ],
  },
  {
    grupo: "Bordes, foco y controles",
    pares: [
      ["border", "background", GRAFICO, "Borde de control sobre el fondo"],
      ["border", "card", GRAFICO, "Borde de control sobre tarjeta"],
      ["input", "background", GRAFICO, "Borde de campo sobre el fondo"],
      ["input", "card", GRAFICO, "Borde de campo sobre tarjeta"],
      ["ring", "background", GRAFICO, "Anillo de foco sobre el fondo"],
      ["ring", "card", GRAFICO, "Anillo de foco sobre tarjeta"],
      ["borde-sutil", "card", INFO, "Hairline interna (no delimita controles)"],
    ],
  },
  {
    grupo: "Avatares de perfil",
    pares: [
      // Las iniciales van en `text-sm` en el encabezado del shell y en
      // `text-3xl` en las tarjetas del selector: manda el escalón más chico.
      ["avatar-foreground", "avatar-1", texto("sm"), "Iniciales sobre avatar 1 (salvia)"],
      ["avatar-foreground", "avatar-2", texto("sm"), "Iniciales sobre avatar 2 (petróleo)"],
      ["avatar-foreground", "avatar-3", texto("sm"), "Iniciales sobre avatar 3 (terracota)"],
      ["avatar-foreground", "avatar-4", texto("sm"), "Iniciales sobre avatar 4 (ciruela)"],
      ["avatar-foreground", "avatar-5", texto("sm"), "Iniciales sobre avatar 5 (oliva)"],
      ["avatar-foreground", "avatar-6", texto("sm"), "Iniciales sobre avatar 6 (índigo)"],
      ["avatar-foreground", "avatar-7", texto("sm"), "Iniciales sobre avatar 7 (ámbar)"],
      ["avatar-foreground", "avatar-8", texto("sm"), "Iniciales sobre avatar 8 (arcilla)"],
      ["avatar-1", "card", GRAFICO, "Círculo del avatar contra la tarjeta"],
    ],
  },
  {
    grupo: "Series de datos",
    pares: [
      ["chart-1", "background", GRAFICO, "Serie 1 sobre el fondo"],
      ["chart-2", "background", GRAFICO, "Serie 2 sobre el fondo"],
      ["chart-3", "background", GRAFICO, "Serie 3 sobre el fondo"],
      ["chart-4", "background", GRAFICO, "Serie 4 sobre el fondo"],
      ["chart-5", "background", GRAFICO, "Serie 5 sobre el fondo"],
    ],
  },
];

/* -------------------------------------------------------------------------
   Armado de las cuatro combinaciones
   ------------------------------------------------------------------------- */

// Los comentarios se descartan ANTES de parsear nada. No es prolijidad: el
// propio `app/globals.css` documenta en prosa alternativas descartadas y
// utilidades generadas, y ahí adentro aparecen literales como
// "`html { font-size: 100% }`" o "`font-size: var(--text-base)`" que un
// parser ingenuo lee como declaraciones reales. Pasó en la primera corrida de
// este script: la raíz salió 16px en vez de 18px porque el primer
// `font-size: …%` del archivo estaba dentro de un comentario.
const css = readFileSync(CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const raizPx = leerRaizPx(css);

const CUERPO = {
  claro: cuerpoDeBloque(css, ":root"),
  oscuro: cuerpoDeBloque(css, "\\.dark"),
  escalaGrande: cuerpoDeBloque(css, "@theme"),
  chica: cuerpoDeBloque(css, 'html\\[data-tamano="chica"\\]'),
  chicaOscuro: cuerpoDeBloque(css, 'html\\.dark\\[data-tamano="chica"\\]', {
    obligatorio: false,
  }),
};

const COLOR = {
  claro: leerColores(CUERPO.claro),
  oscuro: leerColores(CUERPO.oscuro),
  chica: leerColores(CUERPO.chica),
  chicaOscuro: leerColores(CUERPO.chicaOscuro),
};

/** Fusiona bloques en orden de especificidad creciente (el último gana). */
function fusionar(...mapas) {
  const salida = new Map();
  for (const mapa of mapas) {
    for (const [clave, valor] of mapa) salida.set(clave, valor);
  }
  return salida;
}

/** Escala tipográfica efectiva en px por escalón, para una densidad. */
function escalaEnPx(overrides) {
  const base = leerTamanos(CUERPO.escalaGrande);
  const efectiva = fusionar(base, overrides);
  return new Map([...efectiva].map(([k, rem]) => [k, rem * raizPx]));
}

const PX_GRANDE = escalaEnPx(new Map());
const PX_CHICA = escalaEnPx(leerTamanos(CUERPO.chica));

/**
 * Las cuatro combinaciones. El orden de fusión ES el orden de especificidad
 * real del CSS, no una convención de este script:
 *   `.dark` (0-1-0) < `html[data-tamano="chica"]` (0-1-1)
 *                   < `html.dark[data-tamano="chica"]` (0-2-1)
 */
const COMBINACIONES = [
  { nombre: "TEMA CLARO · LETRA GRANDE", tokens: COLOR.claro, px: PX_GRANDE },
  { nombre: "TEMA OSCURO · LETRA GRANDE", tokens: COLOR.oscuro, px: PX_GRANDE },
  {
    nombre: "TEMA CLARO · LETRA CHICA",
    tokens: fusionar(COLOR.claro, COLOR.chica),
    px: PX_CHICA,
  },
  {
    nombre: "TEMA OSCURO · LETRA CHICA",
    tokens: fusionar(COLOR.oscuro, COLOR.chica, COLOR.chicaOscuro),
    px: PX_CHICA,
  },
];

/* -------------------------------------------------------------------------
   Invariantes estructurales del modo compacto
   ------------------------------------------------------------------------- */

let fallas = 0;

console.log("=".repeat(112));
console.log("  INVARIANTES DEL MODO COMPACTO  (app/globals.css §5)");
console.log("=".repeat(112));

// 1. Paridad claro/oscuro de los colores compactos: la trampa de
//    especificidad explicada en el encabezado.
const sinGemeloOscuro = [...COLOR.chica.keys()].filter((t) => !COLOR.chicaOscuro.has(t));
if (sinGemeloOscuro.length > 0) {
  fallas++;
  console.log(
    `  FAIL  Paridad claro/oscuro: ${sinGemeloOscuro
      .map((t) => `--${t}`)
      .join(", ")} se redefine(n) en html[data-tamano="chica"] pero no en`,
  );
  console.log(
    '        html.dark[data-tamano="chica"]. Como 0-1-1 le gana a .dark (0-1-0), el tema oscuro compacto tomaría el valor CLARO.',
  );
} else {
  console.log(
    `  PASS  Paridad claro/oscuro: los ${COLOR.chica.size} colores redefinidos en compacta tienen su gemelo en el bloque oscuro.`,
  );
}

// 2. Piso táctil del modo compacto (ROADMAP Sprint 13: "targets >= 40px
//    compacta"). Se lee el piso absoluto del `max(px, rem)`, que es el que
//    manda cuando el navegador está en su tamaño de fuente por defecto.
const PISO_TACTIL_COMPACTO = 40;
const mTactil = (CUERPO.chica ?? "").match(/--spacing-tactil:\s*max\((\d+)px/);
if (!mTactil) {
  fallas++;
  console.log(
    '  FAIL  Piso táctil: no se encontró --spacing-tactil: max(<n>px, ...) en html[data-tamano="chica"].',
  );
} else if (Number(mTactil[1]) < PISO_TACTIL_COMPACTO) {
  fallas++;
  console.log(
    `  FAIL  Piso táctil: el modo compacto declara ${mTactil[1]}px y el mínimo del ROADMAP es ${PISO_TACTIL_COMPACTO}px.`,
  );
} else {
  console.log(
    `  PASS  Piso táctil: --spacing-tactil compacto = max(${mTactil[1]}px, …), >= ${PISO_TACTIL_COMPACTO}px del ROADMAP.`,
  );
}

// 3. Piso de 16px del cuerpo de texto: por debajo, iOS Safari hace zoom
//    automático al enfocar un campo, y los primitivos de components/ui usan
//    `text-base`.
const PISO_CUERPO_PX = 16;
const pxBaseChica = PX_CHICA.get("base");
if (pxBaseChica === undefined || pxBaseChica < PISO_CUERPO_PX - 0.01) {
  fallas++;
  console.log(
    `  FAIL  Cuerpo compacto: text-base mide ${pxBaseChica?.toFixed(1)}px y el piso es ${PISO_CUERPO_PX}px (auto-zoom de iOS en campos de formulario).`,
  );
} else {
  console.log(
    `  PASS  Cuerpo compacto: text-base = ${pxBaseChica.toFixed(1)}px, no dispara el auto-zoom de iOS.`,
  );
}

console.log(`  Raíz leída de app/globals.css: 1rem = ${raizPx}px.`);

/* -------------------------------------------------------------------------
   Medición de los pares
   ------------------------------------------------------------------------- */

let verificados = 0;
const fueraDeGama = new Set();
/** Pares cuyo umbral cambia entre densidades: el motivo de existir del check dual. */
const cambianDeUmbral = new Set();

const anchoPar = 46;
const anchoDesc = 44;

for (const { nombre, tokens, px } of COMBINACIONES) {
  console.log(`\n${"=".repeat(112)}`);
  console.log(`  ${nombre}  (${tokens.size} tokens OKLCH efectivos)`);
  console.log("=".repeat(112));

  for (const [nombreToken, color] of tokens) {
    if (color.fueraDeGama) fueraDeGama.add(`${nombre}: --${nombreToken} ${color.oklch}`);
  }

  for (const { grupo, pares } of GRUPOS) {
    console.log(`\n  ${grupo}`);
    console.log(
      `  ${"par (texto sobre fondo)".padEnd(anchoPar)}${"uso".padEnd(anchoDesc)}${"hex".padEnd(18)}${"ratio".padStart(8)}  estado`,
    );
    console.log(`  ${"-".repeat(anchoPar + anchoDesc + 18 + 8 + 9)}`);

    for (const [frente, fondo, spec, descripcion] of pares) {
      const cf = tokens.get(frente);
      const cb = tokens.get(fondo);
      if (!cf || !cb) {
        console.log(`  FALTA TOKEN: --${frente} o --${fondo}`);
        fallas++;
        continue;
      }

      const umbral = umbralDe(spec, px);
      const umbralGrande = umbralDe(spec, PX_GRANDE).minimo;
      const umbralChica = umbralDe(spec, PX_CHICA).minimo;
      if (umbralGrande !== umbralChica) {
        cambianDeUmbral.add(`${frente} / ${fondo} — ${descripcion}`);
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
        : `${pasa ? "PASS" : "FAIL"} AA (min ${umbral.minimo} · ${umbral.etiqueta})`;

      console.log(
        `  ${`${frente} / ${fondo}`.padEnd(anchoPar)}${descripcion.padEnd(anchoDesc)}${`${cf.hex} / ${cb.hex}`.padEnd(18)}${`${r.toFixed(2)}:1`.padStart(8)}  ${estado}`,
      );
    }
  }
}

/* -------------------------------------------------------------------------
   Resumen
   ------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(112)}`);
if (fueraDeGama.size > 0) {
  console.log("  AVISO: tokens fuera de la gama sRGB (el navegador los va a recortar):");
  for (const t of fueraDeGama) console.log(`    - ${t}`);
} else {
  console.log("  Gama sRGB: todos los tokens caen dentro de sRGB, sin recorte.");
}

if (cambianDeUmbral.size > 0) {
  console.log("\n  Pares cuyo umbral WCAG CAMBIA al pasar a letra chica (el motivo del check dual):");
  for (const p of cambianDeUmbral) console.log(`    - ${p}`);
} else {
  console.log(
    "\n  Ningún par cambia de umbral entre densidades: hoy el sistema no se apoya en el 3:1 de",
  );
  console.log(
    "  'texto grande' para NINGÚN par de texto — todos exigen 4,5:1 en los dos modos. Comprimir la",
  );
  console.log("  escala no puede romper contraste mientras eso siga siendo cierto, y esto lo comprueba.");
}

console.log(`\n  Combinaciones medidas: ${COMBINACIONES.length} (tema × densidad)`);
console.log(`  Pares obligatorios verificados: ${verificados}`);
console.log(`  Fallas: ${fallas}`);
console.log("=".repeat(112));

if (fallas > 0) {
  console.error(
    "\nRESULTADO: hay pares o invariantes que no cumplen. Ajustar los tokens en app/globals.css.\n",
  );
  process.exit(1);
}
console.log("\nRESULTADO: todo cumple WCAG 2.1 AA en las cuatro combinaciones de tema y densidad.\n");
