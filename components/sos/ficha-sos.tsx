/**
 * Ficha SOS: la pantalla de MÁXIMA legibilidad del perfil activo (Sprint 8,
 * tarea 8.3). Contrato de lectura y tabla de ausencias: `docs/modelo-sos.md`
 * §5. La ficha de EDICIÓN es `/perfil/sos` (tarea 8.2, `formulario-sos.tsx`)
 * y no se toca acá.
 *
 * ## Server Component puro, sin excepción
 *
 * Ni un solo `"use client"` en este árbol. El enlace `tel:` es un `<a>`
 * nativo -no necesita ningún manejador de JS para funcionar-, así que no hay
 * ningún motivo para que esta pantalla dependa de hidratación. Es la ruta
 * que la tarea 8.4 va a cachear offline: cuanto menos JS, más robusta esa
 * cache (ver el encabezado de `app/(app)/(con-nav)/sos/page.tsx`).
 *
 * ## La tabla de ausencias, aplicada campo por campo
 *
 * "Nunca en blanco, nunca afirmando de más" (`docs/modelo-sos.md` §5 y §9.2:
 * la ficha es autodeclarada, no debe insinuar validación clínica). Cada
 * campo ausente tiene su propia frase, nunca un guion suelto:
 *
 * | Campo ausente | Texto |
 * |---|---|
 * | `date_of_birth` | "Edad no registrada" |
 * | `national_id` | "DNI no registrado" |
 * | `blood_type` | "No registrado" (bajo el rótulo "Grupo y factor sanguíneo") |
 * | Array vacío (alergias, crónicas, medicación) | "Sin ... registrad{o,a}s." |
 * | `sos_notes` | "Sin observaciones registradas." |
 * | Sin ningún dato de contacto | Se omite el bloque entero (no hay nada que decir) |
 * | Sin cobertura principal | Se omite el bloque entero |
 * | `sos_updated_at` | "Todavía no se cargó ningún dato vital." |
 *
 * Contacto y cobertura son los DOS únicos bloques que se omiten en vez de
 * mostrar un fallback: mostrar "Sin contacto de emergencia" con un botón de
 * llamar inerte, o "Sin cobertura" con un link roto, es peor que no mostrar
 * nada -`docs/modelo-sos.md` §5, fila "Sin contacto de emergencia"-. El
 * resto de los campos SÍ tiene fallback porque son texto puro, sin ninguna
 * acción que pueda quedar inerte.
 *
 * ## La foto de la credencial vive acá desde el Sprint 8.4
 *
 * El bloque "Cobertura principal" muestra las caras cargadas de la credencial
 * con una URL **estable y cacheable** (`FotoCredencial`, más abajo). Es lo que
 * hace que la ficha sirva de verdad en una ventanilla de guardia sin señal:
 * DNI, grupo sanguíneo y carnet en la misma pantalla. Sigue sin haber un solo
 * `"use client"` en este árbol.
 *
 * ## El teléfono nunca se normaliza
 *
 * `href="tel:${telefono}"` usa el string tal como está guardado, sin tocar
 * separadores. `docs/modelo-sos.md` §5: "'arreglar' el número es la forma
 * más fácil de romper una llamada que funcionaba."
 *
 * ## Contacto con datos parciales (escrito por fuera de la app)
 *
 * La regla "teléfono o vínculo exigen nombre" solo vive en `sos.schema.ts`
 * (`docs/modelo-sos.md` §2.4 y §9.4): una escritura directa en la base puede
 * dejar un teléfono sin nombre. Acá se tolera sin romper -se completa con
 * "el contacto" / "vínculo no registrado"-, nunca se cae ni se oculta el
 * bloque si hay AL MENOS un dato cargado.
 */

import { PhoneIcon } from "lucide-react"

import { Tarjeta } from "@/components/base/tarjeta"
import { calcularEdad } from "@/lib/perfiles/edad"
import { formatearRevisionSos } from "@/lib/sos/frescura"
import { urlImagenCredencial } from "@/lib/sos/payload"
import type { Perfil } from "@/types/dominio"

/** Recorte de `insurance_cards` que trae `/sos` (contrato §5): solo lo que se muestra. */
export interface CoberturaPrincipalSos {
  id: string
  provider: string
  plan: string | null
  member_number: string | null
  /** ¿Hay foto de esa cara? Los `storage_path` NO llegan hasta acá (ver `/sos/page.tsx`). */
  tieneFrente: boolean
  tieneDorso: boolean
}

export interface FichaSosProps {
  perfil: Perfil
  coberturaPrincipal: CoberturaPrincipalSos | null
}

const CLASE_TITULO_SECCION = "px-(--card-spacing) text-xl font-semibold text-balance"

export function FichaSos({ perfil, coberturaPrincipal }: FichaSosProps) {
  const edad = calcularEdad(perfil.date_of_birth)
  const ultimaRevision = formatearRevisionSos(perfil.sos_updated_at)

  const hayContacto = Boolean(
    perfil.emergency_contact ||
      perfil.emergency_contact_phone ||
      perfil.emergency_contact_relationship,
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          {perfil.full_name}
        </h1>
        <p className="text-lg text-muted-foreground">
          {edad !== null ? `${edad} años` : "Edad no registrada"}
          {" · "}
          {perfil.national_id ? `DNI ${perfil.national_id}` : "DNI no registrado"}
        </p>
      </header>

      {/*
        Grupo sanguíneo: "lo primero que busca un médico" (roadmap). Único
        uso de `variante="destacada"` (ámbar) de la ficha: el realce cálido
        del sistema de diseño para el dato más buscado, nunca el rojo `--sos`
        -ese color queda exclusivo del botón de `/inicio`
        (docs/design-system.md §2.4)-.
      */}
      {/*
        Sin override de color de texto: `variante="destacada"` ya hereda
        `text-card-foreground` de `CLASE_TARJETA_BASE` (mismo criterio que
        `activar-notificaciones.tsx` y la muestra de
        `app/(dev)/estilos/page.tsx`), un par ya cubierto por
        `foreground`/`card` en el script de contraste. La prominencia sale
        del tamaño (`text-6xl`) y el peso, no de un color nuevo sin medir.
      */}
      <Tarjeta variante="destacada" className="items-center gap-1 py-6 text-center">
        <p className="px-(--card-spacing) text-lg font-medium">Grupo y factor sanguíneo</p>
        <p className="px-(--card-spacing) text-6xl font-extrabold tracking-tight">
          {perfil.blood_type ?? "No registrado"}
        </p>
      </Tarjeta>

      <SeccionLista
        titulo="Alergias"
        items={perfil.allergies}
        textoVacio="Sin alergias registradas."
      />
      <SeccionLista
        titulo="Enfermedades crónicas"
        items={perfil.chronic_conditions}
        textoVacio="Sin enfermedades crónicas registradas."
      />
      <SeccionLista
        titulo="Medicación crítica"
        items={perfil.critical_medication}
        textoVacio="Sin medicación crítica registrada."
      />

      {hayContacto && (
        <Tarjeta className="gap-3">
          <h2 className={CLASE_TITULO_SECCION}>Contacto de emergencia</h2>
          <div className="flex flex-col gap-3 px-(--card-spacing)">
            {perfil.emergency_contact_phone ? (
              <a
                href={`tel:${perfil.emergency_contact_phone}`}
                className="flex min-h-tactil-amplio w-full items-center justify-center gap-3 rounded-xl bg-primary px-5 text-center text-2xl leading-tight font-bold text-primary-foreground shadow-elevada transition-[transform,box-shadow] duration-(--duracion-media) ease-salida hover:-translate-y-0.5 hover:shadow-elevada focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.995]"
              >
                <PhoneIcon className="size-7 shrink-0" aria-hidden="true" />
                Llamar a {perfil.emergency_contact || "el contacto"} (
                {perfil.emergency_contact_relationship || "vínculo no registrado"})
              </a>
            ) : (
              <p className="text-lg">
                {perfil.emergency_contact || "Nombre no registrado"}
                {perfil.emergency_contact_relationship
                  ? ` (${perfil.emergency_contact_relationship})`
                  : ""}
                {" — sin teléfono registrado."}
              </p>
            )}
          </div>
        </Tarjeta>
      )}

      <Tarjeta className="gap-2">
        <h2 className={CLASE_TITULO_SECCION}>Observaciones para el personal de emergencia</h2>
        <p className="px-(--card-spacing) text-lg whitespace-pre-wrap">
          {perfil.sos_notes || "Sin observaciones registradas."}
        </p>
      </Tarjeta>

      {coberturaPrincipal && (
        <Tarjeta className="gap-2">
          <h2 className={CLASE_TITULO_SECCION}>Cobertura principal</h2>
          <div className="flex flex-col gap-0.5 px-(--card-spacing) text-lg">
            <p className="font-semibold">{coberturaPrincipal.provider}</p>
            {coberturaPrincipal.plan && <p>{coberturaPrincipal.plan}</p>}
            {coberturaPrincipal.member_number && (
              <p>N.º de afiliado {coberturaPrincipal.member_number}</p>
            )}
          </div>

          {(coberturaPrincipal.tieneFrente || coberturaPrincipal.tieneDorso) && (
            <div className="flex flex-col gap-3 px-(--card-spacing) pt-1">
              {coberturaPrincipal.tieneFrente && (
                <FotoCredencial
                  coberturaId={coberturaPrincipal.id}
                  lado="front"
                  proveedor={coberturaPrincipal.provider}
                />
              )}
              {coberturaPrincipal.tieneDorso && (
                <FotoCredencial
                  coberturaId={coberturaPrincipal.id}
                  lado="back"
                  proveedor={coberturaPrincipal.provider}
                />
              )}
            </div>
          )}
        </Tarjeta>
      )}

      <p className="text-center text-base text-muted-foreground">
        {ultimaRevision
          ? `Datos revisados el ${ultimaRevision}.`
          : "Todavía no se cargó ningún dato vital."}
      </p>
    </div>
  )
}

/**
 * Una cara de la credencial de cobertura, dentro de la ficha SOS (Sprint 8,
 * tarea 8.4).
 *
 * ## Tres decisiones que hacen que esto funcione en modo avión
 *
 * 1. **URL estable, nunca una signed URL.** `urlImagenCredencial` apunta a
 *    `/api/credenciales/{id}/imagen`, que es siempre la misma para la misma
 *    cara y verifica sesión y permiso en cada request que llega al servidor.
 *    Una signed URL cambia en cada emisión y vive 300 segundos: como clave de
 *    caché no sirve para nada (`docs/offline.md` §4).
 *
 * 2. **`<img>` nativo, no `next/image`.** `next/image` reescribe el `src` a
 *    `/_next/image?url=…&w=…&q=…`, o sea otra URL, con su propio caché y su
 *    propia negociación de formato — justo lo que el service worker no puede
 *    seguir. Además haría pasar una foto privada por el optimizador. Es el
 *    mismo criterio que ya aplican el visor y la miniatura de la billetera.
 *
 * 3. **Cero JavaScript.** Es un `<a>` con un `<img>` adentro: sin efectos, sin
 *    estado, sin fetch. La billetera (`miniatura-credencial.tsx`) necesita ser
 *    un Client Component porque tiene que pedir su signed URL; acá no hay nada
 *    que pedir, y por eso la ficha SOS sigue siendo un Server Component puro
 *    que se ve completa aunque no cargue ni un chunk de JS.
 *
 * El enlace abre la imagen sola en otra pestaña: sin red eso también sale del
 * caché, y es la forma de verla grande en la ventanilla de una guardia sin
 * depender del visor con zoom, que sí necesita JavaScript y conexión.
 */
function FotoCredencial({
  coberturaId,
  lado,
  proveedor,
}: {
  coberturaId: string
  lado: "front" | "back"
  proveedor: string
}) {
  const etiqueta = lado === "front" ? "Frente" : "Dorso"
  const url = urlImagenCredencial(coberturaId, lado)

  return (
    <figure className="flex flex-col gap-1">
      <a
        href={url}
        target="_blank"
        rel="noopener"
        className="block overflow-hidden rounded-xl border border-border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- URL estable cacheable offline, ver el comentario de arriba */}
        <img
          src={url}
          alt={`Credencial de ${proveedor} — ${etiqueta.toLowerCase()}`}
          className="max-h-64 w-full object-contain"
        />
      </a>
      <figcaption className="text-base text-muted-foreground">
        {etiqueta} de la credencial · tocá para verla en grande
      </figcaption>
    </figure>
  )
}

/** Una de las tres listas SOS (alergias, crónicas, medicación crítica), en modo solo lectura. */
function SeccionLista({
  titulo,
  items,
  textoVacio,
}: {
  titulo: string
  items: string[]
  textoVacio: string
}) {
  return (
    <Tarjeta className="gap-2">
      <h2 className={CLASE_TITULO_SECCION}>{titulo}</h2>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1 px-(--card-spacing) text-lg">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="px-(--card-spacing) text-lg text-muted-foreground">{textoVacio}</p>
      )}
    </Tarjeta>
  )
}
