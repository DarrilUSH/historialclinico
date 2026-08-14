/**
 * Hoja de consulta imprimible en una página A4 (Sprint 10, tarea 10.4):
 * encabezado con el perfil, las seis secciones de `FichaGenerada`
 * (`lib/gemini/schemas.ts`), el aviso de IA destacado y espacio en blanco
 * para que el médico anote.
 *
 * ## El nombre SÍ aparece acá, y nunca pasó por Gemini
 *
 * `docs/minimizacion-datos.md` §4.1 excluye `full_name` del contexto que
 * viaja a la IA a propósito: el nombre no cambia ninguna decisión clínica y
 * es EL identificador. Esta hoja sí lo muestra -tiene que decir de quién es
 * la ficha para que sirva en una consulta-, pero lo agrega el CLIENTE
 * (`app/(app)/(sin-nav)/ficha/page.tsx`, que ya tenía `perfil.full_name` de
 * `obtenerPerfilActivo()`) DESPUÉS de recibir la ficha generada. Gemini nunca
 * vio el nombre, y tampoco vio la fecha de nacimiento -viajó `edadAnios`, el
 * dato clínico, nunca la fecha exacta (§3.1)-: no hay forma de que el
 * contenido que redactó esté asociado con ninguno de los dos en el lado del
 * proveedor externo.
 *
 * ## `.hoja-consulta` es el contrato con `ficha.print.css`
 *
 * Este componente no importa ningún CSS: la clase raíz `hoja-consulta` (y las
 * clases hijas `hoja-consulta-titulo`, `hoja-consulta-aviso`,
 * `hoja-consulta-notas-linea`) son el selector que usa
 * `app/(app)/(sin-nav)/ficha/ficha.print.css` -que importan tanto `page.tsx`
 * como `historial/[id]/page.tsx`, las dos pantallas que renderizan esta hoja
 * con su propio botón "Imprimir"- para las reglas de impresión (tamaño de
 * fuente compacto, colores forzados a negro sobre blanco). Server Component
 * puro, sin estado ni efectos: puede vivir sin problema dentro del árbol de
 * un Client Component (`pantalla-ficha.tsx`) sin forzar un límite de
 * hidratación nuevo.
 *
 * ## Modo chica (Sprint 13, tarea 13.6): `not-print:chica:`, nunca `chica:` a secas
 *
 * Esta hoja se renderiza en pantalla Y en el PDF con exactamente el mismo
 * árbol -no hay dos componentes-, así que cualquier clase `chica:` que se le
 * agregara acá aplicaría TAMBIÉN al imprimir (el atributo
 * `data-tamano="chica"` del `<html>` sigue puesto, `window.print()` no lo
 * borra). Eso rompería el criterio "el PDF sale igual desde grande y desde
 * chica" (`ficha.print.css` fuerza los TOKENS de vuelta a los valores de
 * grande, pero un `gap-3` explícito en vez de `gap-5` seguiría siendo un
 * multiplicador distinto sobre ese mismo token, y print no tiene forma de
 * saber que "en realidad" quería decir `gap-5`).
 *
 * La salida: `not-print:chica:*` en vez de `chica:*`. Tailwind 4 envuelve
 * `not-print:` en `@media not print`, que sencillamente no matchea cuando el
 * navegador imprime -sin pelear por especificidad con nada, a diferencia de
 * intentarlo con `print:` a secas (ver el comentario de `ficha.print.css`
 * sobre por qué esa combinación necesitaría `!important` para ganar)-. Las
 * pocas secciones que si se aprietan en pantalla (gaps del artículo, padding
 * de la cabecera y del bloque de notas) usan ese prefijo. El resto de la
 * densidad -tamaños de texto, el resto del espaciado- ya sale gratis de los
 * tokens (`docs/densidad.md` §5) y por eso no necesita ninguna clase acá.
 */

import type { FichaGenerada } from "@/lib/gemini/schemas"

export interface HojaConsultaProps {
  ficha: FichaGenerada
  nombreCompleto: string
  /** `null` sin fecha de nacimiento cargada: no se inventa una edad. */
  edadAnios: number | null
  /** Ya formateada (`lib/ficha/formato.ts#formatearFechaGeneracionFicha`). */
  fechaGeneracion: string
}

export function HojaConsulta({ ficha, nombreCompleto, edadAnios, fechaGeneracion }: HojaConsultaProps) {
  return (
    <article className="hoja-consulta mx-auto flex w-full max-w-[210mm] flex-col gap-5 rounded-2xl bg-card p-6 text-card-foreground shadow-suave ring-1 ring-border not-print:chica:gap-3 not-print:chica:p-4 sm:p-8 not-print:chica:sm:p-5">
      <header className="flex flex-col gap-1 border-b border-borde-sutil pb-4 text-center not-print:chica:pb-3">
        <h1 className="hoja-consulta-titulo text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          {nombreCompleto}
        </h1>
        <p className="text-base text-muted-foreground">
          {edadAnios !== null ? `${edadAnios} años` : "Edad no registrada"}
          {" · "}
          Ficha generada el {fechaGeneracion}
        </p>
      </header>

      <Seccion titulo={ficha.motivoConsulta.titulo} contenido={ficha.motivoConsulta.contenido} />
      <Seccion titulo={ficha.antecedentesRelevantes.titulo} contenido={ficha.antecedentesRelevantes.contenido} />
      <Seccion titulo={ficha.medicacionActual.titulo} contenido={ficha.medicacionActual.contenido} />
      <Seccion titulo={ficha.estudiosRecientes.titulo} contenido={ficha.estudiosRecientes.contenido} />
      <Seccion titulo={ficha.valoresFueraDeRango.titulo} contenido={ficha.valoresFueraDeRango.contenido} />

      <section className="flex flex-col gap-1">
        <h2 className="hoja-consulta-titulo text-lg font-semibold text-balance">
          {ficha.preguntasSugeridas.titulo}
        </h2>
        <ul className="flex flex-col gap-0.5 pl-5 text-base leading-snug">
          {ficha.preguntasSugeridas.preguntas.map((pregunta, indice) => (
            <li key={indice} className="list-disc">
              {pregunta}
            </li>
          ))}
        </ul>
      </section>

      {/* Aviso de IA, destacado (Senior UX: color + ícono textual, nunca solo
          color -acá el "ícono" es la palabra "Aviso" en negrita, ver abajo-).
          `hoja-consulta-aviso` es lo que `ficha.print.css` reduce de tamaño
          para que quepa en una hoja sin perder legibilidad. */}
      <p className="hoja-consulta-aviso rounded-lg border border-advertencia/40 bg-advertencia-suave px-4 py-3 text-sm font-medium text-advertencia-fuerte">
        <strong className="font-semibold">Aviso: </strong>
        {ficha.aviso}
      </p>

      <section className="flex flex-col gap-3 pt-2 not-print:chica:gap-2 not-print:chica:pt-1.5">
        <h2 className="hoja-consulta-titulo text-sm font-semibold text-muted-foreground">
          Notas del médico
        </h2>
        <div className="hoja-consulta-notas-linea h-6 border-b border-dashed border-border" />
        <div className="hoja-consulta-notas-linea h-6 border-b border-dashed border-border" />
        <div className="hoja-consulta-notas-linea h-6 border-b border-dashed border-border" />
      </section>
    </article>
  )
}

/** Una de las cinco secciones "simples" (título fijo + contenido en texto libre, ver `lib/gemini/schemas.ts`). */
function Seccion({ titulo, contenido }: { titulo: string; contenido: string }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="hoja-consulta-titulo text-lg font-semibold text-balance">{titulo}</h2>
      {/* `whitespace-pre-wrap`: el `contenido` trae sus propios saltos de línea
          ("- " por renglón, ver el schema) y no hay que perderlos -mismo
          criterio que `components/sos/ficha-sos.tsx` usa para `sos_notes`-. */}
      <p className="text-base leading-snug whitespace-pre-wrap">{contenido}</p>
    </section>
  )
}
