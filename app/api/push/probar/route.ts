/**
 * POST /api/push/probar — **SOLO DESARROLLO**.
 *
 * Manda una notificación de prueba a todas las suscripciones activas de la
 * cuenta que llama. En producción responde 404, igual que `/estado`
 * (`app/(dev)/estado/page.tsx`): no es una funcionalidad del producto.
 *
 * ## Por qué existe
 *
 * Web Push no se puede verificar "por partes". Que la fila entre en
 * `push_subscriptions` no prueba nada: el circuito real es firma VAPID →
 * cifrado aes128gcm → Push Service (FCM) → service worker → bandeja del
 * sistema, y cualquiera de esos cinco eslabones puede fallar en silencio. La
 * única prueba válida es que la notificación APAREZCA en un teléfono. Este
 * endpoint es lo que dispara esa prueba desde el propio teléfono
 * -`components/notificaciones/activar-notificaciones.tsx`, botón "Enviar
 * prueba (dev)"-, en vez de tener que copiar a mano la cookie de sesión del
 * celular a un `curl` de la máquina de desarrollo.
 *
 * También es la forma de verificar el manejo del **410 Gone**: se desactivan
 * las notificaciones desde el navegador (que hace `unsubscribe()` en el Push
 * Service) y se vuelve a llamar acá contra la fila que quedó; FCM responde
 * 404/410 y `enviarPush` la marca `revoked_at` en vez de romper.
 *
 * Manda a la CUENTA que llama y a ninguna otra: no acepta ningún parámetro
 * de destinatario. Un endpoint de prueba que reciba un `userId` es un
 * endpoint desde el que se le puede mandar una notificación a cualquiera.
 */

import { createClient } from "@/lib/supabase/server"
import { enviarPushAUsuario } from "@/lib/push/servidor"

/**
 * `web-push` usa `crypto` y `https` de Node: el runtime tiene que ser
 * `nodejs`, no `edge`. Es el default de los Route Handlers, pero acá se
 * declara para que quede escrito en el archivo que lo necesita.
 */
export const runtime = "nodejs"

function json(cuerpo: unknown, status: number) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return json({ error: "No encontrado" }, 404)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return json({ error: "No autenticado" }, 401)
  }

  const resultados = await enviarPushAUsuario(user.id, {
    titulo: "Prueba de recordatorios",
    cuerpo: "Si ves esto en la pantalla del celular, las notificaciones funcionan.",
    // Una ruta distinta de /inicio a propósito: al tocar la notificación tiene
    // que abrirse ESTA, lo que prueba que `data.url` llega hasta el handler
    // `notificationclick` del service worker.
    url: "/turnos",
    tag: "prueba-push",
  })

  if (resultados.length === 0) {
    return json(
      {
        error:
          "No hay suscripciones activas para esta cuenta. Activá las notificaciones primero.",
      },
      409,
    )
  }

  const enviados = resultados.filter((r) => r.estado === "entregado").length
  const revocadas = resultados.filter((r) => r.estado === "revocada").length
  const fallidos = resultados.filter(
    (r) => r.estado === "fallido" || r.estado === "reintentable",
  )

  return json(
    {
      enviados,
      revocadas,
      fallidos: fallidos.length,
      // El detalle solo sale en desarrollo, que es el único entorno donde
      // esta ruta responde.
      detalle: resultados,
    },
    200,
  )
}
