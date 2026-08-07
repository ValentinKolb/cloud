---
id: grids-build-custom-app
title: Build your first Custom App
icon: ti ti-certificate
description: Build a request app with progress, comments, and a generated certificate.
order: 133
---
<!-- Unreleased contract: register this article only with the complete Custom Apps vertical slice. -->

This guide builds a certificate-request app. A requester can submit a request, see their requests, open one request, discuss it, follow its status, and download the generated certificate. A responsible group can process every request through the same base.

The app uses one table and three pages. Existing Forms, Views, Workflows, and document templates continue to own their respective behavior.

## Before you start {icon="list-check"}

You must be a base administrator. Prepare these resources in the same base:

| Resource | Required configuration |
| --- | --- |
| **Certificate requests** table | Title, Engagement details, Status, and Processing note fields |
| **Request a certificate** form | Creates Certificate requests; Status is fixed to Submitted |
| **My certificate requests** view | Shows Title, Status, Processing note, and Updated |
| **Certificate** document template | Uses one Certificate requests record |
| **Approve and generate certificate** workflow launcher | Validates the request, updates it, generates the document, then notifies the requester |

Do not add a requester field. Every record already stores its creator. Use that identity for personal row access. Generated PDFs stay attached through their document runs instead of being copied into another file field.

## Configure access first {icon="lock"}

Create access bindings before composing pages:

| Audience | App | Certificate requests | Form | View | Document template | Workflow launcher |
| --- | --- | --- | --- | --- | --- | --- |
| Requesters | Open | Read with `created_by`; create through the form | Submit | Read | Read generated runs for allowed records | No access |
| Responsible group | Open | Read and update with `all` | Read | Read | Generate and read | Execute |

The app grant alone never grants table, form, view, template, or workflow access. Preview both audiences before publishing.

**Checkpoint:** a requester can submit the Form and read only request rows they created; the responsible group can read and process all request rows. If this fails, correct the resource grants and row scopes before building pages.

## Open the builder {icon="apps"}

Create the initial definition with [YAML & CLI](/app/grids/help/grids-custom-app-yaml-cli). Then turn on **Edit mode**, open the base, and choose the app under **Custom Apps**. Only base administrators see this section.

The builder edits the same canonical draft used by YAML and CLI. Use the **Pages** pane to select, add, or remove pages. Choose **Page settings** for the app name, icon, page title, navigation visibility, and start page. Select a block directly on the canvas to edit its title, content, presentation settings, column width, and order. **Add text** appends a Markdown block to the current column. Save the draft before leaving; publish only after previewing the complete journey.

Set:

- **Name:** Certificate requests
- **Icon:** Certificate
- **Start page:** Apply

Create these pages, then inspect and refine them in the builder:

| Page ID | Title | Navigation | Parameters |
| --- | --- | --- | --- |
| `apply` | Apply | Visible | None |
| `requests` | My requests | Visible | None |
| `request` | Request detail | Hidden | Required `request_id`, type Record, Certificate requests table |

Page IDs are stable definition identifiers. Labels may change without breaking navigation. The hidden detail page is reached from a row or successful form submission.

**Checkpoint:** preview opens on Apply, shows Apply and My requests in navigation, and keeps Request detail out of navigation. If not, correct the start page, page IDs, and navigation settings.

## Build Apply {icon="forms"}

Add one full-width row with:

1. a Markdown block explaining what information is needed and the expected processing time;
2. a Form block using **Request a certificate**.

In the Form block's **After success** settings, choose **Navigate**, target the `request` page, and bind:

```text
request_id = RESULT.recordId
```

Enable **Replace history** so Back does not return to a completed submission state. The Form continues to own required fields, validation, fixed Status, and record creation.

**Checkpoint:** a successful submission opens the new request's detail URL. If creation succeeds but navigation does not, fix the success binding rather than the Form.

## Build My requests {icon="list-details"}

Add a Records block using **My certificate requests**. Show only the fields needed to identify a request. Use a compact table or cards according to the expected screen width.

Set the row target to page `request` and bind:

```text
request_id = ROW.id
```

Search, filters, sort, and pagination use URL state owned by this Records block. They can be reloaded or shared without becoming access controls. The `created_by` row scope remains authoritative.

**Checkpoint:** selecting any visible row opens its detail page, while changing the URL to another request does not reveal that record. Fix row navigation separately from row authorization.

## Build Request detail {icon="file-description"}

In **Page record**, select Certificate requests and bind its record ID:

```text
PARAMS.request_id
```

Arrange the page in task order:

1. A Record block showing Title, Status, Processing note, and submitted details.
2. A Comments block for the page record.
3. Generated documents inside the Record block, limited to the Certificate template.
4. An Actions block only when the current audience has an appropriate enabled workflow launcher.

Requester fields should normally be read-only after submission. If corrections are allowed, add only those fields to **Editable fields**. Status, approval data, and generated output remain workflow-owned.

When no certificate exists, the Record block shows the configured empty text: “Your certificate will appear here after approval.” It does not render a disabled or empty download control.

**Checkpoint:** status, comments, and generated documents remain attached to the same request after reload. A failure belongs to the Record binding, Comments access, or document run named by the failing block.

## Keep processing outside the layout {icon="route"}

The responsible group can process requests in the Grids workspace or a second ordinary Custom App. No special admin-app type is needed.

The workflow must re-read and validate the request before changing it. Related record changes use the workflow's atomic record-change boundary; external effects begin only after those changes commit. This keeps concurrent reviewers from silently applying a stale transition.

## Preview the complete journey {icon="shield-check"}

Use **Preview as** to verify:

:::steps
1. As a requester, submit a valid request and confirm that its detail page opens immediately.
2. Reload the detail URL and confirm that the same request opens.
3. Use another request ID and confirm that no record existence or data is disclosed.
4. Confirm the empty list, no-comments, awaiting-document, completed, missing-parameter, and denied states.
5. As the responsible group, confirm that the intended processing records and actions are available.
6. Repeat the journey at desktop and narrow widths using keyboard navigation.
:::

The app is ready when the requester journey is understandable without the Grids workspace or knowledge of the underlying table.

## Publish and verify {icon="rocket"}

Run the publish preflight, review every requested capability, and publish. Open the standalone URL and repeat the requester journey against the published snapshot.

When something fails, fix the owning layer:

| Symptom | Owner |
| --- | --- |
| Missing or invalid `request_id` | Page parameter or navigation binding |
| Missing or denied request | Resource grant or row scope |
| Rejected input | Form |
| Stale transition or partial record change | Workflow |
| Missing PDF | Document template or document run |
| Unavailable action | Published capability, launcher state, or permission |

Read [Pages & blocks](/app/grids/help/grids-custom-app-pages-blocks) for every setting, [Publish & permissions](/app/grids/help/grids-publish-custom-app) for preflight behavior, and [YAML & CLI](/app/grids/help/grids-custom-app-yaml-cli) for the equivalent agent workflow.
