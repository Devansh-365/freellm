import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/error-handler.js";
import { auth } from "./middleware/auth.js";
import { clientRateLimit } from "./middleware/rate-limit.js";

const app: Express = express();

// Trust reverse proxy (Railway, Render, etc.) so req.ip is the real client IP
app.set("trust proxy", 1);

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

// API key auth: only enforced when FREELLM_API_KEY is set
app.use(auth);

// Mount at /api (used by dashboard via proxy) and also at root (direct SDK access: base_url="/v1")
app.use("/api", router);
app.use("/", router);

app.use(errorHandler);

// In production, serve the dashboard as static files from the same process
const dashboardDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dashboard/dist/public",
);
app.use(express.static(dashboardDir));
// SPA fallback: serve index.html for any unmatched route (client-side routing)
app.get("*", (_req, res, next) => {
  res.sendFile(path.join(dashboardDir, "index.html"), (err) => {
    if (err) next();
  });
});

export default app;
