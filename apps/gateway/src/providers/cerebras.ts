import type { ModelObject } from "../types.js";
import { BaseProvider, parseApiKeys } from "./base.js";

export class CerebrasProvider extends BaseProvider {
  readonly id = "cerebras";
  readonly name = "Cerebras";
  override readonly supportsStreamUsage = true;
  override readonly supportsTools = false;

  get baseUrl(): string {
    return process.env.CEREBRAS_BASE_URL ?? "https://api.cerebras.ai/v1";
  }

  // llama3.1-8b and qwen-3-235b-a22b-instruct-2507 were deprecated on
  // 2026-05-27 (inference-docs.cerebras.ai/support/deprecation).
  readonly models: ModelObject[] = [
    {
      id: "cerebras/gpt-oss-120b",
      object: "model",
      created: 1700000000,
      owned_by: "openai",
      provider: "cerebras",
    },
    {
      id: "cerebras/qwen-3.8-27b",
      object: "model",
      created: 1700000000,
      owned_by: "alibaba",
      provider: "cerebras",
    },
  ];

  protected getApiKeys(): string[] {
    return parseApiKeys(process.env.CEREBRAS_API_KEY);
  }
}
