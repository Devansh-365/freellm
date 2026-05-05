import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BaseProvider } from "./base.js";
import type {
  ModelObject,
  ChatCompletionRequest,
  ChatMessage,
  ChatTool,
} from "../types.js";

/* ─────────────────────────────── constants ─────────────────────────────── */

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const TOKEN_REFRESH_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 8192;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const MODEL_MAP: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
};

/* ─────────────────────────────── credentials ────────────────────────────── */

interface OAuthCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let cachedCreds: OAuthCreds | null = null;

function readCredentialsFile(): OAuthCreds | null {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = data["claudeAiOauth"] as Record<string, unknown> | undefined;
    if (!oauth?.["accessToken"]) return null;
    return {
      accessToken: String(oauth["accessToken"]),
      refreshToken: String(oauth["refreshToken"] ?? ""),
      expiresAt: Number(oauth["expiresAt"] ?? 0),
    };
  } catch {
    return null;
  }
}

async function refreshOAuthToken(
  creds: OAuthCreds,
): Promise<OAuthCreds | null> {
  try {
    const resp = await fetch(TOKEN_REFRESH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    return {
      accessToken: String(data["access_token"]),
      refreshToken: String(data["refresh_token"] ?? creds.refreshToken),
      expiresAt: Date.now() + Number(data["expires_in"] ?? 3600) * 1000,
    };
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();

  if (!cachedCreds || now >= cachedCreds.expiresAt - REFRESH_BUFFER_MS) {
    const fresh = readCredentialsFile();
    if (!fresh) return null;

    if (now < fresh.expiresAt - REFRESH_BUFFER_MS) {
      cachedCreds = fresh;
      return fresh.accessToken;
    }

    const refreshed = await refreshOAuthToken(fresh);
    cachedCreds = refreshed ?? fresh;
  }

  return cachedCreds!.accessToken;
}

/* ──────────────────────── OpenAI → Anthropic translation ────────────────── */

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "url"; url: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

type AnthropicRequest = {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
};

function contentToString(content: ChatMessage["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => {
      if (typeof p === "string") return p;
      const part = p as Record<string, unknown>;
      return part["type"] === "text" ? String(part["text"] ?? "") : "";
    })
    .join("");
}

function toAnthropicContent(
  content: ChatMessage["content"],
): string | AnthropicContentBlock[] {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const blocks: AnthropicContentBlock[] = [];
  for (const p of content) {
    if (typeof p === "string") {
      blocks.push({ type: "text", text: p });
      continue;
    }
    const part = p as Record<string, unknown>;
    if (part["type"] === "text") {
      blocks.push({ type: "text", text: String(part["text"] ?? "") });
    } else if (part["type"] === "image_url") {
      const iu = part["image_url"] as Record<string, unknown> | undefined;
      if (iu?.["url"]) {
        blocks.push({
          type: "image",
          source: { type: "url", url: String(iu["url"]) },
        });
      }
    }
  }

  // Collapse single-text-block to plain string (Anthropic prefers it)
  if (blocks.length === 1 && blocks[0]?.type === "text") return blocks[0].text;
  return blocks;
}

function toAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemParts.push(contentToString(msg.content));
      continue;
    }

    if (msg.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id ?? "",
            content: contentToString(msg.content),
          },
        ],
      });
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];

      const text = contentToString(msg.content);
      if (text) blocks.push({ type: "text", text });

      for (const tc of msg.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments ?? "{}");
        } catch {}
        blocks.push({
          type: "tool_use",
          id: tc.id ?? `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          name: tc.function.name ?? "",
          input,
        });
      }

      out.push({
        role: "assistant",
        content:
          blocks.length === 1 && blocks[0]?.type === "text"
            ? blocks[0].text
            : blocks,
      });
      continue;
    }

    out.push({ role: "user", content: toAnthropicContent(msg.content) });
  }

  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: out,
  };
}

function toAnthropicTools(tools: ChatTool[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters as Record<string, unknown>) ?? {
      type: "object",
      properties: {},
    },
  }));
}

function toAnthropicToolChoice(
  tc: ChatCompletionRequest["tool_choice"],
): unknown {
  if (!tc) return undefined;
  if (tc === "none") return { type: "none" };
  if (tc === "auto") return { type: "auto" };
  if (tc === "required") return { type: "any" };
  if (typeof tc === "object" && tc.type === "function") {
    return { type: "tool", name: tc.function.name };
  }
  return undefined;
}

function buildAnthropicRequest(
  request: ChatCompletionRequest,
  modelId: string,
): AnthropicRequest {
  const { system, messages } = toAnthropicMessages(request.messages);

  const req: AnthropicRequest = {
    model: modelId,
    max_tokens:
      request.max_tokens ?? request.max_completion_tokens ?? DEFAULT_MAX_TOKENS,
    messages,
  };

  if (system) req.system = system;

  if (request.tools?.length) {
    req.tools = toAnthropicTools(request.tools);
    const tc = toAnthropicToolChoice(request.tool_choice);
    if (tc) req.tool_choice = tc;
  }

  if (request.stream) req.stream = true;
  if (request.temperature != null) req.temperature = request.temperature;
  if (request.top_p != null) req.top_p = request.top_p;
  if (request.stop) {
    req.stop_sequences = Array.isArray(request.stop)
      ? request.stop
      : [request.stop];
  }

  return req;
}

/* ────────────────────── Anthropic → OpenAI translation ─────────────────── */

function toFinishReason(stopReason: string | null | undefined): string {
  switch (stopReason) {
    case "end_turn":
      return "stop";
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
      return "stop";
    default:
      return "stop";
  }
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponseBody {
  id: string;
  model: string;
  content: AnthropicBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

function buildOpenAIResponse(
  body: AnthropicResponseBody,
  modelId: string,
): Record<string, unknown> {
  let textContent: string | null = null;
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];

  for (const block of body.content) {
    if (block.type === "text" && block.text != null) {
      textContent = (textContent ?? "") + block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id ?? `call_${randomUUID()}`,
        type: "function",
        function: {
          name: block.name ?? "",
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }

  const message: Record<string, unknown> = { role: "assistant" };
  if (toolCalls.length) {
    message["content"] = null;
    message["tool_calls"] = toolCalls;
  } else {
    message["content"] = textContent ?? "";
  }

  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toFinishReason(body.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: body.usage.input_tokens,
      completion_tokens: body.usage.output_tokens,
      total_tokens: body.usage.input_tokens + body.usage.output_tokens,
    },
  };
}

/* ──────────────────────────── SSE streaming ─────────────────────────────── */

interface BlockState {
  type: string;
  toolCallIndex?: number;
  toolCallId?: string;
  toolName?: string;
}

function buildSseResponse(
  upstream: Response,
  modelId: string,
  provider: ClaudeCodeApiProvider,
): Response {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const done = () => {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      };

      const blocks = new Map<number, BlockState>();
      let toolCallCounter = 0;

      try {
        const reader = upstream.body!.getReader();
        const td = new TextDecoder();
        let buf = "";

        while (true) {
          const { done: rdDone, value } = await reader.read();
          if (rdDone) break;
          buf += td.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trimEnd();
            buf = buf.slice(nl + 1);

            if (!line || !line.startsWith("data: ")) continue;

            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") break;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(dataStr) as Record<string, unknown>;
            } catch {
              continue;
            }

            const evtType = evt["type"] as string;

            if (evtType === "message_start") {
              // Emit role-announcing first chunk
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: { role: "assistant" },
                    finish_reason: null,
                  },
                ],
              });
            } else if (evtType === "content_block_start") {
              const idx = evt["index"] as number;
              const block = evt["content_block"] as Record<string, unknown>;

              if (block["type"] === "tool_use") {
                const tcIdx = toolCallCounter++;
                const state: BlockState = {
                  type: "tool_use",
                  toolCallIndex: tcIdx,
                  toolCallId: String(block["id"] ?? `call_${randomUUID()}`),
                  toolName: String(block["name"] ?? ""),
                };
                blocks.set(idx, state);

                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: modelId,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                          {
                            index: tcIdx,
                            id: state.toolCallId,
                            type: "function",
                            function: { name: state.toolName, arguments: "" },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                });
              } else {
                blocks.set(idx, { type: String(block["type"] ?? "text") });
              }
            } else if (evtType === "content_block_delta") {
              const idx = evt["index"] as number;
              const delta = evt["delta"] as Record<string, unknown>;
              const state = blocks.get(idx);

              if (delta["type"] === "text_delta") {
                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: modelId,
                  choices: [
                    {
                      index: 0,
                      delta: { content: String(delta["text"] ?? "") },
                      finish_reason: null,
                    },
                  ],
                });
              } else if (
                delta["type"] === "input_json_delta" &&
                state?.type === "tool_use"
              ) {
                send({
                  id,
                  object: "chat.completion.chunk",
                  created,
                  model: modelId,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: state.toolCallIndex!,
                            function: {
                              arguments: String(delta["partial_json"] ?? ""),
                            },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                });
              }
            } else if (evtType === "message_delta") {
              const delta = evt["delta"] as Record<string, unknown>;
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: {},
                    finish_reason: toFinishReason(
                      delta["stop_reason"] as string | null,
                    ),
                  },
                ],
              });
            } else if (evtType === "error") {
              const err = evt["error"] as Record<string, unknown> | undefined;
              provider.onError();
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: modelId,
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: `\n[Error: ${err?.["message"] ?? "upstream error"}]`,
                    },
                    finish_reason: "stop",
                  },
                ],
              });
            }
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

/* ──────────────────────────── provider class ────────────────────────────── */

export class ClaudeCodeApiProvider extends BaseProvider {
  readonly id = "claude-code-api";
  readonly name = "Claude Code (OAuth API)";

  get baseUrl(): string {
    return "https://api.anthropic.com";
  }

  get models(): ModelObject[] {
    if (!this.hasCredentials()) return [];

    const raw = process.env["CLAUDE_CODE_MODELS"]?.trim();
    const variants = raw
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : Object.keys(MODEL_MAP);

    return variants.map((v) => ({
      id: `claude-code-api/${v}`,
      object: "model" as const,
      created: 1700000000,
      owned_by: "anthropic-oauth",
      provider: "claude-code-api",
    }));
  }

  private hasCredentials(): boolean {
    return readCredentialsFile() !== null;
  }

  protected getApiKeys(): string[] {
    const shouldSteal = process.env["STEAL_ANTHROPIC_API_BY_CLAUDE_CODE"];
    if (!shouldSteal) return [];
    return this.hasCredentials() ? ["claude-code-oauth"] : [];
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const picked = this.pickKey();
    if (!picked) {
      throw new Error(
        `Provider ${this.name} is not available (no Claude Code credentials found at ${CREDENTIALS_PATH})`,
      );
    }

    this.stats.totalRequests++;
    this.stats.lastUsedAt = new Date().toISOString();
    this.rateLimiter.recordRequest(picked.trackingId);

    const token = await getAccessToken();
    if (!token) {
      this.onError();
      throw new Error(
        `${this.name}: could not obtain OAuth token — run "claude" inside the container to login`,
      );
    }

    const variant = request.model.replace(/^claude-code-api\//, "");
    const modelId = MODEL_MAP[variant] ?? variant;

    const anthropicReq = buildAnthropicRequest(request, modelId);

    const upstream = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(anthropicReq),
    });

    if (upstream.status === 429) {
      const retryAfter = Number(upstream.headers.get("retry-after") ?? 60);
      this.onRateLimit(upstream, retryAfter);
      // Return a proper 429 to the caller
      const response = new Response(
        JSON.stringify({
          error: {
            message: "Rate limited by Anthropic",
            type: "rate_limit_error",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
      this.attachResponseToKey(response, picked.trackingId);
      return response;
    }

    if (!upstream.ok) {
      this.onError();
      const errBody = await upstream.text();
      throw new Error(
        `Anthropic API error ${upstream.status}: ${errBody.slice(0, 200)}`,
      );
    }

    let response: Response;

    if (request.stream) {
      response = buildSseResponse(upstream, `claude-code-api/${variant}`, this);
    } else {
      const body = (await upstream.json()) as AnthropicResponseBody;
      const openAiBody = buildOpenAIResponse(
        body,
        `claude-code-api/${variant}`,
      );
      response = new Response(JSON.stringify(openAiBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      this.stats.successRequests++;
    }

    this.attachResponseToKey(response, picked.trackingId);
    return response;
  }
}
