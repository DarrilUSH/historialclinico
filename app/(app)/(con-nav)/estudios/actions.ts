"use server"

/**
 * Server Actions de `/estudios`. Hoy una sola: `subirDocumento`, la puerta de
 * entrada de un archivo al historial.
 *
 * Esta acción es deliberadamente FINA. Todo lo que hace es: resolver el perfil
 * activo, exigir el permiso, sacar el archivo del `FormData` y delegar en
 * `ingestarDocumento` (`lib/documentos/ingesta.ts`), que es el núcleo
 * reutilizable -validación server-side, path determinístico, subida y registro
 * con compensación-. El reparto no es estético: en el Sprint 11 el Web Share
 * Target recibe archivos compartidos desde otras apps y tiene que entrar por
 * exactamente el mismo camino, sin pasar por una Server Action de formulario.
 * Si la lógica viviera acá, ese sprint la duplicaría o la movería a las
 * apuradas.
 *
 * ## Por qué el perfil sale de la cookie y no del `FormData`
 *
 * El perfil sobre el que se opera es el ACTIVO (`obtenerPerfilActivo()`), no
 * un campo que mande el cliente. La cookie no es una credencial -es contexto
 * de interfaz-, pero `obtenerPerfilActivo()` revalida `view` contra la base en
 * cada llamada, y acá arriba de eso se exige `upload` con `requerirPermiso`,
 * que llama a la MISMA función `SECURITY DEFINER` que usan las políticas RLS.
 * Aceptar un `perfilId` del formulario no sería inseguro (la guarda y RLS lo
 * verificarían igual), pero permitiría subirle un estudio a un perfil distinto
 * del que la persona está viendo en pantalla: una carga silenciosa en el
 * historial equivocado. `lib/documentos/ingesta.ts` sí recibe el `perfilId`
 * como parámetro, para que el Share Target del Sprint 11 pueda resolverlo a su
 * manera.
 *
 * ## Guardas, en orden
 *
 * 1. `requerirSesion({ siNoHaySesion: "lanzar" })` — implícito en
 *    `requerirPermiso`; se usa "lanzar" y no "redirigir" porque acá el error
 *    vuelve al formulario como texto, y porque `redirect()` dentro de un
 *    `try/catch` quedaría atrapado (ver el aviso de `lib/auth/guardas.ts`).
 * 2. Perfil activo válido.
 * 3. `requerirPermiso(perfilId, "upload")` — la matriz de
 *    `docs/modelo-permisos.md` §4.2: `can_upload` (o titular, o `can_manage`).
 *    Un `can_view` como Diego recibe acá `ErrorPermisoDenegado` con su mensaje
 *    en español, ANTES de que el archivo toque el bucket. Y aunque esta guarda
 *    fallara, las dos escrituras van con el cliente del usuario: las políticas
 *    `objetos_insert_puede_cargar_en_perfil` y `documents_insert_puede_cargar`
 *    lo rechazarían igual en la base.
 *
 * ## Contrato de retorno
 *
 * En éxito **no retorna**: hace `redirect()` a `/estudios/nuevo/procesando`.
 * El `redirect` va FUERA del `try/catch` a propósito -funciona lanzando
 * `NEXT_REDIRECT`, y un `catch` que se lo trague deja la navegación colgada-.
 * El `{ documentoId }` del tipo de retorno existe igual porque es el dato que
 * el Share Target y los tests necesitan cuando llamen al núcleo sin navegar, y
 * porque deja el tipo honesto: en error se devuelve `{ error }`.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso, requerirSesion } from "@/lib/auth/guardas"
import { ErrorIngesta, ingestarDocumento } from "@/lib/documentos/ingesta"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { BUCKETS, borrarObjeto } from "@/lib/storage-admin"
import {
  validarConfirmacionDocumento,
  validarDescarteDocumento,
} from "@/lib/validacion/confirmacion-documento.schema"

export interface EstadoSubida {
  error: string | null
  documentoId: string | null
}

export interface EstadoConfirmacion {
  error: string | null
}

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás subiendo el estudio."

const SIN_ARCHIVO = "No recibimos ningún archivo. Elegí uno y probá de nuevo."

const ERROR_INESPERADO =
  "Ocurrió un problema y no pudimos subir el estudio. Probá de nuevo en unos minutos."

/**
 * Sube un documento al bucket privado `documentos-medicos` y lo registra en
 * `documents`.
 *
 * El `FormData` lleva un solo campo, `archivo`, con el `Blob` que entregó
 * `CargadorDocumento` (ya validado y comprimido en el dispositivo). Todo lo
 * demás -perfil, path, fecha, MIME- lo decide el servidor.
 */
export async function subirDocumento(formData: FormData): Promise<EstadoSubida> {
  let documentoId: string

  try {
    const activo = await obtenerPerfilActivo()

    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO, documentoId: null }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const archivo = formData.get("archivo")

    // `instanceof File` y no un chequeo de forma: un campo de texto también
    // llega como string y hay que rechazarlo, no intentar leerle bytes.
    if (!(archivo instanceof File)) {
      return { error: SIN_ARCHIVO, documentoId: null }
    }

    const ingestado = await ingestarDocumento(supabase, activo.perfil.id, archivo)
    documentoId = ingestado.documentoId
  } catch (error) {
    if (esErrorDeGuarda(error) || error instanceof ErrorIngesta) {
      return { error: error.message, documentoId: null }
    }
    console.error("[estudios] Fallo inesperado al subir un documento:", error)
    return { error: ERROR_INESPERADO, documentoId: null }
  }

  // El listado de `/estudios` es dinámico (usa cookies), pero revalidar acá
  // deja fuera de dudas que la navegación posterior no sirva un RSC cacheado
  // del router sin el documento recién creado.
  revalidatePath("/estudios")

  // Fuera del try/catch: ver el contrato de retorno en el encabezado.
  redirect(`/estudios/nuevo/procesando?doc=${documentoId}`)
}

const ERROR_INESPERADO_CONFIRMACION =
  "Ocurrió un problema y no pudimos guardar el documento. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_DESCARTE =
  "Ocurrió un problema y no pudimos descartar el documento. Probá de nuevo en unos minutos."

/**
 * Confirma el documento recién subido: valida los cuatro campos editables
 * del formulario de revisión y llama al RPC `confirmar_documento_recien_subido`
 * (`supabase/migrations/20260813010000_confirmacion_documentos.sql`), que
 * hace las cuatro guardas del lado de la base (creador, ventana de 1 hora,
 * no confirmado antes, valores válidos) y sella `confirmed_at`.
 *
 * Es el ÚNICO camino que persiste datos del formulario de revisión: "Cancelar"
 * llama a `descartarDocumento`, que borra en vez de guardar.
 *
 * `metricas` viaja en el `FormData` (campo oculto, JSON) porque
 * `formulario-revision.tsx` las muestra de solo lectura y las deja listas
 * para que la tarea 4.6 del roadmap ("Persistencia de métricas de
 * laboratorio") las inserte en `lab_metrics` sin tener que tocar el
 * formulario. Esta acción las parsea de forma defensiva -si el JSON viniera
 * roto, no aborta la confirmación por eso- pero TODAVÍA NO LAS PERSISTE: es
 * deuda explícita de esta tarea, resuelta por la 4.6.
 *
 * Firma `(prevState, formData)` para poder usarse con `useActionState` desde
 * `formulario-revision.tsx`, mismo patrón que `familia/actions.ts`.
 */
export async function confirmarDocumento(
  _estadoPrevio: EstadoConfirmacion,
  formData: FormData,
): Promise<EstadoConfirmacion> {
  const crudo = {
    documentoId: formData.get("documentoId"),
    titulo: formData.get("titulo"),
    categoria: formData.get("categoria"),
    fecha: formData.get("fecha"),
    resumen: formData.get("resumen"),
  }

  const validacion = validarConfirmacionDocumento(crudo)
  if (!validacion.ok) {
    return { error: validacion.error }
  }

  const { documentoId, titulo, categoria, fecha, resumen } = validacion.datos

  // Deuda declarada (ver el comentario de la función): se parsean para dejar
  // el contrato listo para la tarea 4.6, pero no se insertan en lab_metrics
  // todavía.
  const metricasCrudo = formData.get("metricas")
  if (typeof metricasCrudo === "string") {
    try {
      JSON.parse(metricasCrudo)
    } catch {
      console.warn(
        `[estudios] El campo oculto "metricas" no era JSON válido para ${documentoId}; se ignora (deuda de la tarea 4.6).`,
      )
    }
  }

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    const { error } = await supabase.rpc("confirmar_documento_recien_subido", {
      doc_id: documentoId,
      nuevo_titulo: titulo,
      nueva_categoria: categoria,
      nueva_fecha: fecha,
      // El RPC trata "" igual que NULL (`nullif(btrim(...), '')`): se manda
      // string vacía en vez de `null` para no pelear con el tipo generado
      // (`nuevo_resumen: string`, sin `| null`, aunque el parámetro SQL sí
      // acepta NULL).
      nuevo_resumen: resumen ?? "",
    })

    if (error) {
      // Los mensajes del RPC ya están escritos para mostrarse tal cual (ver
      // el encabezado de la migración): "Solo la persona que subió este
      // documento puede confirmarlo.", "Pasó más de una hora...", etc.
      return { error: error.message || ERROR_INESPERADO_CONFIRMACION }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error(`[estudios] Fallo inesperado al confirmar ${documentoId}:`, error)
    return { error: ERROR_INESPERADO_CONFIRMACION }
  }

  revalidatePath("/estudios")
  redirect("/estudios?confirmado=1")
}

/**
 * Descarta (borra) el documento recién subido: es el "Cancelar" de la
 * pantalla de revisión, disparado desde `DialogoConfirmacion` después de que
 * la persona confirma el diálogo "¿Descartar este documento?".
 *
 * Llama al RPC `descartar_documento_recien_subido`, que ya borra la FILA con
 * las mismas guardas de creador+1h+no-confirmado (el trigger
 * `documents_encolar_purga_storage` encola el `storage_path` en
 * `storage_purge_queue` automáticamente, como en cualquier `DELETE` de
 * `documents`). Acá además se borra el OBJETO de Storage de inmediato con
 * `lib/storage-admin.ts` -patrón "belt-and-suspenders" del roadmap: la cola es
 * la red de seguridad, este borrado inmediato es la vía rápida cuando todo
 * sale bien. Si el borrado inmediato fallara, la fila YA está borrada -el RPC
 * es lo que importa para que el documento desaparezca del historial- y la
 * cola lo va a purgar igual más tarde, así que el fallo se registra pero no
 * cambia la respuesta.
 */
export async function descartarDocumento(
  _estadoPrevio: EstadoConfirmacion,
  formData: FormData,
): Promise<EstadoConfirmacion> {
  const validacion = validarDescarteDocumento({ documentoId: formData.get("documentoId") })
  if (!validacion.ok) {
    return { error: validacion.error }
  }

  const { documentoId } = validacion.datos

  try {
    const { supabase } = await requerirSesion({ siNoHaySesion: "lanzar" })

    const { data: filaBorrada, error } = await supabase.rpc(
      "descartar_documento_recien_subido",
      { doc_id: documentoId },
    )

    if (error) {
      return { error: error.message || ERROR_INESPERADO_DESCARTE }
    }

    if (filaBorrada?.storage_path) {
      try {
        await borrarObjeto(BUCKETS.documentos, filaBorrada.storage_path)
      } catch (errorBorrado) {
        // Belt-and-suspenders: la fila ya está borrada y encolada para purga
        // (ver el comentario de la función). No se le devuelve un error a la
        // persona por esto.
        console.error(
          `[estudios] El RPC de descarte borró la fila de ${documentoId}, pero el borrado inmediato del objeto ${filaBorrada.storage_path} falló (queda igual en storage_purge_queue):`,
          errorBorrado,
        )
      }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error(`[estudios] Fallo inesperado al descartar ${documentoId}:`, error)
    return { error: ERROR_INESPERADO_DESCARTE }
  }

  revalidatePath("/estudios")
  redirect("/estudios?descartado=1")
}
