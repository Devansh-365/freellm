import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
/**
 * Integration test: streaming token tracking with virtual key caps.
 *
 * Verifies Option C behaviour:
 *  1. stream_options.include_usage is injected when the authenticated virtual
 *     key has a dailyTokenCap.
 *  2. Actual token counts (not 0) are recorded against the virtual key after
 *     the stream completes.
 *  3. stream_options.include_usage is NOT injected for requests without a
 *     virtual key.
 *
 * The test boots a fake HTTP upstream that captures the outgoing request body
 * and returns a pre-canned SSE stream containing a usage chunk.  It points
 * GROQ_BASE_URL at that fake server so the real Groq provider
 * (supportsStreamUsage = true) routes through without hitting the network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  VirtualKeyStore,
  getVirtualKeyStore,
  setVirtualKeyStore,
} from "../src/features/virtual-keys.js";

const TEST_KEY_ID = "sk-freellm-streamtest1";

// SSE stream that includes a usage chunk on the final delta.
const STREAM_WITH_USAGE =
  'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"openai/gpt-oss-120b","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n' +
  'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"openai/gpt-oss-120b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n' +
  "data: [DONE]\n\n";

let upstreamServer: Server;
let upstreamUrl: string;
let app: Express;
let lastCapturedBody: Record<string, unknown> = {};

async function startFakeUpstream(): Promise<void> {
  upstreamServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        lastCapturedBody = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        lastCapturedBody = {};
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      res.end(STREAM_WITH_USAGE);
    });
  });
  await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
  upstreamUrl = `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  await startFakeUpstream();

  // Point the Groq provider (supportsStreamUsage = true) at our fake server.
  process.env.GROQ_BASE_URL = upstreamUrl;
  process.env.GROQ_API_KEY = "sk-test-fake";
  process.env.RATE_LIMIT_RPM = "100000";
  process.env.FREELLM_IDENTIFIER_LIMIT = "1000/60000";
  // Open auth so the virtual key bearer is the only auth layer.
  delete process.env.FREELLM_API_KEY;
  for (const k of [
    "GEMINI_API_KEY",
    "MISTRAL_API_KEY",
    "CEREBRAS_API_KEY",
    "NIM_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_KEY",
    "GITHUB_MODELS_API_KEY",
    "OLLAMA_BASE_URL",
  ]) {
    delete process.env[k];
  }

  // Inject a virtual key with a dailyTokenCap before the app module loads.
  setVirtualKeyStore(
    new VirtualKeyStore([{ id: TEST_KEY_ID, label: "stream-test", dailyTokenCap: 1000 }]),
  );

  const mod = await import("../src/app.js");
  app = mod.default;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    upstreamServer.close((err) => (err ? reject(err) : resolve())),
  );
  delete process.env.GROQ_BASE_URL;
  delete process.env.GROQ_API_KEY;
});

async function streamRequest(authHeader?: string): Promise<void> {
  await request(app)
    .post("/v1/chat/completions")
    .set("content-type", "application/json")
    .set("authorization", authHeader ?? "")
    .send({
      model: "groq/openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    })
    .buffer(true)
    .parse((r, cb) => {
      let data = "";
      r.setEncoding("utf8");
      r.on("data", (chunk: string) => {
        data += chunk;
      });
      r.on("end", () => cb(null, data));
    });
}

describe("streaming token tracking", () => {
  it("injects stream_options.include_usage when virtual key has dailyTokenCap", async () => {
    lastCapturedBody = {};
    await streamRequest(`Bearer ${TEST_KEY_ID}`);
    expect((lastCapturedBody.stream_options as Record<string, unknown>)?.include_usage).toBe(true);
  });

  it("records actual token count against virtual key cap after streaming", async () => {
    const store = getVirtualKeyStore();
    const before = store.usage(TEST_KEY_ID)?.tokensInWindow ?? 0;

    await streamRequest(`Bearer ${TEST_KEY_ID}`);

    const after = store.usage(TEST_KEY_ID)?.tokensInWindow ?? 0;
    expect(after).toBeGreaterThan(before);
    // Fake upstream emits prompt_tokens=10 + completion_tokens=5.
    expect(after - before).toBe(15);
  });

  it("does NOT inject stream_options.include_usage without a token-capped virtual key", async () => {
    lastCapturedBody = {};
    // No auth header — open mode since FREELLM_API_KEY is unset.
    await streamRequest();
    const opts = lastCapturedBody.stream_options as Record<string, unknown> | undefined;
    expect(opts?.include_usage).toBeUndefined();
  });
});
