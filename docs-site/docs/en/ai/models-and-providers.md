---
title: Models and providers
navTitle: Models and providers
section: AI
order: 1020
description: Configure models and providers without exposing credentials to application clients.
tags: [ai, models, providers]
updated: 2026-08-17
---

# Models and providers

Administrators configure model profiles. Applications select them through a
policy.

A profile names the provider and model. It also records capabilities and the
data boundary used for policy checks.

## Use a model policy

```ts
modelPolicy: {
  kind: "selectable",
  allowedDataBoundaries: ["private"],
  requiredCapabilities: ["streaming", "tools"],
}
```

| Policy | Behavior |
| --- | --- |
| `platform-default` | Uses the configured platform default |
| `locked` | Uses one model profile |
| `selectable` | Lets the caller choose from the allowed profiles |

Every policy can limit `allowedDataBoundaries` and require capabilities.

A locked policy needs `modelId`. A selectable policy may set
`defaultModelId` and `allowedModelIds`.

## Model profile fields

| Field | Meaning |
| --- | --- |
| `id` | Stable profile ID used by policies and requests |
| `label` | User-facing name |
| `provider` | Provider adapter |
| `model` | Provider model name |
| `enabled` | Whether Cloud may resolve the profile |
| `capabilities` | `streaming`, `tools`, or `vision` |
| `dataBoundary` | `hosted` or `private` |
| `baseURL` | Optional provider endpoint |
| `contextWindow` | Optional context limit |
| `temperature` | Optional profile default |
| `maxOutputTokens` | Optional output limit |
| `maxLoadedTools` | Deferred tool names retained per conversation; missing, `0`, or negative is unlimited, while a positive value keeps the newest names and evicts the oldest |
| `maxToolRounds` | Tool-using model rounds allowed per chat turn; missing, `0`, or negative is unlimited, while a positive value reserves one additional tool-free model round for the final answer |

Turn deadlines, cancellation, provider failures, and exhausted credits can still
end a chat independently of the tool-round policy.

Model responses sent to the browser omit credentials and private
configuration.

## Supported providers

Cloud includes adapters for OpenAI, OpenRouter, Anthropic, Mistral, Gemini,
Ollama, vLLM, and OpenAI-compatible endpoints.

Hosted providers require a credential. Ollama, vLLM, and OpenAI-compatible
profiles can run against private infrastructure.

An OpenAI-compatible profile must set `baseURL`.

## Handle configuration errors

Model resolution fails clearly when:

- AI is disabled;
- the profile JSON is invalid;
- the default profile is missing or disabled;
- a required credential is missing;
- no profile matches the model policy.

Show the returned settings error to an administrator. Do not silently switch to
a model outside the application policy.

Provider credentials are server-side settings. Never pass them to an island or
store them in application data.

## Configure image inspection

`view_image` is available to tool-capable chat models. When the selected model
also supports Vision, it performs the explicit image inspection itself. Set
**Vision tool model** to an enabled profile with the `vision` capability when
tool-capable models without Vision must inspect images too. Cloud does not
silently choose another provider. The selected or configured tool model must
match the application's allowed data boundary; Cloud does not route private
chat data to a hosted fallback.

See [Settings](/en/docs/platform/settings) for runtime configuration and
[Runtime configuration](/en/docs/operations/runtime-configuration) for
deployment responsibilities.
