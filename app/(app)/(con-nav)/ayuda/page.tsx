/**
 * `/ayuda` — "¿Cómo empiezo?": la lista completa de los seis pasos del
 * tutorial de bienvenida, siempre consultable, más un mini-FAQ con las
 * preguntas que el usuario ya hizo en producción (tarea #14,
 * `docs/tutorial-bienvenida.md`).
 *
 * A diferencia del consejo contextual de `/inicio` -que muestra UNO solo, el
 * de mayor prioridad, y desaparece con "Ahora no"/"No mostrar más"- esta
 * pantalla muestra los SEIS SIEMPRE, con su estado real (✓ Hecho /
 * Pendiente), sin que el descarte los saque de la lista: es la referencia
 * completa, alcanzable desde el pie de cualquier pantalla
 * (`components/legal/pie-paginas-legales.tsx`) y desde un link dentro de
 * `/inicio`.
 *
 * Vive bajo `(con-nav)` -con header y bottom nav, como el resto de la
 * app con sesión- aunque su contenido no dependa del perfil ACTIVO en
 * absoluto: los seis pasos son de la CUENTA (mismo criterio que la card de
 * Gmail y que el resto del tutorial), así que esta pantalla se ve igual sin
 * importar a quién se esté mirando.
 */

import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"

import { CircleHelpIcon } from "lucide-react"

import { ListaPasosAyuda } from "@/components/ayuda/lista-pasos"
import { resolverEstadoPasos } from "@/lib/consejos/servidor"
import { requerirSesion } from "@/lib/auth/guardas"

export const metadata: Metadata = {
  title: "¿Cómo empiezo? — Historial Médico",
}

export default async function PaginaAyuda() {
  const { usuario, supabase } = await requerirSesion({ desde: "/ayuda" })

  const condicionesServidor = await resolverEstadoPasos(supabase, usuario.id)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 chica:gap-5 chica:py-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 chica:gap-2">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-9">
            <CircleHelpIcon className="size-5 chica:size-4.5" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            ¿Cómo empiezo?
          </h1>
        </div>
        <p className="text-base text-muted-foreground">
          Seis pasos para aprovechar Historial Médico al máximo. Hacelos en el orden que quieras,
          y a tu ritmo: la aplicación funciona igual aunque dejes alguno para después.
        </p>
      </div>

      <section aria-labelledby="titulo-pasos" className="flex flex-col gap-3 chica:gap-2">
        <h2 id="titulo-pasos" className="sr-only">
          Los seis pasos
        </h2>
        <ListaPasosAyuda condicionesServidor={condicionesServidor} perfilPropioId={condicionesServidor.perfilPropioId} />
      </section>

      <PreguntasFrecuentes />
    </div>
  )
}

interface Pregunta {
  id: string
  pregunta: string
  respuesta: ReactNode
}

const PREGUNTAS: Pregunta[] = [
  {
    id: "que-lee-gmail",
    pregunta: "¿Qué lee la aplicación de mi Gmail?",
    respuesta: (
      <>
        <p>
          Solo mira los correos que vos etiquetaste (o que la aplicación etiquetó sola, la
          primera vez que conectaste tu cuenta) con la etiqueta <strong>historialmedico</strong>.
          El resto de tu casilla queda completamente afuera: la aplicación nunca busca en tu
          bandeja de entrada entera.
        </p>
        <p>
          De esos correos etiquetados, guarda solo datos básicos -de quién es, el asunto y la
          fecha-, nunca el texto del mensaje. Cuando entrás a revisar un correo puntual, ahí sí
          se vuelve a pedir el contenido para mostrártelo, y se descarta apenas terminás: no
          queda guardado en ningún lado.
        </p>
      </>
    ),
  },
  {
    id: "conexion-de-tu-cuenta",
    pregunta: "¿Qué significa que \"la conexión es de tu cuenta\"?",
    respuesta: (
      <p>
        Tu Gmail se conecta UNA vez, a tu cuenta de Historial Médico -no a un perfil en
        particular-. Si administrás el historial de varias personas (por ejemplo tu papá y el
        tuyo), la misma conexión sirve para las dos: no hace falta conectar Gmail de nuevo cada
        vez que cambiás de perfil, y los correos que lleguen se pueden derivar al perfil que
        corresponda en cada caso.
      </p>
    ),
  },
  {
    id: "carga-automatica",
    pregunta: "¿Cómo funciona la carga automática, y cómo se deshace?",
    respuesta: (
      <>
        <p>
          Es un interruptor aparte, apagado por defecto, que activás vos desde{" "}
          <Link href="/perfil/gmail" className="font-medium text-primary underline-offset-4 hover:underline">
            Tu Gmail
          </Link>
          . Con el interruptor prendido, un estudio o un turno que llega por correo se carga solo
          únicamente cuando NO hay ninguna duda de a quién pertenece y de qué se trata; ante la
          mínima duda -por ejemplo, si el correo no dice el nombre del paciente-, queda esperando
          tu revisión, como siempre.
        </p>
        <p>
          Todo lo que entró solo aparece en una sección aparte, “Cargados automáticamente”, en{" "}
          <Link href="/perfil/gmail" className="font-medium text-primary underline-offset-4 hover:underline">
            Tu Gmail
          </Link>
          , con un botón <strong>Deshacer</strong> en cada ítem: lo saca del historial con un
          toque, sin dejar rastro.
        </p>
      </>
    ),
  },
  {
    id: "perfil-gestionado-y-graduacion",
    pregunta: "¿Qué es un perfil gestionado, y qué es \"la graduación\"?",
    respuesta: (
      <>
        <p>
          Un <strong>perfil gestionado</strong> es el historial de alguien que no tiene cuenta ni
          teléfono propio -un padre mayor, un hijo chico-: vos lo creás desde{" "}
          <Link href="/familia#crear-perfil-gestionado" className="font-medium text-primary underline-offset-4 hover:underline">
            Familia
          </Link>{" "}
          y administrás sus datos igual que los tuyos, sin que esa persona tenga que instalar
          nada ni recordar ninguna contraseña.
        </p>
        <p>
          La <strong>graduación</strong> es el paso siguiente, para cuando esa persona ya puede
          manejarse sola: le das un correo y una contraseña propios desde la sección “Familia” de
          su perfil, y a partir de ahí entra por su cuenta. Vos podés seguir teniendo acceso a su
          historial si ella te lo otorga, igual que con cualquier otro familiar.
        </p>
      </>
    ),
  },
]

function PreguntasFrecuentes() {
  return (
    <section aria-labelledby="titulo-faq" className="flex flex-col gap-3 chica:gap-2">
      <h2 id="titulo-faq" className="text-lg font-semibold text-foreground">
        Preguntas frecuentes
      </h2>
      <div className="flex flex-col gap-2">
        {PREGUNTAS.map((item) => (
          <details
            key={item.id}
            className="group rounded-xl border border-border bg-card px-4 py-3 open:pb-4"
          >
            <summary className="flex min-h-tactil cursor-pointer list-none items-center justify-between gap-3 text-base font-medium text-foreground marker:content-none chica:min-h-0 chica:py-1">
              {item.pregunta}
              <span
                aria-hidden="true"
                className="shrink-0 text-xl text-muted-foreground transition-transform duration-[var(--duracion-media)] group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
              {item.respuesta}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
