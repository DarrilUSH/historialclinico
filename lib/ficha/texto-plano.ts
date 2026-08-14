/**
 * Texto plano de la ficha de resumen para consulta (Sprint 10, tarea 10.4):
 * la representación que usan "Compartir" (`navigator.share`) y su fallback de
 * copiar al portapapeles en `app/(app)/(sin-nav)/ficha/pantalla-ficha.tsx`.
 *
 * Función PURA (sin I/O, sin `server-only`): se importa desde un Client
 * Component -`navigator.share` y `navigator.clipboard` no existen del lado
 * del servidor- y por eso vive separada de `lib/ficha/generar.ts`, que sí es
 * server-only. Mismo reparto que ya usa `lib/gemini/schemas.ts` para sus
 * tipos ("se puede importar tanto desde servidor como desde código
 * compartido sin ningún riesgo de exponer credenciales"): nada acá toca la
 * red ni un cliente de Supabase, así que es seguro incluirla en el bundle del
 * navegador.
 *
 * ## El nombre y la edad NUNCA pasaron por Gemini
 *
 * `docs/minimizacion-datos.md` §4.1 excluye `full_name` del contexto que
 * viaja a la IA a propósito -el nombre no cambia ninguna decisión clínica y
 * es EL identificador-. Esta función SÍ los incluye en el texto final, pero
 * los recibe como parámetro (`EncabezadoTextoFicha`): los agrega la pantalla
 * DESPUÉS de recibir la ficha generada, con datos que ya tenía de
 * `obtenerPerfilActivo()`. Ver el mismo razonamiento, más completo, en el
 * encabezado de `components/ficha/hoja-consulta.tsx`, que arma la misma
 * información para la vista impresa.
 */

import type { FichaGenerada } from "@/lib/gemini/schemas"

export interface EncabezadoTextoFicha {
  nombreCompleto: string
  /** `null` sin fecha de nacimiento cargada: no se inventa una edad. */
  edadAnios: number | null
  /** Ya formateada (`lib/ficha/formato.ts#formatearFechaGeneracionFicha`), para que la pantalla y este texto muestren siempre la misma fecha. */
  fechaGeneracion: string
}

function bloqueSeccion(titulo: string, contenido: string): string {
  return `${titulo.toUpperCase()}\n${contenido}`
}

/**
 * Arma el texto plano completo de la ficha, en el mismo orden en que
 * `components/ficha/hoja-consulta.tsx` la pinta en pantalla: motivo,
 * antecedentes, medicación, estudios, valores fuera de rango, preguntas
 * sugeridas y el aviso al final. Doble salto de línea entre bloques para que
 * se lea igual de separado en un mensaje de WhatsApp o un mail que en la hoja
 * impresa.
 *
 * Los `contenido` de las secciones "simples" ya vienen con formato de lista
 * ("- " por línea, ver `SCHEMA_FICHA_CONSULTA` en `lib/gemini/schemas.ts`):
 * esta función no los reformatea, solo los antepone con su título.
 */
export function fichaATextoPlano(ficha: FichaGenerada, encabezado: EncabezadoTextoFicha): string {
  const lineaEdad = encabezado.edadAnios !== null ? ` (${encabezado.edadAnios} años)` : ""

  const preguntas = ficha.preguntasSugeridas.preguntas.map((pregunta) => `- ${pregunta}`).join("\n")

  const bloques = [
    `FICHA DE CONSULTA — ${encabezado.nombreCompleto}${lineaEdad}`,
    `Generada el ${encabezado.fechaGeneracion} con Historial Médico`,
    bloqueSeccion(ficha.motivoConsulta.titulo, ficha.motivoConsulta.contenido),
    bloqueSeccion(ficha.antecedentesRelevantes.titulo, ficha.antecedentesRelevantes.contenido),
    bloqueSeccion(ficha.medicacionActual.titulo, ficha.medicacionActual.contenido),
    bloqueSeccion(ficha.estudiosRecientes.titulo, ficha.estudiosRecientes.contenido),
    bloqueSeccion(ficha.valoresFueraDeRango.titulo, ficha.valoresFueraDeRango.contenido),
    bloqueSeccion(ficha.preguntasSugeridas.titulo, preguntas),
    `AVISO: ${ficha.aviso}`,
  ]

  return bloques.join("\n\n")
}
