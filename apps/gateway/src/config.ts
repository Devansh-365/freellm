/** Provider IDs ordered by speed (lowest latency first). */
export const FAST_PRIORITY = [
  "groq",
  "cerebras",
  "cloudflare",
  "gemini",
  "nim",
  "github",
  "mistral",
  "ollama",
] as const;

/** Provider IDs ordered by intelligence (most capable first). */
export const SMART_PRIORITY = [
  "gemini",
  "github",
  "nim",
  "groq",
  "cloudflare",
  "mistral",
  "cerebras",
  "ollama",
] as const;

/** The set of meta-model names that trigger multi-provider routing. */
export const META_MODELS = new Set(["free", "free-fast", "free-smart"]);

/** Default concrete model to use per provider when a meta-model is requested. */
export const DEFAULT_MODELS: Record<string, string> = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.5-flash",
  mistral: "mistral-small-latest",
  cerebras: "gpt-oss-120b",
  nim: "meta/llama-3.3-70b-instruct",
  cloudflare: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  github: "openai/gpt-4o-mini",
  ollama: "llama3",
};

/**
 * Upstream 4xx codes that are surfaced to the caller instead of failing
 * over, unless routing/upstream-errors.ts classifies the response as
 * provider-scoped (bad key, no access, model missing on that provider).
 * Strict mode always surfaces them.
 */
export const NON_RETRIABLE_STATUSES = new Set([400, 401, 403, 404]);

/**
 * The subset of NON_RETRIABLE_STATUSES that is always provider-scoped:
 * another provider can still serve the request, so non-strict routes fail
 * over. A 400 is provider-scoped only when its body says the model is
 * missing or inaccessible.
 */
export const PROVIDER_SCOPED_STATUSES = new Set([401, 403, 404]);

/** Meta-model entries returned by GET /v1/models. */
export const META_MODEL_ENTRIES = [
  {
    id: "free",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-fast",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-smart",
    object: "model" as const,
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
];
