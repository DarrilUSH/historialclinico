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
 * identidad en vez de decorar: el resto de la interfaz se mantiene dentro
 * de la escala de grises de `app/globals.css` (más el rojo reservado para
 * `destructive`), así que estos diez tonos no compiten con ningún acento de
 * marca porque, hoy, la app no tiene uno.
 */

const PALETA_AVATAR = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-teal-600",
  "bg-fuchsia-600",
  "bg-pink-600",
  "bg-sky-600",
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
