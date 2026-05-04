/**
 * Unit tests for the Claude Code provider.
 *
 * The `@anthropic-ai/claude-code` SDK and `node:fs` are mocked. No real
 * SDK call, no real filesystem read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const queryMock = vi.fn();
const existsSyncMock = vi.fn();

vi.mock("@anthropic-ai/claude-code", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, existsSync: (...args: unknown[]) => existsSyncMock(...args) };
});

import { ClaudeCodeProvider } from "../src/gateway/providers/claude-code.js";
import type { ChatCompletionRequest } from "../src/gateway/types.js";

class Exposed extends ClaudeCodeProvider {
  public exposeKeys(): string[] {
    return this.getApiKeys();
  }
}

async function* scriptedDeltas(): AsyncGenerator<unknown> {
  yield {
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "a" } },
  };
  yield {
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "b" } },
  };
  yield {
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text: "c" } },
  };
  yield { type: "result", subtype: "success", result: "abc" };
}

async function* scriptedAuthError(): AsyncGenerator<unknown> {
  throw new Error("authentication failed: please run `claude login`");
  yield;
}

let savedHome: string | undefined;
let savedModels: string | undefined;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedModels = process.env["CLAUDE_CODE_MODELS"];
  process.env["HOME"] = "/home/appuser";
  delete process.env["CLAUDE_CODE_MODELS"];
  queryMock.mockReset();
  existsSyncMock.mockReset();
});

afterEach(() => {
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  if (savedModels === undefined) delete process.env["CLAUDE_CODE_MODELS"];
  else process.env["CLAUDE_CODE_MODELS"] = savedModels;
});

describe("ClaudeCodeProvider.cred-gating", () => {
  it("returns no models and no keys when credentials file is absent", () => {
    existsSyncMock.mockReturnValue(false);
    const p = new Exposed();
    expect(p.models).toEqual([]);
    expect(p.exposeKeys()).toEqual([]);
    expect(p.isEnabled()).toBe(false);
  });

  it("returns 3 default variants and one sentinel key when creds exist", () => {
    existsSyncMock.mockReturnValue(true);
    const p = new Exposed();
    const ids = p.models.map((m) => m.id);
    expect(ids).toEqual([
      "claude-code/sonnet",
      "claude-code/opus",
      "claude-code/haiku",
    ]);
    expect(p.exposeKeys()).toEqual(["claude-code"]);
    expect(p.isEnabled()).toBe(true);
  });

  it("respects CLAUDE_CODE_MODELS override", () => {
    existsSyncMock.mockReturnValue(true);
    process.env["CLAUDE_CODE_MODELS"] = "sonnet, custom-x";
    const ids = new Exposed().models.map((m) => m.id);
    expect(ids).toEqual(["claude-code/sonnet", "claude-code/custom-x"]);
  });
});

describe("ClaudeCodeProvider.complete (non-stream)", () => {
  it("aggregates text deltas, returns OpenAI-shaped JSON, finish_reason=stop", async () => {
    existsSyncMock.mockReturnValue(true);
    queryMock.mockReturnValue(scriptedDeltas());

    const p = new ClaudeCodeProvider();
    const req: ChatCompletionRequest = {
      model: "claude-code/sonnet",
      messages: [{ role: "user", content: "hi" }],
    };
    const resp = await p.complete(req);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      choices: { message: { content: string }; finish_reason: string }[];
      model: string;
    };
    expect(body.model).toBe("claude-code/sonnet");
    expect(body.choices[0]!.message.content).toBe("abc");
    expect(body.choices[0]!.finish_reason).toBe("stop");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const callArg = queryMock.mock.calls[0]![0] as {
      prompt: string;
      options: { model: string; allowedTools: unknown[]; permissionMode: string; maxTurns: number };
    };
    expect(callArg.options.model).toBe("sonnet");
    expect(callArg.options.allowedTools).toEqual([]);
    expect(callArg.options.maxTurns).toBe(1);
  });
});

describe("ClaudeCodeProvider.complete (stream)", () => {
  it("emits OpenAI delta chunks in order then [DONE]", async () => {
    existsSyncMock.mockReturnValue(true);
    queryMock.mockReturnValue(scriptedDeltas());

    const p = new ClaudeCodeProvider();
    const resp = await p.complete({
      model: "claude-code/sonnet",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(resp.headers.get("content-type")).toBe("text/event-stream");

    const reader = resp.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    const events = buf.split("\n\n").filter((s) => s.startsWith("data: "));
    const payloads = events.map((e) => e.slice(6));
    expect(payloads.at(-1)).toBe("[DONE]");
    const parsed = payloads.slice(0, -1).map((p) => JSON.parse(p));
    const texts = parsed
      .map((p) => p.choices?.[0]?.delta?.content)
      .filter(Boolean);
    expect(texts.join("")).toBe("abc");
    const last = parsed.at(-1);
    expect(last.choices[0].finish_reason).toBe("stop");
  });
});

describe("ClaudeCodeProvider.complete (auth error)", () => {
  it("emits error chunk on SDK throw, terminates with [DONE]", async () => {
    existsSyncMock.mockReturnValue(true);
    queryMock.mockReturnValue(scriptedAuthError());

    const p = new ClaudeCodeProvider();
    const resp = await p.complete({
      model: "claude-code/sonnet",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    const text = await resp.text();
    expect(text).toContain("[DONE]");
    expect(text.toLowerCase()).toContain("authentication");
  });
});

describe("ClaudeCodeProvider.flatten (via prompt arg)", () => {
  it("preserves role order and content", async () => {
    existsSyncMock.mockReturnValue(true);
    queryMock.mockReturnValue(scriptedDeltas());

    const p = new ClaudeCodeProvider();
    await p.complete({
      model: "claude-code/sonnet",
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "second" },
      ],
    });
    const callArg = queryMock.mock.calls[0]![0] as { prompt: string };
    const idxSystem = callArg.prompt.indexOf("[SYSTEM]");
    const idxUser1 = callArg.prompt.indexOf("first");
    const idxAssistant = callArg.prompt.indexOf("[ASSISTANT]");
    const idxUser2 = callArg.prompt.indexOf("second");
    expect(idxSystem).toBeGreaterThanOrEqual(0);
    expect(idxSystem).toBeLessThan(idxUser1);
    expect(idxUser1).toBeLessThan(idxAssistant);
    expect(idxAssistant).toBeLessThan(idxUser2);
  });
});
