import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { freellmError } from "../errors/index.js";
import { parseCookieSession } from "../auth/session.js";

function hashKey(key: string): Buffer {
  return createHash("sha256").update(key).digest();
}

/**
 * Admin-only auth for status/reset/routing endpoints.
 * Accepts: a valid dashboard session cookie, or Authorization: Bearer <admin-key>.
 * If FREELLM_ADMIN_KEY is not set, falls through (regular auth already handled it).
 */
export function adminAuth(req: Request, _res: Response, next: NextFunction): void {
  const adminKey = process.env["FREELLM_ADMIN_KEY"];

  if (!adminKey) {
    // No separate admin key — regular auth (if any) already handled it
    next();
    return;
  }

  // Dashboard session cookie is treated as admin
  if (parseCookieSession(req.headers.cookie)) {
    next();
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || !timingSafeEqual(hashKey(token), hashKey(adminKey))) {
    next(
      freellmError({
        code: "admin_required",
        message: "Admin access required. Set Authorization: Bearer <admin-key>.",
      }),
    );
    return;
  }

  next();
}
