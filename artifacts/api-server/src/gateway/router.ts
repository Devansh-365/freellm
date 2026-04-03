import type { ProviderRegistry } from "./registry.js";
import type { ProviderAdapter } from "./providers/types.js";
import type { ChatCompletionRequest, ChatCompletionResponse, RoutingStrategy } from "./types.js";
import { RequestLog } from "./request-log.js";

const META_MODELS = new Set(["free", "free-fast", "free-smart"]);

const DEFAULT_MODELS: Record<string, string> = {
  "groq": "llama-3.3-70b-versatile",
  "gemini": "gemini-2.0-flash",
  "mistral": "mistral-small-latest",
  "cerebras": "llama3.3-70b",
  "ollama": "llama3",
};

// 4xx status codes that indicate a client-side or configuration error.
// These should NOT trigger failover to another provider — failing over would
// just repeat the same error on a different endpoint.
const NON_RETRIABLE_STATUSES = new Set([400, 401, 403, 404]);

export class GatewayRouter {
  // Round-robin index for explicit (non-meta) model requests
  private rrIndex = 0;
  // Per-meta-model round-robin indices for true rotation across providers
  private metaRrIndices = new Map<string, number>();

  public strategy: RoutingStrategy = "round_robin";
  public requestLog: RequestLog;

  constructor(private registry: ProviderRegistry) {
    this.requestLog = new RequestLog();
  }

  private pickProvider(
    modelId: string,
    excluded: Set<string>,
  ): ProviderAdapter | undefined {
    if (META_MODELS.has(modelId)) {
      return this.registry.getProviderForMetaModel(
        modelId,
        excluded,
        this.strategy,
        this.getMetaRrIndex(modelId),
        (next) => this.setMetaRrIndex(modelId, next),
      );
    }

    const available = this.registry
      .getAvailable()
      .filter((p) => !excluded.has(p.id) && p.models.some((m) => m.id === modelId));

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

  async route(request: ChatCompletionRequest): Promise<{
    response: Response;
    provider: ProviderAdapter;
    resolvedModel: string;
  }> {
    const excluded = new Set<string>();

    while (true) {
      const provider = this.pickProvider(request.model, excluded);

      if (!provider) {
        throw new AllProvidersExhaustedError(
          `All providers exhausted for model: ${request.model}`,
          [...excluded],
        );
      }

      const resolvedModel = this.resolveModelForProvider(request.model, provider);
      const mappedRequest = { ...request, model: resolvedModel };

      try {
        const response = await provider.complete(mappedRequest);

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          provider.onRateLimit(retryAfter ? parseInt(retryAfter, 10) : undefined);
          excluded.add(provider.id);
          continue;
        }

        if (NON_RETRIABLE_STATUSES.has(response.status)) {
          // Client-side / auth / model-not-found errors — surface directly
          throw new ProviderClientError(provider.id, response.status, response);
        }

        if (response.status >= 500) {
          provider.onError();
          excluded.add(provider.id);
          continue;
        }

        if (!response.ok) {
          // Other 4xx we haven't explicitly classified — fail over
          provider.onError();
          excluded.add(provider.id);
          continue;
        }

        provider.onSuccess();
        return { response, provider, resolvedModel };
      } catch (err) {
        if (err instanceof ProviderClientError) throw err; // propagate non-retriable errors
        provider.onError();
        excluded.add(provider.id);
      }
    }
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const startTime = Date.now();

    try {
      const { response, provider, resolvedModel } = await this.route(request);
      const latencyMs = Date.now() - startTime;

      const data = (await response.json()) as ChatCompletionResponse;
      data.x_freellm_provider = provider.id;

      this.requestLog.add({
        requestedModel: request.model,
        resolvedModel,
        provider: provider.id,
        latencyMs,
        status: "success",
        streaming: false,
      });

      return data;
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

  async routeStream(request: ChatCompletionRequest): Promise<{
    response: Response;
    provider: ProviderAdapter;
    resolvedModel: string;
    latencyMs: number;
  }> {
    const startTime = Date.now();
    const result = await this.route(request);
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
