import { BaseProvider } from "./base.js";
import type { ModelObject } from "../types.js";

export class GroqProvider extends BaseProvider {
  readonly id = "groq";
  readonly name = "Groq";
  readonly baseUrl = "https://api.groq.com/openai/v1";

  readonly models: ModelObject[] = [
    { id: "groq/llama-3.3-70b-versatile", object: "model", created: 1700000000, owned_by: "meta", provider: "groq" },
    { id: "groq/llama-3.1-8b-instant", object: "model", created: 1700000000, owned_by: "meta", provider: "groq" },
    { id: "groq/gemma2-9b-it", object: "model", created: 1700000000, owned_by: "google", provider: "groq" },
    { id: "groq/mixtral-8x7b-32768", object: "model", created: 1700000000, owned_by: "mistral", provider: "groq" },
    { id: "groq/llama3-8b-8192", object: "model", created: 1700000000, owned_by: "meta", provider: "groq" },
    { id: "groq/llama3-70b-8192", object: "model", created: 1700000000, owned_by: "meta", provider: "groq" },
  ];

  protected getApiKey(): string | undefined {
    return process.env["GROQ_API_KEY"];
  }

  protected getModelMap(): Record<string, string> {
    return {
      "groq/llama-3.3-70b-versatile": "llama-3.3-70b-versatile",
      "groq/llama-3.1-8b-instant": "llama-3.1-8b-instant",
      "groq/gemma2-9b-it": "gemma2-9b-it",
      "groq/mixtral-8x7b-32768": "mixtral-8x7b-32768",
      "groq/llama3-8b-8192": "llama3-8b-8192",
      "groq/llama3-70b-8192": "llama3-70b-8192",
    };
  }
}
