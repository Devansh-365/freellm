import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import request from "supertest";
/**
 * Dashboard access with auth configured (GitHub issue #2).
 *
 * Auth guards the API prefixes (/v1, /api) only. The dashboard's static
 * assets and SPA shell must load in a plain browser tab with no
 * Authorization header, so the dashboard can show its own sign-in screen.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const API_KEY = "master-key-for-dashboard-access-test";
const BEARER = `Bearer ${API_KEY}`;
const INDEX_HTML = "<!doctype html><html><body><div id=root></div>dashboard-shell</body></html>";

let tmpDir: string;
let app: Express;

beforeAll(async () => {
  // A fake dashboard build so static + SPA fallback are deterministic
  // whether or not apps/dashboard/dist exists on this machine.
  tmpDir = mkdtempSync(path.join(tmpdir(), "freellm-dashboard-access-"));
  mkdirSync(path.join(tmpDir, "assets"));
  writeFileSync(path.join(tmpDir, "index.html"), INDEX_HTML);
  writeFileSync(path.join(tmpDir, "assets", "app.js"), "console.log('dashboard');");

  process.env.FREELLM_DASHBOARD_DIR = tmpDir;
  process.env.FREELLM_API_KEY = API_KEY;
  delete process.env.FREELLM_ADMIN_KEY;
  process.env.RATE_LIMIT_RPM = "100000";
  process.env.FREELLM_IDENTIFIER_LIMIT = "1000/60000";
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9999";
  process.env.OLLAMA_MODELS = "llama3";

  const mod = await import("../src/app.js");
  app = mod.default;
});

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("dashboard is publicly loadable when an API key is set", () => {
  it("serves index.html at / without a key", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("dashboard-shell");
  });

  it("serves static assets without a key", async () => {
    const res = await request(app).get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.text).toContain("dashboard");
  });

  it("serves the SPA shell for client-side routes like /models", async () => {
    const res = await request(app).get("/models");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("dashboard-shell");
  });

  it("does not apply the per-identifier limit to dashboard pages", async () => {
    const res = await request(app).get("/quickstart");
    expect(res.status).toBe(200);
    expect(res.headers["x-freellm-identifier"]).toBeUndefined();
  });
});

describe("API routes still require the key", () => {
  it("GET /v1/models without a key is 401 missing_api_key", async () => {
    const res = await request(app).get("/v1/models");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_api_key");
  });

  it("GET /api/v1/status without a key is 401 missing_api_key", async () => {
    const res = await request(app).get("/api/v1/status");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("missing_api_key");
  });

  it("GET /api/v1/status with a wrong key is 401 invalid_api_key", async () => {
    const res = await request(app).get("/api/v1/status").set("authorization", "Bearer nope");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_api_key");
  });

  it("unknown /api and /v1 paths stay behind auth instead of falling through to the SPA", async () => {
    const api = await request(app).get("/api/not-a-route");
    expect(api.status).toBe(401);
    const v1 = await request(app).get("/v1/healthz");
    expect(v1.status).toBe(401);
  });

  it("GET /v1/models with the key is 200", async () => {
    const res = await request(app).get("/v1/models").set("authorization", BEARER);
    expect(res.status).toBe(200);
    expect(res.body.object).toBe("list");
  });

  it("GET /api/v1/status with the key is 200", async () => {
    const res = await request(app).get("/api/v1/status").set("authorization", BEARER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("providers");
  });

  it("authenticated API responses still carry identifier headers", async () => {
    const res = await request(app).get("/v1/models").set("authorization", BEARER);
    expect(res.headers["x-freellm-identifier"]).toBeTypeOf("string");
  });
});

describe("health checks stay open", () => {
  it("GET /healthz is 200 without a key", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/healthz is 200 without a key", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
