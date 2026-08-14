/**
 * Manifiesto de instalación de la PWA (Sprint 11, tarea 11.1).
 *
 * Archivo de convención de Next 16 (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/manifest.md`):
 * exportar una función que devuelva `MetadataRoute.Manifest` genera la ruta
 * `/manifest.webmanifest` y, como es un archivo estático reconocido por el
 * sistema de metadatos, Next agrega solo el `<link rel="manifest">` en el
 * `<head>` — no hace falta declararlo a mano en `app/layout.tsx`
 * (`node_modules/next/dist/lib/metadata/resolve-metadata.js`, rama
 * `staticFilesMetadata.manifest`).
 *
 * ## `/manifest.webmanifest` necesitó una excepción propia en `lib/auth/rutas.ts`
 *
 * A diferencia de `public/icons/*.png` -que el `matcher` de `proxy.ts` excluye
 * por extensión de imagen-, esta ruta no tiene extensión de imagen y SÍ pasa
 * por el proxy. Sin `RUTA_MANIFEST` en `RUTAS_PUBLICAS`, alguien sin sesión
 * (por ejemplo Chrome evaluando instalabilidad antes de que la persona haya
 * iniciado sesión, o cualquier auditoría automática) recibiría un `307 →
 * /login` en vez del JSON del manifest, y Chrome descarta la app como
 * instalable en silencio. Ver el comentario de `RUTA_MANIFEST`.
 *
 * ## `start_url: "/inicio"` con sesión, no con "/"
 *
 * `/` es pública (landing) pero no es la pantalla útil de la app; `/inicio`
 * es privada y sin sesión el proxy redirige a `/login?desde=/inicio`, que es
 * exactamente el comportamiento correcto: abrir la app instalada sin sesión
 * tiene que pedir login, no mostrar la landing pública.
 *
 * ## Colores: tema oscuro, porque es el primario del producto (nota del
 * orquestador de esta tarea)
 *
 * `theme_color` y `background_color` del manifest son un único valor -no
 * admiten `prefers-color-scheme` como sí hace `viewport.themeColor` en
 * `app/layout.tsx`-, así que hay que elegir un tema. Se usa `--background`
 * oscuro (`app/globals.css`, `.dark`, `oklch(0.198 0.014 168)` = `#0F1814`)
 * para las dos claves, igual que ya hace `viewport.themeColor` de
 * `app/layout.tsx` para la rama oscura: la barra del sistema y la pantalla de
 * carga (splash screen que arma Android con estos dos valores) combinan con
 * el fondo real de la app en vez de mostrar un color que no es de nadie.
 *
 * ## `share_target` (Sprint 11, tarea 11.2)
 *
 * Registra la PWA como destino en la hoja de "Compartir" del sistema (solo
 * Android/Chrome con la app instalada como WebAPK — ver `docs/share-target.md`
 * §4 para la limitación de iOS y la de verificación contra localhost, ya
 * conocida desde 11.1). `action` apunta al Route Handler receptor
 * (`app/api/compartir/route.ts`), que hace su PROPIA guarda de sesión -ver el
 * comentario de `RUTA_COMPARTIR` en `lib/auth/rutas.ts`- en vez de depender
 * del 401 JSON genérico de `/api`.
 *
 * `params.files[0].name` ("archivos") es el nombre de campo que el receptor
 * lee del `FormData` con `formData.getAll("archivos")`: tiene que coincidir
 * exacto en los dos lados. `accept` repite los mismos cuatro MIME que
 * `lib/archivos/validacion.ts` y el bucket `documentos-medicos` — el sistema
 * operativo ya filtra qué archivos ofrece compartir hacia esta app con esta
 * lista, aunque el receptor igual revalida por magic bytes (nunca confía en
 * lo que declaró el sistema operativo, mismo criterio que el resto del
 * pipeline de ingesta).
 *
 * `title`/`text` se aceptan (algunas apps mandan una leyenda al compartir,
 * por ejemplo WhatsApp) pero el receptor no los usa: el título final del
 * documento se decide en la pantalla de revisión existente del Sprint 4
 * (`components/documentos/formulario-revision.tsx`), que ya deja
 * retitular todo antes de confirmar. Enchufarlos ahora sería una segunda
 * fuente de título compitiendo con la que ya funciona.
 *
 * ## `short_name`: "H. Médico" y no "Historial"
 *
 * El launcher de Android corta el nombre visible a pocos caracteres. Entre
 * las dos opciones que planteó la tarea, "Historial" a secas se confunde con
 * cualquier app genérica de notas o historial de navegación -exactamente el
 * tipo de ambigüedad que hay que evitar en un ícono de emergencia médica-,
 * mientras que "H. Médico" conserva la palabra que identifica al producto en
 * el mismo largo. El nombre completo `name` (regla dura del proyecto, CON
 * tilde) se reserva para donde el launcher tiene espacio: el diálogo de
 * instalación y la lista de apps.
 */
import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Historial Médico",
    short_name: "H. Médico",
    description:
      "Ficha de emergencia, medicación, turnos y estudios de toda la familia, siempre a mano.",
    start_url: "/inicio",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "es-AR",
    // Ver el comentario de cabecera: valores de `--background` del tema
    // oscuro (`.dark` en app/globals.css), el tema primario del producto.
    background_color: "#0F1814",
    theme_color: "#0F1814",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Ver el comentario de cabecera "share_target (Sprint 11, tarea 11.2)".
    share_target: {
      action: "/api/compartir",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "titulo",
        text: "texto",
        files: [
          {
            name: "archivos",
            accept: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
          },
        ],
      },
    },
    // Shortcuts (long-press del ícono instalado): los dos caminos que un
    // adulto mayor o quien lo cuida necesitan sin pasar por la navegación
    // normal de la app. Reusan el ícono principal -pedido explícito de la
    // tarea, ningún diseño nuevo para dos entradas de menú-.
    shortcuts: [
      {
        name: "Ficha SOS",
        short_name: "SOS",
        description: "Abrir la ficha de emergencia",
        url: "/sos",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Turnos",
        short_name: "Turnos",
        description: "Ver los próximos turnos médicos",
        url: "/turnos",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  }
}
