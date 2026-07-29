# Mail automation

Read this reference when configuring managed automatic replies, conversation references, or Mail workflow YAML. Start with [Mail CLI](mail.md) for mailbox setup, permissions, search, and collaboration.

## Choose the right automation surface

| Need | Use |
| --- | --- |
| Out-of-office or receipt acknowledgement | `automatic-reply ...` |
| Guided sender, content, or attachment routing plus Cloud actions | `rule ...` |
| Permanent human-facing conversation ids | `reference ...` plus `ensureConversationReference` |
| Conditional routing, tagging, assignment, drafts, sends, or notifications | `workflow ...` |

Managed automatic replies are convenience configurations backed by the same guarded response behavior as workflows. Presets exist only in the Mail application; the persisted configuration and CLI input use one stable schema.

Mailbox admins control whether writers may manage automatic replies:

```bash
cld mail configure --automatic-replies writers
cld mail configure --automatic-replies admins
```

This delegation does not grant access to identity configuration, references, or arbitrary YAML workflows.

## Manage automatic replies

List current configurations:

```bash
cld --json mail automatic-reply list
```

Create a configuration from JSON or YAML:

```yaml
name: Out of office
enabled: true
senderIdentityId: 00000000-0000-4000-8000-000000000001
subject: "Re: Your message"
body: |
  Thank you for your message. I am away until 2026-08-03.
format: markdown
ensureReference: false
minimumIntervalHours: 96
inactiveBehavior: skip
schedule:
  timeZone: Europe/Berlin
  activeRanges:
    - from: 2026-07-20
      to: 2026-08-03
  weeklyWindows:
    - weekday: 1
      start: "00:00"
      end: "24:00"
    - weekday: 2
      start: "00:00"
      end: "24:00"
    - weekday: 3
      start: "00:00"
      end: "24:00"
    - weekday: 4
      start: "00:00"
      end: "24:00"
    - weekday: 5
      start: "00:00"
      end: "24:00"
    - weekday: 6
      start: "00:00"
      end: "24:00"
    - weekday: 7
      start: "00:00"
      end: "24:00"
  exceptions: []
```

```bash
cld --json mail automatic-reply create --configuration-file out-of-office.yml
```

Replace a configuration at its expected revision:

```bash
cld --json mail automatic-reply update \
  <configuration-id> \
  --revision <current-revision> \
  --configuration-file out-of-office.yml
```

The complete configuration is replaced; omitted optional fields receive their create defaults. The defaults are enabled, Markdown, no reference allocation, a 24-hour sender interval, and `skip` outside active times.

Only one managed automatic reply may be enabled for a mailbox at a time. Set `enabled: false` on the current configuration before enabling another one. The selected identity must be verified and automation-enabled.

Schedule rules are evaluated in `timeZone`:

- `activeRanges` contains at most 32 inclusive date ranges. `to: null` has no end.
- `weeklyWindows` contains ISO weekdays from 1 for Monday to 7 for Sunday.
- `24:00` is allowed only as an end. Windows cannot cross midnight.
- `exceptions` either close a date or replace that date's normal windows.
- `inactiveBehavior: skip` suppresses a response outside active time.
- `inactiveBehavior: defer` retains it until the next active window.
- `minimumIntervalHours` limits repeated replies to the same sender. `0` disables this interval, but protocol loop and same-message duplicate guards remain active.

Mail also suppresses unsafe automatic responses such as bulk mail, mailing-list mail, delivery-status notifications, self-mail, and messages that request no automatic reply.

## Manage guided mail rules

Mail rules are managed workflows with a narrow, reviewable contract:

```bash
cld --json mail rule catalog
cld --json mail rule list
cld --json mail rule create \
  --name "Route customer mail" \
  --condition sender:is:customer@example.com \
  --condition subject:contains:invoice \
  --action move_to_folder:<folder-id> \
  --action add_local_tag:<tag-id> \
  --action assign_user:<user-id> \
  --action set_status:needs_action
cld --json mail rule get <rule-id>
cld --json mail rule update <rule-id> --revision <revision> --action junk
cld mail rule delete <rule-id> --revision <revision> --yes
```

Repeat `--condition` and choose `--match-mode all|any`. Supported conditions are exact sender/domain, subject or body text with `is`, `contains`, `starts_with`, or `ends_with`, and attachment presence. Repeat `--action` in execution order. A guided rule accepts at most one provider message action: `junk`, `trash`, `mark_read`, `add_keyword:<keyword>`, or `move_to_folder:<folder-id>`. It can additionally add distinct Cloud tags with `add_local_tag:<tag-id>`, assign one user with `assign_user:<user-id>`, and set one status with `set_status:<needs_action|waiting|done>`. `rule catalog` returns the mailbox-scoped folder, tag, and user ids accepted by these actions. Passing any `--condition` or `--action` during update replaces that complete set; omit it to retain the current set.

Rules and sender-wide actions apply to incoming mail only; Cloud rejects a mailbox's own active identities. Destructive rules must restrict every possible match to an external sender or domain and reject configured internal domains, subdomains, and unsafe parent domains. `rule get` exposes the exact generated workflow YAML.

Preview sender-scoped work before changing existing messages:

```bash
cld --json mail sender preview --match sender --value news@example.com
cld --json mail sender mark-read --match domain --value example.com --idempotency-key <stable-key> --yes
cld --json mail rule backfill start <rule-id> --revision <revision> --yes
cld --json mail rule backfill status <rule-id> <operation-id>
cld --json mail rule backfill cancel <rule-id> <operation-id> --yes
```

`sender mark-read` is a bounded interactive action for at most 100 matches. It uses the durable command outbox and accepts `--idempotency-key`, so an agent retry returns the original batch. A rule backfill instead walks every candidate message with a durable cursor and emits targeted events into the same workflow runtime used for new mail. `start` returns an `operationId`; use it with `status` or `cancel`. Starting another backfill is safe: messages already accepted for the rule's current immutable workflow version are skipped. Update, delete, and backfill start require the revision shown by `rule get`; they refuse stale state instead of silently adopting the latest revision.

## Configure conversation references

A mailbox has one optional reference-number configuration. Set its permanent format before a workflow allocates references:

```bash
cld --json mail reference config set \
  --pattern 'SUP-{year}-{sequence:6}' \
  --enable \
  --include-in-reply-subjects

cld --json mail reference config show
```

`{sequence}` is required. An optional width such as `{sequence:6}` pads the number, and `{year}` uses the allocation year. Changing the pattern affects only future allocations. Existing references remain immutable and searchable.

Allocation is idempotent for each conversation:

```bash
cld --json mail reference ensure <conversation-id> --idempotency-key support-import-42
cld --json mail reference list <conversation-id>
cld --json mail reference find SUP-2026-000042
```

Use `--disable` to stop new allocations without removing existing values. Use `--exclude-from-reply-subjects` when new human and automatic replies should keep their original subject. A workflow controls when allocation happens; the mailbox configuration controls only the sequence and reply-subject behavior.

## Write canonical workflow YAML

Mail workflows use the shared Cloud workflow language: strict YAML with top-level `inputs`, optional automatic `triggers`, and `steps`. Workflow metadata is not part of the YAML. Mail lifecycle records store name, description, priority, activation state, immutable version ids, and effect budgets.

This workflow runs for each newly imported inbound message, adds a provider keyword, moves the message, and updates its conversation:

```yaml
inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true

triggers:
  messageReceived:
    with:
      message: "${{ trigger.message }}"
      conversation: "${{ trigger.conversation }}"

steps:
  - if:
      all:
        - contains:
            - "${{ inputs.message.subject }}"
            - invoice
        - not:
            equals:
              - "${{ inputs.conversation.workStatus }}"
              - done
    then:
      - addKeyword:
          message: "${{ inputs.message }}"
          keyword: Finance
      - moveMessage:
          message: "${{ inputs.message }}"
          folder: Invoices
      - setConversationStatus:
          conversation: "${{ inputs.conversation }}"
          status: waiting
```

`messageReceived` is emitted once for a stable inbound message imported by live incremental sync. Historical backfill does not emit it. Activation grants the active version mailbox-owned automation authority. Deactivation stops new automatic runs without changing existing versions or runs.

Every active Mail workflow needs a `messageReceived` or `schedule` trigger. An empty `triggers: {}` is invalid.

The language also accepts a five-field cron schedule and an optional IANA timezone:

```yaml
triggers:
  schedule:
    cron: "0 8 * * *"
    timezone: Europe/Berlin
    with: {}

steps:
  - succeed:
      message: Scheduled check completed
```

Activation reconciles schedules into the shared scheduler. Every delivered slot has a deterministic key and revalidates the active workflow version before creating a run. Duplicate delivery reuses the same logical run. Slots missed while the scheduler process is offline are skipped rather than backfilled.

## Use inputs and conditions

Mail exposes two input types:

- `mailMessage`: `id`, `conversationId`, `subject`, `sender`, `recipients`, `body`, `bodyText`, `bodyHtml`, `attachments`, `hasAttachments`, `folderId`, `flags`, `keywords`, `direction`, `internalDate`, and `receivedAt`.
- `mailConversation`: `id`, `subject`, `assigneeUserId`, `workStatus`, and `latestMessageAt`.

Use `${{ inputs.<name> }}` for a whole input and `${{ inputs.<name>.<field> }}` for a field. `${{ now() }}` resolves from the run clock. `context.mailboxId` is also available.

Conditions are recursive and contain exactly one operator:

- `equals` and `notEquals` compare two values.
- `textEquals`, `contains`, `startsWith`, and `endsWith` compare two normalized, case-insensitive text values.
- `exists` accepts one reference such as `inputs.conversation.assigneeUserId`.
- `all` and `any` contain one or more conditions; `not` contains one condition.

Steps may use `if`/`then`/`else` and `switch`/`cases`/`default`. The shared parser understands `forEach`, but the Mail binder rejects it because each Mail event starts one durable workflow run.

## Use the complete action vocabulary

| Action | Required configuration | Effect |
| --- | --- | --- |
| `addKeyword` | `message`, `keyword` | Add a portable provider keyword |
| `removeKeyword` | `message`, `keyword` | Remove a portable provider keyword |
| `moveMessage` | `message`, accessible folder name or id in `folder` | Move through the durable provider journal |
| `copyMessage` | `message`, accessible folder name or id in `folder` | Copy through the durable provider journal |
| `archiveMessage` | `message` | Move to the configured Archive role |
| `trashMessage` | `message` | Move to the configured Trash role |
| `addFlag` | `message`, `seen`, `answered`, `flagged`, or `draft` in `flag` | Add one standard provider flag |
| `removeFlag` | `message`, `seen`, `answered`, `flagged`, or `draft` in `flag` | Remove one standard provider flag |
| `assignConversation` | `conversation`, assignable user name, id, expression, or `null` in `user` | Change assignment transactionally |
| `setConversationStatus` | `conversation`, `needs_action`, `waiting`, or `done` in `status` | Change work state transactionally |
| `ensureConversationReference` | `conversation`; optional identifier in `saveAs` | Allocate or return the immutable reference |
| `addLocalTag` | `conversation`, mailbox-local tag name or id in `tag` | Add a Cloud-local tag |
| `removeLocalTag` | `conversation`, mailbox-local tag name or id in `tag` | Remove a Cloud-local tag |
| `addComment` | `conversation`, `body` | Add an internal comment |
| `createDraft` | sender, recipients, subject, body, and identifier in `saveAs`; optional cc, bcc, format | Create a normal-delivery draft |
| `scheduleDraftSend` | draft value reference in `draft`, ISO timestamp in `scheduledAt` | Schedule a created draft |
| `notifyUser` | mailbox reader in `user`, `title`, `body` | Send an internal notification |
| `automaticReply` | `message`, `conversation`, sender, subject, body; optional format and response schedule | Queue a guarded automatic response |
| `setVariable` | identifier in `name`, expression or literal in `value` | Store a pure scoped value |
| `succeed` | operator-facing `message` | Stop successfully |
| `fail` | operator-facing `message` | Stop with failure |

Literal folder, tag, sender, and user names are bound to accessible stable ids when a version is created. Unknown, inaccessible, or ambiguous names fail validation.

Reference a value stored by `setVariable` or an action result as `${{ <name> }}` in later steps in the same scope. Mail validation reserves `inputs` and `trigger`.

Reference allocation can expose its result:

```yaml
steps:
  - ensureConversationReference:
      conversation: inputs.conversation
      saveAs: reference
  - automaticReply:
      message: inputs.message
      conversation: inputs.conversation
      sender: Support
      subject: "Re: ${{ inputs.message.subject }}"
      body: "Thank you. Your reference is ${{ reference.value }}."
      format: markdown
```

The reference result contains `id`, `value`, `created`, `conversationId`, and `conversationRevision`.

An automatic reply may carry its response window inline:

```yaml
steps:
  - automaticReply:
      message: inputs.message
      conversation: inputs.conversation
      sender: Support
      subject: "Re: ${{ inputs.message.subject }}"
      body: "We received your message."
      format: markdown
      minimumIntervalHours: 24
      inactiveBehavior: defer
      schedule:
        timeZone: Europe/Berlin
        activeRanges: []
        weeklyWindows:
          - weekday: 1
            start: "09:00"
            end: "17:00"
        exceptions: []
```

`automaticReply` requires every workflow trigger to be `messageReceived`. Reusable response-schedule records are not part of the current model; schedule configuration lives in the immutable YAML version.

## Validate, save, and activate

Keep YAML in a file so the exact source can be reviewed and versioned:

```bash
cld mail workflow validate --source-file route-mail.yml

cld --json mail workflow create \
  --name "Route invoices" \
  --description "Move new invoices into the team folder" \
  --priority 100 \
  --max-targets 500 \
  --max-moves 500 \
  --max-copies 0 \
  --max-sends 0 \
  --max-drafts 0 \
  --max-flag-changes 500 \
  --max-notifications 0 \
  --max-keyword-changes 500 \
  --max-collaboration-changes 500 \
  --source-file route-mail.yml
```

Creation stores one immutable version but does not activate it:

```bash
cld --json mail workflow list
cld --json mail workflow get <workflow-id>
cld mail workflow export <workflow-id> > route-mail.yml
cld --json mail workflow version list <workflow-id>
cld --json mail workflow version get <workflow-id> <version-id>
cld --json mail workflow activate <workflow-id> --version-id <version-id>
```

Changing YAML creates another immutable version. It does not mutate the active version or historical runs:

```bash
cld --json mail workflow version create \
  <workflow-id> \
  --source-file route-mail.yml \
  --max-targets 500 \
  --max-moves 500
cld --json mail workflow activate <workflow-id> --version-id <new-version-id>
cld --json mail workflow deactivate <workflow-id> --version-id <active-version-id>
```

A new version receives the effect budgets passed to that command; it does not inherit omitted values from the previous version. Activation and deactivation require the expected current or active version id, so a concurrent edit fails instead of activating the wrong source.

Update metadata without creating a source version:

```bash
cld --json mail workflow update <workflow-id> --name "Route urgent invoices" --priority 50
```

Export writes only exact YAML bytes in text mode, making shell redirection safe. Pass `--version-id` to export historical source. Restore history by creating a new inactive immutable version; the historical row is never changed:

```bash
cld mail workflow export <workflow-id> --version-id <historical-version-id> > historical.yml
cld --json mail workflow version restore \
  <workflow-id> \
  <historical-version-id> \
  --current-version-id <current-version-id>
```

## Observe and control runs

Mail uses the shared Cloud workflow kernel. Cloud administrators inspect every app's runs through the central operations commands:

```bash
cld admin workflows health --json
cld admin workflows runs --app mail --json
cld admin workflows show <run-id> --json
cld admin workflows effects --app mail --json
cld admin workflows events --app mail --json
```

Request cooperative cancellation when no further effects should start:

```bash
cld admin workflows cancel <run-id> --yes
```

Cancellation does not undo completed effects. If an external effect has an uncertain outcome, inspect it with `workflows effects` and record the verified outcome with `cld admin workflows resolve`. Read [Administration](admin.md) for the exact filters, states, and resolution command.

## Understand budgets, permissions, and recovery

Every saved version carries limits for moves, copies, sends, drafts, flag changes, notifications, keyword changes, and collaboration changes. Defaults are 1,000 for moves, copies, sends, drafts, and notifications, and 2,000 for flag, keyword, and collaboration changes.

The accepted maximum is 50,000 for moves, copies, sends, drafts, and notifications, and 100,000 for flag, keyword, and collaboration changes.

Creating versions and activating or deactivating workflows requires mailbox `admin`; validation and inspection require `read`. Central run inspection and control requires Cloud administrator access.

Runs use the active version's mailbox-owned authority, so removing the activating administrator's later personal access does not silently disable approved automation. Deactivation or replacement prevents new runs. Runs already accepted retain their pinned version and authority; cancel them centrally to stop unfinished work.

Provider actions create idempotent Mail commands. A step may wait for a command or message hydration. Durable outcomes survive retries; lease generations fence stale workers; dependency completion wakes waiting runs. Ambiguous provider outcomes become `needs_attention` rather than being blindly repeated.

## Call the workflow API directly

Prefer the CLI unless another HTTP client must integrate directly. Mail workflow routes are under `/api/mail/mailboxes/{mailboxId}`. Use `cld api-docs operations mail` for the live OpenAPI contract.

Create a workflow with an explicit effect budget:

```bash
jq -n --rawfile source route-mail.yml '{
  name: "Route invoices",
  description: "Move new invoices into the team folder",
  priority: 100,
  source: $source,
  effectBudget: {
    maxTargets: 500,
    maxMoves: 500,
    maxCopies: 0,
    maxSends: 0,
    maxDrafts: 0,
    maxFlagChanges: 500,
    maxNotifications: 0,
    maxKeywordChanges: 500,
    maxCollaborationChanges: 500
  }
}' > create-workflow.json

curl -fsS -X POST \
  "$CLOUD_URL/api/mail/mailboxes/$MAILBOX_ID/workflows" \
  -H "Authorization: Bearer $CLD_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @create-workflow.json
```

The Mail API manages definitions and activations only. Runtime observability and control use the shared Admin workflow API published by the Cloud core application; discover it with `cld api-docs operations cloud` or use `cld admin workflows`.

## Command map

| Area | Commands |
| --- | --- |
| Automatic replies | `automatic-reply list|create|update` |
| References | `reference config show|set`, `reference list|ensure|find` |
| Workflow lifecycle | `workflow list|get|validate|create|update|export|activate|deactivate`, `workflow version list|get|create|restore` |
| Runtime operations | `cld admin workflows health|runs|show|cancel|effects|resolve|events` |
