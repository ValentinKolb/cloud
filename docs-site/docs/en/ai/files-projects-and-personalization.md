---
title: Files, Projects, and personalization
navTitle: Files, Projects, and personalization
section: AI
order: 1050
description: Give AI controlled access to chat files, shared Project context, and durable personal preferences.
tags: [ai, files, projects, memory]
updated: 2026-08-10
---

# Files, Projects, and personalization

These features have separate ownership and lifetimes.

| Feature | Scope | Use |
| --- | --- | --- |
| Conversation files | One private chat | Inputs and generated artifacts |
| Projects | Shared through Cloud permissions | Instructions, knowledge, files, references, and defaults |
| Personalization | One user | Small durable preferences and facts |

## Store conversation files

Chat routes expose a Postgres-backed virtual file system below each conversation.
Paths are absolute and reject `..` segments. Default limits are 50 MB per file
and 250 MB per conversation. Forking a conversation copies its files.

The default Assistant tools can list files, read bounded UTF-8 slices, write
text below `/files`, and present downloads. They do not execute code, access the
host, or inject binary files into model context. Keep authorization at the
conversation route; a file path is not an access token.

## Use Projects for shared working context

A Project owns a name, description, icon, instructions, optional default model,
shared text knowledge and files, Cloud resource references, and `read`, `write`,
or `admin` grants. The owner has `admin`; Cloud resolves direct and nested group
membership from the authoritative account database.

Project chats remain private to their creator. Sharing a Project does not share
chat history. A chat is attached to one Project when created and is not
reassigned later.

When a turn is submitted, Cloud rechecks access and stores an immutable snapshot
with the Project id, name, revision, instructions, context manifest, and model
default. Retries reuse that snapshot. Project edits affect the next turn.
Workers recheck current access before execution, and `project_context` rechecks
it before every search or read.

Only Project instructions are instruction-bearing. Knowledge, files, references,
and tool results are untrusted data. References contain metadata only; the agent
must use the target app's current authorized capabilities to read the source.

The Assistant frontend intentionally starts small: create a Project and start a
private Project chat. The HTTP API and `cld assistant projects` expose complete
metadata, knowledge, file, reference, and access management.

## Use personalization for durable user context

Personalization stores `fact` or `preference` records for one user. Each entry
has a stable id, at most 500 characters, normal or pinned priority, source, and
timestamps. Manually added entries start pinned.

For up to 20 active records, Cloud adds the bounded set directly to the prompt.
Above that threshold, pinned records come first and PostgreSQL full-text search
selects relevant records within a 6,000-character budget. Native FTS is always
available; Cloud optionally uses the exact `pg_textsearch` BM25 index and falls
back for known extension-capability failures.

The `memory` tool can list, search, add, correct, pin, and forget entries. It
must not store secrets, credentials, raw chat logs, temporary task details, or
instructions from retrieved content. Learning from private chats is off by
default; its worker extracts only explicit durable facts and preferences and
never deletes a memory.

## Prompt order

Cloud composes the system prompt in this order:

1. platform rules;
2. organization instructions;
3. application instructions;
4. Project instructions;
5. the Project context manifest as untrusted data;
6. resource context as untrusted data;
7. relevant personal facts and preferences;
8. the final execution reminder.

See [AI resources and access](/en/docs/ai/resources-and-access) for authorized
domain context and [Tools and approvals](/en/docs/ai/tools-and-approvals) for
tool execution boundaries.
