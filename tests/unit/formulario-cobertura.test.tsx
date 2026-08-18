// @vitest-environment jsdom

/**
 * Tests de regresión del hotfix del **"error de red fantasma"** (reportado
 * desde producción con captura: al guardar una cobertura aparecía la franja
 * roja "No pudimos guardar la cobertura. Revisá tu conexión y probá de nuevo."
 * y la pantalla se quedaba en el formulario — pero la cobertura QUEDABA
 * GUARDADA).
 *
 * ## Qué se rompió y por qué estos tests
 *
 * `crearCobertura`/`actualizarCobertura` se invocan A MANO
 * (`await accion(formData)`), no con `<form action>` ni `useActionState`,
 * porque el formulario arma los blobs de las fotos. En Next 16 una Server
 * Action que hace `redirect()` **rechaza la promesa** de quien la invocó
 * -es el mecanismo por el que el runtime propaga la orden de navegar
 * (`server-action-reducer.js`: `reject(redirectError)` incondicional cuando
 * hay `redirectLocation`)-. Ese rechazo caía en el `catch` genérico del
 * formulario, que lo confundía con una red caída.
 *
 * El arreglo es que estas dos acciones **no redirigen**: devuelven
 * `{ ok: true, destino }` y el cliente navega con `router.push`. Así el camino
 * feliz RESUELVE y el `catch` vuelve a significar una sola cosa.
 *
 * Los dos `describe` de abajo cubren las dos mitades del contrato:
 * el componente (que no debe pintar error en éxito) y las acciones (que no
 * deben volver a redirigir).
 *
 *   npm run test -- formulario-cobertura
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
const crearCobertura = vi.fn()
const actualizarCobertura = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/app/(app)/(con-nav)/coberturas/actions", () => ({
  crearCobertura: (...args: unknown[]) => crearCobertura(...args),
  actualizarCobertura: (...args: unknown[]) => actualizarCobertura(...args),
}))

// El campo de foto abre cámara/galería y comprime en el dispositivo: nada de
// eso hace falta acá, y arrastraría APIs que jsdom no tiene.
vi.mock("@/components/coberturas/campo-imagen-credencial", () => ({
  CampoImagenCredencial: ({ label }: { label: string }) => <div>{label}</div>,
}))

const { FormularioCobertura } = await import("@/components/coberturas/formulario-cobertura")

const TEXTO_ERROR_RED = "No pudimos guardar la cobertura. Revisá tu conexión y probá de nuevo."

function completarYEnviar() {
  fireEvent.change(screen.getByLabelText(/Obra social o prepaga/i), {
    target: { value: "OSDE" },
  })
  fireEvent.click(screen.getByRole("button", { name: /Guardar cobertura/i }))
}

beforeEach(() => {
  push.mockReset()
  crearCobertura.mockReset()
  actualizarCobertura.mockReset()
})

afterEach(() => {
  cleanup()
})

describe("FormularioCobertura — el guardado exitoso no puede parecer un error de red", () => {
  it("con `{ ok: true }` navega al destino y NO pinta la franja roja", async () => {
    crearCobertura.mockResolvedValue({ ok: true, destino: "/coberturas?creada=1" })

    render(<FormularioCobertura modo="crear" />)
    completarYEnviar()

    await waitFor(() => expect(push).toHaveBeenCalledWith("/coberturas?creada=1"))
    expect(screen.queryByText(TEXTO_ERROR_RED)).toBeNull()
  })

  it("en modo editar navega al destino de la edición", async () => {
    actualizarCobertura.mockResolvedValue({ ok: true, destino: "/coberturas?editada=1" })

    render(
      <FormularioCobertura
        modo="editar"
        coberturaId="aa0e8400-e29b-41d4-a716-446655440001"
        valoresIniciales={{ proveedor: "PAMI" }}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Guardar cambios/i }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/coberturas?editada=1"))
    expect(screen.queryByText(TEXTO_ERROR_RED)).toBeNull()
  })

  it("un error de negocio se muestra tal cual y NO navega", async () => {
    crearCobertura.mockResolvedValue({
      ok: false,
      error: "Ya cargaste una cobertura con ese mismo proveedor y número de afiliado.",
    })

    render(<FormularioCobertura modo="crear" />)
    completarYEnviar()

    await waitFor(() =>
      expect(
        screen.getByText(/Ya cargaste una cobertura con ese mismo proveedor/i),
      ).toBeTruthy(),
    )
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByText(TEXTO_ERROR_RED)).toBeNull()
  })

  it("una caída REAL de la request sí muestra el mensaje de conexión", async () => {
    // Lo único que debe llegar al `catch`: la request que no llegó.
    crearCobertura.mockRejectedValue(new TypeError("Failed to fetch"))

    render(<FormularioCobertura modo="crear" />)
    completarYEnviar()

    await waitFor(() => expect(screen.getByText(TEXTO_ERROR_RED)).toBeTruthy())
    expect(push).not.toHaveBeenCalled()
  })

  it("la guardia contra el doble toque sigue en pie (hotfix 6758b44)", async () => {
    let resolver: (v: unknown) => void = () => {}
    crearCobertura.mockReturnValue(
      new Promise((res) => {
        resolver = res
      }),
    )

    render(<FormularioCobertura modo="crear" />)
    const boton = screen.getByRole("button", { name: /Guardar cobertura/i })
    fireEvent.change(screen.getByLabelText(/Obra social o prepaga/i), {
      target: { value: "OSDE" },
    })

    // Dos toques en la MISMA pasada, antes de cualquier re-render.
    fireEvent.click(boton)
    fireEvent.click(boton)

    expect(crearCobertura).toHaveBeenCalledTimes(1)
    resolver({ ok: true, destino: "/coberturas?creada=1" })
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1))
  })
})

/**
 * La otra mitad del contrato, y la que impide que el bug vuelva por la puerta
 * de atrás: si alguien devuelve un `redirect()` a estas acciones, el rechazo
 * de la promesa vuelve a caer en el `catch` del cliente y la franja roja
 * reaparece sobre un guardado exitoso. Los tests de arriba seguirían pasando
 * (mockean la acción), así que esta guarda mira el CÓDIGO REAL.
 */
describe("las acciones invocadas a mano NO pueden redirigir", () => {
  const raiz = path.resolve(__dirname, "../..")

  /** Cuerpo de una función exportada, sin comentarios (para no contar los que NOMBRAN a `redirect()`). */
  function cuerpoDe(rutaRelativa: string, nombre: string): string {
    const fuente = readFileSync(path.join(raiz, rutaRelativa), "utf8")
    const inicio = fuente.indexOf(`export async function ${nombre}`)
    expect(inicio, `no se encontró ${nombre} en ${rutaRelativa}`).toBeGreaterThan(-1)
    const resto = fuente.slice(inicio + 1)
    const siguiente = resto.indexOf("\nexport ")
    const cuerpo = siguiente === -1 ? resto : resto.slice(0, siguiente)
    return cuerpo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  }

  it.each([
    ["app/(app)/(con-nav)/coberturas/actions.ts", "crearCobertura"],
    ["app/(app)/(con-nav)/coberturas/actions.ts", "actualizarCobertura"],
    ["app/(app)/(con-nav)/estudios/actions.ts", "subirDocumento"],
  ])("%s#%s no llama a redirect()", (archivo, nombre) => {
    expect(cuerpoDe(archivo, nombre)).not.toMatch(/\bredirect\s*\(/)
  })

  it("las acciones de `useActionState` SÍ pueden seguir redirigiendo", () => {
    // Control negativo: si esta afirmación empieza a fallar es que el test de
    // arriba dejó de mirar lo que cree mirar.
    expect(cuerpoDe("app/(app)/(con-nav)/coberturas/actions.ts", "eliminarCobertura")).toMatch(
      /\bredirect\s*\(/,
    )
  })
})
