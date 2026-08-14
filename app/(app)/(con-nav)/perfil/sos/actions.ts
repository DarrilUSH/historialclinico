"use server"

/**
 * Server Action de `/perfil/sos` (Sprint 8, tarea 8.2 — ROADMAP_SPRINTS.md).
 * Contrato del modelo: `docs/modelo-sos.md`.
 *
 * Una sola acción, `guardarFichaSos`: la ficha SOS no tiene alta ni baja
 * -son columnas de la fila de `profiles`, que ya existe-, solo edición. Firma
 * `(prevState, formData)` para `useActionState`, como
 * `suspenderMedicacion`/`marcarPrincipal`: acá no viajan archivos, así que no
 * aplica la excepción de `crearCobertura`.
 *
 * ## Permiso: `manage`, no `upload`
 *
 * `docs/modelo-permisos.md` §6, fila `profiles` UPDATE, nota ②: "titular o
 * `can_manage` editan el perfil **y su ficha SOS**". La guarda
 * `requerirPermiso(..., "manage")` es un **espejo** de
 * `profiles_update_administrador`, no una segunda opinión: llama a la misma
 * función `puede_administrar_perfil` que usa la política. Si alguien saltea
 * la guarda, RLS devuelve 0 filas y el `count: "exact"` lo convierte en un
 * mensaje en vez de un falso "guardado".
 *
 * Que `can_upload` NO alcance es deliberado y no una omisión: quien puede
 * *agregar* un estudio no puede *reescribir* el grupo sanguíneo de otra
 * persona. La ficha SOS es lo que un paramédico va a leer sin poder
 * preguntarle a nadie; sobreescribirla es administración, no carga.
 *
 * ## El UPDATE es la ficha ENTERA, siempre
 *
 * Se escriben las ocho columnas en cada guardado, incluidas las que quedaron
 * vacías (`null` / `'{}'`). No es un `PATCH` de lo que cambió: el formulario
 * muestra la ficha completa, así que vaciar un campo es una edición
 * deliberada -"ya no toma anticoagulantes"- y tiene que persistir. Un update
 * parcial dejaría el dato viejo vivo en la ficha de emergencia, que es
 * exactamente el peor lugar donde puede sobrevivir algo desactualizado.
 *
 * `sos_updated_at` no se toca desde acá: lo pone el trigger
 * `set_sos_updated_at` (`20260812200000_schema_inicial.sql` §3) y **solo**
 * cuando alguna columna SOS cambió de verdad. Guardar sin cambiar nada deja
 * la marca de frescura intacta, que es lo correcto: no hubo revisión nueva.
 */

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { esErrorDeGuarda, requerirPermiso } from "@/lib/auth/guardas"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"
import { validarFichaSos } from "@/lib/validacion/sos.schema"

export interface EstadoSosAccion {
  error: string | null
}

const SIN_PERFIL_ACTIVO =
  "No hay un perfil activo. Elegí de nuevo a quién le estás cargando la ficha SOS."

const ERROR_INESPERADO =
  "Ocurrió un problema y no pudimos guardar la ficha SOS. Probá de nuevo en unos minutos."

const ERROR_PERFIL_NO_ENCONTRADO =
  "No pudimos guardar la ficha: puede que ya no tengas permiso para administrar este perfil."

const ERROR_GRUPO_RECHAZADO_POR_LA_BASE =
  "Ese grupo sanguíneo no es válido. Elegí uno de los ocho de la lista o \"No lo sé\"."

/** `formData.get(nombre)` como string, tratando ausencia y `File` por igual como `""` (mismo criterio que `medicacion/actions.ts#campo`). */
function campo(formData: FormData, nombre: string): string {
  const valor = formData.get(nombre)
  return typeof valor === "string" ? valor : ""
}

/** `formData.getAll(nombre)` quedándose solo con los strings: un chip por valor (`components/sos/formulario-sos.tsx`). */
function lista(formData: FormData, nombre: string): string[] {
  return formData.getAll(nombre).filter((valor): valor is string => typeof valor === "string")
}

function datosCrudosDelFormulario(formData: FormData) {
  return {
    grupoSanguineo: campo(formData, "grupoSanguineo"),
    alergias: lista(formData, "alergias"),
    condicionesCronicas: lista(formData, "condicionesCronicas"),
    medicacionCritica: lista(formData, "medicacionCritica"),
    contactoNombre: campo(formData, "contactoNombre"),
    contactoTelefono: campo(formData, "contactoTelefono"),
    contactoVinculo: campo(formData, "contactoVinculo"),
    notas: campo(formData, "notas"),
  }
}

/**
 * Guarda la ficha SOS completa del perfil activo.
 *
 * El `23514` de `profiles_blood_type_valido` se traduce a un mensaje
 * mostrable. En el camino normal es inalcanzable -el schema Zod ya calca el
 * CHECK-, y justamente por eso se traduce: el día que alguien agregue un
 * valor en un lado y se olvide del otro, la persona ve una frase en español
 * y no un error de Postgres crudo.
 */
export async function guardarFichaSos(
  _estadoPrevio: EstadoSosAccion,
  formData: FormData,
): Promise<EstadoSosAccion> {
  try {
    const activo = await obtenerPerfilActivo()
    if (!activo) {
      return { error: SIN_PERFIL_ACTIVO }
    }

    const { supabase } = await requerirPermiso(activo.perfil.id, "manage", {
      siNoHaySesion: "lanzar",
    })

    const validacion = validarFichaSos(datosCrudosDelFormulario(formData))
    if (!validacion.ok) {
      return { error: validacion.error }
    }
    const { datos } = validacion

    const { error, count } = await supabase
      .from("profiles")
      .update(
        {
          blood_type: datos.grupoSanguineo ?? null,
          allergies: datos.alergias,
          chronic_conditions: datos.condicionesCronicas,
          critical_medication: datos.medicacionCritica,
          emergency_contact: datos.contactoNombre ?? null,
          emergency_contact_phone: datos.contactoTelefono ?? null,
          emergency_contact_relationship: datos.contactoVinculo ?? null,
          sos_notes: datos.notas ?? null,
        },
        { count: "exact" },
      )
      .eq("id", activo.perfil.id)

    if (error) {
      if (error.code === "23514" && error.message?.includes("profiles_blood_type_valido")) {
        return { error: ERROR_GRUPO_RECHAZADO_POR_LA_BASE }
      }
      console.error("[sos] Error inesperado al guardar la ficha SOS:", error)
      return { error: ERROR_INESPERADO }
    }
    // RLS devuelve cero filas en vez de un error cuando el permiso se perdió
    // entre que se pintó la pantalla y se apretó Guardar.
    if (!count) {
      return { error: ERROR_PERFIL_NO_ENCONTRADO }
    }
  } catch (error) {
    if (esErrorDeGuarda(error)) {
      return { error: error.message }
    }
    console.error("[sos] Fallo inesperado al guardar la ficha SOS:", error)
    return { error: ERROR_INESPERADO }
  }

  revalidatePath("/perfil/sos")
  // `/inicio` muestra el acceso a la ficha con su fecha de última revisión.
  revalidatePath("/inicio")
  redirect("/perfil/sos?guardada=1")
}
