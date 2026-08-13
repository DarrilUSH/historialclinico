"use client"

/**
 * Página de revisión visual (kitchen sink) del sistema de diseño "Salvia y Ámbar".
 *
 * Solo en desarrollo. Auto-bloqueada en producción con notFound().
 * Muestra: tipografía, paleta de colores, componentes base en sus estados,
 * primitivos UI, y un ejemplo de búsqueda con dictado.
 *
 * Responsiva: verificada en 375px (mobile) y 1280px (desktop).
 */

import { notFound } from "next/navigation"
import Link from "next/link"
import * as React from "react"

import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoNumero } from "@/components/base/campo-numero"
import { CampoTexto } from "@/components/base/campo-texto"
import { DialogoConfirmacion } from "@/components/base/dialogo-confirmacion"
import { Tarjeta, TarjetaInteractiva } from "@/components/base/tarjeta"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchIcon } from "lucide-react"

export default function PaginaEstilos() {
  if (process.env.NODE_ENV === "production") {
    notFound()
  }

  const [dialogoAbierto, setDialogoAbierto] = React.useState(false)
  const [testigo, setTestigo] = React.useState("")

  const accionDestructica = async (formData: FormData) => {
    setTestigo("Acción confirmada en el diálogo")
    setDialogoAbierto(false)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-primary">Estilos</h1>
              <p className="text-sm text-muted-foreground">
                Kitchen sink del sistema "Salvia y Ámbar"
              </p>
            </div>
            <Link
              href="/perfiles"
              className="text-sm text-primary hover:underline"
            >
              Ir a la app
            </Link>
          </div>
        </div>
      </header>

      {/* Contenedor principal */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Índice flotante */}
        <nav className="sticky top-20 mb-12 overflow-x-auto rounded-lg border border-border bg-card p-4 shadow-suave">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Secciones
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { href: "#tipografia", label: "Tipografía" },
              { href: "#colores", label: "Colores" },
              { href: "#botones", label: "Botones" },
              { href: "#campos-texto", label: "Campos de Texto" },
              { href: "#campos-numero", label: "Campos Numéricos" },
              { href: "#tarjetas", label: "Tarjetas" },
              { href: "#alertas", label: "Alertas" },
              { href: "#dialogo", label: "Diálogo" },
              { href: "#busqueda", label: "Búsqueda (Dictado)" },
            ].map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="text-sm text-primary hover:underline"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        {/* ====================================================================
            TIPOGRAFÍA
            ==================================================================== */}
        <section id="tipografia" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Tipografía</h2>
          <p className="mb-6 text-muted-foreground">
            Atkinson Hyperlegible Next (variable, 200-800). Raíz: 18px.
            Interlineado de cuerpo: 1.6. Escala comprimida propositivamente en
            los tamaños chicos: esta app no baja de 16px.
          </p>

          <div className="space-y-6">
            {[
              { clase: "text-xs", token: "text-xs", px: "16px", lineheight: "1.5" },
              { clase: "text-sm", token: "text-sm", px: "17px", lineheight: "1.55" },
              {
                clase: "text-base",
                token: "text-base (defecto)",
                px: "18px",
                lineheight: "1.6",
              },
              { clase: "text-lg", token: "text-lg", px: "21px", lineheight: "1.55" },
              { clase: "text-xl", token: "text-xl", px: "24px", lineheight: "1.4" },
              { clase: "text-2xl", token: "text-2xl", px: "28px", lineheight: "1.3" },
              { clase: "text-3xl", token: "text-3xl", px: "32px", lineheight: "1.22" },
              { clase: "text-4xl", token: "text-4xl", px: "39px", lineheight: "1.15" },
              { clase: "text-5xl", token: "text-5xl", px: "48px", lineheight: "1.1" },
              { clase: "text-6xl", token: "text-6xl", px: "58px", lineheight: "1.05" },
            ].map(({ clase, token, px, lineheight }) => (
              <Tarjeta key={clase}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="flex-1">
                    <p className={clase}>
                      Muestra de texto en tamaño {token}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>{px}</p>
                    <p>line-height: {lineheight}</p>
                  </div>
                </div>
              </Tarjeta>
            ))}
          </div>
        </section>

        {/* ====================================================================
            COLORES
            ==================================================================== */}
        <section id="colores" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Colores</h2>
          <p className="mb-6 text-muted-foreground">
            Todos los valores en OKLCH. Ratios verificados con node
            scripts/verificar-contraste.mjs (WCAG AA: 4.5:1 texto normal,
            3:1 para objetos gráficos).
          </p>

          {/* Superficies y texto */}
          <h3 className="mb-4 text-xl font-semibold">Superficies y texto</h3>
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { nombre: "--background", clase: "bg-background" },
              { nombre: "--card", clase: "bg-card" },
              { nombre: "--popover", clase: "bg-popover" },
              { nombre: "--muted", clase: "bg-muted" },
              { nombre: "--foreground (texto)", clase: "bg-foreground" },
              { nombre: "--muted-foreground (texto)", clase: "bg-muted-foreground" },
            ].map(({ nombre, clase }) => (
              <div
                key={nombre}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className={`size-12 shrink-0 rounded-lg border border-border ${clase}`} />
                <div className="text-sm">
                  <p className="font-mono font-semibold">{nombre}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Marca y acciones */}
          <h3 className="mb-4 text-xl font-semibold">Marca y acciones</h3>
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { nombre: "--primary", clase: "bg-primary" },
              { nombre: "--secondary", clase: "bg-secondary" },
              { nombre: "--accent", clase: "bg-accent" },
            ].map(({ nombre, clase }) => (
              <div
                key={nombre}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className={`size-12 shrink-0 rounded-lg border border-border ${clase}`} />
                <div className="text-sm">
                  <p className="font-mono font-semibold">{nombre}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Estados semánticos */}
          <h3 className="mb-4 text-xl font-semibold">Estados semánticos</h3>
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { nombre: "--destructive", clase: "bg-destructive" },
              { nombre: "--exito", clase: "bg-exito" },
              { nombre: "--advertencia", clase: "bg-advertencia" },
              { nombre: "--sos (emergencia)", clase: "bg-sos" },
            ].map(({ nombre, clase }) => (
              <div
                key={nombre}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className={`size-12 shrink-0 rounded-lg border border-border ${clase}`} />
                <div className="text-sm">
                  <p className="font-mono font-semibold">{nombre}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Avatares */}
          <h3 className="mb-4 text-xl font-semibold">Avatares de perfil</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((num) => (
              <div
                key={num}
                className="flex flex-col items-center gap-2 rounded-lg border border-border p-3"
              >
                <div
                  className={`size-12 rounded-full border-2 border-border bg-avatar-${num}`}
                />
                <p className="text-xs font-mono">--avatar-{num}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ====================================================================
            BOTONES
            ==================================================================== */}
        <section id="botones" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Botones</h2>

          <h3 className="mb-4 text-lg font-semibold">Variantes</h3>
          <div className="mb-8 flex flex-wrap gap-3">
            <Boton variant="default">Default</Boton>
            <Boton variant="secondary">Secundario</Boton>
            <Boton variant="outline">Outline</Boton>
            <Boton variant="ghost">Ghost</Boton>
          </div>

          <h3 className="mb-4 text-lg font-semibold">Destructivo (no tiene onClick)</h3>
          <div className="mb-8">
            <DialogoConfirmacion
              disparador={<Boton variant="destructivo">Eliminar</Boton>}
              titulo="¿Eliminar permanentemente?"
              consecuencia="Esta acción no se puede deshacer."
              textoConfirmar="Sí, eliminar"
              textoCancelar="Cancelar"
              accion={accionDestructica}
              open={dialogoAbierto}
              onOpenChange={setDialogoAbierto}
            >
              Contenido del diálogo
            </DialogoConfirmacion>
          </div>

          <h3 className="mb-4 text-lg font-semibold">Estados</h3>
          <div className="mb-8 flex flex-wrap gap-3">
            <Boton disabled>Deshabilitado</Boton>
            <Boton cargando>Cargando...</Boton>
          </div>

          <h3 className="mb-4 text-lg font-semibold">Tamaños</h3>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <Boton size="sm">Pequeño</Boton>
            <Boton size="default">Default</Boton>
            <Boton size="lg">Grande</Boton>
          </div>

          {testigo && (
            <Alerta variante="exito" className="mb-4">
              {testigo}
            </Alerta>
          )}
        </section>

        {/* ====================================================================
            CAMPOS DE TEXTO
            ==================================================================== */}
        <section id="campos-texto" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Campos de Texto</h2>

          <div className="space-y-6">
            <CampoTexto
              id="campo-normal"
              label="Campo normal"
              placeholder="Ingresá algo"
            />

            <CampoTexto
              id="campo-ayuda"
              label="Con ayuda"
              placeholder="Ejemplo"
              ayuda="Este es un texto de ayuda explicativo."
            />

            <CampoTexto
              id="campo-error"
              label="Con error"
              placeholder="Ejemplo"
              error="Este campo tiene un error de validación."
            />

            <CampoTexto
              id="campo-icono"
              label="Con ícono"
              placeholder="Buscar paciente"
              icono={<SearchIcon />}
            />

            <CampoTexto
              id="campo-sufijo"
              label="Con sufijo (unidad clínica)"
              placeholder="90"
              sufijo="mg/dL"
            />

            <CampoTexto
              id="campo-dictado"
              label="Con botón de dictado"
              placeholder="Di algo..."
              conDictado
            />
          </div>
        </section>

        {/* ====================================================================
            CAMPOS NUMÉRICOS
            ==================================================================== */}
        <section id="campos-numero" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Campos Numéricos</h2>

          <div className="space-y-6">
            <CampoNumero
              id="campo-entero"
              label="Número entero (sin decimales)"
              placeholder="120"
              sufijo="lat/min"
            />

            <CampoNumero
              id="campo-decimal"
              label="Número decimal"
              decimal
              placeholder="75.5"
              sufijo="kg"
            />
          </div>
        </section>

        {/* ====================================================================
            TARJETAS
            ==================================================================== */}
        <section id="tarjetas" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Tarjetas</h2>

          <div className="space-y-6">
            <Tarjeta>
              <h3 className="font-semibold">Tarjeta default</h3>
              <p className="text-sm text-muted-foreground">
                Contenedor visual puro para listas, resúmenes y formularios.
              </p>
            </Tarjeta>

            <TarjetaInteractiva onClick={() => alert("¡Clickeaste una tarjeta!")}>
              <h3 className="font-semibold">Tarjeta interactiva</h3>
              <p className="text-sm text-muted-foreground">
                Se eleva al pasar el mouse, tiene foco visible y cambio de escala
                al hacer click.
              </p>
            </TarjetaInteractiva>

            <Tarjeta variante="destacada">
              <h3 className="font-semibold">Tarjeta destacada</h3>
              <p className="text-sm">
                Realce cálido (ámbar). Se usa para llamar la atención sin que sea
                un botón de acción.
              </p>
            </Tarjeta>
          </div>
        </section>

        {/* ====================================================================
            ALERTAS
            ==================================================================== */}
        <section id="alertas" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Alertas</h2>

          <div className="space-y-4">
            <Alerta variante="info">
              Mensaje informativo. Color nunca es la única señal: siempre tiene
              ícono y texto.
            </Alerta>

            <Alerta variante="exito" titulo="¡Éxito!">
              La operación se completó correctamente. Este es un mensaje de éxito
              con título opcional.
            </Alerta>

            <Alerta variante="advertencia" titulo="Atención">
              Algo requiere atención pero no es un error. Por ejemplo, un
              formulario con campos opcionales.
            </Alerta>

            <Alerta variante="error" titulo="Error">
              Algo salió mal. Este es un error que bloquea la operación o requiere
              acción inmediata del usuario.
            </Alerta>
          </div>
        </section>

        {/* ====================================================================
            DIÁLOGO
            ==================================================================== */}
        <section id="dialogo" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Diálogo de Confirmación</h2>
          <p className="mb-4 text-muted-foreground">
            Para acciones destructivas. El botón "destructivo" no acepta onClick
            — siempre va envuelto en DialogoConfirmacion.
          </p>

          <div className="flex flex-wrap gap-3">
            <DialogoConfirmacion
              disparador={
                <Boton variant="destructivo">Revocar acceso</Boton>
              }
              titulo="¿Revocar el acceso de Carlos?"
              consecuencia="Carlos ya no podrá ver ni modificar la información de este usuario."
              textoConfirmar="Sí, revocar"
              textoCancelar="Cancelar"
              accion={accionDestructica}
            >
              Contenido del diálogo
            </DialogoConfirmacion>
          </div>
        </section>

        {/* ====================================================================
            PRIMITIVOS UI
            ==================================================================== */}
        <section id="primitivos" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Primitivos UI</h2>

          <div className="space-y-6">
            {/* Checkbox */}
            <Tarjeta>
              <div className="flex items-center gap-3">
                <Checkbox id="acepto" />
                <Label htmlFor="acepto" className="cursor-pointer">
                  Aceptar términos y condiciones
                </Label>
              </div>
            </Tarjeta>

            {/* Select */}
            <Tarjeta>
              <Label>Seleccionar tipo de dato</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Elige una opción" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="presion">Presión arterial</SelectItem>
                  <SelectItem value="peso">Peso</SelectItem>
                  <SelectItem value="glucemia">Glucemia</SelectItem>
                </SelectContent>
              </Select>
            </Tarjeta>
          </div>
        </section>

        {/* ====================================================================
            EJEMPLO: BÚSQUEDA CON DICTADO
            ==================================================================== */}
        <section id="busqueda" className="mb-16 scroll-mt-32">
          <h2 className="mb-6 text-3xl font-bold">Ejemplo: Búsqueda con Dictado</h2>
          <p className="mb-6 text-muted-foreground">
            Un caso de uso real donde el dictado es especialmente útil: búsqueda
            de pacientes o medicamentos por nombre.
          </p>

          <Tarjeta>
            <div className="space-y-4">
              <CampoTexto
                id="buscar-paciente"
                label="Buscar paciente"
                placeholder="Escribí o dicta un nombre"
                icono={<SearchIcon />}
                conDictado
              />

              <Boton className="w-full">Buscar</Boton>

              {/* Resultado simulado */}
              <div className="mt-6 rounded-lg border border-borde-sutil bg-muted p-4">
                <p className="text-sm text-muted-foreground">
                  Aquí aparecerían los resultados de la búsqueda.
                </p>
              </div>
            </div>
          </Tarjeta>
        </section>

        {/* Footer */}
        <footer className="mt-16 border-t border-border pt-8 text-center text-sm text-muted-foreground">
          <p>
            Documentación completa:{" "}
            <code className="rounded bg-muted px-2 py-1">
              docs/design-system.md
            </code>
          </p>
          <p className="mt-2">
            Verificación de contraste:{" "}
            <code className="rounded bg-muted px-2 py-1">
              node scripts/verificar-contraste.mjs
            </code>
          </p>
        </footer>
      </div>
    </main>
  )
}
