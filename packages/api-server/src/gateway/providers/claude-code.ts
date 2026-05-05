import { randomUUID } from "node:crypto";
import { BaseProvider } from "./base.js";
import type {
  ModelObject,
  ChatCompletionRequest,
  ChatMessage,
} from "../types.js";
import { execSync, spawn } from "node:child_process";

const DEFAULT_VARIANTS = ["sonnet", "opus", "haiku"];

function claudeAvailable(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    console.log("claude available!!");
    return true;
  } catch {
    console.log("claude NOT available :(");
    return false;
  }
}

export class ClaudeCodeProvider extends BaseProvider {
  readonly id = "claude-code";
  readonly name = "Claude Code (local CLI)";

  get baseUrl(): string {
    return "cli://claude";
  }

  get models(): ModelObject[] {
    if (!claudeAvailable()) return [];

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
      owned_by: "anthropic-local",
      provider: "claude-code",
    }));
  }

  protected getApiKeys(): string[] {
    return claudeAvailable() ? ["claude-code"] : [];
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const picked = this.pickKey();
    if (!picked) {
      throw new Error(
        `Provider ${this.name} is not available (claude CLI missing)`,
      );
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();
    this.rateLimiter.recordRequest(picked.trackingId);

    const variant = request.model.replace(/^claude-code\//, "");
    const prompt = flattenMessages(request.messages);

    const iter = spawnClaudeStream({ prompt, model: variant, stream: request.stream ?? false });

    const response = request.stream
      ? buildSseResponse(iter, request.model, this)
      : await buildJsonResponse(iter, request.model, this);

    this.attachResponseToKey(response, picked.trackingId);
    return response;
  }
}

/* -------------------------- message flattening -------------------------- */

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

/* -------------------------- CLI stream adapter -------------------------- */

type ClaudeExecInput = {
  prompt: string;
  model: string;
  stream: boolean;
};

async function* spawnClaudeStream(
  input: ClaudeExecInput,
): AsyncGenerator<Record<string, unknown>> {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--dangerously-skip-permissions",
    "--no-session-persistence",
  ];

  if (input.stream) {
    args.push("--include-partial-messages");
  }

  const proc = spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdin.write(input.prompt);
  proc.stdin.end();

  let buf = "";
  let stderr = "";

  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });

  for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
    buf += chunk.toString("utf8");

    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);

      if (!line) continue;

      try {
        yield JSON.parse(line);
      } catch {
        // ignore malformed JSON
      }
    }
  }

  const tail = buf.trim();
  if (tail) {
    try {
      yield JSON.parse(tail);
    } catch {}
  }

  const exitCode: number = await new Promise((resolve) =>
    proc.on("close", resolve),
  );

  console.error(`[claude-code] exit=${exitCode} stderr=${stderr || "(none)"}`);
  if (exitCode !== 0) {
    throw new Error(
      `claude process exited with code ${exitCode}${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

/* -------------------------- event helpers -------------------------- */

// Extract accumulated text from an assistant message event.
// Events with --include-partial-messages grow monotonically, so we diff
// against prevText to produce the new delta only.
function extractAssistantText(msg: Record<string, unknown>): string {
  const message = msg["message"] as Record<string, unknown> | undefined;
  if (!message) return "";
  const content = message["content"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block["type"] === "text") return String(block["text"] ?? "");
  }
  return "";
}

/* -------------------------- JSON response -------------------------- */

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

      if (type === "result") {
        const subtype = msg["subtype"];
        const result = msg["result"];
        console.error(`[claude-code] result event: subtype=${subtype} is_error=${msg["is_error"]} result=${JSON.stringify(result)?.slice(0, 120)}`);

        if (subtype === "success" && typeof result === "string") {
          content = result;
        } else if (subtype === "error_max_turns") {
          finishReason = "length";
        } else if (subtype === "error_during_execution") {
          throw new Error("claude execution error");
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

/* -------------------------- SSE response -------------------------- */

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

      let prevText = "";

      try {
        for await (const msg of iter) {
          const type = msg["type"];

          if (type === "assistant") {
            // Each event contains accumulated text so far; diff to get delta.
            const fullText = extractAssistantText(msg);
            if (fullText.length > prevText.length) {
              const delta = fullText.slice(prevText.length);
              prevText = fullText;
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: { content: delta },
                    finish_reason: null,
                  },
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
