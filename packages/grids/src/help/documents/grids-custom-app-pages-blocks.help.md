---
id: grids-custom-app-pages-blocks
title: Custom App pages & blocks
icon: ti ti-layout-grid
description: Compose responsive pages from typed, resource-backed blocks.
order: 134
---
<!-- Unreleased contract: register this article only with the complete Custom Apps vertical slice. -->

A Custom App is a small composition of existing Grids resources. Its page tree controls layout and navigation; its blocks control which resources appear and which already-defined operations a person may start.

## Use stable definition IDs {icon="id"}

Apps, pages, rows, columns, blocks, and actions have stable IDs. Labels may change without breaking links or state.

- The app ID is a UUID supplied when the app is first created.
- Grids assigns one immutable `shortId` for the standalone route.
- Page, row, column, block, and action IDs are lowercase local identifiers unique inside their parent.
- Resource references use canonical Grids UUIDs, never display names.

A page route is `/apps/<shortId>/<pageId>`. Declared page parameters are query parameters, for example `/apps/a1b2c3/request?request_id=<record-id>`.

App identity is intentionally restrained: a name, supported icon, and optional Cloud file as a header image. Pages and blocks use standard Cloud typography, spacing, colors, and interaction patterns. Custom CSS and arbitrary branding are not part of the definition.

## Declare page context {icon="brackets"}

A page declares every URL parameter before a block can use it. Supported parameter types are String, Number, Boolean, Date, Date time, and Record. A Record parameter also declares its table.

A page may load one **page record** from a Record parameter. The load is permission-checked and fail-closed. An invalid, missing, deleted, or inaccessible record shows the page's standard unavailable state without disclosing which case occurred.

Implemented blocks bind contextual record values through a typed reference:

```yaml
source: PARAMS
path: request_id
```

| Source | Available in | Example path |
| --- | --- | --- |
| `PARAMS` | Current page | `request_id` |
| `RECORD` | Current page record | `id` |
| `ROW` | One Records row link or row action | `id` or `fields.<outputId>` |
| `RESULT` | Form success navigation | `recordId` |

The builder shows only references valid in the current location. YAML validation applies the same scope and type rules. References cannot read arbitrary URL values, another block's internal state, or undeclared data.

## Build responsive rows and columns {icon="columns"}

Each page contains rows; each row contains columns; each column contains blocks. A column span is an integer from 1 to 12. Columns keep their order and stack to full width when the available space is too narrow.

Use the simplest layout that preserves task order:

- 12 for one primary task;
- 8 + 4 for main content and supporting context;
- 6 + 6 for two peers;
- several small columns for compact metrics.

Do not encode separate desktop and mobile layouts. The preview exposes desktop and narrow widths so the same definition can be checked before publication.

## Configure resource-backed blocks {icon="blocks"}

### Markdown

Markdown renders headings, lists, links, and safe images. It does not run HTML, scripts, styles, or embedded application code. Use it for guidance and identity, not business state.

### Records

Records reads either an existing saved view or a bounded inline GQL query. It supports table and card presentation, explicit fields, empty copy, and a row navigation or row action.

Inline GQL has a required maximum row count. The runtime also applies shared query budgets. Search, filter, sort, and pagination state is namespaced by the block ID in the URL, so two Records blocks cannot overwrite each other's state.

An inline query may declare typed inputs and read them with GQL's `param('name')` helper. Values are bound separately from query text. Every helper call needs one declared input, and unused inputs are rejected. This provides bounded parameterized reads without string interpolation.

Use `ROW` only while defining that block's row link or row action. Row actions use the same navigation and enabled-workflow contracts as an Actions block.

### Metrics and Chart

Metrics and Chart read either an existing saved view or an inline GQL query. Inline GQL requires `maxRows` between 1 and 100; the runtime also applies shared query budgets.

Metrics accepts an ungrouped aggregate query and renders up to 12 named scalar results. Chart accepts a grouped aggregate query and renders a donut, bar, line, sparkline, or scatter chart. Scatter requires two aggregate value series; the other chart types require one. A Chart block may render at most 100 groups through its `limit`.

The block never grants access to its source. Publication records the referenced tables, and every request still passes through ordinary Grids query and record permissions. Republish the app after changing a saved view's source.

### Form

Form references one existing Grids form. The form owns visible fields, validation, required inputs, defaults, and record creation.

The block may supply **fixed values** from a declared Record `PARAMS` value. The target must be a user-input relation field for the same table. A fixed value is resolved by the server, omitted from the rendered inputs, and cannot be overridden by the browser. This supports flows such as “add another article to this list” without asking for the same relation again.

After success, the block may stay on the page or replace-navigate inside the same app. Navigation parameters may preserve declared `PARAMS` values or use the created Form record's `RESULT.recordId`.

One app may publish up to 24 Form blocks. Each referenced Form may expose up to 100 inputs, of which up to 30 may be fixed by page parameters.

### Record

Record requires a page record. It renders the explicit `fieldIds` list and may allow direct editing through an explicit `editableFieldIds` subset. Every editable field must also be displayed and must be a writable stored field; computed and system fields fail publication.

The Edit action appears only when the account can write the current record under its table permission and row scope. Submission rechecks that access, the immutable published field allowlist, the live field type, table audit questions, and the current record version. Fields outside the block's editable subset remain read-only even when the account has broader table access.

An optional `documents.templateIds` allowlist shows existing generated PDFs linked to the current record. Every template must belong to the page record table when the app is published. At runtime, Grids also requires ordinary Read access to each live template and uses the protected document download route. The block does not generate documents or create public links; use a Workflow for generation.

### Comments

Comments requires a page record. It loads a bounded first page only when the block is rendered, then fetches older comments with keyset pagination. Creating or changing a comment requires Write access to that record. Authors may edit and delete their own comments; record admins may moderate any comment. Deleted comments remain as a timestamped placeholder so the conversation order stays understandable.

Comments inherit record visibility. They do not introduce a separate audience or permission store.

### Actions

Actions contains buttons that either navigate inside the same Custom App or start an existing enabled Dashboard workflow launcher. A workflow action may bind JSON `LITERAL` values, declared Record `PARAMS`, or the current page `RECORD.id` to compatible workflow inputs. Fixed launchers use their stored bindings and do not accept action inputs.

The block cannot call arbitrary URLs, update records directly, or invoke a workflow that was not included in the published capability set.
Starting a workflow is asynchronous: the button reports whether the run was accepted, while the workflow owns its effects and their observable run state. Navigation after a workflow belongs in the workflow or a later page-state transition; Actions does not bind arbitrary workflow results.

The runtime revalidates the published app grant, exact page, block, action, launcher, workflow revision, page records, and workflow effect permissions. An action missing from the immutable publication capability set is omitted.

## Keep navigation explicit {icon="arrow-right"}

Navigation has a target page ID, history behavior, and a mapping for every target parameter:

```yaml
kind: navigate
pageId: request
history: push
params:
  request_id: { source: ROW, path: id }
```

Use `push` for normal movement and `replace` after a successful create operation. A navigation target is valid only when all required target parameters are supplied with compatible types.

For repeated entry, preserve the parent as a page parameter:

```text
/apps/<shortId>/add-article?list_id=<record-id>
```

The Form fixes its List relation from `PARAMS.list_id`. After success, one button navigates back to the same page with the same parameter; another navigates to the list detail. This needs no app-specific batch or wizard primitive.

## Use small presentation conditions {icon="adjustments"}

A block or action may declare a list of simple conditions. All conditions must match. Supported operators are Equals, Not equals, In, Is empty, and Is not empty over compatible scalar values.

Conditions may use `LITERAL`, `PARAMS`, or `RECORD`; row actions may also use `ROW`. They control visibility or enabled state only. They never replace permission checks, form validation, or workflow preconditions.

If a process needs complex branching, put that rule in a View, Form, or Workflow and expose the resulting resource or action.

## Design local states {icon="info-circle"}

Every data-backed block owns its local loading, empty, and recoverable error state. Standard denied and unavailable states are supplied by Grids and deliberately do not reveal whether a resource or record exists.

Customize empty copy only when it can tell the person what to do next. Do not replace a local empty state with a page-wide spinner or make unrelated blocks wait for one slow source.

Only the active page resolves. Within that request, identical authorized resource reads are deduplicated and every source remains bounded.

## Know the deliberate limits {icon="barrier-block"}

The first release has no app-global variables, general expression graph, reusable block definitions, arbitrary external fetch or action targets, cross-base resources, raw queries outside GQL, custom HTML, CSS, JavaScript, or domain-specific request, cart, batch, or loan blocks. Sanitized Markdown may still contain ordinary links.

Compose repeated flows from typed page parameters, fixed Form values, bounded sources, navigation, and existing Workflows. If those primitives cannot express a process safely, extend the owning Grids resource rather than adding application-specific behavior to the page runtime.

Continue with [Publish & permissions](/app/grids/help/grids-publish-custom-app) before making the app available to others.
