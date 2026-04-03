import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler } from "./middleware/error-handler.js";
import { auth } from "./middleware/auth.js";

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API key auth: only enforced when FREELLM_API_KEY is set
app.use(auth);

// Mount at /api (used by dashboard via proxy) and also at root (direct SDK access: base_url="/v1")
app.use("/api", router);
app.use("/", router);

app.use(errorHandler);

export default app;
