import { GroqProvider } from "./providers/groq.js";
import { GeminiProvider } from "./providers/gemini.js";
import { MistralProvider } from "./providers/mistral.js";
import { CerebrasProvider } from "./providers/cerebras.js";
import { OllamaProvider } from "./providers/ollama.js";
import type { ProviderAdapter } from "./providers/types.js";
import type { ModelObject, ProviderStatusInfo } from "./types.js";

export class ProviderRegistry {
  private providers: ProviderAdapter[];

  constructor() {
    this.providers = [
      new GroqProvider(),
      new GeminiProvider(),
      new MistralProvider(),
      new CerebrasProvider(),
      new OllamaProvider(),
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

  resolveProvider(modelId: string): ProviderAdapter | undefined {
    if (modelId.startsWith("free")) {
      return this.resolveMetaModel(modelId);
    }

    const provider = this.providers.find(
      (p) => p.isAvailable() && p.models.some((m) => m.id === modelId),
    );
    return provider;
  }

  private resolveMetaModel(metaModel: string): ProviderAdapter | undefined {
    const available = this.getAvailable();
    if (available.length === 0) return undefined;

    if (metaModel === "free-fast") {
      const priority = ["groq", "cerebras", "gemini", "mistral", "ollama"];
      for (const id of priority) {
        const p = available.find((a) => a.id === id);
        if (p) return p;
      }
    }

    if (metaModel === "free-smart") {
      const priority = ["gemini", "groq", "mistral", "cerebras", "ollama"];
      for (const id of priority) {
        const p = available.find((a) => a.id === id);
        if (p) return p;
      }
    }

    return available[0];
  }

  getProviderForMetaModel(
    metaModel: string,
    excluded: Set<string>,
  ): ProviderAdapter | undefined {
    const available = this.getAvailable().filter(
      (p) => !excluded.has(p.id),
    );
    if (available.length === 0) return undefined;

    if (metaModel === "free-fast") {
      const priority = ["groq", "cerebras", "gemini", "mistral", "ollama"];
      for (const id of priority) {
        const p = available.find((a) => a.id === id);
        if (p) return p;
      }
    }

    if (metaModel === "free-smart") {
      const priority = ["gemini", "groq", "mistral", "cerebras", "ollama"];
      for (const id of priority) {
        const p = available.find((a) => a.id === id);
        if (p) return p;
      }
    }

    return available[0];
  }

  getStatusAll(): ProviderStatusInfo[] {
    return this.providers.map((p) => {
      const stats = p.getStats();
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
      };
    });
  }
}
