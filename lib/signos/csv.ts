/**
 * Generador de CSV para exportación de signos vitales (Sprint 9, tarea 9.5).
 * Función pura: recibe mediciones parseadas y arma el contenido completo del
 * CSV (con BOM UTF-8 incluido para Excel de Windows), listo para responder en
 * una ruta de descarga.
 *
 * Separador: `;` (estándar es-AR, Excel lo sabe sin configuración adicional).
 * Decimales: coma (es-AR).
 * Encabezados: español.
 * BOM: siempre incluido (ruta `/api/signos/export` responde con `text/csv;
 * charset=utf-8` y el BOM al inicio del stream).
 */

import type { SignoTipo } from "@/lib/signos/tipos"

/**
 * Una medición parseada, lista para CSV. Todos los campos vienen ya tipados y
 * formateados (decimales con coma, ISO string de fecha/hora).
 */
export interface MedicionParaCSV {
  fecha: string // "14/08/2026" (dd/mm/yyyy, zona Ushuaia)
  hora: string // "15:30" (hh:mm, zona Ushuaia)
  // Tensión
  sistolica?: number | null
  diastolica?: number | null
  pulso?: number | null
  // Glucemia o peso
  valor?: number | null
}

/**
 * Encabezados por tipo de signo, en español. Cada tipo tiene un layout diferente.
 */
function encabezadosPorTipo(tipo: SignoTipo): string[] {
  switch (tipo) {
    case "tension":
      return ["Fecha", "Hora", "Sistólica (mmHg)", "Diastólica (mmHg)", "Pulso (lat/min)"]
    case "glucemia":
      return ["Fecha", "Hora", "Valor (mg/dL)"]
    case "peso":
      return ["Fecha", "Hora", "Peso (kg)"]
  }
}

/**
 * Escapa caracteres especiales en un valor CSV: comillas dobles, punto y coma,
 * saltos de línea. Regla: si el valor contiene `;`, `"` o salto de línea, se
 * rodea de comillas y cualquier comilla dentro se duplica (RFC 4180).
 */
function escaparCSV(valor: string): string {
  if (valor.includes(";") || valor.includes('"') || valor.includes("\n")) {
    return `"${valor.replace(/"/g, '""')}"` // Duplicar comillas y rodear de comillas
  }
  return valor
}

/**
 * Formatea un número con decimales usando coma (es-AR): "70,5" no "70.5".
 * Si el valor es null/undefined, devuelve guión.
 */
function formatearDecimal(valor: number | null | undefined): string {
  if (valor == null) return "—"
  return valor.toString().replace(".", ",")
}

/**
 * Una fila CSV completa (escapeada) para una medición. El layout depende del
 * tipo de signo.
 */
function filaCSV(tipo: SignoTipo, medicion: MedicionParaCSV): string {
  const valores: string[] = [escaparCSV(medicion.fecha), escaparCSV(medicion.hora)]

  switch (tipo) {
    case "tension": {
      valores.push(
        formatearDecimal(medicion.sistolica),
        formatearDecimal(medicion.diastolica),
        medicion.pulso != null ? medicion.pulso.toString() : "—",
      )
      break
    }
    case "glucemia": {
      valores.push(formatearDecimal(medicion.valor))
      break
    }
    case "peso": {
      valores.push(formatearDecimal(medicion.valor))
      break
    }
  }

  return valores.join(";")
}

/**
 * Genera el contenido completo de un archivo CSV (UTF-8 con BOM) para una
 * serie de mediciones de signos vitales.
 *
 * - Primera línea: BOM UTF-8 (`﻿`, será `EF BB BF` en bytes).
 * - Segunda línea: encabezados separados por `;`.
 * - Líneas siguientes: una medición por línea, valores en orden.
 * - Decimales con coma (es-AR).
 * - Sin trailing newline al final.
 *
 * @param tipo Tipo de signo ("tension", "glucemia", "peso").
 * @param mediciones Lista de mediciones ordenadas (típicamente ascendente por
 *   fecha para que el CSV lea de viejo a reciente).
 * @returns String listo para responder en `GET /api/signos/export` con
 *   `Content-Type: text/csv; charset=utf-8` y `Content-Disposition: attachment`.
 */
export function generarCSVSignos(tipo: SignoTipo, mediciones: MedicionParaCSV[]): string {
  const encabezados = encabezadosPorTipo(tipo)
  const lineas = [encabezados.map(escaparCSV).join(";")]

  for (const medicion of mediciones) {
    lineas.push(filaCSV(tipo, medicion))
  }

  // BOM UTF-8 al inicio (será EF BB BF en el stream de bytes).
  return "﻿" + lineas.join("\n")
}
