---
id: grids-evidence-exports
title: Export an evidence package
icon: ti ti-package-export
description: Create and verify a bounded package of the evidence Grids currently holds.
order: 147
---
An evidence export captures one Base or table from a stated cut and packages the selected current and historical sources with a manifest and SHA-256 hashes. Use it when another person or system needs a reviewable handoff rather than an editable CSV or JSON dataset.

An evidence package is not a compliance certificate. It reports the evidence Grids has and names missing history; it does not reconstruct events from before Durable History was enabled.

You need **Admin** access to the Base. Custom Apps, Workflows, API clients, and the CLI cannot bypass that gate.

## Create a package {icon="package-export"}

:::steps
1. Open the Base settings and select **Evidence exports**.
2. Select **New export**.
3. Choose the complete Base or one table. Optionally choose a period for revisions, audit events, Documents, and number allocations. Current Records and live Relations are always taken from the export cut.
4. Keep all evidence selected, or clear sections the recipient does not need.
5. Read the scope check. Narrow the table, period, or selected sections if the known scope exceeds a package budget.
6. Select **Queue export**. The recent-packages list shows the job as queued, running, or completed.
7. Select **Download** while the completed package is available.
:::

The package expires after seven days. Expiry removes its stored bytes; create a new export if the recipient still needs a package.

## Understand what is included {icon="list-check"}

| Section | Evidence source |
| --- | --- |
| Records | Current and deleted stored Records at the cut, including Finalization state |
| Durable History | Available immutable Record revisions and their schema meaning |
| Audit | Saved mutation events, actor labels, answers, and request context |
| Schema and configuration | Base, tables, fields, policies, Finalization settings, templates, and schema snapshots |
| Relations | Current links used by Relations and **Referenced by**; historical relation state remains in revisions |
| Files | Current and revision-protected attachment bytes with their saved hashes |
| Document artifacts | Exact stored Document bytes, snapshots, render data, and renderer metadata; nothing is rendered again |
| Number allocations | Number Series, format versions, and allocated values |

Grids resource references use their six-character public IDs. UUID-shaped values without a Public ID in the selected Grids scope are represented as stable private references instead of exposing internal identifiers. The same source value receives the same private reference within the package.

## Verify the download {icon="shield-check"}

Open **Technical details** before downloading and retain the displayed package and manifest SHA-256 values with the handoff.

After downloading:

1. Calculate the SHA-256 of the complete TAR file and compare it with **Package SHA-256**.
2. Extract the TAR without editing it.
3. Calculate the SHA-256 of `manifest.json` and compare it with **Manifest SHA-256**.
4. For each file you rely on, calculate its SHA-256 and compare it with the matching entry in the manifest.
5. Read the manifest's scope, cut, selected sections, counts, limits, and history coverage before drawing conclusions from the package.

A matching hash shows that the bytes match this export. It does not establish who possessed the file after download or make a legal claim about the records.

## Recover from a failed or incomplete request {icon="lifebuoy"}

- **Scope could not be checked:** Select **Retry**. If it fails again, keep the chosen scope and error message for the operator.
- **Known scope is too large:** Choose one table, shorten the period, or export fewer sections. Grids fails the job instead of silently truncating a package that crosses a runtime limit.
- **Failed or canceled:** Select **Retry** to queue a fresh attempt. A retry takes a new cut; it is not the same package.
- **Queued or running but no longer needed:** Select **Cancel**. A cancellation request may take a moment while the current bounded read stops.
- **Expired:** Create a new export. Expired package bytes cannot be downloaded again.

Ordinary CSV and JSON exports are unchanged. Use those formats when the goal is data transfer or analysis rather than a hash-verifiable evidence handoff.
