import { Router, type IRouter, type NextFunction } from "express";
import { registry, router as gatewayRouter } from "../../gateway/index.js";
import type { RoutingStrategy } from "../../gateway/types.js";
import { validate } from "../../middleware/validate.js";
import { updateRoutingSchema } from "../../gateway/schemas.js";
import { adminAuth } from "../../middleware/admin-auth.js";
import { freellmError } from "../../errors/index.js";
import { getVirtualKeyStore } from "../../gateway/virtual-keys-singleton.js";
import {
  isBrowserTokenEnabled,
  MIN_SECRET_BYTES,
  MAX_TTL_SECONDS,
} from "../../gateway/browser-token.js";
import type { BrowserTokensInfo } from "../../gateway/types.js";

function browserTokensInfo(): BrowserTokensInfo {
  return {
    enabled: isBrowserTokenEnabled(),
    minSecretBytes: MIN_SECRET_BYTES,
    maxTtlSeconds: MAX_TTL_SECONDS,
  };
}

const statusRouter: IRouter = Router();

// Admin auth for mutation endpoints (reset, routing strategy changes)
// and for the virtual-keys inventory (sensitive, operator-only).
statusRouter.post("/providers/:providerId/reset", adminAuth);
statusRouter.patch("/routing", adminAuth);
statusRouter.get("/virtual-keys", adminAuth);
statusRouter.get("/requests", adminAuth);
statusRouter.get("/requests/:id", adminAuth);

statusRouter.get("/", (_req, res) => {
  const stats = gatewayRouter.requestLog.getStats();
  const recentRequests = gatewayRouter.requestLog.getRecent(50);
  const { byProvider, gateway } = gatewayRouter.usageTracker.getAllTotals();
  const cacheStats = gatewayRouter.cache.getStats();

  res.json({
    routingStrategy: gatewayRouter.strategy,
    totalRequests: stats.totalRequests,
    successRequests: stats.successRequests,
    failedRequests: stats.failedRequests,
    providers: registry.getStatusAll(byProvider),
    recentRequests,
    usage: gateway,
    cache: cacheStats,
    browserTokens: browserTokensInfo(),
  });
});

statusRouter.post("/providers/:providerId/reset", (req, res, next: NextFunction) => {
  const { providerId } = req.params;
  const provider = registry.getById(providerId);

  if (!provider) {
    next(
      freellmError({
        code: "provider_not_found",
        message: `Provider not found: ${providerId}`,
      }),
    );
    return;
  }

  provider.resetCircuitBreaker();
  const stats = provider.getStats();
  const keys = provider.getKeysStatus();
  const usage = gatewayRouter.usageTracker.getTotals(provider.id);

  res.json({
    id: provider.id,
    name: provider.name,
    enabled: provider.isEnabled(),
    circuitBreakerState: provider.getCircuitBreakerState(),
    totalRequests: stats.totalRequests,
    successRequests: stats.successRequests,
    failedRequests: stats.failedRequests,
    rateLimitedRequests: stats.rateLimitedRequests,
    lastError: stats.lastError ?? null,
    lastUsedAt: stats.lastUsedAt ?? null,
    models: provider.models.map((m) => m.id),
    keyCount: keys.length,
    keysAvailable: keys.filter((k) => !k.rateLimited).length,
    keys,
    usage,
  });
});

/**
 * Operator inventory of loaded virtual sub-keys and their current usage.
 * The raw key token is replaced by a masked id so a screen-share from the
 * dashboard cannot leak bearer tokens. Caps and usage are live.
 */
statusRouter.get("/virtual-keys", (_req, res) => {
  const store = getVirtualKeyStore();
  const now = Date.now();
  const keys = store.list().map((key) => {
    const usage = store.usage(key.id, now);
    const maskedId =
      key.id.length <= 12
        ? key.id
        : `${key.id.slice(0, 12)}...${key.id.slice(-4)}`;
    const expiresAtMs = key.expiresAt ? Date.parse(key.expiresAt) : null;
    const expired = expiresAtMs != null && Number.isFinite(expiresAtMs) && now > expiresAtMs;
    return {
      maskedId,
      label: key.label,
      allowedModels: key.allowedModels ?? null,
      expiresAt: key.expiresAt ?? null,
      expired,
      dailyRequestCap: key.dailyRequestCap ?? null,
      dailyTokenCap: key.dailyTokenCap ?? null,
      requestsInWindow: usage?.requestsInWindow ?? 0,
      tokensInWindow: usage?.tokensInWindow ?? 0,
      requestCapRemaining: usage?.requestCapRemaining ?? null,
      tokenCapRemaining: usage?.tokenCapRemaining ?? null,
    };
  });
  res.json({
    softCapWarning:
      "Counters are in-memory, rolling 24h, and reset on process restart. Not a billing system.",
    count: keys.length,
    keys,
  });
});

statusRouter.get("/requests", (req, res) => {
  const rawLimit = parseInt(String(req.query["limit"] ?? "100"), 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 100 : rawLimit, 500);
  const before = typeof req.query["before"] === "string" ? req.query["before"] : undefined;

  const { requests, nextBefore } = gatewayRouter.requestLog.getPage({ limit, before });
  const stripped = requests.map(({ requestBody: _rb, responseBody: _rsp, ...rest }) => rest);
  res.json({ requests: stripped, nextBefore });
});

statusRouter.get("/requests/:id", (req, res) => {
  const entry = gatewayRouter.requestLog.getById(req.params["id"] as string);
  if (!entry) {
    res.status(404).json({ error: { message: `Request log entry not found: ${req.params["id"]}` } });
    return;
  }
  res.json(entry);
});

statusRouter.patch("/routing", validate(updateRoutingSchema), (req, res) => {
  const { strategy } = req.body as { strategy: RoutingStrategy };

  gatewayRouter.strategy = strategy;
  const stats = gatewayRouter.requestLog.getStats();
  const recentRequests = gatewayRouter.requestLog.getRecent(50);
  const { byProvider, gateway } = gatewayRouter.usageTracker.getAllTotals();
  const cacheStats = gatewayRouter.cache.getStats();

  res.json({
    routingStrategy: gatewayRouter.strategy,
    totalRequests: stats.totalRequests,
    successRequests: stats.successRequests,
    failedRequests: stats.failedRequests,
    providers: registry.getStatusAll(byProvider),
    recentRequests,
    usage: gateway,
    cache: cacheStats,
    browserTokens: browserTokensInfo(),
  });
});

export default statusRouter;
