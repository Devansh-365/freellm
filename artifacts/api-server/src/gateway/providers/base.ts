import { CircuitBreaker } from "../circuit-breaker.js";
import { RateLimiter } from "../rate-limiter.js";
import type { ProviderAdapter } from "./types.js";
import type {
  ChatCompletionRequest,
  ModelObject,
  ProviderStats,
  CircuitBreakerState,
} from "../types.js";

export abstract class BaseProvider implements ProviderAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly models: ModelObject[];

  protected circuitBreaker = new CircuitBreaker();
  protected rateLimiter = new RateLimiter();
  protected stats: ProviderStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
  };

  protected abstract getApiKey(): string | undefined;

  isEnabled(): boolean {
    return !!this.getApiKey();
  }

  getStats(): ProviderStats {
    return { ...this.stats };
  }

  getCircuitBreakerState(): CircuitBreakerState {
    return this.circuitBreaker.getState();
  }

  isAvailable(): boolean {
    if (!this.isEnabled()) return false;
    if (this.rateLimiter.isRateLimited(this.id)) return false;
    if (!this.circuitBreaker.isAllowed()) return false;
    return true;
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(`Provider ${this.name} is not configured (missing API key)`);
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();

    const mapped = this.mapRequest(request);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...this.extraHeaders(),
      },
      body: JSON.stringify(mapped),
    });

    return response;
  }

  protected mapRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    const mapped = { ...request };
    const modelMap = this.getModelMap();
    if (modelMap[request.model]) {
      mapped.model = modelMap[request.model]!;
    }
    return mapped;
  }

  protected getModelMap(): Record<string, string> {
    return {};
  }

  protected extraHeaders(): Record<string, string> {
    return {};
  }

  onSuccess(): void {
    this.stats.successRequests++;
    this.circuitBreaker.onSuccess();
    this.rateLimiter.clearRateLimit(this.id);
  }

  onRateLimit(retryAfterSeconds?: number): void {
    this.stats.rateLimitedRequests++;
    this.rateLimiter.markRateLimited(this.id, retryAfterSeconds);
  }

  onError(): void {
    this.stats.failedRequests++;
    this.circuitBreaker.onFailure();
    this.stats.lastError = new Date().toISOString();
  }

  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.rateLimiter.clearRateLimit(this.id);
  }
}
