/**
 * `/perfil/datos`: "Mis datos" — edición del nombre completo, la fecha de
 * nacimiento, el DNI y el teléfono del perfil ACTIVO.
 *
 * Cierra un hueco de producto real, verificado en el código: `date_of_birth`,
 * `national_id`, `phone` y `full_name` solo se escriben al CREAR un perfil
 * (el trigger de alta de cuenta escribe solo el nombre; `crear_perfil_gestionado`
 * escribe nombre y fecha) y nunca existió una pantalla para editarlos
 * después. Consecuencia real: la ficha SOS (`/sos`) y la ficha para el
 * médico (`/ficha`) muestran "Edad no registrada" para siempre, y un nombre
 * mal escrito al registrarse queda incorregible. El dueño del producto lo
 * señaló buscando la fecha de nacimiento justamente en la ficha SOS -por eso
 * `/perfil/sos` enlaza acá, ver el bloque agregado en esa página-.
 *
 * ## Permiso: `can_manage` para editar, `can_view` para mirar
 *
 * Espeja `profiles_update_administrador` (`docs/modelo-permisos.md` §6, nota
 * ②: "titular o `can_manage` editan el perfil"). Pero a diferencia de
 * `/perfil/sos` -que redirige a `/inicio` sin `can_manage`-, esta pantalla
 * SÍ se le muestra a un `can_view` puro, en modo de solo lectura: los cuatro
 * campos (nombre, fecha de nacimiento, DNI, teléfono) ya son visibles para
 * cualquier `can_view` en otros lugares de la app -la ficha SOS de lectura
 * (`/sos`, guardada solo con "view") muestra el nombre, la edad calculada y
 * el DNI sin pedir `can_manage`-, así que ocultarle la pantalla entera a
 * Diego (`can_view`, docs/modelo-permisos.md §3.3) sería más restrictivo que
 * lo que el resto de la app ya le permite ver, sin ganar nada: el dato no es
 * nuevo, solo cambiaría el lugar donde se lo mira. Lo que sí se oculta es la
 * capacidad de EDITAR, que es la única operación que la matriz reserva a
 * `can_manage` (fila `profiles` UPDATE).
 */

import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon, IdCardIcon, PhoneIcon, UserRoundIcon } from "lucide-react"

import { Alerta } from "@/components/base/alerta"
import { Tarjeta } from "@/components/base/tarjeta"
import {
  FormularioDatosPerfil,
  type ValoresDatosPerfil,
} from "@/components/perfiles/formulario-datos-perfil"
import { calcularEdad } from "@/lib/perfiles/edad"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

export const metadata: Metadata = {
  title: "Mis datos — Historial Médico",
}

export default async function PaginaDatosPerfil({
  searchParams,
}: {
  searchParams: Promise<{ guardada?: string }>
}) {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = activo
  const { guardada } = await searchParams

  const edad = calcularEdad(perfil.date_of_birth)

  const valoresIniciales: ValoresDatosPerfil = {
    fullName: perfil.full_name,
    dateOfBirth: perfil.date_of_birth ?? "",
    nationalId: perfil.national_id ?? "",
    phone: perfil.phone ?? "",
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 chica:gap-3 chica:py-3">
      <Link
        href="/inicio"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Volver al inicio
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          <UserRoundIcon className="size-6 shrink-0 text-primary" aria-hidden="true" />
          Mis datos
        </h1>
        <p className="text-base text-muted-foreground">
          {permisos.esPropio
            ? "Tu nombre, fecha de nacimiento, DNI y teléfono."
            : `Nombre, fecha de nacimiento, DNI y teléfono de ${perfil.full_name}.`}
        </p>
        {edad !== null && (
          <p className="text-sm text-muted-foreground">Edad actual: {edad} años.</p>
        )}
      </div>

      {guardada === "1" && (
        <Alerta variante="exito" titulo="Datos guardados">
          Ya se actualizaron en la ficha SOS, la ficha para el médico y el resto de la app.
        </Alerta>
      )}

      {permisos.canManage ? (
        <FormularioDatosPerfil valoresIniciales={valoresIniciales} />
      ) : (
        <DatosSoloLectura valores={valoresIniciales} edad={edad} />
      )}
    </div>
  )
}

/**
 * Vista de solo lectura para quien tiene `can_view` o `can_upload` pero no
 * `can_manage`. Mismos fallbacks en español que `components/sos/ficha-sos.tsx`
 * ("no registrado"), para que el mismo dato ausente se lea igual en las dos
 * pantallas.
 */
function DatosSoloLectura({
  valores,
  edad,
}: {
  valores: ValoresDatosPerfil
  edad: number | null
}) {
  return (
    <>
      <Tarjeta className="gap-3 chica:gap-2">
        <Fila icono={<UserRoundIcon aria-hidden="true" />} etiqueta="Nombre completo" valor={valores.fullName} />
        <Fila
          icono={<UserRoundIcon aria-hidden="true" />}
          etiqueta="Fecha de nacimiento"
          valor={
            valores.dateOfBirth
              ? `${valores.dateOfBirth} (${edad} ${edad === 1 ? "año" : "años"})`
              : "No registrada"
          }
        />
        <Fila
          icono={<IdCardIcon aria-hidden="true" />}
          etiqueta="DNI"
          valor={valores.nationalId || "No registrado"}
        />
        <Fila
          icono={<PhoneIcon aria-hidden="true" />}
          etiqueta="Teléfono"
          valor={valores.phone || "No registrado"}
        />
      </Tarjeta>

      <Alerta variante="info">
        Solo quien administra este perfil puede editar estos datos.
      </Alerta>
    </>
  )
}

function Fila({
  icono,
  etiqueta,
  valor,
}: {
  icono: ReactNode
  etiqueta: string
  valor: string
}) {
  return (
    <div className="flex items-start gap-3 px-(--card-spacing)">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-5">{icono}</span>
      <div className="flex flex-col">
        <p className="text-sm text-muted-foreground">{etiqueta}</p>
        <p className="text-base font-medium text-foreground">{valor}</p>
      </div>
    </div>
  )
}
