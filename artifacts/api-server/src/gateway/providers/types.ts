import type {
  ChatCompletionRequest,
  ModelObject,
  ProviderStats,
  CircuitBreakerState,
} from "../types.js";

export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelObject[];

  isEnabled(): boolean;
  getStats(): ProviderStats;
  getCircuitBreakerState(): CircuitBreakerState;
  isAvailable(): boolean;

  complete(request: ChatCompletionRequest): Promise<Response>;
  onSuccess(): void;
  onRateLimit(retryAfterSeconds?: number): void;
  onError(): void;
  resetCircuitBreaker(): void;
}
