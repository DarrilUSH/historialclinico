#!/usr/bin/env node
/**
 * Historial Médico — generación del par de claves VAPID (Sprint 6, tarea 6.3).
 *
 *     node scripts/generar-vapid.mjs
 *
 * VAPID (RFC 8292) es la forma en que un servidor se identifica ante el Push
 * Service (FCM de Google para Chrome/Android, autopush de Mozilla para
 * Firefox, WNS para Edge). Es un par de claves ECDSA sobre la curva P-256:
 *
 * - La **pública** viaja al navegador como `applicationServerKey` en
 *   `pushManager.subscribe()`. El Push Service la asocia a la suscripción y
 *   después RECHAZA (403) cualquier envío firmado con otra clave. Es lo que
 *   impide que un tercero que descubra un endpoint pueda mandarle
 *   notificaciones a esa persona en nuestro nombre.
 * - La **privada** firma el JWT de cada envío y NUNCA sale del servidor.
 *
 * Consecuencia operativa que conviene tener clara antes de correr esto:
 * **regenerar el par invalida TODAS las suscripciones existentes**. Las filas
 * de `push_subscriptions` quedan apuntando a endpoints que ya solo aceptan la
 * clave vieja, y cada envío empieza a devolver 403. Si algún día hay que
 * rotar las claves, la rotación implica que cada persona vuelva a tocar
 * "Activar recordatorios". Por eso este script NO escribe ningún archivo:
 * imprime y deja que una persona decida dónde pegar el resultado.
 *
 * Este script tampoco toca los `.env`: el par se pega a mano (o con el flujo
 * documentado en `docs/push.md`). Los `.env` de este proyecto no se versionan
 * -`.gitignore` ignora `.env*` salvo `.env.example`- y la clave privada
 * VAPID no debe entrar JAMÁS al repositorio.
 */

import webpush from "web-push"

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

const SUBJECT = "mailto:contacto@historialmedico.com.ar"

console.log("")
console.log("=".repeat(78))
console.log(" Par de claves VAPID generado (curva P-256, base64url)")
console.log("=".repeat(78))
console.log("")
console.log("Pegá estas tres líneas en .env.local Y en .env.development.local")
console.log("(la segunda capa es la que usa `npm run dev` contra Supabase local):")
console.log("")
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log(`VAPID_SUBJECT=${SUBJECT}`)
console.log("")
console.log("Y esta CUARTA línea, con el MISMO valor que VAPID_PUBLIC_KEY, para")
console.log("que el navegador pueda pasarla como applicationServerKey:")
console.log("")
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`)
console.log("")
console.log("-".repeat(78))
console.log("Recordá:")
console.log("  · VAPID_PRIVATE_KEY es un secreto. Nunca se commitea ni se expone")
console.log("    al cliente: solo la lee `lib/push/servidor.ts` en el servidor.")
console.log("  · Regenerar el par INVALIDA todas las suscripciones existentes")
console.log("    (403 del Push Service). Rotar = pedirle a cada persona que")
console.log("    vuelva a activar las notificaciones.")
console.log("  · `.env.example` documenta las variables SIN valores. No pegues")
console.log("    nada ahí.")
console.log("-".repeat(78))
console.log("")
