"use server"

/**
 * Server Action de `/perfil/datos`: edición de los datos básicos del perfil
 * activo (nombre completo, fecha de nacimiento, DNI, teléfono). Contrato de
 * validación: `lib/validacion/perfil-datos.schema.ts`.
 *
 * Cierra el hueco reportado por el dueño del producto: la ficha SOS
 * (`/perfil/sos`) permite cargar grupo sanguíneo y contacto de emergencia,
 * pero nunca pidió estos cuatro campos, que viven en `profiles` desde el
 * esquema inicial (`supabase/migrations/20260812200000_schema_inicial.sql`
 * §4.1) y solo se escribían una vez -al crear el perfil, nunca después-.
 *
 * ## Permiso: `manage`, mismo predicado que la ficha SOS
 *
 * `docs/modelo-permisos.md` §6, fila `profiles` UPDATE, nota ②: "titular o
 * `can_manage` editan el perfil **y su ficha SOS**". Nombre, fecha de
 * nacimiento, DNI y teléfono son "los datos de contacto" que esa misma nota
 * menciona -no son parte de las ocho columnas SOS, pero están en la MISMA
 * fila y bajo la MISMA UPDATE policy (`profiles_update_administrador`), así
 * que el predicado es idéntico al de `guardarFichaSos`
 * (`app/(app)/(con-nav)/perfil/sos/actions.ts`): dueño del perfil O
 * `can_manage`. Un `can_view` o `can_upload` nunca llega a esta acción -la
 * pantalla no le muestra el formulario, ver `page.tsx`-, y si de todas
 * formas la invocara a mano, `requerirPermiso(..., "manage")` la frena acá,
 * y RLS la frena una vez más si algo de eso fallara.
 *
 * ## El UPDATE es SIEMPRE el perfil activo, nunca un id que llegue del cliente
 *
 * A diferencia de `familia/actions.ts` (que administra permisos sobre
 * CUALQUIER perfil que el actor pueda otorgar), acá no viaja ningún
 * `perfilId` en el `FormData`: se edita `obtenerPerfilActivo().perfil.id`,
 * exactamente el mismo criterio que `guardarFichaSos`. Cambiar de perfil
 * gestionado para editar SUS datos bösicos es "elegí ese perfil en el
 * selector, después entrá a Mis datos" -nunca un id inyectado a mano en el
 * formulario de otro perfil-.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { validarDatosPerfil } from "@/lib/validacion/perfil-datos.schema"

export interface EstadoDatosPerfilAccion {
  error: string | null
}

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás editando los datos."

const ERROR_INESPERADO =
  "Ocurrió un problema y no pudimos guardar los datos. Probá de nuevo en unos minutos."

const ERROR_PERFIL_NO_ENCONTRADO =
  "No pudimos guardar: puede que ya no tengas permiso para administrar este perfil."

const ERROR_NOMBRE_RECHAZADO_POR_LA_BASE =
  "El nombre completo no puede quedar vacío."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` (mismo criterio que `perfil/sos/actions.ts#campo`). */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

function datosCrudosDelFormulario(formData: FormData) {
  return {
    fullName: campo(formData, "fullName"),
    dateOfBirth: campo(formData, "dateOfBirth"),
    nationalId: campo(formData, "nationalId"),
    phone: campo(formData, "phone"),
  }
}

/**
 * Guarda los datos básicos del perfil activo.
 *
 * `profiles_full_name_no_vacio` es inalcanzable en el camino normal -el
 * schema Zod ya exige `min(1)` sobre el string trimeado- y se traduce igual,
 * mismo criterio que `ERROR_GRUPO_RECHAZADO_POR_LA_BASE` en
 * `perfil/sos/actions.ts`: el día que alguien relaje el schema sin acordarse
 * del CHECK, la persona ve una frase en español, no un error de Postgres.
 */
export async function guardarDatosPerfil(
  _estadoPrevio: EstadoDatosPerfilAccion,
  formData: FormData,
): Promise<EstadoDatosPerfilAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarDatosPerfil(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error }
    }
    const { datos } = validacion

    const { error, count } = await supabase
      .from("profiles")
      .update(
        {
          full_name: datos.fullName,
          date_of_birth: datos.dateOfBirth ?? null,
          national_id: datos.nationalId ?? null,
          phone: datos.phone ?? null,
        },
        { count: "exact" },
      )
      .eq("id", activo.perfil.id)

    if (error) {
      if (error.code === "23514" && error.message?.includes("profiles_full_name_no_vacio")) {
        return { error: ERROR_NOMBRE_RECHAZADO_POR_LA_BASE }
      }
      console.error("[perfil-datos] Error inesperado al guardar los datos del perfil:", error)
      return { error: ERROR_INESPERADO }
    }
    // RLS devuelve cero filas en vez de un error cuando el permiso se perdió
    // entre que se pintó la pantalla y se apretó Guardar (mismo criterio que
    // `guardarFichaSos`).
    if (!count) {
      return { error: ERROR_PERFIL_NO_ENCONTRADO }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[perfil-datos] Fallo inesperado al guardar los datos del perfil:", error)
    return { error: ERROR_INESPERADO }
  }

  revalidatePath("/perfil/datos")
  // El nombre se lee en el encabezado de cada pantalla con nav, y el nombre,
  // la edad y el DNI aparecen en la ficha SOS (lectura y edición) y en la
  // ficha para el médico.
  revalidatePath("/inicio")
  revalidatePath("/perfil/sos")
  revalidatePath("/sos")
  revalidatePath("/perfiles")
  redirect("/perfil/datos?guardada=1")
}
