---
id: grids-custom-app-yaml-cli
title: Custom App YAML & CLI
icon: ti ti-terminal-2
description: Validate, plan, apply, export, and publish the canonical app definition.
order: 136
---
<!-- Unreleased contract: register this article only with the complete Custom Apps vertical slice. -->

The visual builder and CLI read and write the same typed Custom App definition. YAML is its lossless human-readable serialization. It composes existing Grids resources; it does not duplicate table, form, view, workflow, template, or permission definitions.

## Build resources before the app {icon="building-factory-2"}

A complete solution still has one owner for each concern. Use the existing `cld grids` commands to create or update the base, tables, fields, views, forms, document templates, workflow launchers, and access bindings. Read those resources back with `--json` and use their canonical IDs in the Custom App definition.

The deterministic agent sequence is:

1. inspect the current base and the installed Grids references;
2. create or update the required resources through their existing commands;
3. configure and verify resource grants and row scopes;
4. write the app-only YAML with the returned canonical IDs;
5. validate, plan, and apply the app draft;
6. preview the complete journey as its intended audiences;
7. publish only after the plan and preview pass.

Custom App YAML is deliberately not a whole-base bundle. A second table, workflow, or permission schema would duplicate existing APIs, create conflicting owners, and make partial updates harder to reason about. An agent may keep several ordinary input files beside the app YAML, but it applies each file through the command that owns that resource.

## Start from the machine reference {icon="book-2"}

Ask the CLI for the installed schema and supported block contracts:

```bash
cld grids apps reference --json
```

Agents should read this reference before generating a definition. The server remains authoritative for the installed schema version, accessible resources, field types, and launcher inputs.

## Use one strict root document {icon="file-code"}

Every definition has this shape:

```yaml
schemaVersion: 1
kind: grids.custom-app
id: 10000000-0000-4000-8000-000000000101
baseId: 10000000-0000-4000-8000-000000000001
shortId: a1b2c3
name: Certificate requests
icon: certificate
startPageId: apply
pages: []
```

| Key | Contract |
| --- | --- |
| `schemaVersion` | Required integer. Unsupported versions fail validation. |
| `kind` | Must be `grids.custom-app`. |
| `id` | Required UUID. Supplying it makes create/apply idempotent. |
| `baseId` | Required UUID of the one owning base. It cannot be changed later. |
| `shortId` | Omit on first apply. Grids assigns it; exported values are immutable. |
| `name` | Required visible name. |
| `icon` | Optional supported icon name. |
| `headerImageFileId` | Optional Cloud file UUID used as a restrained header image. |
| `startPageId` | Required local ID of an existing page. |
| `pages` | At least one page. |

Unknown keys, duplicate IDs, aliases, custom YAML tags, invalid UUIDs, and implicit type coercion fail validation.

## Define pages and layout {icon="layout-grid"}

```yaml
pages:
  - id: request
    title: Request detail
    navigation:
      visible: false
      order: 30
    parameters:
      request_id:
        type: record
        tableId: 10000000-0000-4000-8000-000000000201
        required: true
    record:
      tableId: 10000000-0000-4000-8000-000000000201
      id: { source: PARAMS, path: request_id }
    rows:
      - id: body
        columns:
          - id: main
            span: 8
            blocks: []
          - id: context
            span: 4
            blocks: []
```

Local IDs use lowercase letters, numbers, and hyphens. Column spans are integers from 1 to 12 and may not exceed 12 within one row.

## Bind typed values {icon="brackets"}

Bindings are discriminated values:

```yaml
# A constant
{ source: LITERAL, value: Submitted }

# A declared page parameter
{ source: PARAMS, path: list_id }

# The authorized page record
{ source: RECORD, path: fields.10000000-0000-4000-8000-000000000301 }

# The current Records result row
{ source: ROW, path: id }

# The operation that just succeeded
{ source: RESULT, path: recordId }
```

Each property declares which sources and target type it accepts. Validation resolves referenced resource schemas and rejects incompatible bindings before apply or publish.

## Define blocks {icon="blocks"}

All blocks require a local `id` and `type`. Optional `title`, `emptyText`, and `visibleWhen` use the shared block contract.

```yaml
# Guidance
- id: intro
  type: markdown
  markdown: |
    ## Request a certificate
    Tell us what the certificate should cover.

# Existing saved view
- id: requests
  type: records
  source:
    kind: view
    viewId: 10000000-0000-4000-8000-000000000401
  display:
    kind: table
    columnIds:
      - 10000000-0000-4000-8000-000000000301
  rowNavigate:
    kind: navigate
    pageId: request
    history: push
    params:
      request_id: { source: ROW, path: id }

# Bounded inline query
- id: totals
  type: metrics
  source:
    kind: gql
    query: |
      from table "Certificate requests"
      aggregate count(*) as requests
    maxRows: 10

# Existing form with server-fixed context
- id: request-form
  type: form
  formId: 10000000-0000-4000-8000-000000000501
  fixedValues: {}
  onSuccess:
    kind: navigate
    pageId: request
    history: replace
    params:
      request_id: { source: RESULT, path: recordId }

# Current page record, documents, and permitted direct edits
- id: request
  type: record
  fieldIds:
    - 10000000-0000-4000-8000-000000000301
  editableFieldIds: []
  documents:
    templateIds:
      - 10000000-0000-4000-8000-000000000601
    emptyText: Your certificate will appear here after approval.

# Comments on the current page record
- id: discussion
  type: comments

# Navigation and enabled workflow launchers
- id: actions
  type: actions
  actions:
    - id: approve
      label: Approve and generate
      icon: certificate
      kind: workflow
      launcherId: 10000000-0000-4000-8000-000000000701
      inputs:
        request_id: { source: RECORD, path: id }
```

Metrics and Chart share the Records source contract. Chart additionally declares its chart kind and category/value output IDs. Refer to `apps reference --json` for the exact installed variants.

An inline GQL source may declare typed `inputs`. Its query reads them through `param('name')`; every referenced parameter must have exactly one binding and unused inputs fail validation. Parameter values are passed separately from query text and are never interpolated into it.

A Records block may also declare `rowActions`. These use the same navigate and workflow contracts as an Actions block, with `ROW` scoped to the selected result. A form may override its visible submit label with `submitLabel`; validation and submission behavior remain owned by the referenced Form.

Simple presentation conditions are lists of ANDed comparisons:

```yaml
visibleWhen:
  - left: { source: RECORD, path: fields.10000000-0000-4000-8000-000000000302 }
    operator: in
    right: { source: LITERAL, value: [Submitted, In review] }
```

Supported operators are `eq`, `notEq`, `in`, `isEmpty`, and `isNotEmpty`. Conditions never grant access or replace workflow preconditions.

## Validate and plan {icon="list-check"}

```bash
cld grids apps validate --source-file certificate-app.yaml --json
cld grids apps plan --source-file certificate-app.yaml --json
```

`validate` checks schema, IDs, references, types, query bounds, navigation, and block invariants without writing. `plan` runs the same compiler and also compares the definition with the saved draft. Its deterministic output contains additions, changes, removals, warnings, and the derived publication capabilities.

A missing or inaccessible resource is an error, not a guessed name match. Plans never publish or invoke app operations.

Diagnostics use stable definition paths such as `pages[request].rows[detail].columns[request].blocks[actions].actions[approve].launcherId`. Fix the first owning path, validate again, and only then review the new plan. Agents must not suppress an error by removing an access-sensitive block or weakening its resource scope unless the builder explicitly requested that product change.

## Apply without publishing {icon="database-import"}

```bash
cld grids apps apply --source-file certificate-app.yaml --json
```

`apply` creates or updates the draft identified by the supplied app UUID. Applying the same canonical definition again reports no changes and does not create another app. It never changes the published snapshot.

The command runs as the signed-in Cloud account and requires base-administrator access. It cannot grant itself app or resource permissions.

## Export and review {icon="file-export"}

```bash
cld grids apps export 10000000-0000-4000-8000-000000000101 \
  --output certificate-app.yaml
```

Export emits canonical key ordering, canonical resource IDs, the assigned `shortId`, and no secrets. A visual-builder edit followed by export must retain the same semantics as a CLI edit followed by apply.

## Publish {icon="rocket"}

```bash
cld grids apps publish 10000000-0000-4000-8000-000000000101 --yes --json
```

Publish reruns preflight and replaces the published snapshot only when it succeeds. It is an explicit state change and requires `--yes` in non-interactive use.

The first-release command surface is:

```text
apps reference|list|get|validate|plan|apply|export|publish
```

Use [Publish & permissions](/app/grids/help/grids-publish-custom-app) to review the access boundary before an agent publishes an app.
