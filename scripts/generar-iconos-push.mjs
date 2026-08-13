#!/usr/bin/env node
/**
 * Historial Médico — íconos de la notificación push (Sprint 6, tarea 6.3).
 *
 *     node scripts/generar-iconos-push.mjs
 *
 * Genera dos PNG en `public/`:
 *
 * - `icono-192.png`  — el ícono grande de la notificación (`icon` en
 *   `showNotification`). Cuadrado redondeado con el verde `--primary` del
 *   sistema de diseño y una cruz blanca centrada.
 * - `badge-96.png`   — el `badge`: la silueta chiquita que Android pinta en la
 *   barra de estado. **Tiene que ser monocroma con alfa**: el sistema la
 *   recolorea entera, así que cualquier color se pierde y un ícono con fondo
 *   opaco se ve como un cuadrado negro. Por eso es una cruz blanca sobre
 *   transparente y nada más.
 *
 * Por qué un generador y no dos binarios pegados en el repo: en una app de
 * datos médicos, un PNG que nadie puede auditar es una caja negra. Son 8 KB
 * de píxeles derivados de un token del sistema de diseño; el script deja
 * explícito de dónde salen y permite regenerarlos si el token cambia.
 *
 * **Provisorio**: la tarea de PWA instalable (Sprint 8/11, skill `init-pwa`)
 * define el set completo de íconos -192, 512, maskable, apple-touch- junto al
 * `manifest.webmanifest`. Cuando eso llegue, estos dos se reemplazan por los
 * del manifest y este script se borra.
 *
 * Sin dependencias: escribe el PNG a mano (IHDR/IDAT/IEND + CRC32) con `zlib`
 * del propio Node.
 */

import { deflateSync } from "node:zlib"
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// --- Color: el token --primary del tema claro (app/globals.css) -------------
// oklch(0.485 0.08 168). Se convierte acá en vez de hardcodear un hex para que
// el ícono y la interfaz no puedan divergir sin que alguien lo note.
function oklchASrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  const lineal = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]

  return lineal.map((c) => {
    const gamma = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(gamma * 255)))
  })
}

const [PR, PG, PB] = oklchASrgb(0.485, 0.08, 168)

// --- PNG mínimo (color type 6 = RGBA, 8 bits) -------------------------------
function crc32(buf) {
  let c
  const tabla = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = tabla[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4)
  largo.writeUInt32BE(datos.length, 0)
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo), 0)
  return Buffer.concat([largo, cuerpo, crc])
}

/** `pixel(x, y)` devuelve `[r, g, b, a]` con a en 0..255. */
function escribirPng(destino, lado, pixel) {
  const filas = []
  for (let y = 0; y < lado; y++) {
    const fila = Buffer.alloc(1 + lado * 4) // byte 0 = filtro "None"
    for (let x = 0; x < lado; x++) {
      const [r, g, b, a] = pixel(x, y)
      fila[1 + x * 4] = r
      fila[1 + x * 4 + 1] = g
      fila[1 + x * 4 + 2] = b
      fila[1 + x * 4 + 3] = a
    }
    filas.push(fila)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lado, 0)
  ihdr.writeUInt32BE(lado, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // filtro adaptativo
  ihdr[12] = 0 // sin entrelazado

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(filas), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])

  writeFileSync(destino, png)
  return png.length
}

// --- Geometría --------------------------------------------------------------
/** Cobertura 0..1 del píxel dentro de la cruz (supersampling 4x4 para bordes suaves). */
function coberturaCruz(x, y, lado) {
  const brazo = lado * 0.62 // largo total de la cruz
  const grosor = lado * 0.2
  const centro = lado / 2
  let dentro = 0
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4 - centro
      const py = y + (sy + 0.5) / 4 - centro
      const enVertical = Math.abs(px) <= grosor / 2 && Math.abs(py) <= brazo / 2
      const enHorizontal = Math.abs(py) <= grosor / 2 && Math.abs(px) <= brazo / 2
      if (enVertical || enHorizontal) dentro++
    }
  }
  return dentro / 16
}

/** Cobertura 0..1 del píxel dentro del cuadrado redondeado. */
function coberturaFondo(x, y, lado) {
  const r = lado * 0.22
  let dentro = 0
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4
      const py = y + (sy + 0.5) / 4
      const dx = Math.max(r - px, px - (lado - r), 0)
      const dy = Math.max(r - py, py - (lado - r), 0)
      if (Math.hypot(dx, dy) <= r) dentro++
    }
  }
  return dentro / 16
}

function mezclar(fondo, frente, alfa) {
  return Math.round(fondo * (1 - alfa) + frente * alfa)
}

// --- Salidas ----------------------------------------------------------------
const bytesIcono = escribirPng(path.join(RAIZ, "public/icono-192.png"), 192, (x, y) => {
  const fondo = coberturaFondo(x, y, 192)
  const cruz = coberturaCruz(x, y, 192)
  return [
    mezclar(PR, 255, cruz),
    mezclar(PG, 255, cruz),
    mezclar(PB, 255, cruz),
    Math.round(fondo * 255),
  ]
})

const bytesBadge = escribirPng(path.join(RAIZ, "public/badge-96.png"), 96, (x, y) => {
  // Monocromo con alfa: Android lo recolorea entero. Ver encabezado.
  return [255, 255, 255, Math.round(coberturaCruz(x, y, 96) * 255)]
})

console.log(`--primary oklch(0.485 0.08 168) → rgb(${PR}, ${PG}, ${PB})`)
console.log(`public/icono-192.png  ${bytesIcono} bytes`)
console.log(`public/badge-96.png   ${bytesBadge} bytes`)
