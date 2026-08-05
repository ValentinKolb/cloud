---
id: mail-compose
title: Write and send messages
icon: ti ti-pencil
description: Compose, recover drafts, use templates, attach files, and control delivery.
order: 30
---

## Start a message {icon="square-plus"}

Select **Compose** for a new message, or use **Reply**, **Reply all**, **Forward**, or **Quote selection** inside a conversation. Mail first creates a shared draft and then opens its focused composer page. Mail keeps the intent of the draft, so the final action button is labeled **Send**, **Reply**, **Reply all**, or **Forward**.

Choose a verified sender in **From**, add recipients, and enter a subject and body. **Cc/Bcc** reveals the additional recipient fields.

The composer is separate from the mailbox workspace. Use **Back to mailbox** to save the latest changes, release the editing lease, and return. **Open in new window** moves the same draft to a dedicated browser window; it never creates a second draft.

## Open email links with Cloud Mail {icon="link"}

Open **Mailbox tools > Open email links with Cloud Mail** to ask the current browser to use Cloud Mail for standard `mailto:` links. Confirm the browser prompt when one appears. This association belongs to the browser or operating system, not to a mailbox or Cloud account, so Cloud does not display a permanent default-app switch.

An email link can supply To, Cc, Bcc, Subject, and plain-text Body. Cloud shows the writable mailbox and verified sender before creating the draft. Links cannot choose a hidden sender, attach local files, or send automatically. Browsers without protocol-handler support can still use **Compose** normally.

## Choose Markdown or Plain text {icon="route"}

Open **Message options** and choose the format for the current draft:

:::compare
- **Markdown** shows **Write** and **Preview** panes. Mail sends readable HTML with the mailbox email design and a text alternative. You can arrange the panes and Mail remembers your pane layout on this device.
- **Plain text** has no Preview pane and sends no HTML alternative.
:::

Your default format is stored under **Settings > Writing > Compose format**. Changing the default does not rewrite existing drafts.

## Resume an existing conversation draft {icon="pencil"}

Drafts belong to the mailbox, not only to the browser that created them. When a conversation already has drafts, **Reply**, **Reply all**, or **Forward** opens **Continue a draft?**. The dialog shows who created each draft, when it changed, and a content preview. Continue the relevant draft or create a separate message.

Mail saves the shared draft as you work and keeps a browser recovery journal for changes that have not reached the server. After a reload or interrupted connection, Mail can restore those browser changes.

Only one editing session holds the draft lease at a time. If another tab or person is editing it, the composer becomes read-only. Use **Take over** only when you intend to replace the other editing session. Concurrent or stale saves can create recovery copies; use the recovery action in the composer to inspect and restore them.

**Discard draft** removes the shared draft for everyone with mailbox access. Returning to the mailbox keeps the draft.

## Use signatures and snippets {icon="pencil"}

Type `/` in the body to search available signatures and snippets. The selected template is inserted into the draft, where you can edit or remove it.

- **Snippets** insert resolved reusable text.
- **Signatures** keep their safe Liquid variables until preview and send, so values such as `{{ sender.display_name }}` or `{{ mailbox.name }}` resolve at delivery time.
- **Private** templates are visible only to their owner.
- **Mailbox** templates are shared with collaborators.

When a verified sender has a default signature, new messages, replies, and forwards insert it automatically. In a reply or forward, Mail places the signature before quoted message history. A personal default overrides the mailbox default for that sender. The inserted source remains editable; signatures are not mandatory or locked.

Administrators manage templates and defaults under **Settings > Writing**. Choose **Edit design** there to open the mailbox CSS editor. Its preview updates from the current unsaved CSS, while the composer Preview uses the same rendering path as delivery.

## Attach files {icon="paperclip"}

Select **Attach files** and choose one or more files, or drag files onto the composer from your desktop. The composer highlights while it can accept the drop. Upload progress and failures appear next to the draft attachments. You can retry or cancel an incomplete upload and remove an attached file before sending.

Each outgoing attachment is limited to 100 MiB. A message cannot be sent while an attachment upload is incomplete or failed.

Your mail provider can impose a smaller limit on the complete outgoing message.
Mail counts the final encoded email, including headers and attachment encoding,
before it queues delivery. Encoding makes an attached file larger in transit.
When the provider publishes a current limit, Mail rejects an oversized message
before SMTP starts and tells you both sizes. Remove attachments or share a large
file with a public download link instead. An unknown or outdated provider limit
does not prevent sending.

When forwarding a message with attachments, Mail includes the original files in the new draft by default. Remove individual attachments in the composer when the forwarded body is enough.

## Add a calendar invitation {icon="calendar-plus"}

Open **Message options** and select **Add calendar invitation** to choose an existing event or create a small event directly in a writable Space. Spaces owns the event and its invitation sequence; Mail attaches the generated `.ics` file to the current draft. Nothing is sent until you use the normal send action.

Mail derives the organizer from the draft's verified sender identity. **To** and **Cc** recipients become invitation attendees, while **Bcc** recipients are deliberately excluded so hidden addresses are never disclosed through calendar data. If Spaces is unavailable or you cannot write to any Space, the calendar action stays hidden and the rest of the composer keeps working.

## Review sending warnings {icon="shield-check"}

Before an immediate, delayed, or scheduled send, Mail checks the exact saved draft for common mistakes. It may ask you to review a missing attachment, an unusually large recipient list, external recipients, Reply all, or a suspicious link. The dialog explains each warning and lets you return to the draft. Choose **Send anyway** only after reviewing the current recipients, links, and attachments.

An approval applies only to that saved draft revision. Editing the draft after approval runs the checks again. Mail records the approved warning types for delivery auditing, but not a second copy of the message content.

## Reuse a message safely {icon="copy"}

Open a message's actions menu and choose **Edit as new** to create an independent draft from its recipients, subject, and content. You can choose the sending identity and whether to copy attachments. The original message and conversation are never changed.

For a message previously sent by this mailbox, **Resend as a new draft** creates the same kind of independent, reviewable draft. Nothing is sent immediately: review the identity, recipients, content, and attachments, then send through the normal delivery flow. Retries of the same create request return the same draft instead of creating duplicates.

## Send now, undo, or schedule delivery {icon="send"}

Select the main action button to queue delivery now. If **Undo send window** is greater than zero under **Settings > Writing**, Mail delays immediate delivery for that many seconds and offers an undo route through **Scheduled**. The setting can be between 0 and 60 seconds.

Open the split action menu and select **Send later** to open **Schedule delivery**. Choose a time at least one minute in the future. The dialog shows the effective mailbox time zone and the exact delivery time.

Select **Save as draft** from the same menu to keep meaningful changes and return to the mailbox. Mail does not create an empty draft when the composer still contains only its untouched initial content.

Scheduled messages appear under **Scheduled** with recipients, content preview, creator, delivery time, and retry state. Until delivery begins, **Cancel** lets you:

- keep the item scheduled,
- return it to a shared draft, or
- discard it.

After successful delivery, the message becomes normal sent mail. Scheduled delivery and Undo Send require an active mailbox transport. Pausing the mailbox stops queued delivery until an administrator resumes it.

## Choose priority and receipt requests {icon="mail-cog"}

Open **Message options**, then **Delivery options**, to change the selected identity's defaults for this draft:

- **Priority** adds standard high- or low-importance headers. The recipient's mail client decides whether and how to show them.
- **Delivery receipt** asks the SMTP server for a delivery-status report. The option is available only when the selected sending server advertises support.
- **Read receipt** asks the recipient's mail client to report a disposition. Recipients and organizations can ignore or refuse the request.

Mail records received reports in conversation activity. A delivery report describes what a mail server reported; a read report describes what a mail client reported. Neither is proof that a person read, understood, or acted on the message.
