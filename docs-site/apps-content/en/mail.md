---
title: Mail
navTitle: Mail
section: Work
order: 110
description: Connected mailboxes with search, team context, reliable sending, and automation.
tags: [mail, email, collaboration]
updated: 2026-08-15
---

# Mail

Mail connects email accounts and turns their messages into a shared workspace.
It keeps portable mail state synchronized with the provider while adding team
context such as assignments, comments, local tags, reminders, and follow-up state.

## Use Mail

- Read complete conversations and search synchronized message content across a
  mailbox.
- Organize provider mail with folders, read state, flags, archive, junk, and
  trash actions.
- Assign conversations, maintain a shared summary, leave internal comments,
  browse by local tag, and mark work done while Mail derives whether the next
  step needs action or is waiting for a reply.
- Continue the newest unfinished conversation draft directly from the reader.
- Compose and schedule messages through verified sender identities.
- Review detected mailing lists and safely request unsubscribe or clean up existing messages when permitted.
- Use incoming automations, automatic replies, or reviewed workflows for
  recurring mailbox work.

Provider folders and message flags can appear in other mail clients. Cloud-only
collaboration fields stay in Mail.

## Understand the Mail model

| Resource | Responsibility |
| --- | --- |
| Mailbox | One connected email account with provider settings and its own access rules |
| Conversation and message | A synchronized thread and its individual received or sent messages |
| Sender identity and draft | Verified sending context and message content before delivery |
| Collaboration state | Editable summaries, assignees, comments, local tags, reminders, and a derived next step with manual Done |
| Incoming automation and workflow | Reviewed flows that match incoming mail and mix bounded Mail and AI actions |

The email provider remains the source for portable mail state. Mail keeps a
synchronized Cloud copy for search, collaboration, durable commands, and
observable delivery. Credentials and refresh tokens are stored as write-only
secrets.

## How Mail fits Cloud

Mail owns mailbox synchronization, conversations, drafts, sending, and mailbox
automation. Cloud supplies identity, resource access, encrypted settings,
notifications, workflow infrastructure, application discovery, and shared Help
and administration surfaces. Mail also integrates with Spaces for calendar
invitations without turning Mail into the calendar owner.

## Find detailed product help

Open **Help** inside Mail for account setup, search, reading, composing,
collaboration, incoming automations, workflows, administration, and
troubleshooting.
Developers can read [Resource authorization](/en/docs/identity/authorization),
[Notifications](/en/docs/platform/notifications), and
[Workflow overview](/en/docs/automation/workflow-overview) for the shared
contracts Mail adopts.

## Automate Mail from the terminal

Mail provides a native CLI module for mailbox operations. These commands list
readable mailboxes and search the current default mailbox:

```bash
cld mail list --json
cld mail search --any "renewal" --json
```

Run `cld mail help` for mailbox, conversation, message, collaboration,
provider, automation, and workflow commands. Run `cld mail <command> --help` before a
mutation or delivery operation to read its current fields and safety checks.
