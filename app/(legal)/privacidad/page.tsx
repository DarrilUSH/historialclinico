import type { Metadata } from "next"

import { VERSION_LEGALES } from "@/lib/legales"

export const metadata: Metadata = {
  title: "Política de Privacidad — Historial Médico",
}

const FECHA_VIGENCIA = "14 de agosto de 2026"

export default function PaginaPrivacidad() {
  return (
    <article className="flex flex-col gap-8 chica:gap-6">
      <header className="flex flex-col gap-2 chica:gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Política de Privacidad
        </h1>
        <p className="text-base text-muted-foreground">
          Vigente desde el {FECHA_VIGENCIA} · versión{" "}
          <span className="font-mono">{VERSION_LEGALES}</span>
        </p>
      </header>

      <Seccion titulo="1. Quién es el responsable de tus datos">
        <p>
          Historial Médico es un proyecto personal de <strong>Darío Hernández</strong>,
          persona física, con domicilio en Ushuaia, Tierra del Fuego, Argentina. No es
          una empresa ni tiene una razón social distinta de su titular: quien toma las
          decisiones sobre cómo se tratan tus datos, y quien responde por ellas, es esa
          persona.
        </p>
        <p>
          Para cualquier consulta sobre esta política o para ejercer los derechos que se
          describen más abajo, escribí a{" "}
          <a href="mailto:claude2@legistdf.gob.ar" className="font-medium text-primary underline-offset-4 hover:underline">
            claude2@legistdf.gob.ar
          </a>
          . Es el mismo canal para todo: consultas, reclamos y pedidos de acceso,
          rectificación o supresión.
        </p>
      </Seccion>

      <Seccion titulo="2. Qué es Historial Médico y para qué usamos tus datos">
        <p>
          Historial Médico es una aplicación para que una persona o una familia lleve,
          en un solo lugar, su historial médico: documentos y estudios, medicación,
          turnos, signos vitales, coberturas y una ficha de emergencia. La finalidad
          declarada es exactamente esa: ayudarte a organizar y tener a mano tu propia
          información de salud y la de las personas de tu familia que vos administrás,
          y armar resúmenes claros para llevar a una consulta médica.
        </p>
        <p>No usamos tus datos para ninguna otra cosa. En particular, no los usamos para:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>publicidad, perfilado comercial ni venta a terceros;</li>
          <li>ningún fin distinto del que declara este documento, sin pedirte un consentimiento nuevo y específico para eso.</li>
        </ul>
      </Seccion>

      <Seccion titulo="3. Tus datos de salud son datos SENSIBLES">
        <p>
          La Ley 25.326 de Protección de los Datos Personales define como{" "}
          <strong>datos sensibles</strong> a los que revelan, entre otras cosas,
          información referente a la salud (art. 2). El art. 7 prohíbe en principio
          tratarlos, salvo cuando medien razones de interés general autorizadas por ley
          o cuando el titular dé su <strong>consentimiento</strong>. Toda la información
          que cargás en Historial Médico —documentos médicos, medicación, signos
          vitales, alergias, condiciones crónicas, la ficha de emergencia— es de esta
          categoría, y este proyecto la trata con esa exigencia como punto de partida,
          no como una formalidad.
        </p>
      </Seccion>

      <Seccion titulo="4. La base legal: tu consentimiento libre, expreso e informado">
        <p>
          Tratamos tus datos porque vos lo autorizás explícitamente, en dos momentos
          concretos de la aplicación:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Al crear tu cuenta</strong>, en <code>/registro</code>, marcando la
            casilla —sin marcar por defecto— que confirma que leíste esta Política de
            Privacidad y los Términos y Condiciones. El registro no se completa sin ese
            paso.
          </li>
          <li>
            <strong>Al otorgarle acceso a otra persona</strong> sobre los datos de un
            perfil, desde <code>/familia</code>: antes de otorgar el acceso, la pantalla
            te muestra en texto explícito de quién son los datos a los que vas a darle
            acceso, y tenés que confirmarlo aparte.
          </li>
        </ul>
        <p>
          Los dos consentimientos quedan registrados con fecha, hora, versión del
          documento aceptado e IP de origen, en un registro que ni siquiera nosotros
          podemos editar o borrar después: es la prueba de que el consentimiento
          existió, y con qué texto exacto.
        </p>
      </Seccion>

      <Seccion titulo="5. Qué datos guardamos">
        <p>Según lo que vos (o quien administra un perfil) carguen, guardamos:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>De tu cuenta:</strong> nombre completo y correo electrónico.</li>
          <li>
            <strong>De cada perfil</strong> (el tuyo y los de las personas que
            administrás): fecha de nacimiento, grupo sanguíneo, alergias, condiciones
            crónicas, medicación crítica, DNI y datos de contacto de emergencia —estos
            dos últimos solo si vos decidís cargarlos, para la ficha de emergencia—.
          </li>
          <li>
            <strong>Documentos médicos</strong> que subís (estudios, recetas, informes),
            con los datos que la aplicación extrae de ellos con ayuda de inteligencia
            artificial (ver sección 8).
          </li>
          <li><strong>Medicación</strong>: nombre, dosis, horarios y stock.</li>
          <li><strong>Signos vitales</strong> que registrás manualmente.</li>
          <li><strong>Turnos médicos</strong> y credenciales de coberturas de salud.</li>
          <li>
            <strong>Un registro de accesos</strong>: quién entró a los datos de cada
            perfil y cuándo, visible para el titular de esos datos desde la propia app
            (<code>/familia/accesos</code>) — es lo que te permite controlar quién vio
            qué.
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="6. Perfiles gestionados: cuando administrás los datos de otra persona">
        <p>
          Historial Médico permite crear perfiles <strong>gestionados</strong>: el
          historial de una persona (por ejemplo, un familiar mayor) que no tiene su
          propia cuenta, cargado y administrado por quien sí la tiene. Esa persona sigue
          siendo la <strong>titular</strong> de sus datos y de los derechos que se
          describen en la sección 9, aunque no pueda ejercerlos con su propio inicio de
          sesión: los ejerce a través de quien administra su perfil, que actúa por su
          cuenta y queda identificado en cada acceso que registra la aplicación.
        </p>
      </Seccion>

      <Seccion titulo="7. Con quién compartimos tus datos">
        <p>No vendemos ni cedemos tus datos a terceros. Los únicos que los procesan son:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Supabase</strong> (infraestructura de base de datos y almacenamiento
            de archivos), donde vive toda la información de la aplicación, protegida
            con controles de acceso a nivel de fila (cada perfil solo es visible para
            quien tiene permiso explícito sobre él) y con los archivos guardados en
            depósitos privados.
          </li>
          <li>
            <strong>Google</strong>, como proveedor de la API de Gemini, únicamente para
            las dos funciones de inteligencia artificial descriptas en la sección 8, y
            solo con los datos mínimos que esa función necesita.
          </li>
        </ul>
        <p>
          Ninguna otra persona ni servicio ve tus datos de salud sin que vos le hayas
          otorgado acceso explícito desde <code>/familia</code>.
        </p>
      </Seccion>

      <Seccion titulo="8. Uso de inteligencia artificial (Gemini)">
        <p>
          Usamos la API de Gemini (Google) para dos funciones puntuales: extraer datos
          estructurados de los documentos que subís (para no tener que tipearlos a
          mano) y armar un resumen en lenguaje claro para llevar a una consulta. Las dos
          son ayudas de organización, <strong>no</strong> generan ningún diagnóstico ni
          reemplazan a un profesional de la salud.
        </p>
        <p>
          Aplicamos el principio de <strong>minimización de datos</strong>: antes de
          mandar cualquier información a Gemini, la aplicación arma un paquete acotado a
          mano, campo por campo, con solo lo que puede cambiar el contenido clínico del
          resumen. Explícitamente <strong>no</strong> se manda tu nombre completo, tu
          DNI, tu teléfono, tu domicilio, el contacto de emergencia, el nombre del
          médico o de la institución que emitió un estudio, ni el texto crudo escaneado
          de los documentos (que sí contiene esos datos). En cambio, sí viajan datos
          clínicos como la edad, la medicación activa, los valores de laboratorio o los
          antecedentes cargados, porque son los que efectivamente permiten armar un
          resumen útil.
        </p>
        <p>
          El envío a Gemini ocurre solo en el momento en que vos pedís generar un
          resumen o subís un documento; no hay un proceso continuo mandando datos en
          segundo plano.
        </p>
      </Seccion>

      <Seccion titulo="9. Tus derechos: acceso, rectificación y supresión">
        <p>
          La Ley 25.326 (arts. 14 a 16) te reconoce el derecho de{" "}
          <strong>acceso</strong> (saber qué datos tenemos sobre vos), de{" "}
          <strong>rectificación</strong> (corregir un dato equivocado) y de{" "}
          <strong>supresión</strong> (pedir que se borre). Podés ejercerlos de dos
          formas:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Desde la propia app</strong>, que es la vía más rápida: cada dato
            que cargaste —perfil, documento, medicación, signo vital, turno— se puede
            editar o borrar directamente desde la pantalla donde lo cargaste, sin
            esperar a que nadie te responda. Borrar un perfil borra en cascada todo su
            historial.
          </li>
          <li>
            <strong>Por correo</strong>, escribiendo a{" "}
            <a href="mailto:claude2@legistdf.gob.ar" className="font-medium text-primary underline-offset-4 hover:underline">
              claude2@legistdf.gob.ar
            </a>{" "}
            si preferís que lo hagamos nosotros, o si el dato en cuestión no tiene
            todavía una pantalla propia para editarlo. Respondemos dentro de los 10
            días corridos, como marca la ley.
          </li>
        </ul>
        <p>
          Si no obtenés respuesta o considerás que no se respetaron tus derechos, podés
          hacer una denuncia ante la{" "}
          <a
            href="https://www.argentina.gob.ar/aaip"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Agencia de Acceso a la Información Pública (AAIP)
          </a>
          , la autoridad de control de la Ley 25.326 en Argentina.
        </p>
      </Seccion>

      <Seccion titulo="10. Dónde y cuánto tiempo guardamos tus datos">
        <p>
          Tus datos se almacenan en la infraestructura de Supabase, con las conexiones
          cifradas en tránsito (HTTPS) y con controles de acceso que verifican, en cada
          consulta, que quien pide un dato tenga permiso explícito sobre el perfil al
          que pertenece.
        </p>
        <p>
          Conservamos tus datos mientras tu cuenta esté activa. Si borrás un dato
          puntual, un perfil o tu cuenta entera, se elimina de forma efectiva —no queda
          en una papelera ni en un backup accesible desde la aplicación—. Lo único que
          persiste más allá de eso es el registro de consentimiento (sección 4), que por
          su naturaleza probatoria no se edita ni se borra mientras la cuenta sigue
          existiendo, y se elimina junto con ella si la cuenta se da de baja.
        </p>
      </Seccion>

      <Seccion titulo="11. Cookies">
        <p>
          Historial Médico usa exclusivamente la cookie de sesión que necesita para
          mantenerte identificado mientras usás la aplicación. No usamos cookies de
          analítica, publicidad ni seguimiento de ningún tipo, así que no hace falta
          pedirte un consentimiento aparte para eso: la única cookie que existe es
          estrictamente necesaria para que la app funcione.
        </p>
      </Seccion>

      <Seccion titulo="12. Cambios a esta política">
        <p>
          Si cambiamos esta política de forma sustancial, publicamos la nueva versión
          acá mismo con su fecha de vigencia actualizada. La versión que ves arriba (
          <span className="font-mono">{VERSION_LEGALES}</span>) es la que se registra
          como aceptada cuando creás tu cuenta hoy.
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
