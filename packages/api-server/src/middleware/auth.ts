import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { freellmError } from "../errors/index.js";
import { getVirtualKeyStore } from "../gateway/virtual-keys-singleton.js";
import type { VirtualKey } from "../gateway/virtual-keys.js";
import {
  verifyBrowserToken,
  isBrowserTokenEnabled,
  BrowserTokenError,
  TOKEN_PREFIX,
  type BrowserTokenPayload,
} from "../gateway/browser-token.js";
import { parseCookieSession } from "../auth/session.js";

/** Hash a string to a fixed-length buffer for timing-safe comparison. */
function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/**
 * Express request augmentation: when a virtual key authenticated the
 * request, the chat route reads it back from `req.virtualKey` to enforce
 * its caps and model allowlist before routing to a provider. When a
 * browser token authenticated the request, `req.browserToken` carries
 * the verified payload so downstream routes can block token chaining
 * and consult the token's identifier + origin.
 */
declare global {
  namespace Express {
    interface Request {
      virtualKey?: VirtualKey;
      browserToken?: BrowserTokenPayload;
    }
  }
}

/**
 * Authentication middleware. Accepts two credential shapes:
 *
 *   1. The master key `FREELLM_API_KEY` via timing-safe comparison.
 *   2. A virtual key loaded from the configured virtual-keys file. The
 *      token itself is the full key id (e.g. `sk-freellm-portfolio-abc`).
 *
 * When both `FREELLM_API_KEY` is set and virtual keys are loaded, either
 * credential is accepted. This lets operators use a master key for
 * admin tooling while issuing per-app virtual keys with their own caps.
 *
 * If neither auth source is configured, requests pass through (local
 * dev mode). The server logs a warning at boot for this case.
 */
export function auth(req: Request, _res: Response, next: NextFunction): void {
  const requiredKey = process.env["FREELLM_API_KEY"];
  const adminKey = process.env["FREELLM_ADMIN_KEY"];
  const virtualKeyStore = getVirtualKeyStore();
  const hasVirtualKeys = virtualKeyStore.size() > 0;

  // Let non-API paths through to static files / SPA fallback.
  // The dashboard SPA handles its own auth gate client-side via /api/auth/me.
  if (!req.path.startsWith("/api/") && !req.path.startsWith("/v1/")) {
    next();
    return;
  }

  // Health check is always unauthenticated so Docker HEALTHCHECK works.
  // Dashboard auth endpoints (/auth/*) handle their own auth internally.
  if (
    req.path === "/api/healthz" ||
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/api/auth/")
  ) {
    next();
    return;
  }

  // Fully open gateway: no master key, no admin key, no virtual keys.
  if (!requiredKey && !adminKey && !hasVirtualKeys) {
    next();
    return;
  }

  // Dashboard session cookie — authenticated operator via browser login.
  if (parseCookieSession(req.headers.cookie)) {
    next();
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    next(
      freellmError({
        code: "missing_api_key",
        message: "Missing API key. Set Authorization: Bearer <key>.",
      }),
    );
    return;
  }

  // 1. Try master key (timing-safe).
  if (requiredKey) {
    try {
      if (timingSafeEqual(hashKey(token), hashKey(requiredKey))) {
        next();
        return;
      }
    } catch {
      // hashKey lengths are always equal, but be defensive.
    }
  }

  // 2. Try the admin key. The admin key is a superset privilege so
  //    the base auth layer accepts it; the adminAuth middleware then
  //    enforces the admin-only constraint on sensitive routes.
  if (adminKey) {
    try {
      if (timingSafeEqual(hashKey(token), hashKey(adminKey))) {
        next();
        return;
      }
    } catch {
      // Defensive: hash lengths are equal by construction.
    }
  }

  // 3. Try virtual keys. Constant-time comparison by hashing both
  //    before `.get()` would be overkill because the Map key is the
  //    full token string and lookup time leaks nothing useful once
  //    the token format is known. The format itself (`sk-freellm-`
  //    prefix) is public.
  if (hasVirtualKeys && token.startsWith("sk-freellm-")) {
    const virtualKey = virtualKeyStore.findByToken(token);
    if (virtualKey) {
      req.virtualKey = virtualKey;
      next();
      return;
    }
  }

  // 4. Try browser tokens. A valid flt.* bearer plus a matching Origin
  //    header authenticates the request and binds it to the token's
  //    identifier and optional virtual key. Browser tokens CANNOT
  //    authenticate against admin-only routes (the adminAuth middleware
  //    checks for FREELLM_ADMIN_KEY specifically), but otherwise they
  //    behave like a scoped bearer credential.
  if (token.startsWith(TOKEN_PREFIX) && isBrowserTokenEnabled()) {
    try {
      const payload = verifyBrowserToken({
        token,
        secret: process.env["FREELLM_TOKEN_SECRET"]!,
        expectedOrigin: req.headers["origin"] ?? null,
      });
      req.browserToken = payload;
      // If the token was minted by a virtual-key holder, hydrate
      // req.virtualKey so the chat route enforces its caps.
      if (payload.vk && hasVirtualKeys) {
        const vk = virtualKeyStore.findByToken(payload.vk);
        if (vk) req.virtualKey = vk;
      }
      // If the token carries an identifier, hint it onto the request so
      // the identifier-limit middleware picks it up through the header
      // path it already reads (set via req.headers mutation so the
      // existing middleware keeps its single code path).
      if (payload.identifier && !req.headers["x-freellm-identifier"]) {
        req.headers["x-freellm-identifier"] = payload.identifier;
      }
      next();
      return;
    } catch (err) {
      if (err instanceof BrowserTokenError) {
        next(
          freellmError({
            code: "invalid_api_key",
            message: `Browser token rejected: ${err.reason}`,
          }),
        );
        return;
      }
      next(err);
      return;
    }
  }

  next(
    freellmError({
      code: "invalid_api_key",
      message: "Invalid API key.",
    }),
  );
}
