import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { router as gatewayRouter, AllProvidersExhaustedError, ProviderClientError } from "../../gateway/index.js";
import { logger } from "../../lib/logger.js";
import type { ChatCompletionRequest } from "../../gateway/types.js";
import { validate } from "../../middleware/validate.js";
import { chatCompletionRequestSchema } from "../../gateway/schemas.js";

const chatRouter = Router();

chatRouter.post("/completions", validate(chatCompletionRequestSchema), async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body as ChatCompletionRequest;

  if (body.stream) {
    await handleStreamingRequest(req, res, body);
  } else {
    await handleNonStreamingRequest(req, res, body, next);
  }
});

async function handleNonStreamingRequest(
  _req: Request,
  res: Response,
  body: ChatCompletionRequest,
  next: NextFunction,
) {
  try {
    const data = await gatewayRouter.complete(body);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function handleStreamingRequest(
  req: Request,
  res: Response,
  body: ChatCompletionRequest,
) {
  const startTime = Date.now();

  try {
    const { response, provider, resolvedModel, latencyMs } =
      await gatewayRouter.routeStream(body);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-FreeLLM-Provider", provider.id);
    res.flushHeaders();

    if (!response.body) {
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        resolvedModel,
        provider: provider.id,
        latencyMs,
        status: "success",
        streaming: true,
      });
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          res.write(decoder.decode(value, { stream: true }));
        }
      }

      // Log success once — provider.onSuccess() was already called in route()
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        resolvedModel,
        provider: provider.id,
        latencyMs,
        status: "success",
        streaming: true,
      });
    } catch (streamErr) {
      // Stream read failed after headers were sent
      const elapsed = Date.now() - startTime;
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        resolvedModel,
        provider: provider.id,
        latencyMs: elapsed,
        status: "error",
        error: String(streamErr),
        streaming: true,
      });
      logger.error({ err: streamErr }, "Stream relay error");
    }

    res.end();
  } catch (err) {
    const elapsed = Date.now() - startTime;

    if (err instanceof ProviderClientError) {
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        latencyMs: elapsed,
        status: "error",
        error: err.message,
        streaming: true,
      });
      if (!res.headersSent) {
        const payload = await err.upstreamResponse.json().catch(() => ({
          error: { message: err.message, type: "provider_error" },
        }));
        res.status(err.statusCode).json(payload);
      }
      return;
    }

    if (err instanceof AllProvidersExhaustedError) {
      // Log the exhaustion before responding
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        latencyMs: elapsed,
        status: "all_providers_failed",
        error: err.message,
        streaming: true,
      });

      if (!res.headersSent) {
        res.status(429).json({
          error: {
            message: err.message,
            type: "rate_limit_error",
            code: "all_providers_exhausted",
          },
        });
        return;
      }
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    logger.error({ err }, "Streaming gateway error");
    gatewayRouter.requestLog.add({
      requestedModel: body.model,
      latencyMs: elapsed,
      status: "error",
      error: String(err),
      streaming: true,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: { message: "Gateway error", type: "internal_error" },
      });
    } else {
      res.end();
    }
  }
}

export default chatRouter;
