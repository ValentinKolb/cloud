import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../service";
import RecordsGrid from "../_components/RecordsGrid.island";
import FieldsManager from "../_components/FieldsManager.island";
import QuickAdd from "../_components/QuickAdd.island";
import BasePermissions from "../_components/BasePermissions.island";
import { CreateTableButton, TableActionsMenu } from "../_components/TableActions.island";
import { BaseSettingsButton } from "../_components/BaseActions.island";

type AuthUser = Parameters<typeof hasRole>[0] & { id: string; memberofGroupIds: string[] };

const resolveLevel = async (user: AuthUser, baseId: string, tableId?: string) => {
  if (hasRole(user, "admin")) return "admin" as const;
  const grants = await gridsService.permission.loadGrants({
    userId: user.id,
    userGroups: user.memberofGroupIds,
    baseId,
    tableId: tableId ?? null,
  });
  return gridsService.permission.resolve(grants, tableId ? { baseId, tableId } : { baseId });
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const baseId = c.req.param("baseId");
  const activeTableId = c.req.query("table") ?? null;
  const trashMode = c.req.query("trash") === "1";

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
        return gridsService.permission.hasAtLeast(tableLevel, "read") ? t : null;
      }),
    )
  ).filter((t): t is NonNullable<typeof t> => t !== null);

  const activeTable = activeTableId ? tables.find((t) => t.id === activeTableId) ?? null : tables[0] ?? null;

  type RecordsPage = { items: import("../../service").GridRecord[]; nextCursor: string | null };
  let fields: Awaited<ReturnType<typeof gridsService.field.listByTable>> = [];
  let records: RecordsPage = { items: [], nextCursor: null };
  let activeTableLevel = level;
  if (activeTable) {
    const [f, listResult, lvl] = await Promise.all([
      gridsService.field.listByTable(activeTable.id),
      gridsService.record.list({
        tableId: activeTable.id,
        limit: 100,
        includeDeleted: trashMode,
      }),
      resolveLevel(user, baseId, activeTable.id),
    ]);
    fields = f;
    if (listResult.ok) {
      records = trashMode
        ? { ...listResult.data, items: listResult.data.items.filter((r) => r.deletedAt !== null) }
        : listResult.data;
    }
    activeTableLevel = lvl;
  }
  const canManageTable = gridsService.permission.hasAtLeast(activeTableLevel, "admin");
  const canManageBase = gridsService.permission.hasAtLeast(level, "admin");
  const canCreateTables = gridsService.permission.hasAtLeast(level, "write");
  const canWriteRecords = gridsService.permission.hasAtLeast(activeTableLevel, "write");

  // Initial ACL entries — only fetched when the user can actually manage them.
  const initialAccess = canManageBase ? await gridsService.access.listForBase(baseId) : [];

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Grids", href: "/app/grids" }, { title: base.name }]}
    >
      <div class="app-cols h-full">
        {/* Sidebar: base header + tables list + (admin) fields manager */}
        <aside class="order-1 lg:order-1 w-full lg:w-64 shrink-0 lg:h-full overflow-y-auto p-3 border-r border-zinc-200 dark:border-zinc-800 flex flex-col gap-4">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium text-primary truncate">{base.name}</div>
              {base.description && <div class="text-xs text-dimmed truncate">{base.description}</div>}
            </div>
            <div class="flex items-center gap-1">
              <BasePermissions baseId={baseId} initialEntries={initialAccess} canManage={canManageBase} />
              <BaseSettingsButton base={base} canManage={canManageBase} />
            </div>
          </div>

          <div>
            <div class="text-xs uppercase tracking-wide text-dimmed mb-2 px-1">Tables</div>
            {tables.length === 0 ? (
              <div class="text-xs text-dimmed px-2 py-3">No tables yet.</div>
            ) : (
              <ul class="flex flex-col gap-1">
                {tables.map((t) => (
                  <li class="flex items-center gap-1">
                    <a
                      href={`/app/grids/${baseId}?table=${t.id}`}
                      class={`flex-1 block px-2 py-1.5 rounded-md text-sm transition-colors ${
                        activeTable?.id === t.id
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                          : "text-secondary hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <i class="ti ti-table text-xs" /> {t.name}
                    </a>
                    {activeTable?.id === t.id && <TableActionsMenu table={t} canManage={canManageTable} />}
                  </li>
                ))}
              </ul>
            )}
            {canCreateTables && <CreateTableButton baseId={baseId} />}
          </div>

          {activeTable && (
            <FieldsManager
              tableId={activeTable.id}
              initialFields={fields}
              canManage={canManageTable}
            />
          )}
        </aside>

        {/* Main: records table for the active table */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto p-4">
          {activeTable ? (
            <div class="flex flex-col gap-3">
              <header class="flex items-center justify-between gap-3">
                <div class="flex items-baseline gap-3">
                  <h2 class="text-lg font-semibold text-primary">
                    {activeTable.name}
                    {trashMode && <span class="ml-2 text-sm font-normal text-amber-600 dark:text-amber-400">(trash)</span>}
                  </h2>
                  <span class="text-xs text-dimmed">{records.items.length} record(s)</span>
                </div>
                <div class="flex items-center gap-2">
                  <a
                    href={
                      trashMode
                        ? `/app/grids/${baseId}?table=${activeTable.id}`
                        : `/app/grids/${baseId}?table=${activeTable.id}&trash=1`
                    }
                    class="btn-secondary btn-sm"
                    title={trashMode ? "Back to live records" : "Show deleted records"}
                  >
                    <i class={trashMode ? "ti ti-arrow-back" : "ti ti-trash"} />
                    {trashMode ? "Back" : "Trash"}
                  </a>
                  {!trashMode && <QuickAdd tableId={activeTable.id} fields={fields} canWrite={canWriteRecords} />}
                </div>
              </header>
              <RecordsGrid
                tableId={activeTable.id}
                fields={fields}
                records={records.items}
                canWrite={canWriteRecords}
                mode={trashMode ? "trash" : "live"}
              />
            </div>
          ) : (
            <div class="paper p-8 text-center text-sm text-dimmed">
              {canCreateTables
                ? "No tables yet. Click “New table” in the sidebar."
                : "No tables. You don’t have write access to create one."}
            </div>
          )}
        </main>
      </div>
    </Layout>
  );
});
