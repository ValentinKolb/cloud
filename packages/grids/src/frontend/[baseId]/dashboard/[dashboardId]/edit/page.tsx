import { ssr } from "../../../../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../../../../service";
import DashboardEditPage from "../../../../_components/DashboardEditPage.island";
import EditSidebar from "../../../../_components/EditSidebar";
import type { View } from "../../../../../service";

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
 * Full-screen dashboard editor. Same `app-cols` shell as the table-edit
 * and view-edit pages. EditSidebar lists Tables / Views / Dashboards so
 * the user can hop between editors in one click; main column hosts the
 * dashboard-edit island.
 *
 * Auth model:
 *   - Shared dashboard (ownerUserId = null): base-admin (catalog change).
 *   - Personal dashboard (ownerUserId = X): owner only.
 */
export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const baseShortId = c.req.param("baseId");
  const dashboardShortId = c.req.param("dashboardId");

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

  const dashboard = await gridsService.dashboard.getByIdOrShortId(baseId, dashboardShortId);
  if (!dashboard || dashboard.baseId !== baseId) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> Dashboard not found
        </div>
      </Layout>
    );
  }

  const baseLevel = await resolveLevel(user, baseId);
  const isOwner = dashboard.ownerUserId === user.id;
  const isShared = dashboard.ownerUserId === null;
  const canEdit = isShared
    ? gridsService.permission.hasAtLeast(baseLevel, "admin")
    : isOwner;
  if (!canEdit) {
    return c.redirect(`/app/grids/${baseShortId}?dashboard=${dashboardShortId}`, 302);
  }

  // Source data the editor needs to populate widget pickers without
  // round-tripping per pick:
  //  - tables: source-table picker for stat / chart widgets
  //  - fields by table: aggregation field-picker for stat / chart
  //  - views: view-picker for the embedded-view widget
  // Keep the same "readable filter" as the records page so the editor
  // never offers a target the viewer (or fellow viewers) can't read.
  const allTables = await gridsService.table.listByBase(baseId);
  const tables = (
    await Promise.all(
      allTables.map(async (t) => {
        const lvl = await resolveLevel(user, baseId, t.id);
        return gridsService.permission.hasAtLeast(lvl, "read") ? t : null;
      }),
    )
  ).filter((t): t is NonNullable<typeof t> => t !== null);

  const fieldsByTable: Record<string, Awaited<ReturnType<typeof gridsService.field.listByTable>>> = {};
  const viewsByTable: Record<string, View[]> = {};
  for (const t of tables) {
    fieldsByTable[t.id] = await gridsService.field.listByTable(t.id);
    viewsByTable[t.id] = await gridsService.view.listForTable({
      tableId: t.id,
      userId: user.id,
      userGroups: user.memberofGroupIds,
    });
  }

  // ACL entries for the Permissions section. listForDashboard returns
  // the same shape PermissionEditor consumes; canEditAccess mirrors
  // the API gate (base-admin) so the editor disables grant/revoke for
  // personal-owners-but-not-base-admin instead of letting them get a 403.
  const accessEntries = await gridsService.access.listForDashboard(dashboard.id);
  const canEditAccess = gridsService.permission.hasAtLeast(baseLevel, "admin");

  // Sibling dashboards for EditSidebar so the user can hop between
  // dashboards from inside the editor.
  const dashboards = await gridsService.dashboard.listForBase({
    baseId,
    userId: user.id,
    userGroups: user.memberofGroupIds,
  });

  // Base-level write permission gates the "+ New table" / "+ New
  // dashboard" buttons in the sidebar — same rule the records page uses.
  const canCreateTables = gridsService.permission.hasAtLeast(baseLevel, "write");

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[
        { title: "Start", href: "/" },
        { title: "Grids", href: "/app/grids" },
        { title: base.name, href: `/app/grids/${baseShortId}` },
        { title: dashboard.name, href: `/app/grids/${baseShortId}?dashboard=${dashboardShortId}` },
        { title: "Edit" },
      ]}
    >
      <div class="app-cols flex-1 min-h-0">
        {/* Mobile collapsed sidebar */}
        <nav class="sidebar-container-mobile">
          <details class="group">
            <summary class="sidebar-mobile-toggle">
              <div
                class="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                style="background-color:#3b82f6"
              >
                <i class="ti ti-layout-dashboard text-sm" />
              </div>
              <span class="font-semibold truncate flex-1">Edit dashboard</span>
              <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
                <i class="ti ti-chevron-down text-sm" />
              </span>
            </summary>
            <div class="sidebar-mobile-actions">
              <a
                href={`/app/grids/${baseShortId}?dashboard=${dashboardShortId}`}
                class="sidebar-item-mobile"
              >
                <i class="ti ti-arrow-left" />
                Back to dashboard
              </a>
            </div>
          </details>
        </nav>

        <EditSidebar
          baseId={baseId}
          baseShortId={baseShortId}
          activeTableSlug={tables[0]?.shortId ?? ""}
          tables={tables}
          viewsByTable={viewsByTable}
          dashboards={dashboards}
          defaultDashboardId={base.defaultDashboardId}
          active={{ kind: "dashboard", dashboardId: dashboard.id }}
          canCreateTables={canCreateTables}
        />

        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          <DashboardEditPage
            baseShortId={baseShortId}
            initialDashboard={dashboard}
            isBaseDefault={base.defaultDashboardId === dashboard.id}
            tables={tables.map((t) => ({ id: t.id, name: t.name, slug: t.shortId }))}
            fieldsByTable={fieldsByTable}
            viewsByTable={viewsByTable}
            initialAccessEntries={accessEntries}
            canEditAccess={canEditAccess}
          />
        </main>
      </div>
    </Layout>
  );
});
