# Expandable Request Logs — Design

**Date:** 2026-05-03
**Scope:** Dashboard request log row inline-expand to show full request/response bodies, backed by SQLite-persisted log store.

## Problem

Current dashboard shows last N request log rows from in-memory `RequestLog` (`packages/api-server/src/gateway/request-log.ts`). Rows are summary-only — no way to inspect what was actually sent or received. Log capacity is bounded by RAM, so storing bodies in-memory is not viable.

## Goals

- Show all retained logs (up to 500) in a scrollable list on the dashboard.
- Click any row to inline-expand and see full request body + response body.
- Capture request/response for **both** non-streaming and streaming requests.
- Persist bodies to local disk (SQLite) so RAM stays small even with 500 retained entries.
- Batched DB writes (5-second flush) so per-request hot path stays cheap.
- Lazy body fetch (separate endpoint) so the existing 3-second status poll doesn't bloat.
- No body masking. Bodies displayed as-is.

## Non-Goals

- No multi-host log aggregation.
- No retention beyond 500 entries.
- No body redaction / PII masking.
- No download / export feature.
- No search or filter UI in this iteration.

---

## Section 1 — Backend: SQLite-backed RequestLog

### Storage

Replace in-memory ring buffer in `packages/api-server/src/gateway/request-log.ts` with SQLite via `better-sqlite3`.

**DB file:** `process.env.FREELLM_LOG_DB ?? "./data/request-logs.db"`. Auto-create parent dir on startup.

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_model TEXT NOT NULL,
  resolved_model TEXT,
  provider TEXT,
  latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cached INTEGER NOT NULL DEFAULT 0,
  streaming INTEGER NOT NULL DEFAULT 0,
  finish_reason TEXT,
  error TEXT,
  chunk_count INTEGER,
  request_body TEXT,
  response_body TEXT
);
CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp DESC);
```

`request_body` and `response_body` stored as JSON strings (or plain text for assembled stream content).

**Retention:** prune to 500 newest rows after each flush. Single transaction.

### Public API (preserved)

- `add(entry)` — non-blocking. Pushes to in-memory buffer; flush cycle persists.
- `getRecent(limit)` — merges in-memory buffer with DB read (buffer rows always newer).
- `getStats()` — counters maintained in-memory; hydrated on startup.
- **New:** `getById(id)` — buffer first, then DB lookup.
- **New:** `getPage({ limit, before })` — paginated reads from merged view, cursor by timestamp.

### Stats hydration

Constructor runs:

```sql
SELECT status, count(*) FROM request_logs GROUP BY status;
```

…to restore `total / success / failed / rate_limited` counters on startup. Avoids losing stats across restarts.

---

## Section 1b — Streaming body capture

`StreamingPipeline` (`packages/api-server/src/gateway/streaming/pipeline.ts`) gains:

- `getAccumulated(): string` — concatenated `delta.content` across all streamed chunks.
- `getChunkCount(): number` — incremented in `renderEvents` for each parsed chunk.

Implementation: in `renderEvents`, when parsing a chunk, append `parsed.choices?.[0]?.delta?.content ?? ""` to an internal accumulator and bump the counter. No allocation per byte — single string concat per chunk.

Streaming success/failure log calls in `packages/api-server/src/routes/v1/chat.ts` (around lines 225 and 239) pass:

```ts
requestBody: body,
responseBody: pipeline.getAccumulated(),
chunkCount: pipeline.getChunkCount(),
streaming: true,
```

Non-streaming sites in `router.ts` (4 call sites: 263, 321, 354, 364) pass `requestBody: request, responseBody: data` (or `cached.response` where applicable).

`RequestLogEntry` type in `packages/api-server/src/gateway/types.ts` extended with optional fields:

```ts
requestBody?: unknown;
responseBody?: unknown;
chunkCount?: number;
```

---

## Section 1c — Batched flush cycle

**Goal:** keep per-request hot path off the disk; bound RAM regardless of throughput.

### Buffer

Module-level `pending: RequestLogEntry[]`. `add()` pushes onto it.

### Flush

`setInterval(flush, 5000)` — **5 seconds, not configurable** (per requirements).

```
flush():
  if pending.length === 0: return
  batch = pending.splice(0)        // atomic snapshot
  db.transaction(() => {
    for entry of batch: insertStmt.run(...)
    db.exec("DELETE FROM request_logs WHERE id NOT IN (SELECT id FROM request_logs ORDER BY timestamp DESC LIMIT 500)")
  })()
```

Single transaction per cycle. Prepared insert statement reused.

### Backpressure

If `pending.length > 1000` at any `add()`, trigger a sync flush immediately. Protects against burst overload between intervals.

### Reads

`getRecent(limit)`:
1. Read `pending` (newest-first) up to `limit`.
2. If short, top up from `db.prepare("SELECT ... ORDER BY timestamp DESC LIMIT ?")`.
3. Merge, return.

`getById(id)`:
1. Linear scan `pending`.
2. Fallback to `SELECT * FROM request_logs WHERE id = ?`.

This guarantees newly-added entries are expandable immediately, even before flush.

### Shutdown

Register `process.on("SIGTERM", finalFlush)` and `SIGINT`. Final flush is sync, awaits write before exit.

---

## Section 2 — Admin endpoints

Add to `packages/api-server/src/routes/v1/status.ts`. Both routes guarded by existing `adminAuth` middleware.

### `GET /v1/status/requests`

Query params:
- `limit` (default 100, max 500)
- `before` (ISO timestamp cursor, optional)

Response:
```ts
{
  requests: RequestLogEntry[],   // bodies stripped
  nextBefore: string | null,
}
```

Strips `requestBody` / `responseBody` from each entry. Lightweight.

### `GET /v1/status/requests/:id`

Response:
```ts
RequestLogEntry  // full, including bodies
```

404 if not found.

Both endpoints regenerated into `@workspace/api-client-react` via existing OpenAPI generation flow → produces `useGetRequests` and `useGetRequestById` hooks.

---

## Section 3 — Frontend: virtualized list + inline expand

### Components

Replace `packages/dashboard/src/components/request-table.tsx` consumer pattern. Two new components:

- `request-list.tsx` — scrollable virtualized container.
- `request-detail.tsx` — inline expansion panel.

### Data flow

`dashboard.tsx` swaps from `status?.recentRequests` to `useGetRequests({ limit: 500 })` polled at 3s.

Each expanded row fires `useGetRequestById(id)` — React Query caches by id, so re-expanding is instant.

### Virtualization

`@tanstack/react-virtual`:
```ts
useVirtualizer({
  count: requests.length,
  estimateSize: () => 40,    // collapsed row height
  overscan: 10,
  measureElement: ...,         // dynamic for expanded rows
})
```

Container: `h-[600px] overflow-y-auto rounded-xl border bg-card`.

### Row interaction

Local state `expanded: Set<string>`. Click row → toggle id in set. Expanded row renders `<RequestDetail id={id} />` below the summary line; collapsed row renders summary only.

`measureElement` recomputes height when expansion toggles.

### Detail panel

`request-detail.tsx`:
- Loading skeleton while `useGetRequestById` pending.
- Error state on fetch failure.
- Two sections: **Request** and **Response**.
- Request body: `JSON.stringify(body, null, 2)` in a `<pre>` with monospace font.
- Response body: same for non-streaming; for streaming entries, render assembled text + `Chunks: N` label.
- Copy button per body (writes to clipboard).
- No reveal toggle, no masking — bodies always visible.

### Dependencies

- `packages/api-server/package.json`: add `better-sqlite3`.
- `packages/dashboard/package.json`: add `@tanstack/react-virtual`.

---

## Risks / Open Questions

- **better-sqlite3 native build** — confirmed available for Node 20 + macOS/Linux. Should work in container.
- **DB file path on Railway / containers** — `./data/` is process-relative. Deployments must mount or accept ephemeral logs across redeploys. Acceptable since logs are observability, not source of truth.
- **Body size** — large prompts (image attachments, long context) inflate row size. Acceptable at 500-row cap. If problematic later, add per-body size cap.
- **Flush interval & SIGKILL** — final flush only runs on SIGTERM/SIGINT. Hard kill (`kill -9`) loses up to 5s of buffered entries. Acceptable.

## Test plan

- Unit: RequestLog `add` → buffered, not yet in DB; tick flush → in DB; prune keeps 500 newest.
- Unit: `getById` finds buffer-only entry pre-flush.
- Unit: StreamingPipeline `getAccumulated` matches concatenated deltas; `getChunkCount` matches event count.
- Integration: streaming request → log entry has assembled response + chunk count.
- Integration: non-streaming request → log entry has request + response JSON.
- Integration: SIGTERM during buffered batch → flush completes before exit.
- Integration: `GET /v1/status/requests` excludes bodies; `GET /v1/status/requests/:id` includes.
- E2E: dashboard list scrolls smoothly with 500 rows; expanding row reveals body; copy works.
