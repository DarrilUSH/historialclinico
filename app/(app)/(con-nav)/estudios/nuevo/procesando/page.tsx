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
 * y confirmá" y no "Documento guardado".
 *
 * ## Todo sale del PERFIL DEL DOCUMENTO, no del perfil activo (hotfix del 19/08/2026)
 *
 * Reporte del dueño: subió un estudio para un perfil GESTIONADO y la pantalla
 * de revisión dijo *"Antes de sumarlo al historial de \<el titular\>"*. El
 * documento se había guardado bien -en el perfil correcto-, pero el cartel
 * nombraba a otra persona.
 *
 * La causa: esta página resolvía TODO contra `obtenerPerfilActivo()`. Eso
 * coincide con el destino en el flujo normal (`/estudios/nuevo` sube al perfil
 * activo), pero NO en el Web Share Target: `/compartir` tiene su propio
 * selector de PERFIL DE DESTINO (`SelectorDestino`, todos los perfiles con
 * `can_upload`), y `elegirPerfilParaCompartido` ingesta en el perfil ELEGIDO,
 * que puede ser cualquiera. Y no era sólo el cartel: con el perfil activo
 * también se traían el directorio de médicos y los títulos ya usados, así que
 * la franja "¿Es este médico que ya tenés?" cotejaba contra el directorio
 * EQUIVOCADO -y por lo tanto no ofrecía vincular a un médico que sí estaba
 * cargado en el perfil de destino-.
 *
 * Ahora el `profile_id` sale de la FILA del documento y todo cuelga de ahí: el
 * nombre del cartel, los médicos y los títulos. Es correcto por construcción,
 * venga la persona de donde venga, y no depende de que la cookie de perfil
 * activo esté al día. (`elegirPerfilParaCompartido` además deja el perfil
 * elegido como activo, para que el resto del recorrido -el encabezado, el
 * listado al confirmar, el alta de un médico desde la franja- también hable
 * del mismo historial; los dos arreglos son complementarios: éste es correcto
 * aunque aquél falle.)
 *
 * La guarda de perfil activo se conserva: no es de dónde salen los datos, es
 * lo que sostiene el shell con bottom nav de `(con-nav)`.
 *
 * La extracción en sí -el arranque de `POST /api/documentos/extraer`, las
 * consultas de estado y el formulario de revisión resultante- vive en
 * `PantallaProcesando` (`./pantalla-procesando.tsx`), un Client Component.
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

/** Tope de títulos que se traen para cotejar repetidos (Sprint 19). */
const MAX_TITULOS_COTEJADOS = 500

/**
 * Cuántos medicamentos se acaban de cargar desde este documento (Sprint 20).
 * Llega en `?medicamentos=N` cuando la cola de `/medicacion/nuevo` terminó y
 * devolvió a la persona acá para que decida qué hacer con el papel.
 *
 * Es un CONTADOR para una frase, no una autorización de nada: se acota a un
 * rango sensato y cualquier otra cosa se lee como 0 -un `?medicamentos=999`
 * escrito a mano solo consigue no ver el cartel-.
 */
function medicamentosCargadosDesdeParametro(crudo: string | undefined): number {
  if (!crudo || !/^\d{1,2}$/.test(crudo)) return 0
  const cantidad = Number(crudo)
  return cantidad > 0 && cantidad <= 20 ? cantidad : 0
}

export default async function PaginaProcesando({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string; medicamentos?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { doc, medicamentos } = await searchParams
  const documentoId = doc && PATRON_UUID.test(doc) ? doc : null
  const medicamentosCargados = medicamentosCargadosDesdeParametro(medicamentos)

  if (!documentoId) {
    redirect("/estudios/nuevo")
  }

  const { supabase } = await requerirSesion({ desde: "/estudios" })
  const { data: documento } = await supabase
    .from("documents")
    .select("profile_id, title, category, document_date")
    .eq("id", documentoId)
    .maybeSingle()

  if (!documento) {
    redirect("/estudios/nuevo")
  }

  // El perfil DESTINO: el del documento, no el activo. Ver el encabezado.
  // Con el cliente del USUARIO -si RLS devolvió la fila de `documents`, el
  // `puede_ver_perfil` de ese mismo perfil ya está concedido, así que esta
  // consulta no puede revelar nada nuevo-.
  const perfilDestinoId = documento.profile_id
  const { data: perfilDestino } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", perfilDestinoId)
    .maybeSingle()

  if (!perfilDestino) {
    redirect("/estudios/nuevo")
  }

  // Cruces inteligentes (agosto 2026): mismos dos datos que ya trae
  // `/turnos/nuevo` -directorio de médicos activos + estado del catálogo
  // REFES-, para que `FormularioRevision` pueda ofrecer "¿Es este lugar?" /
  // "¿Es este médico?" bajo institución y médico.
  //
  // Y (Sprint 19) los títulos que el perfil YA usa, para avisar en la revisión
  // cuando el título propuesto se repite. Se leen con el cliente del USUARIO
  // -RLS decide, igual que el resto de la pantalla- y son exactamente los que
  // la persona ya ve en `/estudios` del perfil DESTINO: ningún dato nuevo sale
  // de acá. Se excluye el documento que se está revisando (todavía tiene su
  // título provisional) y se acota a `MAX_TITULOS_COTEJADOS`, más que
  // suficiente para un historial personal y un tope duro para que la página no
  // crezca sin límite.
  const [{ data: medicos }, estadoCatalogo, { data: documentosDelPerfil }] = await Promise.all([
    supabase
      .from("doctors")
      .select("id, full_name, specialties, institution, address, city, province, latitude, longitude")
      .eq("profile_id", perfilDestinoId)
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    leerEstadoCatalogo(supabase),
    supabase
      .from("documents")
      .select("title")
      .eq("profile_id", perfilDestinoId)
      .neq("id", documentoId)
      .not("confirmed_at", "is", null)
      .order("document_date", { ascending: false })
      .limit(MAX_TITULOS_COTEJADOS),
  ])

  const titulosExistentes = (documentosDelPerfil ?? [])
    .map((fila) => fila.title)
    .filter((titulo): titulo is string => typeof titulo === "string" && titulo.length > 0)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 chica:gap-4 chica:py-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Revisá y confirmá
        </h1>
        <p className="text-base text-muted-foreground">
          El archivo ya se guardó de forma segura. Antes de sumarlo al historial de{" "}
          {perfilDestino.full_name}, revisá estos datos.
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
        titulosExistentes={titulosExistentes}
        medicamentosCargados={medicamentosCargados}
      />
    </div>
  )
}
