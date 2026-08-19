/**
 * Grilla del selector de perfiles ("estilo Netflix"): una tarjeta grande por
 * perfil visible, con avatar de iniciales, nombre en tipografía grande y un
 * badge que explica la relación con ese perfil.
 *
 * Server Component: arma la grilla y le pasa a cada tarjeta sus datos ya
 * resueltos (`app/(app)/(sin-nav)/perfiles/page.tsx` hace las consultas). La
 * tarjeta en sí -el `<form>` con la Server Action `elegirPerfil` bindeada,
 * más el estado pendiente y la guardia anti doble-envío- vive en
 * `components/perfiles/tarjeta-perfil.tsx` como un Client Component mínimo:
 * ver el comentario de cabecera de ese archivo para el porqué (necesita
 * `useFormStatus`, que exige un componente cliente, pero no hay motivo para
 * arrastrar el resto de esta grilla -ni la consulta que la alimenta- al
 * cliente por eso).
 *
 * Senior UX: tarjetas grandes (bastante más que el mínimo de 48×48px),
 * tipografía de nombre en `text-xl`/`text-2xl`, sin animación de entrada ni
 * micro-interacciones de más -la única señal de interactividad en reposo es
 * un levantamiento sutil al pasar el mouse y un retroceso al presionar-.
 *
 * ## Distinción de "perfil gestionado" (Sprint 15, tarea 15.1)
 *
 * `BadgeRelacion` (esPropio/canUpload/canManage) contesta "¿qué podés hacer
 * vos con este perfil?" -y ya decía "Gestionado por vos" para un
 * `can_manage` que no es el tuyo, sea o no el perfil gestionado-.
 * `perfil.user_id === null` contesta una pregunta DISTINTA: "¿esta persona
 * tiene cuenta propia, o depende de que alguien entre a mirar sus datos?".
 * Las dos pueden divergir -un `can_manage` sobre un perfil CON cuenta
 * también existe (docs/modelo-permisos.md §4.3)-, así que se muestran como
 * dos señales separadas: la segunda, un subtítulo chico y discreto, nunca
 * reemplaza a la primera. Texto neutro a propósito -"sin cuenta propia", no
 * "niño" ni "adulto mayor"-: el mismo mecanismo sirve para los dos casos.
 * (Las dos señales viven en `tarjeta-perfil.tsx`, junto con el resto del
 * contenido de la tarjeta.)
 */

import { TarjetaPerfil, type PerfilConRelacion } from "@/components/perfiles/tarjeta-perfil"

export type { PerfilConRelacion }

interface SelectorPerfilesProps {
  perfiles: PerfilConRelacion[]
}

export function SelectorPerfiles({ perfiles }: SelectorPerfilesProps) {
  if (perfiles.length === 0) {
    return (
      <p className="max-w-md text-center text-base text-muted-foreground">
        Todavía no hay perfiles disponibles para tu cuenta. Si esperabas ver
        uno, pedile a quien te invitó que revise tu acceso.
      </p>
    )
  }

  return (
    <div className="grid w-full max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2 chica:gap-3">
      {perfiles.map((entrada) => (
        <TarjetaPerfil key={entrada.perfil.id} {...entrada} />
      ))}
    </div>
  )
}
