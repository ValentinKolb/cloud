import type { Context } from "hono";
import { z } from "zod";
import { type AuthContext, err, fail, respond } from "../server";
import { isAiSettingsError } from "./runtime";
import type { AiSettingsError } from "./types";

export const AiCreateConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const AiTurnInputSchema = z.object({
  message: z.string().trim().min(1).max(20000),
  modelProfileId: z.string().trim().min(1).optional(),
});

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
