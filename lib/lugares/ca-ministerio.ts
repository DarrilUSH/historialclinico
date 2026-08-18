import "server-only"

/**
 * Certificado intermedio que le FALTA a datos.salud.gob.ar (Sprint 16, tarea
 * 16.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ESTO NO ES UN SECRETO Y NO DEBILITA NADA. Es un certificado público de una
 *  autoridad certificante pública, del mismo tipo que los 144 que Node ya
 *  trae adentro. Sumarlo al almacén de confianza de UNA conexión concreta no
 *  desactiva la verificación TLS: la sigue exigiendo entera, y contra una raíz
 *  que Node ya consideraba confiable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## El problema, medido
 *
 * El portal del Ministerio de Salud sirve una cadena TLS INCOMPLETA: presenta
 * su certificado hoja (`CN=*.salud.gob.ar`, emitido por "Sectigo Public
 * Server Authentication CA DV R36") y, en lugar del intermedio que lo firmó,
 * un certificado de otra cadena que no tiene nada que ver ("USERTrust ECC
 * Certification Authority"). Los navegadores no lo notan porque persiguen la
 * extensión AIA del certificado y bajan el intermedio faltante por su cuenta;
 * **Node no hace AIA chasing**, así que su `fetch` falla:
 *
 *     UNABLE_TO_VERIFY_LEAF_SIGNATURE — unable to verify the first certificate
 *
 * (verificado el 2026-08-18 con Node 24 contra el CSV del REFES; `curl`
 * necesita `-k` contra el mismo host).
 *
 * ## Lo que se hizo, y lo que NO se hizo
 *
 * **NO** se usó `rejectUnauthorized: false` ni `NODE_TLS_REJECT_UNAUTHORIZED=0`.
 * Eso apagaría la verificación —cualquier certificado, de cualquiera, valdría—
 * y convertiría la sincronización en un canal donde un intermediario puede
 * inyectar 36.000 filas arbitrarias en el catálogo de la app, con las
 * direcciones y coordenadas a las que después se manda a la familia del
 * usuario. Es exactamente el tipo de atajo que este proyecto no toma.
 *
 * Lo que se hizo es lo que hace un navegador, pero explícito: se bajó el
 * intermedio que falta desde la URL que el propio certificado hoja declara en
 * su extensión AIA (`http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt`)
 * y se pegó acá. `lib/lugares/descarga.ts` arma un almacén de confianza que
 * es **las raíces que Node ya trae MÁS este intermedio**, y lo usa SOLO para
 * las conexiones a `datos.salud.gob.ar` (`HOST_MINISTERIO`): ninguna otra
 * request de la aplicación cambia de comportamiento.
 *
 * La cadena queda completa y verificada de punta a punta:
 *
 *     CN=*.salud.gob.ar
 *       ← Sectigo Public Server Authentication CA DV R36   ← ESTE archivo
 *         ← Sectigo Public Server Authentication Root R46  ← ya en Node
 *
 * ## Si el certificado cambia
 *
 * Válido hasta el 21 de marzo de 2036. Si el Ministerio cambia de autoridad
 * certificante antes, la sincronización **falla ruidosamente** con el mismo
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` y el mensaje en castellano que arma
 * `lib/lugares/descarga.ts` — que es el comportamiento correcto: hay que
 * mirar qué cambió y actualizar este archivo, no seguir bajando datos sin
 * verificar quién los manda. Un `rejectUnauthorized: false` habría hecho que
 * ese cambio pasara desapercibido para siempre.
 *
 * Huella SHA-256 del certificado de abajo (para poder auditarlo sin
 * decodificarlo):
 *   8C:54:C3:34:B6:6B:A4:E4:26:77:2A:F4:A3:F9:13:6C:19:A1:AE:C7:29:FD:B2:8C:53:5C:07:A5:A4:EF:22:E0
 *
 * Va como constante de TypeScript y no como un `.pem` leído con `fs`: en
 * Vercel el bundle de una función serverless no incluye archivos sueltos del
 * repo salvo que se los declare, y un `readFileSync` que funciona en local y
 * revienta en producción es justo el tipo de sorpresa que no queremos en el
 * único camino que trae los datos.
 */
export const CERTIFICADO_INTERMEDIO_MINISTERIO = `-----BEGIN CERTIFICATE-----
MIIGTDCCBDSgAwIBAgIQOXpmzCdWNi4NqofKbqvjsTANBgkqhkiG9w0BAQwFADBf
MQswCQYDVQQGEwJHQjEYMBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTYwNAYDVQQD
Ey1TZWN0aWdvIFB1YmxpYyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gUm9vdCBSNDYw
HhcNMjEwMzIyMDAwMDAwWhcNMzYwMzIxMjM1OTU5WjBgMQswCQYDVQQGEwJHQjEY
MBYGA1UEChMPU2VjdGlnbyBMaW1pdGVkMTcwNQYDVQQDEy5TZWN0aWdvIFB1Ymxp
YyBTZXJ2ZXIgQXV0aGVudGljYXRpb24gQ0EgRFYgUjM2MIIBojANBgkqhkiG9w0B
AQEFAAOCAY8AMIIBigKCAYEAljZf2HIz7+SPUPQCQObZYcrxLTHYdf1ZtMRe7Yeq
RPSwygz16qJ9cAWtWNTcuICc++p8Dct7zNGxCpqmEtqifO7NvuB5dEVexXn9RFFH
12Hm+NtPRQgXIFjx6MSJcNWuVO3XGE57L1mHlcQYj+g4hny90aFh2SCZCDEVkAja
EMMfYPKuCjHuuF+bzHFb/9gV8P9+ekcHENF2nR1efGWSKwnfG5RawlkaQDpRtZTm
M64TIsv/r7cyFO4nSjs1jLdXYdz5q3a4L0NoabZfbdxVb+CUEHfB0bpulZQtH1Rv
38e/lIdP7OTTIlZh6OYL6NhxP8So0/sht/4J9mqIGxRFc0/pC8suja+wcIUna0HB
pXKfXTKpzgis+zmXDL06ASJf5E4A2/m+Hp6b84sfPAwQ766rI65mh50S0Di9E3Pn
2WcaJc+PILsBmYpgtmgWTR9eV9otfKRUBfzHUHcVgarub/XluEpRlTtZudU5xbFN
xx/DgMrXLUAPaI60fZ6wA+PTAgMBAAGjggGBMIIBfTAfBgNVHSMEGDAWgBRWc1hk
lfmSGrASKgRieaFAFYghSTAdBgNVHQ4EFgQUaMASFhgOr872h6YyV6NGUV3LBycw
DgYDVR0PAQH/BAQDAgGGMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0lBBYwFAYI
KwYBBQUHAwEGCCsGAQUFBwMCMBsGA1UdIAQUMBIwBgYEVR0gADAIBgZngQwBAgEw
VAYDVR0fBE0wSzBJoEegRYZDaHR0cDovL2NybC5zZWN0aWdvLmNvbS9TZWN0aWdv
UHVibGljU2VydmVyQXV0aGVudGljYXRpb25Sb290UjQ2LmNybDCBhAYIKwYBBQUH
AQEEeDB2ME8GCCsGAQUFBzAChkNodHRwOi8vY3J0LnNlY3RpZ28uY29tL1NlY3Rp
Z29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNhdGlvblJvb3RSNDYucDdjMCMGCCsGAQUF
BzABhhdodHRwOi8vb2NzcC5zZWN0aWdvLmNvbTANBgkqhkiG9w0BAQwFAAOCAgEA
YtOC9Fy+TqECFw40IospI92kLGgoSZGPOSQXMBqmsGWZUQ7rux7cj1du6d9rD6C8
ze1B2eQjkrGkIL/OF1s7vSmgYVafsRoZd/IHUrkoQvX8FZwUsmPu7amgBfaY3g+d
q1x0jNGKb6I6Bzdl6LgMD9qxp+3i7GQOnd9J8LFSietY6Z4jUBzVoOoz8iAU84OF
h2HhAuiPw1ai0VnY38RTI+8kepGWVfGxfBWzwH9uIjeooIeaosVFvE8cmYUB4TSH
5dUyD0jHct2+8ceKEtIoFU/FfHq/mDaVnvcDCZXtIgitdMFQdMZaVehmObyhRdDD
4NQCs0gaI9AAgFj4L9QtkARzhQLNyRf87Kln+YU0lgCGr9HLg3rGO8q+Y4ppLsOd
unQZ6ZxPNGIfOApbPVf5hCe58EZwiWdHIMn9lPP6+F404y8NNugbQixBber+x536
WrZhFZLjEkhp7fFXf9r32rNPfb74X/U90Bdy4lzp3+X1ukh1BuMxA/EEhDoTOS3l
7ABvc7BYSQubQ2490OcdkIzUh3ZwDrakMVrbaTxUM2p24N6dB+ns2zptWCva6jzW
r8IWKIMxzxLPv5Kt3ePKcUdvkBU/smqujSczTzzSjIoR5QqQA6lN1ZRSnuHIWCvh
JEltkYnTAH41QJ6SAWO66GrrUESwN/cgZzL4JLEqz1Y=
-----END CERTIFICATE-----
`
