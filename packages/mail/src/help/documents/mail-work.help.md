---
id: mail-work
title: Read, search, and organize
icon: ti ti-inbox
description: Find conversations, read complete threads, and change portable mail state safely.
order: 20
---

## Find the conversation you need {icon="search"}

Use **Search mailbox** for a broad search across the current mailbox. Select **Search filters** when you need field-specific conditions.

The filter dialog can search:

- From
- To or Cc
- Subject
- Message body
- Attachment name
- Internal comment
- Conversation reference
- Folder
- Local tag
- Provider keyword

Choose **Any condition** to match at least one filled field, or **All conditions** to require every filled field. Search filters stay in the page URL, so reloading or sharing the URL preserves the current result. Use **Clear search** to return to the unfiltered view.

Search results are permission-checked and use the synchronized Cloud copy. During an initial sync, older messages or bodies can become searchable later as synchronization and body hydration continue.

## Use Work views and folders for different purposes {icon="layout-list"}

The built-in **Work** views organize Cloud collaboration state:

| View | What it shows |
| --- | --- |
| Inbox | Active inbox conversations |
| Assigned to me | Conversations assigned to you |
| Unassigned | Conversations without an assignee |
| Waiting | Conversations with work status Waiting |
| Snoozed | Conversations hidden until their snooze time |
| Done | Conversations marked Done |
| Recent activity | Recently changed conversations |
| Scheduled | Messages waiting for future delivery |

Provider folders are a different layer. Moving a conversation to Archive, Trash, Junk, or another provider folder changes remote mail placement and can be visible in other clients. Marking a conversation **Done** changes only Cloud work status; it does not archive or move the email.

You can drag a conversation row onto a selectable folder in the left navigation. Mail queues the move and synchronization confirms the provider result. Do not repeat the move because the row has not refreshed immediately; check the destination folder or wait for the live update.

## Read a complete thread {icon="route"}

Select a conversation row to open its thread. Each message has its own sender, recipients, date, body, and attachments. Expand an older message when you need its full content.

Opening an unread conversation marks it as read. Use **More conversation actions** to mark it unread again, add or remove a flag, or print the conversation.

The top actions operate on the conversation's active provider placement:

- **Archive** moves it to the mapped archive folder.
- **Move to junk** moves it to the mapped junk folder.
- **Delete** moves it to the mapped trash folder.

These actions require write access and the corresponding folder mapping. If Mail reports that the conversation has no active provider placement, refresh the mailbox or ask an administrator to review folder discovery and mappings.

## Open attachments and reply to a message {icon="paperclip"}

Received attachments stay with the message that carried them. Select an attachment chip to open or download it in a new browser tab.

Under an expanded message, choose:

- **Reply** to answer the sender.
- **Reply all** to include the original recipients.
- **Forward** to start a forwarded message. You can decide whether to include the original attachments before the draft is created.
- **Quote selection** after selecting text in the message body. Mail inserts the selected lines as a quoted reply so you can answer directly below them.

For composing, drafts, attachments, signatures, and delivery options, see [Write and send messages](/app/mail?help=mail-compose).

## Create reusable views and local tags {icon="layout-list"}

Open **Settings > Views & tags** to create a saved view from folder and collaboration filters. A view can filter by folder, assignee, work status, reply-needed state, snooze state, and whether you follow the conversation.

- **Only me** creates a private view.
- **Everyone with mailbox access** creates a mailbox view and requires write access.
- Visibility is fixed after creation. Create a replacement view if you need a different visibility.

Local tags are mailbox labels used by people, search, and automations. They are not IMAP folders or provider keywords and do not appear in other clients. Deleting a local tag removes it from every conversation in that mailbox.
