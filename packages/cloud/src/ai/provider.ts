import type { Provider } from "@valentinkolb/nessi/ai";
import { anthropic, gemini, mistral, ollama, openAICompatible, openai, openrouter } from "@valentinkolb/nessi/ai";
import type { AiModelProfile } from "./types";

const commonOptions = (profile: AiModelProfile, apiKey?: string) => ({
  apiKey,
  baseURL: profile.baseURL,
  contextWindow: profile.contextWindow,
  temperature: profile.temperature,
  creditsPerInputToken: profile.creditsPerInputToken,
  creditsPerOutputToken: profile.creditsPerOutputToken,
});

export const createAiProvider = (profile: AiModelProfile, apiKey?: string): Provider => {
  switch (profile.provider) {
    case "openai":
      return openai(profile.model, commonOptions(profile, apiKey));
    case "openrouter":
      return openrouter(profile.model, commonOptions(profile, apiKey));
    case "anthropic":
      return anthropic(profile.model, { ...commonOptions(profile, apiKey), maxOutputTokens: profile.maxOutputTokens });
    case "mistral":
      return mistral(profile.model, commonOptions(profile, apiKey));
    case "gemini":
      return gemini(profile.model, { ...commonOptions(profile, apiKey), maxOutputTokens: profile.maxOutputTokens });
    case "ollama":
      return ollama(profile.model, {
        baseURL: profile.baseURL,
        contextWindow: profile.contextWindow,
        temperature: profile.temperature,
        creditsPerInputToken: profile.creditsPerInputToken,
        creditsPerOutputToken: profile.creditsPerOutputToken,
      });
    case "vllm":
      return openAICompatible({
        name: "vllm",
        model: profile.model,
        baseURL: profile.baseURL ?? "http://localhost:8000/v1",
        apiKey,
        contextWindow: profile.contextWindow,
        temperature: profile.temperature,
        creditsPerInputToken: profile.creditsPerInputToken,
        creditsPerOutputToken: profile.creditsPerOutputToken,
        compat: {
          toolCallIdPolicy: "passthrough",
          supportsUsageInStreaming: true,
          thinkingFormat: "text",
          maxTokensField: "max_tokens",
        },
      });
    case "openai-compatible":
      if (!profile.baseURL) throw new Error(`AI model profile "${profile.id}" requires baseURL for openai-compatible provider.`);
      return openAICompatible({
        name: profile.id,
        model: profile.model,
        baseURL: profile.baseURL,
        apiKey,
        contextWindow: profile.contextWindow,
        temperature: profile.temperature,
        creditsPerInputToken: profile.creditsPerInputToken,
        creditsPerOutputToken: profile.creditsPerOutputToken,
      });
  }
};
