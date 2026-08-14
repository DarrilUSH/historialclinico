"use client"

/**
 * Formulario de carga de UNA medición (Sprint 9, tarea 9.1). A diferencia de
 * `formulario-turno.tsx`/`formulario-medicacion.tsx` no hay `modo`: acá
 * siempre se crea -no hay edición de una medición ya cargada en esta tarea-,
 * y no hay `<select>` de tipo: `tipo` llega fijo por prop, decidido por cuál
 * de los tres botones grandes de `/signos` se tocó
 * (`components/signos/tipos.ts#ETIQUETA_CARGAR`), y viaja como hidden -es el
 * criterio Senior UX del roadmap: "la persona mayor no elige de un dropdown,
 * toca el botón de lo que va a cargar"-.
 *
 * Campos por tipo, calcados de `vital_signs_campos_por_tipo`
 * (`lib/validacion/signo.schema.ts`): tensión pide sistólica + diastólica +
 * pulso opcional; glucemia y peso piden un único valor. Fecha y hora se
 * precargan con "ahora" (`fechaInicial`/`horaInicial`, resueltas por la
 * página con `lib/turnos/fecha.ts#hoyIsoUshuaia`/`horaUshuaia`) y quedan
 * editables con los mismos inputs nativos `date`/`time` que
 * `formulario-turno.tsx`.
 */

import { useActionState } from "react"

import { HeartPulseIcon, DropletIcon, WeightIcon } from "lucide-react"

import { registrarSigno, type EstadoSignoAccion } from "@/app/(app)/(con-nav)/signos/actions"
import { Alerta } from "@/components/base/alerta"
import { Boton } from "@/components/base/boton"
import { CampoNumero } from "@/components/base/campo-numero"
import { CampoTexto } from "@/components/base/campo-texto"
import { ETIQUETA_CARGAR, UNIDAD_TIPO, type SignoTipo } from "@/lib/signos/tipos"

export interface ValoresSigno {
  sistolica: string
  diastolica: string
  pulso: string
  valor: string
}

export interface FormularioSignoProps {
  tipo: SignoTipo
  /** Prefill de la ÚLTIMA carga del mismo tipo (`lib/signos/consultas.ts#obtenerUltimaMedicion`). `undefined` en la primera carga: los campos arrancan vacíos. */
  valoresIniciales?: Partial<ValoresSigno>
  /** `YYYY-MM-DD` de "ahora" en Ushuaia. */
  fechaInicial: string
  /** `HH:mm` de "ahora" en Ushuaia. */
  horaInicial: string
}

const ESTADO_INICIAL: EstadoSignoAccion = { error: null }

const ICONO_TIPO: Record<SignoTipo, typeof HeartPulseIcon> = {
  tension: HeartPulseIcon,
  glucemia: DropletIcon,
  peso: WeightIcon,
}

export function FormularioSigno({
  tipo,
  valoresIniciales,
  fechaInicial,
  horaInicial,
}: FormularioSignoProps) {
  const [estado, enviarAccion, pendiente] = useActionState(registrarSigno, ESTADO_INICIAL)
  const Icono = ICONO_TIPO[tipo]

  return (
    <form action={enviarAccion} className="flex flex-col gap-5">
      <input type="hidden" name="tipo" value={tipo} />

      {tipo === "tension" ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
            <CampoNumero
              id="sistolica"
              label="Sistólica"
              required
              autoFocus
              defaultValue={valoresIniciales?.sistolica}
              sufijo={UNIDAD_TIPO.tension}
              ayuda="El número de arriba."
            />
            <CampoNumero
              id="diastolica"
              label="Diastólica"
              required
              defaultValue={valoresIniciales?.diastolica}
              sufijo={UNIDAD_TIPO.tension}
              ayuda="El número de abajo."
            />
          </div>
          <CampoNumero
            id="pulso"
            label="Pulso"
            defaultValue={valoresIniciales?.pulso}
            sufijo="lat/min"
            ayuda="Opcional. Muchos tensiómetros lo muestran junto con la presión."
          />
        </>
      ) : (
        <CampoNumero
          id="valor"
          label={tipo === "glucemia" ? "Glucemia" : "Peso"}
          required
          autoFocus
          decimal={tipo === "peso"}
          defaultValue={valoresIniciales?.valor}
          sufijo={UNIDAD_TIPO[tipo]}
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 chica:grid-cols-2">
        <CampoTexto id="fecha" label="Fecha" type="date" required defaultValue={fechaInicial} max={fechaInicial} />
        <CampoTexto id="hora" label="Hora" type="time" required defaultValue={horaInicial} />
      </div>

      {estado.error && <Alerta variante="error">{estado.error}</Alerta>}

      <Boton type="submit" size="lg" cargando={pendiente}>
        <Icono aria-hidden="true" />
        {ETIQUETA_CARGAR[tipo]}
      </Boton>
    </form>
  )
}
