---
id: grids-custom-apps
title: Custom Apps
icon: ti ti-app-window
description: Publish focused apps from Forms, saved views, and record details.
order: 137
---
Custom Apps give signed-in Cloud accounts a focused app at `/apps/<shortId>` without exposing the full Grids workspace. Each app belongs to one base and reuses that base's records and saved views. Definitions are portable YAML that you can validate, review, and publish with the Cloud CLI.

Custom Apps do not copy data. A publication stores an immutable definition and the exact resources it may use. Every request checks the app grant plus the current Form, saved-view, table, and row-level record access.

## Pages and blocks {icon="layout-dashboard"}

An app may contain up to 12 responsive pages. Set `startPageId` to the page shown at `/apps/<shortId>`. Pages with `navigation.visible: true` appear in the app navigation.

A column may contain:

- **Markdown**, for headings, instructions, and links;
- **Form**, for creating a record with one existing active Grids Form;
- **Records**, for up to 100 rows from one saved view and an explicit field allowlist;
- **Record**, for an explicit field allowlist from the current detail record;
- **Comments**, for a permission-inheriting discussion on the current detail record.

Record detail pages are route-only. They declare one required `record` parameter, bind it as the page record, and set `navigation.visible: false`. A Records block may map its row id to that parameter with `rowNavigate`. Grids then builds the URL and authorizes the record when the detail page opens.

Scripts, custom HTML and CSS, actions, arbitrary URLs, and direct GQL sources are not supported in this release.

## Build a list and detail app {icon="terminal-2"}

You need **Admin** access to the app's base. Start with UUIDs for the base, saved view, table, and fields you want to display.

```yaml
schemaVersion: 1
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
```

The Form, saved view, and `request_id` parameter must use the same records table. After a successful submit, Grids replaces the current URL with the new record's detail page. Clicking an existing row opens the same detail page.

A Form block may hide one of the Form's relation inputs and set it from a Record parameter declared by the current page. The server resolves this value and rejects browser attempts to override it:

```yaml
fixedValues:
  00000000-0000-4000-8000-000000000007:
    source: PARAMS
    path: parent_id
```

The fixed field must be a user-input relation field targeting the parameter's table. `fixedValues` accepts `PARAMS` only. Success navigation accepts declared `PARAMS` plus the submitted Form's `RESULT.recordId`; it always stays inside the same Custom App and uses replace navigation.

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

## Grant access and publish {icon="lock"}

Grant the intended Cloud user or group access to the app and its data. The same normal Grids permissions apply; Custom Apps do not create another account or role model.

```bash
cld grids access grant custom-app MyBase "Request overview" --group "Request team" --permission read
cld grids access grant view MyBase Requests "My requests" --group "Request team" --permission read
cld grids access grant form MyBase Requests Apply --group "Request team" --permission write
cld grids access grant table MyBase Requests --group "Request team" --permission read --record-scope all
```

Custom Apps accept signed-in Cloud accounts only. Table grants may include Grids record scopes such as `created-by`. The detail page returns **Not Found** for a missing, deleted, invalid, or unauthorized record id. Public grants are rejected; normal Cloud accounts, including Cloud guest accounts, use the same permission checks.

Publish the validated draft:

```bash
cld grids apps publish MyBase "Request overview" --yes
```

Applying another draft does not change the live app until you publish again.

## Keep publication predictable {icon="versions"}

`validate` checks the strict definition and every referenced base, table, view, Form, and field. It verifies table compatibility for row navigation, Form results, and fixed relation values. Unknown properties are rejected. `plan` reports `create`, `update`, `noop`, or `invalid` without saving. `apply` writes the draft, and `publish` atomically replaces the published snapshot with the current valid draft.

```bash
cld grids apps list MyBase
cld grids apps get MyBase "Request overview"
cld grids apps export MyBase "Request overview" --out requests.yaml
```

:::note Only the active page is resolved
Opening one page resolves only the blocks on that page and loads only its optional page record. Hidden detail pages are not prefetched. This keeps large apps predictable without weakening current access checks.
:::
