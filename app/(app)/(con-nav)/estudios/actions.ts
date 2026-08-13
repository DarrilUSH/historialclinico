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

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { ErrorIngesta, ingestarDocumento } from "@/lib/documentos/ingesta"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export interface EstadoSubida {
  error: string | null
  documentoId: string | null
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
