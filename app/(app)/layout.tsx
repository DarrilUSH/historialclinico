/**
 * Puerta de toda la sección autenticada: el gate de consentimiento del primer
 * ingreso (Sprint 15, tarea 15.2).
 *
 * ## Por qué existe este layout, si los dos route groups ya tienen el suyo
 *
 * `app/(app)/(con-nav)/layout.tsx` y `app/(app)/(sin-nav)/layout.tsx` son
 * SHELLS: dibujan el encabezado, la bottom nav o el `<main>` de cada grupo.
 * Este archivo no dibuja nada -devuelve `children` tal cual, sin envolverlo en
 * ningún elemento, así que el HTML de las pantallas no cambia ni un byte-.
 * Existe porque es el único lugar del árbol por el que pasan **todas** las
 * pantallas con sesión, `/perfiles` incluida, y el gate tiene que cubrir
 * también al selector de perfiles: es la primera pantalla después del login y
 * la que da acceso a todo lo demás.
 *
 * ## Qué gatea
 *
 * Una cuenta GRADUADA (`docs/modelo-permisos.md` §8.6, migración
 * `20260817230000_graduacion.sql`) nace sin ninguna fila de `consents`: hasta
 * la graduación regía el consentimiento de su representante, que habla de él
 * y no se transfiere. Su titular tiene que aceptar la Política de Privacidad y
 * los Términos **él mismo**, y hasta que lo haga no puede usar la aplicación.
 * `cuentaAceptoLegalesDeAlta()` (`lib/legales.ts`) es la pregunta;
 * `/aceptar-terminos` es la respuesta.
 *
 * Para el resto de las cuentas el gate es invisible y siempre lo será: el
 * trigger `auth_users_crear_perfil_de_cuenta` les escribe las dos filas en la
 * misma transacción del alta desde el hotfix de `20260814140000`.
 *
 * ## Que se ejecute en CADA navegación no es una suposición
 *
 * Es el mismo razonamiento que documenta `app/(app)/(con-nav)/layout.tsx` para
 * la revalidación del perfil activo: `cuentaAceptoLegalesDeAlta()` llama a
 * `cookies()` (a través de `lib/supabase/server.ts`), y eso marca este segmento
 * como **dinámico**. En Next.js 16 el Client Router Cache usa
 * `staleTimes.dynamic = 0` para segmentos dinámicos, así que cada navegación
 * -incluidas las client-side de la bottom nav- vuelve a pedir el RSC payload y
 * vuelve a correr este layout entero. La consulta no se duplica dentro de un
 * mismo request porque la función está envuelta en `cache()` de React.
 *
 * ## Lo que este gate NO es
 *
 * No es una capa de autorización. La autoridad sobre los datos sigue siendo
 * RLS, que no lee `consents` ni tiene por qué: una cuenta graduada es titular
 * de su perfil desde el instante de la vinculación. Este layout garantiza que
 * no OPERE la aplicación antes de aceptar —que es lo que pide la Ley 25.326,
 * art. 5—, no que la base le esconda sus propias filas.
 */

import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { RUTA_ACEPTAR_TERMINOS } from "@/lib/auth/rutas"
import { cuentaAceptoLegalesDeAlta } from "@/lib/legales"

export default async function LayoutApp({ children }: { children: ReactNode }) {
  if (!(await cuentaAceptoLegalesDeAlta())) {
    redirect(RUTA_ACEPTAR_TERMINOS)
  }

  return <>{children}</>
}
