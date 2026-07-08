import type { Input } from "@valentinkolb/nessi";
import { readAiSettingsState, resolveAiModel } from "./settings";
import type { AiModelPolicy, AiSettingsError, AiSettingsState } from "./types";

export const isAiSettingsError = (error: unknown): error is Error & { aiError: AiSettingsError } =>
  error instanceof Error && typeof (error as Error & { aiError?: unknown }).aiError === "object";

const inputIncludesFiles = (input: Input): boolean =>
  Array.isArray(input) && input.some((part) => typeof part === "object" && part.type === "file");

export type ValidateAiTurnInput = {
  input: Input;
  modelPolicy?: AiModelPolicy;
  requestedModelId?: string;
};

export const validateAiTurnRequest = async (
  input: ValidateAiTurnInput,
): Promise<{ settings: Extract<AiSettingsState, { ok: true }>; resolved: Awaited<ReturnType<typeof resolveAiModel>> }> => {
  const settings = await readAiSettingsState();
  if (!settings.ok) throw Object.assign(new Error(settings.error.message), { aiError: settings.error });
  if (!settings.enabled) {
    throw Object.assign(new Error("AI is disabled."), {
      aiError: { code: "ai_disabled", message: "AI is disabled." } satisfies AiSettingsError,
    });
  }

  const resolved = await resolveAiModel(input.modelPolicy ?? { kind: "platform-default" }, input.requestedModelId);
  if (inputIncludesFiles(input.input) && !resolved.profile.capabilities.includes("vision")) {
    throw Object.assign(new Error(`AI model "${resolved.profile.id}" does not support image input.`), {
      aiError: {
        code: "model_policy_mismatch",
        message: `AI model "${resolved.profile.label}" does not support image input.`,
        fields: { modelProfileId: "Choose a model with vision support." },
      } satisfies AiSettingsError,
    });
  }

  return { settings, resolved };
};
