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
import { cn } from "@/lib/utils"
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
    <ul className="flex flex-wrap gap-1.5 chica:gap-1">
      {horarios.map((hora) => (
        <li
          key={hora}
          className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-foreground chica:px-2 chica:py-0.5 chica:text-xs"
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
    <Tarjeta className="gap-4 px-(--card-spacing) chica:gap-0">
      {/* ======================================================================
          GRANDE: el markup de las tareas 7.2/7.5, SIN NINGÚN CAMBIO -docs/densidad.md
          §4 regla 1-. Se envuelve en `chica:hidden` en vez de tocarlo, para que
          un diff de esta tanda se lea de un vistazo como "cero cambios acá". */}
      <div className="flex flex-col gap-4 chica:hidden">
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            {/* h2 y no h3 (Sprint 11, auditoría a11y): el único h2 de
                `/medicacion` es "Tomas de hoy", que `SeccionTomasDeHoy` no
                renderiza cuando no hay dosis programadas para hoy -caso
                frecuente-, y ahí el h3 saltaba un nivel desde el h1 (WCAG
                1.3.1). Como h2 la jerarquía cierra en los dos casos. */}
            <h2 className="text-lg font-semibold text-balance text-foreground">{medicacion.name}</h2>
            {!medicacion.vigente_hoy && (
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                No vigente hoy
              </span>
            )}
          </div>

          {medicacion.active_ingredient && (
            <p className="text-sm text-muted-foreground">{medicacion.active_ingredient}</p>
          )}
          {medicacion.presentation && <p className="text-sm text-muted-foreground">{medicacion.presentation}</p>}
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

        {/* Stock y días restantes: el dato prominente de la tarjeta (criterio
            de aceptación del ROADMAP). */}
        {medicacion.stock_units !== null ? (
          <div
            className={cn(
              "flex flex-col gap-1 rounded-lg border px-4 py-3",
              medicacion.necesita_renovacion
                ? "border-advertencia/40 bg-advertencia-suave"
                : "border-border bg-muted",
            )}
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
                <TriangleAlertIcon className="size-5 shrink-0 text-advertencia-fuerte" aria-hidden="true" />
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
      </div>

      {/* ======================================================================
          CHICA (Sprint 14, tanda A): fila densa de 3 renglones + acciones,
          en vez de las 4 secciones apiladas de arriba (encabezado, dosis,
          panel de stock con su propio borde, link de receta). Ningún dato se
          saca -docs/densidad.md §4 regla 5-, se REACOMODA:
            L1 nombre + badges (No vigente hoy / N días) a la derecha
            L2 droga · presentación · dosis — frecuencia, envolvente (nunca
               `truncate`/`line-clamp`: son datos clínicos, mismo criterio
               que `banner-alerta.tsx`)
            L3 chips de horario + stock resumido
            L4 (solo si aplica) el aviso de renovación, que NUNCA se oculta
            pie: "Ver receta" (ícono) + Editar/Suspender (íconos de 40px,
                 `acciones-medicacion.tsx`) */}
      <div className="hidden flex-col gap-1.5 chica:flex">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 flex-1 text-base font-semibold text-balance text-foreground">
            {medicacion.name}
          </h2>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {!medicacion.vigente_hoy && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                No vigente hoy
              </span>
            )}
            {dias !== null && (
              <span
                className={cn(
                  "numeros-clinicos rounded-full px-2 py-0.5 text-xs font-semibold",
                  medicacion.necesita_renovacion
                    ? "bg-advertencia text-advertencia-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {dias} {dias === 1 ? "día" : "días"}
              </span>
            )}
          </div>
        </div>

        {(medicacion.active_ingredient || medicacion.presentation || medicacion.dose_amount !== null) && (
          <p className="text-xs text-muted-foreground">
            {[medicacion.active_ingredient, medicacion.presentation].filter(Boolean).join(" · ")}
            {(medicacion.active_ingredient || medicacion.presentation) && " · "}
            {textoDosis(medicacion.dose_amount, medicacion.dose_unit)} —{" "}
            {textoFrecuencia(medicacion.frequency, medicacion.interval_hours)}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {medicacion.frequency === "daily" && <ChipsHorarios horarios={medicacion.schedule_times} />}
          {medicacion.stock_units !== null ? (
            <span className="numeros-clinicos text-xs text-muted-foreground">
              {/* "disp." no concuerda en número a propósito -es una
                  abreviatura fija, no la palabra "disponible(s)" completa
                  que sí flexiona en el bloque de grande de más arriba-. */}
              {textoDosis(medicacion.stock_units, medicacion.dose_unit)} disp.
              {medicacion.fecha_estimada_fin && <> · vence {formatearFecha(medicacion.fecha_estimada_fin)}</>}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Sin stock cargado</span>
          )}
        </div>

        {medicacion.necesita_renovacion && (
          <p className="text-xs font-medium text-advertencia-fuerte">
            Quedan pocos días — conviene pedir la renovación de la receta.
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          {medicacion.prescription_document_id ? (
            <Link
              href={`/estudios/${medicacion.prescription_document_id}`}
              aria-label="Ver receta"
              className="flex size-tactil shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground transition-colors hover:bg-muted"
            >
              <FileTextIcon className="size-4.5 shrink-0" aria-hidden="true" />
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}

          {puedeEditar && (
            <AccionesMedicacionActiva medicacionId={medicacion.medication_id ?? ""} nombre={medicacion.name ?? ""} />
          )}
        </div>
      </div>
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
    <Tarjeta className="gap-3 px-(--card-spacing) opacity-80 chica:gap-1.5">
      {/* Grande: sin cambios. Misma corrección de nivel que la tarjeta
          activa, para la sección colapsable "Suspendidas" (que es un
          <button>, no un encabezado). */}
      <div className="flex flex-col gap-1 chica:hidden">
        <h2 className="text-base font-semibold text-balance text-foreground">{medicacion.name}</h2>
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

      {/* Chica (Sprint 14, tanda A): droga + dosis-frecuencia combinadas en
          UN renglón (mismo patrón que la tarjeta activa), fecha de
          suspensión conservada entera -docs/densidad.md §4 regla 5-: de
          hasta 4 renglones de texto propios pasa a 2. */}
      <div className="hidden flex-col gap-0.5 chica:flex">
        <h2 className="text-base font-semibold text-balance text-foreground">{medicacion.name}</h2>
        <p className="text-xs text-muted-foreground">
          {medicacion.active_ingredient && `${medicacion.active_ingredient} · `}
          {textoDosis(medicacion.dose_amount, medicacion.dose_unit)} —{" "}
          {textoFrecuencia(medicacion.frequency, medicacion.interval_hours)}
        </p>
        {medicacion.suspended_at && (
          <p className="text-xs text-muted-foreground">
            Suspendida el {formatearFecha(medicacion.suspended_at.slice(0, 10))}
          </p>
        )}
      </div>

      {puedeEditar && <BotonReactivar medicacionId={medicacion.id} nombre={medicacion.name} />}
    </Tarjeta>
  )
}
