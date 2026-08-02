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
      ...overrides[0],
    },
    ...overrides.slice(1),
  ]);

const resolve = (input: {
  enabled?: boolean;
  defaultModelId?: string;
  profilesJson?: string;
  /** Keyed by profile id, mirroring ai.model_credentials. */
  credentials?: Record<string, string>;
  firecrawlApiKey?: string;
}) =>
  resolveAiSettingsStateFromRaw({
    enabled: input.enabled ?? true,
    defaultModelId: input.defaultModelId ?? "openrouter-fast",
    profilesJson: input.profilesJson ?? profilesJson(),
    firecrawlApiKey: input.firecrawlApiKey,
    readCredential: async (profileId) => (input.credentials ?? { "openrouter-fast": "secret" })[profileId] ?? null,
  });

describe("AI settings model registry", () => {
  test("accepts a valid enabled default model with profile-bound credentials", async () => {
    const state = await resolve({});

    expect(state.ok).toBe(true);
    expect(state.enabled).toBe(true);
    expect(state.firecrawlConfigured).toBe(false);
    if (state.ok) expect(state.profiles[0]?.id).toBe("openrouter-fast");
  });

  test("keeps maxLoadedCapabilities optional and accepts zero or negative as unlimited", async () => {
    for (const maxLoadedCapabilities of [undefined, 0, -1, 12]) {
      const state = await resolve({ profilesJson: profilesJson([{ maxLoadedCapabilities }]) });
      expect(state.ok).toBe(true);
      if (state.ok) expect(state.profiles[0]?.maxLoadedCapabilities).toBe(maxLoadedCapabilities);
    }
  });

  test("tracks Firecrawl configuration without exposing the key", async () => {
    const state = await resolve({ firecrawlApiKey: "fc-secret" });

    expect(state.ok).toBe(true);
    expect(state.firecrawlConfigured).toBe(true);
    expect(JSON.stringify(state)).not.toContain("fc-secret");
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
    const state = await resolve({ credentials: {} });

    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.error.code).toBe("missing_provider_credential");
  });

  test("reads the credential from the store rather than the profile", async () => {
    // The profile JSON never carries a key, so a state that resolves proves the
    // lookup went to ai.model_credentials under the profile's id.
    const state = await resolve({ credentials: { "openrouter-fast": "secret" } });

    expect(state.ok).toBe(true);
    expect(JSON.stringify(state)).not.toContain("secret");
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
