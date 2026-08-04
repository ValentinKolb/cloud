---
title: Files, skills, and memory
navTitle: Files, skills, and memory
section: AI
order: 1050
description: Give AI features controlled access to files, reusable instructions, and durable context.
tags: [ai, files, skills, memory]
updated: 2026-08-04
---

# Files, skills, and memory

Files, skills, and memory solve different problems.

Do not combine them into one unbounded context store.

| Feature | Scope | Use |
| --- | --- | --- |
| Conversation files | One conversation | Inputs and generated artifacts |
| Skills | User or workspace | Reusable instructions selected for one request |
| Memory | One user | Small durable preferences and facts |

## Store conversation files

Chat routes expose a virtual file system below each conversation.

Uploads are stored in Postgres and stay available across workers and restarts.
Paths are absolute and reject `..` segments.

Default limits are:

| Limit | Default |
| --- | --- |
| One file | 50 MB |
| All files in one conversation | 250 MB |

The store supports listing, metadata, byte-range reads, writes, appends,
renames, and removal. Forking a conversation copies its files.

The default Assistant tool source exposes a deliberately small file surface:

- `list_files` lists `/input` uploads and `/files` results;
- `read_file` reads UTF-8 text in bounded slices;
- `write_file` writes or appends UTF-8 text below `/files`;
- `present` hands a file to the user as an openable download.

These tools do not execute code, access the host, or provide network access.
Binary files are never injected into model context through `read_file`.

Use the route or the chat controller for user uploads. Use `aiFileStore`
directly only from trusted server code that already owns the conversation.

Keep authorization at the conversation route. A file path is not an access
token.

## Use skills for reusable instructions

An AI skill contains a name, a short description, and reusable instructions.
It is guidance, not code or a file package.

Skills can be:

- owned by one user;
- managed for the workspace.

Users create and edit their own personal skills in Assistant. Workspace skills
are read-only there, including for administrators. Administrators create,
edit, enable, disable, and delete workspace skills in the AI settings.

The user explicitly selects at most one skill for a request. Cloud resolves it
with the current user's access, stores its name, instructions, and revision in
the queued turn, and applies that immutable snapshot only to that turn. Skills
are not scanned or loaded automatically and do not remain active for later
messages.

Names are limited to 80 characters, descriptions to 500 characters, and
instructions to 16,000 characters. Skill instructions remain subordinate to
platform, organization, and application rules.

The Cloud CLI exposes the same ownership boundary. Use `cld assistant skills`
to manage personal skills, add `--workspace` to catalog operations that an
administrator wants to apply to workspace skills, and use `skills enable` or
`skills disable` for workspace availability. `cld assistant ask --skill <id-or-name>`
applies one visible skill to one request; retries accept the same option.

Mount `createAiSkillsRoutes()` only behind the platform authentication
middleware. Normal mutation routes accept only personal skills owned by the
current user. Workspace mutation routes require the `admin` role.

## Use memory for durable user context

User AI preferences contain:

- custom instructions;
- a memory text block;
- whether memory is enabled;
- the last model used.

Instructions are limited to 4,000 characters. Memory is limited to 24,000
characters.

The default memory tool can add or remove short memory lines. Added lines carry
a date so the model can judge age.

Memory applies to user-backed actors. A service account without a delegated
user has no user memory.

> Do not use AI memory as an application database. Store domain facts in the
> application and load authorized context when needed.

## Compose prompt context deliberately

Cloud composes the system prompt in this order:

1. platform rules;
2. administrator instructions;
3. application prompt;
4. resource context;
5. the skill explicitly selected for the current turn;
6. user instructions;
7. user memory.

Only active tools add hints. File contents enter the model context when a tool
reads them. A selected skill enters the prompt as labeled, subordinate
instructions from the durable turn snapshot.

See [AI resources and access](/en/docs/ai/resources-and-access) for authorized
domain context.
