---
id: mail-collaboration
title: Work together in a mailbox
icon: ti ti-users
description: Assign work, coordinate replies, comment internally, and understand access levels.
order: 40
---

Cloud collaboration stays attached to a conversation while the underlying email remains normal provider mail. Open **Conversation details** to see team context and change collaboration state.

## Use ownership and status consistently {icon="route"}

- **Assignee** names the person currently responsible for the conversation.
- **Status** is **Open**, **Waiting**, or **Done**.
- **Response needed** marks that an external reply is still required. It is unavailable after the conversation is Done.
- **Snooze until** removes the conversation from active work until the selected time. It does not change provider folders.
- **Follow** adds you as a follower so followed views and collaboration context can include the conversation.

Incoming mail can reopen collaboration work when the configured behavior requires it. Treat **Done** as a team state, not as an email archive action.

## Add internal comments and mentions {icon="point"}

Internal comments are visible to people who can read the mailbox and are never sent to email recipients. Use them for handoffs, decisions, and reply context.

You can reply to an earlier comment and select people under **Mention people**. Mentioned users receive a Cloud notification only if they still have mailbox access when the notification is delivered.

Comment authors can edit or delete their own comments; mailbox administrators can moderate comments. Deleted comments leave a tombstone in the thread instead of silently removing the event from team history.

## Use personal reminders and presence {icon="route"}

**Personal reminder** is private to you. Clearing or changing it does not affect another collaborator's reminder. When due, Mail creates a Cloud notification if you still have access to the mailbox.

When live presence is available, **Here now** shows collaborators currently viewing or composing in the conversation. Presence is advisory. The shared draft lease remains the authoritative signal for who can edit a draft.

## Understand permissions {icon="shield-lock"}

Mailbox access is granted in **Settings > Access**.

| Permission | What it allows |
| --- | --- |
| Read | Read and search mail, download attachments, view collaboration context, write internal comments, and use personal reminders |
| Write | All Read actions plus compose and send, change provider mail state, assign work, change status, follow, snooze, and manage conversation tags |
| Admin | All Write actions plus connections, senders, folder mappings, shared settings, access, response policy, workflows, and mailbox deletion |

Access can be granted through the standard Cloud permission editor to the supported people, groups, or service accounts. Removing access takes effect for the mailbox, including open live views and future agent or service-account actions.

## Know what is shared and what is private {icon="shield-lock"}

Shared across the mailbox:

- messages and provider folders visible through the connected account,
- mailbox templates and mailbox default signatures,
- mailbox saved views,
- local tags,
- conversation assignment, status, followers, snooze state, comments, references, activity, and shared drafts.

Private to one user:

- private saved views,
- private signatures and snippets,
- personal signature defaults,
- personal reminders,
- device preferences such as compose format, Undo Send window, and pane layout.

For draft behavior and takeover consequences, see [Write and send messages](/app/mail?help=mail-compose).
