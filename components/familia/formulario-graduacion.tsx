"use client"

/**
 * "Darle su propia cuenta" (Sprint 15, tarea 15.2): el formulario con el que
 * el creador de un perfil gestionado lo GRADÚA — le crea una cuenta y le
 * entrega el control de su historial (`docs/modelo-permisos.md` §8.6).
 *
 * ## La explicación no es decorativa
 *
 * Es la operación menos reversible del producto: al terminar, quien la
 * ejecutó **deja de tener la autoridad de otorgamiento** sobre ese perfil
 * -las notas ⚑ de §4.4 dejan de aplicar apenas `user_id` deja de ser NULL- y
 * el nuevo titular puede quitarle el acceso. No hay "deshacer". Por eso las
 * tres consecuencias se enumeran ANTES del formulario, en castellano llano y
 * en segunda persona, en vez de esconderlas en una nota al pie:
 *
 *   1. esa persona va a entrar con SU correo;
 *   2. tus accesos actuales se mantienen tal cual;
 *   3. desde entonces es ella quien decide si los conserva.
 *
 * El checkbox de confirmación es el mismo patrón que `confirmoRepresentante`
 * en `formulario-crear-gestionado.tsx` y `aceptaLegales` en `/registro`: sin
 * marcar por defecto, `required` para el feedback inmediato del navegador y
 * revalidado del lado del servidor por `graduarPerfilGestionado`, que es la
 * defensa real.
 *
 * ## Cómo se avisa el éxito, y por qué costó
 *
 * A diferencia de `FormularioCrearGestionado` -donde el éxito deja el
 * formulario listo para cargar a otra persona-, acá el éxito es TERMINAL: el
 * perfil deja de ser gestionado y `SeccionGraduacion` (`/familia`) deja de
 * renderizarse. Si la Server Action llamara a `revalidatePath`, React
 * desmontaría este componente en el MISMO commit en el que llega su mensaje y
 * el aviso no se vería nunca — pasó en el teléfono, dos veces, y quien acababa
 * de graduar a su hijo se quedaba sin saber si había funcionado. Por eso
 * `graduarPerfilGestionado` no revalida nada, y el porqué completo (incluido
 * por qué no hace falta) está documentado ahí.
 *
 * Con la sección viva, el resultado se muestra en dos lugares que no compiten:
 *
 * - la `<Alerta>` inline, con el mensaje completo -el correo con el que esa
 *   persona va a entrar y el recordatorio de que cambie la contraseña-, justo
 *   donde estaba el botón que se acaba de tocar;
 * - un toast corto (`sonner`, el `<Toaster />` vive en
 *   `app/(app)/(con-nav)/layout.tsx`, `position="top-center"`), que aparece
 *   arriba de todo aunque la pantalla esté scrolleada en otra parte y que,
 *   por estar portaleado fuera de este árbol, sobrevive si algún día esta
 *   sección sí se desmonta.
 *
 * La contraseña inicial es un dato de tránsito: se la pasa en mano quien
 * gradúa y el nuevo titular la cambia con el flujo de recupero existente.
 * Los dos campos usan `autoComplete="new-password"` para que el gestor de
 * contraseñas del navegador no ofrezca las del creador ni guarde estas como
 * suyas.
 */

import { useEffect } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { KeyRoundIcon } from "lucide-react"
import { toast } from "sonner"

import {
  graduarPerfilGestionado,
  type EstadoGraduacion,
} from "@/app/(app)/(con-nav)/familia/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoTexto } from "@/components/base/campo-texto"
import { Checkbox } from "@/components/ui/checkbox"

const ESTADO_INICIAL: EstadoGraduacion = { error: null, mensaje: null }

export function FormularioGraduacion({
  perfilId,
  perfilNombre,
}: {
  perfilId: string
  perfilNombre: string
}) {
  const [estado, enviarAccion] = useActionState(graduarPerfilGestionado, ESTADO_INICIAL)

  const exito = Boolean(estado.mensaje) && !estado.error

  // El toast se dispara ANTES de que la revalidación desmonte esta sección
  // -ver el encabezado del archivo-. `sonner` lo mantiene vivo desde el
  // `<Toaster />` del layout, que no está en este árbol.
  useEffect(() => {
    if (!exito) return
    // Corto a propósito: el detalle -el correo, el recordatorio de cambiar la
    // contraseña- está en la `<Alerta>` de abajo, que queda en pantalla.
    // Repetirlo acá sería el mismo párrafo dos veces.
    toast.success(`${perfilNombre} ya tiene su propia cuenta`, { duration: 12000 })
  }, [exito, perfilNombre])

  if (exito) {
    return <Alerta variante="exito">{estado.mensaje}</Alerta>
  }

  return (
    <form
      action={enviarAccion}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-suave chica:gap-2.5 chica:p-3"
    >
      <input type="hidden" name="perfilId" value={perfilId} />

      <div className="flex flex-col gap-2 text-base leading-relaxed text-muted-foreground chica:gap-1.5 chica:text-sm">
        <p>
          Elegí el correo con el que va a entrar{" "}
          <strong className="text-foreground">{perfilNombre}</strong> y una contraseña para
          la primera vez. Después se la cambia solo/a, desde &laquo;Olvidé mi
          contraseña&raquo;.
        </p>
      </div>

      <CampoTexto
        id="graduacion-email"
        name="email"
        label="Correo electrónico"
        type="email"
        required
        autoComplete="off"
        inputMode="email"
        placeholder="nombre@correo.com"
        ayuda="Tiene que ser un correo al que esa persona pueda entrar."
      />

      <CampoTexto
        id="graduacion-password"
        name="password"
        label="Contraseña inicial"
        type="password"
        required
        autoComplete="new-password"
        ayuda="Mínimo 8 caracteres. Se la vas a decir vos."
      />

      <CampoTexto
        id="graduacion-confirmar"
        name="confirmarPassword"
        label="Repetir la contraseña"
        type="password"
        required
        autoComplete="new-password"
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3 chica:gap-1.5 chica:p-2">
        <p className="text-sm font-medium text-foreground">Qué cambia a partir de ahora</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            {perfilNombre} va a entrar con ese correo y su historial pasa a ser suyo, con
            todo lo que ya está cargado.
          </li>
          <li>Los accesos que hay hoy —el tuyo incluido— se mantienen tal cual.</li>
          <li>
            Desde entonces es {perfilNombre} quien decide quién los conserva, y puede
            quitarte el tuyo.
          </li>
          <li>Esta acción no se puede deshacer.</li>
        </ul>
        <label className="flex items-start gap-2.5 text-sm chica:gap-2">
          <Checkbox name="confirmoGraduacion" required aria-required="true" className="mt-0.5" />
          <span className="text-foreground">
            Entiendo qué cambia y quiero darle su propia cuenta a {perfilNombre}.
          </span>
        </label>
      </div>

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <BotonGraduar />
    </form>
  )
}

function BotonGraduar() {
  const { pending } = useFormStatus()

  return (
    <Boton type="submit" cargando={pending} className="gap-2">
      {!pending && <KeyRoundIcon className="size-4" aria-hidden="true" />}
      {pending ? "Creando la cuenta…" : "Darle su propia cuenta"}
    </Boton>
  )
}
