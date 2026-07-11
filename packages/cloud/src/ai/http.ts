import type { Input, Message } from "@valentinkolb/nessi";
import type { Context } from "hono";
import { z } from "zod";
import { type AuthContext, err, fail, respond } from "../server";
import { aiAttachmentMarker } from "./attachments";
import { isAiSettingsError } from "./validate";
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
  // Non-image attachment already uploaded to the conversation VFS (/input).
  z.object({
    type: z.literal("attachment"),
    path: z.string().trim().min(1).max(500),
    mediaType: z.string().trim().max(120).default("application/octet-stream"),
    size: z.number().int().min(0).default(0),
  }),
]);

export type AiTurnContentPart = z.infer<typeof AiUserContentPartSchema>;

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

export const AiCompactionInputSchema = z.object({
  modelProfileId: z.string().trim().min(1).optional(),
});

export type AiCompactionInput = z.infer<typeof AiCompactionInputSchema>;

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

/** Map one wire input part to a nessi content part (attachments become VFS marker text). */
const toModelContentPart = (part: AiTurnContentPart): AiUserContentPart => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part.type === "attachment") return { type: "text", text: aiAttachmentMarker(part) };
  return part;
};

export const aiTurnInputToContent = (input: AiTurnInput): string | AiUserContentPart[] => {
  const message = input.message?.trim() ?? "";
  if (!input.content?.length) return message;

  // Attachment markers don't count as prose — a message plus attachments-only
  // content still needs the message prepended as its text part.
  const hasTextPart = input.content.some((part) => {
    if (typeof part === "string") return part.trim().length > 0;
    return part.type === "text" && part.text.trim().length > 0;
  });
  const content = input.content.map(toModelContentPart);
  return message && !hasTextPart ? [{ type: "text", text: message }, ...content] : content;
};

/** Normalize turn input into a nessi Input (loop prompt) and its persisted user Message. */
export const aiInputToUserMessage = (content: string | AiUserContentPart[]): { input: Input; message: Message } => {
  if (typeof content === "string") {
    return { input: content, message: { role: "user", content: [{ type: "text", text: content }] } };
  }
  const parts = content.map((part) => (typeof part === "string" ? { type: "text" as const, text: part } : part));
  return { input: parts, message: { role: "user", content: parts } };
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
  if (message.includes("idx_ai_turns_one_active")) return respond(c, fail(err.conflict("Running turn")));
  return respond(c, fail(err.internal(message)));
};

export const toAiActionFailureResponse = (c: Context<AuthContext>, result: { ok: false; status: 400 | 404 | 409; message: string }) => {
  const failure =
    result.status === 400
      ? err.badInput(result.message)
      : result.status === 404
        ? // err.notFound appends " not found" to its subject — the runtime message is already complete.
          { code: "NOT_FOUND" as const, message: result.message, status: 404 as const }
        : conflict(result.message);
  return respond(c, fail(failure));
};
