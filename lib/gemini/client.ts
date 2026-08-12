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
export const MODELO_GEMINI_DEFAULT = 'gemini-2.5-flash';

/**
 * Timeout por llamada a Gemini, en milisegundos. 30s es razonable para un
 * `generateContent` con `inlineData` de un PDF/imagen de pocas páginas; el
 * único reintento (ver `extraerJson`) usa el mismo valor.
 */
const TIMEOUT_MS = 30_000;

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
 * errores transitorios (5xx, se reintentan una vez) de errores del cliente
 * (4xx: API key inválida, modelo inexistente, request mal formado — no se
 * reintentan).
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

/** Errores considerados transitorios: vale la pena reintentar una sola vez. Nunca 4xx. */
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
 * Llama a `generateContent` pidiendo salida JSON validada contra `schema` y
 * devuelve el objeto ya parseado.
 *
 * Reintenta **una sola vez** ante error transitorio (HTTP 5xx o timeout). Los
 * errores 4xx (API key inválida, modelo inexistente, request mal formado) NO
 * se reintentan: se propagan de inmediato porque un segundo intento fallaría
 * exactamente igual.
 *
 * @throws {GeminiConfigError} si falta `GEMINI_API_KEY`.
 * @throws {GeminiTimeoutError} si ninguno de los dos intentos respondió a tiempo.
 * @throws {GeminiApiError} si Gemini devolvió un error HTTP (4xx o 5xx tras el reintento).
 * @throws {GeminiParseError} si la respuesta no trae texto o el texto no es JSON válido.
 */
export async function extraerJson<T>({ prompt, media, schema }: ExtraerJsonParams): Promise<T> {
  const model = obtenerModeloGemini();

  const parts: Part[] = [{ text: prompt }];
  if (media) {
    parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
  }

  let respuesta: GenerateContentResponse;
  try {
    respuesta = await llamarGenerateContent(model, parts, schema);
  } catch (error) {
    if (!esErrorTransitorio(error)) throw error;
    // Único reintento ante error transitorio. Si vuelve a fallar, el error se propaga tal cual.
    respuesta = await llamarGenerateContent(model, parts, schema);
  }

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
