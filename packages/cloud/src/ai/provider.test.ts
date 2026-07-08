import { describe, expect, test } from "bun:test";
import type { ProviderEvent } from "@valentinkolb/nessi";
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
      const events: ProviderEvent[] = [];
      for await (const event of provider.stream({
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      })) {
        events.push(event);
      }

      expect(provider.capabilities.thinking).toBe(true);
      expect(requests[0]).toMatchObject({ model: "qwen3.6", stream: true });
      expect(requests[0]).not.toHaveProperty("max_tokens");
      // 0.5.0 block model: reasoning and text arrive as separate canonical blocks.
      const deltaFor = (kind: string) => {
        const start = events.find((event) => event.type === "block_start" && event.kind === kind);
        if (!start || start.type !== "block_start") return "";
        return events
          .filter((event) => event.type === "block_delta" && event.blockId === start.blockId)
          .map((event) => (event.type === "block_delta" ? event.delta : ""))
          .join("");
      };
      expect(deltaFor("thinking")).toBe("plan first");
      expect(deltaFor("text")).toBe("answer");

      for await (const _event of provider.stream({
        messages: [{ role: "user", content: [{ type: "text", text: "short" }] }],
        maxOutputTokens: 64,
      })) {
        // Exhaust the stream so the request body is captured.
      }
      expect(requests[1]).toMatchObject({ model: "qwen3.6", stream: true, max_tokens: 64 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
