/**
 * `/estudios/nuevo/procesando?doc={id}`: pantalla de aterrizaje después de una
 * subida exitosa, y punto donde arranca la lectura automática con Gemini.
 *
 * Server Component: guarda (perfil activo + sesión) y resuelve los datos ya
 * guardados del documento -título, categoría y fecha PROVISIONALES, los que
 * dejó `ingestarDocumento` (`lib/documentos/ingesta.ts`) al subir el
 * archivo-, con el cliente del USUARIO -si RLS los devuelve, el permiso está
 * verificado, y si no aparecen (id inventado, perfil cambiado en otra
 * pestaña) la pantalla simplemente redirige-. No se distingue "no existe" de
 * "no tenés permiso", por el principio 3 de docs/modelo-permisos.md.
 *
 * Este es TODAVÍA el flujo de subida: el documento NO está guardado en el
 * sentido final hasta que la persona confirma en la pantalla de revisión
 * (tarea 4.5, "la IA nunca guarda sola"). Por eso el encabezado dice "Revisá
 * y confirmá" y no "Documento guardado" -ese título quedó desactualizado en
 * cuanto existió un paso de revisión obligatorio-.
 *
 * La extracción en sí -el `fetch` a `POST /api/documentos/extraer`, los
 * estados de carga y el formulario de revisión resultante- vive en
 * `PantallaProcesando` (`./pantalla-procesando.tsx`), un Client Component:
 * necesita `useEffect` para dispararse al montar y estado de React para las
 * fases (leyendo / revisando), igual que `pantalla-carga.tsx` en
 * `/estudios/nuevo`.
 *
 * Si `doc` falta o no tiene forma de uuid, o la fila no aparece, se redirige
 * a `/estudios/nuevo`: no tiene sentido mostrar una pantalla de revisión sin
 * documento, ni gastar cuota de Gemini por un id que ni siquiera es válido.
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requerirSesion } from "@/lib/auth/guardas"
import { fechaDeHoy } from "@/lib/documentos/ingesta"
import { leerEstadoCatalogo } from "@/lib/lugares/consulta"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

import { PantallaProcesando } from "./pantalla-procesando"

export const metadata: Metadata = {
  title: "Revisar documento — Historial Médico",
}

const PATRON_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaProcesando({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { doc } = await searchParams
  const documentoId = doc && PATRON_UUID.test(doc) ? doc : null

  if (!documentoId) {
    redirect("/estudios/nuevo")
  }

  const { supabase } = await requerirSesion({ desde: "/estudios" })
  const { data: documento } = await supabase
    .from("documents")
    .select("title, category, document_date")
    .eq("id", documentoId)
    .maybeSingle()

  if (!documento) {
    redirect("/estudios/nuevo")
  }

  // Cruces inteligentes (agosto 2026): mismos dos datos que ya trae
  // `/turnos/nuevo` -directorio de médicos activos + estado del catálogo
  // REFES-, para que `FormularioRevision` pueda ofrecer "¿Es este lugar?" /
  // "¿Es este médico?" bajo institución y médico.
  const [{ data: medicos }, estadoCatalogo] = await Promise.all([
    supabase
      .from("doctors")
      .select("id, full_name, specialties, institution, address, city, province, latitude, longitude")
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    leerEstadoCatalogo(supabase),
  ])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 chica:gap-4 chica:py-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Revisá y confirmá
        </h1>
        <p className="text-base text-muted-foreground">
          El archivo ya se guardó de forma segura. Antes de sumarlo al historial de{" "}
          {activo.perfil.full_name}, revisá estos datos.
        </p>
      </div>

      <PantallaProcesando
        documentoId={documentoId}
        tituloProvisional={documento.title}
        categoriaProvisional={documento.category}
        fechaProvisional={documento.document_date}
        fechaMaximaIso={fechaDeHoy()}
        medicos={medicos ?? []}
        catalogoDisponible={estadoCatalogo.centros > 0}
      />
    </div>
  )
}
