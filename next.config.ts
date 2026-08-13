import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `supabase/config.toml` fija `site_url = "http://127.0.0.1:3000"` (no
  // "localhost"): es el origin contra el que Supabase Auth valida el
  // `redirectTo` del recupero de contraseña. Sin este origin habilitado acá,
  // `next dev` responde 403 a sus propios chunks cuando se navega por
  // 127.0.0.1 en vez de localhost, y la app queda sin hidratar. Solo aplica
  // en desarrollo: no tiene efecto en `next build`/producción.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
