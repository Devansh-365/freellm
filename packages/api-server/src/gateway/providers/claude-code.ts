import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { existsSync } from "node:fs";
import { BaseProvider } from "./base.js";
import type {
  ModelObject,
  ChatCompletionRequest,
  ChatMessage,
} from "../types.js";
import { execSync } from "node:child_process";

const DEFAULT_VARIANTS = ["sonnet", "opus", "haiku"];
const DEFAULT_SOCKET = "/var/run/claude-bridge.sock";

function bridgeSocketPath(): string {
  return process.env["CLAUDE_CODE_BRIDGE_SOCKET"] ?? DEFAULT_SOCKET;
}

function bridgeAvailable(): boolean {
  try {
    return !!execSync(`claude --version`);
  } catch {
    return false;
  }
}

export class ClaudeCodeProvider extends BaseProvider {
  readonly id = "claude-code";
  readonly name = "Claude Code (host bridge)";

  get baseUrl(): string {
    return `unix://${bridgeSocketPath()}`;
  }

  get models(): ModelObject[] {
    if (!bridgeAvailable()) return [];
    const raw = process.env["CLAUDE_CODE_MODELS"]?.trim();
    const variants = raw
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_VARIANTS;
    return variants.map((v) => ({
      id: `claude-code/${v}`,
      object: "model" as const,
      created: 1700000000,
      owned_by: "anthropic-host",
      provider: "claude-code",
    }));
  }

  protected getApiKeys(): string[] {
    return bridgeAvailable() ? ["claude-code"] : [];
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const picked = this.pickKey();
    if (!picked) {
      throw new Error(
        `Provider ${this.name} is not configured (bridge socket missing)`,
      );
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();
    this.rateLimiter.recordRequest(picked.trackingId);

    const variant = request.model.replace(/^claude-code\//, "");
    const prompt = flattenMessages(request.messages);

    const iter = bridgeStream(bridgeSocketPath(), { prompt, model: variant });

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

type BridgeBody = { prompt: string; model: string };

async function* bridgeStream(
  socketPath: string,
  body: BridgeBody,
): AsyncGenerator<Record<string, unknown>> {
  const payload = JSON.stringify(body);

  const req = httpRequest({
    socketPath,
    method: "POST",
    path: "/v1/complete",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
    },
  });

  const responsePromise = new Promise<NodeJS.ReadableStream>(
    (resolve, reject) => {
      req.once("response", (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            reject(
              new Error(
                `bridge http ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8")}`,
              ),
            ),
          );
          return;
        }
        resolve(res);
      });
      req.once("error", reject);
    },
  );

  req.write(payload);
  req.end();

  const res = await responsePromise;

  let buf = "";
  for await (const chunk of res as AsyncIterable<Buffer>) {
    buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as Record<string, unknown>;
      } catch {
        // skip malformed line
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as Record<string, unknown>;
    } catch {}
  }
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
  iter: AsyncIterable<Record<string, unknown>>,
  modelId: string,
  provider: ClaudeCodeProvider,
): Promise<Response> {
  let content = "";
  let finishReason = "stop";

  try {
    for await (const msg of iter) {
      const type = msg["type"];
      if (type === "stream_event") {
        const text = extractDeltaText(msg["event"]);
        if (text) content += text;
      } else if (type === "result") {
        const subtype = msg["subtype"];
        const result = msg["result"];
        if (subtype === "success" && typeof result === "string") {
          content = result;
        } else if (subtype === "error_max_turns") {
          finishReason = "length";
        } else if (subtype === "error_during_execution") {
          throw new Error("claude bridge error during execution");
        }
      } else if (type === "bridge_error") {
        const stderr = msg["stderr"] ? `: ${msg["stderr"]}` : "";
        throw new Error(`bridge error${stderr}`);
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
  iter: AsyncIterable<Record<string, unknown>>,
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
          const type = msg["type"];
          if (type === "stream_event") {
            const text = extractDeltaText(msg["event"]);
            if (text) {
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [
                  { index: 0, delta: { content: text }, finish_reason: null },
                ],
              });
            }
          } else if (type === "result") {
            const finishReason =
              msg["subtype"] === "error_max_turns" ? "length" : "stop";
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            });
          } else if (type === "bridge_error") {
            const stderr = msg["stderr"] ? `: ${msg["stderr"]}` : "";
            throw new Error(`bridge error${stderr}`);
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
          choices: [
            {
              index: 0,
              delta: { content: `\n[Error: ${String(err)}]` },
              finish_reason: "stop",
            },
          ],
        });
        done();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}
