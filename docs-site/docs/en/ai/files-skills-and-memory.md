---
title: Files, skills, and memory
navTitle: Files, skills, and memory
section: AI
order: 1050
description: Give AI features controlled access to files, reusable instructions, and durable context.
tags: [ai, files, skills, memory]
updated: 2026-07-27
---

# Files, skills, and memory

Files, skills, and memory solve different problems.

Do not combine them into one unbounded context store.

| Feature | Scope | Use |
| --- | --- | --- |
| Conversation files | One conversation | Inputs and generated artifacts |
| Skills | User or workspace | Reusable instructions and optional code |
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

Use the route or the chat controller for user uploads. Use `aiFileStore`
directly only from trusted server code that already owns the conversation.

Keep authorization at the conversation route. A file path is not an access
token.

## Use skills for reusable instructions

An AI skill is a file tree with `/SKILL.md` as its entry point.

Skills can be:

- owned by one user;
- managed for the workspace;
- shared with other users.

Shared skills are opt-in. Workspace skills can be enabled by policy.

The default limits are 2 MB per file and 20 MB per skill.

Skills that run code require review. Approval binds to a hash of the full file
tree. Any file change revokes the code approval.

Mount `createAiSkillsRoutes()` only behind the platform authentication
middleware. Administrative listing, review, approval, and revocation routes
also require the `admin` role.

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
5. user instructions;
6. user memory.

Only active tools and skills add hints. File contents enter the model context
when the runtime or a tool reads them.

See [AI resources and access](/docs/en/ai/resources-and-access) for authorized
domain context.
