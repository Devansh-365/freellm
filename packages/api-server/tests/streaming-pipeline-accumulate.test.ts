/**
 * Verifies StreamingPipeline body-capture hooks.
 *
 *   - getAccumulated() returns concatenated `delta.content`.
 *   - getChunkCount() matches successfully-parsed data events.
 *   - Non-parseable / non-data events do not bump the counter.
 */
import { describe, it, expect } from "vitest";
import { StreamingPipeline } from "../src/gateway/streaming/pipeline.js";

function chunk(delta: string): string {
  const payload = {
    id: "x",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("StreamingPipeline body capture", () => {
  it("accumulates delta.content across chunks", () => {
    const p = new StreamingPipeline("openai");
    p.push(chunk("Hello"));
    p.push(chunk(", "));
    p.push(chunk("world"));
    p.flush();
    expect(p.getAccumulated()).toBe("Hello, world");
    expect(p.getChunkCount()).toBe(3);
  });

  it("counter ignores comments and DONE sentinel", () => {
    const p = new StreamingPipeline("openai");
    p.push(": ping\n\n");
    p.push(chunk("a"));
    p.push("data: [DONE]\n\n");
    p.flush();
    expect(p.getChunkCount()).toBe(1);
    expect(p.getAccumulated()).toBe("a");
  });

  it("handles chunk with no delta.content gracefully", () => {
    const p = new StreamingPipeline("openai");
    const noContent = `data: ${JSON.stringify({
      id: "x",
      object: "chat.completion.chunk",
      created: 0,
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`;
    p.push(noContent);
    p.flush();
    expect(p.getAccumulated()).toBe("");
    expect(p.getChunkCount()).toBe(1);
  });
});
