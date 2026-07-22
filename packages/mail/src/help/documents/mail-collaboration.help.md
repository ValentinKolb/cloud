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
- **Next step** is **Needs action**, **Waiting for reply**, or **Done**. Needs action means the team must review or act. Waiting for reply means a confirmed human reply was sent and the next step belongs to someone else. Done means no current action remains.
- **Snooze until** temporarily removes the conversation from active work without changing its next step. Use it when the next review depends on time rather than another person. Its due time reveals the conversation again; new incoming mail ends the snooze immediately.

New incoming mail changes any conversation to **Needs action**. A confirmed human reply or reply-all changes it to **Waiting for reply**. Automatic replies, forwards, new messages, retries, failed sends, and ambiguous delivery outcomes leave the current next step unchanged. Treat **Done** as a team state, not as an email archive action.

## Add internal comments {icon="point"}

Internal comments are visible to people who can read the mailbox and are never sent to email recipients. Use them for handoffs, decisions, and reply context.

You can reply to an earlier comment to keep related context together. Mail does not notify individual people about comments, so use assignment when a specific collaborator is responsible for the next step.

Comment authors can edit or delete their own comments; mailbox administrators can moderate comments. Deleted comments leave a tombstone in the thread instead of silently removing the event from team history.

## Use personal reminders and presence {icon="route"}

**Personal reminder** is private to you. Clearing or changing it does not affect another collaborator's reminder. When due, Mail creates a Cloud notification if you still have access to the mailbox.

When live presence is available, **Here now** shows collaborators currently viewing or composing in the conversation. Presence is advisory. The shared draft lease remains the authoritative signal for who can edit a draft.

## Understand permissions {icon="shield-lock"}

Mailbox access is granted in **Settings > Access**.

| Permission | What it allows |
| --- | --- |
| Read | Read and search mail, download attachments, view collaboration context, write internal comments, and use personal reminders |
| Write | All Read actions plus compose and send, change provider mail state, assign work, change status, snooze, and manage conversation tags |
| Admin | All Write actions plus connections, senders, folder mappings, shared settings, access, response policy, workflows, and mailbox deletion |

Access can be granted through the standard Cloud permission editor to the supported people, groups, or service accounts. Removing access takes effect for the mailbox, including open live views and future agent or service-account actions.

## Use Contacts context {icon="address-book"}

Open **Conversation details** to see Contacts whose email addresses exactly match visible conversation participants. Multiple Contacts can match the same address; Mail shows every currently readable match and does not choose or merge them. **Related Mail** stays inside the current mailbox and rechecks Contact access before every page.

If an external participant has no matching Contact, select **Add as contact**. Contacts opens in a new tab with the displayed name and email prefilled. With one writable contact book it opens the contact form directly; with multiple writable books it asks where to store the Contact first. No button is shown for an address that already matches a readable Contact, including matches that are not on the first result page.

Mail stores no Contact ownership, notes, bank details, access entries, or other private fields. It requests a bounded participant projection from Contacts whenever the details panel is opened.

The CLI exposes the same boundary through `cld mail conversation context` and `contact-history`.

## Know what is shared and what is private {icon="shield-lock"}

Shared across the mailbox:

- messages and provider folders visible through the connected account,
- mailbox templates and mailbox default signatures,
- mailbox saved views,
- local tags,
- conversation assignment, status, snooze state, comments, references, activity, and shared drafts.

Private to one user:

- private saved views,
- private signatures and snippets,
- personal signature defaults,
- personal reminders,
- device preferences such as compose format, Undo Send window, and pane layout.

For draft behavior and takeover consequences, see [Write and send messages](/app/mail/help/mail-compose).
