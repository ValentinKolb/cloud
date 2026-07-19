---
id: grids-operations-troubleshooting
title: Operations & troubleshooting
icon: ti ti-bolt
description: Diagnose common problems without guessing or losing work.
order: 150
---
When Grids behaves differently than expected, identify the surface first: table, view, form, dashboard, document, workflow, or Combined table. Then check its current query, state, and access before changing the underlying data.

Grids rejects ambiguous queries, stale writes, invalid automation, and unauthorized access rather than silently choosing a different result.

### A resource is missing or will not open

Check that it is not in trash or disabled, then check access on the resource itself. A specific `None` grant can override broader base access. Cloud administrator status does not bypass Grids access on normal app pages.

For a link opened from a dashboard or relation, remember that the target authorizes separately. Seeing included data or a relation label does not guarantee access to the linked resource.

### Records are missing, duplicated, or out of order

Read the active search, filters, source view, deleted-record mode, and `limit`. Search respects the current query, so it cannot find records already filtered out.

Use exact filters for calculated values, lookups, rollups, files, dates, and empty values. Add a meaningful sort before relying on page order or `offset`. Pages are live reads; changes made between page requests can move matching records.

If a change is not visible, reload once. Live updates keep the current query rules: a changed record can legitimately disappear when it no longer matches.

### A record edit was rejected

Another user or tab may have saved a newer version. Reload the record, compare the new values, and apply your change again. This prevents an older form from overwriting newer work.

If the message asks for change context, answer the questions configured under **Table settings → Data integrity**. Protected updates, trash actions, and restores cannot proceed without the required answers.

### A view or dashboard result is wrong

Open the source query and verify it before changing presentation:

- use pre-group filters for source records and `having` for aggregate rows;
- confirm a chart source is grouped and contains the expected aggregate values;
- check whether a widget uses a saved view or its own local GQL;
- remember that aggregate-only and grouped results are summaries, not editable records.

An empty result is different from a failed result. Query diagnostics explain syntax, unknown names, incompatible operations, and permission failures.

### A form will not submit

Confirm that the form is active. An internal user needs Form **Write/Use** or inherited table write access. A public form must still be enabled for public access and opened with its current token.

Check required fields, relation inline-create rules, and server-managed values. Users cannot override hidden values applied by the form.

If an old public URL stopped working after public access was disabled, share the newly generated URL; the old token is intentionally not restored.

### A document preview or download fails

Choose a preview record, then inspect the template in this order:

1. **Source** shows the GQL after current-record Liquid values were inserted.
2. **Data** shows the exact paths available to Liquid.
3. **Preview** shows the rendered PDF.

Correct the source when rows are empty, and copy paths from Data instead of guessing. For barcodes, verify both the symbol id and a non-empty compatible value. For multipage output, test with enough rows and keep repeated letterhead or page-number content in header and footer parts.

Generated documents redownload from their stored snapshot and template data. Later record or template changes do not rewrite an existing run.

### A workflow did not do what you expected

Open the run detail rather than immediately retrying. Check its revision, mode, channel, inputs, step outcomes, saved outputs, and error.

A `dryRun` records predicted effects but does not perform writes or external requests. An `execute` retry should use a deliberate idempotency key; external HTTP receivers should also handle duplicate requests safely.

For automatic runs, confirm the workflow is enabled and the schedule or record-event filter matches. For scanner, bulk, and dashboard actions, inspect the saved launcher's diagnostics after changing workflow inputs.

### A Combined table needs attention

A Combined table fails closed when a published source, mapping, or authorization is no longer valid. It does not return a smaller partial dataset.

Open **Combined data**, inspect the affected source and field diagnostics, repair the draft, validate it, and publish a complete new revision. A revoked source must be authorized again before republishing.

### Files, exports, and large results

Files follow their table or Combined-table permission boundary. Store facts people need to search or filter in normal fields rather than only in a filename.

Exports and result pages are server-paged. A query without `limit` can continue through all matching rows; a `limit` intentionally caps the logical result. Use bounded exports and CLI `--max-rows` options when an automated consumer must enforce its own maximum.

:::note Preserve the failing context
Before editing a query, template, or workflow, keep the diagnostic and the input that produced it. A precise error plus the active source is more useful than a screenshot of an empty result.
:::
