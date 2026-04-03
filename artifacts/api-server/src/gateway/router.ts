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

export class GatewayRouter {
  private roundRobinIndex = 0;
  public strategy: RoutingStrategy = "round_robin";
  public requestLog: RequestLog;

  constructor(private registry: ProviderRegistry) {
    this.requestLog = new RequestLog();
  }

  private pickProvider(
    modelId: string,
    excluded: Set<string>,
  ): ProviderAdapter | undefined {
    const isMeta = META_MODELS.has(modelId);

    if (isMeta) {
      return this.registry.getProviderForMetaModel(modelId, excluded);
    }

    const available = this.registry
      .getAvailable()
      .filter(
        (p) => !excluded.has(p.id) && p.models.some((m) => m.id === modelId),
      );

    if (available.length === 0) return undefined;

    if (this.strategy === "random") {
      return available[Math.floor(Math.random() * available.length)];
    }

    const idx = this.roundRobinIndex % available.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % 10000;
    return available[idx];
  }

  private resolveModelForProvider(
    requestedModel: string,
    provider: ProviderAdapter,
  ): string {
    if (META_MODELS.has(requestedModel)) {
      const defaultModel = DEFAULT_MODELS[provider.id];
      if (defaultModel) {
        const prefixed = `${provider.id}/${defaultModel}`;
        const map = provider.models.find((m) => m.id === prefixed);
        if (map) return prefixed;
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
    const isStreaming = !!request.stream;

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

        if (response.status >= 500) {
          provider.onError();
          excluded.add(provider.id);
          continue;
        }

        if (!response.ok) {
          provider.onError();
          excluded.add(provider.id);
          continue;
        }

        provider.onSuccess();
        return { response, provider, resolvedModel };
      } catch (err) {
        provider.onError();
        excluded.add(provider.id);
      }
    }
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const startTime = Date.now();
    const isStreaming = !!request.stream;

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
        streaming: isStreaming,
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
          streaming: isStreaming,
        });
        throw err;
      }

      this.requestLog.add({
        requestedModel: request.model,
        latencyMs,
        status: "error",
        error: String(err),
        streaming: isStreaming,
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
