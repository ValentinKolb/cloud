import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../service";
import RecordsView from "../_components/records-view/RecordsView.island";
import DashboardLayout from "../_components/dashboard/DashboardLayout";
import {
  resolveViewStatsRow,
  resolveWidgetData,
  type ViewStatsRowData,
  type WidgetData,
} from "../_components/dashboard/widget-data";
import type { GroupBucket } from "../_components/GroupedTable";
import CreateTableButton from "../_components/CreateTableButton.island";
import CreateDashboardButton from "../_components/CreateDashboardButton.island";
import FormSidebarEntry from "../_components/FormSidebarEntry.island";
import type {
  FilterTree,
  SortSpec,
  Field,
  StatWidget,
  ChartWidget,
  ViewWidget,
} from "../../service";
import { filterSearchableFields, mergeSearchIntoFilter } from "../../service/search";
import { parseRecordsState } from "../_components/records-view/query-url";
import { resolveEffectiveQuery } from "../_components/records-view/effective-query";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
};

const resolveLevel = async (
  user: AuthUser,
  baseId: string,
  tableId?: string,
  formId?: string,
) => {
  if (hasRole(user, "admin")) return "admin" as const;
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
    tableId: tableId ?? null,
    formId: formId ?? null,
  });
  const target = formId
    ? { baseId, tableId: tableId!, formId }
    : tableId
      ? { baseId, tableId }
      : { baseId };
  return gridsService.permission.resolve(grants, target);
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  // URL shape (path-based, mirroring notebooks):
  //   /app/grids/<base>                                           — base home
  //   /app/grids/<base>/table/<table>                             — records page
  //   /app/grids/<base>/table/<table>/view/<view>                 — saved-view page
  //   /app/grids/<base>/dashboard/<dashboard>                     — dashboard page
  // Query params are reserved for filter/sort/group/aggregations,
  // free-text search, the detail-panel record id, cursor, and trash
  // mode — i.e. anything that's UI state on top of the resource the
  // path identifies.
  //
  // The single ssr() handler covers every above shape because Hono
  // dispatches each route file to this same default export. We read
  // table / view / dashboard from path params (path-based is the
  // canonical form) and only fall back to the query-param shape
  // (`?table=...&view=...&dashboard=...`) if a sibling route file
  // forwarded a legacy URL — kept narrow to avoid two URL shapes
  // accidentally diverging.
  const baseShortId = c.req.param("baseId");
  const trashMode = c.req.query("trash") === "1";
  const activeTableSlug =
    c.req.param("tableId") ?? c.req.query("table") ?? null;
  const activeViewSlug =
    c.req.param("viewId") ?? c.req.query("view") ?? null;
  const activeDashboardSlug =
    c.req.param("dashboardId") ?? c.req.query("dashboard") ?? null;

  // URL state — single source of truth via parseRecordsState. The SSR
  // page used to hand-parse every URL param, which drifted from the
  // island's parser (e.g. group-mode dropped `q`). Now both sides go
  // through the same code.
  const recordsState = parseRecordsState(new URL(c.req.url).searchParams);
  const parsedFilter = (recordsState.query.filter ?? null) as FilterTree | null;
  const parsedSort: SortSpec[] = (recordsState.query.sort ?? []) as SortSpec[];
  type GroupByRaw = {
    fieldId: string;
    direction?: "asc" | "desc";
    granularity?: "day" | "week" | "month" | "quarter" | "year";
  };
  type AggregationRaw = {
    fieldId: string | "*";
    agg: "count" | "countEmpty" | "countUnique" | "sum" | "avg" | "min" | "max";
    label?: string;
  };
  const parsedGroupBy = (recordsState.query.groupBy ?? []) as GroupByRaw[];
  const parsedAggregations = (recordsState.query.aggregations ?? []).filter(
    (a): a is AggregationRaw =>
      a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
  );
  const rawQ = recordsState.search.q.trim();
  const qFieldIds = recordsState.search.fieldIds;
  const rawCursor = recordsState.cursor;
  const selectedRecordId = recordsState.selectedRecordId;

  // FilterPanel's initial state expects a flat leaf list. The URL filter
  // is allowed to be any FilterTree shape (AND/OR/NOT/leaf); we pull
  // the leaves out of an AND root for the panel's seed. Other shapes
  // produce an empty leaf list — the panel still renders, just without
  // pre-populated rows.
  const filterLeaves: Array<{ fieldId: string; op: string; value?: unknown }> =
    parsedFilter && typeof parsedFilter === "object" && "op" in parsedFilter &&
    parsedFilter.op === "AND" && Array.isArray((parsedFilter as { filters?: unknown[] }).filters)
      ? (parsedFilter as { filters: unknown[] }).filters.filter(
          (f): f is { fieldId: string; op: string; value?: unknown } =>
            typeof f === "object" && f !== null && "fieldId" in f && "op" in f,
        )
      : [];

  const base = await gridsService.base.getByIdOrShortId(baseShortId);
  if (!base) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> Base not found
        </div>
      </Layout>
    );
  }
  const baseId = base.id;

  // Default-dashboard redirect — when the URL pins neither a table nor
  // a dashboard AND the base has a configured default dashboard alive,
  // redirect into dashboard mode. Doing this as a 302 (rather than
  // inline-render) keeps the user's URL share-able and the default
  // state explicit. A stale default_dashboard_id (referenced row got
  // soft-deleted) silently falls through to the existing first-table
  // behaviour — `getByIdOrShortId` returns null in that case.
  if (!activeTableSlug && !activeDashboardSlug && base.defaultDashboardId) {
    const defaultDashboard = await gridsService.dashboard.get(base.defaultDashboardId);
    if (defaultDashboard && defaultDashboard.deletedAt === null) {
      return c.redirect(`/app/grids/${baseShortId}/dashboard/${defaultDashboard.shortId}`, 302);
    }
  }

  // Resolve the active table+view slugs now that we know the base. Both
  // optional — null when the URL doesn't pin a specific one. listByBase
  // below will additionally narrow to readable tables, so a slug for a
  // table the user can't read still resolves to "no active table".
  const activeTableFromSlug = activeTableSlug
    ? await gridsService.table.getByIdOrShortId(baseId, activeTableSlug)
    : null;
  const activeTableId = activeTableFromSlug?.id ?? null;

  // Resolve the active dashboard. Same tolerant lookup pattern as the
  // table/view resolvers — accepts slug or UUID. Permission gating
  // happens via listForBase in dashboard mode (only readable dashboards
  // hit the page).
  const activeDashboard = activeDashboardSlug
    ? await gridsService.dashboard.getByIdOrShortId(baseId, activeDashboardSlug)
    : null;

  const level = await resolveLevel(user, baseId);
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return () => (
      <Layout c={c} title="Access denied">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-lock text-sm" /> No access to this base
        </div>
      </Layout>
    );
  }

  // Personal-dashboard visibility gate: a dashboard with ownerUserId
  // set is private to that user (plus any explicit dashboard_access
  // grants — listForBase covers those). Direct ?dashboard=<slug> hits
  // skip listForBase, so we apply the same rule here. A non-owner
  // viewer just sees "dashboard not found" rather than a redirect, to
  // stay consistent with personal-view semantics.
  const dashboardVisible =
    activeDashboard !== null &&
    (activeDashboard.ownerUserId === null || activeDashboard.ownerUserId === user.id);
  const renderDashboard = dashboardVisible ? activeDashboard : null;

  // Pre-fetch widget data when dashboard mode is active. Each widget's
  // source is a small server-side query (aggregate for stat, group for
  // chart, list+25 for view); fan-out via Promise.all so the slowest
  // widget caps the total render time, not the sum.
  const widgetData: Record<string, WidgetData> = {};
  const viewStatsData: Record<string, ViewStatsRowData> = {};
  if (renderDashboard) {
    // The discriminated row union (`stats` / `view-stats` / `widgets`)
    // keeps cell arrays narrow per row kind. Flatten widget-bearing
    // cells into one list for parallel `resolveWidgetData` fan-out;
    // view-stats rows have no widget cells, so they get a separate
    // resolver that returns derived ViewStatsCell entries keyed by
    // row id.
    const widgets: Array<StatWidget | ChartWidget | ViewWidget> = [];
    const viewStatsRows: typeof renderDashboard.config.rows = [];
    for (const r of renderDashboard.config.rows) {
      if (r.kind === "stats") {
        widgets.push(...r.cells);
      } else if (r.kind === "widgets") {
        widgets.push(...r.cells);
      } else {
        viewStatsRows.push(r);
      }
    }
    const [widgetResults, viewStatsResults] = await Promise.all([
      Promise.all(
        widgets.map((w) =>
          resolveWidgetData(w, {
            userId: user.id,
            userGroups: user.memberofGroupIds,
          }).then((data) => [w.id, data] as const),
        ),
      ),
      Promise.all(
        viewStatsRows.map((r) =>
          r.kind === "view-stats"
            ? resolveViewStatsRow(r).then((data) => [r.id, data] as const)
            : Promise.resolve([r.id, null] as const),
        ),
      ),
    ]);
    for (const [id, data] of widgetResults) widgetData[id] = data;
    for (const [id, data] of viewStatsResults) {
      if (data) viewStatsData[id] = data;
    }
  }

  // Sidebar listing — readable dashboards across the base. Same shape
  // as views/forms (ownership filtering happens in listForBase).
  const dashboardsForBase = await gridsService.dashboard.listForBase({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  // Filter tables to those the user can read at the table level. Without
  // this, a base-read user could navigate to ?table=<deniedTableId> and read
  // denied data — the API routes already gate at table level, the SSR page
  // must do the same. We also keep the per-table level around so the
  // sidebar can decide whether to show the edit-table settings icon
  // per-row (matches the views section's per-row permission check).
  const allTables = await gridsService.table.listByBase(baseId);
  const tableLevelEntries = await Promise.all(
    allTables.map(async (t) => ({
      table: t,
      level: await resolveLevel(user, baseId, t.id),
    })),
  );
  const tables = tableLevelEntries
    .filter((e) => gridsService.permission.hasAtLeast(e.level, "read"))
    .map((e) => e.table);
  const tableLevels: Record<string, "none" | "read" | "write" | "admin"> = {};
  for (const e of tableLevelEntries) tableLevels[e.table.id] = e.level;

  // Fall back to the first table ONLY when neither a table nor a
  // dashboard is pinned in the URL. Pre-fix, the fallback fired
  // unconditionally and marked the first table as active in the
  // sidebar even while the user was viewing a dashboard — so e.g.
  // clicking "Bookshop overview" left "Genres" highlighted as if
  // both routes were active simultaneously.
  const activeTable = activeTableId
    ? tables.find((t) => t.id === activeTableId) ?? null
    : activeDashboard
      ? null
      : tables[0] ?? null;

  // Resolve the active view slug AFTER the active table — view slugs
  // are scoped per-table. activeViewId stays null when no view is set
  // OR the URL refers to a view that doesn't exist on this table OR
  // the user can't see this view per ACL (visibility check happens
  // below once viewsForTable is loaded).
  const candidateView = activeTable && activeViewSlug
    ? await gridsService.view.getByIdOrShortId(activeTable.id, activeViewSlug)
    : null;

  type RecordsPage = {
    items: import("../../service").GridRecord[];
    nextCursor: string | null;
  };
  let fields: Field[] = [];
  let records: RecordsPage = { items: [], nextCursor: null };
  let aggregates: Record<string, unknown> = {};
  let viewsForTable: Awaited<
    ReturnType<typeof gridsService.view.listForTable>
  > = [];
  let formsForTable: Awaited<
    ReturnType<typeof gridsService.form.listForTable>
  > = [];
  // v3.1: sidebar shows views + forms across the WHOLE base, not just
  // the active table — clicking a different-table view jumps to that
  // table AND applies the view in one click.
  type ViewLike = Awaited<ReturnType<typeof gridsService.view.listForTable>>[number];
  type FormLike = Awaited<ReturnType<typeof gridsService.form.listForTable>>[number];
  const viewsByTable: Record<string, ViewLike[]> = {};
  const formsByTable: Record<string, FormLike[]> = {};
  // Effective query state lifted to outer scope so the renderer (which
  // hands these to the records-view island) sees the SAME values SSR
  // used to fetch records. Without this, the island's initialState
  // carried `parsedFilter`/`parsedSort` (URL only), so the first
  // refetch / pagination after a clean `?view=` URL load reverted to
  // unfiltered rows even though SSR painted the filtered ones (chunk 8
  // critical, post-cleanup review caught this regression).
  let effectiveFilter: FilterTree | null = null;
  let effectiveSort: SortSpec[] = [];
  let effectiveGroupBy: GroupByRaw[] = [];
  let effectiveAggregations: AggregationRaw[] = [];
  let effectiveIncludeDeleted = false;
  let activeTableLevel = level;
  let selectedRecord: import("../../service").GridRecord | null = null;
  let relationLabels: Record<string, string> = {};
  // Pre-fetched fields for every table in this base — TableEditor's relation
  // picker needs this so the user can pick a target table + display field
  // without an extra API round-trip from the modal.
  const fieldsByTable: Record<string, Field[]> = {};

  // activeView is visibility-filtered: a candidate view from
  // getByIdOrShortId is only adopted when listForTable (which applies
  // the view ACL) actually surfaces it for this user. Otherwise we
  // fall back to "no active view" rather than leaking name/columns
  // for a view the user can't see (chunk 8 critical).
  let activeView: import("../../service").View | null = null;

  if (activeTable) {
    // Fields first — we need them to figure out which columns the search
    // applies to (default = "all searchable text fields"). The records/lvl
    // queries can still parallelize after fields land.
    fields = await gridsService.field.listByTable(activeTable.id);
    fieldsByTable[activeTable.id] = fields;

    // Visibility-aware view list. The candidate from getByIdOrShortId only
    // adopts as `activeView` when listForTable surfaces it.
    viewsForTable = await gridsService.view.listForTable({
      tableId: activeTable.id,
      userId: user.id,
      userGroups: user.memberofGroupIds,
    });
    activeView = candidateView
      ? viewsForTable.find((v) => v.id === candidateView.id) ?? null
      : null;

    // Effective query = saved view + URL overrides (shared helper used by
    // SSR and island so the merge rule is one place). filter/sort/group/
    // agg/includeDeleted: URL wins when present, else view; columns and
    // limit come exclusively from the view.
    const effective = resolveEffectiveQuery(
      {
        query: {
          filter: parsedFilter ?? undefined,
          sort: parsedSort.length > 0 ? parsedSort : undefined,
          groupBy: parsedGroupBy.length > 0 ? parsedGroupBy : undefined,
          aggregations: parsedAggregations.length > 0 ? parsedAggregations : undefined,
        },
        cursor: rawCursor,
        selectedRecordId,
        search: { q: rawQ, fieldIds: qFieldIds },
      },
      activeView,
    );

    // Lift effective filter/sort/etc into outer scope so SSR list/
    // aggregate/group AND the renderer (island initialState) all see
    // the SAME values. Without this, the island's source signal seeded
    // from `parsedFilter`/`parsedSort` (URL only) and silently reverted
    // to unfiltered rows on the first refetch.
    //
    // We deliberately store the filter WITHOUT search merged in. SSR
    // calls below build their own merge inline; the island carries
    // `query.search` separately and the server applies the merge once.
    // Storing search-merged here would cause double-merge on refetch.
    effectiveFilter = effective.filter ?? null;
    effectiveSort = (effective.sort ?? []) as SortSpec[];
    effectiveIncludeDeleted = effective.includeDeleted ?? false;
    const filterWithSearch = mergeSearchIntoFilter(effectiveFilter, rawQ, qFieldIds, fields);
    const viewLimit = effective.limit;
    const effectiveLimit = viewLimit !== undefined ? Math.min(100, viewLimit) : 100;

    // Hoist groupBy / aggregations to the outer scope so the footer-
    // aggregate block + the renderer at the bottom can read them.
    // The view's stored aggregations may include median/earliest/latest
    // — narrow to the 7 kinds the SSR-side AggregationRaw supports.
    effectiveGroupBy = (effective.groupBy ?? []) as GroupByRaw[];
    effectiveAggregations = (effective.aggregations ?? []).filter(
      (a): a is AggregationRaw =>
        a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
    );

    const [listResult, lvl] = await Promise.all([
      gridsService.record.list({
        tableId: activeTable.id,
        limit: effectiveLimit,
        includeDeleted: trashMode,
        filter: filterWithSearch,
        sort: effectiveSort,
        cursor: rawCursor,
      }),
      resolveLevel(user, baseId, activeTable.id),
    ]);
    if (listResult.ok) {
      // Top-N views: drop nextCursor — pagination beyond the cap doesn't
      // make sense for "show me the first N" queries.
      const data =
        viewLimit !== undefined
          ? { ...listResult.data, nextCursor: null }
          : listResult.data;
      records = trashMode
        ? {
            ...data,
            items: data.items.filter((r) => r.deletedAt !== null),
          }
        : data;
    }
    activeTableLevel = lvl;

    formsForTable = await gridsService.form.listForTable(activeTable.id);

    // Resolve the labels for every linked record across the visible page.
    // ONE round-trip per target table; passed to RecordsGrid +
    // RecordDetailPanel so relation cells render presentable values
    // instead of raw UUIDs.
    relationLabels = await gridsService.relations.buildLabelCache(
      records.items,
      fields,
    );

    // Resolve the selected record from the URL — prefer the row already in
    // the visible page, fall back to a direct fetch (covers deep links to a
    // record that's beyond the first 100-row page).
    if (selectedRecordId) {
      selectedRecord =
        records.items.find((r) => r.id === selectedRecordId) ??
        (await gridsService.record.get(activeTable.id, selectedRecordId));
    }

    // Footer aggregates: opt-in. The user's `aggregations` from the
    // URL / view drive the footer row — empty list = no footer, full
    // stop. The aggregate-compiler now handles "*" (COUNT(*)), so we
    // pass requests through unchanged. Skipped entirely when groupBy
    // is active (GroupedTable renders its own per-bucket aggregates).
    if (
      !trashMode &&
      fields.length > 0 &&
      effectiveGroupBy.length === 0 &&
      effectiveAggregations.length > 0
    ) {
      const aggResult = await gridsService.record.aggregate({
        tableId: activeTable.id,
        // Aggregates use the SAME effective filter (view ?? URL) +
        // search that the list path used. Was passing parsedFilter
        // which silently ignored saved-view filter.
        filter: mergeSearchIntoFilter(effectiveFilter, rawQ, qFieldIds, fields),
        requests: effectiveAggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
      });
      if (aggResult.ok) aggregates = aggResult.data;
    }
  }

  // Fetch fields for every other table too (for relation picker in the
  // table editor). Cheap: bases stay small in the v1 product.
  for (const t of tables) {
    if (!fieldsByTable[t.id]) {
      fieldsByTable[t.id] = await gridsService.field.listByTable(t.id);
    }
  }

  // Sidebar: fetch ALL views and forms across every table in this base
  // so the user sees the whole catalog regardless of which table they're
  // currently looking at. Per-base small-N — at typical sizes this is
  // a few extra queries totalling < 50ms.
  await Promise.all(
    tables.map(async (t) => {
      const [vs, fs] = await Promise.all([
        gridsService.view.listForTable({
          tableId: t.id,
          userId: user.id,
          userGroups: user.memberofGroupIds,
        }),
        gridsService.form.listForTable(t.id),
      ]);
      viewsByTable[t.id] = vs;
      formsByTable[t.id] = fs;
    }),
  );

  // Per-form effective permission. Needed for the sidebar filter:
  // a form should appear when (publicToken && isActive) OR the user
  // has form-write or higher resolved against it. Forms with a
  // public token are visible to everyone with base-read regardless
  // of form-grant — that's the existing share semantics.
  const formLevels: Record<string, "none" | "read" | "write" | "admin"> = {};
  await Promise.all(
    tables.flatMap((t) =>
      (formsByTable[t.id] ?? []).map(async (form) => {
        formLevels[form.id] = await resolveLevel(user, baseId, t.id, form.id);
      }),
    ),
  );

  const canManageTable = gridsService.permission.hasAtLeast(
    activeTableLevel,
    "admin"
  );
  const canManageBase = gridsService.permission.hasAtLeast(level, "admin");
  const canCreateTables = gridsService.permission.hasAtLeast(level, "write");
  const canWriteRecords = gridsService.permission.hasAtLeast(
    activeTableLevel,
    "write"
  );

  // Used by the sidebar to decide whether the "All records" pseudo-view
  // is the active one (only when no filter/sort/view is set).
  const hasFilterOrSort = filterLeaves.length > 0 || parsedSort.length > 0;

  // activeView resolved + visibility-filtered inside the if (activeTable)
  // block above. Derive the convenience id reference and column-override
  // for renderers below.
  const activeViewId: string | null = activeView?.id ?? null;
  const activeViewColumns = activeView?.query.columns;

  // Slice 8: when groupBy is non-empty (from URL or active view), the
  // records area renders one row per bucket via GroupedTable. The
  // effective values were computed inside the `if (activeTable)` block
  // above so the footer-aggregate block could see them (TDZ guard).
  let groupedBuckets: GroupBucket[] = [];
  let groupedExplode = false;
  if (activeTable && effectiveGroupBy.length > 0 && !trashMode) {
    // Group dispatch reads the SAME effective filter list/aggregate use
    // — saved-view filter ?? URL filter, merged with search. Was passing
    // parsedFilter which dropped both view filter AND search.
    const groupResult = await gridsService.record.group({
      tableId: activeTable.id,
      groupBy: effectiveGroupBy,
      aggregations: effectiveAggregations,
      filter: mergeSearchIntoFilter(effectiveFilter, rawQ, qFieldIds, fields),
      limit: 1000,
    });
    if (groupResult.ok) {
      groupedBuckets = groupResult.data.buckets as GroupBucket[];
      groupedExplode = groupResult.data.explode;
      // Resolve labels for relation-typed bucket keys. The flat-list
      // path's buildLabelCache only sees `records.items` — empty in
      // group mode — so without this step a relation groupBy column
      // would render raw UUIDs. Merge into the existing relationLabels
      // map so the same prop covers both list and group rendering.
      const groupLabels = await gridsService.relations.buildLabelCacheForGroupedKeys(
        groupedBuckets,
        effectiveGroupBy.map((g) => g.fieldId),
        fields,
      );
      relationLabels = { ...relationLabels, ...groupLabels };
    }
  }

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name, href: `/app/grids/${baseShortId}` },
        // Active table is the second-to-last crumb when a view is open;
        // becomes the leaf when no view. The view name (when set) takes
        // the leaf so the user sees exactly which preset they're on.
        ...(activeTable
          ? activeView
            ? [
                { title: activeTable.name, href: `/app/grids/${baseShortId}/table/${activeTable.shortId}` },
                { title: activeView.name },
              ]
            : [{ title: activeTable.name }]
          : []),
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        {/* Mobile-collapsed sidebar — opens on tap, lists tables, the
            base settings link, and any saved views for the active table.
            Mirrors the spaces SpaceSidebar mobile pattern. */}
        <nav class="sidebar-container-mobile">
          <details class="group">
            <summary class="sidebar-mobile-toggle">
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style="background-color:#3b82f6"
              >
                <i class="ti ti-table text-sm" />
              </div>
              <span class="font-semibold truncate flex-1">{base.name}</span>
              <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
                <i class="ti ti-chevron-down text-sm" />
              </span>
            </summary>
            <div class="sidebar-mobile-actions">
              {canManageBase && (
                <a href={`/app/grids/${baseShortId}/settings`} class="sidebar-item-mobile">
                  <i class="ti ti-settings" />
                  Settings
                </a>
              )}
              <a href="/app/grids" class="sidebar-item-mobile">
                <i class="ti ti-layout-grid" />
                All grids
              </a>
              {tables.map((t) => {
                const isActive = activeTable?.id === t.id;
                return (
                  <a
                    href={`/app/grids/${baseShortId}/table/${t.shortId}`}
                    class={`sidebar-item-mobile ${
                      isActive
                        ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200"
                        : ""
                    }`}
                  >
                    <i class="ti ti-table" />
                    {t.name}
                  </a>
                );
              })}
            </div>
          </details>
        </nav>

        <aside class="sidebar-container">
          <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
            {/* Base header — name + single gear for settings. */}
            <div class="relative flex items-center gap-3 pr-7">
              <div class="sidebar-header-icon" style="background-color:#3b82f6">
                <i class="ti ti-table text-xs" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="sidebar-header-title">{base.name}</p>
              </div>
              {canManageBase && (
                <a
                  href={`/app/grids/${baseShortId}/settings`}
                  class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
                  title="Settings"
                >
                  <i class="ti ti-settings text-xs" />
                </a>
              )}
            </div>

            <div class="flex flex-col gap-3">
              <section class="sidebar-group">
                <p class="sidebar-section-title">Actions</p>
                <a href="/app/grids" class="sidebar-item text-xs">
                  <i class="ti ti-layout-grid text-sm" />
                  <span>All Grids</span>
                </a>
              </section>
            </div>

            <div class="sidebar-body">
              {/* Tables */}
              <section class="sidebar-group">
                <p class="sidebar-section-title">Tables</p>
                {tables.length === 0 ? (
                  <p class="text-xs text-dimmed px-2 py-1">No tables yet.</p>
                ) : (
                  tables.map((t) => {
                    const isActive = activeTable?.id === t.id;
                    // Stretched-link pattern: the outer div carries the
                    // visual (padding, hover bg, active state); the
                    // main link grows a `::before` overlay (via
                    // `before:absolute before:inset-0`) so a click
                    // ANYWHERE on the row navigates, not just on the
                    // text. The settings cog sits above the overlay
                    // via `relative z-10` so its own click target
                    // stays distinct.
                    return (
                      <div
                        class={`sidebar-item group relative ${
                          isActive ? "sidebar-item-active" : ""
                        }`}
                      >
                        <a
                          href={`/app/grids/${baseShortId}/table/${t.shortId}`}
                          class="flex min-w-0 flex-1 items-center gap-2 before:absolute before:inset-0 before:content-['']"
                          aria-current={isActive ? "page" : undefined}
                        >
                          <i class="ti ti-table text-sm shrink-0" />
                          {/* `min-w-0` on the truncating span is the
                              load-bearing bit — without it, the flex
                              child defaults to min-width: auto (its
                              content's intrinsic size) and the row
                              refuses to shrink, forcing the sidebar
                              into horizontal scroll. */}
                          <span class="truncate min-w-0">{t.name}</span>
                        </a>
                        {gridsService.permission.hasAtLeast(tableLevels[t.id] ?? "none", "admin") && (
                          <a
                            href={`/app/grids/${baseShortId}/table/${t.shortId}/edit`}
                            class="sidebar-item-action relative z-10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={`Edit table ${t.name}`}
                            title="Edit table"
                          >
                            <i class="ti ti-settings text-xs" />
                          </a>
                        )}
                      </div>
                    );
                  })
                )}
                {canCreateTables && <CreateTableButton baseId={baseId} baseShortId={baseShortId} />}
              </section>

              {/* Dashboards — flat alphabetical list scoped to this base.
                  Active highlight when ?dashboard=<slug> matches. The
                  edit-pencil affordance shows for shared dashboards
                  (when the user has base-write+) and personal ones the
                  user owns. "+ New dashboard" sits at the bottom and
                  opens an inline form prompt. */}
              {(() => {
                if (dashboardsForBase.length === 0 && !canCreateTables) return null;
                const sorted = [...dashboardsForBase].sort((a, b) =>
                  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
                );
                return (
                  <section class="sidebar-group">
                    <p class="sidebar-section-title">Dashboards</p>
                    {sorted.map((d) => {
                      const isActive = activeDashboard?.id === d.id;
                      const canEdit =
                        d.ownerUserId === user.id ||
                        (d.ownerUserId === null && canWriteRecords);
                      return (
                        <div
                          class={`sidebar-item group relative ${isActive ? "sidebar-item-active" : ""}`}
                        >
                          <a
                            href={`/app/grids/${baseShortId}/dashboard/${d.shortId}`}
                            class="flex min-w-0 flex-1 items-center gap-2 before:absolute before:inset-0 before:content-['']"
                            aria-current={isActive ? "page" : undefined}
                          >
                            <i class="ti ti-layout-dashboard text-sm shrink-0" />
                            <span class="truncate min-w-0">{d.name}</span>
                            {/* "Default" badge surfaces inline so the
                                user knows which dashboard the base
                                opens to. The Settings page is the
                                canonical place to change it. */}
                            {base.defaultDashboardId === d.id && (
                              <span class="text-[9px] uppercase tracking-wider text-dimmed shrink-0">
                                default
                              </span>
                            )}
                          </a>
                          {canEdit && (
                            <a
                              href={`/app/grids/${baseShortId}/dashboard/${d.shortId}/edit`}
                              class="sidebar-item-action relative z-10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                              aria-label={`Edit dashboard ${d.name}`}
                              title="Dashboard settings"
                            >
                              <i class="ti ti-settings text-xs" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                    {canCreateTables && (
                      <CreateDashboardButton baseId={baseId} baseShortId={baseShortId} />
                    )}
                  </section>
                );
              })()}

              {/* Views — flat alphabetical list across the whole base.
                  Each row carries a dim "· table" suffix so the user
                  still knows which table it belongs to without the
                  per-table subheader noise. v3.1: a view-click jumps to
                  the view's table AND applies the view in one go. */}
              {(() => {
                type ViewRow = { view: typeof tables[number] extends never ? never : NonNullable<(typeof viewsByTable)[string]>[number]; table: typeof tables[number] };
                const allViews: ViewRow[] = [];
                for (const t of tables) {
                  for (const view of viewsByTable[t.id] ?? []) {
                    allViews.push({ view, table: t });
                  }
                }
                if (allViews.length === 0) return null;
                allViews.sort((a, b) =>
                  a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base" }),
                );
                return (
                  <section class="sidebar-group">
                    <p class="sidebar-section-title">Views</p>
                    {allViews.map(({ view, table: t }) => {
                      // Path-based URL — resolveEffectiveQuery still pulls
                      // filter/sort/groupBy/aggregations from `view.query`
                      // at render, so the link stays a pure pointer to
                      // "the view, as it stands". Toolbar edits write
                      // their own URL params on top via the island, which
                      // then act as explicit overrides via the same merge.
                      const url = `/app/grids/${baseShortId}/table/${t.shortId}/view/${view.shortId}`;
                      const canEdit =
                        view.ownerUserId === user.id ||
                        (view.ownerUserId === null && canWriteRecords);
                      const isActive =
                        activeTable?.id === t.id && activeViewId === view.id;
                      // Match the table-row pattern: outer div carries
                      // the sidebar-item visual, link fills it (with
                      // min-w-0 so truncate works), settings icon is an
                      // inline sibling. Previously the icon sat outside
                      // the box.
                      return (
                        <div
                          class={`sidebar-item group relative ${isActive ? "sidebar-item-active" : ""}`}
                        >
                          <a
                            href={url}
                            class="flex min-w-0 flex-1 items-center gap-2 before:absolute before:inset-0 before:content-['']"
                            aria-current={isActive ? "page" : undefined}
                          >
                            <i class="ti ti-table-spark text-sm shrink-0" />
                            <span class="truncate min-w-0">{view.name}</span>
                          </a>
                          {canEdit && (
                            <a
                              href={`/app/grids/${baseShortId}/table/${t.shortId}/view/${view.shortId}/edit`}
                              class="sidebar-item-action relative z-10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                              aria-label={`Edit view ${view.name}`}
                              title="View settings"
                            >
                              <i class="ti ti-settings text-xs" />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </section>
                );
              })()}

              {/* Forms — flat alphabetical. A form appears here when
                  it's public+active OR the user has effective form-
                  write (or higher) on it. Click opens the authenticated
                  submit modal (no external-link to /share — public
                  sharing happens from the FormsManager copy-link). */}
              {(() => {
                type FormRow = { form: NonNullable<(typeof formsByTable)[string]>[number]; table: typeof tables[number] };
                const allForms: FormRow[] = [];
                for (const t of tables) {
                  for (const form of formsByTable[t.id] ?? []) {
                    if (!form.isActive) continue;
                    const effectiveLevel = formLevels[form.id] ?? "none";
                    const canSubmit =
                      Boolean(form.publicToken) ||
                      gridsService.permission.hasAtLeast(effectiveLevel, "write");
                    if (canSubmit) allForms.push({ form, table: t });
                  }
                }
                if (allForms.length === 0) return null;
                allForms.sort((a, b) =>
                  a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }),
                );
                return (
                  <section class="sidebar-group">
                    <p class="sidebar-section-title">Forms</p>
                    {allForms.map(({ form, table: t }) => (
                      <FormSidebarEntry
                        form={form}
                        fields={fieldsByTable[t.id] ?? []}
                      />
                    ))}
                  </section>
                );
              })()}
            </div>
          </div>
        </aside>

        {/* Main: dashboard layout OR records table.
            Dashboard mode wins when ?dashboard=<slug> is set (or the
            base default redirected here); records-mode is the
            existing fallback. The sidebar above renders the same in
            both modes so the user can hop with one click. */}
        {/* `<main>` is `overflow-hidden flex flex-col` so it acts as
            a fixed-height frame for whatever it contains; the actual
            scroll lives one level deeper. Pre-fix, main had
            `overflow-auto` which stole the y-scroll context — so the
            records-view's internal body-scroll (the contacts-style
            independent table/detail-panel scroll) never kicked in,
            because main was already absorbing the overflow and the
            search bar / toolbar scrolled along with the rows. */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {renderDashboard ? (
            <div class="flex-1 min-h-0 overflow-y-auto">
              <DashboardLayout
                dashboard={renderDashboard}
                widgetData={widgetData}
                viewStatsData={viewStatsData}
                baseShortId={baseShortId}
              />
            </div>
          ) : activeTable ? (
            <div class="flex-1 min-h-0 flex flex-col">
              {/* Records-area lives in a single client-side island
                  (Phase 2 of the RecordsView refactor). It owns the
                  query / cursor / selectedRecord state machine; this
                  JSX just hands it the SSR-parsed initial state and
                  the first /tables/:id/query response. */}
              <RecordsView
                baseId={baseId}
                tableId={activeTable.id}
                baseShortId={base.shortId}
                tableShortId={activeTable.shortId}
                viewShortId={activeView?.shortId ?? null}
                fields={fields}
                canWrite={canWriteRecords}
                trashMode={trashMode}
                viewMode={activeViewId !== null}
                initialState={{
                  // The island's source-signal seeds from these fields
                  // and refetches when they change. Hand it the SAME
                  // effective query (saved-view + URL overrides) SSR
                  // used to fetch initial rows; otherwise the first
                  // refetch / pagination silently reverts to URL-only.
                  // includeDeleted is `trashMode` here — trash mode is
                  // a top-level URL flag (`?trash=1`), independent of
                  // the saved view's includeDeleted bit.
                  query: {
                    filter: effectiveFilter ?? undefined,
                    sort: effectiveSort,
                    groupBy: effectiveGroupBy,
                    aggregations: effectiveAggregations,
                    includeDeleted: trashMode || effectiveIncludeDeleted,
                  },
                  cursor: rawCursor,
                  selectedRecordId,
                  search: { q: rawQ, fieldIds: qFieldIds },
                }}
                initialData={{
                  items: records.items,
                  buckets: groupedBuckets,
                  aggregates,
                  nextCursor: records.nextCursor,
                  explode: groupedExplode,
                }}
                initialSelectedRecord={selectedRecord}
                relationLabels={relationLabels}
                viewColumns={activeViewColumns}
                searchableFields={filterSearchableFields(fields)}
                groupedExplode={groupedExplode}
                activeViewQuery={activeView?.query ?? null}
              />
            </div>
          ) : (
            <div class="paper p-8 text-center text-sm text-dimmed">
              {canCreateTables
                ? 'No tables yet. Click "New table" in the sidebar.'
                : "No tables. You don't have write access to create one."}
            </div>
          )}
        </main>

        {/* Detail panel column lives inside RecordsView now — it renders
            conditionally based on the selectedRecordId signal so it
            appears/disappears in-place without any DOM-class flipping. */}
      </div>
    </Layout>
  );
});
