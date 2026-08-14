import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
} from "next/font/google";

import { ProveedorTema } from "@/components/tema/proveedor-tema";
import { obtenerTamano } from "@/lib/densidad/servidor";
import "./globals.css";

/**
 * Atkinson Hyperlegible Next: tipografía creada por el Braille Institute para
 * personas con baja visión. Diferencia de forma inequívoca I / l / 1 y 0 / O,
 * abre las contraformas y engrosa los remates. Es la decisión tipográfica que
 * más rinde en una app para adultos mayores. Se autoaloja con next/font: no
 * hay pedidos a Google en runtime.
 */
const fuenteSans = Atkinson_Hyperlegible_Next({
  variable: "--fuente-sans",
  subsets: ["latin"],
  display: "swap",
});

/** Misma superfamilia, ancho fijo: dosis, valores de laboratorio y fechas. */
const fuenteMono = Atkinson_Hyperlegible_Mono({
  variable: "--fuente-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Historial Médico",
  description: "Tu historial médico, siempre a mano.",
  // Ícono de la pantalla de inicio de iOS (Sprint 11, tarea 11.1). Generado
  // desde el mismo `public/icono-192.png` que usa el resto de la PWA —ver
  // `app/manifest.ts`—, a pantalla completa y sin transparencia porque Safari
  // no la respeta de forma consistente en este uso.
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // `capable` + `statusBarStyle` (Sprint 11, tarea 11.1): agregan a la PWA
  // instalada desde iOS a pantalla completa, sin la barra de Safari.
  //
  // Next 16 emite `capable: true` como `<meta name="mobile-web-app-capable">`
  // -el tag estándar, sin el prefijo `apple-`- y NO agrega además el viejo
  // `apple-mobile-web-app-capable`
  // (`node_modules/next/dist/lib/metadata/metadata.js`, rama "Apple Web
  // App"): Safari reciente ya entiende el tag estándar, así que no hace
  // falta el duplicado. Se deja esta nota porque la tarea pedía el nombre
  // viejo del meta tag y el comportamiento real de esta versión de Next es
  // otro.
  //
  // `statusBarStyle: "default"` en vez de `"black-translucent"`: esta última
  // vuelve transparente la barra de estado y deja el contenido corriendo por
  // debajo, lo que exige manejar `env(safe-area-inset-top)` en el layout. Hoy
  // la app solo reserva `safe-area-inset-bottom` (para la bottom nav fija,
  // `app/(app)/(con-nav)/layout.tsx`) y nada arriba, así que
  // "black-translucent" tapa el encabezado del perfil bajo el notch en un
  // iPhone. "default" reserva su propio espacio y no depende de nada nuevo.
  appleWebApp: {
    capable: true,
    title: "H. Médico",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // El color de la barra del navegador acompaña al tema (los valores son los
  // tokens --background de app/globals.css ya convertidos a sRGB).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1814" },
  ],
  // Nunca bloquear el zoom: mucha gente lo usa para leer.
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

/**
 * `async` desde el Sprint 13: el modo de letra se resuelve **en el servidor**
 * y viaja ya escrito en el HTML.
 *
 * Es la única forma de cumplir "sin flash al recargar" del criterio de
 * aceptación. La alternativa -un script de cliente que lea la preferencia y
 * ponga el atributo- repetiría el truco de next-themes, pero next-themes puede
 * hacerlo porque su fuente de verdad es `localStorage`, que es síncrono. La
 * nuestra es una fila de `profiles`: no hay forma de consultarla antes del
 * primer pintado, así que la primera pintura mostraría el tamaño equivocado y
 * saltaría al correcto.
 *
 * **Costo declarado:** leer la cookie hace dinámico todo el árbol, así que las
 * siete rutas que `next build` prerenderizaba estáticas (`/`, `/_not-found`,
 * `/estado`, `/estilos`, `/offline`, `/recuperar`, `/registro`) pasan a
 * renderizarse a demanda. Se acepta a conciencia: son rutas frías -ninguna
 * está en un camino caliente de la app-, no hay CDN delante (el proyecto se
 * sirve con `next start`), y en esta PWA el cacheado real lo hace el service
 * worker, que guarda la RESPUESTA sin importar si Next la prerenderizó o no.
 * A cambio, no hay una sola pantalla -incluida `/offline`- que pueda quedar
 * fuera del modo elegido. `/manifest.webmanifest` no se ve afectada: es un
 * Route Handler y no cuelga de este layout.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const tamano = await obtenerTamano();

  return (
    <html
      // `es-AR` y no `es` (Sprint 11, auditoría a11y): toda la app está
      // escrita en castellano rioplatense ("Ingresá", "Registrate", "vos"), y
      // la etiqueta de idioma es lo que usa un lector de pantalla para elegir
      // la voz y las reglas de pronunciación (WCAG 3.1.1). Declarar la región
      // hace que NVDA/TalkBack lean con voz argentina donde esté disponible,
      // en vez de caer en el castellano peninsular por defecto.
      lang="es-AR"
      // Gobierna los tokens compactos de `app/globals.css` §5 y la variante
      // `chica:` de Tailwind. Va en el mismo elemento donde next-themes
      // escribe `.dark`: tema y densidad son dos ejes independientes del mismo
      // nodo raíz. `suppressHydrationWarning` (que ya estaba por el tema)
      // cubre también el caso del botón A/a, que cambia este atributo en el
      // cliente antes de que llegue el HTML nuevo.
      data-tamano={tamano}
      suppressHydrationWarning
      className={`${fuenteSans.variable} ${fuenteMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ProveedorTema>{children}</ProveedorTema>
      </body>
    </html>
  );
}
