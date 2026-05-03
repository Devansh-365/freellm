export type CircuitBreakerState = "closed" | "open" | "half_open";
export type RoutingStrategy = "round_robin" | "random";
export type RequestStatus =
  | "success"
  | "error"
  | "rate_limited"
  | "all_providers_failed";

export interface ChatToolCall {
  id?: string;
  type?: "function";
  function: {
    name?: string;
    arguments?: string;
  };
  index?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content?: string | unknown[] | null;
  name?: string | null;
  tool_call_id?: string | null;
  tool_calls?: ChatToolCall[];
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean | null;
  stream_options?: { include_usage?: boolean } | null;
  temperature?: number | null;
  max_tokens?: number | null;
  max_completion_tokens?: number | null;
  top_p?: number | null;
  stop?: string | string[] | null;
  presence_penalty?: number | null;
  frequency_penalty?: number | null;
  seed?: number | null;
  tools?: ChatTool[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: {
    type: "text" | "json_object" | "json_schema";
    json_schema?: Record<string, unknown>;
  };
  reasoning_effort?: "none" | "low" | "medium" | "high";
  user?: string;
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
  x_freellm_cached?: boolean;
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
  promptTokens?: number;
  completionTokens?: number;
  cached?: boolean;
  /**
   * finish_reason from the upstream completion (non-streaming only).
   * "stop" = natural completion, "length" = hit max_tokens,
   * "tool_calls" = model chose to call a tool, "content_filter" =
   * safety filter. Missing for streaming and cache-hit entries.
   */
  finishReason?: string | null;
  /** Captured request body. Persisted for inline expand in dashboard. */
  requestBody?: unknown;
  /** Captured response body. For streams, assembled `delta.content`. */
  responseBody?: unknown;
  /** Number of streamed chunks observed. Streaming entries only. */
  chunkCount?: number;
}

export interface TokenUsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export interface CacheStats {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
  currentSize: number;
  hits: number;
  misses: number;
  sets: number;
  evictions: number;
  hitRate: number;
}

export interface BrowserTokensInfo {
  /** True when FREELLM_TOKEN_SECRET is set and meets the minimum length. */
  enabled: boolean;
  /** Minimum bytes required for FREELLM_TOKEN_SECRET. */
  minSecretBytes: number;
  /** Max ttl the issue endpoint will honor, in seconds. */
  maxTtlSeconds: number;
}

export interface GatewayStatus {
  routingStrategy: RoutingStrategy;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  providers: ProviderStatusInfo[];
  recentRequests: RequestLogEntry[];
  usage: TokenUsageTotals;
  cache: CacheStats;
  browserTokens: BrowserTokensInfo;
}

export interface KeyStatus {
  index: number;
  rateLimited: boolean;
  requestsInWindow: number;
  maxRequests: number;
  retryAfterMs: number | null;
}

export interface ProviderPrivacyInfo {
  /** "no-training" | "free-tier-trains" | "configurable" | "local" */
  policy: string;
  /** Public URL documenting the policy on the provider's own site. */
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) when the policy was last human-verified. */
  lastVerified: string;
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
  keyCount: number;
  keysAvailable: number;
  keys: KeyStatus[];
  usage: TokenUsageTotals;
  /** Training policy + source, surfaced from PROVIDER_PRIVACY. */
  privacy?: ProviderPrivacyInfo;
}

export interface GatewayError {
  error: {
    message: string;
    type: string;
    code?: string | null;
  };
}
