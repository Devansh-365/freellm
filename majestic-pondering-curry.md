# Plan: Add `claude-code` Provider to FreeLLM

## Context

FreeLLM is an OpenAI-compatible gateway shipped via Docker. Goal: expose Claude Code as `model: "claude-code/<variant>"` so any OpenAI client can drive Claude Code via FreeLLM, using the user's existing Claude Pro/Max OAuth credentials (no Anthropic API key).

User's snippet (Express wrapper running `exec(claude "${prompt}")`) is shell-injection-prone, single-shot, no streaming, and bypasses FreeLLM's `BaseProvider` (rotation, circuit breaker, privacy posture). We replace it with a proper provider.

### Constraints (user-directed)

1. FreeLLM only runs in Docker. No bare-metal path.
2. No Anthropic API key — must auth via Claude Code OAuth (`claude login`).
3. Zero-config defaults — no required env vars.
4. Claude must behave as a **pure LLM generator**: no tool execution (Read / Bash / Edit / etc.), no permission prompts.
5. Multi-turn handled stateless — every request flattens full message history into a single prompt.

### Strategy

Use `@anthropic-ai/claude-code` SDK _inside_ the freellm container. Bind-mount the host's `~/.claude` directory so the SDK reads the user's existing OAuth credentials. The SDK calls `api.anthropic.com` directly — no host bridge, no extra port, no additional process.

Tools are disabled at SDK level (`allowedTools: []` + `permissionMode: "plan"` + `maxTurns: 1`), giving guaranteed text-only generation.

Verified via Context7: `@anthropic-ai/claude-code` SDK authenticates via `claude login` OAuth tokens; no API key required.

## Files

### New

- `packages/api-server/src/gateway/providers/claude-code.ts` — provider class.
- `packages/api-server/tests/claude-code-provider.test.ts` — unit tests (mocked SDK).

### Modified

- `packages/api-server/package.json` — add `@anthropic-ai/claude-code` to `dependencies`.
- `packages/api-server/src/gateway/registry.ts` — register `ClaudeCodeProvider`.
- `packages/api-server/src/gateway/privacy.ts` — `claude-code` entry.
- `docker-compose.yml` — bind-mount `${HOME}/.claude` and set `HOME=/home/appuser`.
- `docker-entrypoint.sh` — chown the mounted creds dir before `gosu`.
- `packages/website/src/content/docs/privacy.mdx` — mirror privacy entry (per `privacy.ts` header rule).

## Implementation

### 1. Provider — `packages/api-server/src/gateway/providers/claude-code.ts`

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import { BaseProvider } from "./base.js";
import type { ModelObject, ChatCompletionRequest } from "../types.js";

const CREDS_PATH = join(
  process.env["HOME"] ?? "/home/appuser",
  ".claude",
  ".credentials.json",
);
const DEFAULT_VARIANTS = ["sonnet", "opus", "haiku"];

const HAS_CREDS = (() => {
  try {
    return existsSync(CREDS_PATH);
  } catch {
    return false;
  }
})();

export class ClaudeCodeProvider extends BaseProvider {
  readonly id = "claude-code";
  readonly name = "Claude Code (host OAuth)";
  get baseUrl(): string {
    return "claude-code-sdk://";
  }

  get models(): ModelObject[] {
    if (!HAS_CREDS) return [];
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
    return HAS_CREDS ? ["claude-code"] : [];
  }

  async complete(request: ChatCompletionRequest): Promise<Response> {
    const picked = this.pickKey();
    if (!picked) throw new Error(`Provider ${this.name} is not configured`);
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
        includePartialMessages: true, // ↩ verify exact option name at impl-time against
        //   docs.claude.com/en/api/agent-sdk/typescript
      },
    });

    const response = request.stream
      ? buildSseResponse(iter, request.model)
      : await buildJsonResponse(iter, request.model);

    this.attachResponseToKey(response, picked.trackingId);
    return response;
  }
}
```

**Private helpers (same file)**:

- `flattenMessages(msgs)` — join role-tagged turns:

  ```
  [system]
  <content>

  [user]
  <content>

  [assistant]
  <content>

  [tool]
  <content>
  ```

  Document v1 limitation: incoming OpenAI `tool_calls` are flattened to text — claude won't act as an OpenAI tool executor.

- `buildJsonResponse(iter, modelId)` — drain iterable; for each `stream_event` delta, append `delta.text` to `content`; on `result`, capture finish reason and usage; return `new Response(JSON.stringify(openaiBody), { headers: { "content-type": "application/json" }})`.
- `buildSseResponse(iter, modelId)` — `new Response(readable, { headers: { "content-type": "text/event-stream" }})`. The `ReadableStream`:
  1. Iterates SDK messages.
  2. Emits OpenAI delta chunk for each text-delta event — `data: {"id":..., "object":"chat.completion.chunk", "choices":[{"index":0,"delta":{"content":"..."}, "finish_reason":null}]}\n\n`.
  3. On `result` / final message: emit final delta with `finish_reason` ("stop" or "length"), then `data: [DONE]\n\n`.
  4. On SDK throw / auth error: emit OpenAI error chunk, then `[DONE]`.

  Implementation-time verification: the exact SDK message type for incremental text (`stream_event` with `event.delta.type === "text_delta"`, vs. an `assistant` snapshot, vs. an AI-SDK-style `text-delta`) must be confirmed against the live `@anthropic-ai/claude-code` types. If `includePartialMessages` is unsupported, fall back to emitting one chunk per `assistant` snapshot (degrades streaming granularity but still works).

OpenAI chunk/response shape: existing types in `gateway/types.ts` — reuse.

**Error handling (uses existing `BaseProvider` hooks)**:

| SDK error                        | Action                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| `isAuthenticationError(e)`       | Throw 503; log "host needs `claude login`"; do NOT trip circuit breaker. |
| `isTimeoutError(e)`              | Throw 504;`onError()` (counts toward breaker).                           |
| Rate-limit `APICallError` (429)  | `onRateLimit(response, retryAfter)`; base class handles backoff.         |
| Other `APICallError` / SDK throw | `onError()`; stderr in `stats.lastError`.                                |

### 2. Registry wire-up

`gateway/registry.ts`:

```ts
import { ClaudeCodeProvider } from "./providers/claude-code.js";
// in constructor:
new ClaudeCodeProvider(),
```

### 3. Privacy entry

`gateway/privacy.ts`:

```ts
"claude-code": {
  policy: "local",
  source_url: "https://docs.claude.com/en/docs/claude-code/overview",
  last_verified: "2026-05-04",
  note: "Routes through user's host Claude Code OAuth credentials; uses user's own Claude subscription. No FreeLLM-managed key.",
},
```

Mirror to `packages/website/src/content/docs/privacy.mdx` (project rule documented in `privacy.ts` header).

### 4. Skip meta-routing

Do NOT append to `FAST_PRIORITY` / `SMART_PRIORITY` / `DEFAULT_MODELS` in `gateway/config.ts`. Latency-sensitive and tied to user's quota; opt-in only via explicit model id.

### 5. Streaming normalizer

Skip — provider emits OpenAI-shaped SSE directly.

### 6. `package.json` (api-server)

Add to `dependencies`:

```json
"@anthropic-ai/claude-code": "^2.1.89"
```

### 7. `docker-compose.yml`

In `freellm` service:

```yaml
environment:
  - HOME=/home/appuser
volumes:
  - freellm_data:/app/packages/api-server/data
  - ${HOME}/.claude:/home/appuser/.claude
```

### 8. `docker-entrypoint.sh`

Before dropping privileges via `gosu`:

```sh
if [ -d /home/appuser/.claude ]; then
  chown -R appuser:appgroup /home/appuser/.claude || true
fi
```

### 9. Tests — `packages/api-server/tests/claude-code-provider.test.ts`

Mock `query()` (via `vi.mock("@anthropic-ai/claude-code", ...)`) to return a scripted async iterable. Cases:

- **No creds**: `HAS_CREDS=false` (mock `existsSync`) → `models` empty, `getApiKeys()` empty, `isEnabled()` false.
- **Non-stream**: scripted iterable yields three `stream_event` deltas + a `result`; assert response JSON `choices[0].message.content === "abc"` and `finish_reason === "stop"`.
- **Stream**: assert SSE chunks parse as OpenAI deltas in order, terminal `[DONE]`.
- **Auth error**: scripted iterable throws an SDK auth error; assert 503 and helpful message.
- **flatten**: assert prompt string preserves role order and contents.

## Verification

1. `pnpm install` (picks up new dep).
2. `pnpm --filter @workspace/api-server test` — privacy exhaustiveness + new tests pass.
3. `docker compose build freellm && docker compose up freellm`.
4. `docker exec freellm ls -la /home/appuser/.claude/.credentials.json` — confirm bind-mount + ownership.
5. `curl http://localhost:3002/v1/models | jq '.data[] | select(.provider=="claude-code")'` — three ids visible.
6. Non-stream:

   ```
   curl -s :3002/v1/chat/completions -H 'content-type: application/json' \
     -d '{"model":"claude-code/sonnet","messages":[{"role":"user","content":"say hi"}]}' | jq
   ```

   Expected: `choices[0].message.content` is plain text, no tool annotations.

7. Stream:

   ```
   curl -N :3002/v1/chat/completions -H 'content-type: application/json' \
     -d '{"model":"claude-code/sonnet","stream":true,"messages":[{"role":"user","content":"count to 3"}]}'
   ```

   Expected: interleaved SSE deltas, terminal `[DONE]`.

8. Status: `curl :3002/v1/status | jq '.providers[] | select(.id=="claude-code")'` — enabled, counters increment, `policy=local`.
9. Negative path: `mv ~/.claude ~/.claude.bak` on host, `docker compose restart freellm`, confirm `claude-code/*` disappears from `/v1/models` (no crash). Restore.

## Out of scope / v1 limitations

- Incoming OpenAI `tool_calls` from clients are flattened to text — claude won't act as an OpenAI-style tool executor.
- Tool execution by claude is hard-disabled (`allowedTools: []`, `maxTurns: 1`). v2 could add an opt-in mode that re-enables tools and surfaces them in the response.
- Single sentinel key (no rotation).
- Concurrency: each request opens an independent SDK call; no pool/limit.
- Concurrent host + container access to `~/.claude` could race on session files. Low risk for stateless `query()`; document.
- Windows hosts: `${HOME}/.claude` mount works on macOS/Linux only. Document.
- Refresh-token rotation: SDK writes refreshed tokens back to mounted file; host `claude` may overwrite. Acceptable; both write the same shape.
