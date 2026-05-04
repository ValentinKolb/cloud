import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../service";
import RecordsView from "../_components/records-view/RecordsView.island";
import type { GroupBucket } from "../_components/GroupedTable";
import CreateTableButton from "../_components/CreateTableButton.island";
import type { FilterTree, SortSpec, Field } from "../../service";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
};

// Field types the free-text search will apply `contains` against. Mirrors
// the TEXT_OPS family in filter-ops.ts: anything that's a text-shaped
// JSONB scalar. select / boolean / number etc. are intentionally excluded
// — searching them as text would be misleading at best.
const SEARCHABLE_TYPES = new Set([
  "text",
  "longtext",
  "email",
  "url",
  "phone",
  "slug",
  "barcode",
  "isbn",
]);

const filterSearchableFields = (fields: Field[]): Field[] =>
  fields.filter((f) => !f.deletedAt && SEARCHABLE_TYPES.has(f.type));

/**
 * Combines the user's filter (from the URL) with a free-text search
 * predicate. The search becomes an OR across `contains q` for every
 * scoped field; that group is then AND'd into the user's filter so
 * `filter ∧ (any of the searchable cols matches q)` holds.
 *
 * - empty q → returns the original filter unchanged (no search applied)
 * - empty qFieldIds → defaults to every searchable field on the table
 * - a non-AND user filter is wrapped: `{op:AND, filters:[F, search]}`
 */
const mergeSearchIntoFilter = (
  userFilter: FilterTree | null,
  q: string,
  qFieldIds: string[],
  fields: Field[],
): FilterTree | null => {
  const query = q.trim();
  if (!query) return userFilter;
  const searchable = filterSearchableFields(fields);
  if (searchable.length === 0) return userFilter;

  // Honour an explicit column-scope (drop unknown ids); otherwise search every
  // searchable column on the table.
  const scopedIds =
    qFieldIds.length > 0
      ? qFieldIds.filter((id) => searchable.some((f) => f.id === id))
      : searchable.map((f) => f.id);
  if (scopedIds.length === 0) return userFilter;

  const searchGroup: FilterTree = {
    op: "OR",
    filters: scopedIds.map((fid) => ({
      fieldId: fid,
      op: "contains",
      value: query,
      caseInsensitive: true,
    })),
  };

  if (!userFilter) return searchGroup;
  if (
    typeof userFilter === "object" &&
    "op" in userFilter &&
    userFilter.op === "AND" &&
    Array.isArray((userFilter as { filters: FilterTree[] }).filters)
  ) {
    return {
      op: "AND",
      filters: [...(userFilter as { filters: FilterTree[] }).filters, searchGroup],
    };
  }
  return { op: "AND", filters: [userFilter, searchGroup] };
};

const resolveLevel = async (
  user: AuthUser,
  baseId: string,
  tableId?: string
) => {
  if (hasRole(user, "admin")) return "admin" as const;
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
    tableId: tableId ?? null,
  });
  return gridsService.permission.resolve(
    grants,
    tableId ? { baseId, tableId } : { baseId }
  );
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const baseId = c.req.param("baseId");
  const activeTableId = c.req.query("table") ?? null;
  const trashMode = c.req.query("trash") === "1";
  const activeViewId = c.req.query("view") ?? null;
  const rawCursor = c.req.query("cursor") ?? null;

  // Parse the filter query — bad input is treated as empty rather than a
  // hard error so a stale URL doesn't lock the user out of their data.
  let parsedFilter: FilterTree | null = null;
  let filterLeaves: Array<{ fieldId: string; op: string; value?: unknown }> =
    [];
  const rawFilter = c.req.query("filter");
  if (rawFilter) {
    try {
      const parsed = JSON.parse(rawFilter);
      parsedFilter = parsed;
      if (parsed && parsed.op === "AND" && Array.isArray(parsed.filters)) {
        filterLeaves = parsed.filters.filter(
          (f: unknown): f is { fieldId: string; op: string; value?: unknown } =>
            typeof f === "object" && f !== null && "fieldId" in f && "op" in f
        );
      }
    } catch {}
  }

  let parsedSort: SortSpec[] = [];
  const rawSort = c.req.query("sort");
  if (rawSort) {
    try {
      const parsed = JSON.parse(rawSort);
      if (Array.isArray(parsed)) {
        parsedSort = parsed.filter(
          (s: unknown): s is SortSpec =>
            typeof s === "object" &&
            s !== null &&
            "fieldId" in s &&
            "direction" in s
        );
      }
    } catch {}
  }

  // Group-by + aggregations URL params (Slice 8 inline UI). Same
  // tolerant-parse strategy as filter / sort: bad JSON → empty so a
  // stale URL doesn't 500 the page.
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
  let parsedGroupBy: GroupByRaw[] = [];
  const rawGroupBy = c.req.query("groupBy");
  if (rawGroupBy) {
    try {
      const parsed = JSON.parse(rawGroupBy);
      if (Array.isArray(parsed)) {
        parsedGroupBy = parsed.filter(
          (g: unknown): g is GroupByRaw =>
            typeof g === "object" && g !== null && typeof (g as { fieldId?: unknown }).fieldId === "string",
        );
      }
    } catch {}
  }
  let parsedAggregations: AggregationRaw[] = [];
  const rawAggregations = c.req.query("aggregations");
  if (rawAggregations) {
    try {
      const parsed = JSON.parse(rawAggregations);
      if (Array.isArray(parsed)) {
        parsedAggregations = parsed.filter(
          (a: unknown): a is AggregationRaw =>
            typeof a === "object" && a !== null && "fieldId" in a && "agg" in a,
        );
      }
    } catch {}
  }

  // Free-text search params. `q` is the text; `qFields` (CSV) optionally
  // narrows the search to a subset of text-shaped fields. Empty `qFields`
  // means "search all searchable text fields".
  const rawQ = (c.req.query("q") ?? "").trim();
  const rawQFields = c.req.query("qFields") ?? "";
  const qFieldIds = rawQFields ? rawQFields.split(",").filter(Boolean) : [];

  // Selected record for the detail panel — `?record=<id>` query param.
  // We fetch the full record SSR-side so deep links land with the panel
  // already populated (no client-side spinner on first paint).
  const selectedRecordId = c.req.query("record") ?? null;

  const base = await gridsService.base.get(baseId);
  if (!base) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> Base not found
        </div>
      </Layout>
    );
  }

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

  const activeTable = activeTableId
    ? tables.find((t) => t.id === activeTableId) ?? null
    : tables[0] ?? null;

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
  // Effective groupBy / aggregations get computed inside the
  // `if (activeTable)` block — declared here so the footer-aggregate
  // block (also inside that if) can read them, and the renderer below
  // can read them after the block closes.
  let effectiveGroupBy: GroupByRaw[] = [];
  let effectiveAggregations: AggregationRaw[] = [];
  let activeTableLevel = level;
  let selectedRecord: import("../../service").GridRecord | null = null;
  let relationLabels: Record<string, string> = {};
  // Pre-fetched fields for every table in this base — TableEditor's relation
  // picker needs this so the user can pick a target table + display field
  // without an extra API round-trip from the modal.
  const fieldsByTable: Record<string, Field[]> = {};

  if (activeTable) {
    // Fields first — we need them to figure out which columns the search
    // applies to (default = "all searchable text fields"). The records/lvl
    // queries can still parallelize after fields land.
    fields = await gridsService.field.listByTable(activeTable.id);
    fieldsByTable[activeTable.id] = fields;

    // Build the effective filter: user's URL filter AND'd with the search
    // OR-group across the (possibly user-narrowed) searchable fields.
    const effectiveFilter = mergeSearchIntoFilter(parsedFilter, rawQ, qFieldIds, fields);

    // Views first — we need the active view's `limit` cap before
    // calling record.list so top-N views actually return at most N rows.
    viewsForTable = await gridsService.view.listForTable({
      tableId: activeTable.id,
      userId: user.id,
      userGroups: user.memberofGroupIds,
    });
    const activeViewForLimit = activeViewId
      ? viewsForTable.find((v) => v.id === activeViewId) ?? null
      : null;
    const viewLimit = activeViewForLimit?.query.limit;
    const effectiveLimit = viewLimit !== undefined ? Math.min(100, viewLimit) : 100;

    // Effective groupBy / aggregations: URL wins over view (URL is the
    // canonical "current state" — view-click serializes view.query into
    // the URL; explicit URL changes by the user are tracked there).
    // Computed HERE rather than at the bottom because the footer-aggregate
    // block below references them — TDZ would crash the page otherwise.
    effectiveGroupBy = parsedGroupBy.length > 0
      ? parsedGroupBy
      : (activeViewForLimit?.query.groupBy ?? []);
    // The view's stored aggregations may include median/earliest/latest
    // (wider contract type) — the SSR-side AggregationRaw narrows to the
    // 7 kinds the UI / group compiler actually support, so we filter.
    effectiveAggregations = parsedAggregations.length > 0
      ? parsedAggregations
      : (activeViewForLimit?.query.aggregations ?? []).filter(
          (a): a is AggregationRaw =>
            a.agg !== "median" && a.agg !== "earliest" && a.agg !== "latest",
        );

    const [listResult, lvl] = await Promise.all([
      gridsService.record.list({
        tableId: activeTable.id,
        limit: effectiveLimit,
        includeDeleted: trashMode,
        filter: effectiveFilter,
        sort: parsedSort,
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
        // Aggregates honour the search too — otherwise the footer count
        // wouldn't match the visible rows once a query is typed.
        filter: mergeSearchIntoFilter(parsedFilter, rawQ, qFieldIds, fields),
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

  // Resolve the currently-applied view's column overrides. Undefined =
  // table-default rendering (`!hideInTable` fields by `position`).
  const activeView = activeViewId
    ? viewsForTable.find((v) => v.id === activeViewId) ?? null
    : null;
  const activeViewColumns = activeView?.query.columns;

  // Slice 8: when groupBy is non-empty (from URL or active view), the
  // records area renders one row per bucket via GroupedTable. The
  // effective values were computed inside the `if (activeTable)` block
  // above so the footer-aggregate block could see them (TDZ guard).
  let groupedBuckets: GroupBucket[] = [];
  let groupedExplode = false;
  if (activeTable && effectiveGroupBy.length > 0 && !trashMode) {
    const groupResult = await gridsService.record.group({
      tableId: activeTable.id,
      groupBy: effectiveGroupBy,
      aggregations: effectiveAggregations,
      filter: parsedFilter,
      limit: 1000,
    });
    if (groupResult.ok) {
      groupedBuckets = groupResult.data.buckets as GroupBucket[];
      groupedExplode = groupResult.data.explode;
    }
  }

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name, href: `/app/grids/${baseId}` },
        // Active table is the second-to-last crumb when a view is open;
        // becomes the leaf when no view. The view name (when set) takes
        // the leaf so the user sees exactly which preset they're on.
        ...(activeTable
          ? activeView
            ? [
                { title: activeTable.name, href: `/app/grids/${baseId}?table=${activeTable.id}` },
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
                <a href={`/app/grids/${baseId}/settings`} class="sidebar-item-mobile">
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
                    href={`/app/grids/${baseId}?table=${t.id}`}
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
          <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
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
                  href={`/app/grids/${baseId}/settings`}
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
                    // Contacts-style row: the whole div carries the
                    // sidebar-item visual; the link fills the row, and
                    // the per-row settings button lives inside as a
                    // sidebar-item-action that fades in on hover.
                    return (
                      <div
                        class={`sidebar-item group ${
                          isActive ? "sidebar-item-active" : ""
                        }`}
                      >
                        <a
                          href={`/app/grids/${baseId}?table=${t.id}`}
                          class="flex min-w-0 flex-1 items-center gap-2"
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
                            href={`/app/grids/${baseId}/tables/${t.id}/edit`}
                            class="sidebar-item-action opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
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
                {canCreateTables && <CreateTableButton baseId={baseId} />}
              </section>

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
                      const url = (() => {
                        const u = new URL(`/app/grids/${baseId}`, "http://x");
                        u.searchParams.set("table", t.id);
                        u.searchParams.set("view", view.id);
                        if (view.query.filter)
                          u.searchParams.set("filter", JSON.stringify(view.query.filter));
                        if (view.query.sort)
                          u.searchParams.set("sort", JSON.stringify(view.query.sort));
                        if (view.query.groupBy && view.query.groupBy.length > 0)
                          u.searchParams.set("groupBy", JSON.stringify(view.query.groupBy));
                        if (view.query.aggregations && view.query.aggregations.length > 0)
                          u.searchParams.set("aggregations", JSON.stringify(view.query.aggregations));
                        return `${u.pathname}${u.search}`;
                      })();
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
                          class={`sidebar-item group ${isActive ? "sidebar-item-active" : ""}`}
                        >
                          <a
                            href={url}
                            class="flex min-w-0 flex-1 items-center gap-2"
                            aria-current={isActive ? "page" : undefined}
                          >
                            <i class="ti ti-table-spark text-sm shrink-0" />
                            <span class="truncate min-w-0">{view.name}</span>
                          </a>
                          {canEdit && (
                            <a
                              href={`/app/grids/${baseId}/tables/${t.id}/views/${view.id}/edit`}
                              class="sidebar-item-action opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
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

              {/* Forms — flat alphabetical, public-only. Each row carries
                  the same dim "· table" suffix as views for context. */}
              {(() => {
                type FormRow = { form: NonNullable<(typeof formsByTable)[string]>[number]; table: typeof tables[number] };
                const allForms: FormRow[] = [];
                for (const t of tables) {
                  for (const form of formsByTable[t.id] ?? []) {
                    if (form.publicToken && form.isActive) {
                      allForms.push({ form, table: t });
                    }
                  }
                }
                if (allForms.length === 0) return null;
                allForms.sort((a, b) =>
                  a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }),
                );
                return (
                  <section class="sidebar-group">
                    <p class="sidebar-section-title">Forms</p>
                    {allForms.map(({ form }) => (
                      <a
                        href={`/share/grids/forms/${form.publicToken}`}
                        class="sidebar-item"
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open public submit form for ${form.name}`}
                      >
                        <i class="ti ti-forms text-sm shrink-0" />
                        <span class="truncate min-w-0 flex-1">{form.name}</span>
                        <i class="ti ti-external-link text-[10px] text-dimmed shrink-0" />
                      </a>
                    ))}
                  </section>
                );
              })()}
            </div>
          </div>
        </aside>

        {/* Main: records table */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          {activeTable ? (
            <div class="flex flex-col gap-2">
              {/* Records-area lives in a single client-side island
                  (Phase 2 of the RecordsView refactor). It owns the
                  query / cursor / selectedRecord state machine; this
                  JSX just hands it the SSR-parsed initial state and
                  the first /tables/:id/query response. */}
              <RecordsView
                baseId={baseId}
                tableId={activeTable.id}
                fields={fields}
                canWrite={canWriteRecords}
                trashMode={trashMode}
                viewMode={activeViewId !== null}
                initialState={{
                  query: {
                    filter: parsedFilter ?? undefined,
                    sort: parsedSort,
                    groupBy: effectiveGroupBy,
                    aggregations: effectiveAggregations,
                    includeDeleted: trashMode,
                  },
                  cursor: rawCursor,
                  selectedRecordId,
                  activeViewId,
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
