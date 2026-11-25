import { PROVIDER_SCOPED_STATUSES } from "../config.js";

/**
 * Classify an upstream 4xx (other than 429) as provider-scoped or
 * request-scoped.
 *
 * Provider-scoped errors mean "this provider cannot serve this request,
 * but another one might": a revoked or missing key (401), no access to
 * the model on this account (403), the model is gone from this provider
 * (404), or a 400 whose body says the model is missing, decommissioned,
 * or not accessible. Groq, for instance, answers a shut-down model with
 * `404 model_not_found` while still listing it on its public models page,
 * and answers some decommissioned models with a 400.
 *
 * Request-scoped errors (any other 400, 413, 422, ...) mean the request
 * itself is malformed. Every provider would reject it, so failing over
 * only burns quota on the remaining providers.
 */

/** Upstream error codes / types that mean the model is unavailable on this provider. */
const MODEL_UNAVAILABLE_CODES = new Set([
  "model_not_found",
  "model_decommissioned",
  "model_not_available",
  "model_deprecated",
  "invalid_model",
]);

/**
 * Message phrases that mean the model is unavailable. Only consulted when
 * the message also mentions a model, so a 400 like "field `foo` does not
 * exist" stays request-scoped.
 */
const MODEL_UNAVAILABLE_PHRASES =
  /does not exist|decommissioned|(?:do not|does not|don't) have access|no longer (?:available|supported)|not found|invalid model|unknown model/i;

const MENTIONS_MODEL = /\bmodels?\b/i;

/** Cap on how much of an upstream error body we read for classification. */
const MAX_BODY_CHARS = 16_384;

/**
 * True when a non-strict route should fail over past this response.
 * Reads the body from a clone, so the original Response stays unread and
 * can still be surfaced to the caller verbatim.
 */
export async function isProviderScopedClientError(response: Response): Promise<boolean> {
  if (PROVIDER_SCOPED_STATUSES.has(response.status)) return true;
  if (response.status !== 400) return false;
  return bodyIndicatesModelUnavailable(await readBodySafely(response));
}

/** Exported for tests. Inspects a raw upstream error body. */
export function bodyIndicatesModelUnavailable(raw: string): boolean {
  if (!raw) return false;
  const { codes, messages } = extractErrorFields(raw);
  if (codes.some((c) => MODEL_UNAVAILABLE_CODES.has(c.toLowerCase()))) return true;
  return messages.some((m) => MENTIONS_MODEL.test(m) && MODEL_UNAVAILABLE_PHRASES.test(m));
}

async function readBodySafely(response: Response): Promise<string> {
  try {
    const text = await response.clone().text();
    return text.slice(0, MAX_BODY_CHARS);
  } catch {
    return "";
  }
}

/**
 * Pull code-like and message-like strings out of the common upstream error
 * shapes: OpenAI-style `{ error: { code, type, message } }`, Mistral-style
 * top-level `{ type, message }`, and Gemini's array-wrapped
 * `[{ error: { status, message } }]`. Non-JSON bodies are treated as a
 * single message.
 */
function extractErrorFields(raw: string): { codes: string[]; messages: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { codes: [], messages: [raw] };
  }

  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!root || typeof root !== "object") return { codes: [], messages: [raw] };

  const codes: string[] = [];
  const messages: string[] = [];
  const layers = [root as Record<string, unknown>];
  const nested = (root as { error?: unknown }).error;
  if (nested && typeof nested === "object") layers.push(nested as Record<string, unknown>);
  else if (typeof nested === "string") messages.push(nested);

  for (const layer of layers) {
    for (const key of ["code", "type", "status"]) {
      const v = layer[key];
      if (typeof v === "string") codes.push(v);
    }
    for (const key of ["message", "detail"]) {
      const v = layer[key];
      if (typeof v === "string") messages.push(v);
    }
  }
  return { codes, messages };
}
