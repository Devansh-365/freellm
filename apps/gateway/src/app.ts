import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import cors from "cors";
import express, { type Express, type Request } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger } from "./logger";
import { auth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { identifierLimit } from "./middleware/identifier-limit.js";
import { clientRateLimit } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import router from "./routes";

const app: Express = express();

// Trust reverse proxy (Railway, Render, etc.) so req.ip is the real client IP
app.set("trust proxy", 1);

// Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(
  helmet({
    contentSecurityPolicy: false, // disabled: dashboard is a SPA served as static files
  }),
);

// Response compression for JSON/SSE payloads
app.use(compression());

// Request ID FIRST — must run before body-parser so errors thrown by
// express.json() (e.g. SyntaxError on malformed JSON) still carry an id.
app.use(requestId);

// CORS: restrict origins in production via ALLOWED_ORIGINS env var
const allowedOrigins = process.env.ALLOWED_ORIGINS;
app.use(
  cors(
    allowedOrigins
      ? { origin: allowedOrigins.split(",").map((o) => o.trim()), credentials: true }
      : undefined,
  ),
);

app.use(
  pinoHttp({
    logger,
    // Reuse the id assigned by the request-id middleware so a single
    // request_id threads through access logs, error logs, and responses.
    genReqId: (req) => (req as Request).id,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Per-client rate limiting (by IP)
app.use(clientRateLimit);

// Auth and the per-identifier limit guard the API only. The dashboard's
// static assets and SPA shell below hold no secrets, so a browser can load
// them and then sign in with a key. Every API route lives under one of
// these prefixes; /healthz sits outside them and /api/healthz is exempted
// inside both middlewares, so Docker HEALTHCHECK keeps working.
const API_PREFIXES = ["/v1", "/api"];

// API key auth: only enforced when FREELLM_API_KEY is set OR virtual keys
// are loaded. Auth populates req.virtualKey for chat route cap enforcement.
app.use(API_PREFIXES, auth);

// Per-identifier rate limit runs AFTER auth so it only sees authenticated
// traffic. Health checks are exempt internally.
app.use(API_PREFIXES, identifierLimit);

// Mount at /api (used by dashboard via proxy) and also at root (direct SDK access: base_url="/v1")
app.use("/api", router);
app.use("/", router);

app.use(errorHandler);

// In production, serve the dashboard as static files from the same process.
// FREELLM_DASHBOARD_DIR overrides the location (used by tests).
const dashboardDir =
  process.env.FREELLM_DASHBOARD_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard/dist/public");
app.use(express.static(dashboardDir));
// SPA fallback: serve index.html for any unmatched route (client-side routing)
app.use((_req, res, next) => {
  res.sendFile(path.join(dashboardDir, "index.html"), (err) => {
    if (err) next();
  });
});

export default app;
