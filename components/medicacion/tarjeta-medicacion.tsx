/**
 * Tarjetas de medicación (Sprint 7, tarea 7.2 / 7.5). Dos variantes, para las dos
 * secciones de `/medicacion`:
 *
 * - `TarjetaMedicacionActiva` — lee `v_medicacion_estado`
 *   (`supabase/migrations/20260813060000_medicacion_estado.sql`): nombre
 *   comercial + droga, presentación, dosis, horarios como chips, y el bloque
 *   de stock/días restantes -el dato PROMINENTE de la tarjeta, con
 *   advertencia visual cuando `necesita_renovacion`-. Nunca se calcula nada
 *   acá: la vista ya trae `dias_restantes`, `fecha_estimada_fin` y
 *   `necesita_renovacion` resueltos (docs/modelo-medicacion.md §2, "el umbral
 *   se define UNA vez, en la vista"). Incluye link "Ver receta" si está
 *   asociada (tarea 7.5).
 * - `TarjetaMedicacionSuspendida` — lee `medications` directo (la vista NO
 *   incluye suspendidas, docs/modelo-medicacion.md §2.5): versión reducida,
 *   sin días restantes -"para una medicación suspendida esa pregunta no
 *   tiene respuesta"-, con la fecha de suspensión y el botón "Reactivar".
 *
 * El stock se presenta siempre como AYUDA, nunca como validación
 * (docs/modelo-medicacion.md §5): ninguna de las dos tarjetas bloquea nada
 * por un stock bajo, solo avisa.
 */

import Link from "next/link"
import { AlarmClockIcon, FileTextIcon, PackageIcon, PillIcon, TriangleAlertIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Tarjeta } from "@/components/base/tarjeta"
import { AccionesMedicacionActiva, BotonReactivar } from "@/components/medicacion/acciones-medicacion"
import { textoCantidadConUnidad } from "@/lib/medicacion/unidades"
import type { Database } from "@/types/database.types"

type FilaVistaMedicacion = Database["public"]["Views"]["v_medicacion_estado"]["Row"]
type FilaMedicacion = Database["public"]["Tables"]["medications"]["Row"]

const FORMATO_FECHA_CORTA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
})

/** Fechas `date` puras (`fecha_estimada_fin`, `start_date`, `suspended_at::date`): mismo criterio que `components/estudios/tarjeta-estudio.tsx`. */
function formatearFecha(fechaIso: string): string {
  return FORMATO_FECHA_CORTA.format(new Date(`${fechaIso}T00:00:00Z`))
}

/**
 * `dose_unit` se guarda en SINGULAR (default `'comprimido'`) porque su uso
 * primario es la dosis por toma. Concatenarlo tal cual con el stock producía
 * "90 comprimido disponibles"; `textoCantidadConUnidad`
 * (`lib/medicacion/unidades.ts`) es la única forma correcta de unir una
 * cantidad con esa columna, y la comparte con el texto de las alertas push.
 */
function textoDosis(dosis: number | null, unidad: string | null): string {
  return textoCantidadConUnidad(dosis, unidad)
}

function textoFrecuencia(
  frecuencia: FilaVistaMedicacion["frequency"] | FilaMedicacion["frequency"],
  intervalHours: number | null,
): string {
  if (frecuencia === "interval_hours") return `Cada ${intervalHours ?? "—"} horas`
  if (frecuencia === "as_needed") return "Cuando lo necesite"
  return "Todos los días"
}

function ChipsHorarios({ horarios }: { horarios: string[] | null }) {
  if (!horarios || horarios.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {horarios.map((hora) => (
        <li
          key={hora}
          className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-foreground"
        >
          {hora.slice(0, 5)}
        </li>
      ))}
    </ul>
  )
}

export function TarjetaMedicacionActiva({
  medicacion,
  puedeEditar,
}: {
  medicacion: FilaVistaMedicacion
  puedeEditar: boolean
}) {
  const dias = medicacion.dias_restantes

  return (
    <Tarjeta className="gap-4 px-(--card-spacing)">
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-balance text-foreground">{medicacion.name}</h3>
          {!medicacion.vigente_hoy && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              No vigente hoy
            </span>
          )}
        </div>
        {medicacion.active_ingredient && (
          <p className="text-sm text-muted-foreground">{medicacion.active_ingredient}</p>
        )}
        {medicacion.presentation && (
          <p className="text-sm text-muted-foreground">{medicacion.presentation}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-base text-foreground">
          <PillIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {textoDosis(medicacion.dose_amount, medicacion.dose_unit)} —{" "}
            {textoFrecuencia(medicacion.frequency, medicacion.interval_hours)}
          </span>
        </div>
        {medicacion.frequency === "daily" && (
          <div className="flex items-center gap-2">
            <AlarmClockIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <ChipsHorarios horarios={medicacion.schedule_times} />
          </div>
        )}
      </div>

      {/* Stock y días restantes: el dato prominente de la tarjeta (criterio de
          aceptación del ROADMAP). */}
      {medicacion.stock_units !== null ? (
        <div
          className={
            medicacion.necesita_renovacion
              ? "flex flex-col gap-1 rounded-lg border border-advertencia/40 bg-advertencia-suave px-4 py-3"
              : "flex flex-col gap-1 rounded-lg border border-border bg-muted px-4 py-3"
          }
        >
          <div className="flex items-center gap-2">
            <PackageIcon
              className={
                medicacion.necesita_renovacion
                  ? "size-5 shrink-0 text-advertencia-fuerte"
                  : "size-5 shrink-0 text-muted-foreground"
              }
              aria-hidden="true"
            />
            <span
              className={
                medicacion.necesita_renovacion
                  ? "text-lg font-semibold text-advertencia-fuerte"
                  : "text-lg font-semibold text-foreground"
              }
            >
              {dias !== null
                ? `${dias} ${dias === 1 ? "día" : "días"} de stock`
                : `${textoDosis(medicacion.stock_units, medicacion.dose_unit)} en stock`}
            </span>
            {medicacion.necesita_renovacion && (
              <TriangleAlertIcon
                className="size-5 shrink-0 text-advertencia-fuerte"
                aria-hidden="true"
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {/* El adjetivo concuerda con la cantidad, igual que la unidad:
                "1 comprimido disponible", "90 comprimidos disponibles". */}
            {textoDosis(medicacion.stock_units, medicacion.dose_unit)}{" "}
            {medicacion.stock_units === 1 ? "disponible" : "disponibles"}
            {medicacion.fecha_estimada_fin && (
              <> · se acaba el {formatearFecha(medicacion.fecha_estimada_fin)}</>
            )}
          </p>
          {medicacion.necesita_renovacion && (
            <p className="text-sm font-medium text-advertencia-fuerte">
              Quedan pocos días — conviene pedir la renovación de la receta.
            </p>
          )}
        </div>
      ) : (
        <Alerta variante="info" estatica className="text-sm">
          Sin stock cargado. Editá la medicación para agregarlo y ver los días restantes.
        </Alerta>
      )}

      {medicacion.prescription_document_id && (
        <Link
          href={`/estudios/${medicacion.prescription_document_id}`}
          className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <FileTextIcon className="size-4 shrink-0" aria-hidden="true" />
          Ver receta
        </Link>
      )}

      {puedeEditar && (
        <AccionesMedicacionActiva medicacionId={medicacion.medication_id ?? ""} nombre={medicacion.name ?? ""} />
      )}
    </Tarjeta>
  )
}

export function TarjetaMedicacionSuspendida({
  medicacion,
  puedeEditar,
}: {
  medicacion: FilaMedicacion
  puedeEditar: boolean
}) {
  return (
    <Tarjeta className="gap-3 px-(--card-spacing) opacity-80">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-balance text-foreground">{medicacion.name}</h3>
        {medicacion.active_ingredient && (
          <p className="text-sm text-muted-foreground">{medicacion.active_ingredient}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {textoDosis(medicacion.dose_amount, medicacion.dose_unit)} —{" "}
          {textoFrecuencia(medicacion.frequency, medicacion.interval_hours)}
        </p>
        {medicacion.suspended_at && (
          <p className="text-sm text-muted-foreground">
            Suspendida el {formatearFecha(medicacion.suspended_at.slice(0, 10))}
          </p>
        )}
      </div>

      {puedeEditar && <BotonReactivar medicacionId={medicacion.id} />}
    </Tarjeta>
  )
}
