# Mail automation

Read this reference when configuring managed automatic replies, conversation references, or Mail workflow YAML. Start with [Mail CLI](mail.md) for mailbox setup, permissions, search, and collaboration.

## Choose the right automation surface

| Need | Use |
| --- | --- |
| Out-of-office or receipt acknowledgement | `automatic-reply ...` |
| Permanent human-facing conversation ids | `reference ...` plus `ensureConversationReference` |
| Conditional routing, tagging, assignment, drafts, sends, notifications, or backfills | `workflow ...` |

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

Omit `triggers` for a direct-only workflow. An empty `triggers: {}` is invalid. Direct-only and automatically triggered workflows can both be run manually.

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

Activation reconciles schedules into the shared scheduler. Every delivered slot has a deterministic key and revalidates the active workflow version before materialization. Duplicate delivery reuses the same logical run. Slots missed while the scheduler process is offline are skipped rather than backfilled.

## Use inputs and conditions

Mail exposes two input types:

- `mailMessage`: `id`, `conversationId`, `subject`, `sender`, `recipients`, `body`, `bodyText`, `bodyHtml`, `attachments`, `hasAttachments`, `folderId`, `flags`, `keywords`, `direction`, `internalDate`, and `receivedAt`.
- `mailConversation`: `id`, `subject`, `assigneeUserId`, `workStatus`, and `latestMessageAt`.

Use `${{ inputs.<name> }}` for a whole input and `${{ inputs.<name>.<field> }}` for a field. `${{ now() }}` resolves from the run clock. `context.mailboxId` is also available.

Conditions are recursive and contain exactly one operator:

- `equals` and `notEquals` compare two values.
- `contains`, `startsWith`, and `endsWith` compare two text values.
- `exists` accepts one reference such as `inputs.conversation.assigneeUserId`.
- `all` and `any` contain one or more conditions; `not` contains one condition.

Steps may use `if`/`then`/`else` and `switch`/`cases`/`default`. The shared parser understands `forEach`, but the Mail binder rejects it; Mail target sets are processed by the durable batch runtime instead.

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
| `ensureConversationReference` | `conversation`; optional identifier in `result` | Allocate or return the immutable reference |
| `addLocalTag` | `conversation`, mailbox-local tag name or id in `tag` | Add a Cloud-local tag |
| `removeLocalTag` | `conversation`, mailbox-local tag name or id in `tag` | Remove a Cloud-local tag |
| `addComment` | `conversation`, `body` | Add an internal comment |
| `createDraft` | sender, recipients, subject, body, and identifier in `result`; optional cc, bcc, format | Create a normal-delivery draft |
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
      result: reference
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

A new version receives the effect budgets passed to that command; it does not inherit omitted values from the previous version. Activation and deactivation require the expected current or active version id, so a concurrent edit fails instead of activating the wrong source. Manual execution may target any saved immutable version; activation controls automatic triggers only.

## Preflight and run manually

Manual runs use a mailbox-scoped target query. Omit `--query-file` to select all current messages, or provide JSON or YAML:

```yaml
type: search
expression:
  type: and
  expressions:
    - type: text
      field: subject
      query: invoice
      match: contains
    - type: not
      expression:
        type: text
        field: from
        query: bot@example.com
        match: exact
```

Preflight is read-only. It traverses frozen message and conversation snapshots, counts planned effects, enforces the immutable version's effect budget, and returns a version-bound `preflightHash`:

```bash
cld --json mail workflow preflight \
  <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml
```

Effectful CLI run commands preflight again immediately before execution. Without `--yes`, they print the preflight and stop. With `--yes`, they submit the returned hash and queue the durable run:

```bash
cld --json mail workflow run invoke <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml \
  --idempotency-key invoice-run-2026-07-15 \
  --yes --wait

cld --json mail workflow run one-shot <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml \
  --yes

cld --json mail workflow run backfill <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml \
  --yes
```

`invoke`, `one-shot`, and `backfill` share the same version-pinned query, preflight, and execution path. Their stored run kind records caller intent. Use a stable `--idempotency-key` when a caller may retry; reusing it with different inputs, query, version, or run kind fails.

Current CLI workflow requests use the authenticated API transport and are recorded by the server with channel `api`. The shared CLI transport does not provide authenticated client provenance, so a client-controlled header must not claim channel `cli`.

Use a durable dry run for an auditable per-target plan without effects:

```bash
cld --json mail workflow run dry-run <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml \
  --idempotency-key invoice-review-2026-07-15 \
  --wait
```

Dry runs use the same frozen targets, leases, recovery, and result history as execution, but action planners receive no effect-capable ports.

## Observe and control runs

Inspect durable progress:

```bash
cld --json mail workflow run list --workflow <workflow-id>
cld --json mail workflow run get <run-id>
cld --json mail workflow run targets <run-id> --after -1 --limit 100
cld --json mail workflow run wait <run-id> --timeout-seconds 300
```

Pause at a fenced action boundary and resume later:

```bash
cld --json mail workflow run pause <run-id> --reason "Provider maintenance"
cld --json mail workflow run resume <run-id> --reason "Provider recovered"
```

Cancel unfinished targets or retry selected failed targets as a lineage-linked child run:

```bash
cld --json mail workflow run cancel <run-id> --reason "Superseded" --yes
cld --json mail workflow run retry \
  <run-id> \
  --target <failed-target-id> \
  --target <second-failed-target-id> \
  --idempotency-key retry-2026-07-15 \
  --reason "Provider recovered" \
  --yes
```

Cancellation does not undo effects that already completed. A retry targets only explicitly selected failed targets and preserves lineage to the source run.

With `--json` or `--jsonl`, a waited run that ends in `failed`, `canceled`, or `needs_attention` writes a structured `{ error, run }` result and exits with status 1.

## Understand budgets, permissions, and recovery

Every saved version carries limits for targets, moves, copies, sends, drafts, flag changes, notifications, keyword changes, and collaboration changes. Defaults are 1,000 for targets, moves, copies, sends, drafts, and notifications, and 2,000 for flag, keyword, and collaboration changes.

The accepted maximum is 50,000 for targets, moves, copies, sends, drafts, and notifications, and 100,000 for flag, keyword, and collaboration changes. Preflight also enforces hard planning ceilings.

Creating versions and activating or deactivating workflows requires mailbox `admin`; validation and inspection require `read`; preflight, manual execution, and run control require current mutation access. Manual runs snapshot the initiating user or service-account credential and recheck it during execution.

Automatic runs use the active version's mailbox-owned authority, so removing the activating administrator's later personal access does not silently disable approved automation. Deactivation or replacement prevents new automatic runs. Runs already accepted retain their pinned version and authority; cancel them explicitly to stop unfinished targets.

Provider actions create idempotent Mail commands. A step may wait for a command, hydration, or attachment dependency. Large backfills materialize frozen targets in bounded keyset batches. Durable outcomes survive retries; lease generations fence stale workers; PostgreSQL reconciliation recovers interrupted materialization, missed events, expired claims, and terminal dependencies. Ambiguous provider outcomes become `needs_attention` rather than being blindly repeated.

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

Execution is an explicit two-request commitment. First create a preflight:

```json
{
  "expectedVersionId": "<version-id>",
  "inputs": {},
  "query": {
    "type": "search",
    "expression": {
      "type": "text",
      "field": "subject",
      "query": "invoice",
      "match": "contains"
    }
  }
}
```

```bash
curl -fsS -X POST \
  "$CLOUD_URL/api/mail/mailboxes/$MAILBOX_ID/workflows/$WORKFLOW_ID/preflight" \
  -H "Authorization: Bearer $CLD_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @preflight-request.json
```

Then send the same version, occurrence time, inputs, and query to `/invoke`, `/one-shot`, or `/backfill`, together with the returned hash:

```json
{
  "expectedVersionId": "<version-id>",
  "inputs": {},
  "query": {
    "type": "search",
    "expression": {
      "type": "text",
      "field": "subject",
      "query": "invoice",
      "match": "contains"
    }
  },
  "occurredAt": "<preflight-occurred-at>",
  "preflightHash": "<preflight-hash>",
  "idempotencyKey": "invoice-run-2026-07-15"
}
```

The server recomputes the preflight in the execution transaction. A changed target snapshot, precondition, query, input, catalog binding, version, or budget makes the hash stale and prevents the run from being created.

## Command map

| Area | Commands |
| --- | --- |
| Automatic replies | `automatic-reply list|create|update` |
| References | `reference config show|set`, `reference list|ensure|find` |
| Workflow lifecycle | `workflow list|get|validate|preflight|create|activate|deactivate`, `workflow version list|get|create` |
| Run creation | `workflow run invoke|one-shot|backfill|dry-run` |
| Run operations | `workflow run list|get|targets|wait|pause|resume|cancel|retry` |
