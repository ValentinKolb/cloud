import { z } from "zod";
import { coreSettings } from "../services";
import { createAiProvider } from "./provider";
import {
  AI_DATA_BOUNDARIES,
  AI_MODEL_CAPABILITIES,
  type AiDataBoundary,
  type AiModelCapability,
  type AiModelPolicy,
  type AiModelProfile,
  type AiProviderId,
  type AiPublicModelProfile,
  type AiResolvedModel,
  type AiSettingsError,
  type AiSettingsState,
} from "./types";

const PROVIDERS = ["openai", "openrouter", "anthropic", "mistral", "gemini", "ollama", "vllm", "openai-compatible"] as const;
const LEGACY_DATA_BOUNDARIES = ["local", "internal"] as const;
const DATA_BOUNDARY_INPUTS = [...AI_DATA_BOUNDARIES, ...LEGACY_DATA_BOUNDARIES] as const;

const providerRequiresCredential = (provider: AiProviderId): boolean =>
  provider === "openai" || provider === "openrouter" || provider === "anthropic" || provider === "mistral" || provider === "gemini";

const defaultDataBoundary = (provider: AiProviderId): AiDataBoundary =>
  provider === "ollama" || provider === "vllm" || provider === "openai-compatible" ? "private" : "hosted";

const normalizeDataBoundary = (boundary: (typeof DATA_BOUNDARY_INPUTS)[number] | undefined, provider: AiProviderId): AiDataBoundary => {
  if (boundary === "hosted") return "hosted";
  if (boundary === "private" || boundary === "local" || boundary === "internal") return "private";
  return defaultDataBoundary(provider);
};

const isModelCapability = (value: string): value is AiModelCapability => AI_MODEL_CAPABILITIES.some((capability) => capability === value);

const DEFAULT_MAX_TOOL_RESULT_CHARS = 2_000;

const normalizeMaxToolResultChars = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_TOOL_RESULT_CHARS;
  return Math.floor(numeric);
};

const normalizeCapabilities = (values: string[] | undefined): AiModelCapability[] => {
  if (!values) return ["streaming"];
  const capabilities = values.filter(isModelCapability);
  return [...new Set(capabilities)];
};

const ModelProfileSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  label: z.string().trim().min(1),
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  // Legacy/advanced metadata is tolerated but no longer used for model selection.
  tags: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  dataBoundary: z.enum(DATA_BOUNDARY_INPUTS).optional(),
  // Legacy name accepted for stored profiles created before dataBoundary.
  dataPolicy: z.enum(DATA_BOUNDARY_INPUTS).optional(),
  apiKey: z.string().trim().min(1).optional(),
  // Legacy profiles may still point at a global secret setting. The admin UI no longer writes this.
  credentialSetting: z.string().trim().min(1).optional(),
  baseURL: z.string().trim().url().optional(),
  contextWindow: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  creditsPerInputToken: z.number().nonnegative().optional(),
  creditsPerOutputToken: z.number().nonnegative().optional(),
});

const profileToPublic = (profile: AiModelProfile): AiPublicModelProfile => ({
  id: profile.id,
  label: profile.label,
  provider: profile.provider,
  model: profile.model,
  capabilities: profile.capabilities,
  dataBoundary: profile.dataBoundary,
  contextWindow: profile.contextWindow,
});

const normalizeProfile = (raw: z.infer<typeof ModelProfileSchema>): AiModelProfile => {
  const { capabilities, dataBoundary, dataPolicy: legacyDataPolicy, tags: _legacyTags, ...profile } = raw;
  return {
    ...profile,
    capabilities: normalizeCapabilities(capabilities),
    dataBoundary: normalizeDataBoundary(dataBoundary ?? legacyDataPolicy, raw.provider),
  };
};

const parseProfiles = (rawJson: string): { profiles: AiModelProfile[]; error?: AiSettingsError } => {
  let raw: unknown;
  try {
    raw = rawJson.trim() ? JSON.parse(rawJson) : [];
  } catch (error) {
    return {
      profiles: [],
      error: {
        code: "invalid_model_profiles",
        message: "AI model profiles must be valid JSON.",
        fields: { "ai.model_profiles_json": error instanceof Error ? error.message : "Invalid JSON" },
      },
    };
  }

  const parsed = z.array(ModelProfileSchema).safeParse(raw);
  if (!parsed.success) {
    return {
      profiles: [],
      error: {
        code: "invalid_model_profiles",
        message: "AI model profiles do not match the expected shape.",
        fields: { "ai.model_profiles_json": z.prettifyError(parsed.error) },
      },
    };
  }

  const seen = new Set<string>();
  const duplicate = parsed.data.find((profile) => {
    if (seen.has(profile.id)) return true;
    seen.add(profile.id);
    return false;
  });

  if (duplicate) {
    return {
      profiles: [],
      error: {
        code: "invalid_model_profiles",
        message: `Duplicate AI model profile id "${duplicate.id}".`,
        fields: { "ai.model_profiles_json": `Duplicate model profile id "${duplicate.id}".` },
      },
    };
  }

  const profiles = parsed.data.map(normalizeProfile);
  return { profiles };
};

export const resolveAiSettingsStateFromRaw = async (input: {
  enabled: boolean;
  defaultModelId: string;
  profilesJson: string;
  globalInstructions?: string;
  compactionPrompt?: string;
  maxToolResultChars?: unknown;
  readCredential?: (settingKey: string) => Promise<string | undefined>;
}): Promise<AiSettingsState> => {
  const parsed = parseProfiles(input.profilesJson ?? "[]");
  const baseState = {
    enabled: Boolean(input.enabled),
    defaultModelId: input.defaultModelId ?? "",
    globalInstructions: input.globalInstructions ?? "",
    compactionPrompt: input.compactionPrompt ?? "",
    maxToolResultChars: normalizeMaxToolResultChars(input.maxToolResultChars),
  };
  if (parsed.error) {
    return {
      ok: false,
      ...baseState,
      profiles: parsed.profiles,
      error: parsed.error,
    };
  }

  if (!input.enabled) {
    return {
      ok: true,
      ...baseState,
      enabled: false,
      profiles: parsed.profiles,
    };
  }

  const defaultProfile = parsed.profiles.find((profile) => profile.id === input.defaultModelId);
  if (!input.defaultModelId || !defaultProfile) {
    return {
      ok: false,
      ...baseState,
      enabled: true,
      profiles: parsed.profiles,
      error: {
        code: "missing_default_model",
        message: "AI is enabled but no valid default model profile is configured.",
        fields: { "ai.default_model_id": "Choose an enabled model profile id." },
      },
    };
  }

  if (!defaultProfile.enabled) {
    return {
      ok: false,
      ...baseState,
      enabled: true,
      profiles: parsed.profiles,
      error: {
        code: "default_model_disabled",
        message: `Default AI model "${input.defaultModelId}" is disabled.`,
        fields: { "ai.default_model_id": "Choose an enabled model profile id." },
      },
    };
  }

  const credential =
    defaultProfile.apiKey?.trim() ||
    (defaultProfile.credentialSetting ? await input.readCredential?.(defaultProfile.credentialSetting) : "");
  if (providerRequiresCredential(defaultProfile.provider)) {
    if (!credential?.trim()) {
      return {
        ok: false,
        ...baseState,
        enabled: true,
        profiles: parsed.profiles,
        error: {
          code: "missing_provider_credential",
          message: `Default AI model "${input.defaultModelId}" is missing provider credentials.`,
          fields: { "ai.model_profiles_json": "Enter the provider API key on the default model profile." },
        },
      };
    }
  }

  return {
    ok: true,
    ...baseState,
    enabled: true,
    profiles: parsed.profiles,
  };
};

export const readAiSettingsState = async (): Promise<AiSettingsState> => {
  const [enabled, defaultModelId, profilesJson, globalInstructions, compactionPrompt, maxToolResultChars] = await Promise.all([
    coreSettings.get<boolean>("ai.enabled"),
    coreSettings.get<string>("ai.default_model_id"),
    coreSettings.get<string>("ai.model_profiles_json"),
    coreSettings.get<string>("ai.global_instructions"),
    coreSettings.get<string>("ai.compaction_prompt"),
    coreSettings.get<number>("ai.max_tool_result_chars"),
  ]);

  return resolveAiSettingsStateFromRaw({
    enabled: Boolean(enabled),
    defaultModelId: defaultModelId ?? "",
    profilesJson: profilesJson ?? "[]",
    globalInstructions: globalInstructions ?? "",
    compactionPrompt: compactionPrompt ?? "",
    maxToolResultChars,
    readCredential: (settingKey) => coreSettings.get<string>(settingKey),
  });
};

const hasAll = <T extends string>(values: readonly T[], required: readonly T[] | undefined): boolean =>
  !required || required.every((requiredValue) => values.includes(requiredValue));

const matchesPolicy = (profile: AiModelProfile, policy: AiModelPolicy): boolean => {
  if (!profile.enabled) return false;
  if ("allowedModelIds" in policy && policy.allowedModelIds && !policy.allowedModelIds.includes(profile.id)) return false;
  if (policy.allowedDataBoundaries && !policy.allowedDataBoundaries.includes(profile.dataBoundary)) return false;
  return hasAll(profile.capabilities, policy.requiredCapabilities);
};

const resolvePolicyModelId = (state: Extract<AiSettingsState, { ok: true }>, policy: AiModelPolicy, requestedModelId?: string): string => {
  if (policy.kind === "locked") return policy.modelId;
  if (policy.kind === "selectable") return requestedModelId ?? policy.defaultModelId ?? state.defaultModelId;
  return state.defaultModelId;
};

export const selectAiModelProfile = (
  state: Extract<AiSettingsState, { ok: true }>,
  policy: AiModelPolicy,
  requestedModelId?: string,
): AiModelProfile => {
  const modelId = resolvePolicyModelId(state, policy, requestedModelId);
  const profile = state.profiles.find((candidate) => candidate.id === modelId);
  if (!profile || !matchesPolicy(profile, policy)) {
    throw Object.assign(new Error(`AI model "${modelId}" is not allowed for this chat.`), {
      aiError: {
        code: "model_policy_mismatch",
        message: `AI model "${modelId}" is not allowed for this chat.`,
        fields: { modelProfileId: "Choose an allowed enabled model profile." },
      } satisfies AiSettingsError,
    });
  }
  return profile;
};

export const resolveAiModel = async (
  policy: AiModelPolicy = { kind: "platform-default" },
  requestedModelId?: string,
): Promise<AiResolvedModel> => {
  const state = await readAiSettingsState();
  if (!state.ok) throw Object.assign(new Error(state.error.message), { aiError: state.error });
  if (!state.enabled) {
    throw Object.assign(new Error("AI is disabled."), {
      aiError: { code: "ai_disabled", message: "AI is disabled." } satisfies AiSettingsError,
    });
  }

  const profile = selectAiModelProfile(state, policy, requestedModelId);

  const credential = profile.apiKey?.trim() || (profile.credentialSetting ? await coreSettings.get<string>(profile.credentialSetting) : "");
  if (providerRequiresCredential(profile.provider) && !credential?.trim()) {
    throw Object.assign(new Error(`AI model "${profile.id}" is missing provider credentials.`), {
      aiError: {
        code: "missing_provider_credential",
        message: `AI model "${profile.id}" is missing provider credentials.`,
        fields: { "ai.model_profiles_json": "Enter the provider API key on this model profile." },
      } satisfies AiSettingsError,
    });
  }

  return { profile, provider: createAiProvider(profile, credential?.trim() || undefined) };
};

export const listAiModels = async (policy: AiModelPolicy = { kind: "selectable" }): Promise<AiPublicModelProfile[]> => {
  const state = await readAiSettingsState();
  if (!state.ok || !state.enabled) return [];
  return state.profiles.filter((profile) => matchesPolicy(profile, policy)).map(profileToPublic);
};

export const toPublicAiSettingsState = async () => {
  const state = await readAiSettingsState();
  return {
    ok: state.ok,
    enabled: state.enabled,
    defaultModelId: state.defaultModelId,
    error: state.ok ? null : state.error,
    models: state.ok && state.enabled ? state.profiles.filter((profile) => profile.enabled).map(profileToPublic) : [],
  };
};

export type { AiDataBoundary, AiModelCapability, AiModelPolicy, AiModelProfile };
