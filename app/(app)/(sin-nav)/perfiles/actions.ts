"use server"

/**
 * Server Action del selector de perfiles: fija el perfil elegido como activo
 * y navega a `/inicio`.
 *
 * ## De paso, siembra la cookie `tamano` si el dispositivo no tiene una (P0 de rendimiento, 2026-08-18)
 *
 * `obtenerTamano()` (`lib/densidad/servidor.ts`) resuelve el modo de letra de
 * CADA request autenticado -corre en el layout raíz- y, si no hay cookie
 * `tamano`, cae a consultar `profiles.display_density` **en cada una de esas
 * requests, para siempre**: `fijarCookieTamano` no puede escribir la cookie
 * durante el render de un Server Component (Next.js solo lo permite desde una
 * Server Action o un Route Handler), así que ese camino nunca se cierra solo.
 *
 * `iniciarSesion`, `registrarse` (con sesión) y `aceptarTerminos`
 * (`app/(auth)/actions.ts`) ya siembran esa cookie vía `sincronizarCookieTamano()`
 * -y ahí SÍ conviene que pisen cualquier cookie preexistente: son los tres
 * momentos en que la base es autoritativa (docs/densidad.md §3), típicamente
 * porque esta cuenta recién empieza a usar ESTE navegador-. Pero no son el
 * único camino hasta acá: una cuenta nueva con confirmación de correo no pasa
 * sesión a `registrarse` (`data.session` llega `null` en producción, ver el
 * encabezado de `app/(auth)/actions.ts`) y puede llegar a `/perfiles` sin
 * haber pasado por `iniciarSesion` en ESTE dispositivo. `elegirPerfil` es el
 * único punto que SÍ atraviesa toda sesión antes de ver una sola pantalla con
 * datos, así que sembrar acá -con `obtenerTamano()`, que nunca pisa una
 * cookie que ya esté puesta (docs/densidad.md §1: es la preferencia de
 * DISPOSITIVO de quien MIRA, no del perfil elegido, y pisarla en cada
 * selección pelearía contra un A/a tocado a propósito en este equipo)- cierra
 * el resto de los caminos sin duplicar la semántica de "pisar siempre" que sí
 * corresponde en login/registro/aceptar-términos.
 *
 * El costo es UNA consulta extra a `profiles`, y solo la primera vez que este
 * dispositivo elige un perfil sin cookie: `obtenerTamano()` devuelve de
 * inmediato, sin tocar la base, en cuanto la cookie exista. A partir de ahí,
 * ninguna pantalla de la cuenta vuelve a pagar los ~167ms de ida y vuelta a
 * Supabase (Oregón) solo para saber qué tamaño de letra mostrar.
 */

import { redirect } from "next/navigation"

import { RUTA_ACEPTAR_TERMINOS } from "@/lib/auth/rutas"
import { obtenerTamano } from "@/lib/densidad/servidor"
import { cuentaAceptoLegalesDeAlta } from "@/lib/legales"
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

  // Gate de consentimiento (Sprint 15, tarea 15.2). `app/(app)/layout.tsx` ya
  // manda a `/aceptar-terminos` a quien no firmó, así que en la navegación
  // normal esta comprobación nunca se activa. Se hace igual porque una Server
  // Action es un POST a la ruta donde vive y se puede invocar sin haber
  // renderizado ese layout: sin esto, quedaría un camino por el cual una
  // cuenta sin consentimiento fija su cookie de perfil activo. Es el otro
  // extremo del gate y el que tiene dientes: sin cookie de perfil activo,
  // ninguna pantalla de `(con-nav)` renderiza un solo dato.
  if (!(await cuentaAceptoLegalesDeAlta())) {
    redirect(RUTA_ACEPTAR_TERMINOS)
  }

  // Siembra oportunista de la cookie `tamano` si todavía falta (ver el
  // comentario de cabecera del archivo). Independiente de `perfilId` y de si
  // el permiso más abajo termina siendo válido: la preferencia de letra es de
  // la CUENTA que elige, no del perfil elegido, así que corre siempre que hay
  // sesión y nunca puede hacer fallar esta acción (`obtenerTamano` no lanza).
  await obtenerTamano()

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
