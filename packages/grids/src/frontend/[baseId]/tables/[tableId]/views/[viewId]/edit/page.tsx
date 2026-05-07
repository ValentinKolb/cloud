import { ssr } from "../../../../../../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../../../../../../service";
import ViewEditPage from "../../../../../../_components/ViewEditPage.island";
import EditSidebar from "../../../../../../_components/EditSidebar";
import type { View } from "../../../../../../../service";

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
 * Full-screen view editor. Same `app-cols` shell as the records page +
 * table editor. Sidebar lists sibling views (so the user can hop) plus
 * a back-to-records link that preserves the current view selection.
 *
 * Auth model mirrors the API (api/views.ts):
 *  - Shared views (ownerUserId=null) require table-write.
 *  - Personal views require table-read AND must be owned by the user.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const baseSlug = c.req.param("baseId");
  const tableSlug = c.req.param("tableId");
  const viewSlug = c.req.param("viewId");

  const base = await gridsService.base.getByIdOrSlug(baseSlug);
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
  const table = await gridsService.table.getByIdOrSlug(baseId, tableSlug);
  if (!table || table.baseId !== baseId) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> Table not found
        </div>
      </Layout>
    );
  }
  const tableId = table.id;
  const view = await gridsService.view.getByIdOrSlug(tableId, viewSlug);
  if (!view || view.tableId !== tableId) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> View not found
        </div>
      </Layout>
    );
  }
  const viewId = view.id;

  const tableLevel = await resolveLevel(user, baseId, tableId);
  const isOwner = view.ownerUserId === user.id;
  const isShared = view.ownerUserId === null;
  const requiredLevel = isShared ? "write" : "read";
  if (!gridsService.permission.hasAtLeast(tableLevel, requiredLevel)) {
    return c.redirect(`/app/grids/${baseSlug}?table=${tableSlug}`, 302);
  }
  if (!isShared && !isOwner) {
    return c.redirect(`/app/grids/${baseSlug}?table=${tableSlug}`, 302);
  }

  const fields = await gridsService.field.listByTable(tableId);

  // Pre-fetch ACL entries for this view (the new Permissions section).
  // canEditAccess mirrors the API gate (admin on the parent table) so
  // the editor disables grant/revoke for non-admins instead of letting
  // them get a 403 on click.
  const accessEntries = await gridsService.access.listForView(viewId);
  const canEditAccess = gridsService.permission.hasAtLeast(tableLevel, "admin");

  // Base-level permission gates the "New table" entry in the sidebar —
  // mirrors the records-page sidebar so the affordance lives in the same
  // place across both views.
  const baseLevel = await resolveLevel(user, baseId);
  const canCreateTables = gridsService.permission.hasAtLeast(baseLevel, "write");

  // Pre-fetch sibling tables + their views for the unified edit
  // sidebar. The sidebar mirrors the records-page sidebar shape so the
  // user can hop between editing a table OR a view in one click.
  // Filter to the readable set so unreachable links don't show.
  const allTables = await gridsService.table.listByBase(baseId);
  const tables = (
    await Promise.all(
      allTables.map(async (t) => {
        const lvl = await resolveLevel(user, baseId, t.id);
        return gridsService.permission.hasAtLeast(lvl, "read") ? t : null;
      }),
    )
  ).filter((t): t is NonNullable<typeof t> => t !== null);
  const viewsByTable: Record<string, View[]> = {};
  for (const t of tables) {
    viewsByTable[t.id] = await gridsService.view.listForTable({
      tableId: t.id,
      userId: user.id,
      userGroups: user.memberofGroupIds,
    });
  }
  const dashboards = await gridsService.dashboard.listForBase({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name, href: `/app/grids/${baseSlug}` },
        { title: table.name, href: `/app/grids/${baseSlug}?table=${tableSlug}` },
        { title: view.name, href: `/app/grids/${baseSlug}?table=${tableSlug}&view=${viewSlug}` },
        { title: "Edit" },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        {/* Mobile-collapsed sidebar */}
        <nav class="sidebar-container-mobile">
          <details class="group">
            <summary class="sidebar-mobile-toggle">
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style="background-color:#3b82f6"
              >
                <i class="ti ti-table-spark text-sm" />
              </div>
              <span class="font-semibold truncate flex-1">Edit view</span>
              <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
                <i class="ti ti-chevron-down text-sm" />
              </span>
            </summary>
            <div class="sidebar-mobile-actions">
              <a
                href={`/app/grids/${baseSlug}?table=${tableSlug}&view=${viewSlug}`}
                class="sidebar-item-mobile"
              >
                <i class="ti ti-arrow-left" />
                Back to records
              </a>
              {(viewsByTable[tableId] ?? []).map((v) => {
                const isActive = v.id === viewId;
                return (
                  <a
                    href={`/app/grids/${baseSlug}/tables/${tableSlug}/views/${v.slug}/edit`}
                    class={`sidebar-item-mobile ${
                      isActive
                        ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200"
                        : ""
                    }`}
                  >
                    <i class="ti ti-table-spark" />
                    {v.name}
                  </a>
                );
              })}
            </div>
          </details>
        </nav>

        {/* Unified edit sidebar — same component as the table-edit
            page. Lists Tables + Views with the active highlight on the
            view being edited. */}
        <EditSidebar
          baseId={baseId}
          baseSlug={baseSlug}
          activeTableSlug={tableSlug}
          activeViewSlug={viewSlug}
          tables={tables}
          viewsByTable={viewsByTable}
          dashboards={dashboards}
          defaultDashboardId={base.defaultDashboardId}
          active={{ kind: "view", tableId, viewId }}
          canCreateTables={canCreateTables}
        />

        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          <ViewEditPage
            baseSlug={baseSlug}
            tableSlug={tableSlug}
            viewSlug={viewSlug}
            initialView={view}
            fields={fields}
            initialAccessEntries={accessEntries}
            canEditAccess={canEditAccess}
          />
        </main>
      </div>
    </Layout>
  );
});
