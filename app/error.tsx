"use client"

/**
 * Red de seguridad de TODO lo que cuelga del layout raíz: `/login`,
 * `/registro`, las páginas legales, `/sos` y —si por algún camino se escapara
 * del boundary más cercano— también la sección con sesión.
 *
 * Hasta el P0 del 2026-08-19 la aplicación no tenía ningún `error.tsx`: una
 * excepción en cualquier Server Component terminaba en la pantalla cruda de
 * Next, en inglés. Ver `components/base/pantalla-error.tsx` para el porqué de
 * este texto y para por qué no puede ser más específico.
 *
 * No cubre errores del propio `app/layout.tsx` —un boundary nunca envuelve al
 * layout de su mismo segmento—: de eso se ocupa `app/global-error.tsx`.
 */

import { PantallaError } from "@/components/base/pantalla-error"

export default function ErrorRaiz({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <PantallaError error={error} alReintentar={retry} />
}
