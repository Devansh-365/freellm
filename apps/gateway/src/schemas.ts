import { z } from "zod";

/**
 * Shape of a tool/function definition per the OpenAI Chat Completions
 * spec. We validate the outer envelope (type=function with a nested
 * function object) and pass the `parameters` JSON schema through as an
 * opaque object so providers can validate them against the underlying
 * model. Every provider we proxy to already accepts this shape.
 */
const chatToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.any()).optional(),
    strict: z.boolean().optional(),
  }),
});

const chatToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string().min(1) }),
  }),
]);

/**
 * Tool-call deltas that an assistant message may carry when the client
 * is relaying a prior turn back to the model. Passes through to the
 * upstream untouched.
 */
const assistantToolCallSchema = z.object({
  id: z.string().optional(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string().optional(),
    arguments: z.string().optional(),
  }),
  index: z.number().int().optional(),
});

const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool", "developer"]),
  content: z
    .union([z.string(), z.array(z.any())])
    .nullable()
    .optional(),
  name: z.string().nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  tool_calls: z.array(assistantToolCallSchema).optional(),
});

export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1).max(256),
    stream: z.boolean().nullable().optional(),
    stream_options: z.object({ include_usage: z.boolean().optional() }).nullable().optional(),
    temperature: z.number().min(0).max(2).nullable().optional(),
    max_tokens: z.number().int().min(1).max(32768).nullable().optional(),
    max_completion_tokens: z.number().int().min(1).max(32768).nullable().optional(),
    top_p: z.number().nullable().optional(),
    stop: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    presence_penalty: z.number().min(-2).max(2).nullable().optional(),
    frequency_penalty: z.number().min(-2).max(2).nullable().optional(),
    seed: z.number().int().nullable().optional(),
    tools: z.array(chatToolSchema).optional(),
    tool_choice: chatToolChoiceSchema.optional(),
    parallel_tool_calls: z.boolean().optional(),
    response_format: z
      .object({
        type: z.enum(["text", "json_object", "json_schema"]),
        json_schema: z.record(z.string(), z.any()).optional(),
      })
      .optional(),
    // Reasoning budget knob for Gemini 2.5 OpenAI-compat and OpenAI o-series.
    // Gemini defaults this to "high" which silently eats ~95% of max_tokens on
    // internal thinking, leaving the caller with almost no visible output. The
    // gemini provider adapter defaults this to "low" when the client did not
    // supply one; clients that explicitly set it keep their value.
    reasoning_effort: z.enum(["none", "low", "medium", "high"]).optional(),
    user: z.string().optional(),
  })
  .strict();

export const updateRoutingSchema = z.object({
  strategy: z.enum(["round_robin", "random"]),
});
