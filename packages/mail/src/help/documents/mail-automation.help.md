---
id: mail-automation
title: Automate responses and mailbox work
icon: ti ti-automation
description: Configure automatic replies, incoming-mail processing, and safe workflow activation.
order: 60
---

Open **Automations** from **Mailbox tools**. The full-width overview shows what is active and opens the exact setup you select. **Automatic replies** and **Incoming mail** cover common tasks. Mailbox admins also see **Activity** and **Workflows** under Advanced.

## Choose the right automation tool {icon="route"}

| Need | Use |
| --- | --- |
| Send an out-of-office or receipt acknowledgement | **Automatic replies** |
| Route, mark, or label matching mail with exact conditions | A standard rule under **Incoming mail** |
| Classify, apply several local tags, or prepare reply drafts with AI | A guided AI automation under **Incoming mail** |
| Give conversations permanent human-facing IDs | A reference acknowledgement or custom **Workflow** |
| Combine tasks beyond the guided editors or intentionally automate delivery | An advanced **Workflow** |

The tools can work together, but creating one does not activate another. Reference-number settings define the format; a workflow still decides when to allocate a number. Saving a workflow does not activate it.

## Create a mail rule {icon="filter-cog"}

Mailbox admins can create a guided rule under **Automations > Incoming mail** or directly from a message's organization menu. Combine up to eight sender, domain, subject, body-text, or attachment-presence conditions and choose whether all or any condition must match. Then add up to eight ordered actions. A rule can perform one provider message action—move to junk, trash, or another folder; mark as read; or add a provider keyword—and combine it with Cloud-local tags, one assignee, and one conversation status.

Mail generates canonical workflow YAML from these fields and shows it in the editor. Actions run from top to bottom through the same workflow runtime used by advanced automations. Keep using the guided editor for managed rules. Changing the match or action plan creates a new immutable workflow version; changing only the name or active state updates the managed rule without duplicating identical workflow source. Destructive rules cannot target a mailbox identity, a configured internal domain, its subdomains, or an unsafe parent domain.

For automation through `cld`, run `mail rule catalog` to discover valid folder, tag, and user IDs. Repeat `--condition` and `--action` to define the rule, for example `--condition sender:is:person@example.com --condition subject:contains:invoice --action move_to_folder:<folder-id> --action add_local_tag:<tag-id>`.

Text conditions support exact, contains, starts-with, and ends-with matching. Regular expressions are intentionally unavailable until Mail can enforce a bounded RE2-compatible matcher.

Enabled rules process future received messages. Turn on **Also apply to existing matching messages** to preview the work and start a resumable background backfill through the same workflow runtime. Sender-only conditions have an exact preview; content and attachment conditions show the number of candidate messages that will be scanned by the workflow. The durable cursor survives restarts, a failed message is retried without stopping unrelated workflow runs, and a repeated backfill skips messages already accepted for the same immutable workflow version. The rule menu shows progress and lets you cancel or run it again. Disabling or deleting a rule stops future matches and never reverses already completed effects.

## Add a guided AI automation {icon="sparkles"}

Open **Automations > Incoming mail** and select one task:

- **Route with AI** chooses exactly one named category. Each category may move the message, add local tags, assign the conversation, or set its work status.
- **Add tags with AI** chooses zero or more existing local tags. Describe what each tag means and set the maximum number that may be applied to one message.
- **Draft replies with AI** writes through one verified automation-enabled sender identity and creates a normal draft for review. It cannot send the draft.

Each editor can run for every future incoming message or behind the same deterministic conditions used by standard rules. Conditions are checked before AI runs. Every matching message consumes at most one AI call, and the generated workflow has tight budgets for only the effects shown in the editor. The platform workflow model is used automatically; Mail does not expose a separate model choice.

New AI automations start inactive unless you explicitly enable them. AI can classify or write incorrectly, so review category descriptions, actions, and the first runs under **Activity**. Guided AI automations never backfill existing mail and never schedule or send a message. Open the generated workflow section when you need to review the canonical YAML; continue editing through the guided fields rather than changing that source directly.

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

A conversation reference is a permanent mailbox-scoped identifier such as `REF-K7M3-P9QX-2F4N`. It helps people quote, search, and audit one conversation even if subjects change.

:::steps
1. Open **Automations > Automatic replies** and choose **Reference acknowledgement**, or open **Workflows** for custom YAML.
2. If no reference format exists, configure it directly in the same reply editor or from the reference panel on the Workflows page.
3. Enter a Liquid pattern with exactly one identifier output. The privacy-safe default is `REF-{{ short_id }}`. The editor explains every placeholder and shows a preview.
4. Save the format without leaving or losing the reply you already entered.
5. Finish the automatic reply, or add `ensureConversationReference` to your custom workflow.
:::

Supported pattern parts:

- `{{ short_id }}` inserts a short, readable random ID without exposing volume or allocation time.
- `{{ uuid }}` inserts an opaque random UUID.
- `{{ uuid_v7 }}` inserts a sortable UUID that exposes its allocation time.
- `{{ ulid }}` inserts a compact sortable ID that exposes its allocation time.
- `{{ sequence }}` inserts the next mailbox-scoped number and therefore exposes order and approximate volume.
- `{{ sequence | pad_start: 6 }}` pads the counter to six digits. Width can be from 1 to 120.
- `{{ year }}`, `{{ month }}`, `{{ month_name }}`, and `{{ day }}` insert UTC allocation-date parts.
- Letters, numbers, spaces, `.`, `_`, `-`, and `/` can be used as literal separators.

Use exactly one of the five identifier outputs. Date parts are optional and do not make a reference unique. Allocation is idempotent: running the same action again returns the conversation's existing reference instead of allocating another one. References remain attached as aliases after conversation merges. Disabling allocation prevents new references but does not rewrite existing values.

The **Reference acknowledgement** preset assigns the reference before sending and inserts `{{ reference.value }}` into the message. The same result binding is available in custom YAML. Once a conversation has a reference, new reply subjects use `Re: [REF-K7M3-P9QX-2F4N] Original subject` by default. Mail still threads replies through standard `Message-ID`, `In-Reply-To`, and `References` headers.

## Save and activate a workflow safely {icon="route"}

:::steps
1. Open **Automations > Workflows** and select **New workflow**.
2. Enter its name, description, priority, YAML, and effect budgets.
3. Select **Validate** and fix every line-specific diagnostic.
4. Select **Create workflow** or **Save version**.
5. Review the new version under **Versions**.
6. Select **Activate** or **Activate current version**.
7. Verify the first matching execution under **Automations > Activity**. Platform operators can also use **Admin > Observability > Workflows**.
:::

Saving never activates a version. An already active version continues to run until an administrator explicitly activates the newer one. **Update available** means the saved current version and active version differ.

Effect budgets are hard upper bounds for moves, sends, keyword changes, collaboration changes, and AI calls during one execution. An execution stops before applying an effect that would exceed its budget. AI output remains data until a later Mail action uses it, so classification, tagging, assignment, drafting, and sending remain independently reviewable steps.

## Observe and stop workflow runs {icon="activity"}

Mailbox administrators use **Automations > Activity** for mailbox-scoped automatic replies, mail-rule matches, guided AI automations, custom workflows, and resumable backfills. The table shows the automation type, state, duration, time, and a bounded failure or result message. Platform administrators retain the cross-application detail view under **Admin > Observability > Workflows**.

Select **Cancel** when no further effects should start. Cancellation does not reverse mail moves, sends, or collaboration changes that already completed. A run that needs attention waits for an administrator to record whether an uncertain external effect completed. Disabling a Mail workflow prevents new trigger matches; it does not rewrite completed history.

For the complete YAML vocabulary and validated examples, see [Mail workflow YAML reference](/app/mail/help/mail-workflows).
