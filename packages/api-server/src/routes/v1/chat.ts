import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { router as gatewayRouter, AllProvidersExhaustedError, ProviderClientError } from "../../gateway/index.js";
import { logger } from "../../lib/logger.js";
import type { ChatCompletionRequest } from "../../gateway/types.js";
import type { RouteMeta } from "../../gateway/router.js";
import { validate } from "../../middleware/validate.js";
import { chatCompletionRequestSchema } from "../../gateway/schemas.js";
import { parseStrictHeader } from "../../gateway/strict.js";
import { parsePrivacyHeader } from "../../gateway/privacy.js";
import { getVirtualKeyStore } from "../../gateway/virtual-keys-singleton.js";
import { VirtualKeyCheckError, type VirtualKey } from "../../gateway/virtual-keys.js";
import { freellmError } from "../../errors/index.js";
import { StreamingPipeline } from "../../gateway/streaming/pipeline.js";
import { serializeHeartbeat } from "../../gateway/streaming/sse.js";

const STREAM_IDLE_TIMEOUT_MS = parseInt(
  process.env["STREAM_IDLE_TIMEOUT_MS"] ?? "30000",
  10,
);

const chatRouter: IRouter = Router();

/** Set the X-FreeLLM-* observability headers on a response. */
function setRouteHeaders(res: Response, meta: RouteMeta): void {
  res.setHeader("X-FreeLLM-Provider", meta.provider);
  res.setHeader("X-FreeLLM-Model", meta.resolvedModel);
  res.setHeader("X-FreeLLM-Requested-Model", meta.requestedModel);
  res.setHeader("X-FreeLLM-Cached", meta.cached ? "true" : "false");
  res.setHeader("X-FreeLLM-Route-Reason", meta.reason);
}

/**
 * Translate a VirtualKeyCheckError into the public FreeLLMError taxonomy.
 * Called once from the common virtual-key guard below.
 */
function virtualKeyCheckToFreeLLMError(err: VirtualKeyCheckError) {
  switch (err.reason) {
    case "expired":
      return freellmError({
        code: "invalid_api_key",
        message: err.message,
      });
    case "model_not_allowed":
      return freellmError({
        code: "model_not_supported",
        message: err.message,
      });
    case "request_cap_reached":
    case "token_cap_reached":
      return freellmError({
        code: "virtual_key_cap_reached",
        message: err.message,
      });
  }
}

/**
 * Enforce virtual-key constraints before routing. Throws a FreeLLMError
 * (via the SDK) when the key is expired, does not allow the model, or has
 * exhausted its rolling-window cap. Returns the key on success so the
 * caller can record usage after the upstream responds.
 */
function guardVirtualKey(req: Request, model: string): VirtualKey | undefined {
  const key = req.virtualKey;
  if (!key) return undefined;
  try {
    getVirtualKeyStore().assertCanServe(key, model);
  } catch (err) {
    if (err instanceof VirtualKeyCheckError) {
      throw virtualKeyCheckToFreeLLMError(err);
    }
    throw err;
  }
  return key;
}

chatRouter.post("/completions", validate(chatCompletionRequestSchema), async (req: Request, res: Response, next: NextFunction) => {
  const body = req.body as ChatCompletionRequest;
  const strict = parseStrictHeader(req.header("x-freellm-strict"));
  const privacy = parsePrivacyHeader(req.header("x-freellm-privacy"));

  // Virtual key guard runs before routing. Errors here never touch upstream.
  let virtualKey: VirtualKey | undefined;
  try {
    virtualKey = guardVirtualKey(req, body.model);
  } catch (err) {
    return next(err);
  }

  if (body.stream) {
    await handleStreamingRequest(req, res, body, strict, privacy, virtualKey, next);
  } else {
    await handleNonStreamingRequest(req, res, body, strict, privacy, virtualKey, next);
  }
});

async function handleNonStreamingRequest(
  _req: Request,
  res: Response,
  body: ChatCompletionRequest,
  strict: boolean,
  privacy: "any" | "no-training",
  virtualKey: VirtualKey | undefined,
  next: NextFunction,
) {
  try {
    const { data, meta } = await gatewayRouter.complete(body, { strict, privacy });
    setRouteHeaders(res, meta);

    // Record usage against the virtual key AFTER a successful upstream
    // response so failed routes never eat quota.
    if (virtualKey) {
      const tokens =
        (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
      getVirtualKeyStore().recordRequest(virtualKey, tokens);
    }

    // Warn callers when a JSON-mode response was likely truncated by max_tokens.
    const fmt = body.response_format?.type;
    if (
      (fmt === "json_object" || fmt === "json_schema") &&
      data.choices?.[0]?.finish_reason === "length"
    ) {
      res.setHeader("X-FreeLLM-Warning", "json-possibly-truncated");
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function handleStreamingRequest(
  _req: Request,
  res: Response,
  body: ChatCompletionRequest,
  strict: boolean,
  privacy: "any" | "no-training",
  virtualKey: VirtualKey | undefined,
  next: NextFunction,
) {
  const startTime = Date.now();

  try {
    const { response, provider, resolvedModel, latencyMs, attempted, failoverCount } =
      await gatewayRouter.routeStream(body, { strict, privacy });

    const meta: RouteMeta = {
      provider: provider.id,
      resolvedModel,
      requestedModel: body.model,
      cached: false,
      reason: failoverCount > 0 ? "failover" : body.model.startsWith("free") ? "meta" : "direct",
      attempted,
    };

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    setRouteHeaders(res, meta);
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
      // Streaming responses don't expose token counts until the provider
      // sends a usage chunk (which some don't emit at all). Record the
      // request itself against the virtual key cap but pass tokens=0; the
      // rolling-window request cap is the protective control here.
      if (virtualKey) {
        getVirtualKeyStore().recordRequest(virtualKey, 0);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const pipeline = new StreamingPipeline(provider.id);

    // Detect client disconnect and cancel the upstream reader so we
    // don't keep burning provider quota into a dead socket.
    let clientClosed = false;
    res.on("close", () => {
      if (!res.writableEnded) {
        clientClosed = true;
        reader.cancel().catch(() => {});
      }
    });

    // Idle heartbeat. Prevents proxies on the path (Railway, Cloudflare,
    // etc.) from dropping a slow stream. Ticks every STREAM_IDLE_TIMEOUT_MS
    // regardless of traffic. Cheap SSE comment, no client-side parse cost.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(serializeHeartbeat());
      }
    }, STREAM_IDLE_TIMEOUT_MS);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (clientClosed) break;
        if (done) break;
        if (value) {
          const decoded = decoder.decode(value, { stream: true });
          const normalized = pipeline.push(decoded);
          if (normalized.length > 0) res.write(normalized);
        }
      }

      // Drain any final event buffered by the pipeline.
      const tail = pipeline.flush();
      if (tail.length > 0) res.write(tail);

      // Log success once, provider.onSuccess was already called in route()
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        resolvedModel,
        provider: provider.id,
        latencyMs,
        status: "success",
        streaming: true,
        requestBody: body,
        responseBody: pipeline.getAccumulated(),
        chunkCount: pipeline.getChunkCount(),
      });
      if (virtualKey) {
        getVirtualKeyStore().recordRequest(virtualKey, 0);
      }
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
        requestBody: body,
        responseBody: pipeline.getAccumulated(),
        chunkCount: pipeline.getChunkCount(),
      });
      logger.error({ err: streamErr }, "Stream relay error");
    } finally {
      clearInterval(heartbeat);
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
        return next(err);
      }
      return;
    }

    if (err instanceof AllProvidersExhaustedError) {
      gatewayRouter.requestLog.add({
        requestedModel: body.model,
        latencyMs: elapsed,
        status: "all_providers_failed",
        error: err.message,
        streaming: true,
      });

      if (!res.headersSent) {
        return next(err);
      }
      // Headers already flushed mid-stream — surface as SSE error frame.
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
      return next(err);
    }
    res.end();
  }
}

export default chatRouter;
