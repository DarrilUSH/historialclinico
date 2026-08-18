/**
 * Parser de CSV para el catálogo REFES (Sprint 16, tarea 16.3). Lógica pura,
 * sin Node ni React, testeada en `tests/unit/csv-refes.test.ts` con líneas
 * reales del archivo del Ministerio.
 *
 * ## Por qué un parser de verdad y no `split(",")`
 *
 * El CSV del REFES **entrecomilla los campos de forma irregular**: en la misma
 * fila conviven campos con comillas y campos sin comillas, sin ningún patrón
 * (medido sobre la edición de diciembre de 2025: las 36.046 filas de datos
 * mezclan las dos formas). Una fila real:
 *
 *     "15062032307579",HOGAR DE ANCIANOS HORACIO CARLOS COOK,"06203050000",
 *     HUANGUELEN,"06",BUENOS AIRES,...,"7545","30 e/ 5 Y 6",,-61.93,-37.05
 *
 * Y 1.248 campos del archivo tienen una COMA adentro de las comillas
 * ("Ruta Panamericana Colectora Este Km 48,5 1° Piso"). Un `split(",")`
 * partiría esos campos al medio y correría todas las columnas siguientes:
 * el domicilio terminaría en `sitio_web`, la longitud en `latitud`, y el
 * centro quedaría con coordenadas basura o sin ellas. Por eso acá hay una
 * máquina de estados con el estado "dentro de comillas", que es lo mínimo
 * que exige RFC 4180.
 *
 * Lo que el archivo NO tiene (verificado sobre el archivo entero, no
 * asumido): comillas escapadas `""` dentro de un campo (0 casos) y saltos de
 * línea dentro de un campo (0 casos). El parser soporta las dos cosas igual
 * -son parte de RFC 4180 y una edición futura podría traerlas-, porque
 * soportarlas cuesta tres líneas y no soportarlas es un bug latente.
 *
 * ## Por qué devuelve "bytes consumidos"
 *
 * La sincronización procesa el archivo por VENTANAS de bytes
 * (`lib/lugares/sincronizacion.ts`): cada tanda pide un rango al objeto
 * guardado en Storage, y la ventana casi siempre corta una fila al medio. El
 * parser devuelve solo las filas COMPLETAS y cuántos bytes ocupan, para que
 * la tanda siguiente arranque exactamente en el borde de la fila que quedó
 * partida. Ese número es lo que hace la sincronización reanudable.
 */

/** Resultado de parsear una ventana del CSV. */
export interface VentanaParseada {
  /** Filas COMPLETAS encontradas en la ventana, cada una como lista de campos. */
  filas: string[][]
  /**
   * Bytes (UTF-8) que ocupan `filas`, incluidos sus terminadores de línea.
   * El byte de arranque de la ventana siguiente es `offsetDeEstaVentana + bytesConsumidos`.
   */
  bytesConsumidos: number
  /** Texto sobrante que no llegó a formar una fila completa (la cola partida). */
  restante: string
}

export interface OpcionesParseo {
  /**
   * `true` cuando esta ventana llega hasta el final del archivo. Entonces la
   * última fila cuenta como completa aunque no termine en salto de línea -un
   * CSV puede no tener línea en blanco final-.
   */
  ultimaVentana?: boolean
}

const CODIFICADOR = new TextEncoder()

/**
 * Parsea una ventana de texto CSV y devuelve las filas completas.
 *
 * El texto tiene que empezar en un BORDE DE FILA (el primer carácter es el
 * primer carácter de una fila). La sincronización lo garantiza por
 * construcción: el offset guardado es siempre el byte siguiente al último
 * terminador de línea consumido.
 */
export function parsearVentanaCsv(texto: string, opciones: OpcionesParseo = {}): VentanaParseada {
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ""
  let enComillas = false
  // Índice (en caracteres) del primer carácter que NO forma parte de una fila
  // completa ya emitida. Arranca en 0 y avanza con cada terminador de línea.
  let corte = 0

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i]

    if (enComillas) {
      if (caracter === '"') {
        if (texto[i + 1] === '"') {
          // Comilla escapada (RFC 4180): `""` adentro de un campo es una `"`.
          campo += '"'
          i += 1
        } else {
          enComillas = false
        }
      } else {
        campo += caracter
      }
      continue
    }

    if (caracter === '"') {
      enComillas = true
      continue
    }

    if (caracter === ",") {
      fila.push(campo)
      campo = ""
      continue
    }

    if (caracter === "\n" || caracter === "\r") {
      // CRLF (lo que usa el archivo del REFES) y LF suelto: los dos cierran
      // fila. El `\r` solitario -clásico de Mac OS 9- también, por las dudas.
      fila.push(campo)
      filas.push(fila)
      fila = []
      campo = ""

      if (caracter === "\r" && texto[i + 1] === "\n") i += 1
      corte = i + 1
      continue
    }

    campo += caracter
  }

  // Cola partida: se descarta y la reprocesa la ventana siguiente... salvo
  // que esta sea la última, donde no hay ventana siguiente que la rescate.
  if (opciones.ultimaVentana && !enComillas && (campo.length > 0 || fila.length > 0)) {
    fila.push(campo)
    filas.push(fila)
    corte = texto.length
  }

  return {
    filas,
    // El prefijo consumido se re-codifica para saber cuántos BYTES ocupa: la
    // ventana viene de un rango de bytes y el offset siguiente también se
    // cuenta en bytes, no en caracteres. Son distintos en cuanto aparece una
    // tilde -y este archivo está lleno de ellas (GUAYMALLÉN, ENTRE RÍOS)-.
    bytesConsumidos: CODIFICADOR.encode(texto.slice(0, corte)).length,
    restante: texto.slice(corte),
  }
}

/**
 * Cuenta las filas de un CSV completo sin construirlas.
 *
 * La usa la tanda de PREPARACIÓN, que ya tiene el archivo entero en memoria:
 * con el total exacto, el velo de espera puede decir "Sincronizando 12.000 de
 * 36.046 centros" con el número real en vez de una estimación que se corrige
 * sola a mitad de camino -y una barra de progreso que se mueve hacia atrás es
 * peor que no tener barra-.
 *
 * Solo lleva el estado "dentro de comillas" y cuenta terminadores de línea:
 * no arma arreglos ni concatena campos, así que sobre los 9 MB del REFES
 * cuesta ~40 ms contra los ~180 ms de parsear el archivo entero, y no deja
 * 36.046 arreglos en el heap de una función serverless.
 *
 * `incluirEncabezado: false` (el default) descuenta la primera línea, que en
 * este CSV son los nombres de columna.
 */
export function contarFilasCsv(
  texto: string,
  opciones: { incluirEncabezado?: boolean } = {},
): number {
  let filas = 0
  let enComillas = false
  let hayContenidoPendiente = false

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i]

    if (enComillas) {
      if (caracter === '"') {
        if (texto[i + 1] === '"') i += 1
        else enComillas = false
      }
      continue
    }

    if (caracter === '"') {
      enComillas = true
      hayContenidoPendiente = true
      continue
    }

    if (caracter === "\n" || caracter === "\r") {
      filas += 1
      hayContenidoPendiente = false
      if (caracter === "\r" && texto[i + 1] === "\n") i += 1
      continue
    }

    hayContenidoPendiente = true
  }

  // Última línea sin salto final (un CSV puede no terminar en línea en blanco).
  if (hayContenidoPendiente) filas += 1

  if (opciones.incluirEncabezado) return filas
  return Math.max(filas - 1, 0)
}
