---
title: AI
navTitle: Overview
section: AI
order: 1000
description: Choose the Cloud AI services needed by an application.
tags: [ai, models, tools]
updated: 2026-07-27
---

# AI

Cloud provides a shared runtime for model-backed features.

An application can add a resource chat, call a model for structured output, or
define tools. Cloud supplies model configuration, credentials, conversation
storage, streaming, approvals, files, skills, and runtime recovery.

The application still owns the product behavior. It decides:

- who may use the feature;
- which domain data enters the model context;
- which tools are available;
- which model policy applies;
- how the result changes application state.

## Choose the smallest API

| Need | Start with |
| --- | --- |
| AI attached to an application resource | [`defineAiResource()`](/docs/en/ai/resources-and-access) |
| A standalone chat surface | [`createAiChatRoutes()`](/docs/en/ai/chat-runtime-and-streaming) |
| One validated background result | [`runAiStructured()`](/docs/en/ai/structured-and-background-ai) |
| A model-requested action | [`defineAiTool()`](/docs/en/ai/tools-and-approvals) |
| Shared chat components | [AI user interface](/docs/en/ai/ui-and-operations) |

Do not create a chat when one structured call is enough.

## Security and data boundary

Cloud resolves the current actor before it starts a turn. Resource chats check
access before loading context and again before a server tool runs.

Model credentials stay on the server. Browser code sees sanitized model
metadata, not provider secrets.

Cloud records conversations and tool results. The application database remains
the source of truth for domain data.

> Treat model output as untrusted input. Validate it before a write and run the
> same authorization checks used by a normal request.

## AI request lifecycle

1. The route authenticates the caller.
2. The application resolves resource access and model policy.
3. Cloud creates or loads the conversation.
4. A turn is queued for the shared runtime.
5. The runtime composes the prompt and resolves the model.
6. Streaming events update the browser.
7. Tool calls wait for execution or approval when needed.
8. Cloud persists the final result and usage.

Start with [AI resources and access](/docs/en/ai/resources-and-access) for an
embedded application feature. Use [Models and providers](/docs/en/ai/models-and-providers)
when the deployment needs model configuration.
