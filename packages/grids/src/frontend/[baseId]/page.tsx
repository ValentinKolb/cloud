import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../service";
import RecordsGrid from "../_components/RecordsGrid.island";
import GridToolbar from "../_components/GridToolbar.island";
import TableEditor from "../_components/TableEditor.island";
import CreateTableButton from "../_components/CreateTableButton.island";
import type { FilterTree, SortSpec, Field } from "../../service";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
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
  // Pre-fetched fields for every table in this base — TableEditor's relation
  // picker needs this so the user can pick a target table + display field
  // without an extra API round-trip from the modal.
  const fieldsByTable: Record<string, Field[]> = {};

  if (activeTable) {
    const [f, listResult, lvl] = await Promise.all([
      gridsService.field.listByTable(activeTable.id),
      gridsService.record.list({
        tableId: activeTable.id,
        limit: 100,
        includeDeleted: trashMode,
        filter: parsedFilter,
        sort: parsedSort,
        cursor: rawCursor,
      }),
      resolveLevel(user, baseId, activeTable.id),
    ]);
    fields = f;
    fieldsByTable[activeTable.id] = f;
    if (listResult.ok) {
      records = trashMode
        ? {
            ...listResult.data,
            items: listResult.data.items.filter((r) => r.deletedAt !== null),
          }
        : listResult.data;
    }
    activeTableLevel = lvl;

    viewsForTable = await gridsService.view.listForTable({
      tableId: activeTable.id,
      userId: user.id,
      userGroups: user.memberofGroupIds,
    });
    formsForTable = await gridsService.form.listForTable(activeTable.id);

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
          filter: parsedFilter,
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

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
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
                          <TableEditor
                            table={{
                              id: t.id,
                              name: t.name,
                              description: t.description ?? null,
                              baseId,
                            }}
                            initialFields={fieldsByTable[t.id] ?? []}
                            initialForms={formsForTable}
                            otherTables={tables
                              .filter((x) => x.id !== t.id)
                              .map((x) => ({
                                id: x.id,
                                name: x.name,
                              }))}
                            fieldsByTable={fieldsByTable}
                            canManage
                          />
                        )}
                      </div>
                    );
                  })
                )}
                {canCreateTables && <CreateTableButton baseId={baseId} />}
              </section>

              {/* Views (only for the active table) */}
              {activeTable && (
                <section class="sidebar-group">
                  <p class="sidebar-section-title">Views</p>
                  <a
                    href={`/app/grids/${baseId}?table=${activeTable.id}`}
                    class={`sidebar-item text-xs ${
                      activeViewId === null && !hasFilterOrSort
                        ? "sidebar-item-active"
                        : ""
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
                    return (
                      <a
                        href={url}
                        class={`sidebar-item text-xs ${
                          activeViewId === view.id ? "sidebar-item-active" : ""
                        }`}
                      >
                        <i class="ti ti-table-spark text-sm" />
                        <span class="truncate">{view.name}</span>
                      </a>
                    );
                  })}
                </section>
              )}
            </div>
          </div>
        </aside>

        {/* Main: records table */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          {activeTable ? (
            <div class="flex flex-col gap-2">
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
      </div>
    </Layout>
  );
});
