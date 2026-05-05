import type { JSX } from "solid-js";
import type { FileBaseInfo } from "@/contracts";

type BaseSidebarProps = {
  bases: FileBaseInfo[];
  currentBaseType: string;
  currentBaseId: string;
  settingsPanel?: () => JSX.Element;
};

const isActive = (base: FileBaseInfo, currentBaseType: string, currentBaseId: string) => {
  if (base.type === "home") {
    return currentBaseType === "home" && currentBaseId === base.id;
  }
  return currentBaseType === "group" && currentBaseId === base.id;
};

const getHref = (base: FileBaseInfo) => {
  return base.type === "home" ? "/app/files/home" : `/app/files/group/${base.id}`;
};

const getHomeLabel = (name: string) => name.replace("Home (", "").replace(")", "");

export default function BaseSidebar(props: BaseSidebarProps) {
  const homeBases = props.bases.filter((b) => b.type === "home");
  const groupBases = props.bases.filter((b) => b.type === "group");
  const isSearch = props.currentBaseType === "search";

  return (
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="sidebar-header-icon bg-blue-500">
              <i class="ti ti-folders text-xs" />
            </div>
            <span class="sidebar-header-title">Files</span>
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>

          <div class="sidebar-mobile-actions">
            <a
              href="/app/files/search"
              class={`sidebar-item-mobile ${isSearch ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
            >
              <i class="ti ti-search" />
              Search
            </a>
            {props.bases.map((base) => {
              const active = isActive(base, props.currentBaseType, props.currentBaseId);
              return (
                <a
                  href={getHref(base)}
                  class={`sidebar-item-mobile ${active ? "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200" : ""}`}
                >
                  {base.type === "home" ? <i class="ti ti-home" /> : <i class="ti ti-users-group" />}
                  <span class="truncate">{base.type === "home" ? getHomeLabel(base.name) : base.name}</span>
                </a>
              );
            })}
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
          <div class="flex items-center gap-3">
            <div class="sidebar-header-icon bg-blue-500">
              <i class="ti ti-folders text-xs" />
            </div>
            <p class="sidebar-header-title">Files</p>
          </div>

          <div class="flex flex-col gap-3">
            <section class="sidebar-group">
              <p class="sidebar-section-title">Actions</p>
              <a href="/app/files/search" class={`sidebar-item text-xs ${isSearch ? "sidebar-item-active" : ""}`}>
                <i class="ti ti-search text-sm" />
                <span>Search</span>
              </a>
            </section>
          </div>

          <div class="sidebar-body">
            {homeBases.length > 0 && (
              <section class="sidebar-group">
                <p class="sidebar-section-title">Home</p>
                {homeBases.map((base) => {
                  const active = isActive(base, props.currentBaseType, props.currentBaseId);
                  return (
                    <a href={getHref(base)} class={`sidebar-item text-xs ${active ? "sidebar-item-active" : ""}`}>
                      <i class="ti ti-home text-sm" />
                      <span class="truncate">{getHomeLabel(base.name)}</span>
                    </a>
                  );
                })}
              </section>
            )}

            {groupBases.length > 0 && (
              <section class="sidebar-group">
                <p class="sidebar-section-title">Groups</p>
                {groupBases.map((base) => {
                  const active = isActive(base, props.currentBaseType, props.currentBaseId);
                  return (
                    <a href={getHref(base)} class={`sidebar-item text-xs ${active ? "sidebar-item-active" : ""}`}>
                      <i class="ti ti-users-group text-sm" />
                      <span class="truncate">{base.name}</span>
                    </a>
                  );
                })}
              </section>
            )}

            {props.bases.length === 0 && (
              <p class="px-2 py-1 text-xs text-dimmed">
                <i class="ti ti-folder-off mr-1" />
                No accessible bases
              </p>
            )}

            {props.settingsPanel ? <section class="sidebar-group">{props.settingsPanel()}</section> : null}
          </div>
        </div>
      </aside>
    </>
  );
}
