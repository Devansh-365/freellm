import app from "./app.js";
import { logger } from "./lib/logger.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

if (process.env["NODE_ENV"] === "production" && !process.env["FREELLM_API_KEY"]) {
  logger.warn("FREELLM_API_KEY is not set -- gateway is open to the internet without authentication");
}

const server = app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, "FreeLLM gateway listening");
});

// Graceful shutdown: drain in-flight requests before exiting
function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received, draining connections...");
  server.close(() => {
    logger.info("All connections drained, exiting.");
    process.exit(0);
  });
  // Force exit if drain takes too long (Railway gives 10s)
  setTimeout(() => {
    logger.warn("Forcefully shutting down after timeout.");
    process.exit(1);
  }, 8000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
