/**
 * Coincidencia de texto para el autocompletar de especialidades (Sprint 16,
 * tarea 16.2). Lógica pura, sin React ni `@base-ui/react`, para poder
 * testearla sin montar ningún componente
 * (`tests/unit/coincidencias-especialidad.test.ts`).
 *
 * ## Por qué una copia local en vez del filtro por defecto de la librería
 *
 * `@base-ui/react/autocomplete` YA filtra con un criterio insensible a
 * tildes/mayúsculas por defecto (usa `Intl.Collator` con
 * `sensitivity: "base"` internamente). Se podría confiar en ese default y no
 * escribir nada acá. Se elige, a propósito, pasar un `filter` explícito
 * (`components/base/campo-autocompletar.tsx`,
 * `components/medicos/formulario-medico.tsx`) que llama a esta función en
 * vez de depender del comportamiento interno de la librería:
 *
 * 1. **Auditable**: el criterio de "qué especialidad matchea qué tecleo"
 *    queda escrito y testeado en un archivo de este repo, no enterrado en
 *    `node_modules`. Si una futura versión de `@base-ui/react` cambia su
 *    default (o dejara de ofrecerlo), el autocompletar de esta app no se
 *    entera.
 * 2. **Mismo criterio en toda la app**: si mañana se necesita el mismo
 *    matching en otro lugar (por ejemplo, para resaltar la especialidad
 *    tecleada dentro de un resultado ya guardado), esta función se importa
 *    sin depender de montar un `<Autocomplete>`.
 *
 * ## El algoritmo: `Intl.Collator` con `sensitivity: "base"`, substring
 *
 * `sensitivity: "base"` hace que el collator trate como iguales las
 * variantes de acentuación y de mayúscula/minúscula de un mismo carácter
 * base (`a` = `á` = `A` = `Á`), que es exactamente "insensible a
 * tildes/mayúsculas" (criterio de aceptación de la tarea: "cardio" encuentra
 * "Cardiología"). La búsqueda es por SUBCADENA en cualquier posición
 * (`contains`), no solo al principio (`startsWith`): "cardio" matchea el
 * PREFIJO de "Cardiología", pero también "clinica" matchearía el MEDIO de
 * "Clínica Médica" si apareciera ahí — más generoso que un autocompletar que
 * solo complete por prefijo, y el criterio que pide la tarea.
 */

const COLLATOR = new Intl.Collator("es-AR", {
  sensitivity: "base",
  usage: "search",
  ignorePunctuation: true,
})

/**
 * `true` si `consulta` aparece en algún lugar de `etiqueta`, comparando sin
 * distinguir tildes ni mayúsculas/minúsculas. Una `consulta` vacía (o solo
 * espacios) matchea cualquier `etiqueta` -mismo criterio que el filtro por
 * defecto de `@base-ui/react`: sin texto tecleado, todo el catálogo es una
 * sugerencia válida-.
 */
export function especialidadCoincide(etiqueta: string, consulta: string): boolean {
  const query = consulta.trim()
  if (query.length === 0) return true
  if (query.length > etiqueta.length) return false

  for (let inicio = 0; inicio <= etiqueta.length - query.length; inicio += 1) {
    const ventana = etiqueta.slice(inicio, inicio + query.length)
    if (COLLATOR.compare(ventana, query) === 0) return true
  }

  return false
}
