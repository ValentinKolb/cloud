---
id: mail-start
title: Start with Mail
icon: ti ti-mail-plus
description: Understand mailboxes, connect an account, and reach a safe first sync.
order: 10
---

Mail organizes email around **mailboxes**. A mailbox connects one email account, contains the folders exposed by that provider, and defines who may read, operate, or administer it.

The email provider remains the source for portable mail state. Moving a message, changing its read state, flagging it, or sending mail can therefore appear in other mail clients connected to the same account. Cloud adds collaboration data such as assignees, internal comments, local tags, reminders, and work status. Those Cloud-only details do not appear in other mail clients.

## Choose the right starting point {icon="square-plus"}

- Open a mailbox card under **Your mailboxes** to work with an existing mailbox.
- Use **Search mailboxes** to filter the overview by mailbox name or description.
- Select **New mailbox** when you need to connect another email account.
- A new mailbox starts private. You are its administrator until you grant access in **Settings > Access**.

## Connect your first mailbox {icon="square-plus"}

:::steps
1. Select **New mailbox**.
2. Enter a **Name** that collaborators will recognize. The description is optional.
3. In the settings dialog, open **Connections**.
4. Enter the email address and select **Find settings**, or enter the IMAP and SMTP hosts, ports, and TLS modes yourself.
5. For a configured Google or Microsoft account, select the browser OAuth button and approve access. Otherwise enter the password, app password, or OAuth2 access token supplied by the provider.
6. Leave **Create the default identity for this address** enabled for a normal mailbox.
7. Select **Verify and connect**.
:::

Mail verifies IMAP and SMTP separately before storing the credential. Credentials and OAuth refresh tokens are encrypted and write-only: after they are accepted, no user or mailbox administrator can reveal them again. Managed OAuth connections refresh automatically and show **Reconnect** when provider consent has expired or was revoked. Manual credentials remain available for every generic IMAP/SMTP provider.

After setup, Mail discovers the provider's folders and begins synchronization. Initial history can appear progressively while the mailbox remains usable. Open **Settings > Status** to see transport health, folder discovery, synchronization, and search-index state.

## Check that sending is ready {icon="send"}

Open **Settings > Identities**. An identity groups everything Mail should use for one sending context:

- **Identity label** is private to the mailbox and helps collaborators choose the right context, such as “University” or “Private”.
- **Display name** and **From address** are visible to recipients.
- A normal connection creates a default identity for the account address.
- Every identity must be **verified** before Mail can send with it. Two identities may use the same From address while keeping different defaults.
- **Automatic replies** is a separate identity permission. It is enabled by default for new identities, but automatic mail is sent only after an administrator creates and enables an automatic reply or workflow.

## Understand the mailbox workspace {icon="layout-grid"}

The left navigation contains:

- **Work** views for Needs action, assignment, Waiting for reply, Done, and recent activity, plus a separate **Follow-up** view for Snoozed conversations and Scheduled delivery under Drafts.
- **Automations** for out-of-office replies, acknowledgements, and advanced mailbox workflows with inline response windows.
- **Saved views** created from reusable mailbox and collaboration filters.
- **Folders** synchronized from the provider, shown in their nested hierarchy, plus **All mail**. Mailbox administrators can hide folders from this navigation without deleting or unsubscribing them.
- **Sync mailbox** and **Settings** at the bottom when your permission allows them.

The center list shows one row per conversation. The reader groups the messages in that conversation. Use the **Conversation details** button to open team context, local tags, ownership, comments, reminders, and recent activity. You can hide the conversation list when you need more reading space.

## Continue with a task {icon="point"}

- [Read, search, and organize mail](/app/mail/help/mail-work)
- [Write and send messages](/app/mail/help/mail-compose)
- [Work together in a mailbox](/app/mail/help/mail-collaboration)
- [Set up and manage a mailbox](/app/mail/help/mail-admin)
- [Automate responses and mailbox work](/app/mail/help/mail-automation)
- [Mail workflow YAML reference](/app/mail/help/mail-workflows)
- [Troubleshoot Mail](/app/mail/help/mail-troubleshooting)
