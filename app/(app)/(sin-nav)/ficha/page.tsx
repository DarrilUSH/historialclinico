/**
 * `/ficha`: hoja de resumen para consulta del perfil activo (Sprint 10, tarea
 * 10.4 — ROADMAP_SPRINTS.md líneas 642-648). Explica qué hace, muestra el
 * aviso de minimización, dispara la generación (10.3) y renderiza la hoja
 * imprimible (`components/ficha/hoja-consulta.tsx`).
 *
 * ## Por qué NO es `app/(app)/ficha/[perfilId]/page.tsx` (el path del roadmap)
 *
 * El roadmap escribe el artefacto como `app/(app)/ficha/[perfilId]/page.tsx`,
 * pero `POST /api/ficha/generar` (tarea 10.3) deliberadamente NO acepta
 * ningún `perfilId`: opera siempre sobre `obtenerPerfilActivo()` -ver el
 * encabezado de `app/api/ficha/generar/route.ts`, "Perfil: SIEMPRE el de la
 * cookie, nunca el del cliente"-, porque aceptar un id del cliente abriría la
 * puerta a pedir la ficha de un perfil ajeno con solo cambiar la URL. Un
 * segmento `[perfilId]` en esta pantalla sería un parámetro que la página
 * leería y nunca usaría -el endpoint lo ignoraría igual-, o peor, una
 * invitación a que alguien lo "conecte" más adelante y reabra el agujero que
 * la tarea 10.3 cerró a propósito. Se documenta el desvío en vez de
 * silenciarlo, mismo criterio que ya aplicaron otras tareas de este roadmap
 * con los route groups `(con-nav)`/`(sin-nav)` (ver el encabezado de
 * `app/(app)/(con-nav)/layout.tsx`).
 *
 * ## Por qué vive en `(sin-nav)` y no en `(sin-nav)`... con nav
 *
 * `(sin-nav)` hoy solo tiene `/perfiles` (el selector, que corre ANTES de que
 * exista un perfil activo). Esta pantalla sí tiene perfil activo, pero la
 * saca del shell con bottom nav a propósito: es una hoja pensada para
 * imprimirse, y cuanto menos "chrome" de la aplicación quede en el árbol que
 * `window.print()` termina mostrando, menos hace falta pelear con
 * `ficha.print.css` para ocultarlo. El único encabezado que agrega esta
 * página (el botón de volver + el título) ya lleva `print:hidden` acá abajo.
 *
 * ## El CSS de impresión se importa como global, y es seguro
 *
 * `ficha.print.css` no es un CSS Module: Next.js permite importar CSS global
 * desde cualquier página o componente del árbol de `app/`
 * (`node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`,
 * sección "Global CSS"). Sus reglas quedan calificadas bajo la clase
 * `.hoja-consulta` (ver el encabezado de ese archivo), así que aunque Next.js
 * empaquete el CSS junto con el resto de la app, no hay forma de que una
 * regla se filtre a otra pantalla.
 *
 * ## Permiso: `can_upload` (mismo piso que exige el endpoint)
 *
 * `POST /api/ficha/generar` revalida `requerirPermiso(perfilId, "upload")`
 * -generar la ficha gasta cuota de Gemini y produce contenido nuevo, igual
 * que la extracción de un documento-. Esta página redirige ANTES de mostrar
 * el botón a quien solo tiene `can_view`: mismo patrón que
 * `app/(app)/(con-nav)/perfil/sos/page.tsx` con `can_manage`. Es guarda de
 * INTERFAZ, no LA guarda: el Route Handler vuelve a exigirlo y es la última
 * palabra.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { ArrowLeftIcon } from "lucide-react"

import { Boton } from "@/components/base/boton"
import { calcularEdad } from "@/lib/perfiles/edad"
import { obtenerPerfilActivo } from "@/lib/perfil-activo"

import { PantallaFicha } from "./pantalla-ficha"
import "./ficha.print.css"

export const metadata: Metadata = {
  title: "Ficha de consulta — Historial Médico",
}

export default async function PaginaFicha() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  if (!activo.permisos.canUpload) {
    redirect("/inicio")
  }

  const { perfil } = activo

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 print:max-w-none print:gap-0 print:p-0">
      <div className="flex items-center gap-3 print:hidden">
        <Boton
          render={<Link href="/inicio" aria-label="Volver a Inicio" />}
          nativeButton={false}
          variant="ghost"
          size="icon"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Boton>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          Ficha de resumen para consulta
        </h1>
      </div>

      <PantallaFicha nombreCompleto={perfil.full_name} edadAnios={calcularEdad(perfil.date_of_birth)} />
    </div>
  )
}
