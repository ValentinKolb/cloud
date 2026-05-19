import { hasRole } from "@valentinkolb/cloud/contracts";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppWorkspace } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import type { Field, FilterTree, SortSpec } from "../../service";
import { gridsService } from "../../service";
import { resolveWidgetData, type WidgetData } from "../../service/dashboard-widget-data";
import { filterSearchableFields } from "../../service/search";
import DashboardLayout from "../_components/dashboard/DashboardLayout";
import DashboardWysiwygEditor from "../_components/dashboard/DashboardWysiwygEditor.island";
import { resolveEffectiveQuery } from "../_components/records-view/effective-query";
import { parseRecordsState } from "../_components/records-view/query-url";
import RecordsView from "../_components/records-view/RecordsView.island";
import CreateDashboardButton from "../_components/sidebar/CreateDashboardButton.island";
import CreateTableButton from "../_components/sidebar/CreateTableButton.island";
import FormSidebarEntry from "../_components/sidebar/FormSidebarEntry.island";
import RememberGridsPath from "../_components/sidebar/RememberGridsPath.island";
import type { GroupBucket } from "../_components/table/GroupedTable";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
};

const resolveBaseLevel = async (user: AuthUser, baseId: string) => {
  if (hasRole(user, "admin")) return "admin" as const;
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
  });
  return gridsService.permission.resolve(grants, { baseId });
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
  // table / view / dashboard from path params. Alpha has no URL
  // backwards-compat layer; one canonical route shape keeps the state
  // model simple.
  const baseShortId = c.req.param("baseId")!;
  const trashMode = c.req.query("trash") === "1";
  const activeTableSlug = c.req.param("tableId") ?? null;
  const activeViewSlug = c.req.param("viewId") ?? null;
  const activeDashboardSlug = c.req.param("dashboardId") ?? null;
  const adminModeRequested = c.req.query("edit") === "true";
  const urlWithParam = (href: string, key: string, value: string) => {
    const url = new URL(href, "http://grids.local");
    url.searchParams.set(key, value);
    return `${url.pathname}${url.search}`;
  };
  const urlWithoutParams = (href: string, keys: string[]) => {
    const url = new URL(href, "http://grids.local");
    for (const key of keys) url.searchParams.delete(key);
    return `${url.pathname}${url.search}`;
  };
  const keepEdit = (href: string) => (adminModeRequested ? urlWithParam(href, "edit", "true") : href);
  const currentPath = new URL(c.req.url).pathname + new URL(c.req.url).search;
  const rememberPath = urlWithoutParams(currentPath, ["edit", "form"]);
  const editModeOnHref = urlWithParam(urlWithoutParams(currentPath, ["form"]), "edit", "true");
  const editModeOffHref = urlWithoutParams(currentPath, ["edit", "form"]);
  const editModeToggleHref = adminModeRequested ? editModeOffHref : editModeOnHref;
  const sidebarStateClass = (active: boolean) =>
    active
      ? adminModeRequested
        ? "bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-200"
        : "sidebar-item-active"
      : adminModeRequested
        ? "text-emerald-700 hover:bg-emerald-50/70 hover:text-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-200"
        : "";

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
    (a): a is AggregationRaw => a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
  );
  const rawQ = recordsState.search.q.trim();
  const qFieldIds = recordsState.search.fieldIds;
  const searchOverride = recordsState.search.override === true;
  const rawCursor = recordsState.cursor;
  const selectedRecordId = recordsState.selectedRecordId;

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
  const activeTableFromSlug = activeTableSlug ? await gridsService.table.getByIdOrShortId(baseId, activeTableSlug) : null;
  const activeTableId = activeTableFromSlug?.id ?? null;

  // Resolve the active dashboard. Same tolerant lookup pattern as the
  // table/view resolvers — accepts slug or UUID. Permission gating
  // happens via listForBase in dashboard mode (only readable dashboards
  // hit the page).
  const activeDashboard = activeDashboardSlug ? await gridsService.dashboard.getByIdOrShortId(baseId, activeDashboardSlug) : null;

  const level = await resolveBaseLevel(user, baseId);
  if (!gridsService.permission.hasAtLeast(level, "read")) {
    return () => (
      <Layout c={c} title="Access denied">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-lock text-sm" /> No access to this base
        </div>
      </Layout>
    );
  }

  const catalog = await gridsService.base.catalog({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
    isAdmin: hasRole(user, "admin"),
  });
  const dashboardsForBase = catalog.dashboards;
  const renderDashboard = activeDashboard ? (dashboardsForBase.find((d) => d.id === activeDashboard.id) ?? null) : null;
  const tables = catalog.tables;
  const tableShortIds = Object.fromEntries(tables.map((t) => [t.id, t.shortId]));
  const tableLevels = catalog.tableLevels;
  const fieldsByTable = catalog.fieldsByTable;
  const viewsByTable = catalog.viewsByTable;
  const formsByTable = catalog.formsByTable;
  const formAccessEntriesByTable: Record<string, Record<string, AccessEntry[]>> = {};
  const tableById = Object.fromEntries(tables.map((t) => [t.id, t]));
  const sidebarForms = catalog.sidebarForms
    .map(({ form, tableId }) => {
      const table = tableById[tableId];
      return table ? { form, table } : null;
    })
    .filter((entry): entry is { form: (typeof catalog.sidebarForms)[number]["form"]; table: (typeof tables)[number] } => entry !== null)
    .sort((a, b) => a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }));

  // Pre-fetch widget data when dashboard mode is active. The unified
  // row schema means every cell is a Widget with its own kind — flat
  // out into one fan-out, no per-row-kind branching. `resolveWidgetData`
  // handles all five cell kinds (stat / view / chart / view-stats /
  // form). Slowest widget caps the total render time, not the sum.
  const widgetData: Record<string, WidgetData> = {};
  if (renderDashboard) {
    const widgets = renderDashboard.config.rows.flatMap((r) => r.cells);
    const results = await Promise.all(
      widgets.map((w) =>
        resolveWidgetData(w, {
          userId: user.id,
          userGroups: user.memberofGroupIds,
          isAdmin: hasRole(user, "admin"),
        }).then((data) => [w.id, data] as const),
      ),
    );
    for (const [id, data] of results) widgetData[id] = data;
  }

  // Fall back to the first table ONLY when neither a table nor a
  // dashboard is pinned in the URL. Pre-fix, the fallback fired
  // unconditionally and marked the first table as active in the
  // sidebar even while the user was viewing a dashboard — so e.g.
  // clicking "Bookshop overview" left "Genres" highlighted as if
  // both routes were active simultaneously.
  const activeTable = activeTableId ? (tables.find((t) => t.id === activeTableId) ?? null) : activeDashboard ? null : (tables[0] ?? null);

  // Resolve the active view slug AFTER the active table — view slugs
  // are scoped per-table. activeViewId stays null when no view is set
  // OR the URL refers to a view that doesn't exist on this table OR
  // the user can't see this view per ACL (visibility check happens
  // below once viewsForTable is loaded).
  const candidateView = activeTable && activeViewSlug ? await gridsService.view.getByIdOrShortId(activeTable.id, activeViewSlug) : null;

  type RecordsPage = {
    items: import("../../service").GridRecord[];
    nextCursor: string | null;
    aggregates?: Record<string, unknown>;
  };
  let fields: Field[] = [];
  let records: RecordsPage = { items: [], nextCursor: null };
  let aggregates: Record<string, unknown> = {};
  let viewsForTable: Awaited<ReturnType<typeof gridsService.view.listForTable>> = [];
  let formsForTable: Awaited<ReturnType<typeof gridsService.form.listForTable>> = [];
  let activeTableAccessEntries: Awaited<ReturnType<typeof gridsService.access.listForTable>> = [];
  let activeFormAccessEntries: Record<string, AccessEntry[]> = {};
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
  let effectiveGroupSort: import("../../contracts").GroupSortSpec[] = [];
  let effectiveAggregations: AggregationRaw[] = [];
  let effectiveIncludeDeleted = false;
  let effectiveSearch: { q: string; fieldIds: string[]; override?: boolean } = {
    q: "",
    fieldIds: [],
    override: searchOverride,
  };
  let activeTableLevel = level;
  let activeDashboardAccessEntries: Awaited<ReturnType<typeof gridsService.access.listForDashboard>> = [];
  let activeViewAccessEntries: Awaited<ReturnType<typeof gridsService.access.listForView>> = [];
  let selectedRecord: import("../../service").GridRecord | null = null;
  let relationLabels: Record<string, string> = {};

  // activeView is visibility-filtered: a candidate view from
  // getByIdOrShortId is only adopted when listForTable (which applies
  // the view ACL) actually surfaces it for this user. Otherwise we
  // fall back to "no active view" rather than leaking name/columns
  // for a view the user can't see (chunk 8 critical).
  let activeView: import("../../service").View | null = null;

  if (activeTable) {
    activeTableLevel = tableLevels[activeTable.id] ?? "none";
    fields = fieldsByTable[activeTable.id] ?? [];
    viewsForTable = viewsByTable[activeTable.id] ?? [];
    activeView = candidateView ? (viewsForTable.find((v) => v.id === candidateView.id) ?? null) : null;

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
        search: { q: rawQ, fieldIds: qFieldIds, override: searchOverride },
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
    effectiveSearch = effective.search
      ? {
          q: effective.search.q,
          fieldIds: effective.search.fieldIds ?? [],
          override: searchOverride,
        }
      : { q: "", fieldIds: [], override: searchOverride };
    const searchSpec = effective.search ?? null;
    const viewLimit = effective.limit;
    const effectiveLimit = viewLimit !== undefined ? Math.min(100, viewLimit) : 100;

    // Hoist groupBy / aggregations to the outer scope so the footer-
    // aggregate block + the renderer at the bottom can read them.
    // The view's stored aggregations may include median/earliest/latest
    // — narrow to the 7 kinds the SSR-side AggregationRaw supports.
    effectiveGroupBy = (effective.groupBy ?? []) as GroupByRaw[];
    effectiveGroupSort = effective.groupSort ?? [];
    effectiveAggregations = (effective.aggregations ?? []).filter(
      (a): a is AggregationRaw => a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
    );

    const listResult = await gridsService.record.list({
      tableId: activeTable.id,
      limit: effectiveLimit,
      includeDeleted: effectiveIncludeDeleted,
      deletedOnly: trashMode,
      filter: effectiveFilter,
      search: searchSpec,
      sort: effectiveSort,
      cursor: rawCursor,
      // SSR initial render uses includeRelations + viewer so the
      // first paint already carries `.expanded` on every record;
      // the records-view island reads `record.expanded` directly
      // for relation cells via <DatabaseTable>. Per-target-table
      // perm gating drops tables the viewer can't read.
      includeRelations: true,
      viewer: {
        userId: user.id,
        userGroups: user.memberofGroupIds,
        isAdmin: hasRole(user, "admin"),
      },
    });
    if (listResult.ok) {
      // Top-N views: drop nextCursor — pagination beyond the cap doesn't
      // make sense for "show me the first N" queries.
      const data = viewLimit !== undefined ? { ...listResult.data, nextCursor: null } : listResult.data;
      records = data;
      aggregates = records.aggregates ?? {};
    }
    formsForTable = formsByTable[activeTable.id] ?? [];
    if (gridsService.permission.hasAtLeast(activeTableLevel, "admin")) {
      activeTableAccessEntries = await gridsService.access.listForTable(activeTable.id);
      for (const form of formsForTable) {
        if (form.isDefault) continue;
        activeFormAccessEntries[form.id] = await gridsService.access.listForForm(form.id);
      }
      formAccessEntriesByTable[activeTable.id] = activeFormAccessEntries;
    }

    // Resolve the labels for every linked record across the visible page.
    // ONE round-trip per target table; passed to the table renderer +
    // RecordDetailPanel so relation cells render presentable values
    // instead of raw UUIDs.
    relationLabels = await gridsService.relations.buildLabelCache(records.items, fields);

    // Resolve the selected record from the URL — prefer the row already in
    // the visible page, fall back to a direct fetch (covers deep links to a
    // record that's beyond the first 100-row page).
    if (selectedRecordId) {
      selectedRecord =
        records.items.find((r) => r.id === selectedRecordId) ?? (await gridsService.record.get(activeTable.id, selectedRecordId));
    }

    // Footer aggregates: opt-in. The user's `aggregations` from the
    // URL / view drive the footer row — empty list = no footer, full
    // stop. The aggregate-compiler now handles "*" (COUNT(*)), so we
    // pass requests through unchanged. Skipped entirely when groupBy
    // is active (GroupedTable renders its own per-bucket aggregates).
    if (!trashMode && fields.length > 0 && effectiveGroupBy.length === 0 && effectiveAggregations.length > 0) {
      const aggResult = await gridsService.record.aggregate({
        tableId: activeTable.id,
        // Aggregates use the SAME effective filter (view ?? URL) +
        // search that the list path used. Was passing parsedFilter
        // which silently ignored saved-view filter.
        filter: effectiveFilter,
        search: searchSpec,
        includeDeleted: effectiveIncludeDeleted,
        deletedOnly: trashMode,
        requests: effectiveAggregations.map((a) => ({ fieldId: a.fieldId, agg: a.agg })),
        viewer: {
          userId: user.id,
          userGroups: user.memberofGroupIds,
          isAdmin: hasRole(user, "admin"),
        },
      });
      if (aggResult.ok) aggregates = { ...aggregates, ...aggResult.data };
    }
  }

  await Promise.all(
    tables
      .filter((t) => gridsService.permission.hasAtLeast(tableLevels[t.id] ?? "none", "admin"))
      .filter((t) => !formAccessEntriesByTable[t.id])
      .map(async (t) => {
        const entries: Record<string, AccessEntry[]> = {};
        await Promise.all(
          (formsByTable[t.id] ?? [])
            .filter((form) => !form.isDefault)
            .map(async (form) => {
              entries[form.id] = await gridsService.access.listForForm(form.id);
            }),
        );
        formAccessEntriesByTable[t.id] = entries;
      }),
  );

  const canManageBase = gridsService.permission.hasAtLeast(level, "admin");
  const canCreateTables = gridsService.permission.hasAtLeast(level, "write");
  const canWriteRecords = gridsService.permission.hasAtLeast(activeTableLevel, "write");
  const canManageActiveTable = gridsService.permission.hasAtLeast(activeTableLevel, "admin");
  const canEditActiveView =
    !!activeView &&
    (activeView.ownerUserId === null
      ? gridsService.permission.hasAtLeast(activeTableLevel, "write")
      : activeView.ownerUserId === user.id && gridsService.permission.hasAtLeast(activeTableLevel, "read"));
  if (activeView && canEditActiveView) {
    activeViewAccessEntries = await gridsService.access.listForView(activeView.id);
  }
  const canEditActiveDashboard =
    !!renderDashboard && (renderDashboard.ownerUserId === user.id || (renderDashboard.ownerUserId === null && canManageBase));
  if (renderDashboard && canEditActiveDashboard) {
    activeDashboardAccessEntries = await gridsService.access.listForDashboard(renderDashboard.id);
  }
  const canUseEditMode =
    canCreateTables ||
    tables.some((t) => gridsService.permission.hasAtLeast(tableLevels[t.id] ?? "none", "admin")) ||
    dashboardsForBase.some((d) => d.ownerUserId === user.id || (d.ownerUserId === null && canManageBase));

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
      groupSort: effectiveGroupSort,
      filter: effectiveFilter,
      search: effectiveSearch.q ? { q: effectiveSearch.q, fieldIds: effectiveSearch.fieldIds } : null,
      limit: 1000,
      viewer: {
        userId: user.id,
        userGroups: user.memberofGroupIds,
        isAdmin: hasRole(user, "admin"),
      },
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
            ? [{ title: activeTable.name, href: `/app/grids/${baseShortId}/table/${activeTable.shortId}` }, { title: activeView.name }]
            : [{ title: activeTable.name }]
          : []),
      ]}
    >
      <RememberGridsPath path={rememberPath} />
      <AppWorkspace class="flex-1 min-h-0">
        <AppWorkspace.Sidebar>
          <AppWorkspace.SidebarHeader
            title={base.name}
            icon="ti ti-table"
            iconStyle="background-color:#3b82f6"
            action={
              canManageBase ? (
                <a
                  href={keepEdit(`/app/grids/${baseShortId}/settings`)}
                  class="absolute right-0 top-0 inline-flex h-6 w-6 items-center justify-center text-dimmed transition-colors hover:text-primary"
                  title="Settings"
                >
                  <i class="ti ti-settings text-xs" />
                </a>
              ) : undefined
            }
          />
          <AppWorkspace.SidebarMobile>
            <AppWorkspace.SidebarMobileItems>
              {canUseEditMode && (
                <AppWorkspace.SidebarItem href={editModeToggleHref} icon={adminModeRequested ? "ti ti-check" : "ti ti-tool"}>
                  {adminModeRequested ? "Done editing" : "Edit mode"}
                </AppWorkspace.SidebarItem>
              )}
              {canManageBase && (
                <AppWorkspace.SidebarItem href={keepEdit(`/app/grids/${baseShortId}/settings`)} icon="ti ti-settings">
                  Settings
                </AppWorkspace.SidebarItem>
              )}
              <AppWorkspace.SidebarItem href="/app/grids" icon="ti ti-layout-grid">
                All grids
              </AppWorkspace.SidebarItem>
              {tables.map((t) => {
                const isActive = activeTable?.id === t.id;
                return (
                  <AppWorkspace.SidebarItem
                    href={keepEdit(`/app/grids/${baseShortId}/table/${t.shortId}`)}
                    icon={t.icon ?? "ti ti-table"}
                    active={isActive}
                    activeClass={
                      adminModeRequested
                        ? "border-emerald-500/35 bg-emerald-50/70 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : undefined
                    }
                    class={adminModeRequested && !isActive ? "text-emerald-700 dark:text-emerald-300" : undefined}
                  >
                    {t.name}
                  </AppWorkspace.SidebarItem>
                );
              })}
            </AppWorkspace.SidebarMobileItems>
          </AppWorkspace.SidebarMobile>

          <AppWorkspace.SidebarDesktop>
            <div class="flex flex-col gap-3">
              <AppWorkspace.SidebarSection title="Actions">
                <AppWorkspace.SidebarItem href="/app/grids" icon="ti ti-layout-grid">
                  All Grids
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarSection>
            </div>

            <AppWorkspace.SidebarBody>
              {(() => {
                if (dashboardsForBase.length === 0 && !canCreateTables) return null;
                const sorted = [...dashboardsForBase].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
                return (
                  <AppWorkspace.SidebarSection title="Dashboards">
                    {sorted.map((d) => {
                      const isActive = activeDashboard?.id === d.id;
                      return (
                        <AppWorkspace.SidebarItem
                          href={keepEdit(`/app/grids/${baseShortId}/dashboard/${d.shortId}`)}
                          icon={d.icon ?? "ti ti-layout-dashboard"}
                          active={isActive}
                          activeClass={adminModeRequested ? sidebarStateClass(true) : undefined}
                          class={!isActive ? sidebarStateClass(false) : undefined}
                          meta={
                            base.defaultDashboardId === d.id ? <span class="text-[9px] uppercase tracking-wider">default</span> : undefined
                          }
                        >
                          {d.name}
                        </AppWorkspace.SidebarItem>
                      );
                    })}
                    {canCreateTables && <CreateDashboardButton baseId={baseId} baseShortId={baseShortId} />}
                  </AppWorkspace.SidebarSection>
                );
              })()}

              {(() => {
                if (sidebarForms.length === 0) return null;
                return (
                  <AppWorkspace.SidebarSection title="Forms">
                    {sidebarForms.map(({ form, table: t }) => {
                      const canEditForm = gridsService.permission.hasAtLeast(tableLevels[t.id] ?? "none", "admin");
                      return (
                        <FormSidebarEntry
                          form={form}
                          fields={fieldsByTable[t.id] ?? []}
                          editMode={adminModeRequested && canEditForm}
                          initialAccessEntries={formAccessEntriesByTable[t.id]?.[form.id] ?? []}
                        />
                      );
                    })}
                  </AppWorkspace.SidebarSection>
                );
              })()}

              <AppWorkspace.SidebarSection title="Tables">
                {tables.length === 0 ? (
                  <p class="text-xs text-dimmed px-2 py-1">No tables yet.</p>
                ) : (
                  tables.map((t) => {
                    const isActive = activeTable?.id === t.id;
                    return (
                      <AppWorkspace.SidebarItem
                        href={keepEdit(`/app/grids/${baseShortId}/table/${t.shortId}`)}
                        icon={t.icon ?? "ti ti-table"}
                        active={isActive}
                        activeClass={adminModeRequested ? sidebarStateClass(true) : undefined}
                        class={!isActive ? sidebarStateClass(false) : undefined}
                      >
                        {t.name}
                      </AppWorkspace.SidebarItem>
                    );
                  })
                )}
                {canCreateTables && <CreateTableButton baseId={baseId} baseShortId={baseShortId} />}
              </AppWorkspace.SidebarSection>

              {(() => {
                type ViewRow = {
                  view: (typeof tables)[number] extends never ? never : NonNullable<(typeof viewsByTable)[string]>[number];
                  table: (typeof tables)[number];
                };
                const allViews: ViewRow[] = [];
                for (const t of tables) {
                  for (const view of viewsByTable[t.id] ?? []) {
                    allViews.push({ view, table: t });
                  }
                }
                if (allViews.length === 0) return null;
                allViews.sort((a, b) => a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base" }));
                return (
                  <AppWorkspace.SidebarSection title="Views">
                    {allViews.map(({ view, table: t }) => {
                      // Path-based URL — resolveEffectiveQuery still pulls
                      // filter/sort/groupBy/aggregations from `view.query`
                      // at render, so the link stays a pure pointer to
                      // "the view, as it stands". Toolbar edits write
                      // their own URL params on top via the island, which
                      // then act as explicit overrides via the same merge.
                      const url = `/app/grids/${baseShortId}/table/${t.shortId}/view/${view.shortId}`;
                      const isActive = activeTable?.id === t.id && activeViewId === view.id;
                      return (
                        <AppWorkspace.SidebarItem
                          href={keepEdit(url)}
                          icon={view.icon ?? "ti ti-table-spark"}
                          active={isActive}
                          activeClass={adminModeRequested ? sidebarStateClass(true) : undefined}
                          class={!isActive ? sidebarStateClass(false) : undefined}
                        >
                          {view.name}
                        </AppWorkspace.SidebarItem>
                      );
                    })}
                  </AppWorkspace.SidebarSection>
                );
              })()}
            </AppWorkspace.SidebarBody>
            {canUseEditMode && (
              <AppWorkspace.SidebarFooter class="pt-2">
                <AppWorkspace.SidebarItem
                  href={editModeToggleHref}
                  icon={adminModeRequested ? "ti ti-check" : "ti ti-tool"}
                  class={
                    adminModeRequested
                      ? "bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                      : undefined
                  }
                >
                  {adminModeRequested ? "Done editing" : "Edit mode"}
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarFooter>
            )}
          </AppWorkspace.SidebarDesktop>
        </AppWorkspace.Sidebar>

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
        <AppWorkspace.Main>
          {renderDashboard ? (
            <div class="flex-1 min-h-0 overflow-y-auto">
              {adminModeRequested && canEditActiveDashboard ? (
                <DashboardWysiwygEditor
                  baseShortId={baseShortId}
                  initialDashboard={renderDashboard}
                  isBaseDefault={base.defaultDashboardId === renderDashboard.id}
                  tables={tables.map((t) => ({ id: t.id, name: t.name, slug: t.shortId }))}
                  dashboards={dashboardsForBase}
                  fieldsByTable={fieldsByTable}
                  viewsByTable={viewsByTable}
                  formsByTable={formsByTable}
                  initialAccessEntries={activeDashboardAccessEntries}
                  canEditAccess={canManageBase}
                  widgetData={widgetData}
                />
              ) : (
                <DashboardLayout dashboard={renderDashboard} widgetData={widgetData} baseShortId={baseShortId} />
              )}
            </div>
          ) : activeTable ? (
            <div class="flex-1 min-h-0 flex flex-col">
              <RecordsView
                baseId={baseId}
                tableId={activeTable.id}
                tableName={activeTable.name}
                tableDescription={activeTable.description ?? null}
                tableIcon={activeTable.icon ?? null}
                tableColumns={activeTable.columns}
                disableDirectInsert={activeTable.disableDirectInsert}
                baseShortId={base.shortId}
                tableShortId={activeTable.shortId}
                tableShortIds={tableShortIds}
                viewShortId={activeView?.shortId ?? null}
                fields={fields}
                forms={formsForTable}
                canWrite={canWriteRecords}
                canManageTable={canManageActiveTable}
                trashMode={trashMode}
                initialAdminMode={adminModeRequested}
                initialAccessEntries={activeTableAccessEntries}
                initialFormAccessEntries={activeFormAccessEntries}
                activeView={activeView}
                activeViewAccessEntries={activeViewAccessEntries}
                canEditActiveView={canEditActiveView}
                otherTables={tables.filter((t) => t.id !== activeTable.id).map((t) => ({ id: t.id, name: t.name }))}
                fieldsByTable={fieldsByTable}
                viewMode={activeViewId !== null}
                initialState={{
                  // The island's source-signal seeds from these fields
                  // and refetches when they change. Hand it the SAME
                  // effective query (saved-view + URL overrides) SSR
                  // used to fetch initial rows; otherwise the first
                  // refetch / pagination silently reverts to URL-only.
                  // deletedOnly is `trashMode` here — trash mode is a
                  // top-level URL flag (`?trash=1`), independent of
                  // the saved view's includeDeleted bit.
                  query: {
                    filter: effectiveFilter ?? undefined,
                    sort: effectiveSort,
                    groupBy: effectiveGroupBy,
                    aggregations: effectiveAggregations,
                    includeDeleted: effectiveIncludeDeleted,
                    deletedOnly: trashMode,
                  },
                  cursor: rawCursor,
                  selectedRecordId,
                  search: effectiveSearch,
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
        </AppWorkspace.Main>

        {/* Detail panel column lives inside RecordsView now — it renders
            conditionally based on the selectedRecordId signal so it
            appears/disappears in-place without any DOM-class flipping. */}
      </AppWorkspace>
    </Layout>
  );
});
