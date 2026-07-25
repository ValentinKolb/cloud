---
id: mail-compose
title: Write and send messages
icon: ti ti-pencil
description: Compose, recover drafts, use templates, attach files, and control delivery.
order: 30
---

## Start a message {icon="square-plus"}

Select **Compose** for a new message, or use **Reply**, **Reply all**, **Forward**, or **Quote selection** inside a conversation. Mail keeps the intent of the draft, so the final action button is labeled **Send**, **Reply**, **Reply all**, or **Forward**.

Choose a verified sender in **From**, add recipients, and enter a subject and body. **Cc/Bcc** reveals the additional recipient fields.

The composer can stay attached to the conversation, expand to a full-size composer, or open in a separate browser window. Moving between these surfaces transfers the editing session instead of creating another independent draft.

## Choose Markdown or Plain text {icon="route"}

The format selector applies to the current draft:

:::compare
- **Markdown** shows **Write** and **Preview** panes. Mail sends readable HTML with the mailbox email design and a text alternative. You can arrange the panes and Mail remembers your pane layout on this device.
- **Plain text** has no Preview pane and sends no HTML alternative.
:::

Your default format is stored under **Settings > Writing > Compose format**. Changing the default does not rewrite existing drafts.

## Resume an existing conversation draft {icon="pencil"}

Drafts belong to the mailbox, not only to the browser that created them. When a conversation already has drafts, **Reply**, **Reply all**, or **Forward** opens **Continue a draft?**. The dialog shows who created each draft, when it changed, and a content preview. Continue the relevant draft or create a separate message.

Mail saves the shared draft as you work and keeps a browser recovery journal for changes that have not reached the server. After a reload or interrupted connection, Mail can restore those browser changes.

Only one editing session holds the draft lease at a time. If another tab or person is editing it, the composer becomes read-only. Use **Take over** only when you intend to replace the other editing session. Concurrent or stale saves can create recovery copies; use the recovery action in the composer to inspect and restore them.

**Discard draft** removes the shared draft for everyone with mailbox access. Closing or minimizing the composer keeps the draft.

## Use signatures and snippets {icon="pencil"}

Type `/` in the body to search available signatures and snippets. The selected template is inserted into the draft, where you can edit or remove it.

- **Snippets** insert resolved reusable text.
- **Signatures** keep their safe variables until preview and send, so values such as the current sender or mailbox can be resolved at delivery time.
- **Private** templates are visible only to their owner.
- **Mailbox** templates are shared with collaborators.

When a verified sender has a default signature, new drafts insert it automatically. A personal default overrides the mailbox default for that sender. The inserted source remains editable; signatures are not mandatory or locked.

Administrators manage templates and defaults under **Settings > Writing**. Choose **Edit design** there to open the mailbox CSS editor. Its preview updates from the current unsaved CSS, while the composer Preview uses the same rendering path as delivery.

## Attach files {icon="paperclip"}

Select **Attach files** and choose one or more files. Upload progress and failures appear next to the draft attachments. You can retry or cancel an incomplete upload and remove an attached file before sending.

Each outgoing attachment is limited to 100 MiB. A message cannot be sent while an attachment upload is incomplete or failed.

Your mail provider can impose a smaller limit on the complete outgoing message.
Mail counts the final encoded email, including headers and attachment encoding,
before it queues delivery. Encoding makes an attached file larger in transit.
When the provider publishes a current limit, Mail rejects an oversized message
before SMTP starts and tells you both sizes. Remove attachments or share a large
file with a public download link instead. An unknown or outdated provider limit
does not prevent sending.

When forwarding a message with attachments, **Include original attachments** appears before the new draft is created. Turn it off when the forwarded body is enough.

## Send now, undo, or schedule delivery {icon="send"}

Select the main action button to queue delivery now. If **Undo send window** is greater than zero under **Settings > Writing**, Mail delays immediate delivery for that many seconds and offers an undo route through **Scheduled**. The setting can be between 0 and 60 seconds.

Select the clock side of the split action button to open **Schedule delivery**. Choose a time at least one minute in the future. The dialog shows the effective mailbox time zone and the exact delivery time.

Scheduled messages appear under **Scheduled** with recipients, content preview, creator, delivery time, and retry state. Until delivery begins, **Cancel** lets you:

- keep the item scheduled,
- return it to a shared draft, or
- discard it.

After successful delivery, the message becomes normal sent mail. Scheduled delivery and Undo Send require an active mailbox transport. Pausing the mailbox stops queued delivery until an administrator resumes it.

## Choose priority and receipt requests {icon="mail-cog"}

Open **Delivery options** in the composer to change the selected identity's defaults for this draft:

- **Priority** adds standard high- or low-importance headers. The recipient's mail client decides whether and how to show them.
- **Delivery receipt** asks the SMTP server for a delivery-status report. The option is available only when the selected sending server advertises support.
- **Read receipt** asks the recipient's mail client to report a disposition. Recipients and organizations can ignore or refuse the request.

Mail records received reports in conversation activity. A delivery report describes what a mail server reported; a read report describes what a mail client reported. Neither is proof that a person read, understood, or acted on the message.
