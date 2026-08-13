"use server"

/**
 * Server Action del selector de perfiles: fija el perfil elegido como activo
 * y navega a `/inicio`.
 */

import { redirect } from "next/navigation"

import { esErrorDeGuarda, fijarPerfilActivo } from "@/lib/perfil-activo"

/**
 * Firma con `perfilId` como primer argumento porque el selector la invoca
 * como `elegirPerfil.bind(null, perfil.id)`: cada tarjeta es un `<form>`
 * nativo (funciona incluso sin JavaScript), y el bind es la forma de
 * pasarle qué perfil se eligió sin depender de un campo oculto ni de estado
 * de cliente.
 *
 * `fijarPerfilActivo` ya revalida el permiso contra la base
 * (`requerirPermiso(..., "view")`) antes de escribir la cookie: esta acción
 * no repite esa lógica ni confía en que el perfil mostrado en la tarjeta
 * siga siendo válido -entre el render del selector y el click puede haber
 * pasado cualquier cosa, incluida una revocación-.
 *
 * Si la validación falla, se vuelve al selector en lugar de reventar con un
 * error sin manejar: es un caso borde (permiso revocado en esa ventana
 * exacta), no la ruta feliz, pero tiene que degradar con gracia.
 */
export async function elegirPerfil(
  perfilId: string,
  _formData: FormData,
): Promise<void> {
  // El segundo parámetro lo agrega Next.js al invocar la acción bindeada
  // desde el `<form>`; esta acción no lo necesita, `void` deja explícito que
  // es intencional y no un olvido.
  void _formData

  let permisoValido = true

  try {
    await fijarPerfilActivo(perfilId)
  } catch (error) {
    if (!esErrorDeGuarda(error)) {
      throw error
    }
    permisoValido = false
  }

  // `redirect()` lanza una excepción interna de Next (`NEXT_REDIRECT`) que un
  // `catch` que la trague deja colgada (ver el aviso en lib/auth/guardas.ts).
  // Por eso se llama acá afuera, después de que el catch ya se resolvió, y
  // nunca dentro del bloque `catch` de arriba.
  redirect(permisoValido ? "/inicio" : "/perfiles")
}
