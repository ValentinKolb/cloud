import { ssr } from "../../../../../../../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { hasRole } from "@valentinkolb/cloud/contracts";
import { gridsService } from "../../../../../../../service";
import ViewEditPage from "../../../../../../_components/ViewEditPage.island";

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
  const baseId = c.req.param("baseId");
  const tableId = c.req.param("tableId");
  const viewId = c.req.param("viewId");

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
  const view = await gridsService.view.get(viewId);
  if (!view || view.tableId !== tableId) {
    return () => (
      <Layout c={c} title="Not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> View not found
        </div>
      </Layout>
    );
  }

  const tableLevel = await resolveLevel(user, baseId, tableId);
  const isOwner = view.ownerUserId === user.id;
  const isShared = view.ownerUserId === null;
  const requiredLevel = isShared ? "write" : "read";
  if (!gridsService.permission.hasAtLeast(tableLevel, requiredLevel)) {
    return c.redirect(`/app/grids/${baseId}?table=${tableId}`, 302);
  }
  if (!isShared && !isOwner) {
    return c.redirect(`/app/grids/${baseId}?table=${tableId}`, 302);
  }

  const fields = await gridsService.field.listByTable(tableId);
  // Sibling views for the sidebar nav.
  const viewsForTable = await gridsService.view.listForTable({
    tableId,
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
        { title: base.name, href: `/app/grids/${baseId}` },
        { title: table.name, href: `/app/grids/${baseId}?table=${tableId}` },
        { title: view.name, href: `/app/grids/${baseId}?table=${tableId}&view=${viewId}` },
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
                href={`/app/grids/${baseId}?table=${tableId}&view=${viewId}`}
                class="sidebar-item-mobile"
              >
                <i class="ti ti-arrow-left" />
                Back to records
              </a>
              {viewsForTable.map((v) => {
                const isActive = v.id === viewId;
                return (
                  <a
                    href={`/app/grids/${baseId}/tables/${tableId}/views/${v.id}/edit`}
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

        <aside class="sidebar-container">
          <div class="paper flex h-full min-h-0 flex-col gap-4 p-4">
            <div class="relative flex items-center gap-3 pr-7">
              <div class="sidebar-header-icon" style="background-color:#3b82f6">
                <i class="ti ti-table-spark text-xs" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="sidebar-header-title">Edit view</p>
                <p class="sidebar-header-subtitle truncate">{view.name}</p>
              </div>
            </div>

            <section class="sidebar-group">
              <p class="sidebar-section-title">Actions</p>
              <a
                href={`/app/grids/${baseId}?table=${tableId}&view=${viewId}`}
                class="sidebar-item text-xs"
              >
                <i class="ti ti-arrow-left text-sm" />
                <span>Back to records</span>
              </a>
            </section>

            <div class="sidebar-body">
              <section class="sidebar-group">
                <p class="sidebar-section-title">Views on {table.name}</p>
                {viewsForTable.map((v) => {
                  const isActive = v.id === viewId;
                  return (
                    <a
                      href={`/app/grids/${baseId}/tables/${tableId}/views/${v.id}/edit`}
                      class={`sidebar-item text-xs ${isActive ? "sidebar-item-active" : ""}`}
                    >
                      <i class="ti ti-table-spark text-sm" />
                      <span class="truncate">{v.name}</span>
                    </a>
                  );
                })}
              </section>
            </div>
          </div>
        </aside>

        <main class="order-2 flex-1 min-w-0 min-h-0 overflow-auto">
          <ViewEditPage
            baseId={baseId}
            tableId={tableId}
            initialView={view}
            fields={fields}
          />
        </main>
      </div>
    </Layout>
  );
});
