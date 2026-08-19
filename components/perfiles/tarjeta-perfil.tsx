"use client"

/**
 * Tarjeta interactiva de un perfil en el selector "estilo Netflix"
 * (`components/perfiles/selector-perfiles.tsx`, que sigue siendo Server
 * Component: solo esta tarjeta -el `<form>` y su botón- se separó a un
 * Client Component mínimo, a propósito, para no perder el resto del árbol
 * como Server Component).
 *
 * ## Por qué existe este archivo (feedback de espera + guardia anti doble-envío)
 *
 * Hasta acá la tarjeta era un `<button type="submit">` sin ningún estado:
 * tocarla no mostraba NADA mientras `elegirPerfil` -que valida consentimiento,
 * revalida el permiso contra la base y audita `access_logs`- viajaba al
 * servidor y volvía (P0 de rendimiento medido en producción, 2026-08-18:
 * cuentas nuevas veían hasta ~3s antes de los fixes de `cache()` en
 * `lib/auth/guardas.ts` y de la región `pdx1` en `vercel.json`; después de
 * esos dos fixes la espera baja pero sigue sin ser cero). Sin señal visual,
 * la persona volvía a tocar creyendo que la app "no entraba".
 *
 * Dos piezas resuelven eso:
 *
 * 1. **`useFormStatus`** (en `BotonTarjetaPerfil`, más abajo): mientras la
 *    Server Action está en vuelo, la tarjeta se atenúa, cambia el avatar por
 *    un spinner, reemplaza el badge por "Entrando…" y queda `aria-busy` +
 *    `disabled`. Tiene que vivir en un componente HIJO del `<form>`
 *    -`useFormStatus` no ve el estado del `<form>` que lo contiene a ÉL
 *    mismo, solo el de un ancestro-, de ahí el split en dos componentes.
 * 2. **`enviandoRef`** (guardia anti doble-envío, mismo patrón canónico que
 *    `components/familia/formulario-crear-gestionado.tsx`): `elegirPerfil`
 *    es un `<form action>` CRUDO, sin `useActionState` -no hace falta manejar
 *    ningún estado de error acá, solo elegir y navegar-, y el inventario del
 *    commit "Blindaje anti doble-envío" (2026-08-18) dejó DEMOSTRADO que la
 *    cola que evita que un segundo `submit` corra en paralelo es una
 *    prestación de `useActionState`, no de `<form action>` a secas: sin el
 *    hook, dos `submit` sincrónicos -un doble toque justo en la ventana de
 *    latencia que el punto 1 hace más visible, no menos probable- viajan en
 *    DOS peticiones reales, y `fijarPerfilActivo` (`lib/perfil-activo.ts`,
 *    que audita `ver_perfil` en `access_logs`) deja DOS filas por un solo
 *    toque humano. El `disabled` de `useFormStatus` llega recién en el
 *    PRÓXIMO render -hay una ventana real entre el primer toque y el
 *    segundo-, así que el `ref` se fija SINCRÓNICAMENTE en el propio evento
 *    `onSubmit`, antes de que React llegue a re-renderizar.
 *
 *    No hace falta liberar el `ref` en un `useEffect`: a diferencia de
 *    `crearPerfilGestionado` -que nunca redirige-, `elegirPerfil` SIEMPRE
 *    termina en un `redirect()` (a `/inicio`, o de vuelta a `/perfiles` si el
 *    permiso se perdió justo en esa ventana), así que la tarjeta se desmonta
 *    al terminar. La única salida sin `redirect()` es una excepción DISTINTA
 *    de `ErrorGuarda` -un bug real, no un caso de negocio-, y ahí que el
 *    botón quede deshabilitado hasta la próxima navegación es lo correcto:
 *    no hay ningún estado sano al que volver dentro de esta misma tarjeta.
 */

import { useRef, type FormEvent, type ReactNode } from "react"
import { useFormStatus } from "react-dom"

import { EyeIcon, Loader2Icon, ShieldCheckIcon, UploadIcon, UserRoundIcon } from "lucide-react"

import { elegirPerfil } from "@/app/(app)/(sin-nav)/perfiles/actions"
import { colorAvatarPara, inicialesDe } from "@/lib/perfiles/avatar"
import { cn } from "@/lib/utils"
import type { Perfil } from "@/types/dominio"

export interface PerfilConRelacion {
  perfil: Perfil
  /** El actor es el titular con cuenta de este perfil. */
  esPropio: boolean
  canUpload: boolean
  canManage: boolean
}

export function TarjetaPerfil({ perfil, esPropio, canUpload, canManage }: PerfilConRelacion) {
  // Guardia anti doble-envío: ver el comentario de cabecera del archivo para
  // el porqué (mismo patrón canónico que `formulario-crear-gestionado.tsx`).
  const enviandoRef = useRef(false)

  function bloquearEnvioDuplicado(evento: FormEvent<HTMLFormElement>) {
    if (enviandoRef.current) {
      evento.preventDefault()
      return
    }
    enviandoRef.current = true
  }

  return (
    <form onSubmit={bloquearEnvioDuplicado} action={elegirPerfil.bind(null, perfil.id)}>
      <BotonTarjetaPerfil
        perfil={perfil}
        esPropio={esPropio}
        canUpload={canUpload}
        canManage={canManage}
      />
    </form>
  )
}

function BotonTarjetaPerfil({
  perfil,
  esPropio,
  canUpload,
  canManage,
}: PerfilConRelacion) {
  // Ver el comentario de cabecera del archivo: esto es lo que hace visible
  // el estado pendiente. Solo funciona por vivir en un componente hijo del
  // `<form>` de arriba, nunca en el mismo componente que lo renderiza.
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "flex w-full min-h-48 flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-suave",
        "transition-[transform,box-shadow,opacity] duration-[var(--duracion-media)] ease-salida",
        "hover:-translate-y-0.5 hover:border-primary hover:shadow-elevada",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        // Estado pendiente: atenuada y con cursor de espera, sin mover el
        // layout -el piso táctil y el tamaño no cambian, solo la opacidad y
        // el contenido interno-. `disabled:` no pisa el `hover:` de arriba
        // porque un botón deshabilitado no puede recibir `:hover` de verdad,
        // pero se anulan igual por las dudas de un dispositivo con mouse.
        "disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-border disabled:hover:shadow-suave",
        // Modo chica (Sprint 13, tarea 13.2): perfiles más chicos -menos
        // padding, avatar más chico, menor alto mínimo- para que entren más
        // sin scroll. El nombre y el badge de relación no se tocan: siguen
        // completos, solo el aire alrededor se aprieta.
        "chica:min-h-36 chica:gap-2.5 chica:p-5",
      )}
    >
      <span
        className={cn(
          "flex size-24 shrink-0 items-center justify-center rounded-full text-3xl font-semibold text-avatar-foreground",
          "chica:size-16 chica:text-xl",
          colorAvatarPara(perfil.id),
        )}
        aria-hidden="true"
      >
        {pending ? (
          <Loader2Icon className="size-8 animate-spin chica:size-6" aria-hidden="true" />
        ) : (
          inicialesDe(perfil.full_name)
        )}
      </span>

      <span className="text-xl font-semibold text-balance text-foreground sm:text-2xl">
        {perfil.full_name}
      </span>

      <div className="flex flex-col items-center gap-1">
        {pending ? (
          <span className="text-sm font-medium text-muted-foreground">Entrando…</span>
        ) : (
          <>
            <BadgeRelacion esPropio={esPropio} canUpload={canUpload} canManage={canManage} />
            {perfil.user_id === null && (
              <span className="text-xs text-muted-foreground">Sin cuenta propia</span>
            )}
          </>
        )}
      </div>
    </button>
  )
}

function BadgeRelacion({
  esPropio,
  canUpload,
  canManage,
}: Pick<PerfilConRelacion, "esPropio" | "canUpload" | "canManage">) {
  if (esPropio) {
    return (
      <Badge icono={<UserRoundIcon className="size-3.5" aria-hidden="true" />} tono="primary">
        Tu perfil
      </Badge>
    )
  }
  if (canManage) {
    return (
      <Badge icono={<ShieldCheckIcon className="size-3.5" aria-hidden="true" />} tono="neutro">
        Gestionado por vos
      </Badge>
    )
  }
  if (canUpload) {
    return (
      <Badge icono={<UploadIcon className="size-3.5" aria-hidden="true" />} tono="neutro">
        Podés cargar datos
      </Badge>
    )
  }
  return (
    <Badge icono={<EyeIcon className="size-3.5" aria-hidden="true" />} tono="apagado">
      Solo lectura
    </Badge>
  )
}

function Badge({
  children,
  icono,
  tono,
}: {
  children: ReactNode
  icono: ReactNode
  tono: "primary" | "neutro" | "apagado"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        tono === "primary" && "bg-primary/10 text-primary",
        tono === "neutro" && "bg-muted text-foreground",
        tono === "apagado" && "bg-muted text-muted-foreground",
      )}
    >
      {icono}
      {children}
    </span>
  )
}
