---
id: grids-custom-apps
title: Custom Apps
icon: ti ti-app-window
description: Publish a focused read-only app from Markdown and saved views.
order: 137
---
Custom Apps give signed-in people a focused page at `/apps/<shortId>` without exposing the full Grids workspace. Each app belongs to one base and reads the base's existing saved views. The first release is intended for read-only status pages, directories, and small internal portals built from YAML with the Cloud CLI.

Custom Apps do not copy records. A published app stores its layout and the exact saved views it may execute. Opening the app checks its own access and the access of every included view.

## What you can publish {icon="layout-dashboard"}

One app currently contains one page with responsive rows and columns. A column may contain:

- **Markdown**, for headings, instructions, and links;
- **Records**, for a table backed by one saved view and an explicit list of fields.

An app may contain up to 4 Records blocks. Each block returns at most 100 records and may display up to 30 fields. Scripts, custom HTML and CSS, forms, comments, actions, and direct GQL sources are not supported in this release.

## Build and publish an app {icon="terminal-2"}

You need **Admin** access to the app's base. Start with UUIDs for the base, saved view, and fields you want to display.

1. Save a definition such as this as `requests.yaml`:

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
    rows:
      - id: content
        columns:
          - id: main
            span: 12
            blocks:
              - id: intro
                type: markdown
                markdown: "# My requests"
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
```

2. Inspect the current contract, then validate and plan the file:

```bash
cld grids apps reference
cld grids apps validate MyBase --source-file requests.yaml
cld grids apps plan MyBase --source-file requests.yaml
```

3. Apply the definition. This updates only the draft:

```bash
cld grids apps apply MyBase --source-file requests.yaml
```

On first apply, Grids assigns the app's stable five-character `shortId`. You may keep `shortId` out of the source file; later applies preserve the assigned value. Use `apps export` when you want a complete normalized definition that includes it.

4. Grant the intended Cloud user or group access to the app and to every saved view it displays:

```bash
cld grids access grant custom-app MyBase "Request overview" --group "Request team" --permission read
cld grids access grant view MyBase Requests "My requests" --group "Request team" --permission read
```

Custom Apps accept signed-in Cloud accounts only. Public grants are rejected.

5. Publish the validated draft:

```bash
cld grids apps publish MyBase "Request overview" --yes
```

The app is now available at the path printed by the command. Applying another draft does not change that page until you publish again.

## Keep publication predictable {icon="versions"}

`validate` checks the strict definition and every referenced base, view, and field. Unknown properties are rejected. `plan` reports `create`, `update`, `noop`, or `invalid` without saving. `apply` writes the draft, and `publish` atomically replaces the published snapshot with the current valid draft.

Use these commands for review or recovery:

```bash
cld grids apps list MyBase
cld grids apps get MyBase "Request overview"
cld grids apps export MyBase "Request overview" --out requests.yaml
```

:::note Access is checked when the app opens
Publishing does not grant access. A reader needs an explicit **Read** grant on the Custom App. Every Records block also checks the current permission of its saved view, so removing view access immediately removes that data from the app.
:::
