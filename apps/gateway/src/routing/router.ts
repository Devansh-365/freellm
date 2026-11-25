import { DEFAULT_MODELS, META_MODELS, NON_RETRIABLE_STATUSES } from "../config.js";
import { freellmError } from "../errors/index.js";
import { logger } from "../logger.js";
import { ObservabilityStore } from "../observability/index.js";
import type { RequestLog } from "../observability/request-log.js";
import type { UsageTracker } from "../observability/usage-tracker.js";
import type { ProviderAdapter } from "../providers/types.js";
import type { ChatCompletionRequest, ChatCompletionResponse, RoutingStrategy } from "../types.js";
import { type ResponseCache, hasImageContent } from "./cache.js";
import { type PrivacyRequest, providerSatisfiesPrivacy } from "./privacy.js";
import type { ProviderRegistry } from "./registry.js";
import { parseRetryAfter } from "./retry-after.js";
import { assertStrictModeAllowed } from "./strict.js";
import { isProviderScopedClientError } from "./upstream-errors.js";

export type RouteReason = "direct" | "meta" | "cache" | "failover";

export interface RouteMeta {
  provider: string;
  resolvedModel: string;
  requestedModel: string;
  cached: boolean;
  reason: RouteReason;
  attempted: string[];
}

export interface RouteOptions {
  strict?: boolean;
  privacy?: PrivacyRequest;
}

const ROUTE_TIMEOUT_MS = Number.parseInt(process.env.ROUTE_TIMEOUT_MS ?? "30000", 10);

export class GatewayRouter {
  // Round-robin index for explicit (non-meta) model requests
  private rrIndex = 0;
  // Per-meta-model round-robin indices for true rotation across providers
  private metaRrIndices = new Map<string, number>();

  public strategy: RoutingStrategy = "round_robin";
  public requestLog: RequestLog;
  public usageTracker: UsageTracker;
  public cache: ResponseCache;

  constructor(
    private registry: ProviderRegistry,
    private obs: ObservabilityStore = new ObservabilityStore(),
  ) {
    this.requestLog = obs.requestLog;
    this.usageTracker = obs.usageTracker;
    this.cache = obs.cache;
  }

  private pickProvider(
    modelId: string,
    excluded: Set<string>,
    privacy: PrivacyRequest = "any",
    requiresTools = false,
    requiresVision = false,
  ): ProviderAdapter | undefined {
    // Merge privacy exclusions into the caller-supplied exclude set so the
    // registry never sees providers the privacy posture forbids.
    const effectiveExcluded = new Set(excluded);
    if (privacy !== "any") {
      for (const p of this.registry.getAll()) {
        if (!providerSatisfiesPrivacy(p.id, privacy)) {
          effectiveExcluded.add(p.id);
        }
      }
    }

    // Exclude providers that can't handle tool-calling when the request
    // contains tools. Without this Cerebras (and similar providers) return
    // 400 and cause a retry cascade on every tool-use request.
    if (requiresTools) {
      for (const p of this.registry.getAll()) {
        if (!p.supportsTools) effectiveExcluded.add(p.id);
      }
    }

    // Exclude providers with no vision-capable models when the request
    // contains image content. resolveModelForProvider() will then pick
    // the first vision model from the winning provider.
    if (requiresVision) {
      for (const p of this.registry.getAll()) {
        if (!p.models.some((m) => m.supportsVision)) {
          effectiveExcluded.add(p.id);
        }
      }
    }

    if (META_MODELS.has(modelId)) {
      return this.registry.getProviderForMetaModel(
        modelId,
        effectiveExcluded,
        this.strategy,
        this.getMetaRrIndex(modelId),
        (next) => this.setMetaRrIndex(modelId, next),
      );
    }

    const available = this.registry
      .getAvailable()
      .filter((p) => !effectiveExcluded.has(p.id) && p.models.some((m) => m.id === modelId));

    if (available.length === 0) return undefined;

    if (this.strategy === "random") {
      return available[Math.floor(Math.random() * available.length)];
    }

    // round_robin
    const idx = this.rrIndex % available.length;
    this.rrIndex = (this.rrIndex + 1) % 1_000_000;
    return available[idx];
  }

  private getMetaRrIndex(metaModel: string): number {
    return this.metaRrIndices.get(metaModel) ?? 0;
  }

  private setMetaRrIndex(metaModel: string, next: number): void {
    this.metaRrIndices.set(metaModel, next % 1_000_000);
  }

  private resolveModelForProvider(
    requestedModel: string,
    provider: ProviderAdapter,
    requiresVision = false,
  ): string {
    if (META_MODELS.has(requestedModel)) {
      if (requiresVision) {
        // For vision requests pick the first vision-capable model from this
        // provider. The models array is ordered best-first by convention.
        const visionModel = provider.models.find((m) => m.supportsVision);
        if (visionModel) return visionModel.id;
      }
      const defaultModel = DEFAULT_MODELS[provider.id];
      if (defaultModel) {
        const prefixed = `${provider.id}/${defaultModel}`;
        if (provider.models.some((m) => m.id === prefixed)) return prefixed;
      }
      const first = provider.models[0];
      return first ? first.id : requestedModel;
    }
    return requestedModel;
  }

  async route(
    request: ChatCompletionRequest,
    options: RouteOptions = {},
  ): Promise<{
    response: Response;
    provider: ProviderAdapter;
    resolvedModel: string;
    attempted: string[];
    failoverCount: number;
  }> {
    const strict = options.strict === true;
    const privacy: PrivacyRequest = options.privacy ?? "any";
    const requiresVision = hasImageContent(request);
    assertStrictModeAllowed(request.model, strict);

    // Fail fast when a specific non-vision model is requested with image content.
    // Meta-models (free, free-smart, free-fast) handle vision by routing to a
    // vision-capable provider automatically — only direct model requests fail here.
    if (requiresVision && !META_MODELS.has(request.model)) {
      const modelObj = this.registry
        .getAll()
        .flatMap((p) => p.models)
        .find((m) => m.id === request.model);
      if (modelObj && !modelObj.supportsVision) {
        throw freellmError({
          code: "model_not_supported",
          message: `Model "${request.model}" does not support vision/image inputs. Use a vision-capable model or a meta-model (free, free-smart, free-fast).`,
          requested_model: request.model,
        });
      }
    }

    // Fail fast when a privacy posture rules out every configured provider
    // for this model. The caller gets a distinct, actionable error instead
    // of a generic "all providers exhausted" after a pointless loop.
    if (privacy !== "any") {
      const anyEligible = this.registry.getAll().some((p) => {
        if (!p.isEnabled()) return false;
        if (!providerSatisfiesPrivacy(p.id, privacy)) return false;
        if (META_MODELS.has(request.model)) return true;
        return p.models.some((m) => m.id === request.model);
      });
      if (!anyEligible) {
        throw freellmError({
          code: "model_not_supported",
          message: `No provider matching privacy policy "${privacy}" is configured for model "${request.model}".`,
          requested_model: request.model,
        });
      }
    }

    const excluded = new Set<string>();
    const attempted: string[] = [];
    let failoverCount = 0;
    // Set when the most recent failure was a provider-scoped 4xx that we
    // failed over past; cleared by any other kind of failure. If every
    // candidate ends up excluded, this upstream error is surfaced instead of
    // a generic exhaustion error.
    let lastClientError: ProviderClientError | undefined;
    const deadline = Date.now() + ROUTE_TIMEOUT_MS;

    while (true) {
      if (Date.now() > deadline) {
        throw new AllProvidersExhaustedError(
          `Routing timeout (${ROUTE_TIMEOUT_MS}ms) exceeded for model: ${request.model}`,
          [...excluded],
        );
      }

      const provider = this.pickProvider(
        request.model,
        excluded,
        privacy,
        (request.tools?.length ?? 0) > 0,
        requiresVision,
      );

      if (!provider) {
        // The last candidate rejected the model or credentials. Surface
        // its upstream error so a direct request like `groq/<dead-model>`
        // still returns the provider's own message.
        if (lastClientError) throw lastClientError;
        throw new AllProvidersExhaustedError(
          `All providers exhausted for model: ${request.model}`,
          [...excluded],
        );
      }

      if (!attempted.includes(provider.id)) attempted.push(provider.id);

      const resolvedModel = this.resolveModelForProvider(request.model, provider, requiresVision);
      const mappedRequest = { ...request, model: resolvedModel };

      try {
        const response = await provider.complete(mappedRequest);

        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
          // onRateLimit takes seconds (the provider API contract). Pass the
          // clamped value so absurd upstream hints can't lock a key out.
          provider.onRateLimit(
            response,
            retryAfterMs != null ? Math.ceil(retryAfterMs / 1000) : undefined,
          );
          // Only exclude the provider if ALL its keys are now rate-limited.
          // Otherwise the next iteration can pick a different key from the same provider.
          if (!provider.isAvailable()) {
            excluded.add(provider.id);
          }
          // Strict mode never falls back to a different provider.
          if (strict) {
            throw new ProviderClientError(provider.id, response.status, response);
          }
          lastClientError = undefined;
          failoverCount++;
          continue;
        }

        if (NON_RETRIABLE_STATUSES.has(response.status)) {
          const clientError = new ProviderClientError(provider.id, response.status, response);
          // Strict mode never falls back. Request-scoped errors (malformed
          // body, bad params) would fail on every provider, so surface them.
          if (strict || !(await isProviderScopedClientError(response))) {
            throw clientError;
          }
          // Provider-scoped: bad key, no access, or the model is gone from
          // this provider. Another provider can still serve the request.
          logger.warn(
            { provider: provider.id, model: resolvedModel, status: response.status },
            "provider rejected the model or credentials, failing over",
          );
          provider.onError();
          excluded.add(provider.id);
          lastClientError = clientError;
          failoverCount++;
          continue;
        }

        lastClientError = undefined;

        if (response.status >= 500) {
          // Some providers send Retry-After on 5xx too. Treat it as a cooldown
          // hint for the key so we don't immediately retry into the same hole.
          const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
          if (retryAfterMs != null) {
            provider.onRateLimit(response, Math.ceil(retryAfterMs / 1000));
          }
          provider.onError();
          excluded.add(provider.id);
          if (strict) {
            throw new ProviderClientError(provider.id, response.status, response);
          }
          failoverCount++;
          continue;
        }

        if (!response.ok) {
          provider.onError();
          excluded.add(provider.id);
          if (strict) {
            throw new ProviderClientError(provider.id, response.status, response);
          }
          failoverCount++;
          continue;
        }

        provider.onSuccess(response);
        return { response, provider, resolvedModel, attempted, failoverCount };
      } catch (err) {
        if (err instanceof ProviderClientError) throw err;
        lastClientError = undefined;
        provider.onError();
        excluded.add(provider.id);
        if (strict) throw err;
        failoverCount++;
      }
    }
  }

  async complete(
    request: ChatCompletionRequest,
    options: RouteOptions = {},
  ): Promise<{ data: ChatCompletionResponse; meta: RouteMeta }> {
    const startTime = Date.now();
    const strict = options.strict === true;
    const requiresVision = hasImageContent(request);

    // Cache check FIRST. Hits short-circuit the entire routing flow:
    // no provider call, no token quota burn, ~0ms latency.
    // Strict mode and vision requests both bypass the cache: strict because
    // a cached response may have come from a different provider; vision because
    // image payloads are large, near-zero repeat rate, and the cache self-guards.
    const cached = strict || requiresVision ? null : this.cache.get(request);
    if (cached) {
      const latencyMs = Date.now() - startTime;
      const data: ChatCompletionResponse = {
        ...cached.response,
        x_freellm_provider: cached.provider,
        x_freellm_cached: true,
      };

      this.requestLog.add({
        requestedModel: request.model,
        resolvedModel: cached.response.model,
        provider: cached.provider,
        latencyMs,
        status: "success",
        streaming: false,
        promptTokens: cached.promptTokens || undefined,
        completionTokens: cached.completionTokens || undefined,
        cached: true,
      });

      const meta: RouteMeta = {
        provider: cached.provider,
        resolvedModel: cached.response.model,
        requestedModel: request.model,
        cached: true,
        reason: "cache",
        attempted: [cached.provider],
      };
      return { data, meta };
    }

    try {
      const { response, provider, resolvedModel, attempted, failoverCount } = await this.route(
        request,
        options,
      );
      const latencyMs = Date.now() - startTime;

      const data = (await response.json()) as ChatCompletionResponse;
      data.x_freellm_provider = provider.id;

      // Extract and record token usage when the provider returns it (all
      // OpenAI-compatible providers do for non-streaming responses).
      const promptTokens = data.usage?.prompt_tokens ?? 0;
      const completionTokens = data.usage?.completion_tokens ?? 0;
      if (promptTokens > 0 || completionTokens > 0) {
        this.usageTracker.record(provider.id, promptTokens, completionTokens);
      }

      // Surface finish_reason for observability. "length" means the
      // response hit max_tokens and is probably incomplete; the cache
      // layer already refuses to store those entries but we also log a
      // warning so operators notice the pattern.
      const finishReason = data.choices?.[0]?.finish_reason ?? undefined;
      if (finishReason === "length") {
        logger.warn(
          {
            provider: provider.id,
            model: resolvedModel,
            max_tokens: request.max_tokens,
            max_completion_tokens: request.max_completion_tokens,
            reasoning_effort: request.reasoning_effort,
            completionTokens,
          },
          "upstream returned finish_reason=length, response is incomplete",
        );
      }

      this.requestLog.add({
        requestedModel: request.model,
        resolvedModel,
        provider: provider.id,
        latencyMs,
        status: "success",
        streaming: false,
        promptTokens: promptTokens || undefined,
        completionTokens: completionTokens || undefined,
        finishReason,
      });

      // Store in cache for future identical requests.
      // The cache class skips streaming and disabled state internally.
      this.cache.set(request, data, provider.id, promptTokens, completionTokens);

      const meta: RouteMeta = {
        provider: provider.id,
        resolvedModel,
        requestedModel: request.model,
        cached: false,
        reason: META_MODELS.has(request.model) ? "meta" : failoverCount > 0 ? "failover" : "direct",
        attempted,
      };
      return { data, meta };
    } catch (err) {
      const latencyMs = Date.now() - startTime;

      if (err instanceof AllProvidersExhaustedError) {
        this.requestLog.add({
          requestedModel: request.model,
          latencyMs,
          status: "all_providers_failed",
          error: err.message,
          streaming: false,
        });
        throw err;
      }

      this.requestLog.add({
        requestedModel: request.model,
        latencyMs,
        status: "error",
        error: String(err),
        streaming: false,
      });
      throw err;
    }
  }

  async routeStream(
    request: ChatCompletionRequest,
    options: RouteOptions = {},
  ): Promise<{
    response: Response;
    provider: ProviderAdapter;
    resolvedModel: string;
    latencyMs: number;
    attempted: string[];
    failoverCount: number;
  }> {
    const startTime = Date.now();
    const result = await this.route(request, options);
    return { ...result, latencyMs: Date.now() - startTime };
  }
}

export class AllProvidersExhaustedError extends Error {
  constructor(
    message: string,
    public readonly triedProviders: string[],
  ) {
    super(message);
    this.name = "AllProvidersExhaustedError";
  }
}

/**
 * Thrown when a provider returns a 4xx the router will not fail over past:
 * a request-scoped 400/401/403/404, any 4xx/429/5xx in strict mode, or the
 * last provider-scoped 4xx once every candidate has been excluded.
 */
export class ProviderClientError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly statusCode: number,
    public readonly upstreamResponse: Response,
  ) {
    super(`Provider ${providerId} returned ${statusCode}`);
    this.name = "ProviderClientError";
  }
}
