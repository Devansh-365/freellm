import { Router } from "express";
import type { Request, Response } from "express";
import { router as gatewayRouter, AllProvidersExhaustedError } from "../../gateway/index.js";
import { logger } from "../../lib/logger.js";
import type { ChatCompletionRequest } from "../../gateway/types.js";

const chatRouter = Router();

chatRouter.post("/completions", async (req: Request, res: Response) => {
  const body = req.body as ChatCompletionRequest;

  if (!body.model || !body.messages || !Array.isArray(body.messages)) {
    res.status(400).json({
      error: {
        message: "Invalid request: model and messages are required",
        type: "invalid_request_error",
      },
    });
    return;
  }

  if (body.stream) {
    await handleStreamingRequest(req, res, body);
  } else {
    await handleNonStreamingRequest(res, body);
  }
});

async function handleNonStreamingRequest(
  res: Response,
  body: ChatCompletionRequest,
) {
  try {
    const data = await gatewayRouter.complete(body);
    res.json(data);
  } catch (err) {
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
    logger.error({ err }, "Gateway error");
    res.status(500).json({
      error: { message: "Gateway error", type: "internal_error" },
    });
  }
}

async function handleStreamingRequest(
  req: Request,
  res: Response,
  body: ChatCompletionRequest,
) {
  try {
    const { response, provider, resolvedModel, latencyMs } =
      await gatewayRouter.routeStream(body);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-FreeLLM-Provider", provider.id);
    res.flushHeaders();

    if (!response.body) {
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        res.write(decoder.decode(value, { stream: true }));
      }
    }

    provider.onSuccess();
    gatewayRouter.requestLog.add({
      requestedModel: body.model,
      resolvedModel,
      provider: provider.id,
      latencyMs,
      status: "success",
      streaming: true,
    });

    res.end();
  } catch (err) {
    if (err instanceof AllProvidersExhaustedError) {
      if (!res.headersSent) {
        res.status(429).json({
          error: {
            message: (err as Error).message,
            type: "rate_limit_error",
            code: "all_providers_exhausted",
          },
        });
        return;
      }
      res.write(`data: ${JSON.stringify({ error: { message: (err as Error).message } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    logger.error({ err }, "Streaming gateway error");
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
