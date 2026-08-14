/**
 * `/compartir`: pantalla de recepción del Web Share Target (Sprint 11, tarea
 * 11.2). A donde aterriza la persona después de que `app/api/compartir/
 * route.ts` acepta un archivo compartido desde otra app.
 *
 * Vive en `(sin-nav)`, no en `(con-nav)`: es una pantalla DE TRÁNSITO -como
 * `/perfiles` y `/ficha`-, no una sección permanente de la navegación. Elegir
 * un perfil la abandona hacia `/estudios/nuevo/procesando`; descartar la
 * abandona hacia `/inicio`.
 *
 * ## Los tres estados de esta pantalla
 *
 * 1. **Con un archivo válido** (`?archivo={id}`, la fila existe, no venció):
 *    vista previa (nombre, tipo, tamaño, miniatura si es imagen) + selector
 *    de PERFIL DE DESTINO (`SelectorDestino`, solo perfiles con
 *    `can_upload`) + botón "Descartar". Elegir un perfil corre
 *    `elegirPerfilParaCompartido` (`./actions.ts`), que reusa
 *    `lib/documentos/ingesta.ts` sin ninguna rama especial y aterriza en la
 *    pantalla de revisión que ya existe desde el Sprint 4.
 * 2. **Con un error** (`?error={codigo}`, sin archivo válido -vencido, ya
 *    consumido, o el receptor no pudo aceptarlo-): mensaje claro por código
 *    (`mensajeErrorCompartido`, nunca texto libre en la URL) y un camino de
 *    vuelta. Si el archivo TODAVÍA existe (un reintento fallido de elegir
 *    perfil, `?archivo=...&error=...` a la vez), se muestra el mismo caso 1
 *    con el error como aviso arriba, no como pantalla completa: la persona no
 *    tiene que volver a compartir para reintentar.
 * 3. **Sin ninguno de los dos** (alguien navegó acá directo, sin compartir
 *    nada): explicación breve de cómo usar la función.
 *
 * `purgarCompartidosVencidos` corre en cada visita (best-effort, nunca
 * bloquea): además de la purga en el receptor, es la otra mitad de la purga
 * perezosa documentada en `docs/share-target.md` §6.
 */

import type { Metadata } from "next"
import Link from "next/link"

import { ArrowLeftIcon, FileTextIcon, ImageIcon, InboxIcon, ShareIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { Tarjeta } from "@/components/base/tarjeta"
import { BotonDescartarCompartido } from "@/components/compartir/boton-descartar"
import { SelectorDestino, type PerfilDestino } from "@/components/compartir/selector-destino"
import { formatearBytes } from "@/lib/archivos/validacion"
import { requerirSesion } from "@/lib/auth/guardas"
import {
  esCodigoErrorCompartido,
  esImagen,
  esTokenCompartidoValido,
  etiquetaMime,
  mensajeErrorCompartido,
  yaVencio,
} from "@/lib/documentos/compartir-temporal"
import { purgarCompartidosVencidos } from "@/lib/documentos/compartir-temporal-admin"
import { BUCKETS, TTL_MAXIMO_SEGUNDOS, crearSignedUrl } from "@/lib/storage-admin"

export const metadata: Metadata = {
  title: "Archivo compartido — Historial Médico",
}

interface FilaCompartida {
  id: string
  storage_path: string
  mime_type: string
  original_filename: string
  file_size_bytes: number
}

export default async function PaginaCompartir({
  searchParams,
}: {
  searchParams: Promise<{ archivo?: string; error?: string }>
}) {
  const { supabase, usuario } = await requerirSesion({ desde: "/compartir" })

  // Best-effort, nunca bloquea la pantalla: ver el encabezado del archivo.
  await purgarCompartidosVencidos(supabase, usuario.id)

  const { archivo: archivoParam, error: errorParam } = await searchParams

  let fila: FilaCompartida | null = null
  if (esTokenCompartidoValido(archivoParam)) {
    const { data } = await supabase
      .from("shared_uploads_temp")
      .select("id, storage_path, mime_type, original_filename, file_size_bytes, expires_at")
      .eq("id", archivoParam)
      .maybeSingle()

    if (data && !yaVencio(data.expires_at)) {
      fila = data
    }
  }

  if (!fila) {
    return (
      <PantallaSinArchivo
        mensajeError={
          errorParam && esCodigoErrorCompartido(errorParam) ? mensajeErrorCompartido(errorParam) : null
        }
      />
    )
  }

  // Perfiles donde la sesión puede cargar: mismo patrón de dos consultas que
  // app/(app)/(sin-nav)/perfiles/page.tsx (RLS ya filtra "visibles", acá
  // además se filtra a can_upload porque la acción es cargar, no solo mirar).
  const { data: perfiles } = await supabase.from("profiles").select("*").order("full_name", { ascending: true })

  const perfilPropioId = perfiles?.find((perfil) => perfil.user_id === usuario.id)?.id ?? null

  const { data: permisosOtorgados } = perfilPropioId
    ? await supabase
        .from("family_permissions")
        .select("owner_profile_id, can_upload, can_manage")
        .eq("granted_profile_id", perfilPropioId)
    : { data: null }

  const permisoPorPerfil = new Map(
    (permisosOtorgados ?? []).map((permiso) => [permiso.owner_profile_id, permiso]),
  )

  const perfilesDestino: PerfilDestino[] = (perfiles ?? [])
    .map((perfil) => {
      const esPropio = perfil.id === perfilPropioId
      const permiso = permisoPorPerfil.get(perfil.id)
      return {
        perfil,
        esPropio,
        canUpload: esPropio || permiso?.can_upload === true,
        canManage: esPropio || permiso?.can_manage === true,
      }
    })
    .filter((entrada) => entrada.canUpload)
    .map(({ perfil, esPropio, canManage }) => ({ perfil, esPropio, canManage }))

  let previewUrl: string | null = null
  if (esImagen(fila.mime_type)) {
    try {
      previewUrl = await crearSignedUrl(BUCKETS.compartidosTemp, fila.storage_path, TTL_MAXIMO_SEGUNDOS)
    } catch (error) {
      // No fatal: la pantalla sigue funcionando sin miniatura, con el ícono
      // genérico de abajo.
      console.error(`[compartir] No se pudo firmar la vista previa de ${fila.id}:`, error)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Recibimos un archivo</h1>
        <p className="text-base text-muted-foreground">
          Elegí a quién le corresponde este documento. Después de elegir, lo vamos a leer
          automáticamente y vas a poder revisar los datos antes de guardarlo.
        </p>
      </div>

      {errorParam && esCodigoErrorCompartido(errorParam) && (
        <Alerta variante="error">{mensajeErrorCompartido(errorParam)}</Alerta>
      )}

      <Tarjeta className="flex-row items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL de vida corta, no un asset que next/image pueda optimizar
          <img
            src={previewUrl}
            alt={`Vista previa de ${fila.original_filename}`}
            className="size-20 shrink-0 rounded-lg border border-border object-cover"
          />
        ) : (
          <span
            className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            {esImagen(fila.mime_type) ? <ImageIcon className="size-8" /> : <FileTextIcon className="size-8" />}
          </span>
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-base font-semibold text-foreground">{fila.original_filename}</p>
          <p className="text-base text-muted-foreground numeros-clinicos">
            {etiquetaMime(fila.mime_type)} · {formatearBytes(fila.file_size_bytes)}
          </p>
        </div>
      </Tarjeta>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">¿A quién le corresponde?</h2>
        <SelectorDestino archivoId={fila.id} perfiles={perfilesDestino} />
      </div>

      <div className="flex justify-end">
        <BotonDescartarCompartido archivoId={fila.id} />
      </div>
    </div>
  )
}

function PantallaSinArchivo({ mensajeError }: { mensajeError: string | null }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <span
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        {mensajeError ? <InboxIcon className="size-8" /> : <ShareIcon className="size-8" />}
      </span>

      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        {mensajeError ? "No pudimos recibir el archivo" : "Compartí un documento con Historial Médico"}
      </h1>

      {mensajeError ? (
        <Alerta variante="error" className="max-w-md text-left">
          {mensajeError}
        </Alerta>
      ) : (
        <p className="max-w-md text-base text-muted-foreground">
          Desde la galería, un PDF guardado o casi cualquier app con la opción &ldquo;Compartir&rdquo;,
          elegí &ldquo;Historial Médico&rdquo; como destino. El archivo va a aparecer acá para que
          elijas a quién le corresponde.
        </p>
      )}

      <Boton render={<Link href="/inicio" />} nativeButton={false} variant="outline" size="lg" className="mt-2">
        <ArrowLeftIcon aria-hidden="true" />
        Volver al inicio
      </Boton>
    </div>
  )
}
