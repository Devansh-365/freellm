/**
 * Verification tests for vision/multimodal routing.
 *
 * Coverage:
 *   1. hasImageContent() — detects image_url parts in messages
 *   2. ResponseCache — skips get/set for vision requests
 *   3. GatewayRouter — fail-fast when a non-vision model receives image content
 *   4. GatewayRouter — meta-model routes to a vision-capable provider/model
 *   5. Ollama — supportsVision flag set from model name heuristics
 */
import { afterEach, describe, expect, it } from "vitest";
import { OllamaProvider } from "../src/providers/ollama.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import { ResponseCache, hasImageContent } from "../src/routing/cache.js";
import type { ProviderRegistry } from "../src/routing/registry.js";
import { GatewayRouter } from "../src/routing/router.js";
import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ProviderStats,
  ProviderStatusInfo,
} from "../src/types.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function textRequest(model = "free"): ChatCompletionRequest {
  return { model, messages: [{ role: "user", content: "hello" }] };
}

function visionRequest(model = "free"): ChatCompletionRequest {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ],
      },
    ],
  };
}

function okResponse(modelId: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: modelId,
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

// Minimal provider stub
class StubProvider implements ProviderAdapter {
  callCount = 0;
  readonly supportsStreamUsage = false;
  readonly supportsTools = true;
  private cbState: CircuitBreakerState = "closed";

  constructor(
    readonly id: string,
    readonly models: ModelObject[],
    private status = 200,
  ) {}

  get name() {
    return this.id;
  }
  isEnabled() {
    return true;
  }
  isAvailable() {
    return true;
  }
  getStats(): ProviderStats {
    return { totalRequests: 0, successRequests: 0, failedRequests: 0, rateLimitedRequests: 0 };
  }
  getCircuitBreakerState(): CircuitBreakerState {
    return this.cbState;
  }
  getKeysStatus(): KeyStatus[] {
    return [
      { index: 0, rateLimited: false, requestsInWindow: 0, maxRequests: 30, retryAfterMs: null },
    ];
  }
  async complete(req: ChatCompletionRequest): Promise<Response> {
    this.callCount++;
    return new Response(JSON.stringify(okResponse(req.model)), {
      status: this.status,
      headers: { "content-type": "application/json" },
    });
  }
  onSuccess() {
    this.cbState = "closed";
  }
  onRateLimit() {}
  onError() {
    this.cbState = "open";
  }
  resetCircuitBreaker() {
    this.cbState = "closed";
  }
}

function makeRegistry(providers: StubProvider[]): ProviderRegistry {
  return {
    getAll: () => providers,
    getEnabled: () => providers,
    getAvailable: () => providers.filter((p) => p.isAvailable()),
    getById: (id: string) => providers.find((p) => p.id === id),
    getAllModels: () => providers.flatMap((p) => p.models),
    getProviderForMetaModel: (_meta: string, excluded: Set<string>): ProviderAdapter | undefined =>
      providers.find((p) => p.isAvailable() && !excluded.has(p.id)),
    getStatusAll: (): ProviderStatusInfo[] =>
      providers.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: true,
        circuitBreakerState: p.getCircuitBreakerState(),
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        rateLimitedRequests: 0,
        lastError: null,
        lastUsedAt: null,
        models: p.models.map((m) => m.id),
        keyCount: 1,
        keysAvailable: 1,
        keys: p.getKeysStatus(),
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 },
      })),
  } as unknown as ProviderRegistry;
}

// ─── 1. hasImageContent ───────────────────────────────────────────────────────

describe("hasImageContent", () => {
  it("returns false for a plain text message", () => {
    expect(hasImageContent(textRequest())).toBe(false);
  });

  it("returns false when content is a string", () => {
    expect(hasImageContent({ model: "free", messages: [{ role: "user", content: "hello" }] })).toBe(
      false,
    );
  });

  it("returns false when content array has only text parts", () => {
    const req: ChatCompletionRequest = {
      model: "free",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };
    expect(hasImageContent(req)).toBe(false);
  });

  it("returns true when a message has an image_url part", () => {
    expect(hasImageContent(visionRequest())).toBe(true);
  });

  it("returns true when image_url appears in any message in a multi-turn conversation", () => {
    const req: ChatCompletionRequest = {
      model: "free",
      messages: [
        { role: "user", content: "first turn" },
        { role: "assistant", content: "answer" },
        {
          role: "user",
          content: [
            { type: "text", text: "now look at this" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,xyz" } },
          ],
        },
      ],
    };
    expect(hasImageContent(req)).toBe(true);
  });

  it("returns false for null content", () => {
    const req: ChatCompletionRequest = {
      model: "free",
      messages: [{ role: "user", content: null }],
    };
    expect(hasImageContent(req)).toBe(false);
  });
});

// ─── 2. ResponseCache skips vision ───────────────────────────────────────────

describe("ResponseCache — vision bypass", () => {
  it("get() returns undefined for a request with image content", () => {
    const cache = new ResponseCache();
    // Manually prime the cache with a text version of the same model
    const textReq = textRequest("free-fast");
    cache.set(textReq, okResponse("free-fast") as never, "groq", 10, 5);
    // Vision request must NOT hit the cache even if key overlapped
    expect(cache.get(visionRequest("free-fast"))).toBeUndefined();
  });

  it("set() does not store a vision request's response", () => {
    const cache = new ResponseCache();
    cache.set(visionRequest(), okResponse("free") as never, "gemini", 10, 5);
    // A subsequent identical vision request must still miss
    expect(cache.get(visionRequest())).toBeUndefined();
  });

  it("normal text requests are still cached", () => {
    const cache = new ResponseCache();
    const req = textRequest("free-fast");
    cache.set(req, okResponse("groq/llama") as never, "groq", 10, 5);
    expect(cache.get(req)).toBeDefined();
  });
});

// ─── 3. Router fail-fast for non-vision model ─────────────────────────────────

describe("GatewayRouter — fail-fast for non-vision model", () => {
  it("throws model_not_supported when a text-only model receives image content", async () => {
    const textModel: ModelObject = {
      id: "groq/openai/gpt-oss-120b",
      object: "model",
      created: 0,
      owned_by: "openai",
      provider: "groq",
      // supportsVision intentionally absent
    };
    const provider = new StubProvider("groq", [textModel]);
    const registry = makeRegistry([provider]);
    const router = new GatewayRouter(registry);

    const req = visionRequest("groq/openai/gpt-oss-120b");
    await expect(router.complete(req)).rejects.toMatchObject({
      message: expect.stringContaining("does not support vision"),
    });
    // Provider must never be called — fail-fast before any network call
    expect(provider.callCount).toBe(0);
  });

  it("does NOT throw for a vision-capable model with image content", async () => {
    const visionModel: ModelObject = {
      id: "groq/qwen/qwen3.8-27b",
      object: "model",
      created: 0,
      owned_by: "alibaba",
      provider: "groq",
      supportsVision: true,
    };
    const provider = new StubProvider("groq", [visionModel]);
    const registry = makeRegistry([provider]);
    const router = new GatewayRouter(registry);

    const req = visionRequest("groq/qwen/qwen3.8-27b");
    await expect(router.complete(req)).resolves.toBeDefined();
  });
});

// ─── 4. Meta-model vision routing ────────────────────────────────────────────

describe("GatewayRouter — meta-model vision routing", () => {
  it("routes a vision meta-model request to a vision-capable provider", async () => {
    const textOnlyModel: ModelObject = {
      id: "cerebras/llama-3.3-70b",
      object: "model",
      created: 0,
      owned_by: "meta",
      provider: "cerebras",
    };
    const visionModel: ModelObject = {
      id: "gemini/gemini-2.5-flash",
      object: "model",
      created: 0,
      owned_by: "google",
      provider: "gemini",
      supportsVision: true,
    };
    const cerebras = new StubProvider("cerebras", [textOnlyModel]);
    const gemini = new StubProvider("gemini", [visionModel]);

    // Registry picks cerebras first (it's first in the array) for getProviderForMetaModel
    // but pickProvider should exclude it because it has no vision models
    const registry: ProviderRegistry = {
      getAll: () => [cerebras, gemini],
      getEnabled: () => [cerebras, gemini],
      getAvailable: () => [cerebras, gemini],
      getById: () => undefined,
      getAllModels: () => [textOnlyModel, visionModel],
      getProviderForMetaModel: (
        _meta: string,
        excluded: Set<string>,
      ): ProviderAdapter | undefined =>
        [cerebras, gemini].find((p) => p.isAvailable() && !excluded.has(p.id)),
      getStatusAll: () => [],
    } as unknown as ProviderRegistry;

    const router = new GatewayRouter(registry);
    const { data } = await router.complete(visionRequest("free"));

    // Gemini (vision-capable) must have been picked, not cerebras
    expect(gemini.callCount).toBe(1);
    expect(cerebras.callCount).toBe(0);
    expect(data.x_freellm_provider).toBe("gemini");
  });

  it("resolves to the first vision-capable model when a meta-model is used", async () => {
    // Provider has both text and vision models; the vision model must be chosen
    const textModel: ModelObject = {
      id: "github/meta/Meta-Llama-3.3-70B-Instruct",
      object: "model",
      created: 0,
      owned_by: "meta",
      provider: "github",
    };
    const visionModel: ModelObject = {
      id: "github/openai/gpt-4o-mini",
      object: "model",
      created: 0,
      owned_by: "openai",
      provider: "github",
      supportsVision: true,
    };
    const github = new StubProvider("github", [textModel, visionModel]);
    const registry = makeRegistry([github]);
    const router = new GatewayRouter(registry);

    const req = visionRequest("free");
    const { data } = await router.complete(req);

    // The resolved model in the response must be the vision-capable one
    expect(data.model).toBe("github/openai/gpt-4o-mini");
  });
});

// ─── 5. Ollama vision heuristics ─────────────────────────────────────────────

describe("OllamaProvider — supportsVision from model name", () => {
  function ollamaModels(names: string): ModelObject[] {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    process.env.OLLAMA_MODELS = names;
    const p = new OllamaProvider();
    return p.models;
  }

  afterEach(() => {
    delete process.env.OLLAMA_MODELS;
    delete process.env.OLLAMA_BASE_URL;
  });

  it("marks llava models as vision-capable", () => {
    const models = ollamaModels("llava:7b");
    expect(models[0]?.supportsVision).toBe(true);
  });

  it("marks models with 'vision' in the name as vision-capable", () => {
    const models = ollamaModels("minicpm-vision");
    expect(models[0]?.supportsVision).toBe(true);
  });

  it("marks moondream as vision-capable", () => {
    const models = ollamaModels("moondream:latest");
    expect(models[0]?.supportsVision).toBe(true);
  });

  it("does NOT mark plain text models as vision-capable", () => {
    const models = ollamaModels("llama3,mistral");
    expect(models[0]?.supportsVision).toBeUndefined();
    expect(models[1]?.supportsVision).toBeUndefined();
  });

  it("handles mixed lists correctly", () => {
    const models = ollamaModels("llama3,llava:13b,mistral");
    expect(models[0]?.supportsVision).toBeUndefined();
    expect(models[1]?.supportsVision).toBe(true);
    expect(models[2]?.supportsVision).toBeUndefined();
  });
});
