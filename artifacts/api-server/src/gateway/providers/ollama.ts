import { BaseProvider } from "./base.js";
import type { ModelObject } from "../types.js";
import type { ChatCompletionRequest } from "../types.js";

export class OllamaProvider extends BaseProvider {
  readonly id = "ollama";
  readonly name = "Ollama";

  get baseUrl(): string {
    return (process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434") + "/v1";
  }

  get models(): ModelObject[] {
    const raw = process.env["OLLAMA_MODELS"] ?? "";
    if (!raw.trim()) return [];
    return raw
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .map((m) => ({
        id: `ollama/${m}`,
        object: "model" as const,
        created: 1700000000,
        owned_by: "ollama",
        provider: "ollama",
      }));
  }

  protected getApiKey(): string | undefined {
    const baseUrl = process.env["OLLAMA_BASE_URL"];
    return baseUrl ? "ollama" : undefined;
  }

  isEnabled(): boolean {
    return !!process.env["OLLAMA_BASE_URL"];
  }

  protected mapRequest(request: ChatCompletionRequest): ChatCompletionRequest {
    const mapped = { ...request };
    if (mapped.model.startsWith("ollama/")) {
      mapped.model = mapped.model.slice("ollama/".length);
    }
    return mapped;
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const mapped = this.mapRequest(request);
    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mapped),
    });

    return response;
  }
}
