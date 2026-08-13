import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `supabase/config.toml` fija `site_url = "http://127.0.0.1:3000"` (no
  // "localhost"): es el origin contra el que Supabase Auth valida el
  // `redirectTo` del recupero de contraseña. Sin este origin habilitado acá,
  // `next dev` responde 403 a sus propios chunks cuando se navega por
  // 127.0.0.1 en vez de localhost, y la app queda sin hidratar. Solo aplica
  // en desarrollo: no tiene efecto en `next build`/producción.
  allowedDevOrigins: ["127.0.0.1"],

  // `web-push` (Sprint 6, `lib/push/servidor.ts`) es CommonJS y resuelve
  // `http_ece`/`asn1.js` con `require` dinámico. Bundlearlo rompe esa
  // resolución en tiempo de ejecución, así que se deja como paquete externo:
  // Next lo requiere desde `node_modules` en el servidor, que es donde -y
  // solo donde- corre.
  serverExternalPackages: ["web-push"],

  experimental: {
    serverActions: {
      // El límite por defecto de una Server Action es 1 MB, y el pipeline de
      // subida del Sprint 4 manda el archivo entero por ese canal: sin esto,
      // un PDF de 3 MB -o una foto de análisis que la compresión dejó en 1,8
      // MB- se rechaza en el borde con "Body exceeded 1 MB limit" antes de
      // llegar a la Server Action, así que ni la validación ni las guardas
      // llegan a correr.
      //
      // 25 MB = el `file_size_limit` del bucket `documentos-medicos`
      // (26214400 bytes) y el `LIMITE_BYTES` de `lib/archivos/validacion.ts`.
      // Los tres números tienen que decir lo mismo: si este fuera menor, el
      // archivo se cortaría antes de que el servidor pudiera explicar por qué;
      // si fuera mayor, aceptaríamos un cuerpo que el bucket va a rechazar
      // igual, después de haberlo subido entero.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
