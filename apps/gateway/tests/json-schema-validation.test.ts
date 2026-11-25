import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
/**
 * Tests for the X-FreeLLM-Warning: schema-validation-failed header.
 *
 * Uses a fake upstream whose response content is configurable so each
 * test can verify the schema-validation annotation logic independently.
 *
 * The schema used across tests requires an object with `name: string`
 * and `age: number` as required fields.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface FakeUpstream {
  server: Server;
  url: string;
  responseContent: { current: string };
  finishReason: { current: string };
  close: () => Promise<void>;
}

async function startFakeUpstream(): Promise<FakeUpstream> {
  const responseContent = { current: '{"name":"Alice","age":30}' };
  const finishReason = { current: "stop" };

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url?.includes("/chat/completions")) {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-schema-1",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "openai/gpt-oss-120b",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: responseContent.current,
                },
                finish_reason: finishReason.current,
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
          }),
        );
      });
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    server,
    url,
    responseContent,
    finishReason,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

const TEST_SCHEMA = {
  type: "object",
  required: ["name", "age"],
  properties: {
    name: { type: "string" },
    age: { type: "number" },
  },
};

const JSON_SCHEMA_BODY = {
  model: "groq/openai/gpt-oss-120b",
  messages: [{ role: "user", content: "give me a person" }],
  response_format: {
    type: "json_schema",
    json_schema: { name: "person", schema: TEST_SCHEMA },
  },
};

let upstream: FakeUpstream;
let app: Express;

beforeAll(async () => {
  upstream = await startFakeUpstream();

  process.env.GROQ_BASE_URL = upstream.url;
  process.env.GROQ_API_KEY = "sk-test-fake";
  process.env.RATE_LIMIT_RPM = "100000";
  process.env.FREELLM_IDENTIFIER_LIMIT = "1000/60000";
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
    "FREELLM_API_KEY",
  ]) {
    delete process.env[k];
  }

  const mod = await import("../src/app.js");
  app = mod.default;
});

afterAll(async () => {
  await upstream.close();
  delete process.env.GROQ_BASE_URL;
  delete process.env.GROQ_API_KEY;
});

describe("JSON schema response validation header", () => {
  it("does NOT set schema-validation-failed when response satisfies the schema", async () => {
    upstream.responseContent.current = '{"name":"Alice","age":30}';
    upstream.finishReason.current = "stop";

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("x-freellm-strict", "true")
      .send(JSON_SCHEMA_BODY);

    expect(res.status).toBe(200);
    const warning = res.headers["x-freellm-warning"] as string | undefined;
    expect(warning ?? "").not.toContain("schema-validation-failed");
  });

  it("sets schema-validation-failed when required fields are missing", async () => {
    upstream.responseContent.current = '{"name":"Alice"}'; // missing "age"
    upstream.finishReason.current = "stop";

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("x-freellm-strict", "true")
      .send(JSON_SCHEMA_BODY);

    expect(res.status).toBe(200);
    expect(res.headers["x-freellm-warning"]).toContain("schema-validation-failed");
  });

  it("sets schema-validation-failed when content is not valid JSON", async () => {
    upstream.responseContent.current = "this is not json";
    upstream.finishReason.current = "stop";

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("x-freellm-strict", "true")
      .send(JSON_SCHEMA_BODY);

    expect(res.status).toBe(200);
    expect(res.headers["x-freellm-warning"]).toContain("schema-validation-failed");
  });

  it("sets schema-validation-failed when top-level type is wrong", async () => {
    upstream.responseContent.current = '["Alice", 30]'; // array, not object
    upstream.finishReason.current = "stop";

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("x-freellm-strict", "true")
      .send(JSON_SCHEMA_BODY);

    expect(res.status).toBe(200);
    expect(res.headers["x-freellm-warning"]).toContain("schema-validation-failed");
  });

  it("does NOT set schema-validation-failed for json_object mode (no schema to validate against)", async () => {
    upstream.responseContent.current = '{"anything": true}';
    upstream.finishReason.current = "stop";

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("x-freellm-strict", "true")
      .send({
        model: "groq/openai/gpt-oss-120b",
        messages: [{ role: "user", content: "give me json" }],
        response_format: { type: "json_object" },
      });

    expect(res.status).toBe(200);
    const warning = res.headers["x-freellm-warning"] as string | undefined;
    expect(warning ?? "").not.toContain("schema-validation-failed");
  });

  it("sets both truncation and schema-validation-failed warnings when applicable", async () => {
    upstream.responseContent.current = '{"name":"Alice"}'; // missing "age"
    upstream.finishReason.current = "length"; // also truncated

    const res = await request(app)
      .post("/v1/chat/completions")
      .set("x-freellm-strict", "true")
      .send(JSON_SCHEMA_BODY);

    expect(res.status).toBe(200);
    const warning = res.headers["x-freellm-warning"] as string | undefined;
    expect(warning).toBeDefined();
    expect(warning).toContain("json-possibly-truncated");
    expect(warning).toContain("schema-validation-failed");
  });
});
