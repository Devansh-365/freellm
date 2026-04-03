import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { AllProvidersExhaustedError, ProviderClientError } from "../gateway/index.js";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof ProviderClientError) {
    err.upstreamResponse
      .json()
      .then((body) => res.status(err.statusCode).json(body))
      .catch(() =>
        res.status(err.statusCode).json({
          error: { message: err.message, type: "provider_error" },
        }),
      );
    return;
  }

  if (err instanceof AllProvidersExhaustedError) {
    res.status(429).json({
      error: {
        message: err.message,
        type: "rate_limit_error",
        code: "all_providers_exhausted",
      },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: { message: "Internal server error", type: "internal_error" },
  });
}
