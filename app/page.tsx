import { redirect } from "next/navigation"

/**
 * Raíz del dominio. No hay landing pública: el producto ES la aplicación,
 * así que `/` deriva a `/inicio` y `proxy.ts` resuelve el resto — con sesión
 * se ve el inicio del perfil activo, sin sesión redirige a
 * `/login?desde=/inicio` (y las páginas públicas /privacidad y /terminos
 * quedan enlazadas desde el pie del login).
 *
 * Reemplaza al placeholder "en construcción" del Sprint 0, que sobrevivió
 * hasta el deploy porque ninguna navegación interna pasa por la raíz — lo
 * encontró el usuario al abrir el dominio pelado en producción.
 */
export default function Raiz() {
  redirect("/inicio")
}
