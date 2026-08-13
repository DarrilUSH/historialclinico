/**
 * Avatar de perfil: iniciales sobre un color determinístico por uuid.
 *
 * Todavía no hay fotos (`profiles.avatar_storage_path` llega en un sprint
 * posterior): mientras tanto, cada perfil necesita una identidad visual
 * estable para que un vistazo alcance para reconocerlo en el selector. El
 * color se deriva del `id`, nunca se sortea, para que no cambie entre
 * renders, entre dispositivos ni entre sesiones.
 *
 * La paleta es la única superficie de la app donde el color diferencia
 * identidad en vez de decorar. Por eso no usa los colores sueltos de Tailwind
 * sino los tokens `--avatar-1..8` de `app/globals.css`: ocho tonos maduros de
 * la misma familia cromática que la marca, todos medidos contra
 * `--avatar-foreground` (>= 4.5:1 en tema claro y oscuro, ver
 * `node scripts/verificar-contraste.mjs`). En tema oscuro los tokens suben de
 * luminosidad y el texto se invierte, así que el contraste se mantiene sin
 * tocar este archivo.
 */

const PALETA_AVATAR = [
  "bg-avatar-1",
  "bg-avatar-2",
  "bg-avatar-3",
  "bg-avatar-4",
  "bg-avatar-5",
  "bg-avatar-6",
  "bg-avatar-7",
  "bg-avatar-8",
] as const

/**
 * Hash estable (FNV-1a de 32 bits). No hace falta que sea criptográfico:
 * solo tiene que repartir uuids de forma pareja y dar siempre el mismo
 * resultado para el mismo id, en el servidor y en el cliente.
 */
function hashEstable(valor: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < valor.length; i += 1) {
    hash ^= valor.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Clase Tailwind de fondo, determinística para el `id` del perfil. */
export function colorAvatarPara(id: string): string {
  const indice = hashEstable(id) % PALETA_AVATAR.length
  return PALETA_AVATAR[indice]
}

/**
 * Iniciales para el avatar: primera letra del primer nombre + primera letra
 * del último apellido. Con un solo término se usa esa letra sola.
 * `toLocaleUpperCase("es-AR")` para que `ñ` y las vocales acentuadas se
 * mayusculicen correctamente.
 */
export function inicialesDe(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) {
    return "?"
  }
  const primera = partes[0].charAt(0)
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : ""
  return `${primera}${ultima}`.toLocaleUpperCase("es-AR")
}
