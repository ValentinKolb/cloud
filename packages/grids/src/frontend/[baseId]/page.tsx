import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../service";
import RecordsGrid from "../_components/RecordsGrid.island";
import RecordDetailPanel from "../_components/RecordDetailPanel.island";
import RecordDetailLayoutSync from "../_components/RecordDetailLayoutSync.island";
import GridToolbar from "../_components/GridToolbar.island";
import SearchBar from "../_components/SearchBar.island";
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
  "color",
  "rich-text",
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
  // must do the same.
  const allTables = await gridsService.table.listByBase(baseId);
  const tables = (
    await Promise.all(
      allTables.map(async (t) => {
        const tableLevel = await resolveLevel(user, baseId, t.id);
        return gridsService.permission.hasAtLeast(tableLevel, "read")
          ? t
          : null;
      })
    )
  ).filter((t): t is NonNullable<typeof t> => t !== null);

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
    const viewLimit = activeViewForLimit?.config.limit;
    const effectiveLimit = viewLimit !== undefined ? Math.min(100, viewLimit) : 100;

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

    // Auto-aggregates for the visible columns: count for every field plus
    // sum for numeric/decimal/rating. Power users can pick per-column
    // aggregates in a later phase; this gives a useful default footer row
    // without any UI to configure.
    if (!trashMode && fields.length > 0) {
      const requests = fields
        .filter((field) => !field.deletedAt)
        .flatMap((field) => {
          const reqs: Array<{ fieldId: string; agg: "count" | "sum" }> = [
            { fieldId: field.id, agg: "count" },
          ];
          if (
            field.type === "number" ||
            field.type === "decimal" ||
            field.type === "rating"
          ) {
            reqs.push({ fieldId: field.id, agg: "sum" });
          }
          return reqs;
        });
      if (requests.length > 0) {
        const aggResult = await gridsService.record.aggregate({
          tableId: activeTable.id,
          // Aggregates honour the search too — otherwise the footer count
          // wouldn't match the visible rows once a query is typed.
          filter: mergeSearchIntoFilter(parsedFilter, rawQ, qFieldIds, fields),
          requests,
        });
        if (aggResult.ok) aggregates = aggResult.data;
      }
    }
  }

  // Fetch fields for every other table too (for relation picker in the
  // table editor). Cheap: bases stay small in the v1 product.
  for (const t of tables) {
    if (!fieldsByTable[t.id]) {
      fieldsByTable[t.id] = await gridsService.field.listByTable(t.id);
    }
  }

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
  const activeViewColumns = activeView?.config.columns;

  // Public forms surface in the sidebar regardless of who's looking —
  // anyone can click through to the submit page. Private forms stay in
  // the table-edit page (they're a power-user surface).
  const publicForms = formsForTable.filter((f) => f.publicToken && f.isActive);

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name, href: `/app/grids/${baseId}` },
        // Mirror the notebooks pattern — the active table closes the
        // breadcrumb so users see exactly where they are.
        ...(activeTable ? [{ title: activeTable.name }] : []),
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
                          <i class="ti ti-table text-sm" />
                          <span class="truncate">{t.name}</span>
                        </a>
                        {canManageTable && isActive && (
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

              {/* Views (only for the active table). "All records" is the
                  no-view-selected state. We rely strictly on `activeViewId`
                  here (not the filter/sort flags) — having a filter
                  applied without picking a saved view is still the "All
                  records" context, just narrowed. */}
              {activeTable && (
                <section class="sidebar-group">
                  <p class="sidebar-section-title">Views</p>
                  <a
                    href={`/app/grids/${baseId}?table=${activeTable.id}`}
                    class={`sidebar-item text-xs ${
                      activeViewId === null ? "sidebar-item-active" : ""
                    }`}
                  >
                    <i class="ti ti-list text-sm" />
                    <span>All records</span>
                  </a>
                  {viewsForTable.map((view) => {
                    const url = (() => {
                      const u = new URL(`/app/grids/${baseId}`, "http://x");
                      u.searchParams.set("table", activeTable.id);
                      u.searchParams.set("view", view.id);
                      const cfg = view.config as {
                        filter?: unknown;
                        sort?: unknown;
                      };
                      if (cfg.filter)
                        u.searchParams.set(
                          "filter",
                          JSON.stringify(cfg.filter)
                        );
                      if (cfg.sort)
                        u.searchParams.set("sort", JSON.stringify(cfg.sort));
                      return `${u.pathname}${u.search}`;
                    })();
                    const canEdit =
                      view.ownerUserId === user.id ||
                      (view.ownerUserId === null && canWriteRecords);
                    return (
                      <div class="group relative flex items-center">
                        <a
                          href={url}
                          class={`sidebar-item flex-1 text-xs ${
                            activeViewId === view.id ? "sidebar-item-active" : ""
                          }`}
                        >
                          <i class="ti ti-table-spark text-sm" />
                          <span class="truncate">{view.name}</span>
                        </a>
                        {canEdit && (
                          <a
                            href={`/app/grids/${baseId}/tables/${activeTable.id}/views/${view.id}/edit`}
                            class="sidebar-item-action opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                            aria-label={`Edit view ${view.name}`}
                            title="Edit view"
                          >
                            <i class="ti ti-settings text-xs" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}

              {/* Forms — only public forms are linkable here (private forms
                  live in the table editor). Anyone reading the sidebar can
                  click through to submit a public form without leaving the
                  context of the table. */}
              {activeTable && publicForms.length > 0 && (
                <section class="sidebar-group">
                  <p class="sidebar-section-title">Forms</p>
                  {publicForms.map((form) => (
                    <a
                      href={`/share/grids/forms/${form.publicToken}`}
                      class="sidebar-item text-xs"
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open public submit form for ${form.name}`}
                    >
                      <i class="ti ti-forms text-sm" />
                      <span class="truncate">{form.name}</span>
                      <i class="ti ti-external-link text-[10px] text-dimmed ml-auto" />
                    </a>
                  ))}
                </section>
              )}
            </div>
          </div>
        </aside>

        {/* Main: records table */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          {activeTable ? (
            <div class="flex flex-col gap-2">
              {/* Search row (above the toolbar) — debounced free-text search
                  with an optional column-scope chip on the left. */}
              {!trashMode && filterSearchableFields(fields).length > 0 && (
                <SearchBar
                  baseId={baseId}
                  tableId={activeTable.id}
                  fields={filterSearchableFields(fields)}
                  initialQ={rawQ}
                  initialQFields={qFieldIds}
                  rawFilter={rawFilter}
                  rawSort={rawSort}
                  trashMode={trashMode}
                />
              )}
              <GridToolbar
                baseId={baseId}
                tableId={activeTable.id}
                fields={fields}
                initialFilter={filterLeaves}
                initialSort={parsedSort.map((s) => ({
                  fieldId: s.fieldId,
                  direction: s.direction,
                }))}
                rawFilter={rawFilter}
                rawSort={rawSort}
                trashMode={trashMode}
                recordCount={records.items.length}
                canWrite={canWriteRecords}
              />

              <RecordsGrid
                tableId={activeTable.id}
                fields={fields}
                records={records.items}
                canWrite={canWriteRecords}
                mode={trashMode ? "trash" : "live"}
                initialSelectedId={selectedRecordId}
                viewColumns={activeViewColumns}
                relationLabels={relationLabels}
                aggregates={trashMode ? {} : aggregates}
              />

              {records.nextCursor && (
                <div class="flex items-center justify-end gap-2 text-xs">
                  <a
                    href={(() => {
                      const url = new URL(`/app/grids/${baseId}`, "http://x");
                      url.searchParams.set("table", activeTable.id);
                      if (rawFilter) url.searchParams.set("filter", rawFilter);
                      if (rawSort) url.searchParams.set("sort", rawSort);
                      url.searchParams.set("cursor", records.nextCursor);
                      if (trashMode) url.searchParams.set("trash", "1");
                      return `${url.pathname}${url.search}`;
                    })()}
                    class="btn-secondary btn-sm"
                  >
                    Next page <i class="ti ti-arrow-right" />
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div class="paper p-8 text-center text-sm text-dimmed">
              {canCreateTables
                ? 'No tables yet. Click "New table" in the sidebar.'
                : "No tables. You don't have write access to create one."}
            </div>
          )}
        </main>

        {/* Detail panel — third column, hidden until a record is selected.
            SSR sets the initial class based on `?record=<id>`; after that,
            RecordDetailLayoutSync flips `hidden` ⇄ `flex` on the same
            selection event the panel itself listens to. Without the
            sync, history.replaceState navigation would update the URL
            without making the column appear/disappear, and the main
            column wouldn't reclaim the freed width on close. Mirrors
            the spaces SpaceDetailLayoutSync pattern. */}
        {activeTable && (
          <div
            id="grids-detail-panel"
            class={`${
              selectedRecordId ? "flex" : "hidden"
            } order-2 lg:order-3 w-full lg:w-[28rem] shrink-0 flex-col min-h-0 overflow-hidden`}
          >
            <RecordDetailPanel
              tableId={activeTable.id}
              fields={fields}
              initialRecord={selectedRecord}
              initialRecordId={selectedRecordId}
              trashMode={trashMode}
              canWrite={canWriteRecords}
              relationLabels={relationLabels}
            />
          </div>
        )}
        <RecordDetailLayoutSync detailContainerId="grids-detail-panel" />
      </div>
    </Layout>
  );
});
