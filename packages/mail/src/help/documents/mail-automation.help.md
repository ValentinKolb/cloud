---
id: mail-automation
title: Automate responses and mailbox work
icon: ti ti-automation
description: Configure automatic replies, conversation references, and safe workflow activation.
order: 60
---

Open **Automations** near the bottom of the mailbox navigation. The overview leads to guided automatic replies and sender rules. Mailbox admins also see focused pages for **Workflows** and **Reference numbers**. Cloud administrators inspect execution centrally under **Admin > Observability > Workflows**.

## Choose the right automation tool {icon="route"}

| Need | Use |
| --- | --- |
| Send an out-of-office or receipt acknowledgement | **Automatic replies** |
| Route, mark, or label mail from one sender or domain | **Sender rules** |
| Give conversations permanent human-facing IDs | **Reference numbers** plus a workflow |
| Tag, move, assign, change status, allocate references, or send guarded replies from conditions | **Workflows** |

The tools can work together, but creating one does not activate another. Reference-number settings define the format; a workflow still decides when to allocate a number. Saving a workflow does not activate it.

## Create a sender or domain rule {icon="filter-cog"}

Mailbox admins can create a guided rule under **Automations > Sender rules** or directly from a message's organization menu. Choose one exact sender address or one complete domain, then add up to eight ordered actions. A rule can perform one provider message action—move to junk, trash, or another folder; mark as read; or add a provider keyword—and combine it with Cloud-local tags, one assignee, and one conversation status.

Mail generates canonical workflow YAML from these fields and shows it in the editor. Actions run from top to bottom through the same workflow runtime used by advanced automations. Keep using the guided editor for managed rules. Changing the match or action plan creates a new immutable workflow version; changing only the name or active state updates the managed rule without duplicating identical workflow source. Destructive rules cannot target a mailbox identity, a configured internal domain, its subdomains, or an unsafe parent domain.

For automation through `cld`, run `mail sender-rule catalog` to discover valid folder, tag, and user IDs. Repeat `--action` to define the ordered plan, for example `--action move_to_folder:<folder-id> --action add_local_tag:<tag-id> --action set_status:needs_action`.

Enabled rules process future received messages. Turn on **Also apply to existing matching messages** to preview the affected count and start a resumable background backfill through the same workflow runtime. The backfill processes every matching message that existed when it started. Its durable cursor survives restarts, a failed message is retried without stopping unrelated workflow runs, and a repeated backfill skips messages already accepted for the same immutable workflow version. The sender-rule menu shows progress and lets you cancel or run it again. Disabling or deleting a rule stops future matches and never reverses already completed effects.

## Configure an automatic reply {icon="send"}

:::steps
1. Ask a mailbox admin to verify an identity and enable **Automatic replies** for it under **Settings > Delivery > Sending identities**.
2. Open **Automations > Automatic replies**.
3. Select **Add automatic reply**.
4. Choose **Out of office**, **Office-hours acknowledgement**, **Reference acknowledgement**, or **Custom automatic reply**.
5. Review the sender, subject, body, schedule, repeat protection, and behavior outside active times.
6. Use **Preview** for Markdown content.
7. Select **Save automatic reply**.
:::

Subjects and messages are Liquid templates. Use the copyable variables in the editor, for example `{{ inputs.message.subject }}` or, after assigning a reference, `{{ reference.value }}`. Invalid syntax and unavailable variables are rejected before the reply is saved.

Only one automatic reply can be enabled for a mailbox at a time. Disable the active configuration before enabling another one. By default only mailbox admins can change automatic replies. An admin can allow writers under **Settings > Access > Who can manage automatic replies?**

Mail does not reply to messages that are unsafe for automatic responses, including mailing-list mail, bulk mail, delivery-status notifications, messages from the mailbox itself, and messages that explicitly suppress automatic replies. A suppressed reply remains part of the activity and run history; it is not silently converted into a normal draft.

## Set dates and weekly hours {icon="point"}

Automatic replies and inline workflow response windows use the same time rules:

- **Time zone** controls how every date and time is evaluated.
- **Active date ranges** limit the schedule to an absence or campaign. With no range, weekly hours repeat indefinitely.
- **Weekly hours** list every weekday separately. A checked weekday card is enabled. Turn on **All day** for `00:00–24:00`, or add one or more non-overlapping windows for that day. A card marked **Disabled** never sends a response.
- **Date exceptions** close one date or replace that date's normal hours.
- **Do not reply** suppresses messages received outside an active window.
- **Reply at the next active time** retains the response until the next active window.

An exception wins over normal weekly hours. Times cannot cross midnight; create one window before midnight and another on the following day.

## Understand repeat protection {icon="shield-lock"}

**Repeat protection** is the minimum time before the same sender may receive another automatic reply from this mailbox.

- The **Out of office** preset uses 96 hours, or 4 days. This prevents a sender who writes several times during one absence from receiving the same notice every day.
- **Office-hours acknowledgement** and **Custom automatic reply** use 24 hours.
- `0` disables the sender interval, but Mail still prevents duplicate replies to the same incoming message and keeps its protocol-level loop guards.

Choose a shorter interval only when repeated acknowledgements are useful to the recipient. The value is mailbox-wide for that automatic reply, not a delay before the first response.

For a YAML workflow, define these rules directly under `automaticReply.schedule`. The schedule is part of the immutable workflow version, so reviewing and activating that version also reviews and activates its timing. See [Build Mail workflows](/app/mail/help/mail-workflows#send-a-guarded-automatic-reply) for the complete YAML shape.

## Create conversation references {icon="square-plus"}

A conversation reference is a permanent mailbox-scoped identifier such as `SUP-2026-000042`. It helps people quote, search, and audit one conversation even if subjects change.

:::steps
1. Open **Automations > Automatic replies** and choose **Reference acknowledgement**, or open **Workflows** for custom YAML.
2. If no mailbox sequence exists, configure it directly in the same reply editor or from the reference panel on the Workflows page.
3. Enter a Liquid pattern with exactly one sequence output, for example `SUP-{{ year }}-{{ sequence | pad_start: 6 }}`. The editor explains every placeholder and shows a preview.
4. Save the format without leaving or losing the reply you already entered.
5. Finish the automatic reply, or add `ensureConversationReference` to your custom workflow.
:::

Supported pattern parts:

- `{{ sequence }}` inserts the next mailbox-scoped number.
- `{{ sequence | pad_start: 6 }}` pads the number to six digits. Width can be from 1 to 120.
- `{{ year }}` inserts the year in which the reference is allocated.
- Letters, numbers, spaces, `.`, `_`, `-`, and `/` can be used as literal separators.

Allocation is idempotent: running the same action again returns the conversation's existing reference instead of consuming another number. References remain attached as aliases after conversation merges. Disabling allocation prevents new references but does not rewrite existing values.

The **Reference acknowledgement** preset assigns the number before sending and inserts `{{ reference.value }}` into the message. The same result binding is available in custom YAML. Once a conversation has a reference, new reply subjects use `Re: [SUP-2026-000042] Original subject` by default. Mail still threads replies through standard `Message-ID`, `In-Reply-To`, and `References` headers.

## Save and activate a workflow safely {icon="route"}

:::steps
1. Open **Automations > Workflows** and select **New workflow**.
2. Enter its name, description, priority, YAML, and effect budgets.
3. Select **Validate** and fix every line-specific diagnostic.
4. Select **Create workflow** or **Save version**.
5. Review the new version under **Versions**.
6. Select **Activate** or **Activate current version**.
7. Ask a Cloud administrator to verify the first matching execution under **Admin > Observability > Workflows**.
:::

Saving never activates a version. An already active version continues to run until an administrator explicitly activates the newer one. **Update available** means the saved current version and active version differ.

Effect budgets are hard upper bounds for moves, sends, keyword changes, and collaboration changes during one execution. An execution stops before applying an effect that would exceed its budget.

## Observe and stop workflow runs {icon="activity"}

Cloud administrators use **Admin > Observability > Workflows** for every app's durable run history. Filter the list by **Mail**, then open a run to inspect its cause, inputs, steps, effects, result, and errors. A run may be queued, running, waiting, succeeded, failed, canceled, or need attention.

Select **Cancel** when no further effects should start. Cancellation does not reverse mail moves, sends, or collaboration changes that already completed. A run that needs attention waits for an administrator to record whether an uncertain external effect completed. Disabling a Mail workflow prevents new trigger matches; it does not rewrite completed history.

For the complete YAML vocabulary and validated examples, see [Mail workflow YAML reference](/app/mail/help/mail-workflows).
