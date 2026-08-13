/**
 * Página de diagnóstico — SOLO DESARROLLO.
 *
 * Verifica en caliente que el cliente de servidor de `@supabase/ssr` conecta
 * bien contra el stack local: instancia el cliente, consulta `public.profiles`
 * con la anon key (sin sesión) y reporta cuántas filas ve.
 *
 * Hallazgo importante (ver supabase/migrations/20260812220000_rls.sql §4):
 * este esquema NO otorga ningún privilegio de tabla al rol `anon` sobre
 * `profiles` — "este proyecto no expone ninguna tabla del dominio al rol
 * anon". Entonces, sin sesión, la consulta no vuelve con 0 filas por
 * filtrado de RLS: PostgREST corta antes, con el código 42501
 * (insufficient_privilege / "permission denied for table profiles"), porque
 * el REVOKE de tabla actúa una capa antes de que RLS se evalúe siquiera.
 *
 * Para este diagnóstico, ese 42501 puntual es la respuesta SANA de una
 * conexión anónima (confirma conexión OK + cero visibilidad de datos), así
 * que se trata como "0 perfiles visibles" y no como una falla. Cualquier
 * otro código de error (URL mal configurada, key inválida, red caída, etc.)
 * sí se muestra como error real.
 *
 * No es una feature del producto: en producción devuelve 404. No requiere
 * lógica de negocio ni queda linkeada desde ningún lado.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Perfil } from "@/types/dominio";

export default async function PaginaEstado() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const supabase = await createClient();

  // OJO: sin `head: true`. Con `head: true` PostgREST responde un HEAD sin
  // body, y ante un error (como el 42501 de más abajo) postgrest-js no tiene
  // de dónde sacar `code`/`message` — el error queda vacío (`{message: ""}`)
  // y es indistinguible de un fallo real de conexión. Con GET sí llega el
  // body y el error viene completo.
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact" })
    .returns<Perfil[]>();

  // Ver el comentario del encabezado: con anon, 42501 es el resultado
  // esperado (sin privilegios de tabla), no una falla de conexión.
  const bloqueoEsperadoDeAnon = error?.code === "42501";
  const visibles = bloqueoEsperadoDeAnon ? 0 : (count ?? 0);
  const huboErrorReal = Boolean(error) && !bloqueoEsperadoDeAnon;

  const mensaje = huboErrorReal
    ? `Conexión Supabase: ERROR — ${error!.message}`
    : `Conexión Supabase: OK — perfiles visibles: ${visibles} (RLS activa)`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-mono text-sm">
      <h1 className="text-lg font-semibold">
        Diagnóstico — Historial Médico (solo dev)
      </h1>
      <p className={huboErrorReal ? "text-destructive" : "text-exito"}>
        {mensaje}
      </p>
      {bloqueoEsperadoDeAnon && (
        <p className="max-w-md text-center text-xs text-muted-foreground">
          El 0 es por GRANT de tabla: el rol `anon` no tiene privilegios sobre
          `profiles` (revocado a propósito en el esquema). No es un filtro de
          fila de RLS — RLS ni llega a evaluarse acá. Con un usuario
          autenticado, esta misma página debería mostrar solo su propio
          perfil.
        </p>
      )}
    </main>
  );
}
