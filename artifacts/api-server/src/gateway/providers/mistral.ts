import { BaseProvider } from "./base.js";
import type { ModelObject } from "../types.js";

export class MistralProvider extends BaseProvider {
  readonly id = "mistral";
  readonly name = "Mistral";
  readonly baseUrl = "https://api.mistral.ai/v1";

  readonly models: ModelObject[] = [
    { id: "mistral/mistral-small-latest", object: "model", created: 1700000000, owned_by: "mistral", provider: "mistral" },
    { id: "mistral/open-mistral-7b", object: "model", created: 1700000000, owned_by: "mistral", provider: "mistral" },
    { id: "mistral/open-mixtral-8x7b", object: "model", created: 1700000000, owned_by: "mistral", provider: "mistral" },
    { id: "mistral/mistral-nemo", object: "model", created: 1700000000, owned_by: "mistral", provider: "mistral" },
  ];

  protected getApiKey(): string | undefined {
    return process.env["MISTRAL_API_KEY"];
  }

  protected getModelMap(): Record<string, string> {
    return {
      "mistral/mistral-small-latest": "mistral-small-latest",
      "mistral/open-mistral-7b": "open-mistral-7b",
      "mistral/open-mixtral-8x7b": "open-mixtral-8x7b",
      "mistral/mistral-nemo": "mistral-nemo",
    };
  }
}
