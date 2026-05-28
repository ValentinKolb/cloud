# Grids v1 scope

This document freezes the Grids v1 product scope so remaining work can focus on correctness, UX polish, and release risk.

## Must ship

| Area | Decision | Scope |
| --- | --- | --- |
| Base/table app shell | Keep | AppWorkspace navigation, last-opened routing, admin-only edit actions, dashboards/forms/tables/views ordering. |
| Tables and records | Keep | Typed fields, record list/detail, create/edit/delete, direct table editing, form-first create mode where configured. |
| Views | Keep | Saved filters, sort, search, group, aggregations, limits, columns, column formats, permissions, dashboard embeds. |
| Forms | Keep | Form builder, public/private submit, submit permissions, fixed values, markdown longtext editing, dashboard form embeds. |
| Dashboards | Keep | Base dashboards, WYSIWYG rows/cells, stat/view/chart/view-stats/form/markdown/link widgets, icons, permissions. |
| Files | Keep | File field v1 with Postgres-backed storage and record detail/table display. |
| Search | Keep | Postgres-owned search for supported field types. Formula-result search is post-v1. |
| Export | Keep | Configurable export using server-side query semantics. |
| Automations | Keep | Admin UI, manual/schedule/record created/updated/deleted triggers, table scope, optional filter, webhook action, run history. |
| Formula fields | Keep | Stable `#shortId` references, autocomplete, syntax highlighting, function/field reference page, check endpoint, preview table, decimal-safe arithmetic. |
| Field formats | Keep | Column-level formats for table/view/dashboard rendering: date, decimal, percent, progress, markdown longtext. |
| Permissions | Keep | Base/table/view/form/dashboard permissions, public forms, dashboard embed rule, backend-authoritative writes. |
| SQL ownership | Keep | SQL remains source of truth for filtering, sorting, grouping, aggregation, search, export, and permission boundaries. |
| Help | Keep | System help for Grids concepts and workflows. |
| Tests and smoke | Keep | Typecheck, targeted service tests, Postgres smoke, browser regression checklist, soak harness where already built. |

## Finish before v1

| Item | Why |
| --- | --- |
| Live table/view refresh without remount | Needed for record-event UX: refetch current SQL query without losing detail panels, scroll, or editor state. |
| Excel/VBA rich-text workflow mapping | Validate that current fields/forms/automations/export can cover the migration scenario without bespoke features. |
| AI-generated field scaffolding decision | Decide whether v1 includes a small admin-only helper or explicitly defers it. |
| Searchable formula values decision | Explore and likely defer unless it can stay SQL-owned and cheap. |
| Final release pass | Re-run typecheck, service tests, Postgres smoke, browser checklist, and a small production-readiness review. |

## Defer

| Area | Post-v1 direction |
| --- | --- |
| Advanced computed-field querying | Defer formula-backed filters/sorts/search unless backed by generated SQL/materialized storage with clear semantics. |
| Full workflow builder | Defer branches, multi-step actions, scripts, incoming webhooks, retries UI, and non-webhook actions. |
| Runtime widget rendering | Defer dynamic/custom widget runtime beyond the supported widget set. |
| Field-level ACL | Defer per-field read/write, default grants, grant audit enhancements, and row ownership rules. |
| Views v2 | Defer computed view columns and broader table-level metadata redesign. |
| Formula authoring redesign | Defer name-based formulas and formula rewrite-on-rename until after `#shortId` v1 is stable. |
| Formula-result search | Defer until the query model can keep SQL as source of truth. |
| Import builders | Defer rich CSV/Excel import builders beyond the scoped Excel/VBA mapping decision. |

## Cut from v1

| Area | Reason |
| --- | --- |
| Client-side query caches for correctness | Violates SQL-as-source-of-truth and horizontal scaling requirements. |
| Arbitrary JavaScript conditions/actions | Hard to permission, test, and run safely in v1. |
| Unbounded dashboard/widget plugin surface | Too much runtime and permission surface for v1. |
| Bespoke Excel/VBA-only features | Migration scenario should use general Grids primitives first. |
| Backward compatibility migrations for alpha-only field experiments | Alpha has no release contract yet; keep schema and code simple. |

## Release rule

New v1 work is allowed only when it closes one of the "Finish before v1" items or fixes a correctness, security, data-loss, permission, or blocking UX issue.
