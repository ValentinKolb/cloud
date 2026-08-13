---
id: grids-custom-apps
title: Grids Apps
icon: ti ti-app-window
description: Publish focused apps from Forms, bounded records, and record details.
order: 137
---
Grids Apps give authenticated or public audiences a focused app at `/apps/<shortId>` without exposing the full Grids workspace. Each app belongs to one Base and uses selected records, Views, Forms, documents, and actions from that Base. Definitions are portable YAML that you can validate, review, and publish with the Cloud CLI.

Grids Apps do not copy data. A publication stores an immutable definition and a compiled capability snapshot containing the exact resources it may use. Every request checks the app grant, published capability, and server-enforced availability rules. App readers do not need Base access, and app access never grants raw Grids or arbitrary GQL access.

## Pages and blocks {icon="layout"}

An app may contain up to 12 responsive pages. Set `startPageId` to the page shown at `/apps/<shortId>`. Pages with `navigation.visible: true` appear in the AppWorkspace sidebar in `order`, with an optional Tabler `icon`. If the current page has no other available page and the app has no available global action, the sidebar is omitted.

The optional root `sidebar.actions` list adds app-global launchers that are independent from every page:

- a **Form** opens in a large dialog and may be available to public app readers;
- a **Workflow** runs directly from the sidebar and requires a signed-in reader.

Global launchers deliberately receive no page, route, record, or selected-row values. Their fixed Form values and Workflow inputs are `LITERAL` values. Their `availableWhen` GQL may use `@auth.*`, `@app.*`, `@base.*`, and `@time.*`; `@page.*` and `@params.*` fail validation. The server rechecks the exact published Form or Workflow capability and availability immediately before execution.

A column may contain:

- **Markdown**, for headings, instructions, links, and request-context placeholders;
- **Form**, for creating a record with one existing active Grids Form;
- **Records**, for up to 100 rows from a saved view or bounded GQL; saved views use an explicit field allowlist, while GQL displays its selected result columns;
- **Metrics**, for named scalar aggregates from a saved view or bounded GQL;
- **Chart**, for grouped aggregate results rendered as a supported chart;
- **Record**, for an explicit field allowlist from the current detail record;
- **Comments**, for a signed-in app reader's discussion on the current detail record.
- **Actions**, for internal navigation or an exact published workflow launcher;
- **Scanner**, for a signed-in camera or manual-code workflow surface backed by one exact Scanner run option.

Record detail pages are route-only. They declare one required `record` parameter, bind it as the page record, and set `navigation.visible: false`. A Records block may map its row id to that parameter with `rowNavigate`. Grids then builds the URL and authorizes the record when the detail page opens.

A route-only page may also declare a Record parameter without loading it as the page record. This is useful when bounded Records GQL or a Form needs parent context, such as one description list while several related articles are entered.

Scripts, custom HTML and CSS, arbitrary URLs, and direct record mutations are not supported. Actions compose internal navigation and existing validated workflow launchers instead.

## Build a list and detail app {icon="terminal-2"}

You need **Admin** access to the app's base. Start with UUIDs for the base, saved view, table, and fields you want to display.

```yaml
schemaVersion: 3
kind: grids.custom-app
id: 00000000-0000-4000-8000-000000000001
baseId: 00000000-0000-4000-8000-000000000002
name: Request overview
icon: app-window
startPageId: home
sidebar:
  actions:
    - id: create-request
      kind: form
      label: New request
      icon: plus
      tone: success
      formId: 00000000-0000-4000-8000-000000000006
      fixedValues: {}
pages:
  - id: home
    title: My requests
    navigation:
      visible: true
      order: 10
    rows:
      - id: content
        columns:
          - id: main
            span: 12
            blocks:
              - id: intro
                type: markdown
                markdown: "# My requests"
              - id: apply
                type: form
                title: New request
                formId: 00000000-0000-4000-8000-000000000006
                fixedValues: {}
                onSuccessNavigate:
                  kind: navigate
                  pageId: request
                  params:
                    request_id:
                      source: RESULT
                      path: recordId
              - id: requests
                type: records
                searchable: true
                pageSize: 25
                title: Recent requests
                source:
                  kind: view
                  viewId: 00000000-0000-4000-8000-000000000003
                display:
                  kind: table
                  columnIds:
                    - 00000000-0000-4000-8000-000000000004
                rowNavigate:
                  kind: navigate
                  pageId: request
                  history: push
                  params:
                    request_id:
                      source: ROW
                      path: id
  - id: request
    title: Request detail
    navigation:
      visible: false
      order: 20
    parameters:
      request_id:
        type: record
        tableId: 00000000-0000-4000-8000-000000000005
        required: true
    record:
      tableId: 00000000-0000-4000-8000-000000000005
      id:
        source: PARAMS
        path: request_id
    rows:
      - id: detail
        columns:
          - id: main
            span: 12
            blocks:
              - id: request-details
                type: record
                title: Request
                fieldIds:
                  - 00000000-0000-4000-8000-000000000004
                editableFieldIds:
                  - 00000000-0000-4000-8000-000000000004
                documents:
                  templateIds:
                    - 00000000-0000-4000-8000-000000000007
```

The Form, saved view, and `request_id` parameter must use the same records table. After a successful submit, Grids replaces the current URL with the new record's detail page. Clicking an existing row opens the same detail page.

The Record block may also list existing PDFs generated for that record by exact template ID. Generation remains a Workflow responsibility; the block offers downloads only when the published app capability includes that template and the current app grant is valid.

A Form block may hide user inputs and supply them with the same typed binding model as workflow inputs. `LITERAL` values are validated against the live field type. Compatible relation inputs may use a declared Record parameter or the current page record. The server resolves every value again and rejects browser attempts to override it:

```yaml
fixedValues:
  00000000-0000-4000-8000-000000000007:
    source: PARAMS
    path: parent_id
```

`fixedValues` accepts `LITERAL`, compatible `PARAMS`, and compatible `RECORD.id` bindings. Success navigation accepts declared `PARAMS` plus the submitted Form's `RESULT.recordId`; it always stays inside the same Grids App and uses replace navigation.

Pages, blocks, and actions may use one optional `availableWhen.query`. The server runs this bounded GQL with the same implicit context as the page. At least one returned row means available; an empty result, invalid query, missing context, timeout, or cancellation means unavailable. Unavailable resources are omitted and cannot be called directly.

Grids App GQL receives `@auth.id`, `@auth.name`, `@auth.username`, `@auth.email`, declared `@params.<name>`, `@page.*`, `@app.*`, `@base.*`, and `@time.*` automatically. Anonymous visitors receive `null` for every `@auth.*` value. Values are bound separately from query text; there is no per-source inputs map or `param()` helper.

Markdown blocks use the same context names as safe text placeholders. Type `@` or choose **Add placeholder**, for example `Hello @auth.name`. Grids replaces known placeholders on the server before rendering the sanitized Markdown; anonymous `@auth.*` values become empty text. Markdown placeholders do not add Liquid conditions, loops, or executable template code.

Inspect the current contract, then validate and plan the file:

```bash
cld grids apps reference
cld grids apps validate MyBase --source-file requests.yaml
cld grids apps plan MyBase --source-file requests.yaml
```

For a blank Home draft equivalent to the visual starter, run `cld grids apps create MyBase --name "Request overview"`. Advanced authors can apply a complete definition directly.

Apply the definition. This updates only the draft:

```bash
cld grids apps apply MyBase --source-file requests.yaml
```

On first apply, Grids assigns the app's stable five-character `shortId`. You may keep `shortId` out of the source file; later applies preserve the assigned value. Use `apps export` for a normalized definition that includes it.

## Build visually {icon="apps"}

Base administrators can turn on **Edit mode** and create an app with **New app** under **Apps**. The Pages column creates and selects pages; each page and the active app have their own settings action. **Add block** supports Markdown, Records, Metrics, Charts, Forms, page Records, Comments, Actions, and Scanner. Records, Metrics, and Charts can use an accessible saved View or inline GQL. Scanner appears after an enabled Scanner run option has a ready workflow revision.

The inspector keeps the common path short. Required identity, page, source, and block fields stay visible. Access, availability, route parameters, appearance, ordering, documents, and danger controls use expandable sections. Optional availability shows **Always** until you add a server-enforced GQL rule. Inline GQL and Markdown can each be opened in a larger editor without creating a second draft or a separate Save step; autocomplete continues to offer only the selected page's valid `@auth`, `@params`, `@page`, `@app`, `@base`, and `@time` context.

Route parameters are required Record IDs, each with one parameter ID and Record table. Adding a Record block binds the page to its single compatible route parameter, hides the page from navigation, and makes that same record available to Record and Comments blocks; there is no second Page Record setting. Renaming a parameter updates its typed Form, navigation, workflow, row-action, and exact `@params.<name>` GQL references. Page IDs are editable and their navigation references update with them. Records rows can link to compatible route pages or run plural row workflows; Forms can receive typed server-trusted values and navigate after creation; Record blocks can choose writable fields and document templates.

For a saved-View Records block, choose a table field selection or reuse the View's existing Cards configuration. Cards keep the View's configured fields and file cover, require row navigation, and are pinned at publication. A GQL Records source displays exactly the ordinary-record columns returned by its query, including aliases, so it needs no second Columns selection. Use Metrics or Chart for aggregate results.

An Actions block shows a compact list. Open one action to edit its icon, target, history, typed parameter mappings, workflow launcher, input sources, confirmation, availability, and order. Workflow actions list only active Grids App launchers whose validated workflow revision is available in the current Base.

A Records block has a separate **Row actions** section. Each action selects its launcher, label, optional icon, label visibility, typed inputs, confirmation, availability, and order. `ROW.id` appears only here and only for a compatible record input. The runtime verifies the selected ID is still present in the exact published Records query before invoking the workflow.

Table Records blocks also have **Bulk actions**. Each action selects an existing Bulk run option whose record-list input belongs to the source table. Readers may select at most the current result page; page or search changes clear the selection. Invocation reruns the published source with the same search and cursor before starting the workflow.

The builder saves every structurally complete change automatically. A notice appears while the draft differs from the live version or still needs attention. **Publish changes** validates and publishes the latest saved draft; **Restore live version** discards the pending draft and copies the current live snapshot back into it. The external-link icon opens the live snapshot. Saved View and parameter-free GQL previews are resolved on the server, and the canvas keeps unchanged blocks mounted while a neighboring block is edited. Under **App settings**, the collapsed **Danger zone** can unpublish the live snapshot while keeping the draft and grants, or delete the app without deleting Base data. Both actions require a destructive confirmation.

## Grant access and publish {icon="lock"}

Grant the intended principal access to the app. The published capability snapshot supplies its data and operations; do not grant the audience raw Base access unless they also need the full Grids workspace.

```bash
cld grids access grant app MyBase "Request overview" --group "Request team" --permission read
cld grids access grant app MyBase "Public catalog" --public --permission read
```

Grids App grants support users, groups, all authenticated accounts, and the public. They do not support service accounts; delegated credentials use their user identity. A public grant includes anonymous visitors. The detail page returns **Not Found** for a missing, deleted, invalid, unavailable, or unauthorized record id. Arbitrary Workflow actions require an authenticated account even when the app itself is public.

Publish the validated draft:

```bash
cld grids apps publish MyBase "Request overview" --yes
```

Applying another draft does not change the live app until you publish again.

Restore replaces pending draft changes with the live definition. Unpublish removes only the live snapshot and keeps the draft. Delete removes the app and its route. These commands require an explicit confirmation:

```bash
cld grids apps restore MyBase "Request overview" --yes
cld grids apps unpublish MyBase "Request overview" --yes
cld grids apps delete MyBase "Request overview" --yes
```

## Keep publication predictable {icon="versions"}

`validate` checks the strict definition, implicit context references, availability queries, and every referenced Base, table, View, Form, field, template, and Workflow launcher. It verifies table compatibility for row navigation, Form results, and fixed relation values. Unknown properties are rejected. `plan` reports `create`, `update`, `noop`, or `invalid` without saving. `apply` writes the draft, and `publish` atomically replaces the published definition and capability snapshot with the current valid draft.

```bash
cld grids apps list MyBase
cld grids apps get MyBase "Request overview"
cld grids apps export MyBase "Request overview" --out requests.yaml
cld grids apps export MyBase "Request overview" --published --out requests-live.yaml
```

:::note Only the active page is resolved
Opening one page resolves only the blocks on that page and loads only its optional page record. Hidden detail pages are not prefetched. This keeps large apps predictable without weakening current access checks.
:::
