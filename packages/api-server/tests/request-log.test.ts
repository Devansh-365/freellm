/**
 * Unit tests for SQLite-backed RequestLog with batched flush cycle.
 *
 * Critical invariants:
 *   1. add() is non-blocking — entries land in pending buffer first.
 *   2. getById() finds buffer-only entries before flush, DB after.
 *   3. flush() persists pending atomically and prunes to 500 newest.
 *   4. getStats() hydrates from DB on construction.
 *   5. Backpressure: pending > 500 trims oldest from RAM, no sync DB write.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestLog } from "../src/gateway/request-log.js";
import type { RequestLogEntry } from "../src/gateway/types.js";

let tmpDir: string;
let dbPath: string;
let log: RequestLog | null = null;

function makeEntry(
  overrides: Partial<Omit<RequestLogEntry, "id" | "timestamp">> = {}
): Omit<RequestLogEntry, "id" | "timestamp"> {
  return {
    requestedModel: "llama3",
    latencyMs: 10,
    status: "success",
    streaming: false,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "freellm-reqlog-"));
  dbPath = join(tmpDir, "logs.db");
});

afterEach(() => {
  log?.close();
  log = null;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("RequestLog (SQLite-backed)", () => {
  it("add() returns entry with id+timestamp; getRecent reads from buffer pre-flush", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    const e = log.add(makeEntry({ requestBody: { foo: 1 } }));
    expect(e.id).toBeTruthy();
    expect(e.timestamp).toBeTruthy();
    const recent = log.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.id).toBe(e.id);
  });

  it("getById finds buffer-only entry pre-flush", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    const e = log.add(makeEntry({ requestBody: { hello: "world" } }));
    const found = log.getById(e.id);
    expect(found?.id).toBe(e.id);
    expect(found?.requestBody).toEqual({ hello: "world" });
  });

  it("flush() moves pending into DB; getById finds entry after flush", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    const e = log.add(makeEntry({ requestBody: { x: 1 }, responseBody: { y: 2 } }));
    log.flush();
    log.clearBuffer();
    const found = log.getById(e.id);
    expect(found?.id).toBe(e.id);
    expect(found?.requestBody).toEqual({ x: 1 });
    expect(found?.responseBody).toEqual({ y: 2 });
  });

  it("retention prunes to 500 newest after flush", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    for (let i = 0; i < 510; i++) {
      log.add(makeEntry({ requestedModel: `m${i}` }));
    }
    log.flush();
    const recent = log.getRecent(1000);
    expect(recent.length).toBe(500);
    expect(recent[0]!.requestedModel).toBe("m509");
  });

  it("stats track total / success / failed", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    log.add(makeEntry({ status: "success" }));
    log.add(makeEntry({ status: "error" }));
    log.add(makeEntry({ status: "rate_limited" }));
    const s = log.getStats();
    expect(s.totalRequests).toBe(3);
    expect(s.successRequests).toBe(1);
    expect(s.failedRequests).toBe(2);
  });

  it("stats hydrate from DB on reopen", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    log.add(makeEntry({ status: "success" }));
    log.add(makeEntry({ status: "error" }));
    log.flush();
    log.close();
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    const s = log.getStats();
    expect(s.totalRequests).toBe(2);
    expect(s.successRequests).toBe(1);
    expect(s.failedRequests).toBe(1);
  });

  it("getPage paginates with before-cursor", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    for (let i = 0; i < 10; i++) {
      log.add(makeEntry({ requestedModel: `m${i}` }));
    }
    log.flush();
    const page1 = log.getPage({ limit: 4 });
    expect(page1.requests.length).toBe(4);
    expect(page1.nextBefore).toBeTruthy();
    const page2 = log.getPage({ limit: 4, before: page1.nextBefore! });
    expect(page2.requests.length).toBe(4);
    expect(page2.requests[0]!.id).not.toBe(page1.requests[3]!.id);
  });

  it("backpressure: trims RAM to 500 without flushing to DB", () => {
    log = new RequestLog({ dbPath, flushIntervalMs: 0 });
    for (let i = 0; i < 600; i++) {
      log.add(makeEntry({ requestedModel: `m${i}` }));
    }
    expect(log.getPendingSize()).toBe(500);
    // newest entries kept — oldest dropped
    const recent = log.getRecent(500);
    expect(recent[0]!.requestedModel).toBe("m599");
    expect(recent[499]!.requestedModel).toBe("m100");
  });
});
