import { GroqProvider } from "./providers/groq.js";
import { GeminiProvider } from "./providers/gemini.js";
import { MistralProvider } from "./providers/mistral.js";
import { CerebrasProvider } from "./providers/cerebras.js";
import { OllamaProvider } from "./providers/ollama.js";
import { NimProvider } from "./providers/nim.js";
import { CloudflareProvider } from "./providers/cloudflare.js";
import { GitHubModelsProvider } from "./providers/github-models.js";
import { ClaudeCodeProvider } from "./providers/claude-code.js";
import { ClaudeCodeApiProvider } from "./providers/claude-code-api.js";
import type { ProviderAdapter } from "./providers/types.js";
import type { ModelObject, ProviderStatusInfo, RoutingStrategy, TokenUsageTotals } from "./types.js";
import { FAST_PRIORITY, SMART_PRIORITY } from "./config.js";
import { PROVIDER_PRIVACY } from "./privacy.js";

const EMPTY_USAGE: TokenUsageTotals = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
};

export class ProviderRegistry {
  private providers: ProviderAdapter[];

  constructor() {
    this.providers = [
      new GroqProvider(),
      new GeminiProvider(),
      new MistralProvider(),
      new CerebrasProvider(),
      new NimProvider(),
      new CloudflareProvider(),
      new GitHubModelsProvider(),
      new OllamaProvider(),
      new ClaudeCodeProvider(),
      new ClaudeCodeApiProvider(),
    ];
  }

  getAll(): ProviderAdapter[] {
    return this.providers;
  }

  getEnabled(): ProviderAdapter[] {
    return this.providers.filter((p) => p.isEnabled());
  }

  getAvailable(): ProviderAdapter[] {
    return this.providers.filter((p) => p.isAvailable());
  }

  getById(id: string): ProviderAdapter | undefined {
    return this.providers.find((p) => p.id === id);
  }

  getAllModels(): ModelObject[] {
    return this.providers
      .filter((p) => p.isEnabled())
      .flatMap((p) => p.models);
  }

  getProviderForMetaModel(
    metaModel: string,
    excluded: Set<string>,
    strategy: RoutingStrategy = "round_robin",
    rrIndex: number = 0,
    advanceRrIndex?: (next: number) => void,
  ): ProviderAdapter | undefined {
    const available = this.getAvailable().filter((p) => !excluded.has(p.id));
    if (available.length === 0) return undefined;

    // Build candidate list — priority order defines the round-robin sequence
    let candidates: ProviderAdapter[];
    if (metaModel === "free-fast") {
      candidates = [...FAST_PRIORITY]
        .map((id) => available.find((a) => a.id === id))
        .filter((p): p is ProviderAdapter => p !== undefined);
    } else if (metaModel === "free-smart") {
      candidates = [...SMART_PRIORITY]
        .map((id) => available.find((a) => a.id === id))
        .filter((p): p is ProviderAdapter => p !== undefined);
    } else {
      // "free" — all available providers
      candidates = available;
    }

    if (candidates.length === 0) return undefined;

    if (strategy === "random") {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    // round_robin: pick from candidates using the caller-managed rotation index
    const idx = rrIndex % candidates.length;
    if (advanceRrIndex) advanceRrIndex(rrIndex + 1);
    return candidates[idx];
  }

  getStatusAll(
    usageByProvider: Record<string, TokenUsageTotals> = {},
  ): ProviderStatusInfo[] {
    return this.providers.map((p) => {
      const stats = p.getStats();
      const keys = p.getKeysStatus();
      const privacyEntry = PROVIDER_PRIVACY[p.id];
      return {
        id: p.id,
        name: p.name,
        enabled: p.isEnabled(),
        circuitBreakerState: p.getCircuitBreakerState(),
        totalRequests: stats.totalRequests,
        successRequests: stats.successRequests,
        failedRequests: stats.failedRequests,
        rateLimitedRequests: stats.rateLimitedRequests,
        lastError: stats.lastError ?? null,
        lastUsedAt: stats.lastUsedAt ?? null,
        models: p.models.map((m) => m.id),
        keyCount: keys.length,
        keysAvailable: keys.filter((k) => !k.rateLimited).length,
        keys,
        usage: usageByProvider[p.id] ?? EMPTY_USAGE,
        privacy: privacyEntry
          ? {
              policy: privacyEntry.policy,
              sourceUrl: privacyEntry.source_url,
              lastVerified: privacyEntry.last_verified,
            }
          : undefined,
      };
    });
  }
}
