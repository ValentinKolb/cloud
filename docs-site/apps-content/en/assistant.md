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

## Use Assistant from the terminal

Assistant provides one native CLI entry point for interactive work and
automation:

```bash
cld assistant
cld assistant "Start with this request"
cld assistant --chat <chat-id>
cld assistant -p "Print one response and exit"
```

Interactive mode streams replies into the terminal and keeps the same chat for
later prompts. Use `--print` or `-p` for scripts, pipelines, structured output,
or one request without a prompt loop. Its startup line shows the effective
model. A new chat prints its stable `cld assistant --chat <chat-id>` resume
command, and the CLI repeats that command when the session ends. Blue `Info:`
messages confirm non-error state changes such as attachments, model or skill
selection, and stopped turns. Run `/model` or `/skill` without an argument to
select an available model or visible skill by number. The model remains active
for the session; the skill applies only to the next message.

Use `cld assistant --allow-bash` when the Assistant must work on the computer
running the CLI. This exposes a local Bash tool only for that interactive
session. Every requested command is shown and requires a fresh `Y/n`
confirmation. Commands run with the current OS user's permissions in the CLI's
startup directory, and their bounded output is stored in the chat and sent to
the model. The web app can display these calls later but cannot run them.

Start with these read-only checks before choosing a model or continuing a chat:

```bash
cld assistant status --json
cld assistant models --json
```

Run `cld assistant help` for chat flags and the management commands for chats,
messages, files, preferences, skills, and turn actions. Run
`cld assistant <command> --help` before approving or changing stored state.
