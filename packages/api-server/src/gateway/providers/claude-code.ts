import { query } from "@anthropic-ai/claude-code";
import { randomUUID } from "node:crypto";
import { BaseProvider } from "./base.js";
import type { ModelObject, ChatCompletionRequest, ChatMessage } from "../types.js";

const DEFAULT_VARIANTS = ["sonnet", "opus", "haiku"];

export class ClaudeCodeProvider extends BaseProvider {
  readonly id = "claude-code";
  readonly name = "Claude Code (local SDK)";

  get baseUrl(): string {
    return "claude-code-sdk://";
  }

  get models(): ModelObject[] {
    const raw = process.env["CLAUDE_CODE_MODELS"]?.trim();
    const variants = raw
      ? raw.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_VARIANTS;
    return variants.map((v) => ({
      id: `claude-code/${v}`,
      object: "model" as const,
      created: 1700000000,
      owned_by: "anthropic",
      provider: "claude-code",
    }));
  }

  protected getApiKeys(): string[] {
    return ["claude-code"];
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const picked = this.pickKey();
    if (!picked) {
      throw new Error(`Provider ${this.name} is not configured`);
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();
    this.rateLimiter.recordRequest(picked.trackingId);

    const variant = request.model.replace(/^claude-code\//, "");
    const prompt = flattenMessages(request.messages);

    const iter = query({
      prompt,
      options: {
        model: variant,
        allowedTools: [],
        permissionMode: "plan",
        maxTurns: 1,
        includePartialMessages: true,
      },
    });

    const response = request.stream
      ? buildSseResponse(iter, request.model, this)
      : await buildJsonResponse(iter, request.model, this);

    this.attachResponseToKey(response, picked.trackingId);
    return response;
  }
}

function flattenMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role.toUpperCase();
      let content = "";
      if (typeof m.content === "string") {
        content = m.content;
      } else if (Array.isArray(m.content)) {
        content = m.content
          .map((part) => {
            if (typeof part === "string") return part;
            const p = part as Record<string, unknown>;
            if (p["type"] === "text") return String(p["text"] ?? "");
            return JSON.stringify(part);
          })
          .join("\n");
      }
      if (m.tool_calls?.length) {
        content += "\n" + JSON.stringify(m.tool_calls);
      }
      return `[${role}]\n${content}`;
    })
    .join("\n\n");
}

type StreamEvent = {
  type: string;
  delta?: { type: string; text?: string };
  index?: number;
};

function extractDeltaText(event: unknown): string | null {
  const e = event as StreamEvent;
  if (e.type === "content_block_delta" && e.delta?.type === "text_delta") {
    return e.delta.text ?? null;
  }
  return null;
}

async function buildJsonResponse(
  iter: AsyncIterable<{ type: string; result?: string; subtype?: string }>,
  modelId: string,
  provider: ClaudeCodeProvider,
): Promise<Response> {
  let content = "";
  let finishReason = "stop";

  try {
    for await (const msg of iter) {
      if (msg.type === "stream_event") {
        const text = extractDeltaText((msg as { event: unknown }).event);
        if (text) content += text;
      } else if (msg.type === "result") {
        const r = msg as { type: string; subtype: string; result?: string };
        if (r.subtype === "success" && r.result) {
          content = r.result;
        } else if (r.subtype === "error_max_turns") {
          finishReason = "length";
        } else if (r.subtype === "error_during_execution") {
          throw new Error("claude SDK error during execution");
        }
      }
    }
  } catch (err) {
    provider.onError();
    throw err;
  }

  const body = {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function buildSseResponse(
  iter: AsyncIterable<{ type: string; subtype?: string; result?: string; event?: unknown }>,
  modelId: string,
  provider: ClaudeCodeProvider,
): Response {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      const done = () => {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      };

      try {
        for await (const msg of iter) {
          if (msg.type === "stream_event") {
            const text = extractDeltaText(msg.event);
            if (text) {
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
              });
            }
          } else if (msg.type === "result") {
            const finishReason = msg.subtype === "error_max_turns" ? "length" : "stop";
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            });
          }
        }
        done();
      } catch (err) {
        provider.onError();
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelId,
          choices: [{ index: 0, delta: { content: `\n[Error: ${String(err)}]` }, finish_reason: "stop" }],
        });
        done();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}
