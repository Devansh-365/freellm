import type { ProviderRegistry } from "./registry.js";
import type { ProviderAdapter } from "./providers/types.js";
import type { ChatCompletionRequest, ChatCompletionResponse, RoutingStrategy } from "./types.js";
import { RequestLog } from "./request-log.js";
import { UsageTracker } from "./usage-tracker.js";
import { ResponseCache } from "./cache.js";
import { META_MODELS, DEFAULT_MODELS, NON_RETRIABLE_STATUSES } from "./config.js";
import { assertStrictModeAllowed } from "./strict.js";
import { parseRetryAfter } from "./retry-after.js";
import { providerSatisfiesPrivacy, type PrivacyRequest } from "./privacy.js";
import { freellmError } from "../errors/index.js";
import { logger } from "../lib/logger.js";

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

const ROUTE_TIMEOUT_MS = parseInt(process.env["ROUTE_TIMEOUT_MS"] ?? "30000", 10);

export class GatewayRouter {
  // Round-robin index for explicit (non-meta) model requests
  private rrIndex = 0;
  // Per-meta-model round-robin indices for true rotation across providers
  private metaRrIndices = new Map<string, number>();

  public strategy: RoutingStrategy = "round_robin";
  public requestLog: RequestLog;
  public usageTracker: UsageTracker;
  public cache: ResponseCache;

  constructor(private registry: ProviderRegistry) {
    this.requestLog = new RequestLog();
    this.usageTracker = new UsageTracker();
    this.cache = new ResponseCache();
  }

  private pickProvider(
    modelId: string,
    excluded: Set<string>,
    privacy: PrivacyRequest = "any",
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
      .filter(
        (p) => !effectiveExcluded.has(p.id) && p.models.some((m) => m.id === modelId),
      );

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
  ): string {
    if (META_MODELS.has(requestedModel)) {
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
    assertStrictModeAllowed(request.model, strict);

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
    const deadline = Date.now() + ROUTE_TIMEOUT_MS;

    while (true) {
      if (Date.now() > deadline) {
        throw new AllProvidersExhaustedError(
          `Routing timeout (${ROUTE_TIMEOUT_MS}ms) exceeded for model: ${request.model}`,
          [...excluded],
        );
      }

      const provider = this.pickProvider(request.model, excluded, privacy);

      if (!provider) {
        throw new AllProvidersExhaustedError(
          `All providers exhausted for model: ${request.model}`,
          [...excluded],
        );
      }

      if (!attempted.includes(provider.id)) attempted.push(provider.id);

      const resolvedModel = this.resolveModelForProvider(request.model, provider);
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
          failoverCount++;
          continue;
        }

        if (NON_RETRIABLE_STATUSES.has(response.status)) {
          throw new ProviderClientError(provider.id, response.status, response);
        }

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

    // Cache check FIRST. Hits short-circuit the entire routing flow:
    // no provider call, no token quota burn, ~0ms latency.
    // Strict mode disables the cache because a cached response may have
    // come from a different provider than the caller expects.
    const cached = strict ? null : this.cache.get(request);
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
        requestBody: request,
        responseBody: data,
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
      const { response, provider, resolvedModel, attempted, failoverCount } =
        await this.route(request, options);
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
        requestBody: request,
        responseBody: data,
      });

      // Store in cache for future identical requests.
      // The cache class skips streaming and disabled state internally.
      this.cache.set(request, data, provider.id, promptTokens, completionTokens);

      const meta: RouteMeta = {
        provider: provider.id,
        resolvedModel,
        requestedModel: request.model,
        cached: false,
        reason: META_MODELS.has(request.model)
          ? "meta"
          : failoverCount > 0
            ? "failover"
            : "direct",
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
          requestBody: request,
        });
        throw err;
      }

      this.requestLog.add({
        requestedModel: request.model,
        latencyMs,
        status: "error",
        error: String(err),
        streaming: false,
        requestBody: request,
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

/** Thrown when a provider returns a non-retriable 4xx (400/401/403/404). */
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
