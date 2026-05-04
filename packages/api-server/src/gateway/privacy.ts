/**
 * Provider privacy / training-policy catalog.
 *
 * Each entry states whether the provider trains its models on data sent
 * through its free tier, sourced from the provider's public terms of
 * service. The `last_verified` date is when a human last checked the
 * source and confirmed the policy still matched our mark.
 *
 * Clients can require a specific posture per-request via the header
 *
 *     X-FreeLLM-Privacy: no-training
 *
 * which makes the router filter candidate providers to only those marked
 * `no-training` before picking one. If no eligible provider exists for
 * the requested model, the router throws a typed error the caller can
 * surface to the user.
 *
 * This file is the single source of truth. If you update an entry, bump
 * its `last_verified` date and update the matching website page at
 * packages/website/src/content/docs/privacy.mdx.
 */

export type TrainingPolicy =
  /** Provider contractually does not train on free-tier requests. */
  | "no-training"
  /** Provider trains on free-tier requests (e.g. Gemini free). */
  | "free-tier-trains"
  /** Operator must opt out per their own terms (e.g. Mistral workspace setting). */
  | "configurable"
  /** Local / self-hosted model, no upstream data leaves the machine. */
  | "local";

export interface ProviderPrivacy {
  policy: TrainingPolicy;
  /** Public URL documenting the policy on the provider's own site. */
  source_url: string;
  /** ISO date (YYYY-MM-DD) when the policy was last human-verified. */
  last_verified: string;
  /** Optional human note. */
  note?: string;
}

/**
 * Catalog keyed by provider id. MUST cover every provider in
 * registry.ts. The exhaustiveness test in tests/privacy.test.ts will
 * fail if a new provider is added without an entry here.
 */
export const PROVIDER_PRIVACY: Record<string, ProviderPrivacy> = {
  groq: {
    policy: "no-training",
    source_url: "https://groq.com/terms-of-use/",
    last_verified: "2026-04-09",
    note: "Groq terms state inputs and outputs are not used to train Groq models.",
  },
  gemini: {
    policy: "free-tier-trains",
    source_url: "https://ai.google.dev/gemini-api/terms",
    last_verified: "2026-04-09",
    note: "Gemini free tier may use prompts to improve Google products; paid tier does not.",
  },
  mistral: {
    policy: "configurable",
    source_url: "https://mistral.ai/terms/",
    last_verified: "2026-04-09",
    note: "Mistral La Plateforme lets workspace admins opt out of training data use.",
  },
  cerebras: {
    policy: "no-training",
    source_url: "https://www.cerebras.net/privacy-policy/",
    last_verified: "2026-04-09",
    note: "Cerebras Inference terms exclude training on customer prompts.",
  },
  nim: {
    policy: "no-training",
    source_url: "https://www.nvidia.com/en-us/agreements/cloud-services/service-specific-terms-for-nvidia-nim/",
    last_verified: "2026-04-09",
    note: "NVIDIA NIM service terms exclude training on customer inference data.",
  },
  cloudflare: {
    policy: "no-training",
    source_url: "https://developers.cloudflare.com/workers-ai/privacy/",
    last_verified: "2026-04-13",
    note: "Cloudflare Workers AI privacy docs state inputs and outputs are not used for training.",
  },
  github: {
    policy: "no-training",
    source_url: "https://docs.github.com/en/github-models/responsible-use-of-github-models",
    last_verified: "2026-04-13",
    note: "GitHub Models responsible-use docs exclude prompts and completions from training.",
  },
  ollama: {
    policy: "local",
    source_url: "https://github.com/ollama/ollama",
    last_verified: "2026-04-09",
    note: "Ollama runs locally; data never leaves the host.",
  },
  "claude-code": {
    policy: "local",
    source_url: "https://docs.claude.com/en/docs/claude-code/overview",
    last_verified: "2026-05-04",
    note: "Routes through user's host Claude Code OAuth credentials; uses user's own Claude subscription. No FreeLLM-managed key.",
  },
};

/** Return the policies that satisfy a caller-requested posture. */
export function policiesAllowedBy(requested: PrivacyRequest): Set<TrainingPolicy> {
  if (requested === "no-training") {
    return new Set<TrainingPolicy>(["no-training", "local"]);
  }
  // Default: accept every policy. "any" is the non-strict fallback.
  return new Set<TrainingPolicy>(["no-training", "free-tier-trains", "configurable", "local"]);
}

/** Allowed values for the X-FreeLLM-Privacy header. */
export type PrivacyRequest = "any" | "no-training";

const ACCEPTED = new Set<PrivacyRequest>(["any", "no-training"]);

/**
 * Parse the inbound X-FreeLLM-Privacy header. Unknown/missing values
 * become `any` (no filtering) so existing callers see no change.
 */
export function parsePrivacyHeader(value: unknown): PrivacyRequest {
  if (typeof value !== "string") return "any";
  const normalized = value.trim().toLowerCase();
  return ACCEPTED.has(normalized as PrivacyRequest)
    ? (normalized as PrivacyRequest)
    : "any";
}

/** True if the provider's declared policy satisfies the request. */
export function providerSatisfiesPrivacy(
  providerId: string,
  requested: PrivacyRequest,
): boolean {
  if (requested === "any") return true;
  const entry = PROVIDER_PRIVACY[providerId];
  if (!entry) return false; // Unknown provider: fail closed.
  return policiesAllowedBy(requested).has(entry.policy);
}

/**
 * How many days since the catalog entry was last verified? Used by a
 * boot-time warning when any entry is older than 90 days.
 */
export function daysSinceVerified(
  entry: ProviderPrivacy,
  now: number = Date.now(),
): number {
  const verified = Date.parse(entry.last_verified);
  if (!Number.isFinite(verified)) return Number.POSITIVE_INFINITY;
  const diffMs = now - verified;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
