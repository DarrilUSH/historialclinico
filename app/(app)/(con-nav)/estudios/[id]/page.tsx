/**
 * `/estudios/{id}`: detalle real del estudio (Sprint 5, tarea 5.3).
 *
 * Reemplaza el stub de navegación de la tarea 5.1 (metadatos completos,
 * resumen de la IA, métricas de laboratorio asociadas y el visor del archivo
 * por signed URL, con su propia auditoría `ver_documento`). El visor en sí
 * -`components/estudios/visor-documento.tsx`- es un Client Component que le
 * pide la URL a `app/api/documentos/[id]/url/route.ts`; esta página solo
 * resuelve los datos que SÍ pueden servirse en el primer render (metadatos y
 * métricas), sin esperar ningún round-trip extra a Storage.
 *
 * ## Guarda y alcance de la consulta
 *
 * `.eq("profile_id", activo.perfil.id)`: mismo patrón que el stub y que
 * `/estudios` -acotación de la consulta, NO la barrera de seguridad-. La
 * política `documents_select_puede_ver` (RLS) es la que de verdad decide qué
 * fila existe para esta sesión; acotar acá además evita que un enlace a un
 * documento de OTRO perfil (uno al que la sesión también tiene acceso, pero
 * que no es el perfil activo ahora mismo) resuelva por accidente.
 *
 * Si el `id` no tiene forma de uuid o la fila no aparece -no existe, es de
 * otro perfil, o RLS la filtró-, se redirige a `/estudios` sin distinguir el
 * motivo (principio 3 de `docs/modelo-permisos.md`).
 *
 * ## Por qué las métricas se consultan acá y no en el visor
 *
 * `lab_metrics` es una tabla más, con su propia política RLS
 * (`lab_metrics_select_puede_ver`, el mismo `puede_ver_perfil`); no hace
 * falta Storage ni una signed URL para leerla, así que entra en el mismo
 * Server Component que ya trae los metadatos, sin sumar otro `<Suspense>` ni
 * otro viaje de red desde el cliente.
 */

import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { SparklesIcon, TriangleAlertIcon } from "lucide-react"

import { Tarjeta } from "@/components/base/tarjeta"
import { BotonVolverEstudios } from "@/components/estudios/boton-volver-estudios"
import { VisorDocumento } from "@/components/estudios/visor-documento"
import { formatearBytes } from "@/lib/archivos/validacion"
import { requerirSesion } from "@/lib/auth/guardas"
import { INFO_CATEGORIA } from "@/lib/estudios/categorias"
import { cn } from "@/lib/utils"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Estudio — Historial Médico",
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Fecha larga con día de la semana ("Sábado, 1 de agosto de 2026"). UTC a
 * propósito, mismo motivo que `lib/estudios/agrupacion.ts` documenta para
 * `document_date`: es un `date` puro de Postgres, sin hora, y formatearlo en
 * cualquier huso con offset negativo movería la fecha un día para atrás.
 */
const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

function formatearFechaLarga(fechaIso: string): string {
  const formateada = FORMATO_FECHA_LARGA.format(new Date(`${fechaIso}T00:00:00Z`))
  return formateada.charAt(0).toUpperCase() + formateada.slice(1)
}

interface FilaMetrica {
  id: string
  metric_name: string
  value: number
  unit: string | null
  reference_range: string | null
  reference_min: number | null
  reference_max: number | null
}

function estaFueraDeRango(metrica: FilaMetrica): boolean {
  if (metrica.reference_min !== null && metrica.value < metrica.reference_min) return true
  if (metrica.reference_max !== null && metrica.value > metrica.reference_max) return true
  return false
}

export default async function PaginaDetalleEstudio({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { id } = await params

  if (!PATRON_UUID.test(id)) {
    redirect("/estudios")
  }

  const { supabase } = await requerirSesion({ desde: "/estudios" })

  const { data: documento } = await supabase
    .from("documents")
    .select(
      "id, title, category, document_date, institution, specialty, doctor_name, mime_type, file_size_bytes, ai_summary, auto_ingest_source",
    )
    .eq("id", id)
    .eq("profile_id", activo.perfil.id)
    .maybeSingle()

  if (!documento) {
    redirect("/estudios")
  }

  const { data: metricasCrudas } = await supabase
    .from("lab_metrics")
    .select("id, metric_name, value, unit, reference_range, reference_min, reference_max")
    .eq("document_id", id)
    .eq("profile_id", activo.perfil.id)
    .order("metric_name", { ascending: true })

  const metricas: FilaMetrica[] = metricasCrudas ?? []

  const info = INFO_CATEGORIA[documento.category]
  const Icono = info.Icono

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-4 chica:py-4">
      <BotonVolverEstudios />

      <div className="flex flex-col gap-2 chica:gap-1.5">
        <div className="flex items-center gap-2 chica:gap-1.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full chica:size-7",
              info.claseFondo,
              info.claseTexto,
            )}
            aria-hidden="true"
          >
            <Icono className="size-4 chica:size-3.5" />
          </span>
          <span className={cn("text-sm font-semibold", info.claseTexto)}>{info.etiqueta}</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-balance">{documento.title}</h1>

        <p className="text-base text-muted-foreground">
          {formatearFechaLarga(documento.document_date)}
        </p>

        {/* Marca de procedencia (Sprint 17, tarea 17.3): existe para que la
            persona SIEMPRE pueda saber cómo entró un estudio a su historial,
            aunque nadie lo haya revisado antes de verlo acá. Discreta a
            propósito -no pasó nada malo, es información de origen, no una
            alerta-, así que va sin color de advertencia y del mismo tamaño
            que la fecha secundaria de arriba. */}
        {documento.auto_ingest_source === "gmail" && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground chica:gap-1 chica:text-xs">
            <SparklesIcon className="size-3.5 shrink-0 chica:size-3" aria-hidden="true" />
            Cargado desde Gmail automáticamente
          </p>
        )}
      </div>

      <VisorDocumento
        documentoId={documento.id}
        mimeType={documento.mime_type}
        titulo={documento.title}
      />

      <Tarjeta className="gap-3 px-(--card-spacing)">
        <h2 className="text-base font-semibold text-foreground">Datos del estudio</h2>
        {/* Chica (Sprint 13, tarea 13.3): grilla compacta de 2 columnas -cada
            `FilaDato` pasa de fila "etiqueta ... valor" a columna "etiqueta
            / valor", que es lo que entra sin apretar un dato largo
            (institución, médico) contra su etiqueta en una columna de ~170px-. */}
        <dl className="flex flex-col gap-2 chica:grid chica:grid-cols-2 chica:gap-x-4 chica:gap-y-3">
          <FilaDato etiqueta="Institución" valor={documento.institution} />
          <FilaDato etiqueta="Especialidad" valor={documento.specialty} />
          <FilaDato etiqueta="Médico" valor={documento.doctor_name} />
          <FilaDato
            etiqueta="Tamaño del archivo"
            valor={documento.file_size_bytes ? formatearBytes(documento.file_size_bytes) : null}
          />
          {!documento.institution &&
            !documento.specialty &&
            !documento.doctor_name &&
            !documento.file_size_bytes && (
              <p className="text-base text-muted-foreground">
                No hay datos adicionales cargados para este estudio.
              </p>
            )}
        </dl>
      </Tarjeta>

      {documento.ai_summary && (
        <Tarjeta className="gap-2 px-(--card-spacing)">
          <div className="flex items-center gap-2 text-muted-foreground">
            <SparklesIcon className="size-4 shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium">Resumen generado automáticamente</span>
          </div>
          <p className="text-base text-foreground">{documento.ai_summary}</p>
        </Tarjeta>
      )}

      {metricas.length > 0 && (
        <Tarjeta className="gap-3 px-(--card-spacing)">
          <h2 className="text-base font-semibold text-foreground">Resultados de laboratorio</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">
                Resultados de laboratorio asociados a este estudio: nombre, valor y rango de
                referencia
              </caption>
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Nombre
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Valor
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Rango de referencia
                  </th>
                </tr>
              </thead>
              <tbody>
                {metricas.map((metrica) => {
                  const fueraDeRango = estaFueraDeRango(metrica)
                  return (
                    <tr key={metrica.id} className="border-b border-border text-base last:border-0">
                      <td className="py-2 pr-3 font-medium text-foreground">
                        {metrica.metric_name}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            "numeros-clinicos",
                            fueraDeRango ? "font-semibold text-advertencia-fuerte" : "text-foreground",
                          )}
                        >
                          {metrica.value}
                          {metrica.unit ? ` ${metrica.unit}` : ""}
                        </span>
                        {fueraDeRango && (
                          <span className="mt-1 flex items-center gap-1 text-sm font-medium text-advertencia-fuerte">
                            <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
                            Fuera de rango
                          </span>
                        )}
                      </td>
                      <td className="numeros-clinicos py-2 text-muted-foreground">
                        {metrica.reference_range ?? "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}
    </div>
  )
}

function FilaDato({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  if (!valor) return null
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2 text-base last:border-0 last:pb-0 chica:flex-col chica:items-start chica:gap-0.5 chica:border-0 chica:pb-0">
      <dt className="text-muted-foreground chica:text-sm">{etiqueta}</dt>
      <dd className="text-right font-medium text-balance text-foreground chica:text-left">{valor}</dd>
    </div>
  )
}
