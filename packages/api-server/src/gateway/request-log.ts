/**
 * SQLite-backed request log with batched flush cycle.
 *
 * Hot path: add() pushes onto an in-memory buffer (non-blocking).
 * Background: setInterval flushes pending entries into SQLite every 5s,
 * then prunes the table to MAX_LOG_ENTRIES newest rows.
 *
 * Reads merge buffer + DB so newly-added entries are immediately visible
 * via getRecent() / getById() before the next flush cycle.
 *
 * Stats are maintained in-memory but hydrated from DB on construction so
 * counters survive restarts.
 *
 * Backpressure: if pending exceeds MAX_LOG_ENTRIES, a sync flush runs
 * inside add() to bound RAM to the same cap as the DB.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import Database, { type Database as DB, type Statement } from "better-sqlite3";
import type { RequestLogEntry } from "./types.js";

const MAX_LOG_ENTRIES = 500;
const DEFAULT_FLUSH_MS = 5000;

export interface GatewayStats {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
}

export interface RequestLogOptions {
  /** SQLite file path. Use ":memory:" for in-memory. Default: "./data/request-logs.db". */
  dbPath?: string;
  /** Flush interval in ms. 0 disables the timer (tests call flush() manually). */
  flushIntervalMs?: number;
}

interface PageQuery {
  limit: number;
  before?: string;
}

interface PageResult {
  requests: RequestLogEntry[];
  nextBefore: string | null;
}

interface Row {
  id: string;
  seq: number;
  timestamp: string;
  status: string;
  requested_model: string;
  resolved_model: string | null;
  provider: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached: number;
  streaming: number;
  finish_reason: string | null;
  error: string | null;
  chunk_count: number | null;
  request_body: string | null;
  response_body: string | null;
}

function rowToEntry(row: Row): RequestLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    status: row.status as RequestLogEntry["status"],
    requestedModel: row.requested_model,
    resolvedModel: row.resolved_model,
    provider: row.provider,
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    cached: row.cached === 1,
    streaming: row.streaming === 1,
    finishReason: row.finish_reason,
    error: row.error,
    chunkCount: row.chunk_count ?? undefined,
    requestBody: row.request_body ? safeParse(row.request_body) : undefined,
    responseBody: row.response_body ? safeParse(row.response_body) : undefined,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function serialize(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

export class RequestLog {
  private db: DB;
  private insertStmt: Statement;
  private selectByIdStmt: Statement;
  private selectRecentStmt: Statement;
  private selectBeforeStmt: Statement;
  private pruneStmt: Statement;
  private nextSeq = 0;
  private pending: Array<RequestLogEntry & { seq: number }> = [];
  private stats: GatewayStats = {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
  };
  private flushTimer: NodeJS.Timeout | null = null;
  private signalsRegistered = false;

  constructor(opts: RequestLogOptions = {}) {
    const dbPath = opts.dbPath ?? process.env.FREELLM_LOG_DB ?? "./data/request-logs.db";
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_request_logs_seq
        ON request_logs(seq DESC);
    `);

    // Migrate older DBs that predate the seq column.
    const cols = this.db
      .prepare(`PRAGMA table_info(request_logs)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "seq")) {
      this.db.exec(`ALTER TABLE request_logs ADD COLUMN seq INTEGER NOT NULL DEFAULT 0`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_request_logs_seq ON request_logs(seq DESC)`);
    }

    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO request_logs (
        id, seq, timestamp, status, requested_model, resolved_model, provider,
        latency_ms, prompt_tokens, completion_tokens, cached, streaming,
        finish_reason, error, chunk_count, request_body, response_body
      ) VALUES (
        @id, @seq, @timestamp, @status, @requested_model, @resolved_model, @provider,
        @latency_ms, @prompt_tokens, @completion_tokens, @cached, @streaming,
        @finish_reason, @error, @chunk_count, @request_body, @response_body
      )
    `);
    this.selectByIdStmt = this.db.prepare(`SELECT * FROM request_logs WHERE id = ?`);
    this.selectRecentStmt = this.db.prepare(
      `SELECT * FROM request_logs ORDER BY seq DESC LIMIT ?`
    );
    this.selectBeforeStmt = this.db.prepare(
      `SELECT * FROM request_logs WHERE seq < ? ORDER BY seq DESC LIMIT ?`
    );
    this.pruneStmt = this.db.prepare(`
      DELETE FROM request_logs WHERE id NOT IN (
        SELECT id FROM request_logs ORDER BY seq DESC LIMIT ${MAX_LOG_ENTRIES}
      )
    `);

    this.hydrateStats();
    const maxSeq = (
      this.db.prepare(`SELECT COALESCE(MAX(seq), -1) AS m FROM request_logs`).get() as {
        m: number;
      }
    ).m;
    this.nextSeq = maxSeq + 1;

    const intervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_MS;
    if (intervalMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), intervalMs);
      this.flushTimer.unref?.();
      this.registerShutdownHandlers();
    }
  }

  add(entry: Omit<RequestLogEntry, "id" | "timestamp">): RequestLogEntry {
    const full: RequestLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const seq = this.nextSeq++;
    this.pending.push({ ...full, seq });

    this.stats.totalRequests++;
    if (entry.status === "success") this.stats.successRequests++;
    else this.stats.failedRequests++;

    if (this.pending.length > MAX_LOG_ENTRIES) {
      this.flush();
    }
    return full;
  }

  getRecent(limit = 50): RequestLogEntry[] {
    const buffered = [...this.pending].sort((a, b) => b.seq - a.seq);
    const stripped: RequestLogEntry[] = buffered.map(({ seq: _s, ...e }) => e);
    if (stripped.length >= limit) return stripped.slice(0, limit);
    const remaining = limit - stripped.length;
    const seen = new Set(stripped.map((e) => e.id));
    const rows = this.selectRecentStmt.all(remaining + stripped.length) as Row[];
    const merged = [...stripped];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      merged.push(rowToEntry(r));
      if (merged.length >= limit) break;
    }
    return merged;
  }

  getById(id: string): RequestLogEntry | null {
    const buf = this.pending.find((e) => e.id === id);
    if (buf) return buf;
    const row = this.selectByIdStmt.get(id) as Row | undefined;
    return row ? rowToEntry(row) : null;
  }

  getPage({ limit, before }: PageQuery): PageResult {
    const beforeSeq = before != null ? Number(before) : null;
    const buffered = (
      beforeSeq != null
        ? this.pending.filter((e) => e.seq < beforeSeq)
        : [...this.pending]
    ).slice().sort((a, b) => b.seq - a.seq);

    const seen = new Set(buffered.map((e) => e.id));
    const mergedWithSeq: Array<{ entry: RequestLogEntry; seq: number }> = buffered
      .slice(0, limit)
      .map((e) => {
        const { seq, ...rest } = e;
        return { entry: rest as RequestLogEntry, seq };
      });

    if (mergedWithSeq.length < limit) {
      const cursorSeq =
        mergedWithSeq.length > 0
          ? mergedWithSeq[mergedWithSeq.length - 1]!.seq
          : beforeSeq;
      const rows =
        cursorSeq != null
          ? (this.selectBeforeStmt.all(cursorSeq, limit) as Row[])
          : (this.selectRecentStmt.all(limit) as Row[]);
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        mergedWithSeq.push({ entry: rowToEntry(r), seq: r.seq });
        if (mergedWithSeq.length >= limit) break;
      }
    }

    const nextBefore =
      mergedWithSeq.length === limit
        ? String(mergedWithSeq[mergedWithSeq.length - 1]!.seq)
        : null;
    return { requests: mergedWithSeq.map((m) => m.entry), nextBefore };
  }

  getStats(): GatewayStats {
    return { ...this.stats };
  }

  /** Snapshot pending, persist to DB in a single tx, prune to MAX_LOG_ENTRIES. */
  flush(): void {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    const insertAll = this.db.transaction(
      (entries: Array<RequestLogEntry & { seq: number }>) => {
      for (const e of entries) {
        this.insertStmt.run({
          id: e.id,
          seq: e.seq,
          timestamp: e.timestamp,
          status: e.status,
          requested_model: e.requestedModel,
          resolved_model: e.resolvedModel ?? null,
          provider: e.provider ?? null,
          latency_ms: e.latencyMs,
          prompt_tokens: e.promptTokens ?? null,
          completion_tokens: e.completionTokens ?? null,
          cached: e.cached ? 1 : 0,
          streaming: e.streaming ? 1 : 0,
          finish_reason: e.finishReason ?? null,
          error: e.error ?? null,
          chunk_count: e.chunkCount ?? null,
          request_body: serialize(e.requestBody),
          response_body: serialize(e.responseBody),
        });
      }
      this.pruneStmt.run();
    }
    );
    insertAll(batch);
  }

  /** Test helper: drop the in-memory buffer without persisting. */
  clearBuffer(): void {
    this.pending.length = 0;
  }

  /** Test helper: pending size after potential backpressure flush. */
  getPendingSize(): number {
    return this.pending.length;
  }

  close(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      this.flush();
    } catch {
      // best effort during shutdown
    }
    this.db.close();
  }

  private hydrateStats(): void {
    const rows = this.db
      .prepare(`SELECT status, count(*) AS c FROM request_logs GROUP BY status`)
      .all() as Array<{ status: string; c: number }>;
    for (const r of rows) {
      this.stats.totalRequests += r.c;
      if (r.status === "success") this.stats.successRequests += r.c;
      else this.stats.failedRequests += r.c;
    }
  }

  private registerShutdownHandlers(): void {
    if (this.signalsRegistered) return;
    this.signalsRegistered = true;
    const handler = () => {
      try {
        this.flush();
      } catch {
        // best effort
      }
    };
    process.once("SIGTERM", handler);
    process.once("SIGINT", handler);
    process.once("beforeExit", handler);
  }
}
