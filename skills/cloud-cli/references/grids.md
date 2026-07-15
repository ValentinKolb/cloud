# Grids CLI

Grids stores structured operational data in bases made of tables, fields, records, views, forms, dashboards, documents, and workflows. Use `cld grids` to inspect and change the Grids resources available to the signed-in user through the same permission-checked HTTP API used by the app.

## Contents

- [Core model](#core-model)
- [Agent workflow](#agent-workflow)
- [Resolve resources and pass input](#resolve-resources-and-pass-input)
- [Build schema and records](#build-schema-and-records)
- [Query data with GQL](#query-data-with-gql)
- [Create views, forms, and dashboards](#create-views-forms-and-dashboards)
- [Generate documents](#generate-documents)
- [Manage access](#manage-access)
- [Build and operate workflows](#build-and-operate-workflows)
- [Command index](#command-index)

## Core model

- A **base** is the main data and access boundary. `cld grids use <base>` stores a default base for later commands.
- A **table** owns fields and records. Tables, fields, and most other named resources have a UUID, a short id, and a name.
- A **field** defines storage, validation, and presentation for one record value. Record write payloads use field UUIDs as keys.
- A **record** is a versioned row. Relations store target record UUIDs. Computed and system fields are read-only.
- A **view** is a saved GQL query plus display settings. Views can be shared or personal.
- A **form** writes records through a configured set of fields. A table also has a virtual default form.
- A **dashboard** contains configured widgets that reference resources by UUID.
- A **document template** renders GQL data through Liquid HTML and Gotenberg. A generated document keeps a recursive record snapshot.
- A **workflow** is validated YAML with inputs, optional triggers, and steps. Launchers adapt workflows to scanner, bulk, and dashboard interactions.

Permissions are enforced by the backend on every command. Listing or resolving a resource does not grant access to it.

## Agent workflow

Work from discovery to mutation, then read the result back.

1. Confirm that Grids is installed and discover accessible bases:

   ```bash
   cld apps list --search grids --json
   cld grids list --json
   cld grids use Bookshop
   cld grids current --json
   ```

2. Inspect the live schema before constructing payloads:

   ```bash
   cld grids tables list --json
   cld grids fields list Authors --json
   cld grids records shape Authors --json
   ```

3. Read current data before updating it. Keep the returned UUID and `version` when the next write depends on current state:

   ```bash
   cld grids records list Authors --limit 100 --json
   cld grids records get Authors <record-uuid> --json
   ```

4. Validate languages and templates before saving them:

   ```bash
   cld grids gql compile-view --query-file authors.gql --json
   cld grids formulas check Authors --expression-file score.formula --json
   cld grids workflows validate --source-file workflow.yml --json
   ```

5. Write with file input for JSON, YAML, GQL, HTML, or other multiline content. Read the created resource back with `--json`.

6. Pass `--yes` only after the user has explicitly requested a destructive operation. Delete commands are soft-delete operations where a matching restore command exists.

## Resolve resources and pass input

### Base selection

Most base-scoped commands accept a leading base argument or `--base <ref>`. Once `cld grids use <base>` sets a default, omit the base where the command has enough remaining arguments to be unambiguous.

```bash
cld grids tables list Bookshop --json
cld grids tables list --base Bookshop --json
cld grids use Bookshop
cld grids tables list --json
```

A base reference can be a UUID, short id, or exact name. Table, field, view, form, dashboard, document-template, workflow, and launcher commands likewise resolve documented id, short-id, or exact-name references inside their parent scope. Prefer UUIDs from JSON output in unattended automation.

### Structured input

Commands with JSON bodies accept `--body <json>`, `--body-file <path>`, or `--stdin`. Specialized inputs follow the same pattern, for example `--query-file`, `--source-file`, `--inputs-file`, and `--expression-file`.

```bash
cld grids records create Authors --body-file record.json --json
cat records.json | cld grids records import --table Authors --stdin --json
cld grids workflows create --name "Check in" --source-file workflow.yml --enabled --json
```

Use `--json` whenever another command or agent will consume the result. Normal text output is for human inspection and may omit nested fields.

## Build schema and records

### Bases and tables

```bash
cld grids bases create Bookshop --description "Books and loans" --use --json
cld grids tables create --name Authors --description "People who wrote books" --json
cld grids tables get Authors --json
```

Base commands are `list`, `use`, `current`, and `bases list|get|create|update|delete|restore`. Table commands are `tables list|get|create|update|delete|restore`.

`bases restore`, `tables restore`, and the other restore commands require the deleted resource UUID rather than a name lookup.

### Field types

Never guess a field config or record encoding. Read the live catalog first:

```bash
cld grids fields types --json
cld grids fields type relation --json
cld grids fields type select --json
```

The shipped field types are:

- Writable values: `boolean`, `date`, `duration`, `json`, `longtext`, `number`, `percent`, `select`, `text`.
- Writable links: `relation`.
- Read-only computed values: `formula`, `lookup`, `rollup`.
- Read-only system or generated values: `created_at`, `created_by`, `id`, `updated_at`, `updated_by`.
- External file storage: `file`; use `records files` commands instead of record JSON.

Important encodings:

- `number` stores a canonical decimal string, although writes accept strings or numbers.
- `select` stores an array of option ids, including single-select fields.
- `relation` stores target record UUIDs. A single relation can be written as one UUID string; multiple relations use an array.
- `date` uses `YYYY-MM-DD` unless `includeTime` is enabled; date-time values must include a timezone.
- `duration` accepts seconds, `MM:SS`, or `HH:MM:SS` and stores integer seconds.
- `id`, formula, lookup, rollup, audit, and timestamp fields must not be sent in record writes.

Create a field only after inspecting its type:

```bash
cld grids fields create Authors \
  --name Email \
  --type text \
  --config '{"regex":"^[^@]+@[^@]+$"}' \
  --json
```

Field commands are `fields types|type|list|get|create|update|delete|restore|dependents|reorder`. Run `fields dependents` before deleting a field referenced by formulas, relations, views, or other configuration.

### Record payloads and versions

`records shape` returns writable field UUIDs, types, and example values for one table. Create and update bodies are plain objects keyed by those UUIDs.

```bash
cld grids records shape Authors --json
cld grids records create Authors --body '{"<field-uuid>":"Octavia Butler"}' --json
cld grids records update Authors <record-uuid> \
  --if-version 3 \
  --body-file record-update.json \
  --json
```

Use `--if-version` for optimistic concurrency when updating a previously read record. `records import` accepts an array or `{ "items": [...] }` and creates the batch in one transaction.

Read and transfer records with:

```bash
cld grids records list Authors --q Butler --limit 100 --json
cld grids records export Authors --format csv --out authors.csv
cld grids records audit Authors <record-uuid> --json
```

Record commands are `records shape|list|query|get|create|import|export|update|delete|restore|audit`.

### Files and snapshots

File fields use dedicated blob commands:

```bash
cld grids records files upload Assets <record-uuid> Photo --file image.png --json
cld grids records files list Assets <record-uuid> Photo --json
cld grids records files download Assets <record-uuid> Photo <file-uuid> --out image.png
cld grids records files delete Assets <record-uuid> Photo <file-uuid> --yes
```

Manual recursive record snapshots use `snapshots list|create|get`:

```bash
cld grids snapshots create Assets <record-uuid> --json
cld grids snapshots list Assets <record-uuid> --json
```

## Query data with GQL

GQL is a line-oriented query language compiled and executed by the Grids backend. Read its live grammar before authoring a query:

```bash
cld grids gql reference
cld grids gql context --out context.md
cld grids gql skill --out SKILL.md
```

`gql context` is permission-safe and base-specific. It contains only schema the current user may discover. Use it together with the downloaded skill when another agent must author GQL.

```gql
from table Authors
select Name, "Birth year"
sort "Birth year" desc
limit 100
```

Run or validate queries with:

```bash
cld grids gql preview --query-file authors.gql --limit 100 --json
cld grids gql run --query-file authors.gql --limit 1000 --json
cld grids gql compile-view --query-file authors.gql --json
```

`gql preview` caps `--limit` at 500; `gql run` caps it at 10,000. Both execute with current permissions. `gql compile-view` canonicalizes valid source and returns diagnostics with a nonzero exit status for invalid source. `gql autocomplete` accepts a UTF-16 `--caret` offset and returns permission-safe completion items.

Use exact source and field names when unambiguous, quote names containing spaces, and use `{uuid}` references where renames must not break saved automation.

Formula fields, GQL predicates, computed columns, and parts of document and workflow authoring share the formula engine:

```bash
cld grids formulas reference
cld grids formulas check Authors --expression 'LEN(Name)' --json
```

The GQL command set is `gql reference|run|preview|compile-view|autocomplete|skill|context`. Formula commands are `formulas reference|check`.

## Create views, forms, and dashboards

### Views

Views save GQL source and presentation settings for one table.

```json
{
  "name": "Recent authors",
  "source": "from table Authors\nlimit 100",
  "shared": true
}
```

```bash
cld grids views create Authors --body-file recent-authors-view.json --json
cld grids views list Authors --json
```

Commands are `views list|get|create|update|delete|restore`. Create accepts `--shared`; update accepts `--shared` or `--personal`.

### Forms

Form configuration uses field UUIDs. Inspect `fields list` and `records shape` first.

```bash
cld grids forms create Orders \
  --name Checkout \
  --config '{"fields":[{"kind":"user_input","fieldId":"<field-uuid>"}]}' \
  --json
cld grids forms submit Orders Checkout --body-file submission.json --json
```

Commands are `forms list|default|get|create|update|delete|restore|submit`. `--public` creates or retains a public submit token; `--private` removes it. Public form links allow form submission, not unrestricted table access.

### Dashboards

Dashboard config is a `{ "rows": [...] }` object. Widgets reference saved resources by UUID.

```bash
cld grids dashboards create \
  --name Overview \
  --shared \
  --config '{"rows":[]}' \
  --json
```

Commands are `dashboards list|get|create|update|delete|restore` and `dashboards widgets resolve|run|scan`. Use `widgets resolve` to inspect one configured widget, `widgets run` for a workflow-button widget, and `widgets scan --code <value>` for its scanner flow.

## Generate documents

Document templates combine GQL source, Liquid HTML, optional header/footer HTML, and page CSS. Read the runtime reference before creating one:

```bash
cld grids document-templates reference
cld grids document-templates create Invoices --body-file invoice-template.json --json
cld grids document-templates preview-draft-pdf Invoices \
  --body-file invoice-template.json \
  --record <record-uuid> \
  --out preview.pdf
```

Template commands are:

- `document-templates reference|list|get|create|update|delete`
- `document-templates preview-data|preview-pdf`
- `document-templates preview-draft-data|preview-draft-pdf`

Saved-template previews use the stored template. Draft previews accept unsaved source, HTML, header, footer, CSS, number, and filename values; passing a saved template uses it as defaults before applying draft overrides.

Generate and manage immutable document output from a selected record:

```bash
cld grids documents generate Invoices Invoice \
  --record <record-uuid> \
  --tag issued \
  --out invoice.pdf \
  --json
cld grids documents by-record Invoices <record-uuid> --json
```

Document commands are `documents list|browse|by-record|generate|update|download`. `documents browse --mode folders --path 2026/07` traverses generated documents by year and month. Search matches filenames, numbers, or tags; tag filters are repeatable.

Public document links are bearer links. Create only the lifetime the user needs and revoke them when no longer required:

```bash
cld grids documents links create <document-run-uuid> --expires-in 30d --comment "Customer copy" --json
cld grids documents links list <document-run-uuid> --json
cld grids documents links revoke <link-uuid> --json
```

Supported lifetimes are `1d`, `7d`, `30d`, and `90d`; the default is `30d`.

## Manage access

Grids access grants are attached to one resource. The backend combines direct grants with inherited access when a command runs.

```bash
cld grids access reference
cld grids access search-principals ada --json
cld grids access list table Bookshop Authors --json
cld grids access set table Bookshop Authors \
  --user ada@example.test \
  --permission write \
  --json
```

Supported resource references are:

- `base <base>`: `read`, `write`, `admin`, or `none`.
- `table <base> <table>`: `read`, `write`, or `none`.
- `view <base> <table> <view>`: `read`, `admin`, or `none`.
- `form <base> <table> <form>`: `write` or `none`.
- `dashboard <base> <dashboard>`: `read` or `none`.
- `document-template <base> <table> <template>`: `read`, `write`, `admin`, or `none`.
- `workflow <base> <workflow>`: `read`, `write`, `admin`, or `none`.

Choose exactly one principal with `--user`, `--group`, `--service-account`, `--authenticated`, or `--public`. `access grant` creates a direct grant. `access set` updates or creates it. `access revoke` requires `--yes` and either a principal or `--access-id`.

## Build and operate workflows

Workflow YAML stores `inputs`, optional `triggers`, and `steps`; name and description are normal workflow fields outside YAML. Read the live manifest before authoring source because it contains the exact input, trigger, action, control-flow, launcher, limit, and value-expression contracts:

```bash
cld grids workflows reference --json
```

The shipped inputs are `record`, `recordList`, `text`, `number`, `boolean`, `date`, `dateTime`, and `select`. Triggers are `schedule` and `recordEvent`. Actions are `updateRecord`, `createRecord`, `generateDocument`, `createDocumentLink`, `sendEmail`, `httpRequest`, `setVariable`, `fail`, and `succeed`. Control flow supports `if/then/else`, `switch/cases/default`, and `forEach/as/do`.

A minimal manually invoked workflow is:

```yaml
inputs:
  item:
    type: record
    table: Items
    required: true
steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Checked
```

Validate before saving:

```bash
cld grids workflows validate --source-file check-in.yml --json
cld grids workflows create \
  --name "Check in" \
  --source-file check-in.yml \
  --enabled \
  --json
```

`workflows autocomplete` returns permission-safe YAML completions for a UTF-16 caret offset. Workflow CRUD commands are `workflows list|get|create|update|delete`; deletion requires `--yes`.

### Invoke and inspect runs

Direct CLI invocation requires a stable idempotency key. Reuse a key only for the same logical invocation.

```bash
cld grids workflows invoke "Check in" \
  --inputs '{"item":"<record-uuid>"}' \
  --idempotency-key check-in-2026-07-15-001 \
  --json

cld grids workflows invoke "Check in" \
  --mode dryRun \
  --inputs-file inputs.json \
  --idempotency-key check-in-preview-001 \
  --expected-revision 3 \
  --json
```

`--expected-revision` rejects an invocation when a different workflow revision is active. A dry run reports supported effects without committing them; consult the run result because actions declare different dry-run support in `workflows reference`.

Inspect execution with:

```bash
cld grids workflow-runs list --workflow "Check in" --status failed --json
cld grids workflow-runs get <run-uuid> --json
cld grids workflow-runs steps <run-uuid> --json
cld grids workflow-runs documents <run-uuid> --json
cld grids workflow-emails list --workflow "Check in" --json
```

Run commands are `workflow-runs list|get|steps|documents|download-documents`. Email delivery history uses `workflow-emails list`.

### Launchers and email templates

Launchers expose a workflow as a scanner, bulk, or dashboard interaction. Their JSON shapes and invocation bodies are part of `workflows reference`.

```bash
cld grids workflow-launchers create "Check in" --body-file scanner-launcher.json --json
cld grids workflow-launchers invoke "Check in" Scanner --body-file scan.json --json
```

Commands are `workflow-launchers list|create|update|delete|invoke`. Launcher deletion requires `--yes`.

Workflow emails render a Liquid subject and HTML body. There is no plain-text template field.

```bash
cld grids email-templates reference
cld grids email-templates create \
  --name Reminder \
  --subject 'Reminder: {{ data.itemName }}' \
  --html '<p>{{ data.itemName }}</p>' \
  --enabled \
  --json
```

Email-template commands are `email-templates reference|list|get|create|update|delete`.

## Command index

Use `cld grids <command> --help` for every flag, positional form, constraint, and built-in example.

```text
list, use, current
bases list|get|create|update|delete|restore
access reference|list|grant|set|revoke|search-principals
tables list|get|create|update|delete|restore
fields types|type|list|get|create|update|delete|restore|dependents|reorder
records shape|list|query|get|create|import|export|update|delete|restore|audit
records files list|upload|download|delete
snapshots list|create|get
gql reference|run|preview|compile-view|autocomplete|skill|context
formulas reference|check
views list|get|create|update|delete|restore
forms list|default|get|create|update|delete|restore|submit
dashboards list|get|create|update|delete|restore
dashboards widgets resolve|run|scan
document-templates reference|list|get|create|update|delete
document-templates preview-data|preview-pdf|preview-draft-data|preview-draft-pdf
documents list|browse|by-record|generate|update|download
documents links list|create|revoke
email-templates reference|list|get|create|update|delete
workflows reference|list|get|create|update|delete|validate|autocomplete|invoke
workflow-launchers list|create|update|delete|invoke
workflow-runs list|get|steps|documents|download-documents
workflow-emails list
```
