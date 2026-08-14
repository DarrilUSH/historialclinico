/**
 * Vocabulario compartido del modo de letra (Sprint 13).
 *
 * Este módulo **no** lleva `server-only` a propósito: lo importan tanto la
 * resolución de servidor (`lib/densidad/servidor.ts`) como el botón A/a del
 * encabezado, que es un Client Component. Todo lo que hay acá es constantes y
 * predicados puros —ni una consulta, ni una cookie, ni un secreto—, así que
 * cruzar la frontera cliente/servidor no cuesta nada ni expone nada.
 *
 * La contracara de esa regla: si alguna vez algo de acá necesita tocar la base
 * o `next/headers`, no se agrega acá — se agrega en `servidor.ts`.
 */

import type { Tamano } from "@/types/dominio"

export type { Tamano }

/**
 * El modo por defecto es el GRANDE, y no es una casualidad de implementación.
 * Toda la app se diseñó para adultos mayores (ROADMAP, "Senior UX"); el modo
 * compacto es una opción para quien ve bien y la pide explícitamente. Quien
 * nunca eligió nada —o entró en un dispositivo nuevo, o todavía no inició
 * sesión— ve el modo pensado para el caso más exigente.
 *
 * El mismo valor está como `DEFAULT` de `profiles.display_density`
 * (supabase/migrations/20260814120000_preferencia_tamano.sql §2). Los dos
 * lados dicen lo mismo y `tests/unit/densidad.test.ts` lo verifica contra el
 * enum generado.
 */
export const TAMANO_POR_DEFECTO: Tamano = "grande"

/**
 * Cookie espejo httpOnly de la preferencia.
 *
 * **La fuente de verdad es la fila de `profiles`**, no esta cookie: la cookie
 * existe para que el layout raíz -que corre en CADA request de CADA ruta,
 * incluidas las anónimas- pueda resolver el atributo `data-tamano` sin pagar
 * un viaje a la base. Se sincroniza en los tres momentos en que la base es
 * autoritativa: al iniciar sesión, al registrarse y al cambiar la preferencia.
 * Se borra al cerrar sesión, por el mismo motivo que la de perfil activo: en
 * un navegador compartido, la próxima persona no hereda nada de la anterior.
 *
 * `httpOnly` aunque no sea un secreto: el atributo lo pinta el servidor, así
 * que el cliente no necesita leerla, y dejarla fuera del alcance de cualquier
 * script es gratis. El botón A/a no la toca —cambia el atributo del DOM para
 * el efecto inmediato y deja que la Server Action actualice la cookie—.
 *
 * Consecuencia declarada de que la cookie tenga prioridad: **un cambio hecho
 * en otro dispositivo se ve en éste recién en el próximo inicio de sesión.**
 * Es el comportamiento correcto para una preferencia de interfaz (nadie
 * espera que se le achique la letra en el celular porque tocó un botón en la
 * computadora) y es lo que hace que la resolución sea gratis. Ver
 * docs/densidad.md §3.
 */
export const COOKIE_TAMANO = "tamano"

/** Atributo de `<html>` que gobierna los tokens de `app/globals.css` §5. */
export const ATRIBUTO_TAMANO = "data-tamano"

/**
 * Copy de los dos modos, en un `Record<Tamano, ...>` para que el compilador
 * exija completarlo si algún día el enum de la base crece: agregar un valor a
 * `display_density` deja este objeto en rojo, y con él `TAMANOS`, la pregunta
 * del selector y el botón del encabezado. Es la red que justifica que la base
 * use un enum de verdad y no `text` + CHECK.
 *
 * `glifo` es la "A" grande y la "a" chica del conmutador. Va aparte de la
 * etiqueta porque se pinta con `aria-hidden`: es una imagen hecha de letras,
 * no un texto que un lector de pantalla deba leer.
 */
export const MODOS: Record<Tamano, { glifo: string; etiqueta: string; descripcion: string }> = {
  grande: {
    glifo: "A",
    etiqueta: "Letra grande",
    descripcion: "Textos y botones amplios, cómodos para leer.",
  },
  chica: {
    glifo: "a",
    etiqueta: "Letra chica",
    descripcion: "Todo más compacto: entra más información en pantalla.",
  },
}

/** Los dos modos, en el orden en que se ofrecen (el default primero). */
export const TAMANOS = Object.keys(MODOS) as Tamano[]

/**
 * ¿Este valor suelto es un modo válido?
 *
 * Se usa en los tres bordes por los que puede entrar basura: el valor de la
 * cookie (el navegador la manda y se puede editar), el `FormData` del
 * conmutador y lo que devuelve la base. Nunca se confía en ninguno de los
 * tres: un valor que no sea exactamente `"grande"` o `"chica"` se trata como
 * "no hay preferencia" y cae al default, sin lanzar. Un modo de letra
 * inválido no es motivo para romperle la pantalla a nadie.
 */
export function esTamano(valor: unknown): valor is Tamano {
  return typeof valor === "string" && Object.hasOwn(MODOS, valor)
}

/** El otro modo. Lo usa el botón A/a, que alterna en vez de elegir. */
export function alternar(tamano: Tamano): Tamano {
  return tamano === "grande" ? "chica" : "grande"
}
