import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
} from "next/font/google";

import { ProveedorTema } from "@/components/tema/proveedor-tema";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${fuenteSans.variable} ${fuenteMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ProveedorTema>{children}</ProveedorTema>
      </body>
    </html>
  );
}
