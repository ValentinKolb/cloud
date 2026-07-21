---
id: mail-admin
title: Set up and manage a mailbox
icon: ti ti-settings
description: Manage transport, senders, folders, access, automation, and mailbox lifecycle.
order: 50
---

Mailbox administrators manage the provider connection and the Cloud policies around it. Open **Settings** from the mailbox navigation.

## Know which settings are personal {icon="settings"}

All mailbox readers can access settings that apply to themselves:

- **Preferences** stores the default compose format and Undo Send window on the current device.
- **Views & tags** manages private saved views. Writers can also create shared views and mailbox-local tags.
- **Compose** is available to writers and administrators for private templates and personal signature defaults. Mailbox templates, mailbox defaults, and email design require Admin access.

The remaining tabs are visible only to mailbox administrators.

## Monitor and pause transport {icon="route"}

**Status** shows mailbox transport health, provider bindings, folder discovery, synchronization, and search-index state.

- **Sync now** starts a mailbox synchronization.
- **Rediscover** refreshes folders and remote namespace information.
- **Verify binding** completes a pending provider binding.
- **Pause mailbox** stops incoming synchronization, queued provider changes, scheduled delivery, and automatic replies.
- **Resume mailbox** allows those background operations to continue again.

Pausing is an operational stop, not a visibility control. Existing mirrored mail and collaboration data remain readable according to mailbox permissions.

### Repair projections and failed work

Mailbox administrators can use **Status > Repair and projection coverage** for asynchronous repairs. Hydration retry, search rebuild, thread-projection repair, folder rebuild, rediscovery, and synchronization are durable commands: leaving the page does not stop them, and Mail rechecks current Admin permission before execution.

The action buttons reflect current eligibility. A disabled action includes the reason, such as paused synchronization, an inactive folder, or equivalent work already pending. Search rebuild replaces only derived search chunks. Thread repair creates links for orphaned messages and refreshes summaries; it does not discard manual thread overrides, comments, references, assignments, or conversation state.

Commands with an ambiguous provider outcome offer **Reconcile effect** only. Reconciliation inspects provider state before deciding the result. Mail does not offer a blind retry after a provider effect may have started. **Retry work** and **Cancel work** are limited to provider-read maintenance commands whose provider effect did not start.

Cloud administrators can review the same redacted aggregate under **Administration > Mail**. It contains counts, states, timestamps, capability availability, IDs, and error codes, but no subjects, addresses, bodies, attachment names, provider endpoints, credentials, or raw provider errors.

## Manage the provider connection {icon="user-cog"}

**Connections** contains the current IMAP and SMTP credential. Mail verifies both protocols before storing a new or replacement credential.

Use **Find settings** as a starting point, then review the discovered hosts, ports, and TLS modes. When the deployment has a matching Google or Microsoft OAuth client, continue in the provider's browser authorization screen. Access and refresh tokens are encrypted and never displayed. Use **Reconnect** after consent is revoked; use **Replace** for manual passwords, app passwords, or tokens.

Mail reports IMAP and SMTP verification independently. An IMAP failure blocks synchronization and an SMTP failure blocks sending; correct the reported transport before retrying.

Removing the connection disconnects transport. It does not delete provider mail or the retained Cloud mailbox data.

## Manage sender identities {icon="send"}

**Senders** controls the From addresses available to collaborators.

A sender can define a display name, From address, Reply-to address, envelope sender, Sent folder, Drafts folder, and whether it is the default. Verify the sender by choosing a provider binding and a recipient for a real verification message.

The **Automatic replies** switch is separate from verification. Automatic replies can use only a verified sender with this switch enabled. Enabling the switch does not itself send anything; an enabled automatic reply or workflow is still required.

## Map provider folders {icon="user-cog"}

**Folders** maps provider folders to Sent, Drafts, Archive, Trash, and Junk operations. Inbox is discovered from the provider.

Only active, selectable provider folders can be mapped. An incorrect or missing mapping can prevent the corresponding conversation action or sent/draft projection from completing.

If the IMAP account exposes shared or other-user folders, **Rediscover** can make them appear as ordinary provider folders. Cloud does not provide separate permissions for one provider folder: **Access** shares the whole Cloud mailbox. Mail also does not combine the same remote shared folder from several users' separate provider accounts.

Provider-side namespace or subscription changes can make a folder missing or ambiguous. Review **Status > Folder discovery**, update the provider subscription or rights when necessary, then run **Rediscover**.

## Configure access {icon="shield-lock"}

**Access** uses the standard Cloud permission editor. Grant the narrowest permission that supports the person's job:

- Read for reading, search, comments, and personal reminders.
- Write for sending, provider mail operations, and collaboration changes.
- Admin for transport, sharing, policies, workflows, and mailbox lifecycle.

**Who can manage automatic replies?** is a mailbox policy above the permission list:

- **Mailbox writers and admins** lets writers create and change guided out-of-office replies and acknowledgements.
- **Mailbox admins only** is the secure default for new and existing mailboxes.

This policy does not let writers configure sender identities, reference-number settings, or YAML workflows. Those remain mailbox-admin operations.

Credentials remain hidden even from administrators. Sharing a mailbox grants Cloud access to the mailbox; it does not reveal the provider password or token.

## Share attachments with public links {icon="link"}

Mailbox **Admin** access is required to create, list, or revoke a public attachment link. Open a received message or draft and use the link action beside an attachment. Files larger than 100 MiB cannot be shared this way.

The public URL is disclosed only once, immediately after creation. Copy it before closing the result: Mail stores a hash of its secret token and cannot show the same URL again. **Settings > Shared attachments** lists every link in pages, including older active links, and lets an administrator revoke access without deleting the original message or draft attachment.

A link can have an optional password, expiry time, and maximum number of download sessions. Passwords are case-sensitive and can contain spaces. Range requests used to resume one granted download do not consume extra download counts. Revoked, expired, exhausted, invalid, and incorrectly passworded links fail without revealing attachment metadata.

The CLI provides the same mailbox-admin operations through `cld mail attachment link create`, `list`, and `revoke`. Supply a password through `--password-file` or `--password-stdin`; it is never accepted as a visible command-line value.

## Review Mail storage {icon="database"}

Cloud **Admin** access, which is separate from mailbox Admin access, is required for **Administration > Mail** and the `cld mail admin storage` commands. The page shows durable per-mailbox snapshots for provider-reported mail bytes, received-attachment breakdowns, finalized and active draft uploads, publicly shared references, and logical totals. It also shows physical Mail relation and blob-store bytes without exposing message or attachment content.

**Reconcile storage** queues a background reconciliation. The page and `cld mail admin storage show` continue to show the last completed snapshot until that job finishes; queuing the job does not synchronously update the numbers. These values are observability data, not storage quotas, and do not provide content drilldown.

## Configure signatures and email design {icon="pencil"}

Under **Compose**, create private or mailbox signatures and snippets. Administrators can set a mailbox default signature per verified sender. A collaborator's personal default takes precedence.

Markdown messages always receive the built-in readable email design. **Email design** adds validated mailbox CSS overrides for company branding; it does not replace the safe base design. Use the composer Preview to verify the rendered result before relying on a CSS change.

## Configure automatic responses and references {icon="settings"}

Open **Automations** near the bottom of the mailbox navigation:

:::steps
1. **Automatic replies** offers Out of office, Office-hours acknowledgement, and Custom presets. Writers can use this section when the Access policy permits it.
2. **Workflows** contains versioned YAML definitions and explicit activation controls.
3. **Runs** shows durable execution progress, failures, and cancellation.
4. **Reference numbers** defines the one human-facing mailbox sequence and its reply-subject behavior.
:::

The three advanced pages require mailbox-admin access. Automatic-reply timing is stored directly in the guided reply or in the immutable YAML workflow version; there is no separate schedule resource to keep in sync.

An automatic reply has an enabled state, verified automation sender, subject, body, Markdown or plain-text format, repeat interval per recipient, time zone, active dates, weekly windows, exceptions, and behavior outside the active window:

- **Do not reply** ignores messages outside the schedule.
- **Reply at the next active time** defers the response until the schedule becomes active.

Preview the exact response before enabling it. Pausing the mailbox stops automatic replies.

For setup steps, schedule consequences, reference patterns, and repeat protection, see [Automate responses and mailbox work](/app/mail?help=mail-automation).

## Manage workflows {icon="route"}

Open **Automations > Workflows** for the YAML editor. Saving creates a new immutable version; it does not activate that version automatically. Review the YAML, validation diagnostics, and effect budgets before explicitly activating a version. Inspect executions separately under **Automations > Runs**.

Use the dedicated automatic-reply UI for normal out-of-office or acknowledgement needs. Use workflows when the mailbox needs deterministic conditions and actions beyond that editor.

See [Mail workflow YAML reference](/app/mail?help=mail-workflows) for all supported inputs, triggers, actions, conditions, expressions, defaults, and validated examples.

## Delete and restore a mailbox {icon="point"}

**Danger zone > Delete mailbox** moves the mailbox into a recoverable deleted state. Provider mail and retained Cloud data are not purged.

Deleted mailboxes appear under **Recently deleted** on the Mail overview for administrators who can restore them. A restored mailbox starts paused. Verify the connection, folder discovery, and health under **Status** before selecting **Resume mailbox**.
