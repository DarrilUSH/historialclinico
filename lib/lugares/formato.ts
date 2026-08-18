/**
 * Presentación de un centro del catálogo REFES (Sprint 16, tarea 16.3).
 * Lógica pura, testeada en `tests/unit/lugares-formato.test.ts`.
 */

import { direccionCompleta } from "@/lib/ubicacion/formato"

/** Lo mínimo que estas funciones necesitan de una fila de `health_centers`. */
export interface CentroParaMostrar {
  name: string
  address?: string | null
  locality_name?: string | null
  department_name?: string | null
  province?: string | null
  province_refes?: string | null
  postal_code?: string | null
  website?: string | null
  typology_name?: string | null
  typology_code?: string | null
  latitude?: number | null
  longitude?: number | null
}

/**
 * Dirección completa del centro en una línea, con el MISMO armado que usan
 * los turnos y el directorio de médicos (`lib/ubicacion/formato.ts`): calle,
 * ciudad y provincia, salteando lo que falte.
 *
 * La provincia que se muestra es la CANÓNICA (`province`) y no la del REFES:
 * "Ciudad Autónoma de Buenos Aires" en vez de "CABA", "Tierra del Fuego,
 * Antártida e Islas del Atlántico Sur" en vez de "TIERRA DEL FUEGO". Es la
 * misma que va a quedar guardada en el turno si la persona elige este centro,
 * así que mostrar otra sería mentirle sobre lo que está por pasar. Si el mapa
 * no reconoció la jurisdicción (`province` en `null`), cae en la del REFES:
 * un nombre en mayúsculas es mejor que ningún nombre.
 */
export function direccionDelCentro(centro: CentroParaMostrar): string | null {
  return direccionCompleta({
    direccion: centro.address,
    ciudad: centro.locality_name,
    provincia: centro.province ?? centro.province_refes,
  })
}

/**
 * URL navegable del sitio web del centro, o `null` si no tiene.
 *
 * El REFES publica los sitios SIN esquema ("www.tcba.com.ar",
 * "paideianet.com.ar": los 2.824 que tienen sitio, ninguno con `http://`).
 * Un `<a href="www.tcba.com.ar">` es un enlace RELATIVO: el navegador lo
 * resolvería contra el dominio de la app y llevaría a una pantalla de error
 * propia. Se les antepone `https://` -no `http://`: cualquier sitio vivo en
 * 2026 lo soporta, y arrancar en claro para que el servidor redirija es
 * regalar una ventana de intercepción-.
 *
 * Un valor que ya trae esquema se respeta tal cual, y cualquier otro esquema
 * (`javascript:`, `data:`, `mailto:`) se descarta: este texto viene de un
 * archivo externo, y aunque hoy sea un registro público del Estado, no es una
 * fuente sobre la que este proyecto tenga control.
 */
export function urlSitioWeb(sitio: string | null | undefined): string | null {
  const valor = (sitio ?? "").trim()
  if (valor.length === 0) return null

  const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(valor) ? valor : `https://${valor}`

  let url: URL
  try {
    url = new URL(conEsquema)
  } catch {
    return null
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  return url.toString()
}

/**
 * Etiqueta corta del tipo de establecimiento para la tarjeta ("Alto riesgo
 * con terapia intensiva", "Laboratorio de Análisis Clínicos"). El REFES
 * repite el mismo nombre bajo siglas distintas -"Bajo riesgo con internación
 * simple" existe en ESCIG, ESCIE, ESCIEP, ESCIEM, ESCIESM y ESCIETE-, así
 * que la sigla se agrega entre paréntesis solo cuando hay nombre: sin ella,
 * dos centros muy distintos se verían idénticos.
 */
export function tipoDelCentro(centro: CentroParaMostrar): string | null {
  const nombre = (centro.typology_name ?? "").trim()
  const sigla = (centro.typology_code ?? "").trim()

  if (nombre.length === 0) return sigla.length > 0 ? sigla : null
  return sigla.length > 0 ? `${nombre} (${sigla})` : nombre
}

/**
 * Texto sobre el que corre el matcher del autocompletar de "Lugar"
 * (`lib/lugares/coincidencias.ts#centroCoincide`).
 *
 * Incluye las MISMAS partes que `health_centers.search_text` -nombre,
 * localidad, departamento y provincia-, y no solo el nombre. El servidor ya
 * filtró por esa columna: si el filtro del cliente mirara únicamente el
 * nombre, volvería a descartar los resultados que hicieron match por
 * localidad, y tipear "ushuaia" traería centros del servidor que el
 * desplegable mostraría como "sin coincidencias". Es la misma idea de "las
 * dos puntas usan el mismo criterio" que documenta
 * `lib/lugares/normalizar.ts`.
 */
export function textoCoincidenciaCentro(centro: CentroParaMostrar): string {
  return [
    centro.name,
    centro.locality_name,
    centro.department_name,
    centro.province ?? centro.province_refes,
  ]
    .filter((parte): parte is string => Boolean(parte && parte.trim().length > 0))
    .join(" ")
}
