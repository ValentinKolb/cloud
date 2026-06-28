import { describe, expect, test } from "bun:test";
import { resolveAiSettingsStateFromRaw, selectAiModelProfile } from "./settings";

const profilesJson = (overrides: Array<Record<string, unknown>> = []) =>
  JSON.stringify([
    {
      id: "openrouter-fast",
      label: "OpenRouter Fast",
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      enabled: true,
      tags: ["chat", "fast", "hosted"],
      capabilities: ["streaming"],
      dataBoundary: "hosted",
      apiKey: "secret",
      ...overrides[0],
    },
    ...overrides.slice(1),
  ]);

const resolve = (input: { enabled?: boolean; defaultModelId?: string; profilesJson?: string; credentials?: Record<string, string> }) =>
  resolveAiSettingsStateFromRaw({
    enabled: input.enabled ?? true,
    defaultModelId: input.defaultModelId ?? "openrouter-fast",
    profilesJson: input.profilesJson ?? profilesJson(),
    readCredential: async (key) => input.credentials?.[key],
  });

describe("AI settings model registry", () => {
  test("accepts a valid enabled default model with profile-bound credentials", async () => {
    const state = await resolve({});

    expect(state.ok).toBe(true);
    expect(state.enabled).toBe(true);
    if (state.ok) expect(state.profiles[0]?.id).toBe("openrouter-fast");
  });

  test("selects the configured platform default model", async () => {
    const state = await resolve({});
    if (!state.ok || !state.enabled) throw new Error("Expected valid AI state");

    const selected = selectAiModelProfile(state, { kind: "platform-default", requiredCapabilities: ["streaming"] });

    expect(selected.id).toBe("openrouter-fast");
    expect(selected.dataBoundary).toBe("hosted");
  });

  test("rejects invalid model profile JSON", async () => {
    const state = await resolve({ profilesJson: "{" });

    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.error.code).toBe("invalid_model_profiles");
  });

  test("rejects enabled AI without a valid default model", async () => {
    const state = await resolve({ defaultModelId: "missing" });

    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.error.code).toBe("missing_default_model");
  });

  test("rejects a disabled default model", async () => {
    const state = await resolve({ profilesJson: profilesJson([{ enabled: false }]) });

    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.error.code).toBe("default_model_disabled");
  });

  test("rejects a default hosted model without provider credentials", async () => {
    const state = await resolve({ profilesJson: profilesJson([{ apiKey: undefined }]) });

    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.error.code).toBe("missing_provider_credential");
  });

  test("accepts legacy credential references when the setting has a value", async () => {
    const state = await resolve({
      profilesJson: profilesJson([{ apiKey: undefined, credentialSetting: "ai.openrouter_api_key" }]),
      credentials: { "ai.openrouter_api_key": "secret" },
    });

    expect(state.ok).toBe(true);
  });

  test("rejects model selection when the data boundary is not allowed", async () => {
    const state = await resolve({});
    if (!state.ok || !state.enabled) throw new Error("Expected valid AI state");

    expect(() => selectAiModelProfile(state, { kind: "platform-default", allowedDataBoundaries: ["private"] })).toThrow();
  });

  test("rejects user-selected models outside the allowlist", async () => {
    const state = await resolve({
      profilesJson: profilesJson([
        {},
        {
          id: "openrouter-strong",
          label: "OpenRouter Strong",
          provider: "openrouter",
          model: "openai/gpt-4.1",
          enabled: true,
          tags: ["chat", "strong", "hosted"],
          capabilities: ["streaming"],
          dataBoundary: "hosted",
          apiKey: "secret",
        },
      ]),
    });
    if (!state.ok || !state.enabled) throw new Error("Expected valid AI state");

    expect(() =>
      selectAiModelProfile(
        state,
        { kind: "selectable", allowedModelIds: ["openrouter-fast"], requiredCapabilities: ["streaming"] },
        "openrouter-strong",
      ),
    ).toThrow();
  });

  test("tolerates legacy tags but does not expose them on normalized profiles", async () => {
    const state = await resolve({});
    if (!state.ok || !state.enabled) throw new Error("Expected valid AI state");

    expect("tags" in state.profiles[0]!).toBe(false);
    expect(state.profiles[0]?.dataBoundary).toBe("hosted");
  });

  test("maps legacy local and internal data boundaries to private", async () => {
    const state = await resolve({
      profilesJson: profilesJson([
        {
          provider: "ollama",
          model: "llama3.1",
          apiKey: undefined,
          dataBoundary: undefined,
          dataPolicy: "local",
        },
        {
          id: "internal-gateway",
          label: "Internal Gateway",
          provider: "openai-compatible",
          model: "gateway-model",
          enabled: true,
          capabilities: ["streaming"],
          dataBoundary: "internal",
          baseURL: "http://ai-gateway.internal/v1",
        },
      ]),
    });
    if (!state.ok || !state.enabled) throw new Error("Expected valid AI state");

    expect(state.profiles[0]?.dataBoundary).toBe("private");
    expect(state.profiles[1]?.dataBoundary).toBe("private");
  });
});
