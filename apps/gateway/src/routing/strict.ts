import { META_MODELS } from "../config.js";

/**
 * Strict mode: the caller demands no substitution and no failover.
 * - Meta-models are forbidden (since they substitute by definition).
 * - Concrete models are tried against exactly one provider; if that
 *   provider fails, the error is surfaced verbatim instead of failing
 *   over to a different provider.
 *
 * Triggered by the request header `X-FreeLLM-Strict: true|1|yes`.
 */

const TRUTHY = new Set(["true", "1", "yes", "on"]);

/** Parse the X-FreeLLM-Strict header value into a boolean. */
export function parseStrictHeader(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

export class StrictModeError extends Error {
  constructor(
    message: string,
    public readonly requestedModel: string,
  ) {
    super(message);
    this.name = "StrictModeError";
  }
}

/**
 * Validate a request against strict mode. Throws StrictModeError if the
 * combination is forbidden (currently: strict + meta-model).
 */
export function assertStrictModeAllowed(model: string, strict: boolean): void {
  if (!strict) return;
  if (META_MODELS.has(model)) {
    throw new StrictModeError(
      `Strict mode forbids meta-model "${model}". Specify a concrete model like "groq/openai/gpt-oss-120b" or disable strict mode.`,
      model,
    );
  }
}
