/**
 * Selector de PERFIL DE DESTINO para un archivo recibido por Web Share
 * Target (Sprint 11, tarea 11.2). Mismo espíritu visual que
 * `components/perfiles/selector-perfiles.tsx` (tarjetas grandes, un `<form>`
 * por tarjeta con la Server Action bindeada, feedback pendiente + guardia
 * anti doble-envío), pero con dos diferencias a propósito:
 *
 * - Solo lista perfiles donde la sesión puede cargar (`canUpload`): a
 *   diferencia del selector de perfiles del Sprint 2 -que muestra TODOS los
 *   perfiles visibles, incluidos los de solo lectura, porque ahí la acción es
 *   "entrar a mirar"-, acá la acción es "cargar un documento", así que un
 *   perfil de solo lectura no tiene sentido como destino. Si la lista queda
 *   vacía, se explica por qué en vez de mostrar una grilla en blanco.
 * - El badge nunca puede decir "Solo lectura" (por construcción, todos los
 *   perfiles que llegan acá ya tienen `canUpload`), así que se simplifica a
 *   "Tu perfil" / "Gestionado por vos" / "Podés cargar datos".
 *
 * Server Component: arma la grilla y le pasa a cada tarjeta sus datos ya
 * resueltos. La tarjeta en sí -el `<form>` con `elegirPerfilParaCompartido`
 * bindeada, el estado pendiente vía `useFormStatus` y la guardia anti
 * doble-envío- vive en `components/compartir/tarjeta-destino.tsx` como
 * Client Component mínimo: mismo split, y el mismo motivo, que
 * `components/perfiles/tarjeta-perfil.tsx`.
 *
 * ## Modo chica (Sprint 13, tarea 13.6)
 *
 * Mismo patrón que `components/perfiles/tarjeta-perfil.tsx`: tarjetas más
 * chicas -menos padding, avatar más chico- sin sacar el nombre ni el badge
 * de relación, que siguen completos.
 */

import { TarjetaDestino, type PerfilDestino } from "@/components/compartir/tarjeta-destino"

export type { PerfilDestino }

export interface SelectorDestinoProps {
  /** Id de la fila de `shared_uploads_temp` que se está por mover. */
  archivoId: string
  perfiles: PerfilDestino[]
  /**
   * Perfil que ya mostró el aviso de duplicado (hotfix de huella digital,
   * Sprint 17 en vivo): SU tarjeta agrega un campo oculto `forzar=1`, así que
   * tocarla de nuevo carga el archivo igual en vez de repetir el aviso.
   * `null` en el caso normal (sin duplicado detectado todavía).
   */
  forzarPerfilId?: string | null
}

export function SelectorDestino({ archivoId, perfiles, forzarPerfilId = null }: SelectorDestinoProps) {
  if (perfiles.length === 0) {
    return (
      <p className="max-w-md text-base text-muted-foreground">
        No tenés ningún perfil donde puedas cargar documentos. Pedile a quien administra el perfil
        que corresponde que te dé permiso de carga, o subí el archivo desde tu propio perfil en
        &ldquo;Estudios&rdquo;.
      </p>
    )
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 chica:gap-3">
      {perfiles.map((entrada) => (
        <TarjetaDestino
          key={entrada.perfil.id}
          archivoId={archivoId}
          forzar={entrada.perfil.id === forzarPerfilId}
          {...entrada}
        />
      ))}
    </div>
  )
}
