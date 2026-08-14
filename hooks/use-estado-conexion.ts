/**
 * Hook client que detecta si el navegador tiene conexión de red.
 *
 * Usa `navigator.onLine` con listeners para los eventos `online` y `offline`.
 * En servidor retorna siempre `true` (asume conexión en renders SSR).
 *
 * ## Cleanup automático
 *
 * Los listeners se removen al desmontar el componente, y el estado se
 * actualiza atomáticamente sin renders intermedios: un cambio a `online`
 * no genera dos renders ("desconectado" → "conectado").
 */

"use client"

import { useEffect, useState } from "react"

/**
 * Estado de conexión del navegador.
 *
 * @returns `true` si hay conexión; `false` si está offline. En servidor SSR
 *   retorna siempre `true` (sin conexión no se puede renderizar el árbol de
 *   React en el servidor).
 */
export function useEstadoConexion(): boolean {
  // Inicializar con el estado real del navegador (si existe), o `true` en
  // servidor. Evita el mismatch entre server y client si se hidrata offline
  // (improbable, pero si pasa este hook retorna el estado actual real).
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return true
    }
    return navigator.onLine
  })

  useEffect(() => {
    // Handlers de los eventos del navegador.
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    // Registrar listeners.
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Cleanup: remover los listeners al desmontar el componente.
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return online
}
