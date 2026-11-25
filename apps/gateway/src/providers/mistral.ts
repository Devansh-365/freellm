import type { ModelObject } from "../types.js";
import { BaseProvider, parseApiKeys } from "./base.js";

export class MistralProvider extends BaseProvider {
  readonly id = "mistral";
  readonly name = "Mistral";
  override readonly supportsStreamUsage = true;

  get baseUrl(): string {
    return process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1";
  }

  readonly models: ModelObject[] = [
    {
      id: "mistral/mistral-small-latest",
      object: "model",
      created: 1700000000,
      owned_by: "mistral",
      provider: "mistral",
    },
    {
      id: "mistral/mistral-medium-latest",
      object: "model",
      created: 1700000000,
      owned_by: "mistral",
      provider: "mistral",
    },
  ];

  protected getApiKeys(): string[] {
    return parseApiKeys(process.env.MISTRAL_API_KEY);
  }
}
