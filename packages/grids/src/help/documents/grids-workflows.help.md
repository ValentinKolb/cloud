---
id: grids-workflows
title: Workflows
icon: ti ti-route
description: Automate repeatable work with typed inputs, safe actions, and observable runs.
order: 140
---
Workflows carry out repeatable operations in Grids. Use one when a person or event should run the same checked sequence of record changes, document generation, email delivery, or JSON HTTP requests.

A workflow is more than a hidden automation. It has typed inputs, a reviewed YAML definition, permissions, revisions, and a run history that shows what happened at each step.

### Decide whether to use a workflow

Use a normal field or formula when you only need to store or calculate one value. Use a form when you only need guided record creation. Use a workflow when the operation has several steps, must be run consistently, needs a scanner or bulk action, contacts another system, or needs an observable success or failure.

A small workflow is preferable to a large one with unrelated branches. Give it one outcome-oriented name, such as **Return item** or **Send approved invoice**.

### Create and test a first workflow

The normal Name and Description fields explain the workflow to users. YAML defines only executable behavior: inputs, optional automatic triggers, and steps.

This workflow asks for one Items record and changes its status:

**Update one record**

```yaml
inputs:
  item:
    type: record
    table: Items
steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Checked
```

1. Open **Workflows** in Edit mode and create a workflow.
2. Enter the name and description outside YAML.
3. Add the smallest input and step definition that produces the intended result.
4. Save until the YAML and Grids references validate.
5. Run a **dryRun** with a representative input and inspect every predicted effect.
6. Run **execute**, then inspect the completed run and changed record.
7. Add an automatic trigger or saved launcher only after direct execution is correct.

### How runs start

A workflow can start in three ways:

- **Direct invocation:** The Grids UI, authenticated API, or CLI supplies its inputs.
- **Saved launcher:** A scanner, bulk action, or dashboard button supplies a surface-specific input.
- **Automatic trigger:** A schedule or record event declared in YAML supplies trigger values.

All three create the same kind of run from typed inputs and the active workflow revision. A workflow does not need a YAML trigger.

Scanner, bulk, and dashboard launchers are saved separately and remain outside workflow YAML. One workflow can therefore have several named surfaces without duplicating its executable definition. A scanner resolves scanned text into one record input, bulk supplies one record-list input, and a dashboard launcher may keep fixed input values.

### Understand a run

- **Inputs:** Typed values supplied by a direct caller, launcher, or automatic trigger. Record inputs resolve before steps execute.
- **Start:** Invoke directly, use a persisted launcher, or declare an automatic trigger. A workflow does not need a YAML trigger.
- **Steps:** Actions and control flow executed in order. Failed steps stop the run and write diagnostics to the run history.
- **Observe:** Each run keeps its revision, mode, channel, inputs, status, timing, step outcomes, result or error, and generated documents.

An idempotency key identifies one logical invocation. Retrying with the same key reuses it; reusing the key for different input is rejected. This prevents an uncertain client retry from quietly creating a second logical run.

### Inputs reference

- **Input types:** `record`, `recordList`, `text`, `number`, `boolean`, `date`, `dateTime`, and `select`.
- **Common fields:** Every input has `type`. Add `label`, `description`, and `required` so callers and generated input controls can explain what the run needs.
- **Record inputs:** `record` and `recordList` require a `table`. Table references may use the table name, short id, or uuid if unambiguous.
- **Select inputs:** `select` requires an `options` list. The submitted value must match one option exactly.

**Input declarations (fragment)**

```yaml
inputs:
  item:
    type: record
    table: Items
    label: Item
    required: true
  labels:
    type: recordList
    table: Items
  note:
    type: text
  priority:
    type: select
    options:
      - Low
      - Normal
      - High
```

### Starting a workflow

- **Direct invocation:** Manual UI, API, and CLI callers invoke the same workflow directly with an input object, execute or dryRun mode, and an idempotency key.
- **Persisted launchers:** Scanner, bulk, and dashboard launchers are saved resources attached to a workflow. They are configured and validated outside workflow YAML.
- **Automatic triggers:** Only schedule and recordEvent belong under triggers in YAML. The triggers block is optional when a workflow starts only through direct invocation or launchers.
- **Revision and deduplication:** Callers may require the expected active revision. Idempotency keys reuse the same logical invocation and reject conflicting reuse.

### Automatic trigger reference

- **schedule:** Runs delivered future slots from a five-field cron expression. timezone is an optional IANA timezone and defaults to UTC. Duplicate slots reuse one logical run; slots missed while the scheduler process is offline are skipped rather than backfilled.
- **recordEvent:** Runs when a record is created, updated, or deleted. Add an optional table restriction and optional server-side filter.
- **with bindings:** Map trigger values into declared workflow inputs. Every required input must receive a compatible value before the automatic run can start.
- **Trigger values:** Schedules expose occurredAt and slot. Record events expose record, event, and occurredAt through the trigger root.

**Scheduled workflow**

```yaml
inputs:
  requestedAt:
    type: dateTime
    required: true
triggers:
  schedule:
    cron: '0 9 * * 1-5'
    timezone: Europe/Berlin
    with:
      requestedAt: ${{ trigger.slot }}
steps:
  - succeed:
      message: "Scheduled for ${{ inputs.requestedAt }}."
```

**Record-event workflow**

```yaml
inputs:
  item:
    type: record
    table: Items
    required: true
  eventAt:
    type: dateTime
    required: true
triggers:
  recordEvent:
    event: updated
    table: Items
    filter:
      fieldId: Name
      op: contains
      value: ready
      caseInsensitive: true
    with:
      item: ${{ trigger.record }}
      eventAt: ${{ trigger.occurredAt }}
steps:
  - updateRecord:
      record: inputs.item
      set:
        Reviewed at: ${{ inputs.eventAt }}
```

- **Filter shape:** A leaf uses fieldId, op, and value; fieldId accepts a field name, short id, or uuid. Text leaves may also set caseInsensitive. Combine leaves with a group containing op: AND or op: OR and a filters list. isEmpty, isNotEmpty, today, thisWeek, and thisMonth omit value.
- **Text operators:** equals, notEquals, contains, notContains, startsWith, endsWith, regex, isEmpty, isNotEmpty.
- **Number operators:** =, !=, <, <=, >, >=, between, isEmpty, isNotEmpty. between takes a two-number \[from, to] list.
- **Date operators:** =, notEquals, before, after, onOrBefore, onOrAfter, between, today, thisWeek, thisMonth, lastNDays, isEmpty, isNotEmpty. between takes a two-value \[from, to] list. Use ISO dates, timezone-aware ISO date-times for fields with time, and a non-negative integer for lastNDays.
- **Boolean, select, and relation operators:** Boolean fields use =, isEmpty, isNotEmpty. Select fields use is, isNot, isAnyOf, isNoneOf, isEmpty, isNotEmpty; list operators take option-id arrays. Relation fields use containsAny, notContainsAny, isEmpty, isNotEmpty; list operators take non-empty record UUID arrays.

:::note Required inputs
Direct callers can provide every declared input. Launchers provide their configured binding plus any invocation inputs. Each automatic trigger must use `with` to provide all required inputs from compatible trigger values.
:::

### Launcher reference

- **Scanner:** Binds one record input. Resolve scanned text by a generated scan code or by a configured field that enforces unique values. The scanner surface shows the camera and a running log of accepted, failed, and completed scans.
- **Bulk:** Binds one recordList input from explicit record IDs or a row-shaped table query, with at most 10,000 records per run.
- **Dashboard:** Exposes the workflow as a dashboard action and may persist input bindings such as a fixed reporting range.
- **Launcher lifecycle:** Each launcher has its own name, enabled state, validated workflow revision, and diagnostics. Review launcher diagnostics when workflow inputs change.

:::note Outside YAML
Launcher configuration is persisted with the workflow, not copied into its source. One workflow can therefore support multiple named scanner, bulk, or dashboard surfaces without changing the executable definition.
:::

### Step reference

- **updateRecord:** Changes fields on one record. Required fields: `record` and `set`. If the table requires change context, pass `audit` answers keyed by the question IDs shown in the table's Data integrity settings.
- **createRecord:** Inserts a record. Required fields: `table` and `values`. Optional: `saveAs`.
- **generateDocument:** Generates a PDF for one record. Supports `template`, `record`, `filename`, `tags`, and `saveAs`.
- **createDocumentLink:** Creates an expiring public download link for a document generated earlier in the run. Required field: `document`. Optional fields: `expiresIn`, `comment`, and `saveAs`.
- **sendEmail:** Sends one configured email template. Required fields: `template` and `to`. Recipients can be `email` values or Cloud `user` ids. Optional fields: `data` and `saveAs`.
- **httpRequest:** Sends one JSON HTTP request. Methods: GET, POST, PUT, PATCH, DELETE. Optional fields: headers, json, timeoutMs, saveAs. Redirects are returned, not followed.
- **setVariable, succeed, and fail:** setVariable stores a value for later steps. succeed stops the run with a visible success message; fail stops it with a visible error message.

**Actions**

```yaml
inputs:
  item:
    type: record
    table: Items
    required: true
  priority:
    type: select
    options:
      - Low
      - Normal
      - High
  recipientEmail:
    type: text
    required: true
steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Available
        Last scanned at: ${{ now() }}
  - createRecord:
      table: Movements
      values:
        Item: ${{ inputs.item }}
        Type: Check-in
      saveAs: movement
  - generateDocument:
      template: Item label
      record: inputs.item
      filename: ${{ inputs.item.Name }}
      tags:
        - label
        - ${{ inputs.priority }}
      saveAs: labelRun
  - createDocumentLink:
      document: labelRun
      expiresIn: 30d
      comment: Workflow email link
      saveAs: labelLink
  - sendEmail:
      template: Label ready email
      to:
        - email: ${{ inputs.recipientEmail }}
      data:
        link: ${{ labelLink }}
        document: ${{ labelRun }}
      saveAs: emailResult
  - httpRequest:
      method: POST
      url: https://example.com/hooks/grids
      headers:
        X-App: Grids
      json:
        event: item.checked_in
        item: ${{ inputs.item }}
      timeoutMs: 15000
      saveAs: hook
  - setVariable:
      name: finishedAt
      value: ${{ now() }}
  - succeed:
      message: "${{ inputs.item.Name }} checked in."
```

### Control flow

Control flow is still a normal step. That keeps nested behavior explicit and makes diagnostics point at the failing branch instead of guessing what the workflow meant.

- **Value comparisons:** Use `equals` or `notEquals` with two literal or dynamic values.
- **Text comparisons:** Use `contains`, `startsWith`, or `endsWith` with two text values.
- **Presence and nesting:** `exists` takes one raw value reference. Combine conditions recursively with `all`, `any`, and `not`.

**Branches and loops**

```yaml
inputs:
  item:
    type: record
    table: Items
    required: true
  items:
    type: recordList
    table: Items
    required: true
  priority:
    type: select
    options:
      - Low
      - Normal
      - High
steps:
  - if:
      equals:
        - ${{ inputs.item.Status }}
        - Loaned
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
    else:
      - fail:
          message: Item is not currently loaned out.
  - switch: ${{ inputs.priority }}
    cases:
      - when: High
        do:
          - setVariable:
              name: queue
              value: urgent
    default:
      - setVariable:
          name: queue
          value: normal
  - forEach: inputs.items
    as: item
    do:
      - generateDocument:
          template: Item label
          record: item
```

**Recursive conditions**

```yaml
inputs:
  item:
    type: record
    table: Items
    required: true
  prefix:
    type: text
    required: true
steps:
  - if:
      all:
        - exists: inputs.item.Status
        - any:
            - equals:
                - ${{ inputs.item.Status }}
                - Loaned
            - startsWith:
                - ${{ inputs.item.Name }}
                - ${{ inputs.prefix }}
        - not:
            endsWith:
              - ${{ inputs.item.Name }}
              - Archived
    then:
      - succeed:
          message: Item matches.
    else:
      - fail:
          message: Item does not match.
```

### Values and references

- **Literal strings:** Plain strings are always literal values. Write `Checked`, URLs, email addresses, and dotted text directly when the workflow should use that exact text.
- **Dynamic values:** A dynamic value must be the whole `${{ ... }}` string. Use `${{ inputs.name }}`, append a record field such as `${{ inputs.item.Status }}`, read a saved value with `${{ savedValue }}`, or evaluate `${{ now() }}`.
- **Dedicated references:** Reference-only slots stay raw: `record: inputs.item`, `forEach: inputs.items`, `document: savedDocument`, and `exists: inputs.item.Field`. Do not wrap these slots in expression syntax.
- **Scope:** Inputs are available for the whole run. `saveAs` and `setVariable` names are available only after their step. A `forEach` alias exists only inside its `do` steps; values created inside branches and loops do not escape that scope.
- **Result messages:** `succeed` and `fail` messages are literal text that may embed one or more expressions, for example `Processed ${{ inputs.item.Name }}`.

:::note Saved output paths
Saved outputs expose structured paths. Documents provide `id`, `shortId`, `templateId`, `workflowRunId`, `snapshotId`, `baseId`, `tableId`, `recordId`, `documentNumber`, `filename`, `tags`, `generatedBy`, and `generatedAt`. Document links provide `url`, `expiresAt`, and `documentRunId`. Email results provide `subject`, `templateId`, and `recipients`. HTTP results provide `status`, `ok`, and `body`. Read them with expressions such as `${{ link.url }}` or `${{ hook.status }}`.
:::

### Email templates

Email templates are managed from the workflow page in Edit mode. They are base-level Liquid templates with a subject, HTML, CSS, sample data, and preview. A workflow step chooses one template and passes only the `data` that email needs.

- **Template lookup:** `sendEmail.template` accepts an enabled email template name, short id, or uuid. Ambiguous names are rejected.
- **Recipients:** Use `email` for an email address value or `user` for a Cloud user id. Each entry must pick one recipient type.
- **Liquid roots:** Templates can read `data`, `app`, `business`, `workflow`, `run`, and `date`.

**Send a generated document link**

```yaml
inputs:
  invoice:
    type: record
    table: Invoices
    required: true
  recipientEmail:
    type: text
    required: true
steps:
  - generateDocument:
      template: Invoice
      record: inputs.invoice
      saveAs: invoicePdf
  - createDocumentLink:
      document: invoicePdf
      expiresIn: 30d
      saveAs: invoiceLink
  - sendEmail:
      template: Invoice email
      to:
        - email: ${{ inputs.recipientEmail }}
      data:
        link: ${{ invoiceLink }}
        document: ${{ invoicePdf }}
```

**Email HTML**

```html
<p>Hello,</p>
<p>Your document is ready.</p>
<p><a href="{{ data.link.url }}">Download PDF</a></p>
<p>{{ business.legalName | default: app.name }}</p>
```

### Run modes and observability

- **execute:** Runs the active revision and performs its record changes, durable intents, and external requests.
- **dryRun:** Plans the workflow, checks current references and permissions, and records predicted effects without applying changes or sending external requests.
- **Channels:** Direct UI, API, and CLI calls use api. Saved launchers use dashboard, scanner, or bulk. Automatic triggers use schedule or recordEvent.
- **Run statuses:** A run is queued, running, waiting, succeeded, failed, canceled, or needs_attention.
- **Step statuses:** Step history uses the run states where applicable and can also show skipped, indeterminate, or unsupported planning outcomes.
- **Run detail:** Inspect revision, channel, mode, input, start and finish times, duration, result message or structured error, each step outcome, and generated documents.

:::note Dry runs are recorded
A dry run is a normal observable run with mode `dryRun`. Review its predicted effects and step outcomes; it does not prove that a later execute run will see unchanged records, permissions, or external systems.
:::

### Permissions and limits

- **Run permission:** Direct calls and standalone launcher runs require workflow write access. Dashboard widget runs use included dashboard authorization; actions still check their target resources.
- **Caller run identity:** Direct UI, API, and CLI calls plus scanner, bulk, and dashboard launchers run as the user or service account that starts them. Direct calls share the api channel; authorization still records the authenticated principal.
- **Automatic run identity:** Schedules and record events run as the workflow owner with the owner's current groups. A record event keeps the user who changed the record in trigger metadata, but does not inherit that user's permissions.
- **Action permission:** Record reads, record writes, document generation, document links, and email sends check the run identity against the affected table, template, or workflow.
- **Email delivery:** Email template management requires base admin access. Workflow runs can use enabled email templates without exposing template HTML in autocomplete.
- **HTTP guardrails:** httpRequest pins the validated DNS address for the socket connection, limits request and response bodies to 64 KiB, applies the timeout to DNS and transfer, and blocks private or reserved targets by default. Administrators can restrict requests to an exact or wildcard host allowlist. Private-network requests require both the private-network setting and a matching non-empty host allowlist.
- **Bulk size:** Bulk selections and forEach loops are capped at 10,000 records per run.

### Scanner example

**Scanner workflow YAML**

```yaml
inputs:
  item:
    type: record
    table: Items
    required: true
steps:
  - if:
      equals:
        - ${{ inputs.item.Status }}
        - Loaned
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
            Last scanned at: ${{ now() }}
      - succeed:
          message: "${{ inputs.item.Name }} returned."
    else:
      - fail:
          message: "${{ inputs.item.Name }} is not currently loaned out."
```

:::note Saved launcher
Add a scanner launcher for the `item` record input. Choose generated scan-code resolution or configure a unique field such as `Label code`. The launcher remains outside this YAML.
:::

### Bulk document example

**Bulk document workflow YAML**

```yaml
inputs:
  items:
    type: recordList
    table: Items
    required: true
steps:
  - forEach: inputs.items
    as: item
    do:
      - generateDocument:
          template: Item label
          record: item
```

:::note Saved launcher
Add a bulk launcher for the `items` record-list input. The launcher can supply an explicit selection or the current row-shaped query without adding a trigger to YAML.
:::
