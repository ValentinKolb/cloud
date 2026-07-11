---
name: cloud-cli
description: Use the Cloud CLI (`cld`) to work with a user's Cloud content from a terminal. Use this skill whenever an agent needs to use installed Cloud app commands, sign in or select a Cloud profile, choose safe CLI input/output, or complete Contacts or Tools workflows for the user.
---

# Cloud CLI

Use `cld` to work with the user's Cloud content from a terminal. It handles sign-in, the selected Cloud instance, command discovery, and structured output.

## Start

1. Run `cld help` to discover installed app modules.
2. On a new machine, sign in with `cld login --server <Cloud URL>`. Inspect or switch profiles with `cld profile list` and `cld profile use <name>`.
3. Read module help before an unfamiliar operation: `cld <app> help` or `cld <app> <command> --help`.
4. Use the default profile unless the task names another instance; pass `--profile <name>` only when needed.

## Agent workflow

- Stay on the user's selected profile unless they name another Cloud instance.
- Read before changing content. Use IDs returned by list or get commands when a name is not unique.
- Use `--json` whenever the next action depends on command output. Keep normal output for simple inspection.
- Pass structured or multiline content through a command's file or stdin option instead of trying to escape it in a shell argument.
- Do not delete content, revoke access, or perform another destructive action without an explicit user request. Check command help for any required confirmation first.

## References

- Read [Account](references/account.md) to manage the signed-in user's profile, personal API keys, SSH keys, and account extension.
- Read [Contacts](references/contacts.md) for contact books, contacts, tags, notes, exports, and access grants.
- Read [Spaces](references/spaces.md) for spaces, items, comments, calendars, and access grants.
- Read [Tools](references/tools.md) for local password, encoding, QR, encryption, and speedtest utilities.
- Read [Venue](references/venue.md) to operate venues, opening rules, public sections, shifts, and venue access.

Administrators should additionally read the reference that matches the task:

- [Accounts](references/accounts.md) for accounts, groups, requests, audit events, and service-account credentials.
- [Administration](references/admin.md) for health, logs, diagnostics, notifications, announcements, webhooks, storage diagnostics, and metrics.
- [OAuth](references/oauth.md) for OAuth client configuration.
- [IPA hosts](references/ipa-hosts.md) for FreeIPA hosts, hostgroups, and host synchronization.
