import type { Request, Response, NextFunction } from "express";

/**
 * Optional API key authentication.
 * If FREELLM_API_KEY is set, every request must include a matching
 * Authorization: Bearer <key> header. If not set, all requests pass through.
 */
export function auth(req: Request, res: Response, next: NextFunction): void {
  const requiredKey = process.env["FREELLM_API_KEY"];

  if (!requiredKey) {
    next();
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (token !== requiredKey) {
    res.status(401).json({
      error: {
        message: "Invalid or missing API key. Set Authorization: Bearer <key>.",
        type: "authentication_error",
      },
    });
    return;
  }

  next();
}
