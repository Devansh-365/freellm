<div align="center">

# FreeLLM

![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square&logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-24+-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Providers](https://img.shields.io/badge/Providers-5-blueviolet?style=flat-square)
![Models](https://img.shields.io/badge/Models-20+-orange?style=flat-square)

### Stop juggling API keys. Start shipping.

One endpoint, 5 providers, 20+ models -- all free.
FreeLLM is an OpenAI-compatible gateway that routes your requests across
Groq, Gemini, Mistral, Cerebras, and Ollama so you never hit a rate limit again.

[Quickstart](#quickstart) · [How It Works](#how-it-works) · [API](#api-reference) · [Dashboard](#dashboard) · [Architecture](#architecture)

---

</div>

## The Problem

You want to use LLMs in your project without paying. Every major provider has a free tier -- but each comes with its own SDK, its own rate limits, and its own downtime. You end up writing provider-switching logic, handling 429s, and babysitting API keys across five different dashboards.

**FreeLLM fixes this in one line:**

```bash
curl http://localhost:3000/v1/chat/completions \
  -d '{"model": "free-fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Your request goes to the fastest available provider. If that provider is rate-limited or down, FreeLLM tries the next one. You get a response. Every time.

## What You Get

- **One endpoint, any OpenAI SDK** -- swap your base URL, keep your existing code
- **Automatic failover** -- Groq rate-limited? Your request silently routes to Gemini, then Mistral, then Cerebras
- **Smart meta-models** -- `free-fast` for speed, `free-smart` for capability, `free` for maximum availability
- **Built-in rate-limit tracking** -- FreeLLM knows each provider's limits and avoids hitting them
- **Circuit breakers** -- failing providers get taken out of rotation and tested for recovery automatically
- **Real-time dashboard** -- see provider health, request logs, and latency at a glance
- **Zero cost** -- every provider runs on its free tier

## Supported Providers

| Provider | Models | Free Tier | Why It's Here |
|----------|--------|-----------|---------------|
| **Groq** | Llama 3.3 70B, Llama 3.1 8B, Llama 4 Scout, Qwen3 32B | ~30 req/min | Fastest inference available |
| **Gemini** | Gemini 2.5 Flash, 2.5 Pro, 2.0 Flash, 2.0 Flash Lite | ~15 req/min | Most capable free models |
| **Mistral** | Mistral Small, Mistral Medium, Mistral Nemo | ~5 req/min | Strong reasoning at low cost |
| **Cerebras** | Llama 3.1 8B, Qwen3 235B, GPT-OSS 120B | ~30 req/min | High-throughput inference |
| **Ollama** | Any local model | Unlimited | Your hardware, your rules |

**Combined free capacity: ~80 requests/minute** across all cloud providers -- enough for prototyping, internal tools, and side projects.

## Quickstart

### Option A: Docker (recommended)

```bash
git clone https://github.com/devanshtiwari/freellm.git
cd freellm
cp .env.example .env        # add your API keys
docker compose up
```

API runs on `http://localhost:3000`. Done.

### Option B: Local

#### 1. Clone and install

```bash
git clone https://github.com/devanshtiwari/freellm.git
cd freellm
pnpm install
```

#### 2. Add your API keys

```bash
cp .env.example .env
```

Open `.env` and paste at least one key. More keys = more availability:

```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AI...
MISTRAL_API_KEY=...
CEREBRAS_API_KEY=...
```

#### 3. Start

```bash
pnpm dev
```

API runs on `http://localhost:3000`. Dashboard on `http://localhost:5173`.

Point any OpenAI-compatible SDK at `http://localhost:3000/v1` and go.

### Use with Python

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:3000/v1", api_key="unused")

response = client.chat.completions.create(
    model="free-smart",
    messages=[{"role": "user", "content": "Explain quantum computing in one paragraph."}]
)

print(response.choices[0].message.content)
```

### Use with TypeScript

```typescript
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "http://localhost:3000/v1", apiKey: "unused" });

const response = await client.chat.completions.create({
  model: "free-fast",
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Use with curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## How It Works

### Meta-Models

Don't pick a provider. Pick a strategy:

| Model | What It Does | Use When |
|-------|-------------|----------|
| `free` | Rotates across all available providers evenly | You want maximum uptime |
| `free-fast` | Routes to the lowest-latency provider first (Groq > Cerebras > Gemini) | You're building a chatbot or real-time UI |
| `free-smart` | Routes to the most capable model first (Gemini > Groq > Mistral) | You need stronger reasoning or longer context |

Need a specific model? Target it directly:

```
groq/llama-3.3-70b-versatile
gemini/gemini-2.0-flash
mistral/mistral-small-latest
cerebras/llama3.3-70b
```

### Routing and Failover

Every request follows this path:

```
Your request
  │
  ├─ Pick provider (round-robin or random)
  │
  ├─ 200 ── Return response. Mark provider healthy.
  │
  ├─ 429 ── Provider rate-limited. Try the next one.
  │
  ├─ 5xx ── Provider error. Trip circuit breaker. Try the next one.
  │
  ├─ 400/401/403/404 ── Your request has a problem. Return the error. Don't retry.
  │
  └─ All providers exhausted ── Return 429 with "all_providers_exhausted".
```

### Circuit Breakers

Each provider has an independent circuit breaker that protects against cascading failures:

```
CLOSED (healthy)                OPEN (failing)               HALF-OPEN (testing)
  Requests flow normally   →   3 failures trip it open   →   After 30s, one request gets through
        ↑                                                           │
        └──────────── 2 successes in half-open = fully recovered ───┘
```

All thresholds are configurable:

| Variable | Default | What It Controls |
|----------|---------|-----------------|
| `CB_FAILURE_THRESHOLD` | `3` | Consecutive failures before tripping open |
| `CB_SUCCESS_THRESHOLD` | `2` | Successes needed in half-open to recover |
| `CB_TIMEOUT_MS` | `30000` | Wait time before testing an open breaker |

### Securing Your Gateway

Both settings are optional. Leave them empty for local development.

| Variable | What It Does |
|----------|-------------|
| `FREELLM_API_KEY` | When set, every request must include `Authorization: Bearer <key>`. Prevents unauthorized use of your gateway. |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins (e.g. `https://myapp.com,https://admin.myapp.com`). When empty, all origins are allowed. |

**For production deployments**, set both:

```env
FREELLM_API_KEY=some-secret-key-here
ALLOWED_ORIGINS=https://myapp.com
```

Then pass your key in requests:

```bash
curl http://your-server.com/v1/chat/completions \
  -H "Authorization: Bearer some-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{"model": "free-fast", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## API Reference

Fully OpenAI-compatible. Available at `/v1/...` (direct) and `/api/v1/...` (proxied via dashboard).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/chat/completions` | Chat completion (streaming and non-streaming) |
| `GET` | `/v1/models` | List all available models + meta-models |
| `GET` | `/v1/status` | Gateway health, provider states, recent requests |
| `POST` | `/v1/status/providers/{id}/reset` | Force-reset a provider's circuit breaker |
| `PATCH` | `/v1/status/routing` | Switch between `round_robin` and `random` |

Every response includes an `x_freellm_provider` header so you know which provider handled it.

## Dashboard

A built-in web UI for monitoring your gateway in real time:

- **Provider health** -- see which providers are healthy, rate-limited, or failing
- **Live request log** -- every request with its model, provider, latency, and status
- **Routing controls** -- switch strategies without restarting the server
- **Circuit breaker management** -- manually reset a tripped provider when you know it's back

## Architecture

```
packages/
  api-server/              Express 5 + TypeScript
    gateway/
      config.ts              All constants in one place (meta-models, priorities, limits)
      router.ts              Failover loop with round-robin and random strategies
      registry.ts            Provider lifecycle management
      circuit-breaker.ts     Three-state health tracking per provider
      rate-limiter.ts        Sliding-window request counting + cooldown
      schemas.ts             Zod request validation schemas
      providers/             One adapter per provider
    middleware/
      error-handler.ts       Centralized error formatting
      validate.ts            Zod validation middleware
    routes/v1/               OpenAI-compatible HTTP handlers

  dashboard/               React 18 + Vite + Tailwind
    components/              Focused, single-responsibility UI components
    pages/                   Dashboard, Models, Quickstart

lib/
  api-spec/                OpenAPI 3.1 spec (single source of truth)
  api-client-react/        Auto-generated React Query hooks via Orval
```

## Tech Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Radix UI](https://img.shields.io/badge/Radix_UI-161618?style=for-the-badge&logo=radixui&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)
![React Query](https://img.shields.io/badge/TanStack_Query-FF4154?style=for-the-badge&logo=reactquery&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)
![OpenAPI](https://img.shields.io/badge/OpenAPI-6BA539?style=for-the-badge&logo=openapiinitiative&logoColor=white)
![Pino](https://img.shields.io/badge/Pino-687634?style=for-the-badge&logoColor=white)

## Contributing

```bash
git checkout -b feat/your-feature
# make changes
git commit -m "feat: describe what you built"
git push origin feat/your-feature
# open a PR
```

## License

[MIT](LICENSE)
