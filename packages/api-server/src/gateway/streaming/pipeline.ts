/**
 * End-to-end streaming pipeline: raw upstream bytes in → corrected
 * OpenAI-spec SSE bytes out.
 *
 * The chat route holds one of these per request. It feeds decoded
 * upstream text into `push()` and writes whatever that returns to the
 * downstream response. When the upstream closes it calls `flush()`
 * once to drain any final buffered event, plus whatever the
 * normalizer wants to emit on stream end.
 *
 * Every stage is wrapped in defensive try/catch. A single malformed
 * chunk, a normalizer bug, or a JSON parse error must never crash the
 * whole response path. Failure mode is "pass the chunk through
 * untouched and log a warning".
 */
import { SSEParser, serializeEvent, type SSEEvent } from "./sse.js";
import { createNormalizer } from "./normalizer.js";
import type { ChatCompletionChunk, Normalizer } from "./types.js";
import { logger } from "../../lib/logger.js";

export class StreamingPipeline {
  private parser = new SSEParser();
  private normalizer: Normalizer;
  private providerId: string;
  private accumulated = "";
  private chunkCount = 0;

  constructor(providerId: string) {
    this.providerId = providerId;
    this.normalizer = createNormalizer(providerId);
  }

  /** Concatenated `delta.content` across all parsed chunks. */
  getAccumulated(): string {
    return this.accumulated;
  }

  /** Number of successfully-parsed data chunks observed. */
  getChunkCount(): number {
    return this.chunkCount;
  }

  /**
   * Feed a chunk of decoded upstream text into the pipeline. Returns
   * the downstream bytes ready to be written to the client response.
   * Returns an empty string when the input was a partial event with
   * nothing yet complete.
   */
  push(text: string): string {
    let events: SSEEvent[];
    try {
      events = this.parser.push(text);
    } catch (err) {
      // The parser itself should never throw (it's pure string ops)
      // but if it does, fall back to passing the raw text through so
      // the client still sees whatever the upstream meant to send.
      logger.warn({ err, provider: this.providerId }, "SSE parser threw, passing raw bytes through");
      return text;
    }

    return this.renderEvents(events);
  }

  /** Drain the pipeline after the upstream closes. */
  flush(): string {
    let events: SSEEvent[];
    try {
      events = this.parser.flush();
    } catch (err) {
      logger.warn({ err, provider: this.providerId }, "SSE parser flush threw");
      events = [];
    }

    // Ask the normalizer for any buffered output before we stop.
    try {
      const extra = this.normalizer.flush();
      for (const chunk of extra) {
        events.push({ type: "data", data: JSON.stringify(chunk) });
      }
    } catch (err) {
      logger.warn({ err, provider: this.providerId }, "normalizer flush threw");
    }

    return this.renderEvents(events);
  }

  /**
   * Normalize a list of parsed SSE events and return the downstream
   * bytes. Non-data events (comments, DONE) pass through untouched.
   * Data events get parsed → normalized → reserialized. Parse failures
   * are logged and the original event is emitted unchanged.
   */
  private renderEvents(events: SSEEvent[]): string {
    let out = "";
    for (const event of events) {
      if (event.type !== "data") {
        out += serializeEvent(event);
        continue;
      }

      let parsed: ChatCompletionChunk;
      try {
        parsed = JSON.parse(event.data) as ChatCompletionChunk;
      } catch (err) {
        logger.warn(
          { err, provider: this.providerId, preview: event.data.slice(0, 200) },
          "could not JSON-parse SSE chunk, forwarding verbatim",
        );
        out += serializeEvent(event);
        continue;
      }

      this.chunkCount++;
      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === "string") this.accumulated += delta;

      let transformed: ChatCompletionChunk[];
      try {
        transformed = this.normalizer.transform(parsed);
      } catch (err) {
        logger.warn(
          { err, provider: this.providerId },
          "normalizer threw on chunk, forwarding original",
        );
        out += serializeEvent(event);
        continue;
      }

      for (const chunk of transformed) {
        out += serializeEvent({ type: "data", data: JSON.stringify(chunk) });
      }
    }
    return out;
  }
}
