---
id: mail-troubleshooting
title: Troubleshoot Mail
icon: ti ti-lifebuoy
description: Diagnose missing mail, paused transport, sending failures, draft conflicts, and search gaps.
order: 80
---

Start with the visible symptom, then use the mailbox's **Settings > Status** page when transport, folders, or search may be involved.

## The mailbox is missing from the overview {icon="lifebuoy"}

:::steps
1. Clear **Search mailboxes**.
2. Confirm that a mailbox administrator has granted you access.
3. If the mailbox was deleted, an administrator can restore it under **Recently deleted**.
:::

Access is checked when the page loads and during live updates. If access was revoked, reloads and live views fail closed instead of keeping stale mailbox data available.

## New mail or older history is missing {icon="lifebuoy"}

:::steps
1. Check the health warning above the conversation list.
2. Open **Settings > Status**.
3. If the mailbox is paused, select **Resume mailbox**.
4. Select **Sync now**.
5. If folders are missing or changed, select **Rediscover** for the active binding.
:::

Initial synchronization loads history progressively. A message can appear before its complete body or attachment bytes finish synchronizing; the reader shows **Body is still synchronizing** until hydration completes.

For provider-shared folders, first confirm that the connected IMAP account still has the required subscription and rights. Mail can rediscover only folders the provider exposes to that account.

## Sending says "Mailbox transport is paused" {icon="send"}

An administrator paused the mailbox or restored it into its required paused state. Open **Settings > Status**, verify the provider connection and health, then select **Resume mailbox**.

While paused, incoming synchronization, queued provider changes, scheduled delivery, and automatic replies do not run.

## A message cannot be sent {icon="point"}

Check these conditions:

- You have Write or Admin permission.
- **From** uses a verified sender.
- **Settings > Status** shows usable transport and an active binding.
- The draft has recipients and either body content or an attachment.
- Every attachment upload completed successfully and no file exceeds 100 MiB.
- The provider credential has not expired or been revoked.

If the provider credential changed, use **Settings > Connections > Replace**. The existing secret cannot be displayed or partially edited.

## Automatic replies say that no sender is available {icon="send"}

Open **Settings > Senders** and check both conditions on one sender:

:::steps
1. The sender status is **verified**.
2. **Automatic replies** is enabled.
:::

Then return to **Automations > Automatic replies**. Existing automatic replies can remain visible while no eligible sender exists, but creating or re-enabling one requires an eligible sender.

## A scheduled message did not send {icon="send"}

Open **Scheduled** and inspect the item:

- A retry label means delivery failed and Mail has retained the item for another attempt.
- A paused mailbox prevents the attempt from running.
- **Cancel** can return the item to a shared draft or discard it before delivery begins.

The scheduled time must be at least one minute in the future. Times are displayed in the configured Cloud time zone shown by the scheduling dialog.

## A draft is read-only or changed elsewhere {icon="pencil"}

A shared draft allows one active editor. Another browser window or collaborator may hold the lease.

- Continue reading without taking over if the other editor is still working.
- Select **Take over** only when you intend to end the other editing session.
- If Mail reports recovery copies, inspect them before discarding or overwriting content.
- If the browser reloads after unsaved typing, accept the restored browser recovery when it matches your work.

Starting another reply does not hide existing work. The **Continue a draft?** dialog shows the author, update time, and content preview so you can resume the correct draft or deliberately create another.

## Search returns no expected result {icon="search"}

:::steps
1. Clear the current search and confirm the conversation appears in an unfiltered folder or work view.
2. Open **Search filters** and check whether **Any condition** or **All conditions** matches your intent.
3. Remove stale fields such as Folder, Local tag, or Provider keyword.
4. If the message body is still synchronizing, retry after hydration completes.
5. Ask an administrator to check **Status > Search index** if broad search fails across the mailbox.
:::

Local tags and internal comments exist only in Cloud. Provider folders and keywords depend on the synchronized remote state.

## A provider folder action fails {icon="lifebuoy"}

Archive, Trash, Junk, Sent, and Drafts depend on folder mappings under **Settings > Folders**. An administrator should:

:::steps
1. run **Rediscover** under **Status**,
2. confirm the provider folder is active and selectable,
3. update the corresponding mapping, and
4. retry the action once.
:::

Repeatedly clicking a queued action can make the result harder to interpret. Wait for the live update or check the destination folder before retrying.

## The mailbox was restored but still does not sync {icon="point"}

This is expected. Restore intentionally leaves the mailbox paused so an administrator can verify credentials, binding health, and folder discovery before background work resumes. Complete those checks under **Status**, then select **Resume mailbox**.
