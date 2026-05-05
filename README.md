<div align="center">

# FreeLLM

![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![Version](https://img.shields.io/badge/version-v1.5.2-blue?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square&logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)
![Providers](https://img.shields.io/badge/Providers-8-blueviolet?style=flat-square)
![Models](https://img.shields.io/badge/Models-32+-orange?style=flat-square)
![Tests](https://img.shields.io/badge/tests-286%20passing-success?style=flat-square)

### You shouldn't need a credit card to call an LLM.

One endpoint. 8 providers. 32+ models. Zero dollars.

FreeLLM is an OpenAI-compatible gateway that routes across Groq, Gemini, Mistral, Cerebras, NVIDIA NIM, Cloudflare Workers AI, GitHub Models, and Ollama. When one rate-limits, the next one answers. You stop seeing 429s.

Stack 3 keys per provider and you get **~450 free requests per minute**. Including Llama 3.3 70B, Gemini 2.5 Pro, GPT-4o-mini, and DeepSeek R1.

Drop-in for any OpenAI SDK. Swap the base URL. Keep your code.

**[Website](https://freellms.vercel.app)** · **[Docs](https://freellms.vercel.app/introduction/)** · [Quickstart](#quickstart) · [Providers](#supported-providers) · [How it works](#how-it-works) · [Multi-tenant](#multi-tenant-virtual-sub-keys-and-per-user-limits) · [Browser tokens](#browser-safe-short-lived-tokens) · [API](#api-reference) · [Dashboard](#dashboard)

**If you've ever burned $20 testing prompts, [star the repo](https://github.com/Devansh-365/freellm). It helps other builders find it.**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/_0jAQr?referralCode=3z4ZBN&utm_medium=integration&utm_source=template&utm_campaign=generic) &nbsp; [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Devansh-365/freellm)

![FreeLLM Dashboard](docs/screenshots/dashboard-demo.gif)

</div>

## Why this exists

Every major provider has a free tier. Groq, Gemini, Mistral, Cerebras, NVIDIA, Cloudflare, GitHub Models. All of them.

But using them is painful.

Each one ships its own SDK. Each one has its own rate limits. Each one goes down at the worst possible time. So you end up writing provider-switching logic, handling 429s, and babysitting API keys across a stack of provider dashboards.

I built FreeLLM because I was tired of paying OpenAI $20 to test a prompt I'd run 30 times in an afternoon.

One line replaces all of that:

```bash
curl http://localhost:3000/v1/chat/completions \
  -d '{"model": "free-fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

The request goes to the fastest available provider. If that one is rate-limited or down, FreeLLM tries the next. You get a response. Every time.

## What you get

- **Drop-in OpenAI SDK.** Swap your base URL. Keep your code.
- **Automatic failover.** Groq rate-limited? Routes to Gemini, then Mistral, then Cerebras.
- **Three meta-models.** `free-fast` for speed, `free-smart` for reasoning, `free` for max availability.
- **Multi-key rotation.** Stack keys per provider for 3-4× the free RPM.
- **Response caching.** Identical prompts return in ~23ms with zero quota burn.
- **Token tracking.** Rolling 24h budget per provider, surfaced in the dashboard.
- **Circuit breakers.** Failing providers get sidelined and tested for recovery.
- **Real-time dashboard.** Provider health, request log, latency, cache hit rate.
- **Transparent routing.** Every response tells you which provider answered, and why.
- **Strict mode.** Opt in and refuse silent provider substitution.
- **Privacy routing.** Skip providers that train on free-tier prompts.
- **Virtual sub-keys.** Issue scoped keys with per-key request and token caps.
- **Per-user rate limits.** Safely expose the gateway to your app's end users.
- **Browser-safe tokens.** Short-lived HMAC-signed tokens for static sites, no auth backend needed.
- **Streaming tool calls that work.** Gemini and Ollama streaming tool_call bugs normalized at the gateway.
- **JSON mode across all providers.** `json_schema` works on NIM (translated to `guided_json` automatically), and truncated JSON responses carry a warning header so you don't discover the break at parse time.
- **Gemini reasoning handled for you.** Gemini 2.5 models burn most of your output budget on internal thinking by default. FreeLLM sets the right `reasoning_effort` per model so your `max_tokens` actually buys you output.
- **Zero cost.** Every provider runs on its free tier.

## Supported providers

| Provider | Models | Free tier (per key) |
|----------|--------|---------------------|
| **Groq** | Llama 3.3 70B, Llama 3.1 8B, Llama 4 Scout, Qwen3 32B | ~30 req/min |
| **Gemini** | Gemini 2.5 Flash, 2.5 Pro | ~15 req/min |
| **Mistral** | Mistral Small, Medium, Nemo | ~5 req/min |
| **Cerebras** | Llama 3.1 8B, Qwen3 235B, GPT-OSS 120B | ~30 req/min |
| **NVIDIA NIM** | Llama 3.3 70B, Llama 3.1 405B, Nemotron 70B, DeepSeek R1 | ~40 req/min |
| **Cloudflare Workers AI** | Llama 3.3 70B fp8-fast, Llama 3.2 3B, Mistral Small 3.1, DeepSeek R1 Distill, Qwen2.5 Coder | ~20 req/min |
| **GitHub Models** | GPT-4o-mini, GPT-4.1-mini, Llama 3.3 70B, Phi-4, Command R+, Mistral Large | ~15 req/min |
| **Ollama** | Any local model | Unlimited |
| **Claude Code** | claude-code/{haiku,sonnet,opus} | Claude subscription |
| **Claude Code API** | claude-code-api/{haiku,sonnet,opus} | Claude subscription |

Baseline: ~150 req/min combined. With 3 keys per provider: **~450 req/min. All $0.**

> Get free keys: [Groq](https://console.groq.com), [Gemini](https://aistudio.google.com), [Mistral](https://console.mistral.ai), [Cerebras](https://cloud.cerebras.ai), [NVIDIA NIM](https://build.nvidia.com), [Cloudflare Workers AI](https://dash.cloudflare.com), [GitHub Models](https://github.com/settings/tokens)

## Quickstart

**One-click deploy** (no terminal needed):

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/_0jAQr?referralCode=3z4ZBN&utm_medium=integration&utm_source=template&utm_campaign=generic) &nbsp; [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Devansh-365/freellm)

**Or run locally with Docker:**

```bash
docker run -d -p 3000:3000 \
  -e GROQ_API_KEY=gsk_... \
  -e GEMINI_API_KEY=AI... \
  ghcr.io/devansh-365/freellm:latest
```

**Or clone for local dev:**

```bash
git clone https://github.com/Devansh-365/freellm.git
cd freellm
cp .env.example .env   # add your keys
pnpm install && pnpm dev
```

API runs on `http://localhost:3000`. Dashboard on `http://localhost:5173`.

### Use it from anywhere

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="unused")
response = client.chat.completions.create(
    model="free-smart",
    messages=[{"role": "user", "content": "Explain quantum computing in one paragraph."}]
)
print(response.choices[0].message.content)
```

```typescript
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://localhost:3000/v1", apiKey: "unused" });
const response = await client.chat.completions.create({
  model: "free-fast",
  messages: [{ role: "user", content: "Hello!" }],
});
```

## How it works

### Meta-models

Don't pick a provider. Pick a strategy.

| Model | What it does | Use when |
|-------|--------------|----------|
| `free` | Rotates across all available providers | You want max uptime |
| `free-fast` | Lowest-latency provider first (Groq, Cerebras, Gemini, NIM) | You're building a chatbot or real-time UI |
| `free-smart` | Most capable provider first (Gemini, NIM, Groq, Mistral) | You need stronger reasoning or longer context |

Need a specific model? Target it directly: `groq/llama-3.3-70b-versatile`, `gemini/gemini-2.5-flash`, `nim/deepseek-ai/deepseek-r1`.

### Multi-key rotation (stack your free tiers)

Every provider env var accepts a comma-separated list. FreeLLM rotates round-robin, and each key gets its own rate-limit budget and cooldown.

```env
GROQ_API_KEY=gsk_key1,gsk_key2,gsk_key3,gsk_key4   # 4× the free RPM
```

When one key hits its window, FreeLLM silently uses the next. A 429 on `key1` only sidelines that key, not the whole provider. Per-key state is exposed via `GET /v1/status`.

Stack 3 keys across all 7 cloud providers and you get ~450 req/min of free inference. No other LLM gateway does this because they all assume you pay per token.

### Response caching

Identical prompts return in **~23ms with zero quota burn**. The cache keys on `(model, messages, temperature, max_tokens, top_p, stop)` via SHA-256, uses LRU eviction, and respects per-entry TTL (default 1 hour).

```
Call A (cold)             cached=false  latency=200ms  → Groq
Call B (same prompt)      cached=true   latency=23ms   ← cache
```

That's a 9× speedup on duplicate requests. During development you typically hammer the same prompt 10-20 times while iterating. That's now 10-20 free hits.

Configure in `.env`:

```env
CACHE_ENABLED=true
CACHE_TTL_MS=3600000     # 1 hour
CACHE_MAX_ENTRIES=1000
```

Streaming and error responses are never cached. Cached responses are marked with `x_freellm_cached: true`.

### Transparent routing and strict mode

Every response carries headers that tell you exactly how FreeLLM handled the request:

```
X-FreeLLM-Provider: groq
X-FreeLLM-Model: groq/llama-3.3-70b-versatile
X-FreeLLM-Requested-Model: free-fast
X-FreeLLM-Cached: false
X-FreeLLM-Route-Reason: meta
X-Request-Id: 4d6c9e1a-...
```

`Route-Reason` is one of `direct`, `meta`, `cache`, or `failover`. Every response, successful or not, carries a unique `X-Request-Id` that also appears in the server logs and the error body, so a single grep correlates everything.

If you want to refuse silent substitution, opt into strict mode:

```
X-FreeLLM-Strict: true
```

In strict mode meta-models are rejected (400), and concrete models are tried against exactly one provider. If that provider fails, the upstream error surfaces verbatim instead of failing over to a different one.

### Actionable 429s

When all providers are exhausted, the response body now tells you how to recover:

```json
{
  "error": {
    "type": "rate_limit_error",
    "code": "all_providers_exhausted",
    "retry_after_ms": 12000,
    "providers": [
      { "id": "groq",   "retry_after_ms": 12000, "keys_available": 0, "circuit_state": "closed" },
      { "id": "gemini", "retry_after_ms": 5000,  "keys_available": 0, "circuit_state": "closed" }
    ],
    "suggestions": [{ "model": "free-fast", "available_in_ms": 5000 }]
  }
}
```

The response also carries an HTTP `Retry-After` header in seconds so any standard client retries at the right time.

### Privacy and training-policy routing

Not every free tier treats your prompts the same way. Send `X-FreeLLM-Privacy: no-training` and the router will only consider providers that contractually exclude free-tier data from training:

| Provider              | Policy             |
|-----------------------|--------------------|
| Groq                  | no-training        |
| Cerebras              | no-training        |
| NVIDIA NIM            | no-training        |
| Cloudflare Workers AI | no-training        |
| GitHub Models         | no-training        |
| Ollama                | local              |
| Mistral               | configurable       |
| Gemini                | free-tier trains   |

If no configured provider can satisfy the posture for the model you asked for, you get a clean 400 `model_not_supported` up front. Catalog entries carry source URLs and `last_verified` dates; the server warns at boot for any entry older than 90 days.

### Multi-tenant: virtual sub-keys and per-user limits

Building a side project and want to safely expose the gateway to your visitors without giving everyone your master key? FreeLLM ships two independent mechanisms that compose:

**Virtual sub-keys.** Declare them in a JSON file:

```json
{
  "keys": [
    {
      "id": "sk-freellm-portfolio-abc123",
      "label": "My portfolio site",
      "dailyRequestCap": 500,
      "dailyTokenCap": 200000,
      "allowedModels": ["free-fast", "free"],
      "expiresAt": "2026-07-01T00:00:00Z"
    }
  ]
}
```

Point `FREELLM_VIRTUAL_KEYS_PATH` at the file, restart, and authenticate with `Authorization: Bearer sk-freellm-portfolio-abc123`. The gateway enforces the allowlist and caps before touching any upstream provider, and records usage only after a successful response so failed routes never burn quota. Caps are in-memory rolling 24h windows (soft cap, not a billing system; documented and logged at boot).

**Per-identifier rate limits.** Tag each request with `X-FreeLLM-Identifier: user-42` (anything matching `^[A-Za-z0-9_.:-]{1,128}$`) and each identifier gets its own sliding-window bucket, independent from the per-IP and per-provider limiters. One noisy user hitting their cap does not affect anyone else. Configure via `FREELLM_IDENTIFIER_LIMIT=<max>/<windowMs>` (default `60/60000`). Responses carry `X-FreeLLM-Identifier-Remaining` and `-Reset` so clients can self-throttle.

Missing identifier falls back to the client IP. Literal `"undefined"` and `"null"` strings are treated as missing. Tainted values are rejected with a clear 400 instead of landing in logs.

### Browser-safe short-lived tokens

Want to drop an AI chatbot into a static site without giving every visitor your master key? Mint a short-lived HMAC-signed token from a one-file serverless function and pass it straight to the browser. The token is bound to an origin, expires in 15 minutes, and counts against a per-identifier bucket so one noisy user cannot burn your quota.

```bash
# Backend: mint a token using your master key
curl https://your-gateway/v1/tokens/issue \
  -H "Authorization: Bearer $FREELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "https://yoursite.com",
    "identifier": "session-abc",
    "ttlSeconds": 900
  }'
# => { "token": "flt.eyJ2Ijox...", "expiresAt": "...", "origin": "...", "identifier": "..." }
```

```html
<!-- Browser: use the token directly with the official OpenAI SDK -->
<script type="module">
  import OpenAI from "https://esm.sh/openai@^4";
  const { token } = await fetch("/api/freellm-token").then((r) => r.json());
  const client = new OpenAI({
    baseURL: "https://your-gateway/v1",
    apiKey: token,
    dangerouslyAllowBrowser: true,
  });
  const stream = await client.chat.completions.create({
    model: "free-fast",
    messages: [{ role: "user", content: "Hi" }],
    stream: true,
  });
  for await (const chunk of stream) console.log(chunk.choices[0].delta.content ?? "");
</script>
```

Security model: max 15 minute TTL, origin-bound (browser Origin header verified on every request), per-identifier rate limiting ties into the existing bucket system, and `FREELLM_TOKEN_SECRET` must be at least 32 bytes or the gateway refuses to boot. Full walkthrough on the [Browser integration docs page](https://freellms.vercel.app/browser-integration/) and a runnable example in [`examples/browser-chatbot/`](examples/browser-chatbot/).

### Streaming tool calls that actually work

Gemini and Ollama both ship known bugs in their streaming tool_call output (Gemini drops the `index` field, Ollama flattens arguments outside the `function` wrapper). Every agent framework currently maintains its own workaround for these. FreeLLM fixes both at the gateway so the same stream works unchanged in the OpenAI SDK, Cline, Cursor, Aider, or anything else that expects OpenAI-spec SSE. Verified with real calls against live Gemini and reassembled by the real `openai` npm SDK.

### Gemini 2.5 reasoning models

Gemini 2.5 Flash and 2.5 Pro are reasoning models. Left to their own devices, they spend 90-98% of your `max_tokens` thinking internally before writing a single visible word. Ask for 1000 tokens of output and you'll get back 37.

FreeLLM fixes this per model. For 2.5 Flash, thinking is disabled entirely (`reasoning_effort: "none"`) so your full budget goes to the actual answer. For 2.5 Pro (which refuses to run without some thinking), reasoning is set to `"low"` so it thinks briefly and gives you the rest.

If you want the full reasoning power back, override it per request:

```bash
curl https://your-gateway/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini/gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Prove P != NP"}],
    "max_tokens": 4000,
    "reasoning_effort": "high"
  }'
```

With `"high"` and a larger budget (4000+), the model gets room for both thinking and output. The point is: you choose the trade-off, not Google's default.

### JSON mode across providers

FreeLLM accepts `response_format: { type: "json_object" }` and `{ type: "json_schema", json_schema: { schema: {...} } }` and forwards them to the upstream provider. Most providers support this natively. For NVIDIA NIM, which uses a proprietary `guided_json` parameter instead, FreeLLM translates the standard format automatically so you don't have to special-case your code per provider.

When a JSON-mode response hits `max_tokens` and the output is almost certainly broken (missing closing brackets, truncated strings), the response carries a `X-FreeLLM-Warning: json-possibly-truncated` header. You'll know the JSON is incomplete before you try to parse it.

### Claude Code providers (local Anthropic Claude)

FreeLLM ships two providers that use your [Claude Code](https://claude.ai/code) subscription — no separate API key needed.

#### `claude-code` — CLI / agentic loop

Spawns the `claude` CLI subprocess. Inherits the full agentic loop: multi-step reasoning, tool planning, and the same output the CLI delivers interactively.

Model IDs: `claude-code/haiku`, `claude-code/sonnet`, `claude-code/opus`

#### `claude-code-api` — Direct OAuth API

Uses the OAuth access token stored by the Claude Code CLI to call `api.anthropic.com/v1/messages` directly. Bypasses the CLI subprocess entirely — you get real per-token streaming, full OpenAI-spec tool use, and accurate token counts.

Model IDs: `claude-code-api/haiku`, `claude-code-api/sonnet`, `claude-code-api/opus`

#### Comparison

| | `claude-code` | `claude-code-api` |
|---|---|---|
| Mechanism | CLI subprocess | Direct Anthropic API |
| Streaming | Accumulated text diff | Per-token SSE |
| Tool use | CLI agentic loop | Full OpenAI-spec `tool_calls` |
| Token counts | Not available | Accurate |
| Requires login | Yes | Yes (same credentials) |

The `claude-code` provider activates automatically when the CLI is present. The `claude-code-api` provider is **opt-in** — it is disabled by default and requires an explicit env var because it uses OAuth credentials outside the intended CLI scope (see ToS notice below):

```env
STEAL_ANTHROPIC_API_BY_CLAUDE_CODE=yes
```

Both providers require the one-time login. Run it once after first start:

```bash
docker exec -it freellm claude
# Follow the interactive prompts. Credentials persist in the claude_data named volume.
```

To control which model variants are exposed by both providers, set in `.env`:

```env
CLAUDE_CODE_MODELS=haiku,sonnet   # default is haiku,sonnet,opus
```

> **⚠️ Terms of Service notice**
>
> The `claude-code-api` provider reads the OAuth access token stored by the Claude Code CLI and uses it to call `api.anthropic.com` directly. This is outside the intended use of the CLI and **may not be permitted by Anthropic's [Terms of Service](https://www.anthropic.com/legal/consumer-terms)**. Use it at your own discretion.
>
> The `claude-code` provider operates through the official CLI binary and is the safer choice from a ToS perspective.

### Securing your gateway

All optional. Leave empty for local dev.

| Variable | What it does |
|----------|--------------|
| `FREELLM_API_KEY` | Master key. Requires `Authorization: Bearer <key>` on every request. |
| `FREELLM_ADMIN_KEY` | Separate key for admin endpoints (circuit breaker reset, routing switch). |
| `FREELLM_VIRTUAL_KEYS_PATH` | Path to a JSON file declaring virtual sub-keys with per-key caps. |
| `FREELLM_IDENTIFIER_LIMIT` | Per-identifier rate limit, format `<max>/<windowMs>` (default `60/60000`). |
| `FREELLM_IDENTIFIER_MAX_BUCKETS` | Hard ceiling on distinct identifiers tracked (default `10000`). |
| `FREELLM_TOKEN_SECRET` | HMAC secret for browser tokens, minimum 32 bytes. Short = fatal boot failure. Unset = browser tokens disabled, rest of the gateway runs normally. |
| `STREAM_IDLE_TIMEOUT_MS` | Heartbeat cadence for SSE keep-alive comments (default `30000`). |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist. Required for browser-token-backed frontends. |

Dependency posture and trust details live on the dedicated website pages:

- **[Security and dependencies](https://freellms.vercel.app/security/)** — direct dep list, what is deliberately not in the codebase, image verification
- **[Privacy and training](https://freellms.vercel.app/privacy/)** — the full provider catalog with source links
- **[Benchmarks](https://freellms.vercel.app/benchmarks/)** — cold start and overhead numbers with methodology

## API reference

Fully OpenAI-compatible. Available at `/v1/...`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | Chat completion (streaming and non-streaming) |
| `GET` | `/v1/models` | List all available models + meta-models |
| `GET` | `/v1/status` | Provider states, per-key state, token usage, cache stats |
| `POST` | `/v1/status/providers/{id}/reset` | Force-reset a provider's circuit breaker |
| `PATCH` | `/v1/status/routing` | Switch between `round_robin` and `random` |

Every response includes observability headers so you know exactly how the request was handled:

- `X-FreeLLM-Provider`, `X-FreeLLM-Model`, `X-FreeLLM-Requested-Model`, `X-FreeLLM-Cached`, `X-FreeLLM-Route-Reason`
- `X-FreeLLM-Identifier`, `-Remaining`, `-Reset` when identifier rate limiting is in play
- `X-Request-Id` on every response, matching the id in logs and error bodies

Request-side headers you can opt into:

- `X-FreeLLM-Strict: true` refuses silent provider substitution
- `X-FreeLLM-Privacy: no-training` filters out providers that train on free-tier data
- `X-FreeLLM-Identifier: <id>` tags the request with a per-user bucket

## Dashboard

A built-in web UI for monitoring your gateway in real time. Provider health, cache hit rate, per-provider token usage, multi-key status, live request log, routing controls, and circuit breaker management.

![Models Page](docs/screenshots/models.png)

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
