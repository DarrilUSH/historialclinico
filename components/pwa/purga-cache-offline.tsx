"use client"

/**
 * Borra del dispositivo las cachés offline con datos personales (Sprint 8,
 * tarea 8.4). Se monta en `/login` y no pinta nada.
 *
 * El razonamiento completo de por qué la purga cuelga de `/login` y no del
 * botón "Cerrar sesión" está en `lib/pwa/registrar-sw.ts#purgarCacheOffline`.
 * En una línea: a `/login` se llega también cuando la sesión vence sola, y ese
 * caso —en el que nadie tocó ningún botón— es precisamente el que un handler
 * de logout no cubriría.
 */

import * as React from "react"

import { purgarCacheOffline } from "@/lib/pwa/registrar-sw"

export function PurgaCacheOffline() {
  React.useEffect(() => {
    void purgarCacheOffline()
  }, [])

  return null
}
