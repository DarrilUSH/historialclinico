/**
 * Tipos y estados iniciales de las Server Actions de la bandeja de Gmail
 * (Sprint 17, tarea 17.2).
 *
 * **Viven acá y no en `app/(app)/(con-nav)/perfil/gmail/actions.ts`, y no es
 * una cuestión de orden.** Un archivo con `"use server"` solo puede exportar
 * funciones asíncronas: cualquier otra cosa -un objeto de estado inicial, una
 * constante- hace que Next falle **en tiempo de ejecución**, con
 * `A "use server" file can only export async functions, found object`, cuando
 * se invoca la acción. El `build` de producción NO lo detecta. La lección ya
 * está pagada en el Sprint 17: pasó con `ESTADO_GMAIL_INICIAL` en la tarea
 * 17.1, tocando "Sí, desconectar" en el teléfono real (ver el comentario de
 * `lib/gmail/conexion.ts`).
 *
 * Este archivo NO importa nada de servidor: lo leen tanto las acciones como
 * los componentes cliente que las invocan con `useActionState`.
 */

/** Estado de "Buscar ahora": el resultado de una pasada, en una frase. */
export interface EstadoBusquedaGmail {
  error: string | null
  /** Frase en castellano con lo que encontró la pasada (`fraseDeResultado`). */
  mensaje: string | null
  /** Cuántos correos quedaron esperando revisión después de la pasada. */
  pendientes: number
}

export const ESTADO_BUSQUEDA_INICIAL: EstadoBusquedaGmail = {
  error: null,
  mensaje: null,
  pendientes: 0,
}

/**
 * Estado compartido por las acciones que operan sobre UN correo o UN filtro
 * (descartar, reabrir, aprender remitente, sacar filtro, ingerir un adjunto).
 *
 * Es uno solo para las cinco a propósito: todas tienen la misma forma de
 * respuesta -salió o no salió, y una frase para mostrar- y un tipo por acción
 * sería cinco veces lo mismo con cinco nombres distintos.
 */
export interface EstadoCorreoGmail {
  error: string | null
  mensaje: string | null
  /**
   * Solo lo llena `ingerirAdjuntoDeCorreo` (hotfix de huella digital, Sprint
   * 17 en vivo): `ingerirAdjuntoDeGmail` encontró un documento idéntico ya
   * cargado en el perfil y NO creó nada. La bandeja muestra la franja "Este
   * archivo es idéntico a…" con "Ver ese estudio" y "Cargar igual" -esta
   * última reenvía `correoId`/`adjuntoId` con `forzar=1`-. Opcional -y no
   * `duplicado: null` obligatorio en cada return- porque las otras cuatro
   * acciones (descartar, reabrir, aprender remitente, sacar filtro) no tienen
   * nada que decir acá: para ellas, `undefined` y `null` significan lo mismo
   * ("no hay duplicado que mostrar").
   */
  duplicado?: {
    correoId: string
    adjuntoId: string
    documentoId: string
    titulo: string
    fechaTexto: string
  } | null
}

export const ESTADO_CORREO_INICIAL: EstadoCorreoGmail = {
  error: null,
  mensaje: null,
  duplicado: null,
}
