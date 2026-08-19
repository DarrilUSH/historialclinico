/**
 * Cliente de Gemini (Google GenAI) — EXCLUSIVAMENTE SERVIDOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ⚠️  ESTE MÓDULO LEE `GEMINI_API_KEY`. JAMÁS SE IMPORTA DESDE CÓDIGO CLIENTE:
 *      ni un Client Component, ni un hook, ni un archivo con "use client", ni
 *      nada que termine en el bundle del navegador. El módulo aborta al
 *      cargarse si detecta que está corriendo en un navegador (ver guarda de
 *      abajo), mismo patrón que `lib/storage-admin.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Usa el SDK vigente `@google/genai` (pinneado a `^2` en `package.json`: la
 *  serie 3 ya soporta Node 24, pero se pinnea `^2` a propósito por estabilidad
 *  — ver el comentario junto a la dependencia en `package.json` /
 *  `ROADMAP_SPRINTS.md` §Sprint 1). **Nunca** el paquete de Google para Gemini
 *  que este reemplazó (el que NO tiene el scope `@google/genai`, ya
 *  discontinuado) ni modelos de la serie 1.5 (ya retirados — ver el roadmap
 *  para la lista de nombres de modelo prohibidos).
 *
 *  El modelo se lee de `process.env.GEMINI_MODEL_ID` en cada llamada — no hay
 *  que tocar código para cambiarlo (ver `scripts/test-gemini.mjs`).
 */

import { ApiError, GoogleGenAI, type GenerateContentResponse, type Part, type Schema } from '@google/genai';

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/gemini/client.ts se importó desde el navegador. Este módulo usa la ' +
      'GEMINI_API_KEY y sólo puede ejecutarse en el servidor.',
  );
}

/** Modelo por defecto si `GEMINI_MODEL_ID` no está seteada. */
export const MODELO_GEMINI_DEFAULT = 'gemini-3.5-flash-lite';

/**
 * Timeout por llamada a Gemini, en milisegundos. 30s es razonable para un
 * `generateContent` con `inlineData` de un PDF/imagen de pocas páginas; CADA
 * intento (ver `extraerJson`) usa el mismo valor.
 */
const TIMEOUT_MS = 30_000;

/**
 * Cantidad máxima de REINTENTOS ante un error TRANSITORIO (timeout o 5xx) —
 * no cuenta el intento inicial. Sprint 19: medido sobre 19 documentos reales,
 * 2 de 19 (1 de cada 9) murieron con `GeminiTimeoutError` después de gastar
 * el único reintento que había hasta acá, y ninguno de los dos era un
 * documento grande -uno pesaba 204 KB, el otro 2,6 KB-: el timeout era
 * transitorio (una llamada manual más, inmediatamente después, funcionó a la
 * primera) y el producto lo trataba como definitivo. Dos reintentos (tres
 * intentos en total) le dan una segunda chance a esa misma clase de falla sin
 * convertir esto en un bucle sin fin -ver `ESPERA_ENTRE_REINTENTOS_MS` para
 * el tope de tiempo total-.
 */
const MAX_REINTENTOS = 2;

/**
 * Espera (ms) ANTES de cada reintento, CRECIENTE — el primer reintento espera
 * `ESPERA_ENTRE_REINTENTOS_MS[0]`, el segundo `[1]`. Un backoff corto (1s,
 * luego 3s) alcanza para no repetir la llamada contra el mismo problema
 * transitorio en el mismo instante, sin sumar una espera larga que la
 * persona sienta como "esto se colgó" -`VeloEspera` ya avisa "puede tardar
 * hasta un minuto"-. Peor caso con `MAX_REINTENTOS = 2`: 3 × 30s de timeout +
 * 1s + 3s de espera ≈ 94s: ver `maxDuration` en
 * `app/api/documentos/extraer/route.ts`, que le da margen a la función
 * serverless para ese caso límite.
 */
const ESPERA_ENTRE_REINTENTOS_MS = [1_000, 3_000];

/** `await`-eable: espera `ms` milisegundos sin bloquear el event loop. */
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Error base de este módulo. Todos los errores que tira `extraerJson` heredan de acá. */
export class GeminiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiError';
  }
}

/** Falta configuración (variable de entorno ausente o inválida). No es transitorio: no tiene sentido reintentar. */
export class GeminiConfigError extends GeminiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiConfigError';
  }
}

/** La llamada no respondió dentro de `TIMEOUT_MS`. Se considera transitorio. */
export class GeminiTimeoutError extends GeminiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiTimeoutError';
  }
}

/**
 * La API de Gemini respondió con un error HTTP. `status` permite distinguir
 * errores transitorios (5xx, se reintentan hasta `MAX_REINTENTOS` veces) de
 * errores del cliente (4xx: API key inválida, modelo inexistente, request mal
 * formado — no se reintentan nunca).
 */
export class GeminiApiError extends GeminiError {
  readonly status: number | undefined;

  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, { cause: options?.cause });
    this.name = 'GeminiApiError';
    this.status = options?.status;
  }
}

/** Gemini respondió pero el contenido no era el JSON esperado (vacío o inválido). */
export class GeminiParseError extends GeminiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiParseError';
  }
}

let clienteCache: GoogleGenAI | null = null;

/** Instancia cacheada del cliente de `@google/genai`. Lee `GEMINI_API_KEY` recién en el primer uso. */
function clienteGemini(): GoogleGenAI {
  if (clienteCache) return clienteCache;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new GeminiConfigError('Falta la variable de entorno GEMINI_API_KEY.');
  }

  clienteCache = new GoogleGenAI({ apiKey });
  return clienteCache;
}

/** Model id vigente: `GEMINI_MODEL_ID` si está seteada, si no `MODELO_GEMINI_DEFAULT`. Se resuelve en cada llamada. */
export function obtenerModeloGemini(): string {
  const desdeEnv = process.env.GEMINI_MODEL_ID?.trim();
  return desdeEnv && desdeEnv.length > 0 ? desdeEnv : MODELO_GEMINI_DEFAULT;
}

/** Datos binarios inline (PDF o imagen) para adjuntar al prompt, en base64. */
export interface MediaInline {
  /** MIME type real del archivo (ej: "application/pdf", "image/jpeg"). */
  mimeType: string;
  /** Contenido del archivo codificado en base64 (sin el prefijo `data:...;base64,`). */
  data: string;
}

export interface ExtraerJsonParams {
  /** Instrucción / contexto en texto plano para el modelo. */
  prompt: string;
  /** Adjunto opcional (foto o PDF de un documento médico) como `inlineData`. */
  media?: MediaInline;
  /** Schema de `@google/genai` (`Type.OBJECT`, etc.) contra el que Gemini valida la respuesta. */
  schema: Schema;
}

/** Errores considerados transitorios: vale la pena reintentar (hasta `MAX_REINTENTOS` veces). Nunca 4xx. */
function esErrorTransitorio(error: unknown): boolean {
  if (error instanceof GeminiTimeoutError) return true;
  if (error instanceof GeminiApiError) {
    return typeof error.status === 'number' && error.status >= 500 && error.status < 600;
  }
  return false;
}

async function llamarGenerateContent(model: string, parts: Part[], schema: Schema): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await clienteGemini().models.generateContent({
      model,
      contents: parts,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
        abortSignal: controller.signal,
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GeminiTimeoutError(
        `Gemini no respondió dentro de ${TIMEOUT_MS / 1000} segundos (modelo "${model}").`,
        { cause: error },
      );
    }
    if (error instanceof ApiError) {
      throw new GeminiApiError(
        `Gemini devolvió un error HTTP ${error.status} (modelo "${model}"): ${error.message}`,
        { cause: error, status: error.status },
      );
    }
    throw new GeminiApiError(`Error inesperado al llamar a Gemini (modelo "${model}"): ${String(error)}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ejecuta `llamarGenerateContent` con reintentos ante error TRANSITORIO
 * (`esErrorTransitorio`), con espera creciente entre cada uno
 * (`ESPERA_ENTRE_REINTENTOS_MS`). Un error de CONTRATO (4xx, parseo) se
 * propaga en el primer intento, sin esperar ni reintentar -ver el comentario
 * de `extraerJson`, que es quien llama a esto-.
 */
async function llamarConReintentos(model: string, parts: Part[], schema: Schema): Promise<GenerateContentResponse> {
  for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
    try {
      return await llamarGenerateContent(model, parts, schema);
    } catch (error) {
      const esUltimoIntento = intento === MAX_REINTENTOS;
      if (!esErrorTransitorio(error) || esUltimoIntento) throw error;

      const espera = ESPERA_ENTRE_REINTENTOS_MS[intento] ?? ESPERA_ENTRE_REINTENTOS_MS.at(-1)!;
      console.warn(
        `[gemini] Intento ${intento + 1}/${MAX_REINTENTOS + 1} falló con un error transitorio ` +
          `(modelo "${model}"), reintentando en ${espera}ms:`,
        error instanceof Error ? error.message : error,
      );
      await esperar(espera);
    }
  }
  // Inalcanzable: el `for` siempre termina en `return` (éxito) o `throw`
  // (agotó los intentos, `esUltimoIntento` es `true` en la última vuelta).
  // TypeScript no puede probarlo por sí solo porque la condición vive dentro
  // del `catch`, así que queda este `throw` explícito para que la función
  // tipe como `Promise<GenerateContentResponse>` y no `Promise<GenerateContentResponse | undefined>`.
  throw new GeminiError('Se agotaron los reintentos sin una respuesta ni un error (no debería pasar nunca).');
}

/**
 * Llama a `generateContent` pidiendo salida JSON validada contra `schema` y
 * devuelve el objeto ya parseado.
 *
 * Reintenta hasta `MAX_REINTENTOS` veces ante error TRANSITORIO (HTTP 5xx o
 * timeout), con espera CRECIENTE entre cada intento (`ESPERA_ENTRE_REINTENTOS_MS`
 * — Sprint 19, medido: 1 reintento no alcanzaba, ver su comentario). Los
 * errores de CONTRATO -4xx (API key inválida, modelo inexistente, request mal
 * formado) y cualquier otro que `esErrorTransitorio` no reconozca- NO se
 * reintentan: se propagan de inmediato porque un intento más fallaría
 * exactamente igual y solo alargaría la espera de la persona sin ninguna
 * chance real de éxito.
 *
 * @throws {GeminiConfigError} si falta `GEMINI_API_KEY`.
 * @throws {GeminiTimeoutError} si NINGUNO de los intentos respondió a tiempo.
 * @throws {GeminiApiError} si Gemini devolvió un error HTTP (4xx, o 5xx tras agotar los reintentos).
 * @throws {GeminiParseError} si la respuesta no trae texto o el texto no es JSON válido.
 */
export async function extraerJson<T>({ prompt, media, schema }: ExtraerJsonParams): Promise<T> {
  const model = obtenerModeloGemini();

  const parts: Part[] = [{ text: prompt }];
  if (media) {
    parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
  }

  const respuesta = await llamarConReintentos(model, parts, schema);

  const texto = respuesta.text;
  if (!texto || texto.trim().length === 0) {
    throw new GeminiParseError(`Gemini no devolvió contenido de texto en la respuesta (modelo "${model}").`);
  }

  try {
    return JSON.parse(texto) as T;
  } catch (error) {
    throw new GeminiParseError(
      `La respuesta de Gemini no es JSON válido (modelo "${model}"): ${String(error)}`,
      { cause: error },
    );
  }
}
