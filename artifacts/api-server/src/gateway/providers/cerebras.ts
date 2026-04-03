import { BaseProvider } from "./base.js";
import type { ModelObject } from "../types.js";

export class CerebrasProvider extends BaseProvider {
  readonly id = "cerebras";
  readonly name = "Cerebras";
  readonly baseUrl = "https://api.cerebras.ai/v1";

  readonly models: ModelObject[] = [
    { id: "cerebras/llama3.1-8b", object: "model", created: 1700000000, owned_by: "meta", provider: "cerebras" },
    { id: "cerebras/llama3.1-70b", object: "model", created: 1700000000, owned_by: "meta", provider: "cerebras" },
    { id: "cerebras/llama3.3-70b", object: "model", created: 1700000000, owned_by: "meta", provider: "cerebras" },
    { id: "cerebras/qwen-3-32b", object: "model", created: 1700000000, owned_by: "alibaba", provider: "cerebras" },
  ];

  protected getApiKey(): string | undefined {
    return process.env["CEREBRAS_API_KEY"];
  }

  protected getModelMap(): Record<string, string> {
    return {
      "cerebras/llama3.1-8b": "llama3.1-8b",
      "cerebras/llama3.1-70b": "llama3.1-70b",
      "cerebras/llama3.3-70b": "llama3.3-70b",
      "cerebras/qwen-3-32b": "qwen-3-32b",
    };
  }
}
