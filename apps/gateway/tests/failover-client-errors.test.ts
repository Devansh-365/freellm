import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "../src/config.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import { ProviderRegistry } from "../src/routing/registry.js";
import {
  AllProvidersExhaustedError,
  GatewayRouter,
  ProviderClientError,
} from "../src/routing/router.js";
import { bodyIndicatesModelUnavailable } from "../src/routing/upstream-errors.js";
import type {
  ChatCompletionRequest,
  CircuitBreakerState,
  KeyStatus,
  ModelObject,
  ProviderStats,
} from "../src/types.js";

/**
 * Regression tests for issue #4: a meta-model request hit a Groq model that
 * Groq had shut down (404 "does not exist or you do not have access") and
 * the gateway surfaced the error instead of failing over to Gemini.
 */

interface CannedResponse {
  status: number;
  body?: unknown;
}

const OK_BODY = {
  id: "chatcmpl-test",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

// Verbatim shape of Groq's response for a model shut down on the free tier.
const GROQ_DEAD_MODEL_MESSAGE =
  "The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.";
const GROQ_404_BODY = {
  error: {
    message: GROQ_DEAD_MODEL_MESSAGE,
    type: "invalid_request_error",
    code: "model_not_found",
  },
};

class FakeProvider implements ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: ModelObject[];
  readonly supportsStreamUsage = false;
  readonly supportsTools = true;
  callCount = 0;
  errorCount = 0;
  requestedModels: string[] = [];
  private responses: CannedResponse[];
  private cbState: CircuitBreakerState = "closed";
  private stats: ProviderStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
  };

  constructor(id: string, models: string[], responses: CannedResponse[] = [{ status: 200 }]) {
    this.id = id;
    this.name = id;
    this.models = models.map((m) => ({
      id: m,
      object: "model" as const,
      created: 0,
      owned_by: id,
      provider: id,
    }));
    this.responses = responses;
  }

  isEnabled(): boolean {
    return true;
  }
  isAvailable(): boolean {
    return true;
  }
  getStats(): ProviderStats {
    return { ...this.stats };
  }
  getCircuitBreakerState(): CircuitBreakerState {
    return this.cbState;
  }
  getKeysStatus(): KeyStatus[] {
    return [];
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const canned = this.responses[Math.min(this.callCount, this.responses.length - 1)] ?? {
      status: 500,
    };
    this.callCount++;
    this.requestedModels.push(request.model);
    const body =
      canned.body ??
      (canned.status === 200 ? OK_BODY : { error: { message: `upstream ${canned.status}` } });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status: canned.status,
      headers: { "content-type": "application/json" },
    });
  }

  onSuccess(): void {
    this.stats.successRequests++;
  }
  onRateLimit(): void {
    this.stats.rateLimitedRequests++;
  }
  onError(): void {
    this.errorCount++;
    this.stats.failedRequests++;
  }
  resetCircuitBreaker(): void {
    this.cbState = "closed";
  }
}

/** Registry stub that hands out providers in array order, skipping excluded ones. */
function fakeRegistry(providers: FakeProvider[]): ProviderRegistry {
  return {
    getAll: () => providers,
    getEnabled: () => providers,
    getAvailable: () => providers,
    getById: (id: string) => providers.find((p) => p.id === id),
    getAllModels: () => providers.flatMap((p) => p.models),
    getProviderForMetaModel: (_meta: string, excluded: Set<string>) =>
      providers.find((p) => !excluded.has(p.id)),
    getStatusAll: () => [],
  } as unknown as ProviderRegistry;
}

const req = (model: string, extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({
  model,
  messages: [{ role: "user", content: "hi" }],
  ...extra,
});

describe("failover on provider-scoped client errors (non-strict)", () => {
  it("meta-model fails over from a 404 model_not_found provider to a healthy one", async () => {
    const groq = new FakeProvider(
      "groq",
      [`groq/${DEFAULT_MODELS.groq}`],
      [{ status: 404, body: GROQ_404_BODY }],
    );
    const gemini = new FakeProvider("gemini", [`gemini/${DEFAULT_MODELS.gemini}`]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const result = await router.route(req("free-fast"));
    expect(result.provider.id).toBe("gemini");
    expect(result.attempted).toEqual(["groq", "gemini"]);
    expect(result.failoverCount).toBe(1);
    // Groq got its configured default and was penalized once.
    expect(groq.requestedModels).toEqual([`groq/${DEFAULT_MODELS.groq}`]);
    expect(groq.errorCount).toBe(1);
    expect(gemini.callCount).toBe(1);
  });

  it("complete() returns the healthy provider's answer after the 404", async () => {
    const groq = new FakeProvider("groq", ["groq/x"], [{ status: 404, body: GROQ_404_BODY }]);
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const { data, meta } = await router.complete(req("free"));
    expect(data.choices[0]?.message.content).toBe("ok");
    expect(meta.provider).toBe("gemini");
    expect(meta.attempted).toEqual(["groq", "gemini"]);
  });

  it.each([401, 403])("fails over on %i (bad key / no access)", async (status) => {
    const groq = new FakeProvider(
      "groq",
      ["groq/x"],
      [{ status, body: { error: { message: "Invalid API Key", code: "invalid_api_key" } } }],
    );
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const result = await router.route(req("free-fast"));
    expect(result.provider.id).toBe("gemini");
    expect(result.failoverCount).toBe(1);
    expect(groq.errorCount).toBe(1);
  });

  it.each([
    [
      "code model_decommissioned",
      {
        error: {
          message: "The model `x` has been decommissioned and is no longer supported.",
          type: "invalid_request_error",
          code: "model_decommissioned",
        },
      },
    ],
    [
      "message 'does not exist or you do not have access'",
      { error: { message: GROQ_DEAD_MODEL_MESSAGE, type: "invalid_request_error" } },
    ],
  ])("fails over on a 400 whose body says the model is unavailable (%s)", async (_label, body) => {
    const groq = new FakeProvider("groq", ["groq/x"], [{ status: 400, body }]);
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const result = await router.route(req("free-fast"));
    expect(result.provider.id).toBe("gemini");
    expect(result.failoverCount).toBe(1);
  });

  it("streaming routes get the same failover", async () => {
    const groq = new FakeProvider("groq", ["groq/x"], [{ status: 404, body: GROQ_404_BODY }]);
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const result = await router.routeStream(req("free-fast", { stream: true }));
    expect(result.provider.id).toBe("gemini");
    expect(result.failoverCount).toBe(1);
  });

  it("surfaces the last provider's client error when every candidate rejects the model", async () => {
    const groq = new FakeProvider("groq", ["groq/x"], [{ status: 404, body: GROQ_404_BODY }]);
    const gemini = new FakeProvider(
      "gemini",
      ["gemini/y"],
      [{ status: 404, body: { error: { message: "models/y is not found", code: "NOT_FOUND" } } }],
    );
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const err = await router.route(req("free")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderClientError);
    expect((err as ProviderClientError).providerId).toBe("gemini");
    expect((err as ProviderClientError).statusCode).toBe(404);
  });

  it("throws AllProvidersExhaustedError when the last failure was not a client error", async () => {
    const groq = new FakeProvider("groq", ["groq/x"], [{ status: 404, body: GROQ_404_BODY }]);
    const gemini = new FakeProvider("gemini", ["gemini/y"], [{ status: 503 }]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    await expect(router.route(req("free"))).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });
});

describe("request-scoped client errors stay non-retriable", () => {
  it("a plain 400 bad request does NOT fail over", async () => {
    const groq = new FakeProvider(
      "groq",
      ["groq/x"],
      [
        {
          status: 400,
          body: {
            error: {
              message: "'messages' must contain at least one message",
              type: "invalid_request_error",
            },
          },
        },
      ],
    );
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const err = await router.route(req("free-fast")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderClientError);
    expect((err as ProviderClientError).statusCode).toBe(400);
    expect(gemini.callCount).toBe(0);
    expect(groq.errorCount).toBe(0);
  });

  it("a 400 saying something else 'does not exist' (no model mentioned) does NOT fail over", async () => {
    const groq = new FakeProvider(
      "groq",
      ["groq/x"],
      [{ status: 400, body: { error: { message: "property 'foo' does not exist" } } }],
    );
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    await expect(router.route(req("free-fast"))).rejects.toBeInstanceOf(ProviderClientError);
    expect(gemini.callCount).toBe(0);
  });
});

describe("strict mode never fails over on client errors", () => {
  it.each([404, 401, 403])("surfaces a %i from the chosen provider", async (status) => {
    const groq = new FakeProvider("groq", ["m"], [{ status, body: GROQ_404_BODY }]);
    const gemini = new FakeProvider("gemini", ["m"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const err = await router.route(req("m"), { strict: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderClientError);
    expect((err as ProviderClientError).statusCode).toBe(status);
    expect(groq.callCount).toBe(1);
    expect(gemini.callCount).toBe(0);
  });

  it("surfaces a model_decommissioned 400 without failing over", async () => {
    const groq = new FakeProvider(
      "groq",
      ["m"],
      [{ status: 400, body: { error: { message: "gone", code: "model_decommissioned" } } }],
    );
    const gemini = new FakeProvider("gemini", ["m"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    await expect(router.route(req("m"), { strict: true })).rejects.toBeInstanceOf(
      ProviderClientError,
    );
    expect(gemini.callCount).toBe(0);
  });
});

describe("direct concrete-model requests keep the upstream message", () => {
  it("a 404 on groq/<dead-model> returns Groq's message, not a generic exhaustion error", async () => {
    const groq = new FakeProvider(
      "groq",
      ["groq/dead-model"],
      [{ status: 404, body: GROQ_404_BODY }],
    );
    const gemini = new FakeProvider("gemini", ["gemini/y"]);
    const router = new GatewayRouter(fakeRegistry([groq, gemini]));

    const err = await router.complete(req("groq/dead-model")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderClientError);
    expect((err as ProviderClientError).providerId).toBe("groq");
    expect(gemini.callCount).toBe(0);

    // The error handler turns it into provider_upstream_error with Groq's text.
    const res = fakeExpressResponse();
    await errorHandler(err, { id: "req-1" } as never, res as never, () => {});
    expect(res.statusCode).toBe(502);
    expect(res.headers["X-FreeLLM-Provider"]).toBe("groq");
    expect(res.body).toMatchObject({
      error: {
        type: "provider_error",
        code: "provider_upstream_error",
        message: GROQ_DEAD_MODEL_MESSAGE,
      },
    });
  });

  it("a classified 400 leaves the upstream body readable (classification reads a clone)", async () => {
    const body = {
      error: {
        message: "The model `dead-model` has been decommissioned and is no longer supported.",
        code: "model_decommissioned",
      },
    };
    const groq = new FakeProvider("groq", ["groq/dead-model"], [{ status: 400, body }]);
    const router = new GatewayRouter(fakeRegistry([groq]));

    const err = (await router
      .route(req("groq/dead-model"))
      .catch((e: unknown) => e)) as ProviderClientError;
    expect(err).toBeInstanceOf(ProviderClientError);
    expect(err.upstreamResponse.bodyUsed).toBe(false);
    expect(await err.upstreamResponse.json()).toEqual(body);
  });
});

describe("bodyIndicatesModelUnavailable", () => {
  it("recognizes Mistral's top-level invalid_model type", () => {
    expect(
      bodyIndicatesModelUnavailable(
        JSON.stringify({ object: "error", message: "Invalid model: x", type: "invalid_model" }),
      ),
    ).toBe(true);
  });

  it("recognizes Gemini's array-wrapped error shape", () => {
    expect(
      bodyIndicatesModelUnavailable(
        JSON.stringify([
          {
            error: {
              code: 400,
              message: "models/gemini-x is no longer available to new users.",
              status: "INVALID_ARGUMENT",
            },
          },
        ]),
      ),
    ).toBe(true);
  });

  it("handles non-JSON bodies", () => {
    expect(bodyIndicatesModelUnavailable("model foo does not exist")).toBe(true);
    expect(bodyIndicatesModelUnavailable("Bad Request")).toBe(false);
    expect(bodyIndicatesModelUnavailable("")).toBe(false);
  });

  it("ignores ordinary validation errors", () => {
    expect(
      bodyIndicatesModelUnavailable(
        JSON.stringify({
          error: { message: "max_tokens must be <= 8192", type: "invalid_request_error" },
        }),
      ),
    ).toBe(false);
  });
});

describe("shipped catalogs stay consistent with DEFAULT_MODELS", () => {
  it("every provider's default model is present in its own catalog", () => {
    const registry = new ProviderRegistry();
    for (const provider of registry.getAll()) {
      if (provider.id === "ollama") continue; // catalog is discovered at runtime
      const def = DEFAULT_MODELS[provider.id];
      expect(def, `DEFAULT_MODELS.${provider.id}`).toBeDefined();
      expect(provider.models.map((m) => m.id)).toContain(`${provider.id}/${def}`);
    }
  });

  it("the Groq catalog no longer lists models Groq shut down in 2026", () => {
    const groq = new ProviderRegistry().getById("groq");
    const ids = groq?.models.map((m) => m.id) ?? [];
    for (const dead of [
      "groq/llama-3.3-70b-versatile",
      "groq/llama-3.1-8b-instant",
      "groq/meta-llama/llama-4-scout-17b-16e-instruct",
      "groq/qwen/qwen3-32b",
    ]) {
      expect(ids).not.toContain(dead);
    }
    // Vision requests still have a Groq candidate.
    expect(groq?.models.some((m) => m.supportsVision)).toBe(true);
  });
});

function fakeExpressResponse() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}
