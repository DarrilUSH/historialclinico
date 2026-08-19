"use client"

/**
 * Último recurso: el único boundary que cubre al propio `app/layout.tsx`.
 *
 * Reemplaza al documento entero cuando se activa, así que —según
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`—
 * tiene que traer su `<html>`, su `<body>` y sus estilos globales por su
 * cuenta: nada del layout raíz llega hasta acá, ni la fuente, ni el proveedor
 * de tema, ni el `data-tamano` resuelto desde la cookie.
 *
 * Por eso el elemento raíz fija `data-tamano` en el valor por defecto
 * (`TAMANO_POR_DEFECTO`): los tokens compactos de `app/globals.css` cuelgan
 * de ese atributo, y sin él las clases `chica:` de la pantalla de error no
 * resuelven a nada. El tema claro/oscuro sí queda librado al del sistema
 * operativo (`globals.css` ya define ambos con `prefers-color-scheme`); no se
 * puede hacer mejor sin `localStorage`, y una preferencia de tema no vale
 * arriesgar que esta pantalla —la que aparece cuando ya falló todo lo demás—
 * dependa de más código.
 *
 * En la práctica es casi inalcanzable: `app/layout.tsx` solo llama a
 * `obtenerTamano()`, que tiene contrato de no lanzar nunca. Existe igual
 * porque "casi inalcanzable" fue exactamente la categoría del incidente que
 * originó este archivo.
 */

import { PantallaError } from "@/components/base/pantalla-error"
import { TAMANO_POR_DEFECTO } from "@/lib/densidad/tamano"

import "./globals.css"

export default function ErrorGlobal({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="es-AR" data-tamano={TAMANO_POR_DEFECTO} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {/* `metadata` no se puede exportar desde un boundary (es Client
            Component): el título se pone con el componente `<title>` de
            React 19, que es el reemplazo soportado. */}
        <title>No pudimos abrir la aplicación — Historial Médico</title>
        <PantallaError error={error} alReintentar={retry} sinEnlaceAlInicio />
      </body>
    </html>
  )
}
