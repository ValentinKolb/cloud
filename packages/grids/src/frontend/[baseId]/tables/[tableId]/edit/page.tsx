import { ssr } from "../../../../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../../../../service";
import TableEditPage from "../../../../_components/TableEditPage.island";
import EditSidebar from "../../../../_components/EditSidebar";
import type { Field, View } from "../../../../../service";
import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";

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
  // Per-form ACL entries — pre-fetched for every non-virtual form so
  // the FormsManager renders the Permissions section without a per-
  // form fetch on first expand. One round-trip per form; the count is
  // small (most tables have <5 custom forms) so this is cheap.
  const formAccessEntries: Record<string, AccessEntry[]> = {};
  for (const f of forms) {
    if (f.isDefault) continue;
    formAccessEntries[f.id] = await gridsService.access.listForForm(f.id);
  }
  // Pre-fetch fields for sibling tables — relation editor needs targets.
  const fieldsByTable: Record<string, Field[]> = { [tableId]: fields };
  for (const t of tables) {
    if (!fieldsByTable[t.id]) {
      fieldsByTable[t.id] = await gridsService.field.listByTable(t.id);
    }
  }
  // Pre-fetch views per table for the unified edit sidebar (lets the
  // user hop directly from this table-editor to any sibling table OR
  // any view). Cheap: one call per readable table.
  const viewsByTable: Record<string, View[]> = {};
  for (const t of tables) {
    viewsByTable[t.id] = await gridsService.view.listForTable({
      tableId: t.id,
      userId: user.id,
      userGroups: user.memberofGroupIds,
    });
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
        {/* Mobile-collapsed sidebar — sibling tables + back-to-records. */}
        <nav class="sidebar-container-mobile">
          <details class="group">
            <summary class="sidebar-mobile-toggle">
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style="background-color:#3b82f6"
              >
                <i class="ti ti-table text-sm" />
              </div>
              <span class="font-semibold truncate flex-1">Edit table</span>
              <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
                <i class="ti ti-chevron-down text-sm" />
              </span>
            </summary>
            <div class="sidebar-mobile-actions">
              <a href={`/app/grids/${baseId}?table=${tableId}`} class="sidebar-item-mobile">
                <i class="ti ti-arrow-left" />
                Back to records
              </a>
              {tables.map((t) => {
                const isActive = t.id === tableId;
                return (
                  <a
                    href={`/app/grids/${baseId}/tables/${t.id}/edit`}
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

        {/* Unified edit sidebar — lists Tables + Views with active
            highlight. Same shape on the view-edit page so the user
            doesn't see two different navigations. */}
        <EditSidebar
          baseId={baseId}
          tables={tables}
          viewsByTable={viewsByTable}
          active={{ kind: "table", tableId }}
        />

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
            initialFormAccessEntries={formAccessEntries}
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
