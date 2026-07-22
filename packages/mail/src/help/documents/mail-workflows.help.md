---
id: mail-workflows
title: Mail workflow YAML reference
icon: ti ti-code
description: Reference for Mail workflow inputs, triggers, actions, conditions, expressions, limits, and examples.
order: 70
---

Mail workflow YAML has three top-level keys: `inputs`, `triggers`, and `steps`. Only `steps` is required. The workflow name, description, priority, effect budget, saved versions, and activation state are edited outside YAML.

## Start with a received-message workflow {icon="route"}

This workflow adds a portable provider keyword when a received subject contains the text `invoice`:

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
      contains:
        - "${{ inputs.message.subject }}"
        - invoice
    then:
      - addKeyword:
          message: inputs.message
          keyword: Finance
      - setConversationStatus:
          conversation: inputs.conversation
          status: waiting
```

Select **Validate** before saving. Validation checks strict YAML, the Mail vocabulary, value paths, accessible catalog names, and incompatible action combinations.

## Declare inputs {icon="point"}

Mail supports two input types:

| Type | Value |
| --- | --- |
| `mailMessage` | One message in this mailbox |
| `mailConversation` | One conversation in this mailbox |

Each input name must start with a letter or underscore and contain only letters, numbers, and underscores. Set `required: true` when every caller or trigger must provide the input. A trigger must bind each required input in its `with` block.

A workflow without `triggers` is direct-only. It can be invoked through the Mail API or CLI with explicit inputs and a target query. The Mail settings UI currently edits, activates, and observes workflows; it does not provide a manual target-selection form.

## Use automatic triggers {icon="route"}

### `messageReceived`

`messageReceived` starts once for a stable newly imported message. It exposes:

- `trigger.message`
- `trigger.conversation`
- `trigger.occurredAt`

Bind these values to declared inputs:

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
  - succeed:
      message: "Received ${{ inputs.message.subject }}"
```

### `schedule`

`schedule` starts future slots from a five-field cron expression. `timezone` accepts an IANA time zone and defaults to UTC. The runtime supplies `trigger.occurredAt` and `trigger.slot`, but the current Mail vocabulary has no generic date-time input that can retain either value for later steps.

```yaml
triggers:
  schedule:
    cron: "0 8 * * 1-5"
    timezone: Europe/Berlin
    with: {}
steps:
  - succeed:
      message: The scheduled mailbox check ran.
```

Trigger values exist only while binding `with`. Scheduled Mail workflows are therefore currently limited to steps that do not require a received message or conversation. `automaticReply` cannot run from a schedule trigger.

Omit `triggers` for a direct-only workflow. An empty `triggers: {}` block is invalid.

## Read input and context values {icon="route"}

Message paths:

- `inputs.message.id`, `conversationId`, `subject`, `body`, `bodyText`, `bodyHtml`
- `inputs.message.sender.0.email` and `inputs.message.recipients.0.email`
- `inputs.message.attachments.0.filename`, `contentType`, or `sizeBytes`
- `inputs.message.hasAttachments`, `folderId`, `flags`, `keywords`, `direction`, `internalDate`, `receivedAt`

Conversation paths:

- `inputs.conversation.id`, `subject`, `assigneeUserId`
- `inputs.conversation.workStatus`, `latestMessageAt`

Execution context paths:

- `context.mailboxId`
- `context.actor.userId`, `context.actor.serviceAccountId`, `context.actor.groupIds`
- `context.occurredAt`

Array indices must be normal decimal indices such as `.0`, not `.00`. A missing or unsupported path is a validation error.

## Write literals, references, and expressions {icon="pencil"}

- A plain value such as `Finance` is literal text.
- A dynamic value uses the whole expression string: `"${{ inputs.message.subject }}"`.
- Text fields such as reply subjects, reply bodies, and `succeed.message` may embed expressions: `"Re: ${{ inputs.message.subject }}"`.
- Reference-only action fields use raw paths such as `message: inputs.message` and `conversation: inputs.conversation`.
- `${{ now() }}` produces the current workflow time.
- `setVariable` creates a value for later steps in the same scope.

```yaml
inputs:
  message:
    type: mailMessage
    required: true
steps:
  - setVariable:
      name: senderAddress
      value: "${{ inputs.message.sender.0.email }}"
  - succeed:
      message: "Message from ${{ senderAddress }} processed at ${{ now() }}"
```

Variables created inside a branch do not escape that branch. Defining the same variable name twice in one scope is invalid.

## Use Mail actions {icon="route"}

| Action | Required fields | Consequence |
| --- | --- | --- |
| `addKeyword` | `message`, `keyword` | Adds a portable provider keyword |
| `removeKeyword` | `message`, `keyword` | Removes a portable provider keyword |
| `moveMessage` | `message`, `folder` | Moves the message to an accessible provider folder |
| `copyMessage` | `message`, `folder` | Copies the message to an accessible provider folder |
| `archiveMessage` | `message` | Moves the message to the mailbox archive folder |
| `trashMessage` | `message` | Moves the message to the mailbox trash folder |
| `addFlag` / `removeFlag` | `message`, `flag` | Changes `seen`, `answered`, `flagged`, or `draft` through the provider command journal |
| `assignConversation` | `conversation`, `user` | Assigns by accessible user name or ID; `null` unassigns |
| `setConversationStatus` | `conversation`, `status` | Sets `needs_action`, `waiting`, or `done` |
| `ensureConversationReference` | `conversation`; optional `result` | Allocates or reuses the permanent mailbox reference and optionally stores its result |
| `addLocalTag` / `removeLocalTag` | `conversation`, `tag` | Changes a mailbox-local conversation tag |
| `addComment` | `conversation`, `body` | Adds an internal comment attributed to the workflow version |
| `createDraft` | `sender`, `to`, `subject`, `body`, `result` | Creates a normal-delivery workflow draft for a later step |
| `scheduleDraftSend` | `draft`, `scheduledAt` | Schedules a created normal-delivery draft through the durable outbox |
| `notifyUser` | `user`, `title`, `body` | Sends an internal notification to a current mailbox reader |
| `automaticReply` | `message`, `conversation`, `sender`, `subject`, `body` | Queues one guarded automatic response |
| `setVariable` | `name`, `value` | Stores a value for later steps |
| `succeed` | `message` | Stops the run successfully |
| `fail` | `message` | Stops the run with a non-retryable workflow error |

Folder, local-tag, user, and sender fields accept an unambiguous accessible name or ID. The saved version binds those catalog values before activation. Response timing is written inline and validated as part of the version.

One reachable path cannot apply several provider mutations to the same message. For example, adding a keyword and then moving that same message in one branch is rejected. Split those operations into separate workflows when both are required.

`createDraft` always produces `deliveryClass: normal`. Only `automaticReply` can create `deliveryClass: automatic_reply`; normal workflow sends therefore do not receive automatic-reply headers or a null envelope sender. `scheduleDraftSend` accepts only a `mail.draft` result created earlier in the same reachable scope.

`forEach` is part of the shared workflow grammar but is deliberately unsupported by the Mail vocabulary. Mail workflows operate on one materialized message target at a time.

## Allocate a conversation reference {icon="book-2"}

Configure and enable the mailbox sequence under **Automations > Reference numbers** first:

```yaml
inputs:
  conversation:
    type: mailConversation
    required: true
steps:
  - ensureConversationReference:
      conversation: inputs.conversation
      result: reference
  - setConversationStatus:
      conversation: inputs.conversation
      status: waiting
  - succeed:
      message: "Allocated ${{ reference.value }}"
```

The action is safe to repeat and does not allocate a second reference for the same conversation. When `result` is present, later steps in the same scope can use:

- `${{ reference.id }}` for the immutable reference record ID.
- `${{ reference.value }}` for the rendered value such as `SUP-2026-000042`.
- `${{ reference.created }}` to distinguish a new allocation from an existing value.
- `${{ reference.conversationId }}` and `${{ reference.conversationRevision }}` for subsequent workflow logic.

## Send a guarded automatic reply {icon="send"}

`automaticReply` is valid only when every trigger in the workflow is `messageReceived`.

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
  - automaticReply:
      message: inputs.message
      conversation: inputs.conversation
      sender: Support
      subject: "Re: ${{ inputs.message.subject }}"
      body: "Thank you for your message. We will respond during office hours."
      format: markdown
      schedule:
        timeZone: Europe/Berlin
        activeRanges: []
        weeklyWindows:
          - weekday: 1
            start: "09:00"
            end: "17:00"
          - weekday: 2
            start: "09:00"
            end: "17:00"
          - weekday: 3
            start: "09:00"
            end: "17:00"
          - weekday: 4
            start: "09:00"
            end: "17:00"
          - weekday: 5
            start: "09:00"
            end: "17:00"
        exceptions:
          - date: "2026-12-25"
            closed: true
            windows: []
      inactiveBehavior: defer
      minimumIntervalHours: 24
```

Optional fields and defaults:

- `format`: `plain` by default, or `markdown`
- `schedule`: optional inline object with `timeZone`, `activeRanges`, `weeklyWindows`, and `exceptions`
- `inactiveBehavior`: `defer` by default, or `skip`
- `minimumIntervalHours`: `24` by default, from `0` to `8760`

The sender must be verified and enabled for automatic replies. Mail suppresses loops, bulk/list mail, delivery-status messages, repeated responses to one message, and recipients still inside repeat protection.

`weekday` uses ISO numbers from `1` for Monday through `7` for Sunday. Times are local `HH:mm` values in the configured IANA timezone. Windows cannot overlap or cross midnight; `24:00` is allowed only as an end. An empty `activeRanges` list repeats weekly without a date limit. Each range uses an inclusive `from` date and an inclusive `to` date or `null`. A date exception overrides normal weekly windows: `closed: true` disables the whole date, while `closed: false` uses only the listed exception windows.

## Add conditions {icon="search"}

An `if` step takes one condition and a non-empty `then` list. `else` is optional.

Supported comparisons:

- `equals` and `notEquals`
- `contains`, `startsWith`, and `endsWith` for text
- `exists` for one raw reference
- recursive `all`, `any`, and `not`

`equals` and `notEquals` compare exact values. `contains`, `startsWith`, and `endsWith` normalize Unicode text and ignore letter case.

```yaml
inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
steps:
  - if:
      all:
        - exists: inputs.message.subject
        - any:
            - startsWith:
                - "${{ inputs.message.subject }}"
                - "[Urgent]"
            - contains:
                - "${{ inputs.message.bodyText }}"
                - service unavailable
        - not:
            equals:
              - "${{ inputs.conversation.workStatus }}"
              - done
    then:
      - assignConversation:
          conversation: inputs.conversation
          user: Alice Example
    else:
      - succeed:
          message: No urgent assignment required.
```

## Branch with `switch` {icon="point"}

`switch` compares one value against ordered `cases`. The optional `default` runs when no case matches.

```yaml
inputs:
  conversation:
    type: mailConversation
    required: true
steps:
  - switch: "${{ inputs.conversation.workStatus }}"
    cases:
      - when: needs_action
        do:
          - setVariable:
              name: result
              value: active
      - when: waiting
        do:
          - setVariable:
              name: result
              value: pending
    default:
      - succeed:
          message: Conversation is already done.
```

Values created in a `case` remain inside that case. Use terminal actions inside branches when a later step would need a branch-local value.

## Understand versions and activation {icon="layout-grid"}

- **Create workflow** stores version 1 but leaves it inactive.
- **Save version** creates another immutable version. It never edits an older version.
- **Activate** registers the selected current version's triggers.
- **Update available** means the current saved version differs from the active version.
- **Deactivate** stops future automatic trigger materialization. Existing run history remains.

Changing an accessible folder or sender does not rewrite a saved version. The mailbox reference pattern is evaluated when a number is allocated, while existing reference values remain unchanged. Changing response timing means saving and explicitly activating a new workflow version because the schedule is part of the YAML itself.

## Validate, preview effects, and inspect runs {icon="layout-list"}

**Validate** checks source and catalog bindings but does not execute steps. Direct CLI/API runs support:

- **dry run**, which records predicted effects without applying them,
- **preflight**, which freezes the version, query, target count, and effect budget before an effectful run,
- **execute**, which applies the exact preflighted request with an idempotency key.

A dry run is advisory. Permissions, provider state, and mailbox content are checked again during real execution.

Every action rechecks current mailbox authority. Removing the required access or deactivating the workflow prevents later effects.

- **Pause** fences new action commits. It is rejected while a provider command is queued, executing, or ambiguous.
- **Resume** requeues interrupted targets with a new execution generation and restores already completed step outcomes.
- **Retry failed** creates a lineage-linked child run for explicitly selected failed targets. A target is ineligible after any provider effect began or when its provider outcome is ambiguous.
- **Cancel** stops pending targets before their next effect; completed effects remain audited.

The child run retains the immutable workflow version, frozen target data, and execution clock. It captures current authorization separately and receives new target and command idempotency identities.

For setup tasks and operational consequences, see [Automate responses and mailbox work](/app/mail/help/mail-automation).
