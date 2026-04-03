export type CircuitBreakerState = "closed" | "open" | "half_open";
export type RoutingStrategy = "round_robin" | "random";
export type RequestStatus =
  | "success"
  | "error"
  | "rate_limited"
  | "all_providers_failed";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string | null;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean | null;
  temperature?: number | null;
  max_tokens?: number | null;
  top_p?: number | null;
  stop?: string | string[] | null;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  x_freellm_provider?: string;
}

export interface ModelObject {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  provider: string;
}

export interface ProviderStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  lastError?: string;
  lastUsedAt?: string;
}

export interface RequestLogEntry {
  id: string;
  requestedModel: string;
  resolvedModel?: string | null;
  provider?: string | null;
  latencyMs: number;
  status: RequestStatus;
  error?: string | null;
  timestamp: string;
  streaming: boolean;
}

export interface GatewayStatus {
  routingStrategy: RoutingStrategy;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  providers: ProviderStatusInfo[];
  recentRequests: RequestLogEntry[];
}

export interface ProviderStatusInfo {
  id: string;
  name: string;
  enabled: boolean;
  circuitBreakerState: CircuitBreakerState;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  lastError?: string | null;
  lastUsedAt?: string | null;
  models: string[];
}

export interface GatewayError {
  error: {
    message: string;
    type: string;
    code?: string | null;
  };
}
