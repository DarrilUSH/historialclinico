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
