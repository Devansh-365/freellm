import type { ModelObject } from "../types.js";
import { BaseProvider, parseApiKeys } from "./base.js";

export class GroqProvider extends BaseProvider {
  readonly id = "groq";
  readonly name = "Groq";
  override readonly supportsStreamUsage = true;

  get baseUrl(): string {
    return process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
  }

  /**
   * Groq shut down llama-3.3-70b-versatile, llama-3.1-8b-instant,
   * llama-4-scout and qwen3-32b on the free and developer tiers in
   * July/August 2026 (see console.groq.com/docs/deprecations). Groq's
   * models page still lists some of them because enterprise contracts
   * keep access, but free keys get `404 model_not_found`.
   *
   * qwen3.8-27b is a Groq preview model. It is listed because it is the
   * only vision-capable model available to free keys.
   */
  readonly models: ModelObject[] = [
    {
      id: "groq/openai/gpt-oss-120b",
      object: "model",
      created: 1700000000,
      owned_by: "openai",
      provider: "groq",
    },
    {
      id: "groq/openai/gpt-oss-20b",
      object: "model",
      created: 1700000000,
      owned_by: "openai",
      provider: "groq",
    },
    {
      id: "groq/qwen/qwen3.8-27b",
      object: "model",
      created: 1700000000,
      owned_by: "alibaba",
      provider: "groq",
      supportsVision: true,
    },
  ];

  protected getApiKeys(): string[] {
    return parseApiKeys(process.env.GROQ_API_KEY);
  }
}
