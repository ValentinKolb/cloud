---
title: Models and providers
navTitle: Models and providers
section: AI
order: 1020
description: Configure models and providers without exposing credentials to application clients.
tags: [ai, models, providers]
updated: 2026-08-02
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
| `maxLoadedCapabilities` | Loaded capability names retained per conversation; missing, `0`, or negative is unlimited, while a positive value keeps the newest names and evicts the oldest |

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

See [Settings](/en/docs/platform/settings) for runtime configuration and
[Runtime configuration](/en/docs/operations/runtime-configuration) for
deployment responsibilities.
