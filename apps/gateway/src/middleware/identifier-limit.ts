import type { NextFunction, Request, Response } from "express";
import { freellmError } from "../errors/index.js";
import { IdentifierLimiter, parseIdentifierLimitEnv } from "../features/identifier-limiter.js";

/**
 * Per-identifier rate-limit middleware.
 *
 * Reads the `X-FreeLLM-Identifier` header, sanitizes it, and buckets
 * each request against a sliding-window limiter keyed on the result.
 * Emits `X-FreeLLM-Identifier` (what we actually used), `-Remaining`,
 * and `-Reset` response headers so clients can see their own budget.
 *
 * Fallback rules:
 *   1. No header → use `ip:<client-ip>`
 *   2. Literal string "undefined" or "null" → treat as missing
 *   3. Fails the safe-char regex → reject with `invalid_request`
 *      (we never silently accept a tainted value into logs)
 *
 * The limiter is a module-level singleton so every request hits the
 * same Map.
 */

const SAFE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const EXPLICITLY_NULL = new Set(["undefined", "null", ""]);

const limiter = new IdentifierLimiter(
  parseIdentifierLimitEnv(
    process.env.FREELLM_IDENTIFIER_LIMIT,
    Number.parseInt(process.env.FREELLM_IDENTIFIER_MAX_BUCKETS ?? "10000", 10),
  ),
);

export function resetIdentifierLimiter(): void {
  limiter.reset();
}

export function identifierLimiterSize(): number {
  return limiter.size();
}

export function identifierLimit(req: Request, res: Response, next: NextFunction): void {
  // Health checks bypass every quota. baseUrl + path is the full path
  // even when this middleware is mounted under a prefix.
  const fullPath = req.baseUrl + req.path;
  if (fullPath === "/healthz" || fullPath === "/api/healthz") {
    next();
    return;
  }

  const raw = req.header("x-freellm-identifier");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const normalized = trimmed.toLowerCase();

  let identifier: string;
  if (trimmed.length === 0 || EXPLICITLY_NULL.has(normalized)) {
    // Missing or explicitly null: fall back to the real client IP.
    const ip = req.ip ?? "unknown";
    identifier = `ip:${ip}`;
  } else if (!SAFE_PATTERN.test(trimmed)) {
    // Tainted value. Reject loudly rather than let it into logs.
    next(
      freellmError({
        code: "invalid_request",
        message: "X-FreeLLM-Identifier must match ^[A-Za-z0-9_.:-]{1,128}$ or be omitted.",
      }),
    );
    return;
  } else {
    identifier = trimmed;
  }

  const result = limiter.checkAndRecord(identifier);

  // Always surface the decision as headers so callers can self-throttle.
  res.setHeader("X-FreeLLM-Identifier", result.identifier);
  res.setHeader("X-FreeLLM-Identifier-Remaining", String(result.remaining));
  res.setHeader("X-FreeLLM-Identifier-Reset", String(result.resetAfterMs));

  if (!result.allowed) {
    next(
      freellmError({
        code: "identifier_rate_limited",
        message: `Identifier "${result.identifier}" exceeded its rate limit. Retry in ${Math.ceil(result.resetAfterMs / 1000)}s.`,
        retry_after_ms: result.resetAfterMs,
      }),
    );
    return;
  }

  next();
}
