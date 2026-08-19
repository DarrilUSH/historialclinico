"use server"

/**
 * Server Actions de `/compartir` (Sprint 11, tarea 11.2): las dos decisiones
 * que puede tomar la persona frente a un archivo recibido por Web Share
 * Target.
 *
 * `elegirPerfilParaCompartido` es el punto donde el archivo temporal SE
 * CONVIERTE en un documento real: descarga el archivo del área de espera
 * (`compartidos-temp`) y lo entrega a `ingestarDocumento`
 * (`lib/documentos/ingesta.ts`) -EL MISMO núcleo que usa `/estudios/nuevo`,
 * sin ninguna rama especial para el caso "vino de Share Target"- y aterriza
 * en `/estudios/nuevo/procesando`, la pantalla de extracción + revisión que
 * ya existe desde el Sprint 4. Ningún archivo queda "guardado" hasta que esa
 * pantalla se confirma: la IA nunca guarda sola, la regla vale igual acá.
 *
 * ## Elegir un destino acá ES entrar a ese perfil (hotfix del 19/08/2026)
 *
 * `elegirPerfilParaCompartido` además deja el perfil elegido como PERFIL
 * ACTIVO. Ésta es la única pantalla del producto donde el perfil sobre el que
 * se opera no sale de la cookie sino de un selector propio, y hasta este
 * hotfix el resto del recorrido no se enteraba: el cartel de la revisión
 * nombraba al titular en vez del perfil elegido (reporte real del dueño), el
 * cruce de médicos cotejaba contra el directorio equivocado, y al confirmar se
 * aterrizaba en el listado de otra persona. El porqué completo está en el
 * comentario de la línea donde se fija.
 *
 * ## Duplicado (hotfix de huella digital, Sprint 17 en vivo)
 *
 * Si `ingestarDocumento` encuentra un archivo idéntico ya cargado en el
 * perfil elegido, NO se limpia el temporal -sigue disponible para "Cargar
 * igual" o para elegir OTRO perfil- y se redirige con `?error=duplicado` más
 * `doc`/`perfil` (dos uuids opacos, no texto libre: mismo criterio que
 * `archivo`). `/compartir` los usa para ofrecer "Ver ese estudio" y "Cargar
 * igual" -este último reenvía la MISMA acción con `forzar: true`, vía un
 * campo oculto que agrega `SelectorDestino` cuando el duplicado es de ESE
 * perfil-.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import {
  ErrorPermisoDenegado,
  esErrorDeGuarda,
  requerirPermiso,
  requerirSesion,
} from "@/lib/auth/guardas"
import { esTokenCompartidoValido, yaVencio } from "@/lib/documentos/compartir-temporal"
import { ErrorIngesta, ingestarDocumento } from "@/lib/documentos/ingesta"
import { fijarPerfilActivo } from "@/lib/perfil-activo"
import { BUCKETS, borrarObjeto, descargarObjeto } from "@/lib/storage-admin"

export interface EstadoDescarteCompartido {
  error: string | null
}

const RUTA_COMPARTIR = "/compartir"

/**
 * Borra la fila de `shared_uploads_temp` y su objeto en `compartidos-temp`.
 * Best-effort en el objeto (mismo criterio que `descartarDocumento` en
 * `app/(app)/(con-nav)/estudios/actions.ts`): si el borrado del objeto falla,
 * la fila igual se borra -nada más la referencia de todos modos-, y queda
 * anotado en el log.
 */
async function limpiarTemporal(
  supabase: Awaited<ReturnType<typeof requerirSesion>>["supabase"],
  archivoId: string,
  storagePath: string,
): Promise<void> {
  try {
    await borrarObjeto(BUCKETS.compartidosTemp, storagePath)
  } catch (error) {
    console.error(
      `[compartir] No se pudo borrar el objeto temporal ${BUCKETS.compartidosTemp}/${storagePath}:`,
      error,
    )
  }

  const { error: errorDelete } = await supabase
    .from("shared_uploads_temp")
    .delete()
    .eq("id", archivoId)

  if (errorDelete) {
    console.error(`[compartir] No se pudo borrar la fila temporal ${archivoId}:`, errorDelete.message)
  }
}

/**
 * Mueve el archivo compartido `archivoId` al historial del perfil `perfilId`.
 *
 * Firma `(archivoId, perfilId, formData)` porque el selector la invoca como
 * `elegirPerfilParaCompartido.bind(null, archivoId, perfil.id)` — mismo
 * patrón que `elegirPerfil` en `app/(app)/(sin-nav)/perfiles/actions.ts`:
 * cada tarjeta es un `<form>` nativo, y el bind pasa qué se eligió sin campos
 * ocultos ni estado de cliente.
 *
 * El ÚNICO `redirect()` de esta función vive en una línea al FINAL, fuera del
 * `try/catch` — nunca dentro, porque `redirect()` lanza `NEXT_REDIRECT` y un
 * `catch` que no lo distingue del resto de los errores lo atraparía y lo
 * reemplazaría por el destino de error (mismo aviso que `lib/auth/guardas.ts`,
 * y el mismo patrón que ya siguen `elegirPerfil` y `subirDocumento`: el
 * destino se acumula en una variable local y se redirige una sola vez al
 * salir).
 */
export async function elegirPerfilParaCompartido(
  archivoId: string,
  perfilId: string,
  formData: FormData,
): Promise<void> {
  // Solo lo trae el reintento de "Cargar igual" -campo oculto que agrega
  // `SelectorDestino` cuando ESTE perfil ya mostró el aviso de duplicado.
  const forzar = formData.get("forzar") === "1"

  let destino = `${RUTA_COMPARTIR}?archivo=${archivoId}&error=inesperado`

  try {
    const { supabase } = await requerirPermiso(perfilId, "upload", { siNoHaySesion: "lanzar" })

    const { data: fila, error: errorFila } = await supabase
      .from("shared_uploads_temp")
      .select("storage_path, mime_type, original_filename, expires_at")
      .eq("id", archivoId)
      .maybeSingle()

    if (errorFila || !fila || yaVencio(fila.expires_at)) {
      destino = `${RUTA_COMPARTIR}?error=no_encontrado`
    } else {
      const { datos } = await descargarObjeto(BUCKETS.compartidosTemp, fila.storage_path)
      const archivo = new File([datos], fila.original_filename, { type: fila.mime_type })

      const resultado = await ingestarDocumento(supabase, perfilId, archivo, { forzar })

      if (resultado.duplicado) {
        // El temporal NO se limpia: sigue disponible para "Cargar igual" o
        // para elegir otro perfil (ver el encabezado del archivo).
        destino =
          `${RUTA_COMPARTIR}?archivo=${archivoId}&error=duplicado` +
          `&doc=${resultado.existente.documentoId}&perfil=${perfilId}`
      } else {
        await limpiarTemporal(supabase, archivoId, fila.storage_path)

        // El perfil ELEGIDO pasa a ser el ACTIVO (hotfix del 19/08/2026).
        //
        // Ésta es la única pantalla del producto donde el perfil sobre el que
        // se opera NO sale de la cookie sino de un selector propio, y hasta
        // acá el resto del recorrido no se enteraba: la revisión decía "Antes
        // de sumarlo al historial de <el titular>" -reporte real del dueño-,
        // la franja "¿Es este médico que ya tenés?" cotejaba contra el
        // directorio del perfil activo, "Agregar" habría dado de alta el
        // médico en el historial equivocado, y al confirmar se aterrizaba en
        // el listado de OTRA persona. Todo eso es la misma causa: elegir un
        // destino acá es, para la persona, "entrar" a ese historial, y la
        // cookie no lo reflejaba.
        //
        // `fijarPerfilActivo` revalida `view` contra la base antes de escribir
        // -acá ya está garantizado: `requerirPermiso(perfilId, "upload")` pasó
        // más arriba, y `upload` implica `view`- y audita `ver_perfil`, que es
        // exactamente lo que corresponde registrar: la persona entró a ese
        // perfil.
        //
        // Best-effort a propósito: el documento YA está ingestado en el perfil
        // correcto y la pantalla de revisión resuelve el nombre, los médicos y
        // los títulos desde la FILA del documento, así que si esto fallara la
        // revisión seguiría siendo correcta. No hay motivo para convertir un
        // fallo de cookie en un error de carga.
        try {
          await fijarPerfilActivo(perfilId)
        } catch (error) {
          console.error(
            `[compartir] No se pudo dejar activo el perfil ${perfilId} después de recibir el archivo:`,
            error instanceof Error ? error.message : error,
          )
        }

        revalidatePath("/estudios")
        destino = `/estudios/nuevo/procesando?doc=${resultado.documento.documentoId}`
      }
    }
  } catch (error) {
    if (error instanceof ErrorPermisoDenegado) {
      destino = `${RUTA_COMPARTIR}?archivo=${archivoId}&error=permiso_denegado`
    } else if (esErrorDeGuarda(error) || error instanceof ErrorIngesta) {
      console.error(
        `[compartir] No se pudo mover el archivo ${archivoId} al perfil ${perfilId}: ${error.message}`,
      )
    } else {
      console.error(`[compartir] Fallo inesperado moviendo el archivo ${archivoId}:`, error)
    }
  }

  redirect(destino)
}

const ERROR_INESPERADO_DESCARTE =
  "Ocurrió un problema y no pudimos descartar el archivo. Probá de nuevo en unos minutos."

/**
 * Descarta el archivo compartido: borra el objeto de `compartidos-temp` y su
 * fila de seguimiento, sin ingresar nada al historial. Es el "Cancelar" de
 * `/compartir`, disparado desde `DialogoConfirmacion`.
 */
export async function descartarCompartido(
  _estadoPrevio: EstadoDescarteCompartido,
  formData: FormData,
): Promise<EstadoDescarteCompartido> {
  const archivoId = formData.get("archivoId")

  if (typeof archivoId !== "string" || !esTokenCompartidoValido(archivoId)) {
    return { error: "No pudimos identificar qué archivo descartar." }
  }

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    const { data: fila } = await supabase
      .from("shared_uploads_temp")
      .select("storage_path")
      .eq("id", archivoId)
      .maybeSingle()

    // Si ya no existe (vencida y purgada, o ya descartada en otra pestaña),
    // el resultado final es el mismo que descartarla ahora: no es un error.
    if (fila) {
      await limpiarTemporal(supabase, archivoId, fila.storage_path)
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error(`[compartir] Fallo inesperado al descartar ${archivoId}:`, error)
    return { error: ERROR_INESPERADO_DESCARTE }
  }

  redirect("/inicio")
}
