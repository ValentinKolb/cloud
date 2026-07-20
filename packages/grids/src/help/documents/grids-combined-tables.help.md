---
id: grids-combined-tables
title: Combined tables
icon: ti ti-table-share
description: Publish one governed read-only table across several bases.
order: 122
---
A Combined table presents records from several stored tables as one governed, read-only table. It is useful when teams should keep operating in separate bases but another audience needs one consistent dataset for audit, reporting, search, dashboards, documents, workflows, or export.

For example, regional teams can keep different Inventory bases while an audit base publishes one **All inventory** table. Readers query its canonical Name, Status, and Location fields even when the source tables use different names or select options.

Do not use a Combined table merely to show a subset from one table; use a view for that. Do not use it when readers must edit the source records through the combined surface, because publication is deliberately read-only.

## What a Combined table changes {icon="table"}

The Combined table owns its name, canonical fields, views, and permissions. Source admins explicitly authorize selected source tables and field mappings. Readers use only the Combined table and need no access to the source bases. Grids runs union, search, filters, sorting, pagination, grouping, and aggregation in PostgreSQL; the browser never joins result lists itself.

:::reference
- **Canonical schema:** Create the fields readers should see, then map each source field to the matching canonical field. Missing mappings return null for that source.
- **Independent access:** Target readers receive only canonical data. They do not inherit source navigation, physical schema, or mutation rights.
- **Read-only result:** Use the table in GQL, saved views, dashboards, documents, workflows, and exports. Record creation, forms, imports, uploads, edits, and deletes are unavailable.
- **Fail-closed publication:** A revoked, deleted, or incompatible source makes the complete published revision unavailable. Grids never returns a silently smaller partial result.
:::

## Create and publish {icon="square-plus"}

:::steps
1. **Create the Combined table:** Choose New table, select Combined table, and add the canonical fields that consumers should query.
2. **Choose sources:** Open Combined data in edit mode. The picker lists only stored tables whose base you may administer.
3. **Map fields and select options:** Map stable source fields by identity. Select fields also require an explicit mapping for every source option.
4. **Validate and publish:** Validation reports incomplete or incompatible mappings without changing the active publication. Publish only after every diagnostic is resolved.
5. **Operate the published table:** Grant target permissions and build views or dashboards normally. Source admins can inspect the exact published field scope and revoke it independently.
:::

:::note Publication authority
Publishing always requires admin access to the target base. Source-base admin access is required only for source scope that is new, broadened, or being restored after revocation. Existing unrevoked mappings may be retained, narrowed, or removed without reauthorization. A published grant remains valid if the authorizing admin later loses their role; a source-base admin can explicitly revoke it.
:::

## Query and downstream behavior {icon="search"}

GQL has no special Combined-table syntax. Autocomplete exposes only the canonical target fields, and the same query can back a records page, saved view, dashboard widget, document source, workflow read, or streaming export.

**Company-wide inventory**

```gql
from table "All inventory"
where Status = 'Available'
search 'camera'
sort Name asc
```

:::reference
- **Relations:** A canonical relation must point to one common stored target or to another explicitly published Combined target containing the related records.
- **Files:** Target readers can preview and download mapped files through the Combined permission boundary. Source file metadata and file mutation remain private.
- **Computed data:** Canonical formulas run in SQL over the combined columns. Source computed fields are eligible only when they have a stable compatible SQL output.
- **Live data and export:** Source changes invalidate the target through the normal live event stream. CSV and JSON exports page the canonical query with bounded memory.
:::

## Diagnostics and repair {icon="lifebuoy"}

Draft diagnostics identify the affected source, canonical field, and physical field. A published table shows Action required when its schema or authorization is no longer valid. Repair the source or mappings, validate the draft, and publish a complete new revision. Revoked access is restored only by publishing a newly authorized revision.

:::reference
- **No automatic matching:** Labels, positions, and similar field types are never guessed. Every exposed mapping is deliberate.
- **No nested Combined sources:** A Combined table can source stored tables only. Use a canonical relation when related records also need federation.
- **No source write-through:** Target write permission does not edit physical records. Workflows may read Combined data but cannot mutate the Combined target.
- **Explicit limits:** One Combined table supports up to 50 source tables and 200 canonical fields.
:::

## Deleted records and history {icon="history"}

Combined tables preserve the lifecycle of published records without granting access to their source bases. Choose **Show deleted** to inspect records that were deleted in a source table. Their detail panel is read-only and identifies the published source by base and table name. Restore or edit the physical record from its source base.

The record detail shows its published history. Readers with access to the complete Combined table can also choose **Actions → Audit trail** to browse and filter history across all published records. A reader who can access only a saved view sees history only for records returned by that exact view.

:::reference
- **Current publication:** History is projected through the active canonical mappings. Fields removed from the publication no longer appear, including in older events.
- **Lifecycle events:** Created, updated, imported, deleted, and restored events remain visible while their source is actively published.
- **Required explanations:** Answers collected by an audit policy, such as a required deletion reason, remain attached to the event with their question labels.
- **Private source details:** Physical field IDs, unpublished values, IP addresses, browser details, and source-base navigation are not exposed through the Combined table.
- **Changed select options:** An old source option that no longer has an active canonical mapping is shown as unavailable instead of exposing its source identifier.
- **Fail closed:** Revoked, degraded, or incompatible publications return no partial history. Repair and republish the Combined table before continuing.
:::

## CLI lifecycle {icon="code"}

The CLI accepts names, short IDs, or UUIDs. The mapping body is JSON rather than a separate configuration language. Use `cld grids tables combined candidates` to discover authorizable sources, then validate before saving or publishing.

**Create, inspect, publish, and revoke**

```text
cld grids tables create Reporting --name "All inventory" --kind federated --json
cld grids fields create Reporting "All inventory" --name Name --type text --json
cld grids tables combined candidates Reporting "All inventory" --json
cld grids tables combined validate Reporting "All inventory" --body-file combined.json --json
cld grids tables combined draft Reporting "All inventory" --body-file combined.json --json
cld grids tables combined get Reporting "All inventory" --json
cld grids tables combined publish Reporting "All inventory" --json

cld grids tables combined publications "Warehouse East" Items --json
cld grids tables combined revoke "Warehouse East" Items \
  --target-table <combined-table-uuid> \
  --yes

cld grids records audit list Reporting "All inventory" --action deleted
```

**Friendly mapping body**

```text
{
  "sources": [
    {
      "base": "Warehouse East",
      "table": "Items",
      "mappings": [
        { "target": "Name", "source": "Title" },
        {
          "target": "Status",
          "source": "State",
          "options": { "In stock": "Available" }
        }
      ]
    }
  ]
}
```

:::note Source-admin control
Source admins can inspect grants with `cld grids tables combined publications` and revoke one with `cld grids tables combined revoke`. The revoke command resolves the stored source from its base and table arguments and takes the Combined table UUID from `--target-table`. Revocation immediately makes the target revision unavailable.
:::
