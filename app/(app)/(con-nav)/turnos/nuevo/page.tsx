/**
 * `/turnos/nuevo`: alta de turno (Sprint 6, tarea 6.1). Exige `can_upload`
 * (docs/modelo-permisos.md §6.1: INSERT en `appointments` = dueño O
 * `can_upload` O `can_manage`) — un `can_view` como Diego que llegue acá a
 * mano se redirige a `/turnos` antes de ver el formulario; si igualmente
 * postea la Server Action, `crearTurno` vuelve a exigir el permiso
 * (`requerirPermiso`) y RLS (`appointments_insert_puede_cargar`) es la
 * última palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { FormularioTurno } from "@/components/turnos/formulario-turno"
import { requerirSesion } from "@/lib/auth/guardas"
import { intencionDeExtraccion } from "@/lib/documentos/intencion"
import { leerExtraccionDeDocumento } from "@/lib/documentos/leer-extraccion"
import { leerEstadoCatalogo } from "@/lib/lugares/consulta"
import { hoyIsoUshuaia } from "@/lib/turnos/fecha"
import { precargaDesdeOrden, textoParaAnalizador } from "@/lib/turnos/desde-documento"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { obtenerUltimaUbicacionConocida } from "@/lib/ubicacion/ultima-usada"

export const metadata: Metadata = {
  title: "Nuevo turno — Historial Médico",
}

/**
 * Sprint 17, tarea 17.2: `?gmail=<uuid>` cuando se llega desde la bandeja
 * "Llegaron por Gmail". Se valida la FORMA acá y la PERTENENCIA con una
 * consulta que pasa por RLS: si el id no es de un correo de esta cuenta, la
 * fila no aparece y el parámetro se ignora en silencio -la pantalla queda
 * exactamente como el alta manual de siempre-. La ruta `/api/gmail/analizar-correo`
 * vuelve a verificar lo mismo antes de leer nada de Gmail: esta comprobación
 * es para no renderizar un bloque de precarga que iba a fallar.
 */
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sprint 20, "una foto, el lugar correcto": `?doc=<uuid>` cuando se llega desde
 * el cartel de ruteo de la pantalla de revisión de un documento. Dos formas de
 * precarga, según lo que el clasificador dijo que era el papel:
 *
 * - **`turno_o_cita`** (la captura de la agenda de la clínica): el TEXTO
 *   transcripto va al analizador de mensajes, que ya sabe leer 1..N turnos y
 *   crearlos en lote. No se traduce nada acá — ver
 *   `lib/turnos/desde-documento.ts` para por qué reimplementarlo sería peor.
 * - **`orden_de_practica`** (la orden que todavía no tiene fecha): se precargan
 *   la especialidad y las notas, y la fecha queda VACÍA a propósito. No hay
 *   nada que analizar: el papel no dice cuándo.
 *
 * Cualquier otra intención -o un `doc` que RLS no devuelva- no precarga nada y
 * la pantalla queda como el alta manual de siempre.
 */
export default async function PaginaNuevoTurno({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string; doc?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/turnos")
  }

  const { supabase } = await requerirSesion({ desde: "/turnos/nuevo" })

  const { gmail, doc } = await searchParams
  let correoGmailId: string | undefined
  if (typeof gmail === "string" && PATRON_UUID.test(gmail)) {
    const { data: correo } = await supabase
      .from("gmail_messages")
      .select("id")
      .eq("id", gmail)
      .maybeSingle()
    correoGmailId = correo?.id
  }

  // Precarga desde un documento fotografiado (Sprint 20). Ver el comentario de
  // arriba. Con `?gmail=` presente esto no se consulta: son dos orígenes del
  // mismo dato y la bandeja de Gmail ya tiene su propio camino.
  const origen = correoGmailId ? null : await leerExtraccionDeDocumento(supabase, doc)
  const intencionOrigen = origen ? intencionDeExtraccion(origen.extraccion) : null
  const precargaOrden =
    intencionOrigen === "orden_de_practica" && origen
      ? precargaDesdeOrden(origen.extraccion)
      : null
  const textoDelDocumento =
    intencionOrigen === "turno_o_cita" && origen
      ? textoParaAnalizador(origen.extraccion)
      : undefined

  const [{ data: medicos }, ultimaUbicacion, estadoCatalogo] = await Promise.all([
    supabase
      .from("doctors")
      .select("id, full_name, specialties, institution, address, city, province, latitude, longitude")
      .eq("profile_id", activo.perfil.id)
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    // Sprint 16, tarea 16.1: sugerencia editable, NUNCA un valor fijo tipo
    // Ushuaia -ver `lib/ubicacion/ultima-usada.ts`-.
    obtenerUltimaUbicacionConocida(supabase, activo.perfil.id),
    // Sprint 16, tarea 16.3: una sola fila, para saber si "Lugar" puede
    // ofrecer el autocompletar del catálogo REFES o tiene que seguir siendo
    // un campo de texto común (ver `components/turnos/formulario-turno.tsx`).
    leerEstadoCatalogo(supabase),
  ])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <Link
        href="/turnos"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver a turnos
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Nuevo turno</h1>
        <p className="text-base text-muted-foreground">
          {precargaOrden
            ? `Es el pedido que fotografiaste. Cargá el día y la hora del turno de ${activo.perfil.full_name} cuando lo saques.`
            : textoDelDocumento
              ? `Leímos la foto que subiste. Revisá lo que encontramos y confirmá el turno de ${activo.perfil.full_name}.`
              : `Cargá los datos del turno de ${activo.perfil.full_name}.`}
        </p>
      </div>

      <FormularioTurno
        modo="crear"
        medicos={medicos ?? []}
        fechaMinimaIso={hoyIsoUshuaia()}
        catalogoDisponible={estadoCatalogo.centros > 0}
        correoGmailId={correoGmailId}
        textoParaAnalizar={textoDelDocumento}
        valoresIniciales={{
          ...(ultimaUbicacion
            ? { lugarCiudad: ultimaUbicacion.ciudad, lugarProvincia: ultimaUbicacion.provincia }
            : {}),
          // La orden pisa la especialidad y las notas, no la ubicación: la
          // última ciudad usada sigue siendo una sugerencia útil para el lugar
          // donde se va a atender, que la orden no dice.
          ...(precargaOrden ?? {}),
        }}
      />
    </div>
  )
}
