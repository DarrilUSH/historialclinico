"use server"

/**
 * Server Actions transversales a toda la sección autenticada.
 *
 * Vive en `app/(app)/` -y no dentro de una ruta- porque sus dos consumidores
 * están en route groups distintos y ninguno es "dueño" de la acción: el botón
 * A/a del encabezado (`app/(app)/(con-nav)/`, vía
 * `components/navegacion/boton-tamano.tsx`) y la pregunta del selector de
 * perfiles (`app/(app)/(sin-nav)/perfiles/`). Ponerla en cualquiera de las dos
 * obligaría a la otra a importar desde adentro de un route group ajeno.
 */

import { revalidatePath } from "next/cache"

import { persistirTamano } from "@/lib/densidad/servidor"
import { type Tamano, esTamano } from "@/lib/densidad/tamano"

/**
 * Cambia el modo de letra de la CUENTA logueada.
 *
 * ## Firma
 *
 * `tamano` va primero para que el selector de perfiles pueda usar el mismo
 * patrón que `elegirPerfil`: `cambiarTamano.bind(null, "chica")` dentro de un
 * `<form>` nativo, que funciona sin una línea de JavaScript de cliente. El
 * segundo parámetro es el `FormData` que Next.js agrega al invocar una acción
 * bindeada desde un formulario; esta acción no lo necesita, y es opcional
 * porque el botón A/a del encabezado -que sí es un Client Component- la llama
 * directo con un solo argumento.
 *
 * ## Validación
 *
 * `esTamano` no es defensa en profundidad decorativa: una Server Action es un
 * endpoint HTTP público y su argumento lo controla quien la llama. Un valor
 * que no sea exactamente `"grande"` o `"chica"` se ignora **en silencio y sin
 * efecto**: no se persiste, no se toca la cookie y no se revalida nada. No
 * lanza a propósito -un tamaño de letra inválido no justifica una pantalla de
 * error- y la base tampoco llegaría a verlo: el enum `display_density` lo
 * rechazaría igual, pero conviene no gastar el viaje ni el mensaje feo.
 *
 * ## Por qué revalida el layout raíz
 *
 * El atributo `data-tamano` se pinta en `<html>`, o sea en `app/layout.tsx`.
 * Sin `revalidatePath("/", "layout")`, el Router Cache del cliente podría
 * servir en la próxima navegación un árbol renderizado con la cookie VIEJA y
 * devolver la app al tamaño anterior -justo el "flash de tamaño equivocado"
 * que el criterio de aceptación prohíbe-. `"layout"` y no `"page"` porque lo
 * que cambió está en el layout, no en ninguna página en particular.
 *
 * No redirige ni devuelve nada: quien la llama ya está en la pantalla que
 * corresponde y lo único que necesita es verla con el tamaño nuevo.
 */
export async function cambiarTamano(
  tamano: Tamano,
  _formData?: FormData,
): Promise<void> {
  void _formData

  if (!esTamano(tamano)) {
    return
  }

  await persistirTamano(tamano)

  revalidatePath("/", "layout")
}
