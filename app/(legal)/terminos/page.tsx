import type { Metadata } from "next"

import { VERSION_LEGALES } from "@/lib/legales"

export const metadata: Metadata = {
  title: "Términos y Condiciones — Historial Médico",
}

const FECHA_VIGENCIA = "14 de agosto de 2026"

export default function PaginaTerminos() {
  return (
    <article className="flex flex-col gap-8 chica:gap-6">
      <header className="flex flex-col gap-2 chica:gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Términos y Condiciones
        </h1>
        <p className="text-base text-muted-foreground">
          Vigente desde el {FECHA_VIGENCIA} · versión{" "}
          <span className="font-mono">{VERSION_LEGALES}</span>
        </p>
      </header>

      <Seccion titulo="1. Quién ofrece este servicio">
        <p>
          Historial Médico es un proyecto personal de <strong>Darío Hernández</strong>,
          persona física domiciliada en Ushuaia, Tierra del Fuego, Argentina —no una
          empresa—. Al crear una cuenta, aceptás estos Términos junto con la{" "}
          <a href="/privacidad" className="font-medium text-primary underline-offset-4 hover:underline">
            Política de Privacidad
          </a>
          , que forma parte de este mismo acuerdo.
        </p>
      </Seccion>

      <Seccion titulo="2. Qué es Historial Médico">
        <p>
          Es una aplicación de uso <strong>personal y familiar</strong> para organizar
          tu historial médico y el de las personas de tu familia cuyos datos
          administrás: documentos, medicación, turnos, signos vitales, coberturas y una
          ficha de emergencia. Es una herramienta de organización de información, no un
          servicio de salud.
        </p>
      </Seccion>

      <Seccion titulo="3. Esto no es un servicio médico">
        <p>
          Historial Médico <strong>no diagnostica, no indica tratamientos y no
          reemplaza la consulta con un profesional de la salud</strong>. Los resúmenes
          que arma con ayuda de inteligencia artificial son una ordenación de la
          información que vos mismo cargaste, pensada para llevar a una consulta —no
          una opinión médica, y así lo advierte la propia ficha cada vez que se genera—.
          Ante cualquier decisión de salud, la palabra que vale es la de un profesional
          matriculado, nunca la de esta aplicación.
        </p>
      </Seccion>

      <Seccion titulo="4. Tu cuenta">
        <p>
          Para usar la aplicación necesitás crear una cuenta con tu correo electrónico y
          una contraseña. Sos responsable de mantener tu contraseña a resguardo y de
          todo lo que ocurra desde tu cuenta. Si sospechás que alguien más accedió a
          ella, cambiá la contraseña de inmediato desde{" "}
          <code>/recuperar</code>.
        </p>
        <p>
          Tiene que haber una única cuenta por persona, con datos reales: no está
          permitido crear cuentas a nombre de otra persona sin su autorización.
        </p>
      </Seccion>

      <Seccion titulo="5. Perfiles gestionados: tu responsabilidad al administrar los datos de otra persona">
        <p>
          Si creás un perfil <strong>gestionado</strong> para una persona que no tiene
          su propia cuenta (por ejemplo, un familiar mayor), declarás que tenés su
          autorización o la relación familiar que te habilita a cargar y administrar sus
          datos de salud, y asumís la responsabilidad por la exactitud de lo que cargás
          en su nombre. Esa persona sigue siendo la titular de sus propios datos.
        </p>
        <p>
          Si le otorgás acceso a otra persona sobre un perfil desde{" "}
          <code>/familia</code>, hacelo únicamente sobre datos de personas que estás
          autorizado a compartir, y solo con quien corresponda: la pantalla te va a
          pedir una confirmación explícita antes de otorgarlo, precisamente porque es
          una decisión que tiene consecuencias reales sobre datos sensibles de otra
          persona.
        </p>
      </Seccion>

      <Seccion titulo="6. Uso aceptable">
        <p>Al usar Historial Médico, te comprometés a:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>no cargar datos de salud de terceros sin su consentimiento o sin la autorización que describe la sección 5;</li>
          <li>no usar la aplicación con fines ilícitos ni para intentar acceder a datos de perfiles sobre los que no tenés permiso;</li>
          <li>no intentar vulnerar, sobrecargar ni eludir los controles de seguridad de la aplicación.</li>
        </ul>
      </Seccion>

      <Seccion titulo="7. Disponibilidad del servicio">
        <p>
          Es un proyecto personal, no un servicio comercial con garantía de nivel de
          disponibilidad. Hacemos el mejor esfuerzo para mantenerlo funcionando de forma
          estable, pero no garantizamos disponibilidad ininterrumpida ni libre de
          errores. Podés exportar o borrar tus datos en cualquier momento desde la
          propia app, como se describe en la Política de Privacidad.
        </p>
      </Seccion>

      <Seccion titulo="8. Límites de responsabilidad">
        <p>
          La información generada por las funciones de inteligencia artificial
          (extracción de datos de documentos y resúmenes para consulta) puede contener
          errores: es una ayuda de organización sobre datos que vos mismo cargaste, no
          una verificación clínica independiente. Es tu responsabilidad revisar que lo
          que la aplicación extrajo o resumió coincida con el documento original antes
          de usarlo en una consulta.
        </p>
        <p>
          El responsable del proyecto no es responsable por decisiones de salud tomadas
          en base a la información cargada en la aplicación, ni por la exactitud de los
          datos que vos u otra persona autorizada hayan cargado. La aplicación es una
          herramienta de organización; el criterio médico siempre es humano y
          profesional.
        </p>
      </Seccion>

      <Seccion titulo="9. Cambios a estos Términos">
        <p>
          Si cambiamos estos Términos de forma sustancial, publicamos la nueva versión
          acá mismo con su fecha de vigencia actualizada. La versión que ves arriba (
          <span className="font-mono">{VERSION_LEGALES}</span>) es la que se registra
          como aceptada cuando creás tu cuenta hoy.
        </p>
      </Seccion>

      <Seccion titulo="10. Ley aplicable">
        <p>
          Estos Términos se rigen por las leyes de la República Argentina. Cualquier
          desacuerdo se somete a los tribunales competentes según tu domicilio, conforme
          a las normas de protección al consumidor aplicables.
        </p>
      </Seccion>
    </article>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 chica:gap-2">
      <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {titulo}
      </h2>
      <div className="flex flex-col gap-3 text-base leading-relaxed text-foreground/90 chica:gap-2">
        {children}
      </div>
    </section>
  )
}
