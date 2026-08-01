---
title: Assistant
navTitle: Assistant
section: Work
order: 100
description: A personal AI workspace for conversations, files, skills, and reusable preferences.
tags: [assistant, ai, chats]
updated: 2026-08-02
---

# Assistant

Assistant is a personal AI workspace for writing, explaining, planning, and
working with supported files. Chats belong to the current user and remain
available when the work continues later.

## Use Assistant

- Start a chat for a draft, summary, explanation, plan, or question.
- Attach source files when the answer must use material beyond the message.
- Return to saved work through recent chats, search, or the full chat list.
- Fork a useful point when another direction should not replace the existing
  conversation.
- Choose a model when the task needs a capability that the default model does
  not provide, and review requested actions before approving them.

Assistant can make mistakes. Check consequential facts, calculations, and
proposed actions before relying on them.

## Understand the Assistant model

| Resource or surface | Responsibility |
| --- | --- |
| Chat | One user-owned conversation with a name, icon, and optional description |
| Message and turn | A request and the assistant run that answers it |
| Chat files | Source files and editable artifacts kept with one conversation |
| Preferences and memory | Reusable personal context applied across conversations when enabled |
| Skill | A managed set of instructions and files available to Assistant |

A model profile selects the provider model and available capabilities for a
turn. Retry reruns a message in the current branch. Fork copies the conversation
through a selected message into a new chat.

## How Assistant fits Cloud

Assistant owns its chat workspace and user experience. It uses Cloud's shared
AI runtime for conversations, model selection, streaming turns, files, skills,
memory, tool approvals, maintenance, and completion notifications. Cloud
identity keeps each personal workspace bound to a user.

## Find detailed product help

Open **Help** inside Assistant for chats, message actions, files,
personalization, and guidance for better requests. Developers can read
[Chat runtime and streaming](/en/docs/ai/chat-runtime-and-streaming),
[Files, skills, and memory](/en/docs/ai/files-skills-and-memory), and
[Tools and approvals](/en/docs/ai/tools-and-approvals) for the shared contracts
Assistant adopts.

## Automate Assistant from the terminal

Assistant provides a native CLI module for chat and workspace automation. Start
with these read-only checks before choosing a model or continuing a chat:

```bash
cld assistant status --json
cld assistant models --json
```

Run `cld assistant help` for chats, messages, files, preferences, skills, and
turn actions. Run `cld assistant <command> --help` before submitting a request
or approving an action.
