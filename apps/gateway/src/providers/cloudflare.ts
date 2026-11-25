import type { ModelObject } from "../types.js";
import { BaseProvider, parseApiKeys } from "./base.js";

/**
 * Cloudflare Workers AI (OpenAI-compatible) adapter.
 *
 * Cloudflare exposes an OpenAI-compatible Chat Completions endpoint under
 * each account at
 * `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`, so
 * there are two env-var dependencies rather than the usual one:
 *
 *   - `CLOUDFLARE_ACCOUNT_ID` is embedded in the base URL path.
 *   - `CLOUDFLARE_API_KEY` is the bearer token (comma-separated for
 *     rotation, same shape as every other provider).
 *
 * Two design choices worth flagging:
 *
 * 1. `baseUrl` is a getter, not a static string. It reads
 *    `CLOUDFLARE_ACCOUNT_ID` every time so test env overrides and
 *    runtime config changes take effect without re-instantiating the
 *    provider. This matches the Ollama pattern where the base URL is
 *    env-driven.
 *
 * 2. `getApiKeys()` returns `[]` when EITHER env var is unset, regardless
 *    of the other. If we only checked `CLOUDFLARE_API_KEY`, a configured
 *    key plus a missing account id would produce a request against a URL
 *    with an empty account segment ("/accounts//ai/v1/chat/completions"),
 *    which is both wasteful and leaks the key to an unrelated path.
 *    Requiring both variables together keeps `isEnabled()` honest.
 *
 * Model ids are carried through verbatim. The base `mapRequest` strips
 * the `cloudflare/` prefix, leaving `@cf/meta/llama-3.3-70b-...` as the
 * model id Cloudflare expects. No override is needed.
 */
export class CloudflareProvider extends BaseProvider {
  readonly id = "cloudflare";
  readonly name = "Cloudflare Workers AI";

  get baseUrl(): string {
    if (process.env.CLOUDFLARE_BASE_URL) return process.env.CLOUDFLARE_BASE_URL;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  }

  readonly models: ModelObject[] = [
    {
      id: "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      object: "model",
      created: 1700000000,
      owned_by: "meta",
      provider: "cloudflare",
    },
    {
      id: "cloudflare/@cf/meta/llama-3.2-3b-instruct",
      object: "model",
      created: 1700000000,
      owned_by: "meta",
      provider: "cloudflare",
    },
    {
      // The non-fast llama-3.1-8b-instruct was deprecated on 2026-05-30;
      // the -fast variant stays active.
      id: "cloudflare/@cf/meta/llama-3.1-8b-instruct-fast",
      object: "model",
      created: 1700000000,
      owned_by: "meta",
      provider: "cloudflare",
    },
    {
      id: "cloudflare/@cf/mistral/mistral-small-3.1-24b-instruct",
      object: "model",
      created: 1700000000,
      owned_by: "mistral",
      provider: "cloudflare",
      supportsVision: true,
    },
    {
      id: "cloudflare/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      object: "model",
      created: 1700000000,
      owned_by: "deepseek",
      provider: "cloudflare",
    },
    {
      id: "cloudflare/@cf/qwen/qwen2.5-coder-32b-instruct",
      object: "model",
      created: 1700000000,
      owned_by: "qwen",
      provider: "cloudflare",
    },
  ];

  /**
   * Returns configured keys only when BOTH `CLOUDFLARE_ACCOUNT_ID` and
   * `CLOUDFLARE_API_KEY` are present. See the class-level comment for
   * why both are required together.
   */
  protected getApiKeys(): string[] {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) return [];
    return parseApiKeys(process.env.CLOUDFLARE_API_KEY);
  }
}
