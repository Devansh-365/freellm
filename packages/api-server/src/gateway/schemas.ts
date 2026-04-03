import { z } from "zod";

export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.string().nullable(),
      name: z.string().nullable().optional(),
    }),
  ).min(1),
  stream: z.boolean().nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  max_tokens: z.number().int().min(1).nullable().optional(),
  top_p: z.number().nullable().optional(),
  stop: z.union([z.string(), z.array(z.string())]).nullable().optional(),
});

export const updateRoutingSchema = z.object({
  strategy: z.enum(["round_robin", "random"]),
});
