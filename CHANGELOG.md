# Changelog

All notable changes to FreeLLM are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Dashboard sign-in** ([#2](https://github.com/Devansh-365/freellm/issues/2)).
  The dashboard now loads in a browser even when the gateway has
  `FREELLM_API_KEY`, `FREELLM_ADMIN_KEY` or virtual keys configured. When an
  API call needs a key, the dashboard shows a sign-in screen. Paste
  `FREELLM_ADMIN_KEY`, or `FREELLM_API_KEY` if no admin key is set. The key is
  kept in `sessionStorage`, or `localStorage` with "Remember on this device",
  and a Sign out button clears it. Open gateways behave exactly as before.

### Changed

- Auth and the per-identifier rate limit now apply only to `/v1/*` and
  `/api/*`. Dashboard static files and the SPA fallback are public. Health
  checks stay unauthenticated.
- Refreshed provider catalogs for models that providers have shut down:
  - Groq: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`,
    `llama-4-scout-17b-16e-instruct` and `qwen3-32b` replaced by
    `openai/gpt-oss-120b` (new default), `openai/gpt-oss-20b` and
    `qwen/qwen3.8-27b` (vision).
  - Cerebras: default is now `gpt-oss-120b`; `llama3.1-8b` and
    `qwen-3-235b-a22b-instruct-2507` replaced by `qwen-3.8-27b`.
  - Mistral: removed the retired `open-mistral-nemo`.
  - Cloudflare: `@cf/meta/llama-3.1-8b-instruct` replaced by its `-fast`
    variant.
- Upgraded `zod` to v4 and pinned patched versions of `body-parser`, `qs`,
  `proxy-addr` and `compression`. `pnpm audit` is clean again.

### Fixed

- **Meta-models now fail over when a provider rejects the model or key**
  ([#4](https://github.com/Devansh-365/freellm/issues/4)). Previously any
  upstream 400/401/403/404 was returned to the caller straight away, so a
  `free-fast` request failed with Groq's "model does not exist" error instead
  of moving on to Gemini. Now 401, 403, 404, and a 400 whose body says the
  model is missing or decommissioned exclude that provider and route to the
  next one. Other 400s are still returned as-is, and strict mode still never
  falls back. If every provider fails this way, the last upstream message is
  returned.

## [1.7.0] - 2026-05-17

Vision/multimodal routing. FreeLLM can now route requests that contain
image content to the correct vision-capable model automatically. Meta-models
(`free`, `free-smart`, `free-fast`) silently upgrade to a vision provider
when images are present. Direct model requests with image content get a
clear error instead of a cryptic upstream 400.

### Added

#### Vision routing for image inputs

Any OpenAI-compatible image request (a `content` array containing an
`image_url` part) is now handled correctly:

**Meta-model requests** (`free`, `free-smart`, `free-fast`) — the router
detects image content, filters the provider pool to those with at least one
vision-capable model, then picks the first vision model from the winning
provider (models array is ordered best-first, so this naturally selects the
highest-capability vision model per provider).

**Direct model requests** — if the named model does not carry
`supportsVision: true`, the gateway fails fast with a 400 before making any
upstream call:

```json
{
  "error": {
    "code": "model_not_supported",
    "message": "Model \"groq/llama-3.3-70b-versatile\" does not support vision/image inputs. Use a vision-capable model or a meta-model (free, free-smart, free-fast)."
  }
}
```

#### `supportsVision` capability flag on `ModelObject`

New optional field `supportsVision?: boolean` on the `ModelObject` type.
Absent means false (text-only). Set to `true` on every model verified as
vision-capable against live provider documentation:

| Model | Provider |
|---|---|
| `groq/meta-llama/llama-4-scout-17b-16e-instruct` | Groq |
| `gemini/gemini-2.5-flash` | Gemini |
| `gemini/gemini-2.5-pro` | Gemini |
| `github/meta/Llama-3.2-11B-Vision-Instruct` | GitHub Models |
| `github/openai/gpt-4o-mini` | GitHub Models |
| `github/openai/gpt-4.1-mini` | GitHub Models |
| `cloudflare/@cf/mistral/mistral-small-3.1-24b-instruct` | Cloudflare |

Groq Llama 4 Scout is the first Groq model to support vision.
All Gemini 2.5 models are natively multimodal.
GitHub Models ships three vision-capable models across two model families.
Cloudflare's Mistral Small 3.1 gained vision in its March 2026 update.

#### Ollama vision auto-detection

Since Ollama models are user-configured via `OLLAMA_MODELS`, vision
capability cannot be known at compile time. The Ollama provider now
auto-detects vision models from the model name using well-known patterns:
`llava`, `vision`, `bakllava`, `moondream`, `cogvlm`, `minicpm-v`.
Models matching any pattern get `supportsVision: true` automatically.
Covers LLaVA, BakLLaVA, Moondream, CogVLM, MiniCPM-V, and any
community model with "vision" in its name.

#### Vision bypass in the response cache

Vision requests are never cached. Image payloads are large, repeat rate
is near zero, and caching base64-encoded images would fill the LRU store
in seconds. The cache self-guards in both `get()` and `set()` (matching
the existing streaming bypass pattern), and the router also skips the
cache lookup explicitly before the routing loop.

### Changed

- `pickProvider()` in `GatewayRouter` now accepts a `requiresVision`
  parameter that excludes any provider with no vision-capable models
  from the candidate set, parallel to the existing `requiresTools`
  exclusion for Cerebras.
- `resolveModelForProvider()` now accepts `requiresVision` and, for
  meta-model requests, returns the first `supportsVision` model from
  the winning provider instead of the default text model.

### Tests

313 passing across 27 files (up from 295 across 26 files):

- `tests/vision.test.ts` (new): 18 tests covering `hasImageContent()`
  detection (text-only false, image_url true, multi-turn, null content),
  cache bypass (get/set both skip for vision, text still cached), router
  fail-fast (non-vision model + image → 400, no provider call), meta-model
  vision routing (cerebras excluded, gemini selected; first vision model
  chosen from mixed-model provider), and Ollama heuristics (llava, vision,
  moondream all detected; llama3/mistral not; mixed list correct).

[1.7.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.7.0

---

## [1.6.0] - 2026-05-14

Fixes two production bugs (streaming token tracking and Cerebras crashing
on tool-calling requests), adds a JSON schema validation warning header so
callers know immediately when a structured-output response is malformed, and
refactors the gateway's observability internals for better testability.

### Fixed

#### Streaming token usage now recorded against virtual key caps

When a virtual key carried a `dailyTokenCap`, streaming responses always
recorded 0 tokens against the cap, making it possible to exhaust real
provider quota without ever hitting the soft limit. The gateway now injects
`stream_options: { include_usage: true }` on the upstream request when a
token-capped virtual key is active, captures the usage chunk emitted at
the end of the SSE stream, and records the real token count. The dashboard
`usageTracker` also receives the real counts, so the per-provider token
totals are accurate for streaming workloads.

Per-provider `supportsStreamUsage` flags gate whether the injected option
is sent, so providers that reject the field are never affected.

#### Cerebras no longer crashes tool-calling requests

Cerebras does not support the `tools` / `tool_choice` fields and returns
400 when they are present. Any `free-smart` or `free-fast` request that
included tools could land on Cerebras, triggering a 3-retry cascade and
ultimately a 502 to callers. The Vercel AI SDK reported this as
`AI_RetryError: Failed after 3 attempts. Last error: Provider cerebras returned 400`.

A new `supportsTools: boolean` capability on `ProviderAdapter` (default
`true` in `BaseProvider`) lets providers opt out. `CerebrasProvider` sets
it to `false`. The router's `pickProvider` now adds any provider with
`supportsTools = false` to the effective exclusion set whenever the request
carries one or more tools. The exclusion applies to both meta-model routing
(`free`, `free-fast`, `free-smart`) and direct-model routing before the
first attempt is ever made, so no retry or failover is needed.

### Added

#### JSON schema validation warning header

When a request uses `response_format: { type: "json_schema" }` and the
upstream response content fails structural validation against the requested
schema, the response now carries:

```
X-FreeLLM-Warning: schema-validation-failed
```

The validation is lightweight and dependency-free:
- Parses the response content as JSON; failure → warning
- If `schema.type === "object"`, verifies the parsed value is a plain
  object (not an array or scalar); failure → warning
- If `schema.required` is an array, verifies every required key is present
  at the top level; missing key → warning

The header is additive. Both warnings can appear together:

```
X-FreeLLM-Warning: json-possibly-truncated, schema-validation-failed
```

`json_object` mode has no schema to validate against and is unaffected.
`json_schema` responses are also never served from the response cache
(cache now skips both storage and retrieval for this format) because
schema-validation annotations depend on fresh upstream content.

All JSON-mode logic — the NIM `nvext.guided_json` translation, the
truncation warning, and the new schema validation — is consolidated in a
new `src/gateway/json-mode.ts` module. Previously these concerns were split
between `NimProvider.mapRequest`, an inline check in the chat route, and
nothing (schema validation did not exist).

#### `FlushResult` structured return from `StreamingPipeline.flush()`

`StreamingPipeline.flush()` previously returned a plain `string` and
exposed usage as a side-effect property (`lastUsage`). It now returns
`{ output: string; usage?: StreamUsage }`, making the usage handoff
explicit and removing the informal property access that coupled the chat
route to internal pipeline state.

### Changed

#### ObservabilityStore extracted from GatewayRouter

`RequestLog`, `UsageTracker`, and `ResponseCache` now live in a single
`ObservabilityStore` class that `GatewayRouter` accepts as a constructor
argument. `GatewayRouter` retains its existing public properties as
delegates so all call sites are unchanged. The factory in `create.ts`
creates the store and exposes it directly on the `Gateway` object,
making it easy to inject fakes in tests without constructing a full
router.

### Tests

295 passing across 26 files (up from 286 across 24 files):

- `tests/streaming-virtual-keys.test.ts` (new): 3 integration tests
  verifying that `stream_options.include_usage` is injected for token-capped
  virtual keys, that the recorded token count matches real usage (15 = 10+5),
  and that no injection occurs for keys without a token cap.
- `tests/json-schema-validation.test.ts` (new): 6 integration tests
  covering valid response (no warning), missing required field, invalid JSON,
  wrong top-level type, `json_object` mode (no schema, no warning), and the
  combined truncation + validation warning case.
- `tests/json-truncation.test.ts`: updated the `json_schema + finish_reason=length`
  assertion from `toBe` to `toContain`; schema validation now correctly also
  fires when truncated content is unparseable, and both warnings are legitimate.

[1.6.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.6.0

---

## [1.5.2] - 2026-04-13

Adds two new providers: Cloudflare Workers AI and GitHub Models. Both
pass the `no-training` privacy filter, both support OpenAI Chat
Completions natively, and both work with the existing multi-key
rotation. No breaking changes.

### Added

#### Cloudflare Workers AI provider

New `cloudflare` provider with six starter models: Llama 3.3 70B
(fp8-fast variant), Llama 3.2 3B, Llama 3.1 8B, Mistral Small 3.1 24B,
DeepSeek R1 Distill Qwen 32B, and Qwen 2.5 Coder 32B. All model ids
retain their Cloudflare-native `@cf/...` prefix after the gateway
strips its own `cloudflare/` slug.

Two env vars required:

```
CLOUDFLARE_ACCOUNT_ID=abc123...
CLOUDFLARE_API_KEY=comma,separated,tokens
```

The account id is part of the request URL, so the provider's `baseUrl`
is a getter that reads it per-request. If either env var is missing,
the provider is fully disabled and never fires against a broken URL.
Rate limit seed: 20 RPM per key (conservative; Cloudflare itself rations
by 10k Neurons/day and returns 429 which our normal cooldown honors).

Privacy policy: `no-training`, sourced from
`developers.cloudflare.com/workers-ai/privacy`.

#### GitHub Models provider

New `github` provider with seven starter models across tiers:

- `github/openai/gpt-4o-mini`
- `github/openai/gpt-4.1-mini`
- `github/meta/Meta-Llama-3.3-70B-Instruct`
- `github/meta/Llama-3.2-11B-Vision-Instruct`
- `github/microsoft/Phi-4`
- `github/cohere/Command-R-plus-08-2024`
- `github/mistral-ai/Mistral-Large-2411`

This is the first FreeLLM provider that ships OpenAI GPT-class models
on a free tier.

Single env var, distinct from the common `GITHUB_TOKEN` shell variable
to avoid collisions:

```
GITHUB_MODELS_API_KEY=ghp_token1,ghp_token2
```

Works with classic PATs (no scope needed for public models) and
fine-grained PATs (requires `Models: read` permission). Free tier is
15 RPM / 150 RPD on low-tier models and 10 RPM / 50 RPD on high-tier
(GPT-class). Rate limiter is set to 14 RPM per key; the daily cap is
enforced by GitHub returning 429 which triggers the existing
cooldown path.

Privacy policy: `no-training`, sourced from
`docs.github.com/en/github-models/responsible-use-of-github-models`.

### Changed

- `FAST_PRIORITY` and `SMART_PRIORITY` in `config.ts` now include
  `cloudflare` and `github` in their rotation order. Meta-models
  (`free`, `free-fast`, `free-smart`) transparently include the new
  providers when their keys are configured.
- Test env-cleanup loops in six e2e test files now delete
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, and
  `GITHUB_MODELS_API_KEY` at boot so a developer running the suite
  with those env vars set locally does not accidentally enable the
  providers inside the test app.

### Tests

286 passing across 24 files (up from 262):

- `cloudflare-provider.test.ts`: 11 tests covering the `baseUrl`
  getter behavior, `getApiKeys()` requiring BOTH env vars, comma
  parsing, `mapRequest` preservation of `@cf/...` paths, and the
  six-model catalog shape.
- `github-models-provider.test.ts`: 13 tests covering
  `GITHUB_MODELS_API_KEY` parsing, a regression guard that confirms
  we never read `GITHUB_TOKEN` or `GITHUB_API_KEY`, the fixed
  `baseUrl`, `mapRequest` prefix stripping, and the seven-model
  catalog shape.
- `privacy.test.ts`: `EXPECTED_IDS` extended to assert both new
  providers have privacy catalog entries.

### Configuration

New env vars documented in `.env.example`:

| Variable | Required | What it does |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | With key | Your Cloudflare account id. Part of the request URL. Provider disabled if missing. |
| `CLOUDFLARE_API_KEY` | With account id | API token(s) with Workers AI: Read. Comma-separated for multi-key rotation. |
| `GITHUB_MODELS_API_KEY` | Optional | GitHub PAT(s). Comma-separated for multi-key rotation. Distinct from `GITHUB_TOKEN` by design. |

Verified at runtime: booted the gateway, hit `/v1/status`, both
providers appear with `enabled: false` (no keys in test env), correct
catalog sizes, and `no-training` policy stamped with `2026-04-13`.

[1.5.2]: https://github.com/Devansh-365/freellm/releases/tag/v1.5.2

---

## [1.5.1] - 2026-04-12

Fixes a user-reported bug where Gemini 2.5 Flash returned ~30 tokens
regardless of how high max_tokens was set, hardens the response cache
against poisoning by truncated responses, and adds JSON mode
reliability improvements for NVIDIA NIM and all providers.

### Fixed

#### Gemini 2.5 reasoning budget no longer eats max_tokens

Gemini 2.5 Flash and 2.5 Pro are reasoning models. With their default
thinking budget they burned 90-98% of max_tokens on internal reasoning
before producing visible text. A caller asking for max_tokens=1000
routinely got back 30-40 tokens with finish_reason=length.

The Gemini provider adapter now injects a per-model default
`reasoning_effort` when the caller does not set one:

- gemini-2.5-flash defaults to `"none"` (accepts zero thinking budget,
  returns the full requested output)
- gemini-2.5-pro defaults to `"low"` (the minimum Google accepts for
  this model, which requires a non-zero thinking budget)

Clients that want full reasoning can pass `reasoning_effort: "high"`
explicitly. The adapter also normalizes the output budget onto
`max_completion_tokens` only and deletes `max_tokens` from the
outgoing request, because Gemini returns 400 when both are present.

Verified against the live Gemini API: the same prompt that produced
37 tokens before now returns 670+ tokens with finish_reason=stop.

#### Deprecated Gemini 2.0 models removed from catalog

gemini-2.0-flash and gemini-2.0-flash-lite both returned 404 "no
longer available to new users" from the live API. Removed from the
model list so callers cannot pick a dead model.

#### Response cache no longer stores truncated responses

When any choice in the upstream response carries
finish_reason=length, the cache now refuses to store it. Previously
a single truncated response from a reasoning model would pin the
bad answer for the entire TTL window (default 1 hour), causing the
"sometimes fails" pattern the user reported.

#### Cache key expanded to prevent cross-shape collisions

The cache key now includes tools, tool_choice, parallel_tool_calls,
response_format, reasoning_effort, seed, max_completion_tokens,
presence_penalty, and frequency_penalty. Previously two requests
with the same prompt but different tool definitions or response
formats would share a cache entry.

### Added

#### NVIDIA NIM json_schema translation

NIM's OpenAI-compat endpoint does not support
`response_format: { type: "json_schema" }`. It requires the schema
in a vendor-specific `nvext.guided_json` field. The NIM provider
adapter now translates the standard parameter into the NIM-native
format automatically and removes the unsupported `response_format`
field from the outgoing request. json_object mode and requests
without response_format pass through untouched.

#### JSON truncation warning header

When a JSON-mode request (json_object or json_schema) hits
max_tokens and the output is almost certainly broken mid-token,
the response now carries:

```
X-FreeLLM-Warning: json-possibly-truncated
```

The caller knows immediately that the JSON is likely incomplete
without needing to attempt a parse.

#### reasoning_effort accepted in the request schema

The Zod schema now accepts `reasoning_effort: "none" | "low" |
"medium" | "high"` so clients can override the per-model default.
Matches Gemini's OpenAI-compat knob and OpenAI's o-series
reasoning parameter.

#### finish_reason surfaced in the request log

The request log entry now carries a `finishReason` field populated
from the upstream response. When the reason is "length" the router
also emits a pino warning tagged with provider, model, max_tokens,
and reasoning_effort so operators can see which requests hit the
token cap.

### Configuration

New environment variable:

| Variable | Default | What it does |
|---|---|---|
| `reasoning_effort` (request field) | Per-model | `"none"` for gemini-2.5-flash, `"low"` for gemini-2.5-pro. Clients can override per request. |

### Tests

262 passing across 22 files (up from 215 at v1.5.0):

- `gemini-provider.test.ts` 14 tests for per-model defaults, mapRequest
  normalization, and catalog verification
- `cache.test.ts` 17 tests for isCacheable, truncation skip, and key
  discrimination across all request shape fields
- `nim-provider.test.ts` 6 tests for json_schema-to-nvext translation,
  passthrough, and field preservation
- `json-truncation.test.ts` 4 e2e tests for the warning header
- `schema-tools.test.ts` 2 new tests for reasoning_effort
- `router.test.ts` 4 new tests for finish_reason handling and
  cache anti-poisoning

[1.5.1]: https://github.com/Devansh-365/freellm/releases/tag/v1.5.1

---

## [1.5.0] - 2026-04-09

The browser-safe release. FreeLLM can now be safely exposed to an app's
end users via short-lived HMAC-signed tokens that are bound to an origin
and an identifier. Streaming tool calls from Gemini and Ollama are fixed
at the gateway, the Zod schema finally accepts the full OpenAI request
shape, the dashboard surfaces the new trust layer, and every layer was
verified end-to-end with the real openai npm SDK hitting real provider
APIs.

### Added

#### Browser-safe short-lived tokens

Operators can now mint stateless HMAC-signed bearer tokens that are
safe to ship to a browser. Integration pattern: a one-file serverless
function calls `POST /v1/tokens/issue` with the master or virtual key,
returns the minted token to the browser, and the browser uses the
token directly with any OpenAI SDK. No auth backend, no session
store, no database.

- New module `src/gateway/browser-token.ts` with pure `signBrowserToken`
  and `verifyBrowserToken` helpers. HMAC-SHA256 over a JSON payload,
  constant-time signature comparison, base64url encoding.
- Token format: `flt.<base64url(payload)>.<hex(hmac)>`.
- Payload v1 carries `v`, `iat`, `exp`, `origin`, and optional
  `identifier` and `vk` (virtual key id).
- Max TTL 900 seconds (15 minutes), clamped at issue time.
- Origin is embedded in the token and compared against the browser's
  `Origin` header on every verify. Mismatch = reject.
- `FREELLM_TOKEN_SECRET` must be at least 32 bytes. Enforced both at
  boot and on every sign/verify operation. A short secret is a
  fatal boot failure so no path can produce a weak token.
- Constant-time signature comparison via `timingSafeEqual`.
- Secret rotation immediately invalidates all outstanding tokens
  (intentional kill switch for compromised deployments).

#### `POST /v1/tokens/issue` endpoint

Admin-auth-equivalent mint endpoint that any existing master key,
admin key, or virtual key can call. Browser tokens themselves cannot
mint new browser tokens (chain guard). When a virtual key is the
issuer, the resulting token inherits its id so the existing Phase 2
cap enforcement flows through untouched.

```bash
curl https://your-gateway/v1/tokens/issue \
  -H "Authorization: Bearer $FREELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "origin": "https://yoursite.com",
    "identifier": "session-abc",
    "ttlSeconds": 900
  }'

# Response:
# {
#   "token": "flt.eyJ2IjoxLCJpYXQiOi...",
#   "expiresAt": "2026-04-09T07:15:00.000Z",
#   "origin": "https://yoursite.com",
#   "identifier": "session-abc"
# }
```

Origin must be `https://*` or `http://localhost[:port]`. Identifier
must match `^[A-Za-z0-9_.:-]{1,128}$`, same pattern as the per-user
rate limiter. TTL clamped to `[1, 900]` seconds.

#### Browser token authentication

The auth middleware now recognizes `flt.*` bearers alongside the
master key, admin key, and virtual keys. Verification checks the
signature, expiry, and Origin header atomically. On success:

- `req.browserToken` carries the verified payload
- `req.virtualKey` is hydrated if the token carries a virtual key id
- The token's identifier is copied into `X-FreeLLM-Identifier` so the
  existing per-user rate limiter picks it up with zero extra code
- All other middleware (privacy routing, strict mode, streaming
  normalizer, cap enforcement) works unchanged

On failure the middleware returns 401 `invalid_api_key` with the
specific rejection reason in the message (origin_mismatch, expired,
bad_signature, etc.).

#### Streaming tool_call normalization

Every chat completion stream now flows through a per-provider
normalizer that sits between the upstream fetch and the downstream
response. Fixes three widely-reported bugs without touching the
upstreams or the clients:

- **Gemini** `index` field missing on streaming tool_call deltas: the
  normalizer assigns an index per function name so argument fragments
  across chunks land on the same logical tool call, and stamps
  `type: "function"` where it's missing. Multi-tool parallel calls
  get distinct indices tracked by name.
- **Ollama** flat-argument hoisting: Ollama sometimes emits
  `arguments` at the top level of a tool_call rather than inside
  `function`. The normalizer hoists it into the expected shape and
  reuses the last-seen index for subsequent fragments.
- **Malformed chunk resilience**: every transform is wrapped in
  try/catch so one bad byte from upstream logs a warning and forwards
  the original event verbatim instead of crashing the whole response.

New module tree under `src/gateway/streaming/`:

- `sse.ts` tolerant SSE parser and serializer, handles CRLF, partial
  chunks, `[DONE]`, and comment heartbeats.
- `types.ts` minimal OpenAI chunk shape plus `Normalizer` interface.
- `normalizer.ts` per-provider dispatcher with passthrough default.
- `passthrough.ts` no-op for Groq, Cerebras, NIM, and Mistral.
- `gemini.ts` and `ollama.ts` provider-specific fixes.
- `pipeline.ts` ties parser, dispatcher, and serializer together with
  defensive try/catch at every stage.

Heartbeat comment `\n: keep-alive\n\n` is written every
`STREAM_IDLE_TIMEOUT_MS` (default 30s) so proxies on the path like
Railway and Cloudflare do not drop slow streams. Client disconnect
is detected via `res.on('close')` and cancels the upstream reader
so we do not burn provider quota into a dead socket.

#### Full OpenAI request shape accepted

The Zod schema and matching TypeScript types now accept the full
OpenAI Chat Completions surface, including:

- `tools` array with nested `function` definition, name, description,
  parameters, and strict flag
- `tool_choice` as `"none" | "auto" | "required"` or a specific
  function reference
- `parallel_tool_calls`
- `response_format` text / json_object / json_schema envelope
- `stream_options.include_usage` for per-chunk usage accounting
- `max_completion_tokens` alongside `max_tokens`
- `presence_penalty` and `frequency_penalty` validated in `[-2, 2]`
- `seed` and `user` for observability
- `tool_call_id` on tool-role messages
- `tool_calls` array on assistant-role messages
- `developer` role (used by newer OpenAI models)

Strict mode is preserved so genuinely unknown fields still throw.
Only the known OpenAI surface is accepted.

Caught while verifying the streaming normalizer with a real openai
npm SDK client: the previous schema rejected every tool-calling
request with 400 before it ever reached the streaming pipeline, so
the normalizer was unreachable in practice for the exact audience it
was built for. Fixed and regression-tested against the shapes the
real SDK sends.

#### Dashboard v1.5 surface

- **Provider cards** carry a color-coded Trust badge:
  `NO-TRAIN` (emerald), `LOCAL` (sky), `CONFIG` (amber), or
  `TRAINS` (rose). Click opens the provider's actual terms of service
  URL in a new tab; hover shows the last-verified date.
- **Virtual Keys panel** on the main dashboard page lists every
  loaded virtual sub-key with per-key progress bars for daily request
  cap and daily token cap (rose tint when usage crosses 90%), allowed
  models surfaced as monospace badges, expired keys flagged, and a
  persistent amber reminder that caps are soft.
- **Browser Tokens card** shows a live enabled/disabled status with
  an emerald pulsing dot when `FREELLM_TOKEN_SECRET` is set, max TTL
  and min secret length visible at a glance, a link out to the
  `/browser-integration` docs page, and an amber callout on the
  disabled state telling operators exactly which env var to set.
- `GET /v1/status` response grew a new `browserTokens` field
  `{ enabled, minSecretBytes, maxTtlSeconds }` plus a `privacy` block
  on every `ProviderStatus` sourced from the `PROVIDER_PRIVACY`
  catalog.
- New admin-only endpoint `GET /v1/status/virtual-keys` returns a
  masked inventory of loaded virtual sub-keys (first 12 chars plus
  last 4) with cap limits, remaining usage, allowed models, expiry,
  and a `softCapWarning` string reminding the caller that counters
  reset on restart.

#### Browser integration docs and runnable example

- `packages/website/src/content/docs/browser-integration.mdx` walks
  through the full flow: mint from a Node or Flask backend, use the
  token in the browser via the official openai SDK (with
  `dangerouslyAllowBrowser: true`), handle expiry, verify origin
  binding, secret rotation, common pitfalls.
- New **Integration** sidebar group on the Starlight website. 17
  pages total, up from 16.
- `examples/browser-chatbot/` copy-paste runnable demo: 108-line
  self-contained HTML chatbot using the openai npm package via
  `esm.sh`, a 37-line Vercel serverless function that mints tokens
  server-side from env vars, and a 58-line README covering setup,
  local development, Vercel deploy, and security notes. No
  frameworks, no build step.

### Changed

- `auth` middleware now accepts `FREELLM_ADMIN_KEY` as a valid base
  credential alongside the master key and virtual keys, so the
  `admin_required` 403 path is actually reachable when an operator
  runs with a distinct admin token. Previously the admin-only routes
  were unreachable without also setting `FREELLM_API_KEY`.
- `ProviderStatusInfo` gained an optional `privacy` block populated
  from the `PROVIDER_PRIVACY` catalog with `policy`, `sourceUrl`, and
  `lastVerified` fields.
- `GatewayStatus` gained a `browserTokens` block surfacing the boot
  state of the feature.

### Configuration

New environment variables:

| Variable | Default | What it does |
|---|---|---|
| `FREELLM_TOKEN_SECRET` | unset | HMAC secret for browser tokens, minimum 32 bytes. Short = fatal boot failure. Unset = browser tokens disabled, the rest of the gateway runs unchanged. |
| `STREAM_IDLE_TIMEOUT_MS` | `30000` | Heartbeat cadence for the SSE keep-alive comment. |

Previously shipped in v1.4.0 and still supported:
`FREELLM_IDENTIFIER_LIMIT`, `FREELLM_IDENTIFIER_MAX_BUCKETS`,
`FREELLM_VIRTUAL_KEYS_PATH`.

### Tests

232 passing tests across 19 files (up from 146 at v1.4.0):

- `tests/browser-token.test.ts` 22 unit tests covering every sign and
  verify edge case (short secret, bad signature, tampered payload,
  expired, origin mismatch, missing origin, wrong secret, all the
  rejection reasons)
- `tests/tokens-e2e.test.ts` 11 integration tests booting the real
  Express app against a fake upstream: full mint + use cycle,
  rejected http:// origins, localhost acceptance, ttl over 900
  rejection, unauth'd mint rejection, unsafe identifier rejection,
  successful chat completion with an origin match, spoofed origin
  rejection, missing origin rejection, tampered signature rejection,
  chain guard against browser tokens minting browser tokens
- `tests/schema-tools.test.ts` 12 regression tests for the exact
  payload shapes the real openai SDK sends, plus negative cases for
  unknown fields, invalid tool types, and malformed tool_choice
- `tests/streaming-normalizer.test.ts` fixture-driven tests for
  Gemini missing-index, multi-tool, mixed text+tool, Ollama split
  arguments, Groq passthrough, and malformed chunk resilience
- `tests/sse-primitives.test.ts` 15 unit tests for the parser and
  serializer (partial pushes, CRLF, comment heartbeats, flush, DONE)
- `tests/streaming-e2e.test.ts` boots the real Express app against a
  fake upstream emitting a broken tool_call stream and verifies the
  client sees the corrected bytes
- `tests/status-v14.test.ts` now asserts the new `browserTokens`
  block and every `privacy` field on status
- Every existing test from v1.4.0 still passes

### Verified end-to-end against real providers

- **Groq llama-3.3-70b-versatile** returned the exact requested
  response to a non-streaming completion via `free-fast`
- **Cerebras llama3.1-8b** streamed a real count-to-3 response via
  `free-fast` (router rotation in action)
- **Gemini 2.5 Flash** returned a streaming tool call with
  `{"city":"Paris"}` through the normalizer, reassembled correctly
  by the real openai Node SDK iterator
- **Browser token flow** end-to-end: mint with the master key, call
  Groq through the minted token using the real openai SDK with an
  Origin header, got back `"browser token flow ok"` exactly as
  requested, and verified that a spoofed Origin returns 401
- **CORS preflight** tested with real `OPTIONS` requests: allowed
  origins get the expected ACL headers, disallowed origins get no
  allow-origin header so browsers block the request before it
  reaches the middleware

### Migration

Fully backwards compatible. Every new capability is opt-in:

- Browser tokens activate only when `FREELLM_TOKEN_SECRET` is set
- Streaming normalizer is transparent for compliant providers
  (passthrough) and a correctness fix for Gemini and Ollama
- Schema additions are all optional fields; old clients still work
- Dashboard changes are additive, no existing panels removed

Error response shapes are unchanged from v1.4.0. Clients that handle
the canonical FreeLLMError taxonomy continue to work without changes.

[1.5.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.5.0

---

## [1.4.0] - 2026-04-09

The honest-gateway release. FreeLLM now tells you exactly which provider
answered your request, lets you refuse silent downgrades, routes around
providers that train on your prompts, returns enriched retry hints on 429s,
and can be safely exposed to an app's end users via virtual sub-keys and
per-identifier rate limiting. Everything ships with a real test suite and
no new runtime dependencies.

### Added

#### Transparent routing headers

Every chat completion response now carries observability headers so
clients can see exactly how the request was handled:

- `X-FreeLLM-Provider` — the concrete provider id that served the response
- `X-FreeLLM-Model` — the resolved concrete model id
- `X-FreeLLM-Requested-Model` — the original model asked for
- `X-FreeLLM-Cached` — `true` when the response came from the cache
- `X-FreeLLM-Route-Reason` — one of `direct`, `meta`, `cache`, `failover`
- `X-Request-Id` — a unique trace id that also appears in logs and error bodies

#### Strict mode

Opt-in via `X-FreeLLM-Strict: true`. In strict mode the router refuses
to substitute models. Meta-models (`free`, `free-fast`, `free-smart`)
are rejected with a clear 400. Concrete models are tried against
exactly one provider and the upstream error surfaces verbatim if that
provider fails. No silent failover, no cache hit masquerading as fresh.

#### Actionable 429 bodies

When all providers are exhausted, the gateway now returns a structured
body instead of a generic error:

```json
{
  "error": {
    "type": "rate_limit_error",
    "code": "all_providers_exhausted",
    "message": "...",
    "retry_after_ms": 12000,
    "providers": [
      { "id": "groq",   "retry_after_ms": 12000, "keys_available": 0, "keys_total": 1, "circuit_state": "closed" },
      { "id": "gemini", "retry_after_ms": 5000,  "keys_available": 0, "keys_total": 1, "circuit_state": "closed" }
    ],
    "suggestions": [
      { "model": "free-fast",  "available_in_ms": 5000 },
      { "model": "free-smart", "available_in_ms": 5000 }
    ],
    "request_id": "..."
  }
}
```

The response also carries an HTTP `Retry-After` header in seconds.

#### Unified error SDK

New `src/errors/` module defines the one and only error taxonomy the
gateway emits. Fifteen concrete error codes grouped into seven types
that match OpenAI's shape (`invalid_request_error`, `authentication_error`,
`permission_error`, `not_found_error`, `rate_limit_error`, `provider_error`,
`internal_error`). Every middleware delegates via `next(freellmError(...))`
instead of writing response bodies directly, and the central error
handler funnels everything through a single `toBody()` serializer.

- `freellmError({ code, message, ...context })` factory
- `httpStatusFor(code)` and `typeFor(code)` lookup tables
- `toBody(err, requestId)` never throws, falls back to
  `internal_server_error` envelope for unknown input
- `redactSecrets(message)` strips Bearer tokens, API-key-looking values,
  and long hex sequences from error messages before they go on the wire

#### Request id propagation

New `request-id` middleware mounts first in the pipeline and assigns
every request a UUID (honors an inbound `X-Request-Id` matching
`^[A-Za-z0-9_.:-]{1,128}$` so distributed traces can thread through).
The same id flows into the response header, the error body, and every
pino log line via `genReqId` so a single grep correlates access logs,
error logs, and bug reports.

#### Privacy and training-policy routing

New `X-FreeLLM-Privacy: no-training` header filters the router's
candidate list to providers that contractually exclude free-tier data
from training. Backed by a new `PROVIDER_PRIVACY` catalog with source
URLs and last-verified dates for every shipped provider:

| Provider   | Policy             |
|------------|--------------------|
| Groq       | no-training        |
| Cerebras   | no-training        |
| NVIDIA NIM | no-training        |
| Ollama     | local              |
| Mistral    | configurable       |
| Gemini     | free-tier trains   |

When no provider can satisfy the posture for the requested model, the
gateway returns a 400 `model_not_supported` up front instead of
pointlessly cycling through the exclusion list. Server logs a warning
at boot for any catalog entry older than 90 days so operators re-verify
against the provider's current ToS.

#### Robust Retry-After handling

Upstream `Retry-After` headers are now parsed in both integer-seconds
and HTTP-date formats, clamped into `[1s, 10min]`, and honored on 5xx
responses as well as 429s. Absurd values like `99999999` can no longer
lock a key out for years, and past HTTP dates floor to one second.

#### Per-identifier rate limiting

Every request can now carry an `X-FreeLLM-Identifier` header tagging it
with a logical identity (app user id, session token, anything that
fits `^[A-Za-z0-9_.:-]{1,128}$`). The gateway tracks requests per
identifier in an independent sliding-window bucket. One noisy user
hitting their cap doesn't affect anyone else.

- Configurable via `FREELLM_IDENTIFIER_LIMIT=<max>/<windowMs>`, default 60/60000
- Hard ceiling of `FREELLM_IDENTIFIER_MAX_BUCKETS` distinct identifiers (default 10000) with LRU eviction on overflow
- Idle buckets garbage-collected after 2x the window
- Synchronous check-and-increment so concurrent requests cannot race
- Missing header falls back to `ip:<client-ip>`
- Literal `"undefined"` or `"null"` strings are treated as missing
- Tainted values (control chars, spaces, too long) are rejected with a clear 400 instead of silently entering logs
- Responses carry `X-FreeLLM-Identifier`, `X-FreeLLM-Identifier-Remaining`, and `X-FreeLLM-Identifier-Reset` so clients can self-throttle

#### Virtual sub-keys with soft caps

Operators can now declare virtual sub-keys in a JSON file pointed at by
`FREELLM_VIRTUAL_KEYS_PATH`. Each key can carry its own request cap,
token cap, model allowlist, and expiry:

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

The store is loaded at boot, Zod-validated, and rejects duplicate ids
and files larger than 1 MB. Virtual keys authenticate via
`Authorization: Bearer sk-freellm-...` alongside the existing
`FREELLM_API_KEY` master key. The chat route guards each request via
`assertCanServe` BEFORE routing to a provider (expiry, model allowlist,
request cap, token cap) and records usage AFTER a successful upstream
response, so failed routes never burn quota. Each cap hit returns its
own typed error: `virtual_key_cap_reached`, `model_not_supported`,
`invalid_api_key`.

Counters are in-memory, rolling 24 hours, **reset on restart**. This
is explicitly a soft cap (runaway-loop and abuse protection, not a
billing system). The server logs a loud warning at boot when any
virtual keys are loaded so operators cannot mistake it for billing.

#### Security, privacy, and benchmarks pages

Three new pages on the documentation website grouped under a new
**Trust** section:

- `/security` lists the six direct production dependencies, what is
  deliberately not in the codebase (no telemetry, no runtime code
  generation, no plugin loaders, no install-time scripts), how to
  verify a deployed Docker image, and where to report vulnerabilities
- `/privacy` renders the provider training-policy catalog with links
  to each provider's own terms of service
- `/benchmarks` publishes cold-start and per-request overhead numbers
  rendered from `docs/benchmarks.json` with a methodology section

#### Reproducible benchmark script

New `scripts/bench.mjs` spawns the built server against a fake
in-process upstream, measures boot time to first `/healthz` 200, then
runs cache-miss and cache-hit passes and writes `docs/benchmarks.json`.
Run it locally with `node scripts/bench.mjs --print`.

Reference numbers on a developer laptop:

- Cold start: ~127 ms (spawn to first `/healthz` 200)
- Cache-miss overhead: p50 0.69 ms, p99 1.37 ms
- Cache-hit overhead: p50 0.34 ms, p99 0.92 ms

#### Continuous integration

New `.github/workflows/ci.yml` runs `pnpm -r typecheck`, the api-server
test suite, and `pnpm audit --prod --audit-level=moderate` on every
push and every pull request. Audit failures are tracked through
`.github/audit-allowlist.json` (a process contract, not an automated
bypass). Supports future badge wiring.

#### Test suite

FreeLLM now ships with 141 passing tests (up from 0) across eleven
test files, all green on every commit via CI:

- `errors.test.ts` — exhaustive code-to-status and code-to-type coverage, factory, guard, serializer, and redact helpers
- `errors-integration.test.ts` — X-Request-Id propagation, canonical shape on 400/401 paths
- `strict.test.ts` — header parser, meta-model rejection
- `retry-advice.test.ts` — per-provider and global earliest-retry math, hint ordering, suggestions
- `retry-after.test.ts` — integer, fractional, HTTP-date, clamping at both ends, every invalid input
- `privacy.test.ts` — header parsing, catalog exhaustiveness, satisfaction (including unknown-id fail-closed), staleness math
- `identifier-limiter.test.ts` — sliding window, LRU, TTL, isolation, env parser
- `virtual-keys.test.ts` — construction, duplicate rejection, expiry, allowedModels, rolling-window cap enforcement, file loading edge cases
- `router.test.ts` — direct, failover, strict mode, privacy routing, Retry-After plumbing
- `e2e.test.ts` — real Express app against a fake upstream, full header assertions
- `multi-tenant-e2e.test.ts` — virtual key auth, cap enforcement, identifier middleware end-to-end

### Changed

- `GatewayRouter.complete()` now returns `{ data, meta }` with full
  route metadata (provider, resolvedModel, requestedModel, cached,
  reason, attempted providers) instead of just the chat completion
- The central `errorHandler` runs every error class through
  `normalizeError` + `toBody`, replacing the previous per-class
  `instanceof` branching and ad hoc JSON shaping
- `AllProvidersExhaustedError` and `ProviderClientError` are now
  internal signals only; callers never see the class name on the wire
- `auth` middleware accepts either the master key or a virtual key,
  populates `req.virtualKey` on virtual-key matches
- `validate` middleware sanitizes Zod error messages via
  `redactSecrets` so prompts containing leaked API keys cannot echo
  back in the error
- `rate-limit` middleware swapped to `express-rate-limit`'s `handler`
  hook so its 429 body matches every other 429 the gateway produces
- Website build toolchain (`astro`, `@astrojs/starlight`,
  `@astrojs/check`, `sharp`, `typescript`) moved from `dependencies`
  to `devDependencies` so `pnpm audit --prod` does not traverse
  build-only packages

### Fixed

- Patched three GitHub Security Advisories flagged by the new CI audit
  step: **GHSA-p9ff-h696-f583** (high) and **GHSA-4w7w-66w2-5vf9**
  (moderate) for Vite below 6.4.2, and **GHSA-48c2-rrv3-qjmp**
  (moderate) for yaml below 2.8.3 buried under `@astrojs/check`.
  Fixed via `pnpm.overrides` in the root `package.json` forcing the
  patched versions regardless of transitive chain, a workspace
  catalog bump to `vite ^6.4.2`, and moving the website build
  toolchain to `devDependencies`.

### Configuration

New environment variables:

| Variable | Default | What it does |
|---|---|---|
| `FREELLM_IDENTIFIER_LIMIT` | `60/60000` | Per-identifier rate limit, format `<max>/<windowMs>` |
| `FREELLM_IDENTIFIER_MAX_BUCKETS` | `10000` | Hard ceiling on distinct identifiers tracked |
| `FREELLM_VIRTUAL_KEYS_PATH` | unset | Path to a JSON file declaring virtual sub-keys |

### Migration

Fully backwards compatible. Every new capability is opt-in via a
request header (`X-FreeLLM-Strict`, `X-FreeLLM-Privacy`,
`X-FreeLLM-Identifier`) or an environment variable. Existing clients
see richer response headers and enriched 429 bodies automatically,
but no behavioral change unless they opt into strict mode.

Error response shapes are slightly different: the `type` field now
uses OpenAI's taxonomy (`invalid_request_error`,
`authentication_error`, etc.) and every response carries a `code`
field plus a `request_id`. Clients that were pattern-matching on
message strings should move to code-based dispatch.

[1.4.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.4.0

---

## [1.3.0] - 2026-04-08

Response caching — same prompt twice returns the cached response in ~23ms
with **zero provider quota burn**. Verified end-to-end at 9× faster than
the cold path (200ms → 23ms).

### Added

#### In-memory LRU response cache
- New `ResponseCache` class with sha256-keyed exact-match lookup
- Cache key built from `(model, messages, temperature, max_tokens, top_p, stop)`
- LRU eviction via Map re-insertion (recently-used entries stay at the end)
- Per-entry TTL expiry (default 1 hour, configurable)
- Default capacity 1000 entries (configurable)
- Cache hits short-circuit the entire routing flow:
  no provider call, no token quota burn, no rate limiter increment
- Streaming requests are never cached (the SSE protocol is incompatible)
- Errors are never cached (only successful 2xx responses)

#### Response markers
- Cached responses include `x_freellm_cached: true` (alongside `x_freellm_provider`)
- `RequestLogEntry` gained a `cached?: boolean` field
- Token usage tracker is **not** incremented on cache hits (real cost = 0)

#### Cache stats on `/v1/status`
- New `cache` field with full counters:
  ```json
  {
    "enabled": true,
    "ttlMs": 3600000,
    "maxEntries": 1000,
    "currentSize": 12,
    "hits": 47,
    "misses": 8,
    "sets": 8,
    "evictions": 0,
    "hitRate": 0.8545
  }
  ```

#### Configuration
- `CACHE_ENABLED` (default `true`) — set to `false` to disable
- `CACHE_TTL_MS` (default `3600000` = 1 hour)
- `CACHE_MAX_ENTRIES` (default `1000`)

#### Dashboard
- New 5th metrics card "Cache Hits" (cyan, Database icon) with hit-rate sub-line
- Metrics row layout updated to 2/3/5 cols across mobile/medium/large breakpoints
- Recent requests table shows a `CACHE` badge next to `OK` for cached rows

### Why in-memory instead of SQLite

The original plan called for `better-sqlite3`, but it was rejected because:

1. **Native compilation risk** — `better-sqlite3` needs `node-gyp` + Python +
   build tools at install time. Railway's slim image likely lacks them, which
   would break the published Railway template's build.
2. **Ephemeral filesystem on free tiers** — Railway and Render free tiers
   don't have persistent disk. A SQLite cache file would be wiped on every
   restart anyway, requiring a paid persistent volume.
3. **Architectural consistency** — every other observability piece in
   FreeLLM (`RequestLog`, `RateLimiter`, `CircuitBreaker`, `UsageTracker`)
   is in-memory. Adding DB-backed storage for one feature would break the
   pattern.

Cold cache warms up in seconds, restart loss is acceptable for a free-tier
gateway, and the entire feature ships with **zero new dependencies** (uses
Node's built-in `crypto.createHash`). The ResponseCache class lives behind
a clean interface, so swapping the storage to SQLite later is a one-file
change if persistence becomes a priority.

### Verified end-to-end

```
Call A (cold)             cached=false  latency=200ms   tokens=43+2  provider=groq
Call B (same)             cached=true   latency=23ms    tokens=0     no upstream
Call C (same)             cached=true   latency=23ms    tokens=0     no upstream
Call D (different prompt) cached=false  latency=~200ms  tokens=new   provider=groq
```

9× speedup, 50% hit rate after 4 calls, all 18 gateway tests still passing.

[1.3.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.3.0

---

## [1.2.0] - 2026-04-08

Token usage tracking — the ironic missing piece for a free-tier gateway.
Every successful request now records its `prompt_tokens` + `completion_tokens`
against a rolling 24-hour window, and the dashboard shows you exactly how much
of your free-tier budget you've burned per provider.

### Added

#### Token usage tracker
- New `UsageTracker` class tracks rolling 24-hour token totals per provider
- Hourly bucket design: O(1) writes, O(24) reads, ~576 bytes per provider max
- In-memory (rebuilt on restart, which is fine — upstream providers reset their
  daily quotas independently)

#### Per-provider usage on `/v1/status`
- New `usage` field on every `ProviderStatusInfo`:
  ```json
  {
    "promptTokens": 12345,
    "completionTokens": 6789,
    "totalTokens": 19134,
    "requestCount": 42
  }
  ```
- New gateway-wide `usage` field on `GatewayStatus` (sum across all providers)
- `POST /v1/status/providers/{id}/reset` response also includes the provider's usage

#### Request log entries carry token fields
- `RequestLogEntry` gained `promptTokens` and `completionTokens` (both optional)
- Populated automatically from `response.usage` on successful non-streaming requests

#### Dashboard: 4-card metrics row
- Added a fourth "Tokens (24h)" card (amber, with the Coins icon)
- Compact number formatter: `1234` → `1.2K`, `1500000` → `1.50M`, `2_000_000_000` → `2.00B`
- Responsive layout: 2 columns on mobile, 4 columns on desktop

#### Dashboard: per-provider token block
- Each provider card now shows a dedicated amber "TOKENS (24H)" section
- Displays total + `in X · out Y` breakdown for prompt vs completion
- Hidden on providers with zero activity so cards stay clean

#### Dashboard: Tokens column in request log
- Recent requests table added a "Tokens" column showing `prompt → completion`
- Hover tooltip shows the full breakdown
- Shows `-` for streaming requests (see limitations below)

#### Dashboard: multi-key badge (bonus)
- Provider cards now surface the `keyCount/keysAvailable` badge from v1.1.0
- Previously this data was exposed via API but not displayed in the UI
- Shows "3/4" when 3 of 4 keys are available, for example

### Limitations

- **Streaming responses don't track tokens yet.** The OpenAI SSE protocol
  doesn't guarantee a final `usage` chunk unless `stream_options.include_usage`
  is set on the request. Will be addressed in a future release.
- **No hard-coded daily quota progress bars.** Provider free tier token caps
  change often, so we show raw totals rather than stale progress indicators.

[1.2.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.2.0

---

## [1.1.0] - 2026-04-08

Multi-key capacity stacking — the feature that makes FreeLLM structurally
different from every other LLM gateway. Every provider env var now accepts a
comma-separated list of API keys, and FreeLLM rotates through them with
independent per-key rate-limit budgets.

### Added

#### Multi-key rotation
- Provider env vars now accept comma-separated keys:
  `GROQ_API_KEY=key1,key2,key3` → ~84 req/min on Groq instead of 28
- Each key gets its own sliding-window rate-limit budget and cooldown state
- Round-robin rotation via `keyRotationIndex` advanced synchronously so
  concurrent requests spread across keys
- `isAvailable()` returns true when **any** key is not rate-limited —
  a single 429'd key no longer disables the whole provider
- Router only excludes a provider when **all** its keys are exhausted,
  so the next failover attempt can retry the same provider with a different key
- Circuit breaker stays provider-level (a broken baseURL affects all keys equally)

#### Per-key observability
- `GET /v1/status` now returns per-provider `keyCount`, `keysAvailable`, and
  a `keys[]` array with per-key sliding-window state
- `POST /v1/status/providers/{id}/reset` clears cooldowns on **all** keys

### Changed

- `ProviderAdapter.onSuccess` / `onRateLimit` now take the `Response` object
  so the provider can attribute events to the exact key that produced them
  via `WeakMap<Response, string>` — concurrency-safe with no race conditions
- `RateLimiter` API now keyed by tracking ID (`providerId` or `providerId#N`)
  rather than bare provider ID. Provider ID is extracted internally for
  config lookup, so the sliding-window config remains per-provider.
- Ollama uses a sentinel `["ollama"]` key to fit the uniform multi-key flow

### Migration

Fully backward compatible. Single-key configs work unchanged. To benefit from
key stacking, update any provider env var to comma-separated form:

```env
# Before
GROQ_API_KEY=gsk_single_key

# After (same behavior, still works)
GROQ_API_KEY=gsk_single_key

# After (4x free capacity)
GROQ_API_KEY=gsk_key1,gsk_key2,gsk_key3,gsk_key4
```

[1.1.0]: https://github.com/Devansh-365/freellm/releases/tag/v1.1.0

---

## [1.0.0] - 2026-04-08

First stable release. Production-ready OpenAI-compatible gateway aggregating
6 free LLM providers with automatic failover, circuit breakers, and a
real-time dashboard.

### Added

#### Gateway
- OpenAI-compatible `/v1/chat/completions` endpoint with streaming and non-streaming support
- 6 LLM providers: Groq, Gemini, Mistral, Cerebras, NVIDIA NIM, and Ollama
- 25+ models across providers including Llama 3.3 70B, Gemini 2.5 Flash/Pro, Llama 4 Scout, Qwen3, Nemotron 70B, DeepSeek R1, GPT-OSS 120B
- Three meta-models: `free` (round-robin), `free-fast` (latency-optimized), `free-smart` (capability-optimized)
- Automatic failover across providers with configurable routing strategies (round-robin, random)
- Per-provider circuit breakers with three states (closed → open → half-open) and configurable thresholds
- Per-provider sliding-window rate limiting with conservative free-tier defaults
- Per-client (per-IP) rate limiting via `express-rate-limit`
- In-memory request log (last 500 requests) with stats and recent history
- Routing deadline (`ROUTE_TIMEOUT_MS`) to prevent hung requests during cascading failures

#### Security
- Optional API key authentication (`FREELLM_API_KEY`) using timing-safe SHA-256 comparison
- Separate admin key (`FREELLM_ADMIN_KEY`) protecting circuit breaker reset and routing strategy mutations
- Configurable CORS origins (`ALLOWED_ORIGINS`)
- Body size limits on JSON and URL-encoded payloads
- Zod schema validation with strict mode and bounded `messages.max(256)` / `max_tokens.max(32768)`
- Upstream error sanitization (only safe `message` field forwarded, never raw upstream JSON)
- Production warning when running without API key auth

#### Dashboard
- React 18 + Vite + Tailwind SPA served by the same Express process in production
- Real-time provider health cards (circuit breaker state, success/failure counts, last error)
- Live request log with latency, status, model, and selected provider
- Routing strategy toggle (round-robin / random)
- Manual circuit breaker reset
- Models page with search and grouping by provider
- Mobile-responsive layout with slide-over menu
- New FreeLLM logo as favicon and Open Graph image

#### Deployment
- Multi-stage Dockerfile (Node 22 LTS, non-root `appuser`, healthcheck baked in)
- `docker-compose.yml` for one-command local deployment
- `railway.json` for Railway auto-detection with healthcheck and restart policy
- Graceful shutdown on SIGTERM/SIGINT (drains in-flight requests, 8s deadline)
- `app.set("trust proxy", 1)` for correct client IP behind reverse proxies
- Static dashboard serving with SPA fallback for client-side routing
- Production-ready logging via Pino with structured JSON output

#### Developer Experience
- pnpm workspace monorepo with shared dependency catalog
- TypeScript 5.9 across all packages with `bundler` module resolution
- esbuild bundle for the API server with CJS shim for Pino compatibility
- OpenAPI 3.1 spec as the single source of truth for the API client
- Auto-generated React Query hooks via Orval (`@workspace/api-client-react`)
- Knip configuration for unused export detection
- `scripts/test-gateway.sh` end-to-end test suite with 18 checks (health, models, status, completions, streaming, NIM direct, validation)

### Documentation
- Comprehensive README with quickstart (Docker + local), provider table, API reference, security guide, and tech stack
- Mermaid diagrams for request lifecycle, circuit breaker state machine, routing strategies, and high-level architecture
- MIT license
- Architecture refactor plan in `docs/superpowers/plans/`

[1.0.0]: https://github.com/devansh-365/freellm/releases/tag/v1.0.0
