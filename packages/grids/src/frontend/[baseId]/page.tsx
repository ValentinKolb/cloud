import { ssr } from "../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../service";
import RecordsTable from "../_components/RecordsTable";

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

  let fields: Awaited<ReturnType<typeof gridsService.field.listByTable>> = [];
  let records: Awaited<ReturnType<typeof gridsService.record.list>> = { items: [], nextCursor: null };
  if (activeTable) {
    [fields, records] = await Promise.all([
      gridsService.field.listByTable(activeTable.id),
      gridsService.record.list({ tableId: activeTable.id, limit: 100 }),
    ]);
  }

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Grids", href: "/app/grids" }, { title: base.name }]}
    >
      <div class="app-cols h-full">
        {/* Sidebar: tables list */}
        <aside class="order-1 lg:order-1 w-full lg:w-64 shrink-0 lg:h-full overflow-y-auto p-3 border-r border-zinc-200 dark:border-zinc-800">
          <div class="text-xs uppercase tracking-wide text-dimmed mb-2 px-1">Tables</div>
          {tables.length === 0 ? (
            <div class="text-xs text-dimmed px-2 py-3">No tables yet.</div>
          ) : (
            <ul class="flex flex-col gap-1">
              {tables.map((t) => (
                <li>
                  <a
                    href={`/app/grids/${baseId}?table=${t.id}`}
                    class={`block px-2 py-1.5 rounded-md text-sm transition-colors ${
                      activeTable?.id === t.id
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        : "text-secondary hover:text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <i class="ti ti-table text-xs" /> {t.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Main: records table for the active table */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto p-4">
          {activeTable ? (
            <div class="flex flex-col gap-3">
              <header class="flex items-baseline gap-3">
                <h2 class="text-lg font-semibold text-primary">{activeTable.name}</h2>
                <span class="text-xs text-dimmed">{records.items.length} record(s)</span>
              </header>
              <RecordsTable fields={fields} records={records.items} />
            </div>
          ) : (
            <div class="paper p-8 text-center text-sm text-dimmed">
              No tables. Create one via the API — UI lands in 1C.
            </div>
          )}
        </main>
      </div>
    </Layout>
  );
});
