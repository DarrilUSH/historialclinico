/**
 * Normalización del buscador de `/estudios` (bug reportado: buscar "hepatico"
 * no encontraba "Absceso hepático" -el buscador exigía tildes-).
 *
 * Tiene que decir EXACTAMENTE lo mismo que el `translate()` de la columna
 * generada `documents.search_text`
 * (`supabase/migrations/20260823120000_busqueda_sin_tildes_documentos.sql`):
 * una normaliza el PAJAR al ingerir (columna generada, recalculada por
 * Postgres en cada INSERT/UPDATE), la otra normaliza el NEEDLE al buscar
 * (acá). Si las dos puntas dijeran cosas distintas, "hepatico" podría dejar
 * de encontrar "hepático" sin que ningún test unitario de un solo lado lo
 * note -por eso `tests/unit/filtros-estudios.test.ts` verifica esta función
 * en JS y el informe de la tarea verifica el `translate()` en SQL directo
 * contra la base local-.
 *
 * Misma técnica que `lib/lugares/normalizar.ts#normalizarBusqueda` -que
 * resuelve el caso idéntico para `/lugares`-: NFD descompone "ñ" en "n" +
 * tilde combinante, así que esa combinación se recompone a "ñ" ANTES de
 * borrar las marcas combinantes (ver el comentario de esa función sobre por
 * qué "ñ" no es una variante acentuada de "n" en castellano). No se
 * reexporta esa función porque `documents.search_text` no es la misma
 * columna que `health_centers.search_text` y este módulo tiene que quedar
 * atado al `translate()` de ESTA migración, no a la de `/lugares`
 * -aunque hoy el resultado práctico coincida-.
 *
 * Divergencia conocida y aceptada: el `translate()` de Postgres solo lista
 * un conjunto FIJO de 39 caracteres acentuados latinos; NFD, en cambio,
 * descompone cualquier carácter Unicode con marca diacrítica, incluidos
 * alfabetos que el mapa SQL no cubre. Para nombres/resúmenes de documentos
 * médicos en castellano rioplatense esto no aparece nunca en la práctica,
 * pero si algún día hiciera falta buscar, por ejemplo, un apellido escrito
 * con letras de otro alfabeto latino extendido, esta función lo
 * normalizaría y el `translate()` de la base no -la búsqueda perdería ese
 * caso puntual, no rompería nada-.
 */

/**
 * "n"/"N" seguidas de U+0303 (tilde combinante): en lo que se convierten "ñ"
 * y "Ñ" después de `normalize("NFD")`.
 *
 * Los tres patrones de acá abajo se escriben con ESCAPES Unicode y no con el
 * carácter literal a propósito -mismo motivo que documenta
 * `lib/lugares/normalizar.ts`-: una marca combinante suelta en el código
 * fuente se pega visualmente a la letra anterior -o al corchete del rango-,
 * es indistinguible de un carácter normal en cualquier editor, y vuelve
 * ilegible el diff.
 */
const ENIE_DESCOMPUESTA = /n\u0303/g
const ENIE_MAYUSCULA_DESCOMPUESTA = /N\u0303/g

/** Bloque Unicode "Combining Diacritical Marks": los acentos que NFD dejó sueltos. */
const MARCAS_COMBINANTES = /[\u0300-\u036f]/g

/**
 * Minúsculas, sin tildes ni diéresis, con la "ñ" preservada y los espacios
 * colapsados. Es lo que hay que aplicarle al texto que la persona tipeó
 * ANTES de armar el patrón `ILIKE` -nunca al valor que se muestra en el
 * campo ni al que viaja en la URL, que se conservan tal como se escribieron-.
 */
export function normalizarBusquedaEstudios(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(ENIE_DESCOMPUESTA, "ñ")
    .replace(ENIE_MAYUSCULA_DESCOMPUESTA, "Ñ")
    .replace(MARCAS_COMBINANTES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}
