import type { Context } from "hono";
import { z } from "zod";
import { type AuthContext, err, fail, respond } from "../server";
import { isAiSettingsError } from "./runtime";
import type { AiSettingsError, AiUserContentPart } from "./types";
import { isAiImageMediaType } from "./types";

export const AiCreateConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const AiUserContentPartSchema = z.union([
  z.string().trim().min(1).max(20000),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(20000),
  }),
  z.object({
    type: z.literal("file"),
    data: z.string().min(1).max(12_000_000),
    mediaType: z.string().trim().refine(isAiImageMediaType, "Unsupported image media type."),
  }),
]);

export const AiTurnInputSchema = z
  .object({
    message: z.string().trim().max(20000).optional(),
    content: z.array(AiUserContentPartSchema).min(1).max(12).optional(),
    modelProfileId: z.string().trim().min(1).optional(),
  })
  .refine((input) => Boolean(input.message?.trim() || input.content?.length), {
    message: "Message or content is required.",
    path: ["message"],
  });

export type AiTurnInput = z.infer<typeof AiTurnInputSchema>;

export const AiMessageRetryModeSchema = z.enum(["retry", "details", "concise"]);
export type AiMessageRetryMode = z.infer<typeof AiMessageRetryModeSchema>;

export const AiMessageRetryInputSchema = z.object({
  mode: AiMessageRetryModeSchema.default("retry"),
  content: z.array(AiUserContentPartSchema).min(1).max(12).optional(),
  modelProfileId: z.string().trim().min(1).optional(),
});

export type AiMessageRetryInput = z.infer<typeof AiMessageRetryInputSchema>;

export const AiMessageForkInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export type AiMessageForkInput = z.infer<typeof AiMessageForkInputSchema>;

export const aiTurnInputToContent = (input: AiTurnInput): string | AiUserContentPart[] => {
  const message = input.message?.trim() ?? "";
  if (!input.content?.length) return message;

  const content = input.content as AiUserContentPart[];
  const hasTextPart = content.some((part) => {
    if (typeof part === "string") return part.trim().length > 0;
    return part.type === "text" && part.text.trim().length > 0;
  });
  return message && !hasTextPart ? [{ type: "text", text: message }, ...content] : content;
};

export const AiReplayQuerySchema = z.object({
  after: z.string().trim().min(1).optional(),
});

export const AiApiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  errors: z.record(z.string(), z.string()).optional(),
});

const conflict = (message: string) => ({ code: "CONFLICT" as const, message, status: 409 as const });

const aiSettingsServiceError = (error: AiSettingsError) => {
  switch (error.code) {
    case "invalid_model_profiles":
    case "model_policy_mismatch":
      return err.badInput(error.message);
    case "ai_disabled":
    case "missing_default_model":
    case "default_model_disabled":
    case "missing_provider_credential":
      return conflict(error.message);
  }
};

export const toAiErrorResponse = (c: Context<AuthContext>, error: unknown) => {
  if (isAiSettingsError(error)) {
    return respond(c, fail(aiSettingsServiceError(error.aiError)));
  }
  const message = error instanceof Error ? error.message : "AI request failed";
  if (message.includes("idx_ai_turns_one_running")) return respond(c, fail(err.conflict("Running turn")));
  return respond(c, fail(err.internal(message)));
};

export const toAiActionFailureResponse = (c: Context<AuthContext>, result: { ok: false; status: 400 | 404 | 409; message: string }) => {
  const failure =
    result.status === 400 ? err.badInput(result.message) : result.status === 404 ? err.notFound(result.message) : conflict(result.message);
  return respond(c, fail(failure));
};
