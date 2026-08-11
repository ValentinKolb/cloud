---
title: AI
navTitle: Overview
section: AI
order: 1000
description: Choose the smallest model runtime while keeping application authority explicit.
tags: [ai, models, tools]
updated: 2026-08-12
---

# AI

Cloud provides a shared runtime for model-backed features.

An application can add a resource chat, call a model for structured output, or
define tools. Cloud supplies model configuration, credentials, conversation
storage, streaming, approvals, files, Projects, personalization, and runtime recovery.

The application still owns the product behavior. It decides:

- who may use the feature;
- which domain data enters the model context;
- which tools are available;
- which model policy applies;
- how the result changes application state.

That ownership does not move into a prompt. Cloud can authenticate the caller,
store a turn, validate schemas, and pause for approval, but only the application
knows which domain data may be disclosed and which operation is allowed now.

## Choose the smallest API

| Need | Start with |
| --- | --- |
| AI attached to an application resource | [`defineAiResource()`](/en/docs/ai/resources-and-access) |
| A standalone chat surface | [`createAiChatRoutes()`](/en/docs/ai/chat-runtime-and-streaming) |
| One validated background result | [`runAiStructured()`](/en/docs/ai/structured-and-background-ai) |
| A model-requested action | [`defineAiTool()`](/en/docs/ai/tools-and-approvals) |
| Conversation files, Projects, or user memory | [Files, Projects, and personalization](/en/docs/ai/files-projects-and-personalization) |
| Shared chat components | [Chat interface](/en/docs/ai/chat-interface) |

Do not create a chat when one structured call is enough. Do not create a custom
tool when a stable app operation should be published once as a
[Capability](/en/docs/platform/capabilities) for several consumers.

## Keep the application boundary

Cloud resolves the current actor before it starts a turn. Resource chats check
access before loading context and again before a server tool runs.

Model credentials stay on the server. Browser code sees sanitized model
metadata, not provider secrets.

Cloud records conversations and tool results. The application database remains
the source of truth for domain data.

> Treat model output as untrusted input. Validate it before a write and run the
> same authorization checks used by a normal request.

Start with [AI resources and access](/en/docs/ai/resources-and-access) for an
embedded feature. Read [Chat runtime and streaming](/en/docs/ai/chat-runtime-and-streaming)
for the conversation lifecycle and [Models and providers](/en/docs/ai/models-and-providers)
for deployment configuration.
