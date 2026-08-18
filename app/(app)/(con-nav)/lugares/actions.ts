"use server"

/**
 * Server Action de búsqueda del catálogo REFES para el autocompletar de
 * "Lugar" del formulario de turno (Sprint 16, tarea 16.3).
 *
 * ## Por qué una Server Action y no un Route Handler
 *
 * Porque no hay nada que exponer como API: esto lo consume UN componente de
 * esta misma aplicación (`components/lugares/campo-lugar.tsx`). Una Server
 * Action le da autenticación por cookie sin escribir una línea de handler,
 * tipos compartidos de punta a punta y ninguna URL nueva que después haya que
 * proteger y recordar. Es el mismo criterio con el que el resto del proyecto
 * eligió Server Actions para todo lo que no sea consumido por algo externo
 * (el cron, el service worker, el share target).
 *
 * ## Por qué no viajan las 36.046 filas al navegador
 *
 * Sería 9 MB de JSON en cada carga del formulario de turno, en un teléfono
 * con datos móviles, para usar 20 filas. La búsqueda vive en la base
 * (`lib/lugares/consulta.ts`) y lo que viaja son las diez sugerencias
 * visibles, ya recortadas a los campos que el formulario precarga.
 */

import { requerirSesion } from "@/lib/auth/guardas"
import {
  elegirCandidatosLugar,
  tokensDeBusquedaLugar,
  type LugarExtraidoParaCotejo,
  type ResultadoCandidatosLugar,
} from "@/lib/lugares/candidatos"
import { buscarCentros, buscarCentrosPorTokens, centroDelCatalogoASugerido } from "@/lib/lugares/consulta"
import type { CentroSugerido } from "@/lib/lugares/sugerencias"

/** Cuántas sugerencias trae cada tecleo. Diez es lo que entra en pantalla sin scrollear el popup. */
const LIMITE_SUGERENCIAS = 10

/**
 * Busca centros para el autocompletar. Devuelve lista vacía -nunca lanza-
 * cuando la consulta es demasiado corta o cuando la base falla: un
 * desplegable de sugerencias que rompe el formulario entero sería mucho peor
 * que uno que no sugiere nada, y "Lugar" siempre acepta texto libre.
 */
export async function buscarLugaresAction(consulta: string): Promise<CentroSugerido[]> {
  const texto = (consulta ?? "").trim()
  // Con menos de tres caracteres la consulta traería miles de filas y ninguna
  // sería útil. El campo sigue funcionando como texto libre mientras tanto.
  if (texto.length < 3) return []

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })
    const { centros } = await buscarCentros(supabase, {
      consulta: texto,
      limite: LIMITE_SUGERENCIAS,
    })

    return centros.map(centroDelCatalogoASugerido)
  } catch {
    return []
  }
}

/**
 * Cruce "¿es este lugar del catálogo?" (cruces inteligentes, agosto 2026):
 * dado lo que la IA extrajo de un mensaje de turno o de un documento
 * (`components/lugares/franja-candidato-lugar.tsx` es el único llamador),
 * arma la consulta candidata (`buscarCentrosPorTokens`, insensible a tildes/
 * mayúsculas y tolerante a texto de sobra) y deja que
 * `lib/lugares/candidatos.ts#elegirCandidatosLugar` decida si corresponde
 * ofrecer un único centro, una listita de 2-3, o silencio.
 *
 * Nunca lanza: sin nombre, sin tokens útiles, sin sesión o con la base caída,
 * el resultado es `{ tipo: "ninguno" }` -el cruce es una AYUDA opcional, no
 * puede tumbar el formulario que lo dispara-.
 */
export async function candidatosLugarAction(
  extraido: LugarExtraidoParaCotejo,
): Promise<ResultadoCandidatosLugar> {
  const nombre = (extraido?.nombre ?? "").trim()
  if (nombre.length === 0) return { tipo: "ninguno" }

  try {
    const tokens = tokensDeBusquedaLugar(extraido)
    if (tokens.length === 0) return { tipo: "ninguno" }

    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })
    const filas = await buscarCentrosPorTokens(supabase, tokens)
    const centros = filas.map(centroDelCatalogoASugerido)

    return elegirCandidatosLugar(extraido, centros)
  } catch {
    return { tipo: "ninguno" }
  }
}
