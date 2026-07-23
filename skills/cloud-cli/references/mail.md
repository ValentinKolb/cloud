# Mail

Use `cld mail` to configure Cloud mailboxes and operate mirrored IMAP mail through the same permission-checked HTTP APIs as the Mail app.

## Safety

- Run `cld mail help` and confirm that the Mail module is available before changing a mailbox.
- Use `--json` when a later command needs an id or cursor.
- Pass provider credentials with `--secret-stdin` or `--secret-file`. Credentials are write-only and are never returned by the API.
- Read a message and its folder ids before changing flags, moving, copying, or deleting it.
- `sync`, `rediscover`, and `repair` create durable maintenance commands. A confirmed maintenance command proves that work was accepted or the repair transaction completed; folder sync progress remains visible through `status` and `mailbox wait`.
- Do not delete remote messages, revoke credentials, or delete mailbox resources without an explicit user request.

Mailbox deletion is reversible. It retains the Cloud mirror and never deletes provider mail. A restored mailbox remains paused until an admin verifies diagnostics and explicitly enables synchronization again.

```bash
cld mail delete <mailbox-id> --yes
cld --json mail mailbox deleted list
cld --json mail mailbox deleted get <mailbox-id>
cld mail mailbox restore <mailbox-id> --yes
cld --json mail status --mailbox <mailbox-id>
cld mail rediscover --mailbox <mailbox-id> --wait
cld mail configure --mailbox <mailbox-id> --sync enabled
```

Mailbox admins can delegate guided automatic-reply management to writers without granting access to providers, sender configuration, reference settings, or YAML workflows:

```bash
cld mail configure --mailbox <mailbox-id> --automatic-replies writers
cld mail configure --mailbox <mailbox-id> --automatic-replies admins
```

## Configure a mailbox

Create a mailbox and make it the default for later commands:

```bash
cld --json mail create "Support"
cld mail use <mailbox-id>
cld --json mail current
```

Store and verify a generic IMAP/SMTP connection. Supply the password through stdin; never place it in the command arguments:

```bash
cld --json mail provider add \
  --name "Support provider" \
  --email support@example.com \
  --username support@example.com \
  --imap-host imap.example.com \
  --imap-port 993 \
  --imap-tls implicit \
  --smtp-host smtp.example.com \
  --smtp-port 587 \
  --smtp-tls starttls \
  --secret-stdin
```

Browser OAuth for configured Google and Microsoft providers starts in **Mail > Settings > Connections** because the callback is bound to an authenticated browser session and an HttpOnly nonce cookie. The CLI keeps manual credentials as the generic fallback. Use `cld mail provider discover <email>` to see whether browser OAuth is available and `cld mail provider list` to inspect the provider, OAuth state, and token expiry without exposing tokens.

Attach the returned mailbox-owned connection and inspect the discovered binding:

```bash
cld --json mail binding attach <connection-id>
cld --json mail binding list
```

Wait for initial discovery and list provider-backed folders:

```bash
cld --json mail mailbox wait --health active --timeout-seconds 300
cld --json mail folders
```

Inspect the aggregate backend state, including bindings, discovery generations, missing folders, sync runs, hydration, commands, outbox, and search health:

```bash
cld --json mail status
```

For a normal mailbox, create and verify the provider address as the default sender in one idempotent step. Verification submits a real message to the provider address:

```bash
cld --json mail identity setup-default <binding-id> --name "Support"
cld --json mail identity list
```

Pass `--provider-saves-sent` only when the provider stores SMTP submissions in Sent itself. Otherwise Cloud resolves the configured Sent role and appends the sent copy through IMAP.

Use the manual identity lifecycle only for aliases, delegated senders, or other advanced cases:

```bash
cld --json mail identity add --address support@example.com --name "Support" --default
cld --json mail identity verify <identity-id> <binding-id> --recipient support@example.com
cld --json mail identity configure <identity-id> --name "Support Team" --default
cld --json mail identity list
```

Disabling an identity revokes its provider verification and requires explicit confirmation:

```bash
cld --json mail identity disable <identity-id> --yes
```

## Read and search mail

Queue a durable sync command, then wait for a unique expected message:

```bash
cld --json mail sync --wait
cld --json mail message wait \
  --subject "cloud-smoke-<unique-id>" \
  --match exact \
  --timeout-seconds 300
```

Search fields independently. Repeated fields use AND by default; pass `--or` to combine them with OR:

```bash
cld --json mail search --from sender@example.com --subject invoice --match contains --sort newest
cld --json mail search --body overdue --body reminder --or --cursor <next-cursor>
cld --json mail search --attachment-name invoice --comment approved --tag Priority
```

For nested AND, OR, and NOT expressions, pass the shared search contract through a file or stdin:

```json
{
  "type": "and",
  "expressions": [
    { "type": "text", "field": "subject", "query": "invoice", "match": "contains" },
    {
      "type": "not",
      "expression": { "type": "text", "field": "from", "query": "bot@example.com", "match": "exact" }
    }
  ]
}
```

```bash
cld --json mail search --expression-file query.json --sort newest
```

Inspect conversations and messages:

```bash
cld --json mail conversation list --status needs_action
cld --json mail conversation messages <conversation-id>
cld --json mail message get <message-id>
```

## Collaborate on conversations

Inspect and update durable collaboration state with optimistic revisions:

```bash
cld --json mail conversation collaboration <conversation-id>
cld --json mail conversation update <conversation-id> --revision <revision> --assignee <user-id> --status waiting
cld --json mail conversation activity <conversation-id>
```

Resolve permission-scoped Contacts from server-derived conversation participants:

```bash
cld --json mail conversation context <conversation-id>
cld --json mail conversation contact-history <conversation-id> <book-id-or-system> <contact-id>
```

Create and manage Cloud-local tags independently from provider keywords. Conversation assignment and next-step changes are optimistic and use the current conversation revision:

```bash
cld --json mail tag create "Priority"
cld --json mail tag list
cld --json mail tag rename <tag-id> "Urgent" --revision <tag-revision>
cld --json mail conversation tag set <conversation-id> --revision <conversation-revision> --tag <tag-id>
cld --json mail conversation tag add \
  --conversation <conversation-id> \
  --conversation <second-conversation-id> \
  --tag <tag-id>
cld --json mail conversation tag list <conversation-id>
cld --json mail tag delete <tag-id> --revision <tag-revision> --yes
```

`conversation tag set` replaces the complete tag set for one revision-fenced conversation. `conversation tag add` is an idempotent additive bulk operation for up to 50 conversations and 50 tags; existing assignments remain unchanged.

Add, edit, or tombstone internal Markdown comments:

```bash
cld --json mail comment add <conversation-id> --body-file note.md --message <message-id>
cld --json mail comment edit <conversation-id> <comment-id> --revision <revision> --body-file note.md
cld --json mail comment delete <conversation-id> <comment-id> --revision <revision> --yes
```

Personal reminders are revisioned. Omit `--revision` only when creating the first reminder:

```bash
cld --json mail reminder set <conversation-id> --due <ISO-timestamp>
cld --json mail reminder get <conversation-id>
cld --json mail reminder set <conversation-id> --due <ISO-timestamp> --revision <revision>
cld --json mail reminder cancel <conversation-id> --revision <revision>
```

Saved-view filters use the same bounded collaboration filter contract as the Mail app. Pass JSON or YAML through a file or stdin:

```bash
cld --json mail saved-view create "My action queue" --scope private --filter-file filter.yml
cld --json mail saved-view list
cld --json mail saved-view conversations <view-id>
cld --json mail saved-view update <view-id> --revision <revision> --name "Priority queue"
cld --json mail saved-view delete <view-id> --revision <revision> --yes
```

Manual thread repair is also revisioned and requires confirmation:

```bash
cld --json mail conversation split <conversation-id> --revision <revision> --message <message-id> --yes
cld --json mail conversation merge <target-id> <source-id> --target-revision <revision> --source-revision <revision> --yes
```

Live presence, reply-composer leases, and cursor-based WebSocket invalidation are browser transport concerns rather than durable CLI operations.

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

## Automate mail with workflows

Mail workflows use the shared Cloud workflow language: strict YAML with top-level `inputs`, optional automatic `triggers`, and `steps`. Workflow metadata is not part of the YAML. Mail lifecycle records store the name, description, ordering priority, activation state, immutable version IDs, and effect budget. The CLI and API both manage that lifecycle and its budgets.

### Write canonical YAML

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

`messageReceived` is emitted once for a stable inbound message imported by live incremental sync. Historical backfill does not emit it. Activation records who enabled the workflow and grants the active version mailbox-owned automation authority. Deactivation stops new automatic runs without changing existing versions or runs.

Omit `triggers` for a direct-only workflow. An empty `triggers: {}` is invalid. Direct-only and automatically triggered workflows can both be run manually through the CLI or API.

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

Activation reconciles each schedule into the shared scheduler. Every delivered slot has a deterministic key, revalidates the active workflow version and schedule before materialization, and uses the same authorization-aware, idempotent run path as event triggers. Duplicate delivery reuses the same logical run. The current misfire policy is explicit: slots missed while the scheduler process is offline are skipped rather than backfilled. PostgreSQL activation state remains authoritative for which schedules may create new runs.

### Use inputs, conditions, and actions

Mail exposes two input types:

- `mailMessage`: one mailbox message. Supported references include `id`, `conversationId`, `subject`, `sender`, `recipients`, `body`, `bodyText`, `bodyHtml`, `attachments`, `hasAttachments`, `folderId`, `flags`, `keywords`, `direction`, `internalDate`, and `receivedAt`.
- `mailConversation`: the message's conversation. Supported references include `id`, `subject`, `assigneeUserId`, `workStatus`, and `latestMessageAt`.

Use `${{ inputs.<name> }}` for a whole input and `${{ inputs.<name>.<field> }}` for a field. `${{ now() }}` resolves from the run clock. `context.mailboxId` is also available.

Conditions are recursive and contain exactly one operator:

- `equals` and `notEquals` compare two values.
- `contains`, `startsWith`, and `endsWith` compare two text values.
- `exists` accepts one reference such as `inputs.conversation.assigneeUserId`.
- `all` and `any` contain one or more conditions; `not` contains one condition.

Steps may use `if`/`then`/`else` and `switch`/`cases`/`default`. The shared parser understands `forEach`, but the Mail binder rejects it; Mail target sets are processed by the durable batch runtime instead.

The current Mail action vocabulary is:

| Action | Required configuration | Effect |
| --- | --- | --- |
| `addKeyword` | `message`, `keyword` | Durable provider command |
| `removeKeyword` | `message`, `keyword` | Durable provider command |
| `moveMessage` | `message`, literal accessible folder name or ID in `folder` | Durable provider command |
| `assignConversation` | `conversation`, literal assignable user name, ID, or `null` in `user` | Transactional collaboration change |
| `setConversationStatus` | `conversation`, `needs_action`, `waiting`, or `done` in `status` | Transactional collaboration change |
| `ensureConversationReference` | `conversation`; optional identifier in `result` | Transactional, idempotent reference allocation |
| `automaticReply` | `message`, `conversation`, bound sender, subject, body; optional inline schedule | Guarded automatic response |
| `setVariable` | Identifier in `name`, expression or literal in `value` | Store a pure scoped value for later steps |
| `succeed` | Operator-facing `message` | Stop successfully |
| `fail` | Operator-facing `message` | Stop with failure |

Literal folder and user names are bound to accessible stable IDs when a version is created. Unknown, inaccessible, or ambiguous names fail validation.
Reference a value stored by `setVariable` as `${{ <name> }}` in later steps in the same scope. Mail validation reserves `inputs` and `trigger` and rejects another value with the same name in that scope.

Reference allocation can expose its result to later steps:

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

The result contains `id`, `value`, `created`, `conversationId`, and `conversationRevision`. Configure the mailbox sequence first with `mail reference config set`. The guided **Reference acknowledgement** in the Mail app produces the same ordinary workflow shape.

### Validate, save, and activate

Keep YAML in a file so the exact source can be reviewed and versioned:

```bash
cld mail workflow validate --source-file route-mail.yml

cld --json mail workflow create \
  --name "Route invoices" \
  --description "Move new invoices into the team folder" \
  --priority 100 \
  --max-targets 500 \
  --max-moves 500 \
  --max-keyword-changes 500 \
  --max-collaboration-changes 500 \
  --source-file route-mail.yml
```

Creation stores one immutable version but does not activate it. Use the returned `id` as `<workflow-id>` and `currentVersion.id` as `<version-id>`:

```bash
cld --json mail workflow get <workflow-id>
cld --json mail workflow version list <workflow-id>
cld --json mail workflow activate <workflow-id> --version-id <version-id>
```

Changing YAML creates another immutable version. It does not mutate the active version or historical runs:

```bash
cld --json mail workflow version create <workflow-id> --source-file route-mail.yml
cld --json mail workflow activate <workflow-id> --version-id <new-version-id>
cld --json mail workflow deactivate <workflow-id> --version-id <active-version-id>
```

Activation and deactivation require the expected current or active version ID, so a concurrent edit fails instead of activating the wrong source. Manual execution may target any saved immutable version; activation controls automatic triggers only.

### Preflight and run manually

Manual runs use a mailbox-scoped target query. Omit `--query-file` to select all current messages, or provide JSON or YAML such as:

```yaml
type: search
expression:
  and:
    - field: subject
      query: invoice
      match: contains
    - not:
        field: from
        query: bot@example.com
        match: exact
```

Preflight is read-only. It runs the shared dry-run traversal over frozen message and conversation snapshots, counts planned effects, enforces the immutable version's effect budget, and returns a version-bound `preflightHash` and target count:

```bash
cld --json mail workflow preflight <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml
```

The CLI run commands preflight again immediately before execution. Without `--yes`, they print the preflight and stop. With `--yes`, they submit the returned hash and queue the durable run:

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

`invoke`, `one-shot`, and `backfill` currently share the same version-pinned query, preflight, and execution path. Their stored run kind records caller intent. Use a stable `--idempotency-key` when a caller may retry; reusing it with different inputs, query, version, or run kind fails with a conflict.

Current CLI workflow requests use the authenticated API transport and are recorded by the server with channel `api`. The shared Cloud CLI transport does not provide authenticated client provenance, so a client-controlled header must not be used to claim channel `cli`. A distinct `cli` audit channel requires shared server-derived or cryptographically authenticated request metadata before Mail can trust it.

Use a durable dry run when you need an auditable per-target plan without applying effects:

```bash
cld --json mail workflow run dry-run <workflow-id> \
  --version-id <version-id> \
  --query-file invoice-query.yml \
  --idempotency-key invoice-review-2026-07-15 \
  --wait
```

Dry runs use the same frozen targets, leases, recovery, and result history as execution, but action planners receive no effect-capable ports. They do not create Mail provider commands or collaboration mutations.

Inspect durable progress separately for long runs:

```bash
cld --json mail workflow run list --workflow <workflow-id>
cld --json mail workflow run get <run-id>
cld --json mail workflow run targets <run-id> --after -1 --limit 100
cld --json mail workflow run wait <run-id> --timeout-seconds 300
cld --json mail workflow run cancel <run-id> --reason "Superseded" --yes
```

With `--json` or `--jsonl`, a waited run that ends in `failed`, `canceled`, or `needs_attention` writes a structured `{ error, run }` result and exits with status 1. Effectful run commands also include their `preflight`. The error contains `code`, `message`, and `retryable`; text mode writes the same failure concisely to stderr.

### Understand safety and recovery

Every saved version carries an effect budget. Both `workflow create` and `workflow version create` use defaults of 1,000 targets, 1,000 moves, 2,000 keyword changes, and 2,000 collaboration changes when their flags are omitted. Set the version's budget with `--max-targets`, `--max-moves`, `--max-keyword-changes`, and `--max-collaboration-changes`; a new version does not implicitly inherit the previous version's budget. The API and CLI accept values up to 50,000 targets and moves and 100,000 keyword or collaboration changes. Preflight rejects work above the saved budget or the hard 50,000-target/50,000-total-effect planning ceilings.

Creating versions and activating or deactivating workflows requires mailbox `admin`; validation and inspection require `read`; preflight, manual execution, and cancellation require current mutation access. Manual runs snapshot the initiating user or service-account credential and recheck it during execution. Automatic runs use the active version's mailbox-owned authority, so removing the activating administrator's later personal access does not silently disable approved automation. Deactivation or replacement prevents new automatic runs. Runs accepted before that change retain their pinned version and automation authority; cancel such a run explicitly to stop unfinished targets. Provider commands and collaboration actions still perform current mailbox, capability, and resource-revision checks before changing mail.

Provider actions create idempotent Mail commands. The workflow step enters `waiting` until the command is confirmed, failed, reconciled, canceled, or marked `needs_attention`. Body, HTML, or attachment references can similarly wait for hydration during automatic execution. Large backfills materialize frozen targets in bounded keyset batches and persist a restart cursor and rolling digest before any target is executable. Durable step outcomes are restored after retries; lease generations fence stale workers; dependency events reduce wake-up latency; and PostgreSQL reconciliation recovers interrupted materialization, missed events, expired claims, and terminal dependencies. Ambiguous provider outcomes become `needs_attention` rather than being blindly repeated.

### Call the workflow API

Mail workflow routes are under `/api/mail/mailboxes/{mailboxId}`. Use `cld api-docs operations mail` for the live OpenAPI contract. The following request creates a workflow with an explicit effect budget:

```bash
jq -n --rawfile source route-mail.yml '{
  name: "Route invoices",
  description: "Move new invoices into the team folder",
  priority: 100,
  source: $source,
  effectBudget: {
    maxTargets: 500,
    maxMoves: 500,
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

## Compose templates and previews

List, create, update, and archive mailbox or private signatures and snippets:

```bash
cld --json mail compose template list
cld --json mail compose template create \
  --kind snippet \
  --scope mailbox \
  --name "Meeting details" \
  --shortcut meeting \
  --body-file meeting.md
cld --json mail compose template update <template-id> --revision <revision> --body-file meeting.md
cld mail compose template archive <template-id> --revision <revision> --yes
```

Compose rendering needs the same editable draft context as the Mail composer. Store it as JSON so recipients, sender identity, subject, format, and body remain explicit:

```json
{
  "senderIdentityId": "<identity-id>",
  "to": [{ "name": null, "address": "recipient@example.com" }],
  "cc": [],
  "bcc": [],
  "subject": "Example",
  "body": "Hello",
  "format": "markdown"
}
```

Render one template, query rendered slash-command suggestions, or preview the final HTML and plaintext:

```bash
cld --json mail compose snippet render <template-id> --draft-file draft.json
cld --json mail compose suggestions meet --draft-file draft.json
cld --json mail compose preview --draft-file draft.json
```

Pass `--conversation <conversation-id>` when the compose context belongs to an existing thread. `compose suggestions` accepts an empty query when you omit its optional positional argument.

Set a personal or mailbox-wide default signature for a sender identity and manage the validated mailbox CSS:

```bash
cld --json mail compose signature list
cld --json mail compose signature default <identity-id> --scope private --template <template-id>
cld --json mail compose style get
cld --json mail compose style set --css-file mail.css
```

## Draft and send

Create or replace a revision-checked shared draft:

```bash
cld --json mail draft create \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Draft subject" \
  --body-file body.md

cld --json mail draft update <draft-id> \
  --revision <current-revision> \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Updated subject" \
  --body-file body.md
```

List all active drafts or only the drafts attached to one conversation:

```bash
cld --json mail draft list
cld --json mail conversation drafts <conversation-id> --limit 20
```

For a forward, copy the source message's eligible attachments into the new draft explicitly:

```bash
cld --json mail draft create \
  --identity <identity-id> \
  --conversation <conversation-id> \
  --intent forward \
  --source-message <message-id> \
  --include-source-attachments \
  --subject "Fwd: Message subject" \
  --body-file body.md
```

Inspect a draft, then stream attachments at its current revision. Every attachment change increments the revision:

```bash
cld --json mail draft get <draft-id>
cld --json mail draft attachment add <draft-id> ./invoice.pdf --revision <current-revision>
cld --json mail draft attachment remove <draft-id> <attachment-id> --revision <current-revision>
cld --json mail draft discard <draft-id> --revision <current-revision> --yes
```

Send immediately and wait for the durable command to succeed:

```bash
cld --json mail send \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Message subject" \
  --body-file body.md \
  --attach ./invoice.pdf \
  --undo 0 \
  --wait \
  --timeout-seconds 180
```

Set `--conversation <conversation-id>` when replying so Mail adds the correct `In-Reply-To` and `References` headers.

Schedule a send with an ISO timestamp. For long-dated sends, inspect the returned command later instead of keeping a CLI process open:

```bash
cld --json mail send \
  --identity <identity-id> \
  --to recipient@example.com \
  --subject "Scheduled message" \
  --body-file body.md \
  --schedule <ISO-timestamp> \
  --undo 0
```

To exercise Undo Send, queue with an undo window and cancel the returned command id before submission starts:

```bash
cld --json mail send --identity <identity-id> --to recipient@example.com --subject "Undo test" --body "Cancel me" --undo 60
cld --json mail command cancel <command-id>
```

Inspect or wait for durable commands:

```bash
cld --json mail command list
cld --json mail command get <command-id>
cld --json mail command wait <command-id> --timeout-seconds 180
```

## Provider-backed operations

Rediscover namespaces, subscriptions, and effective folder rights for every active binding, or target one binding:

```bash
cld --json mail rediscover --wait --timeout-seconds 300
cld --json mail rediscover --binding <binding-id> --wait --timeout-seconds 300
```

After replacing provider credentials, explicitly reverify the binding:

```bash
cld --json mail binding verify <binding-id> --wait --timeout-seconds 300
```

Queue one canonical folder without synchronizing the entire mailbox:

```bash
cld --json mail sync folder <folder-id> --wait
```

Rebuild a folder only after a confirmed `UIDVALIDITY` or remote identity change. The command retains message content but invalidates stale remote placements before resynchronizing:

```bash
cld --json mail repair folder <folder-id> --yes --wait --timeout-seconds 300
```

Retry messages whose body or attachment hydration exhausted its normal retry budget:

```bash
cld --json mail repair hydration --wait
```

Maintenance commands require mailbox `admin`. Use `--idempotency-key` when an external script may retry the same request.

Create, subscribe, rename, and safely delete empty provider folders. Every command is durable and rediscovery updates the canonical folder projection before it confirms:

```bash
cld --json mail folder create "Cloud Review" --wait
cld --json mail folder unsubscribe <folder-id> --wait
cld --json mail folder subscribe <folder-id> --wait
cld --json mail folder rename <folder-id> "Cloud Reviewed" --wait
cld --json mail folder delete <folder-id> --yes --wait
```

For providers with missing or ambiguous special-use metadata, map a semantic role explicitly without changing the provider folder:

```bash
cld --json mail folder role set archive <folder-id>
cld --json mail folder role clear archive
```

Use `remoteMessageRefId` and `folderId` from `message get` or `conversation messages`:

```bash
cld --json mail message read <remote-message-ref-id> --folder <folder-id> --wait
cld --json mail message unread <remote-message-ref-id> --folder <folder-id> --wait
cld --json mail message star <remote-message-ref-id> --folder <folder-id> --wait
cld --json mail message keyword add <remote-message-ref-id> CloudReviewed --folder <folder-id> --wait
cld --json mail message copy <remote-message-ref-id> --source <folder-id> --destination <folder-id>
cld --json mail message move <remote-message-ref-id> --source <folder-id> --destination <folder-id>
```

These state commands add or remove only the requested state and preserve concurrent changes from other clients. `message flags` remains available as a low-level exact replacement for diagnostics.

Apply the same action to every current placement of a conversation in one source folder. Archive, Trash, and Junk resolve through the mailbox's effective folder roles:

```bash
cld --json mail conversation read <conversation-id> --source <folder-id> --wait
cld --json mail conversation star <conversation-id> --source <folder-id> --wait
cld --json mail conversation archive <conversation-id> --source <folder-id> --wait
cld --json mail conversation trash <conversation-id> --source <folder-id> --wait
cld --json mail conversation junk <conversation-id> --source <folder-id> --wait
cld --json mail conversation move <conversation-id> <destination-folder-id> --source <folder-id> --wait
```

Remote deletion requires `--yes`:

```bash
cld mail message delete <remote-message-ref-id> --folder <folder-id> --yes
```

Download a complete attachment or an explicit byte range:

```bash
cld --json mail attachment download <message-id> <attachment-id> --out attachment.bin
cld --json mail attachment download <message-id> <attachment-id> --offset 0 --length 1048576 --out first-megabyte.bin
```

Create a revocable public link for a mirrored message attachment or a draft attachment. Passwords are accepted only from stdin or a file:

```bash
cld --json mail attachment link create <message-id> <attachment-id> --source message --expires-at <ISO-timestamp>
cld --json mail attachment link create <draft-id> <attachment-id> --source draft --password-stdin
cld --json mail attachment link list
cld mail attachment link revoke <link-id> --yes
```

## Two-account smoke test

Use a unique marker for every run and keep both mailbox ids explicit:

1. Configure and verify mailbox A and mailbox B.
2. Send A to B with `--undo 0 --wait` and the marker in the exact subject.
3. Queue B sync and use `message wait` for the marker.
4. Read the message and its conversation, then reply B to A with `--conversation`.
5. Queue A sync and verify that the reply appears in the same conversation.
6. Create a uniquely named provider folder, unsubscribe, resubscribe, rename, and delete it after confirming it is empty.
7. Test additive read/star/keyword state and a role-based conversation move using discovered folder ids.
8. Send a known attachment, download it from the receiving mailbox, and compare its bytes with the source.
9. Test Undo Send with a second marker and `command cancel`.

Do not automatically delete provider mail after the run. The marker keeps test messages easy to inspect or remove later with explicit approval.
