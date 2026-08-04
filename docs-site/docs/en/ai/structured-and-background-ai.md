---
title: Structured and background AI
navTitle: Structured and background AI
section: AI
order: 1060
description: Run validated model tasks outside an interactive chat request.
tags: [ai, structured-output, background]
updated: 2026-07-27
---

# Structured and background AI

Use `runAiStructured()` for one schema-valid model result.

It is the right API for classification, extraction, enrichment, and other
bounded tasks that do not need a conversation.

`runAiStructured()` executes a model request. It does not receive an actor or
an access subject.

Authorize the domain read first. Send only the fields required by the task.

## Run a structured task

```ts
import { runAiStructured } from "@valentinkolb/cloud/ai";
import { z } from "zod";

const item = await loadItemForAi({
  itemId,
  actor,
  accessSubject,
});
if (!item) throw new Error("Item not found");

const result = await runAiStructured({
  task: "inventory-categorize",
  appId: "inventory",
  input: JSON.stringify({
    name: item.name,
    description: item.description,
  }),
  systemPrompt: "Classify the item using the supplied text only.",
  outputName: "classification",
  output: z.object({
    category: z.enum(["hardware", "office", "other"]),
    confidence: z.number().min(0).max(1),
  }),
  temperature: 0,
  maxOutputTokens: 200,
  signal,
});

console.log(result.output.category);
```

`loadItemForAi()` is the authorization boundary. Its return value is the
redacted model input.

The returned value includes the parsed output, model profile ID, usage, and
structured-output metadata.

## Set the task fields

| Field | Purpose |
| --- | --- |
| `task` | Short stable name used in tracing |
| `input` | User or application input |
| `output` | Zod schema for the result |
| `outputName` | Optional provider-facing schema name |
| `systemPrompt` | Optional task instructions |
| `requestedModelId` | Optional explicit profile |
| `temperature` | Task-level override |
| `maxOutputTokens` | Task-level output limit |
| `signal` | Cancellation |
| `traceParent` | Parent span for existing background work |
| `appId` | Application attribution |

The function resolves the model, requests structured output, validates the
result, and records a trace span.

Prompts and model output are not written to the trace. Metadata includes the
model, duration, token counts, output mode, repair state, and attempts.

## Choose the background model

Model resolution follows this order:

1. `requestedModelId`;
2. the `ai.background_model_id` setting;
3. the platform default.

Resolution fails when AI is disabled or the model is unavailable.

Do not silently turn a failed AI result into application truth. Decide whether
the caller should retry, skip the optional enrichment, or surface the error.

## Run it from durable work

An HTTP request may end before a slow model call does.

For important background work, call `runAiStructured()` from a
[job or queue worker](/en/docs/automation/jobs-and-queues). Pass the job abort
signal and a parent trace.

Keep retries around the whole task. Do not retry a schema failure forever.

Use [Chat runtime and streaming](/en/docs/ai/chat-runtime-and-streaming) when
the user needs an interactive, stored conversation.
