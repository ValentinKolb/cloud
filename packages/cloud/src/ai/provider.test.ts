import { describe, expect, test } from "bun:test";
import { createAiProvider } from "./provider";
import type { AiModelProfile } from "./types";

const profile = (overrides: Partial<AiModelProfile>): AiModelProfile => ({
  id: "model-1",
  label: "Model 1",
  provider: "openrouter",
  model: "openai/gpt-4.1-mini",
  enabled: true,
  capabilities: ["streaming"],
  dataBoundary: "hosted",
  ...overrides,
});

describe("AI provider factory", () => {
  test("maps Cloud model profiles to Nessi provider metadata without provider calls", () => {
    const provider = createAiProvider(profile({ provider: "openrouter", model: "openai/gpt-4.1-mini" }), "secret");

    expect(provider.name).toBe("openrouter");
    expect(provider.family).toBe("openai-compatible");
    expect(provider.model).toBe("openai/gpt-4.1-mini");
  });

  test("requires baseURL for custom OpenAI-compatible providers", () => {
    expect(() =>
      createAiProvider(
        profile({
          id: "custom",
          provider: "openai-compatible",
          model: "custom-model",
        }),
        "secret",
      ),
    ).toThrow('AI model profile "custom" requires baseURL');
  });
});
