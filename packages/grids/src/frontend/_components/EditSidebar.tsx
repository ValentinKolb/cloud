import { For, Show } from "solid-js";
import type { Dashboard, Table, View } from "../../service";
import CreateTableButton from "./CreateTableButton.island";
import CreateDashboardButton from "./CreateDashboardButton.island";

type ActiveTarget =
  | { kind: "table"; tableId: string }
  | { kind: "view"; tableId: string; viewId: string }
  | { kind: "dashboard"; dashboardId: string };

type Props = {
  /** Parent base UUID — needed by `CreateTableButton` for its API call
   *  (the create endpoint still keys by UUID; only URLs use slugs). */
  baseId: string;
  baseShortId: string;
  /**
   * URL-friendly slug for the active table (used to build the "Back to
   * records" href). Provided alongside the UUID-based `active` so we
   * don't have to scan tables[] to find it.
   */
  activeTableSlug: string;
  /** Slug for the active view, when active.kind === "view". */
  activeViewSlug?: string;
  /**
   * Sibling tables to list. Caller pre-filters to the readable set
   * (admin sees all; non-admin sees what they can read) so the
   * sidebar never shows unreachable links.
   */
  tables: Table[];
  /**
   * Views grouped by their owning tableId. Same source as the records
   * page sidebar — so the user sees the exact same listing shape
   * whether they're editing or browsing records.
   */
  viewsByTable: Record<string, View[]>;
  /**
   * Dashboards on this base — listed below Views in the sidebar so the
   * user can hop from a dashboard-edit to a table-edit (and vice versa)
   * in one click. Caller pre-filters to readable ones.
   */
  dashboards: Dashboard[];
  /** Slug of the dashboard currently set as the base default — drives
   *  the `default` badge next to the matching list entry. Optional;
   *  null when no default is configured. */
  defaultDashboardId: string | null;
  /**
   * What's currently being edited. Drives the `sidebar-item-active`
   * highlight + the icon in the header (table = `ti-table`, view =
   * `ti-table-spark`, dashboard = `ti-layout-dashboard`).
   */
  active: ActiveTarget;
  /**
   * Whether to render the "New table" entry under the Tables list. Mirrors
   * the records-page sidebar so the create-table affordance lives in the
   * same spot whether the user is browsing records or editing schema.
   * Caller computes this from the base-level permission (write or higher).
   */
  canCreateTables: boolean;
};

/**
 * Unified sidebar for both the table-edit and view-edit pages.
 *
 * Why unified: both editors share the same `app-cols` shell and both
 * benefit from being able to hop directly to a sibling table OR a
 * sibling view in one click. Splitting the sidebar (one listing tables,
 * one listing views) made the editor feel like two disconnected
 * surfaces — even though structurally they're the same "settings"
 * area.
 *
 * What stays separate: the main-column editor island. Table editor =
 * schema (fields, forms, ACLs, admin-level). View editor = saved-
 * preset metadata (rename / share / delete, owner-or-table-write
 * level). Different concerns, different audiences — merging the
 * editors themselves would just confuse.
 *
 * Header: just "Edit" with the active target's icon — no subtitle
 * with the name (already in breadcrumbs, redundant here).
 */
export default function EditSidebar(props: Props) {
  const isActiveTable = (tableId: string) =>
    props.active.kind === "table" && props.active.tableId === tableId;

  const isActiveView = (viewId: string) =>
    props.active.kind === "view" && props.active.viewId === viewId;

  const isActiveDashboard = (dashboardId: string) =>
    props.active.kind === "dashboard" && props.active.dashboardId === dashboardId;

  // Active-target helpers for the "Back to records" link. From a view-
  // edit, back goes to the view itself (so the user sees their preset
  // applied). From a table-edit, back goes to the table. From a
  // dashboard-edit, back goes to the dashboard render.
  const backHref = (() => {
    const a = props.active;
    if (a.kind === "view") {
      return `/app/grids/${props.baseShortId}?table=${props.activeTableSlug}&view=${props.activeViewSlug ?? ""}`;
    }
    if (a.kind === "dashboard") {
      const slug = props.dashboards.find((d) => d.id === a.dashboardId)?.shortId;
      return slug
        ? `/app/grids/${props.baseShortId}?dashboard=${slug}`
        : `/app/grids/${props.baseShortId}`;
    }
    return `/app/grids/${props.baseShortId}?table=${props.activeTableSlug}`;
  })();

  // Flat alphabetical view list — same UX as the records page sidebar.
  const allViews: { view: View; table: Table }[] = [];
  for (const t of props.tables) {
    for (const v of props.viewsByTable[t.id] ?? []) {
      allViews.push({ view: v, table: t });
    }
  }
  allViews.sort((a, b) =>
    a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base" }),
  );

  const headerIcon =
    props.active.kind === "view"
      ? "ti ti-table-spark"
      : props.active.kind === "dashboard"
      ? "ti ti-layout-dashboard"
      : "ti ti-table";

  const sortedDashboards = () =>
    [...props.dashboards].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

  return (
    <aside class="sidebar-container">
      <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
        <div class="relative flex items-center gap-3 pr-7">
          <div class="sidebar-header-icon" style="background-color:#3b82f6">
            <i class={`${headerIcon} text-xs`} />
          </div>
          <div class="min-w-0 flex-1">
            <p class="sidebar-header-title">Edit</p>
          </div>
        </div>

        <section class="sidebar-group">
          <p class="sidebar-section-title">Actions</p>
          <a href={backHref} class="sidebar-item text-xs">
            <i class="ti ti-arrow-left text-sm" />
            <span>Back to records</span>
          </a>
        </section>

        <div class="sidebar-body">
          <section class="sidebar-group">
            <p class="sidebar-section-title">Tables</p>
            <For each={props.tables}>
              {(t) => (
                <a
                  href={`/app/grids/${props.baseShortId}/tables/${t.shortId}/edit`}
                  class={`sidebar-item ${isActiveTable(t.id) ? "sidebar-item-active" : ""}`}
                >
                  <i class="ti ti-table text-sm shrink-0" />
                  <span class="truncate min-w-0">{t.name}</span>
                </a>
              )}
            </For>
            <Show when={props.canCreateTables}>
              <CreateTableButton baseId={props.baseId} baseShortId={props.baseShortId} />
            </Show>
          </section>

          <Show when={allViews.length > 0}>
            <section class="sidebar-group">
              <p class="sidebar-section-title">Views</p>
              <For each={allViews}>
                {({ view, table: t }) => (
                  <a
                    href={`/app/grids/${props.baseShortId}/tables/${t.shortId}/views/${view.shortId}/edit`}
                    class={`sidebar-item ${isActiveView(view.id) ? "sidebar-item-active" : ""}`}
                  >
                    <i class="ti ti-table-spark text-sm shrink-0" />
                    <span class="truncate min-w-0">{view.name}</span>
                  </a>
                )}
              </For>
            </section>
          </Show>

          <Show when={props.dashboards.length > 0 || props.canCreateTables}>
            <section class="sidebar-group">
              <p class="sidebar-section-title">Dashboards</p>
              <For each={sortedDashboards()}>
                {(d) => (
                  <a
                    href={`/app/grids/${props.baseShortId}/dashboards/${d.shortId}/edit`}
                    class={`sidebar-item ${isActiveDashboard(d.id) ? "sidebar-item-active" : ""}`}
                  >
                    <i class="ti ti-layout-dashboard text-sm shrink-0" />
                    <span class="truncate min-w-0">{d.name}</span>
                    <Show when={props.defaultDashboardId === d.id}>
                      <span class="text-[9px] uppercase tracking-wider text-dimmed shrink-0">
                        default
                      </span>
                    </Show>
                  </a>
                )}
              </For>
              <Show when={props.canCreateTables}>
                <CreateDashboardButton baseId={props.baseId} baseShortId={props.baseShortId} />
              </Show>
            </section>
          </Show>
        </div>
      </div>
    </aside>
  );
}
