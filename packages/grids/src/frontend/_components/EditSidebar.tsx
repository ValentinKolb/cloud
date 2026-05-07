import { For, Show } from "solid-js";
import type { Table, View } from "../../service";
import CreateTableButton from "./CreateTableButton.island";

type ActiveTarget =
  | { kind: "table"; tableId: string }
  | { kind: "view"; tableId: string; viewId: string };

type Props = {
  /** Parent base UUID — needed by `CreateTableButton` for its API call
   *  (the create endpoint still keys by UUID; only URLs use slugs). */
  baseId: string;
  baseSlug: string;
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
   * What's currently being edited. Drives the `sidebar-item-active`
   * highlight + the icon in the header (table = `ti-table`, view =
   * `ti-table-spark`).
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

  // Active-target helpers for the "Back to records" link. From a view-
  // edit, back goes to the view itself (so the user sees their preset
  // applied). From a table-edit, back goes to the table.
  const backHref = (() => {
    if (props.active.kind === "view") {
      return `/app/grids/${props.baseSlug}?table=${props.activeTableSlug}&view=${props.activeViewSlug ?? ""}`;
    }
    return `/app/grids/${props.baseSlug}?table=${props.activeTableSlug}`;
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

  const headerIcon = props.active.kind === "view" ? "ti ti-table-spark" : "ti ti-table";

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
                  href={`/app/grids/${props.baseSlug}/tables/${t.slug}/edit`}
                  class={`sidebar-item ${isActiveTable(t.id) ? "sidebar-item-active" : ""}`}
                >
                  <i class="ti ti-table text-sm shrink-0" />
                  <span class="truncate min-w-0">{t.name}</span>
                </a>
              )}
            </For>
            <Show when={props.canCreateTables}>
              <CreateTableButton baseId={props.baseId} baseSlug={props.baseSlug} />
            </Show>
          </section>

          <Show when={allViews.length > 0}>
            <section class="sidebar-group">
              <p class="sidebar-section-title">Views</p>
              <For each={allViews}>
                {({ view, table: t }) => (
                  <a
                    href={`/app/grids/${props.baseSlug}/tables/${t.slug}/views/${view.slug}/edit`}
                    class={`sidebar-item ${isActiveView(view.id) ? "sidebar-item-active" : ""}`}
                  >
                    <i class="ti ti-table-spark text-sm shrink-0" />
                    <span class="truncate min-w-0">{view.name}</span>
                  </a>
                )}
              </For>
            </section>
          </Show>
        </div>
      </div>
    </aside>
  );
}
