import { ssr } from "../../../../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../../../../service";
import TableEditPage from "../../../../_components/TableEditPage.island";
import type { Field } from "../../../../../service";

type AuthUser = Parameters<typeof hasRole>[0] & {
  id: string;
  memberofGroupIds: string[];
};

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

/**
 * Full-screen table editor. Same `app-cols` shell as the records page but
 * the main column hosts the editor (no records grid). Sidebar lists the
 * sibling tables so the user can hop directly between editors. Admin-only.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const baseId = c.req.param("baseId");
  const tableId = c.req.param("tableId");

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

  const table = await gridsService.table.get(tableId);
  if (!table || table.baseId !== baseId) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> Table not found
        </div>
      </Layout>
    );
  }

  const tableLevel = await resolveLevel(user, baseId, tableId);
  if (!gridsService.permission.hasAtLeast(tableLevel, "admin")) {
    return c.redirect(`/app/grids/${baseId}?table=${tableId}`, 302);
  }

  // Sibling tables for the sidebar nav. Filter to readable ones (admin
  // already sees everything; non-admin readable = same set the records
  // page uses) — keeps the user from staring at unreachable links.
  const allTables = await gridsService.table.listByBase(baseId);
  const tables = (
    await Promise.all(
      allTables.map(async (t) => {
        const lvl = await resolveLevel(user, baseId, t.id);
        return gridsService.permission.hasAtLeast(lvl, "read") ? t : null;
      }),
    )
  ).filter((t): t is NonNullable<typeof t> => t !== null);

  const fields = await gridsService.field.listByTable(tableId);
  const forms = await gridsService.form.listForTable(tableId);
  // Per-table ACL entries — only the table-level grants. Base-level
  // grants are managed on the base settings page.
  const accessEntries = await gridsService.access.listForTable(tableId);
  // Pre-fetch fields for sibling tables — relation editor needs targets.
  const fieldsByTable: Record<string, Field[]> = { [tableId]: fields };
  for (const t of tables) {
    if (!fieldsByTable[t.id]) {
      fieldsByTable[t.id] = await gridsService.field.listByTable(t.id);
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
        { title: table.name, href: `/app/grids/${baseId}?table=${tableId}` },
        { title: "Edit" },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        {/* Sidebar — base header + sibling tables. Slimmer than the records
            page sidebar (no Views section) since the editor doesn't operate
            on records. */}
        <aside class="sidebar-container">
          <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
            <div class="relative flex items-center gap-3 pr-7">
              <div class="sidebar-header-icon" style="background-color:#3b82f6">
                <i class="ti ti-table text-xs" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="sidebar-header-title">{base.name}</p>
                <p class="sidebar-header-subtitle">Editing table</p>
              </div>
            </div>

            <section class="sidebar-group">
              <p class="sidebar-section-title">Actions</p>
              <a
                href={`/app/grids/${baseId}?table=${tableId}`}
                class="sidebar-item text-xs"
              >
                <i class="ti ti-arrow-left text-sm" />
                <span>Back to records</span>
              </a>
            </section>

            <div class="sidebar-body">
              <section class="sidebar-group">
                <p class="sidebar-section-title">Tables</p>
                {tables.map((t) => {
                  const isActive = t.id === tableId;
                  return (
                    <a
                      href={`/app/grids/${baseId}/tables/${t.id}/edit`}
                      class={`sidebar-item text-xs ${isActive ? "sidebar-item-active" : ""}`}
                    >
                      <i class="ti ti-table text-sm" />
                      <span class="truncate">{t.name}</span>
                    </a>
                  );
                })}
              </section>
            </div>
          </div>
        </aside>

        {/* Full-width main column — editor body. */}
        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          <TableEditPage
            table={{
              id: table.id,
              baseId,
              name: table.name,
              description: table.description ?? null,
            }}
            initialFields={fields}
            initialForms={forms}
            initialAccessEntries={accessEntries}
            otherTables={tables.filter((t) => t.id !== tableId).map((t) => ({
              id: t.id,
              name: t.name,
            }))}
            fieldsByTable={fieldsByTable}
          />
        </main>
      </div>
    </Layout>
  );
});
