/**
 * Home. El botón SOS destacado llega en el Sprint 8 (`components/inicio/boton-sos.tsx`);
 * por ahora esta pantalla confirma el perfil activo y cierra el flujo
 * login → selector → perfil activo de punta a punta.
 *
 * El shell (bottom nav, header con "Cambiar" de perfil) ya no vive acá: lo
 * resuelve `app/(app)/(con-nav)/layout.tsx` para las cuatro pantallas con
 * nav, así que esta página no repite el link "Cambiar de perfil" que tenía
 * antes del Sprint 3.
 *
 * Igual vuelve a llamar `obtenerPerfilActivo()` (memoizada con `cache()`,
 * ver `lib/perfil-activo.ts`) y redirige si no hay perfil válido: no confía
 * en que "el layout ya lo validó" -esta página tiene que ser correcta por sí
 * sola, sea cual sea el árbol que la termine renderizando-, y el costo real
 * es cero porque comparte el resultado memoizado del layout dentro del mismo
 * request.
 *
 * La raíz de esta pantalla es un `<div>`, no un `<main>`: ese landmark ya lo
 * pone el layout una sola vez para las cuatro pantallas con nav (dos `<main>`
 * anidados son inválidos y confunden a un lector de pantalla).
 *
 * ## Modo chica (Sprint 13, tarea 13.2)
 *
 * Las cards de acceso directo (Medicación, Signos vitales, Coberturas,
 * Médicos, Especialidades, Lugares, Ficha para el médico, Ficha SOS) pasan de
 * columna apilada a una GRILLA de columnas compactas -ícono + título, sin la
 * bajada explicativa larga, que es ayuda contextual y no dato clínico
 * (docs/densidad.md §4, regla 5: "la densidad no saca contenido", pero una
 * ayuda no es contenido-. Se factorizan en `TarjetaAcceso` (más abajo en este
 * mismo archivo) para que todas compartan la MISMA clase base y el MISMO
 * override `chica:`, en vez de repetir el bloque una vez por card con la
 * chance de que alguna quede desalineada de las demás.
 *
 * Sprint 16 (tarea 16.3) suma dos: "Especialidades" (`/especialidades`) y
 * "Lugares" (`/lugares`). Con eso la grilla de 3 columnas pasa de 2 filas a
 * 3 exactas para quien tiene todos los permisos (8 cards: 3 + 3 + 2), sin
 * tocar ni una clase de la grilla —que era justamente el punto de haberla
 * factorizado—.
 *
 * El envoltorio de la grilla (`flex flex-col gap-8` en grande, `chica:grid
 * chica:grid-cols-2` en compacta) usa el MISMO `gap-8` que tenían las cards
 * como hijos sueltos del contenedor padre en el modo grande: agruparlas en un
 * solo `<div>` no mueve un píxel de esa disposición, porque el gap del padre
 * ahora se aplica una vez antes del grupo y una vez después (en vez de una
 * vez entre cada card), y el gap interno del grupo repone exactamente esas
 * separaciones que faltan.
 */

import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import {
  ActivityIcon,
  ClipboardListIcon,
  CreditCardIcon,
  HeartPulseIcon,
  HospitalIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  PillIcon,
  StethoscopeIcon,
} from "lucide-react"

import { AccionesDiferidasInicio } from "@/components/inicio/acciones-diferidas"
import { BotonSos } from "@/components/inicio/boton-sos"
import { ProximoTurno } from "@/components/inicio/proximo-turno"
import { CLASE_TARJETA_BASE, CLASE_TARJETA_INTERACTIVA } from "@/components/base/tarjeta"
import { BannerAlertasSignos } from "@/components/signos/banner-alerta"
import { requerirSesion } from "@/lib/auth/guardas"
import { obtenerTomasDeHoy } from "@/lib/medicacion/tomas-de-hoy"
import { cn } from "@/lib/utils"
import { obtenerPerfilActivo, type PermisosPerfilActivo } from "@/lib/perfil-activo"
import { obtenerAlertasSinVer } from "@/lib/signos/alertas-sin-ver"

export const metadata: Metadata = {
  title: "Inicio — Historial Médico",
}

export default async function PaginaInicio() {
  const activo = await obtenerPerfilActivo()

  if (!activo) {
    redirect("/perfiles")
  }

  const { perfil, permisos } = activo

  // Resumen mínimo de la card de medicación (Sprint 7, tarea 7.3): un fetch
  // simple y best-effort, la misma función que arma la sección completa de
  // `/medicacion` (`lib/medicacion/tomas-de-hoy.ts`) para no divergir en el
  // criterio de "hoy". `requerirSesion()` acá NO repite el viaje a la base
  // de `obtenerPerfilActivo()` -esa está memoizada con `cache()`-, es solo
  // el cliente de Supabase que esta función necesita y que
  // `obtenerPerfilActivo()` no expone.
  const { supabase } = await requerirSesion()
  const tomasDeHoy = await obtenerTomasDeHoy(supabase, perfil.id)
  const tomasPendientesHoy = tomasDeHoy.filter((toma) => toma.status === "pending").length

  // Banner de alertas de signos vitales (Sprint 9, tarea 9.3): mismo criterio
  // de permiso que `/signos` -solo `can_manage` recibe el push y solo
  // `can_manage` puede leer estas filas por RLS-, para que el banner
  // "persistente en la app" del ROADMAP alcance a quien administra el perfil
  // aunque no haya entrado todavía a `/signos` esta sesión.
  const alertasSinVer = permisos.canManage
    ? await obtenerAlertasSinVer(supabase, perfil.id)
    : []

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center chica:gap-5 chica:py-6">
      {/*
        Botón SOS (Sprint 8, tarea 8.3): primera cosa bajo el encabezado del
        perfil (que renderiza el layout, no esta página), arriba incluso del
        saludo. Ver el comentario de cabecera de `boton-sos.tsx` para el
        criterio de "menos de 2 toques desde cualquier pantalla" y por qué no
        suma un quinto ítem a la bottom nav. Se compacta solo (token
        `--spacing-sos-boton`); sigue full-width en los dos modos.
      */}
      <BotonSos />

      {/*
        Banner de alertas de signos vitales (Sprint 9, tarea 9.3): justo
        debajo del SOS -la acción de emergencia sigue siendo lo más
        prominente de la pantalla- y arriba del saludo, para que quien abre la
        app vea de entrada que hay algo sin ver, sin tener que entrar a
        `/signos` primero. `BannerAlertasSignos` ya devuelve `null` con la
        lista vacía, así que no hace falta un `if` acá. En chica queda más
        denso -ver el propio componente-, sin recortar ni una palabra del
        texto clínico de cada alerta.
      */}
      <BannerAlertasSignos alertas={alertasSinVer} className="w-full max-w-sm" />

      {/*
        Chica (Sprint 14, tanda A): "Estás viendo el historial de {nombre}" y
        la bajada de permiso se ocultan -no es pérdida de contenido
        (docs/densidad.md §4 regla 5, que protege datos CLÍNICOS): el
        encabezado que pone `app/(app)/(con-nav)/layout.tsx`
        (`components/navegacion/encabezado-perfil.tsx`) ya dice "Viendo a
        {nombre}" -o "Tu historial" si es el perfil propio- en cada pantalla
        con nav, así que era el mismo dato repetido dos veces en la misma
        pantalla; la bajada de permiso es ayuda contextual sobre qué puede
        hacer quien mira -mismo criterio que la descripción larga de cada
        `TarjetaAcceso`, ya oculta en chica más abajo-, no un dato del
        paciente-. El `<h1>` en sí NO se saca del DOM (`chica:sr-only`, no
        `chica:hidden`): esta pantalla no tiene otro título, y una página sin
        ningún `<h1>` visible-o-no es un salto de nivel real para un lector
        de pantalla, no una mejora de densidad.
      */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-lg text-muted-foreground chica:hidden">Estás viendo el historial de</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl chica:sr-only">
          {perfil.full_name}
        </h1>
        <p className="text-base text-muted-foreground chica:hidden">{descripcionRelacion(permisos)}</p>
      </div>

      {/* Próximo turno (Sprint 6, tarea 6.3). En chica, `TarjetaTurno` se
          reorganiza a card horizontal -fecha a la izquierda, datos a la
          derecha- desde adentro del propio componente (`components/turnos/tarjeta-turno.tsx`),
          así la mejora alcanza también a `/turnos` sin duplicar código acá. */}
      <ProximoTurno />

      {/* Grilla de accesos directos (Sprint 7 a 10): en grande, columna
          apilada de siempre. En chica, grilla de tiles compactos -ver el
          comentario de cabecera de este archivo-.

          Sprint 14 (tanda A): 3 columnas, no 2. La cantidad de columnas la
          decide lo que entra bien en los ~383px útiles del Galaxy A71
          (411px - `px-4` de los dos lados), no una cifra fija: medido en el
          dispositivo, 3 columnas de ~121px cada una alcanzan para el ícono
          (`size-11`, 38,5px) más el título en 1-2 líneas SIN truncar -el
          mismo criterio "app nativa" que usan las grillas de accesos de
          MercadoPago/bancos (3-4 tiles por fila con label corto)-, y ganan
          una fila entera contra la grilla de 2 columnas del Sprint 13 (6
          tiles: 2 filas de 3 en vez de 3 filas de 2). Con las dos cards del
          Sprint 16 y la de Gmail del 17 son 9 tiles: 3 filas justas. Los dos títulos que
          no entraban así nomás son "Ficha para el médico" -que lleva un label
          corto SOLO en chica- y "Especialidades" -una sola palabra larga, que
          se resuelve con separación silábica: ver `TarjetaAcceso` más abajo-. */}
      <div className="flex w-full max-w-sm flex-col gap-8 chica:grid chica:max-w-none chica:grid-cols-3 chica:gap-2">
        {/*
          Acceso a /medicacion (Sprint 7, tarea 7.2). Sin slot propio en la
          bottom nav todavía -llega en el Sprint 9-, así que por ahora el
          camino de entrada es esta card simple: sin fetch propio (a
          diferencia de `ProximoTurno`, que sí resuelve datos), es solo un
          acceso directo, igual para cualquier permiso -Diego (`can_view`)
          también puede ver la medicación de Roberto, solo que sin botones de
          edición dentro de la pantalla-.
        */}
        <TarjetaAcceso
          href="/medicacion"
          Icono={PillIcon}
          titulo="Medicación"
          descripcion={textoResumenTomas(tomasDeHoy.length, tomasPendientesHoy)}
        />

        {/*
          Acceso a /signos (Sprint 9, tarea 9.1). Mismo patrón que la card de
          Coberturas de abajo: sin fetch propio -"Card simple", ni contador ni
          consulta a la base, el resumen con los últimos valores vive en la
          pantalla de destino-, igual para cualquier permiso: Diego (`can_view`)
          también puede ver los signos vitales de Roberto, solo que sin los
          botones de carga dentro de la pantalla.
        */}
        <TarjetaAcceso
          href="/signos"
          Icono={ActivityIcon}
          titulo="Signos vitales"
          descripcion="Cargar tensión, glucemia y peso"
        />

        {/*
          Acceso a /coberturas (Sprint 8, tarea 8.1). Mismo patrón que la card
          de Medicación de arriba: sin fetch propio -es un acceso directo, no
          un resumen-, igual para cualquier permiso. "Card simple", como pide
          el criterio de la tarea: sin contador ni consulta a la base.
        */}
        <TarjetaAcceso
          href="/coberturas"
          Icono={CreditCardIcon}
          titulo="Coberturas"
          descripcion="Obra social, prepaga y credenciales"
        />

        {/*
          Acceso a /medicos (Sprint 10, tarea 10.1). Mismo patrón que la card
          de Coberturas de arriba: sin fetch propio -es un acceso directo, no
          un resumen-, igual para cualquier permiso. Sin slot propio en la
          bottom nav (Sprint 10 no tiene uno libre, mismo motivo que
          `/medicacion` y `/coberturas`).
        */}
        <TarjetaAcceso
          href="/medicos"
          Icono={StethoscopeIcon}
          titulo="Médicos"
          descripcion="Directorio de profesionales y contacto"
        />

        {/*
          Acceso a /especialidades (Sprint 16, tarea 16.3). Mismo patrón que
          las de arriba: sin fetch propio, igual para cualquier permiso -es la
          MISMA lista de `doctors` que ya puede ver quien tiene `can_view`,
          leída por especialidad en vez de por nombre-. Va pegada a "Médicos"
          a propósito: son las dos caras de la misma información y en la
          grilla de 3 columnas quedan una al lado de la otra.
        */}
        <TarjetaAcceso
          href="/especialidades"
          Icono={ListChecksIcon}
          titulo="Especialidades"
          descripcion="Tus médicos agrupados por especialidad"
        />

        {/*
          Acceso a /lugares (Sprint 16, tarea 16.3): el catálogo REFES de
          centros de salud del país. Sin gate de permiso -y es el único caso
          de esta grilla en que eso no es una simplificación sino la verdad
          del modelo: el catálogo es un dato PÚBLICO del Estado, global, que
          no cuelga de ningún perfil (ver el encabezado de
          `app/(app)/(con-nav)/lugares/page.tsx`)-. Sin fetch propio: el
          contador de centros y la fecha de la última actualización viven en
          la pantalla de destino, no en la card.
        */}
        <TarjetaAcceso
          href="/lugares"
          Icono={HospitalIcon}
          titulo="Lugares"
          descripcion="Buscar clínicas, hospitales y laboratorios"
        />

        {/*
          Acceso a /ficha (Sprint 10, tarea 10.4): la hoja de resumen para
          consulta, generada por IA a partir del contexto clínico minimizado
          (tarea 10.2). Gateada por `canUpload` -mismo piso mínimo que exige
          `POST /api/ficha/generar`, ver el encabezado de
          `app/api/ficha/generar/route.ts`-: un `can_view` puro que forzara la
          URL igual rebotaría a `/inicio` sin ver el botón "Generar ficha"
          (`app/(app)/(sin-nav)/ficha/page.tsx`), así que ni se le ofrece la
          card.
        */}
        {permisos.canUpload && (
          <TarjetaAcceso
            href="/ficha"
            Icono={ClipboardListIcon}
            titulo="Ficha para el médico"
            tituloChico="Ficha médica"
            descripcion="Resumen de una página para imprimir o compartir"
          />
        )}

        {/*
          Acceso a /perfil/sos (Sprint 8, tarea 8.2): la pantalla de EDICIÓN de
          los datos vitales. La entrada GRANDE a la ficha de lectura llega con
          el botón SOS de la tarea 8.3 (`components/inicio/boton-sos.tsx`) y no
          es esta card.

          A diferencia de las de arriba, esta SÍ depende del permiso:
          `/perfil/sos` exige `can_manage` (espeja
          `profiles_update_administrador`, nota ② de docs/modelo-permisos.md) y
          redirige a `/inicio` a quien no lo tenga. Mostrarle la card a un
          `can_view` sería ofrecerle un camino que rebota.
        */}
        {permisos.canManage && (
          <TarjetaAcceso
            href="/perfil/sos"
            Icono={HeartPulseIcon}
            titulo="Ficha SOS"
            descripcion="Editar datos vitales"
          />
        )}

        {/*
          Acceso a /perfil/gmail (Sprint 17, tarea 17.1). Es la ÚNICA card de
          esta grilla que no habla del perfil activo: la casilla de correo es
          de la CUENTA logueada y vale para todos los perfiles que administre
          -mismo caso que las notificaciones push (nota ⑰ de la migración de
          RLS) y que el modo de letra-. Por eso no lleva gate de permiso: no
          hay un permiso sobre el perfil que decida si alguien puede conectar
          SU propio correo. La pantalla de destino lo aclara con todas las
          letras para que "viendo a Roberto" no haga pensar que se conecta el
          Gmail de Roberto.

          Va última a propósito: las ocho de arriba son el historial de la
          persona que se está mirando, y esta es configuración de la cuenta.
        */}
        <TarjetaAcceso
          href="/perfil/gmail"
          Icono={MailIcon}
          titulo="Tu Gmail"
          descripcion="Traer turnos y estudios desde tu correo"
        />
      </div>

      {/*
        El banner de recordatorios se renderiza SIEMPRE desde el servidor y
        decide en el cliente si tiene algo que mostrar: el estado real
        (permiso del navegador + suscripción viva en el Push Service) no
        existe del lado del servidor. Ver el encabezado del componente.

        No depende del perfil activo a propósito: la suscripción pertenece a
        la CUENTA y al navegador, no al perfil que se está viendo (nota ⑰ de
        la migración de RLS). Cambiar de perfil no tiene que ofrecer activar
        de nuevo lo que ya está activo.
      */}
      {/*
        `ActivarNotificaciones` (Sprint 6.3) y `BotonInstalar` (Sprint 11.1,
        discreto, al final de la pantalla, solo visible si el navegador
        entregó `beforeinstallprompt` y la app todavía no corre instalada —
        en iOS, sin ese evento, y con la app ya instalada, devuelve `null`)
        viven detrás de `AccionesDiferidasInicio` desde la tarea 11.6: el
        mismo componente, cargado con `next/dynamic({ ssr: false })` para
        sacar su JS del First Load de esta pantalla — ver el encabezado de
        `components/inicio/acciones-diferidas.tsx`.
      */}
      <AccionesDiferidasInicio />
    </div>
  )
}

function descripcionRelacion(permisos: PermisosPerfilActivo): string {
  if (permisos.esPropio) {
    return "Este es tu perfil."
  }
  if (permisos.canManage) {
    return "Lo administrás vos: podés cargar y editar sus datos."
  }
  if (permisos.canUpload) {
    return "Podés cargar datos en este perfil."
  }
  return "Tenés acceso de solo lectura a este perfil."
}

/**
 * Segunda línea de la card de medicación (Sprint 7, tarea 7.3): resumen
 * mínimo, no un fetch propio de la tarjeta -es la misma consulta de
 * `lib/medicacion/tomas-de-hoy.ts` que arma la sección completa de
 * `/medicacion`-. Sin tomas programadas hoy (perfil sin medicación con
 * horario, o solo `as_needed`) conserva el texto genérico de siempre; con
 * tomas, el dato accionable es cuántas faltan, y solo cuando no queda
 * ninguna pendiente confirma que ya están todas registradas.
 */
function textoResumenTomas(totalHoy: number, pendientes: number): string {
  if (totalHoy === 0) {
    return "Ver horarios, stock y días restantes"
  }
  if (pendientes === 0) {
    return "Todas las tomas de hoy están registradas"
  }
  return `${pendientes} ${pendientes === 1 ? "toma pendiente" : "tomas pendientes"} hoy`
}

/**
 * Una card de acceso directo de `/inicio` (Medicación, Signos vitales,
 * Coberturas, Médicos, Ficha para el médico, Ficha SOS). Factorizada en el
 * Sprint 13 (tarea 13.2) para que las seis compartan EXACTAMENTE la misma
 * clase base y el mismo rediseño `chica:` -antes eran seis bloques JSX
 * copiados a mano, la clase de bug que esta extracción evita-.
 *
 * En grande: fila con ícono a la izquierda, título y bajada apilados a la
 * derecha -sin cambios, es literalmente el markup que ya existía-.
 *
 * En chica: tile vertical -ícono arriba, título centrado abajo- SIN la
 * bajada. La bajada es ayuda contextual ("Obra social, prepaga y
 * credenciales"), no un dato clínico: ocultarla en el modo compacto respeta
 * la regla 5 de docs/densidad.md §4 ("la densidad no saca contenido") porque
 * esa regla protege datos, no texto de ayuda, y el destino de la card sigue
 * mostrando el detalle completo.
 *
 * `tituloChico` (Sprint 14, tanda A, opcional): a 3 columnas -ver el
 * comentario de la grilla más arriba- el único título de los seis que no
 * entraba en 1-2 líneas sin partirse feo es "Ficha para el médico" (21
 * caracteres en ~99px de ancho de contenido). En vez de truncar con
 * elipsis -prohibido para cualquier texto de esta pantalla- o dejarlo
 * envolver a 3 líneas, se le suma un label corto que SOLO existe en chica
 * (mismo patrón `chica:hidden` / `hidden chica:block` que combina droga +
 * presentación en `tarjeta-medicacion.tsx`: dos nodos con el mismo dato, uno
 * por modo, nunca los dos en el árbol de accesibilidad a la vez). Sin
 * `tituloChico`, la card muestra `titulo` en los dos modos -el caso de las
 * otras cinco, que ya entran cómodas-. `title={titulo}` queda siempre en el
 * `<Link>` con el texto COMPLETO, como referencia nativa del navegador.
 */
function TarjetaAcceso({
  href,
  Icono,
  titulo,
  tituloChico,
  descripcion,
}: {
  href: string
  Icono: LucideIcon
  titulo: string
  tituloChico?: string
  descripcion: string
}) {
  return (
    <Link
      href={href}
      title={titulo}
      className={cn(
        CLASE_TARJETA_BASE,
        CLASE_TARJETA_INTERACTIVA,
        "w-full max-w-sm flex-row items-center gap-3 px-(--card-spacing)",
        "chica:max-w-none chica:flex-col chica:justify-center chica:gap-1 chica:px-2 chica:py-3 chica:text-center",
      )}
    >
      <span
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary chica:size-9"
        aria-hidden="true"
      >
        <Icono className="size-5 chica:size-4.5" />
      </span>
      <span className="flex flex-col text-left chica:items-center chica:text-center">
        {/*
          `chica:hyphens-auto` (Sprint 16, tarea 16.3): "Especialidades" es
          una sola palabra de 14 caracteres y a `text-base` de chica (14px)
          no entra en los ~105px de contenido de un tile de 3 columnas. Un
          `tituloChico` no ayuda —no hay abreviatura de "Especialidades" que
          una persona mayor lea sin dudar—, truncar con elipsis está
          prohibido en esta pantalla, y dejarla desbordar rompe la grilla. La
          separación silábica del navegador la parte donde corresponde
          ("Especia-lidades") porque `app/layout.tsx` declara `lang="es-AR"`:
          es la única de las tres salidas que no pierde ni una letra. Solo en
          chica: en grande ninguna card la necesita.
        */}
        <span
          className={cn(
            "text-base font-semibold text-foreground chica:hyphens-auto",
            tituloChico && "chica:hidden",
          )}
        >
          {titulo}
        </span>
        {tituloChico && (
          <span className="hidden text-base font-semibold text-foreground chica:block">{tituloChico}</span>
        )}
        <span className="text-sm text-muted-foreground chica:hidden">{descripcion}</span>
      </span>
    </Link>
  )
}
