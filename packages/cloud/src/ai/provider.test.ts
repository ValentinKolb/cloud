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

  test("surfaces vLLM reasoning deltas as Nessi thinking events", async () => {
    const originalFetch = globalThis.fetch;
    const requests: unknown[] = [];

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init?.body ? JSON.parse(String(init.body)) : null);
      return new Response(
        [
          'data: {"choices":[{"delta":{"reasoning":"plan first"},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;

    try {
      const provider = createAiProvider(
        profile({
          provider: "vllm",
          model: "qwen3.6",
          baseURL: "http://vllm.example.test/v1",
        }),
      );
      const events = [];
      for await (const event of provider.stream({
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      })) {
        events.push(event);
      }

      expect(provider.capabilities.thinking).toBe(true);
      expect(requests[0]).toMatchObject({ model: "qwen3.6", stream: true });
      expect(events).toContainEqual({ type: "thinking", delta: "plan first" });
      expect(events).toContainEqual({ type: "text", delta: "answer" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
