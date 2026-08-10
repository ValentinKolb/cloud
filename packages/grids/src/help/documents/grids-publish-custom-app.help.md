---
id: grids-publish-custom-app
title: Publish a Custom App
icon: ti ti-rocket
description: Preview access, review capabilities, and publish a fail-closed app snapshot.
order: 135
---
<!-- Unreleased contract: register this article only with the complete Custom Apps vertical slice. -->

Publishing makes one reviewed Custom App snapshot available at its stable URL. It does not make the base or referenced resources public.

Only a base administrator can edit, preview, or publish a Custom App.

## Understand the access intersection {icon="shield-lock"}

A person can use a block or action only when every applicable boundary allows it:

| Boundary | Question |
| --- | --- |
| App grant | May this Cloud account or group open the app? |
| Published capability | May this snapshot use this exact resource and operation? |
| Resource grant | May the account read or operate that Grids resource? |
| Row scope | Is this record inside the account's allowed rows? |
| Block restriction | Did the block expose this field, template, or launcher? |

A broader permission at one boundary never overrides a denial or narrower boundary elsewhere. Cloud administrators are not automatic Grids superusers.

The app exposes only resources named by its published blocks and actions. It does not expose the base workspace, schema, sibling apps, or unrelated resources. Denied blocks and actions fail without revealing their labels, configuration, or whether a referenced record exists.

The publication capability set is derived from the app definition. It lists exact resource IDs and operations, including form submission, editable record fields, document templates, and workflow launchers. The builder and `apps plan` show the derived set; authors do not maintain a second capability list by hand.

## Configure row scope on resource grants {icon="filter-lock"}

Row scope is an optional part of a Grids resource access binding:

- **`all`** allows every record permitted by the resource grant.
- **`created_by`** allows records whose immutable creator is the current Cloud account.
- **`related_created_by`** allows child records whose declared relation points to a parent record created by the current Cloud account.

`related_created_by` declares exactly one relation field and one parent table. The relation traversal is bounded to that single edge. It is useful for comments, line items, and other children without introducing a general authorization query language.

Several bindings may apply to one account. Existing deny and precedence rules remain authoritative; allowed row scopes are combined only after those rules resolve the effective grant. A responsible group can therefore receive `all` while requesters receive `created_by` on the same table.

Row scope applies to reads, edits, document access, workflow inputs, comments, and relation traversal. Counts, search results, charts, and existence checks use the same scope and cannot reveal excluded rows.

## Preview before publishing {icon="device-desktop-check"}

Preview uses the draft and current saved resources without changing the published app. Check:

- desktop and narrow widths;
- the current account;
- an audience with ordinary access;
- signed-out/no-access presentation, which must reveal no protected metadata;
- valid, missing, malformed, deleted, and inaccessible page parameters;
- empty, loading, error, and success states;
- every direct edit, form submission, document action, and workflow launcher.

Preview never bypasses permissions. A base administrator may inspect configuration but must choose a real permitted account or the explicit no-access state to evaluate end-user data.

## Read the preflight {icon="list-check"}

Publish preflight compiles the same typed definition used by runtime and CLI. Publication is blocked when:

- a referenced resource, field, page, parameter, template, or launcher is missing;
- a value reference is out of scope or has the wrong type;
- navigation omits a required target parameter;
- an inline query is invalid or unbounded;
- a Record block exposes an editable field it does not display;
- a Comments block has no page record;
- a resource operation cannot be represented by the derived capability set;
- an unknown schema key or unsupported schema version is present.

Warnings cover reachable but likely poor experiences, such as missing empty copy, a hidden start page, or a layout that becomes unusually long at narrow width. Warnings require review but do not weaken runtime checks.

## Publish one snapshot {icon="copy-check"}

The builder saves changes automatically into a draft. When that draft differs from the live version, the Pages notice offers **Publish changes** and **Restore live version**. Publishing first waits for the latest autosave, then stores the validated definition and its derived capability set as the new published snapshot. Restore copies the current published snapshot back into the draft. The stable `/apps/<shortId>` route serves only the published snapshot.

Published apps continue to use the current referenced Grids resources. Permission and row-scope changes take effect immediately. If a referenced resource is later disabled, deleted, or changed incompatibly, only the affected block or action fails closed. The rest of the page remains usable.

Run preflight again after changing a referenced View, Form, template, field, or workflow launcher. Republish when the app definition or derived capability set must change.

## Verify the published journey {icon="checks"}

After publication:

:::steps
1. Open the stable URL as an ordinary account, not only as a base administrator.
2. Complete every primary journey, including refresh and browser Back.
3. Confirm that copied detail URLs preserve only declared parameters.
4. Try an inaccessible record ID and verify that the response reveals no record details.
5. Confirm that comments paginate, record lists remain bounded, and unrelated blocks render independently.
6. Change the draft and confirm that the published route remains unchanged until the next successful publication.
:::

For automated review and publication, use [YAML & CLI](/app/grids/help/grids-custom-app-yaml-cli).
