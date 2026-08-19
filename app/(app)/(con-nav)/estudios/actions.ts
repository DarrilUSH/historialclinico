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
 * En éxito devuelve `{ documentoId }` **sin redirigir**, y quien la llamó
 * navega a `/estudios/nuevo/procesando?doc=<documentoId>`.
 *
 * Antes hacía `redirect()`. Se cambió en el hotfix del "error de red
 * fantasma" por la misma razón que `crearCobertura` -ver el bloque de
 * `ResultadoGuardadoCobertura` en `app/(app)/(con-nav)/coberturas/actions.ts`
 * para el porqué medido-: esta acción se invoca A MANO
 * (`await subirDocumento(fd)` en `nuevo/pantalla-carga.tsx`, porque el
 * formulario arma el `Blob` ya comprimido), y en Next 16 un `redirect()` de
 * Server Action **rechaza la promesa** de quien la invocó. Ese rechazo caía en
 * el `catch` de la pantalla y pintaba "No pudimos subir el estudio. Revisá tu
 * conexión y probá de nuevo." sobre una subida que había salido bien.
 *
 * El `{ documentoId }` del tipo de retorno ya existía porque es el dato que
 * el Share Target y los tests necesitan cuando llamen al núcleo sin navegar;
 * ahora además es lo que hace posible navegar desde el cliente.
 *
 * Hay una TERCERA salida que tampoco redirige: `duplicado` (hotfix de huella
 * digital, Sprint 17 en vivo). `ingestarDocumento` encontró un archivo
 * idéntico ya cargado en el perfil y no creó nada; `PantallaNuevoEstudio`
 * muestra la franja de aviso en vez de navegar, y "Cargar igual" vuelve a
 * llamar a esta misma acción con `forzar=1`.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso, requerirSesion } from "@/lib/auth/guardas"
import { ErrorIngesta, formatearFechaDuplicado, ingestarDocumento } from "@/lib/documentos/ingesta"
import { schemaExtraccionDocumento } from "@/lib/validacion/documento.schema"
import { prepararMetricas } from "@/lib/laboratorio/normalizacion"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { BUCKETS, borrarObjeto } from "@/lib/storage-admin"
import type { Json } from "@/types/database.types"
import {
  validarConfirmacionDocumento,
  validarDescarteDocumento,
} from "@/lib/validacion/confirmacion-documento.schema"

export interface EstadoSubida {
  error: string | null
  documentoId: string | null
  /**
   * Presente si `ingestarDocumento` encontró un documento idéntico y NO creó
   * nada (hotfix de huella digital, Sprint 17 en vivo — ver
   * `lib/documentos/ingesta.ts`). La pantalla ofrece "Ver ese estudio" o
   * "Cargar igual" (reintenta con `forzar=1`).
   */
  duplicado: { documentoId: string; titulo: string; fechaTexto: string } | null
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
 * El `FormData` lleva el archivo (`archivo`, el `Blob` que entregó
 * `CargadorDocumento`, ya validado y comprimido en el dispositivo) y,
 * opcionalmente, `forzar` -campo oculto que `PantallaNuevoEstudio` agrega
 * recién en el reintento de "Cargar igual", después de que la persona ya vio
 * el aviso de duplicado-. Todo lo demás -perfil, path, fecha, MIME- lo decide
 * el servidor.
 *
 * Si `ingestarDocumento` encuentra un archivo idéntico ya cargado en el
 * perfil (huella digital, hotfix Sprint 17 en vivo) y `forzar` no vino, NO
 * sube nada: devuelve `duplicado` con el título y la fecha de ESE documento,
 * y la pantalla ofrece "Ver ese estudio" o "Cargar igual" -que vuelve a
 * llamar acá con el MISMO archivo (sigue en memoria en el cliente) y
 * `forzar=1-.
 */
export async function subirDocumento(formData: FormData): Promise<EstadoSubida> {
  let documentoId: string

  try {
    const activo = await obtenerPerfilActivo()

    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO, documentoId: null, duplicado: null }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "upload", {
      siNoHaySesion: "lanzar",
    })

    const archivo = formData.get("archivo")

    // `instanceof File` y no un chequeo de forma: un campo de texto también
    // llega como string y hay que rechazarlo, no intentar leerle bytes.
    if (!(archivo instanceof File)) {
      return { error: SIN_ARCHIVO, documentoId: null, duplicado: null }
    }

    const forzar = formData.get("forzar") === "1"

    const resultado = await ingestarDocumento(supabase, activo.perfil.id, archivo, { forzar })

    if (resultado.duplicado) {
      return {
        error: null,
        documentoId: null,
        duplicado: {
          documentoId: resultado.existente.documentoId,
          titulo: resultado.existente.titulo,
          fechaTexto: formatearFechaDuplicado(resultado.existente.fecha),
        },
      }
    }

    documentoId = resultado.documento.documentoId
  } catch (error) {
    if (esErrorDeGuarda(error) || error instanceof ErrorIngesta) {
      return { error: error.message, documentoId: null, duplicado: null }
    }
    console.error("[estudios] Fallo inesperado al subir un documento:", error)
    return { error: ERROR_INESPERADO, documentoId: null, duplicado: null }
  }

  // El listado de `/estudios` es dinámico (usa cookies), pero revalidar acá
  // deja fuera de dudas que la navegación posterior no sirva un RSC cacheado
  // del router sin el documento recién creado.
  revalidatePath("/estudios")

  // Sin `redirect()`: ver "Contrato de retorno" en el encabezado. La pantalla
  // navega con `router.push` usando este `documentoId`.
  return { error: null, documentoId, duplicado: null }
}

const ERROR_INESPERADO_CONFIRMACION =
  "Ocurrió un problema y no pudimos guardar el documento. Probá de nuevo en unos minutos."

const ERROR_INESPERADO_DESCARTE =
  "Ocurrió un problema y no pudimos descartar el documento. Probá de nuevo en unos minutos."

/**
 * Confirma el documento recién subido: valida los siete campos editables del
 * formulario de revisión (título, categoría, fecha, resumen, institución,
 * especialidad, médico) y llama al RPC `confirmar_documento_recien_subido`
 * (`supabase/migrations/20260813010000_confirmacion_documentos.sql`, extendido
 * por `20260813020000_metricas_en_confirmacion.sql` y por
 * `20260813030000_confirmacion_metadatos_completos.sql`), que hace las
 * guardas del lado de la base (creador, ventana de 1 hora, no confirmado
 * antes, valores válidos), sella `confirmed_at` y -en la MISMA transacción-
 * inserta las métricas de laboratorio ya normalizadas en `lab_metrics` y
 * persiste institución/especialidad/médico en
 * `documents.institution`/`.specialty`/`.doctor_name` -las mismas columnas
 * que ya leen el filtro de institución de `/estudios`, la tarjeta de la
 * galería y el detalle del estudio, sin que ninguna de esas pantallas
 * necesite cambios-.
 *
 * Es el ÚNICO camino que persiste datos del formulario de revisión: "Cancelar"
 * llama a `descartarDocumento`, que borra en vez de guardar.
 *
 * `metricas` viaja en el `FormData` (campo oculto, JSON) porque
 * `formulario-revision.tsx` las muestra de solo lectura -esta acción es la
 * primera vez que se tocan de verdad-. El camino es: (1) parsear el JSON de
 * forma defensiva -si viniera roto, NO aborta la confirmación del documento
 * por eso, se sigue como si no hubiera métricas-, (2) revalidar la forma de
 * cada item con el mismo schema Zod que ya usa la extracción de Gemini
 * (`schemaExtraccionDocumento.shape.metricas`: nombre no vacío, valor
 * numérico finito, y el excedente por encima de 50 items recortado en vez de
 * rechazado — Sprint 18) porque el campo oculto es JSON que viajó
 * por HTTP y no hay garantía de que el cliente no lo haya tocado, y (3)
 * normalizar con `prepararMetricas` (`lib/laboratorio/normalizacion.ts`):
 * resuelve el nombre canónico contra el diccionario de sinónimos, parsea el
 * rango de referencia textual y deduplica dentro del documento. El RPC repite
 * su propia validación server-side sobre el resultado -es la última palabra,
 * no esta acción-, así que acá alcanza con un filtrado razonable, no con
 * paranoia total.
 *
 * ## `doctorId`: el vínculo con el directorio (hotfix "Vincular", 19/08/2026)
 *
 * `documents.doctor_id` existía en el esquema desde el primer día pero ningún
 * flujo lo escribía: "Vincular" en la franja de cotejo de médicos sólo
 * normalizaba el TEXTO del campo "Médico" -y cuando el nombre extraído ya
 * coincidía exactamente con el del directorio, eso no cambiaba nada y el botón
 * parecía roto (reporte del dueño: *"al tocarlo no hace absolutamente nada"*)-.
 * Ahora la franja además avisa QUÉ médico se vinculó, y el id viaja en el
 * campo oculto `doctorId` hasta el RPC, que lo persiste después de verificar
 * que sea un médico del MISMO perfil del documento (guarda 7). Vincular nunca
 * crea un médico: eso sigue siendo exclusivamente de "Agregar"
 * (`crearMedicoDesdeCruce`), así que confirmar no puede dejar un duplicado en
 * el directorio.
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
    institucion: formData.get("institucion"),
    especialidad: formData.get("especialidad"),
    medico: formData.get("medico"),
    numeroOrden: formData.get("numeroOrden"),
    doctorId: formData.get("doctorId"),
  }

  const validacion = validarConfirmacionDocumento(crudo)
  if (!validacion.ok) {
    return { error: validacion.error }
  }

  const {
    documentoId,
    titulo,
    categoria,
    fecha,
    resumen,
    institucion,
    especialidad,
    medico,
    numeroOrden,
    doctorId,
  } = validacion.datos

  // Las métricas son best-effort: un campo oculto roto o con forma inesperada
  // NUNCA bloquea la confirmación del documento -la regla de oro del roadmap
  // ("la subida nunca queda bloqueada por la IA") se extiende acá-, se sigue
  // sin métricas y queda logueado para diagnóstico.
  let metricasParaRpc: ReturnType<typeof prepararMetricas>["filas"] = []
  const metricasCrudo = formData.get("metricas")
  if (typeof metricasCrudo === "string" && metricasCrudo.trim().length > 0) {
    try {
      const parseado: unknown = JSON.parse(metricasCrudo)
      const validacionMetricas = schemaExtraccionDocumento.shape.metricas.safeParse(parseado)
      if (validacionMetricas.success) {
        metricasParaRpc = prepararMetricas(validacionMetricas.data, fecha).filas
      } else {
        console.warn(
          `[estudios] El campo oculto "metricas" no tenía la forma esperada para ${documentoId}; se confirma sin métricas.`,
          validacionMetricas.error.issues,
        )
      }
    } catch (error) {
      console.warn(
        `[estudios] El campo oculto "metricas" no era JSON válido para ${documentoId}; se confirma sin métricas.`,
        error,
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
      // `null` y no `[]` cuando no hay métricas: el RPC distingue "no venían
      // métricas" (skip total del bloque de insert) de "vino una lista vacía"
      // -mismo resultado práctico, pero `null` es la forma explícita del
      // contrato del parámetro (`metricas jsonb DEFAULT NULL`). El cast a
      // `Json` es seguro: `FilaLabMetricPreparada` es un objeto plano de
      // strings/numbers/null, exactamente lo que `metricas jsonb` espera del
      // otro lado; TypeScript exige el cast solo porque una interfaz con
      // forma fija (sin index signature) no es asignable de forma implícita
      // a un tipo indexado como `Json`.
      metricas: (metricasParaRpc.length > 0 ? metricasParaRpc : null) as Json | null,
      // Mismo criterio que `nuevo_resumen`: se manda string vacía en vez de
      // `null` para no pelear con el tipo generado (`string`, sin `| null`),
      // aunque el RPC (`nullif(btrim(coalesce(...)), '')`) trata las dos
      // formas exactamente igual.
      nueva_institucion: institucion ?? "",
      nueva_especialidad: especialidad ?? "",
      nuevo_medico: medico ?? "",
      // Mismo criterio que institución/especialidad/médico: string vacía en
      // vez de `null` (el tipo generado del parámetro no lleva `| null`),
      // aunque el RPC trata las dos formas igual.
      nuevo_numero_orden: numeroOrden ?? "",
      // El vínculo con el directorio (hotfix "Vincular", 19/08/2026). Acá NO
      // se puede mandar string vacía: es un `uuid` y `''::uuid` explota en el
      // cast. Se manda `undefined`, que `JSON.stringify` directamente omite
      // del cuerpo, y entonces el parámetro toma su `DEFAULT NULL`.
      //
      // La pertenencia al perfil del documento la verifica el RPC (guarda 7),
      // no esta acción: es la última palabra y ya tiene `fila.profile_id` a
      // mano. Si el id no es de ese directorio, el RPC devuelve el mensaje en
      // español que el formulario muestra tal cual.
      nuevo_doctor_id: doctorId ?? undefined,
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
