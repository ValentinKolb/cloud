---
id: grids-custom-apps
title: Custom Apps
icon: ti ti-app-window
description: Publish focused apps from Forms, bounded records, and record details.
order: 137
---
Custom Apps give authenticated or public audiences a focused app at `/apps/<shortId>` without exposing the full Grids workspace. Each app belongs to one Base and uses selected records, Views, Forms, documents, and actions from that Base. Definitions are portable YAML that you can validate, review, and publish with the Cloud CLI.

Custom Apps do not copy data. A publication stores an immutable definition and a compiled capability snapshot containing the exact resources it may use. Every request checks the app grant, published capability, and server-enforced availability rules. App readers do not need Base access, and app access never grants raw Grids or arbitrary GQL access.

## Pages and blocks {icon="layout"}

An app may contain up to 12 responsive pages. Set `startPageId` to the page shown at `/apps/<shortId>`. Pages with `navigation.visible: true` appear in the app navigation.

A column may contain:

- **Markdown**, for headings, instructions, and links;
- **Form**, for creating a record with one existing active Grids Form;
- **Records**, for up to 100 rows from a saved view or bounded GQL and an explicit field allowlist;
- **Metrics**, for named scalar aggregates from a saved view or bounded GQL;
- **Chart**, for grouped aggregate results rendered as a supported chart;
- **Record**, for an explicit field allowlist from the current detail record;
- **Comments**, for a signed-in app reader's discussion on the current detail record.
- **Actions**, for internal navigation or an exact published workflow launcher.

Record detail pages are route-only. They declare one required `record` parameter, bind it as the page record, and set `navigation.visible: false`. A Records block may map its row id to that parameter with `rowNavigate`. Grids then builds the URL and authorizes the record when the detail page opens.

A route-only page may also declare a Record parameter without loading it as the page record. This is useful when bounded Records GQL or a Form needs parent context, such as one description list while several related articles are entered.

Scripts, custom HTML and CSS, arbitrary URLs, and direct record mutations are not supported. Actions compose internal navigation and existing validated workflow launchers instead.

## Build a list and detail app {icon="terminal-2"}

You need **Admin** access to the app's base. Start with UUIDs for the base, saved view, table, and fields you want to display.

```yaml
schemaVersion: 2
kind: grids.custom-app
id: 00000000-0000-4000-8000-000000000001
baseId: 00000000-0000-4000-8000-000000000002
name: Request overview
icon: app-window
startPageId: home
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

A Form block may hide one of the Form's relation inputs and set it from a Record parameter declared by the current page. The server resolves this value and rejects browser attempts to override it:

```yaml
fixedValues:
  00000000-0000-4000-8000-000000000007:
    source: PARAMS
    path: parent_id
```

The fixed field must be a user-input relation field targeting the parameter's table. `fixedValues` accepts `PARAMS` only. Success navigation accepts declared `PARAMS` plus the submitted Form's `RESULT.recordId`; it always stays inside the same Custom App and uses replace navigation.

Pages, blocks, and actions may use one optional `availableWhen.query`. The server runs this bounded GQL with the same implicit context as the page. At least one returned row means available; an empty result, invalid query, missing context, timeout, or cancellation means unavailable. Unavailable resources are omitted and cannot be called directly.

Custom App GQL receives `@auth.id`, declared `@params.<name>`, `@page.*`, `@app.*`, `@base.*`, and `@time.*` automatically. Anonymous visitors receive `@auth.id = null`. Values are bound separately from query text; there is no per-source inputs map or `param()` helper.

Inspect the current contract, then validate and plan the file:

```bash
cld grids apps reference
cld grids apps validate MyBase --source-file requests.yaml
cld grids apps plan MyBase --source-file requests.yaml
```

Apply the definition. This updates only the draft:

```bash
cld grids apps apply MyBase --source-file requests.yaml
```

On first apply, Grids assigns the app's stable five-character `shortId`. You may keep `shortId` out of the source file; later applies preserve the assigned value. Use `apps export` for a normalized definition that includes it.

## Build visually {icon="apps"}

Base administrators can turn on **Edit mode** and create an app with **New app** under **Custom Apps**. The Pages column creates and selects pages; each page and the active app have their own settings action. **Add block** supports Markdown, Records, Metrics, Charts, Forms, page Records, Comments, and Actions. Records, Metrics, and Charts can use an accessible saved View or inline GQL.

The builder saves every structurally complete change automatically. A notice appears while the draft differs from the live version or still needs attention. **Publish changes** validates and publishes the latest saved draft; **Restore live version** discards the pending draft and copies the current live snapshot back into it. The external-link icon opens the live snapshot. Saved View and parameter-free GQL previews are resolved on the server, and the canvas keeps unchanged blocks mounted while a neighboring block is edited.

## Grant access and publish {icon="lock"}

Grant the intended principal access to the app. The published capability snapshot supplies its data and operations; do not grant the audience raw Base access unless they also need the full Grids workspace.

```bash
cld grids access grant custom-app MyBase "Request overview" --group "Request team" --permission read
cld grids access grant custom-app MyBase "Public catalog" --public --permission read
```

Custom App grants support users, groups, all authenticated accounts, and the public. They do not support service accounts; delegated credentials use their user identity. A public grant includes anonymous visitors. The detail page returns **Not Found** for a missing, deleted, invalid, unavailable, or unauthorized record id. Arbitrary Workflow actions require an authenticated account even when the app itself is public.

Publish the validated draft:

```bash
cld grids apps publish MyBase "Request overview" --yes
```

Applying another draft does not change the live app until you publish again.

Unpublish removes only the live snapshot and keeps the draft. Delete removes the app and its route. Both commands require an explicit confirmation:

```bash
cld grids apps unpublish MyBase "Request overview" --yes
cld grids apps delete MyBase "Request overview" --yes
```

## Keep publication predictable {icon="versions"}

`validate` checks the strict definition, implicit context references, availability queries, and every referenced Base, table, View, Form, field, template, and Workflow launcher. It verifies table compatibility for row navigation, Form results, and fixed relation values. Unknown properties are rejected. `plan` reports `create`, `update`, `noop`, or `invalid` without saving. `apply` writes the draft, and `publish` atomically replaces the published definition and capability snapshot with the current valid draft.

```bash
cld grids apps list MyBase
cld grids apps get MyBase "Request overview"
cld grids apps export MyBase "Request overview" --out requests.yaml
```

:::note Only the active page is resolved
Opening one page resolves only the blocks on that page and loads only its optional page record. Hidden detail pages are not prefetched. This keeps large apps predictable without weakening current access checks.
:::
