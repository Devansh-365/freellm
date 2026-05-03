import express, { type Express, type Request } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/error-handler.js";
import { auth } from "./middleware/auth.js";
import { clientRateLimit } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import { identifierLimit } from "./middleware/identifier-limit.js";

const app: Express = express();

// Trust reverse proxy (Railway, Render, etc.) so req.ip is the real client IP
app.set("trust proxy", 1);

// Request ID FIRST — must run before body-parser so errors thrown by
// express.json() (e.g. SyntaxError on malformed JSON) still carry an id.
app.use(requestId);

// CORS: restrict origins in production via ALLOWED_ORIGINS env var
const allowedOrigins = process.env["ALLOWED_ORIGINS"];
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

// In production, serve the dashboard static files (HTML/JS/CSS) before auth
// so a browser can load the SPA shell without a bearer token. The app-level
// login page then handles authentication via session cookie.
const dashboardDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dashboard/dist/public",
);
app.use(express.static(dashboardDir));

// Per-client rate limiting (by IP)
app.use(clientRateLimit);

// API key auth: only enforced when FREELLM_API_KEY is set OR virtual keys
// are loaded. Auth populates req.virtualKey for chat route cap enforcement.
app.use(auth);

// Per-identifier rate limit runs AFTER auth so it only sees authenticated
// traffic. Health checks are exempt internally.
app.use(identifierLimit);

// Mount at /api (used by dashboard via proxy) and also at root (direct SDK access: base_url="/v1")
app.use("/api", router);
app.use("/", router);

app.use(errorHandler);

// SPA fallback: serve index.html for client-side routes (e.g. /models, /quickstart)
// that don't match any static file or API route.
app.use((_req, res, next) => {
  res.sendFile(path.join(dashboardDir, "index.html"), (err) => {
    if (err) next();
  });
});

export default app;
