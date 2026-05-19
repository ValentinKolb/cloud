/**
 * Navigation tab — app workspace layouts, pagination, filter chips.
 *
 * Pagination today is HREF-based; the demo intercepts clicks so that
 * scrolling around the lab doesn't trigger a navigation. Behaviour
 * note also added to the description so consumers know what to expect.
 */
import { createSignal } from "solid-js";
import { AppWorkspace, Pagination, FilterChip, type FilterChipSection } from "@valentinkolb/cloud/ui";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const PaginationDemo = () => {
  const [page, setPage] = createSignal(3);
  return (
    <DemoCard
      id="pagination"
      chip={{ kind: "component", name: "Pagination", from: FROM_UI }}
      description="HREF-based — clicks navigate. The demo intercepts clicks so scrolling around the lab doesn't trigger a real page change."
      code={`<Pagination currentPage={3} totalPages={8} baseUrl="/items?page=" />`}
    >
      <div
        onClick={(e) => {
          // Demo-only: stop the anchor from navigating; parse the page
          // number from the visible target instead.
          const a = (e.target as HTMLElement).closest("a");
          if (a) {
            e.preventDefault();
            const n = parseInt(a.textContent ?? "", 10);
            if (Number.isFinite(n)) setPage(n);
          }
        }}
      >
        <Pagination currentPage={page()} totalPages={8} baseUrl="#page-" />
      </div>
    </DemoCard>
  );
};

const FilterChipDemo = () => {
  const [v, setV] = createSignal<string[]>(["open", "ui"]);
  const sections: FilterChipSection[] = [
    {
      label: "Status",
      options: [
        { value: "open", label: "Open", icon: "ti ti-circle" },
        { value: "done", label: "Done", icon: "ti ti-check" },
      ],
    },
    {
      label: "Tags",
      multiple: true,
      options: [
        { value: "urgent", label: "Urgent", color: "#ef4444" },
        { value: "backend", label: "Backend", color: "#2563eb" },
        { value: "ui", label: "UI", color: "#14b8a6" },
      ],
    },
  ];
  return (
    <DemoCard
      id="filterchip"
      chip={{ kind: "component", name: "FilterChip", from: FROM_UI }}
      description="Multi-section dropdown with single OR multi-select per section. Value is a flat string[] of selected option values."
      code={`<FilterChip
  label="Filter"
  icon="ti ti-filter"
  value={v()}
  onChange={setV}
  options={[
    { label: "Status", options: [{ value: "open", label: "Open" }, …] },
    { label: "Tags", multiple: true, options: [{ value: "ui", label: "UI", color: "#14b8a6" }, …] },
  ]}
/>`}
    >
      <div class="flex items-center gap-3">
        <FilterChip label="Filter" icon="ti ti-filter" value={v()} onChange={setV} options={sections} />
        <span class="text-xs text-dimmed font-mono">{v().length ? v().join(", ") : "none"}</span>
      </div>
    </DemoCard>
  );
};

const AppWorkspaceDemo = () => {
  const [selectedId, setSelectedId] = createSignal("launch");

  return (
    <DemoCard
      id="sidebarlayout"
      chip={{ kind: "component", name: "AppWorkspace", from: FROM_UI }}
      description="Compound layout for app workspaces. The components own sidebar, active-item, main, and detail shell styling so apps do not hand-roll classes."
      code={`<AppWorkspace>
  <AppWorkspace.Sidebar>
    <AppWorkspace.SidebarHeader title="Project" subtitle="Q2 sprint" icon="ti ti-folder" />
    <AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarMobileItems>
        <AppWorkspace.SidebarItem href="/app" icon="ti ti-home" active>Overview</AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarMobileItems>
    </AppWorkspace.SidebarMobile>
    <AppWorkspace.SidebarDesktop>
      <AppWorkspace.SidebarSection title="Navigation">
        <AppWorkspace.SidebarItem href="/app" icon="ti ti-home" active>Overview</AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarSection>
    </AppWorkspace.SidebarDesktop>
  </AppWorkspace.Sidebar>
  <AppWorkspace.Main>…</AppWorkspace.Main>
  <AppWorkspace.Detail open width="sm">…</AppWorkspace.Detail>
</AppWorkspace>`}
    >
      <div class="h-80 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
        <AppWorkspace>
          <AppWorkspace.Sidebar>
            <AppWorkspace.SidebarHeader title="Project" subtitle="Q2 sprint" icon="ti ti-folder" />
            <AppWorkspace.SidebarMobile>
              <AppWorkspace.SidebarMobileItems>
                <AppWorkspace.SidebarItem icon="ti ti-home" active={selectedId() === "overview"} onClick={() => setSelectedId("overview")}>
                  Overview
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem icon="ti ti-checklist" meta={12} active={selectedId() === "tasks"} onClick={() => setSelectedId("tasks")}>
                  Tasks
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarMobileItems>
            </AppWorkspace.SidebarMobile>
            <AppWorkspace.SidebarDesktop>
              <AppWorkspace.SidebarSection title="Navigation">
                <AppWorkspace.SidebarItem icon="ti ti-home" active={selectedId() === "overview"} onClick={() => setSelectedId("overview")}>
                  Overview
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem icon="ti ti-checklist" meta={12} active={selectedId() === "tasks"} onClick={() => setSelectedId("tasks")}>
                  Tasks
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem icon="ti ti-users" active={selectedId() === "members"} onClick={() => setSelectedId("members")}>
                  Members
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarSection>

              <AppWorkspace.SidebarBody>
                <AppWorkspace.SidebarSection title="Roadmap">
                  <AppWorkspace.SidebarItem icon="ti ti-file-text" active={selectedId() === "launch"} onClick={() => setSelectedId("launch")}>
                    Launch plan
                  </AppWorkspace.SidebarItem>
                  <AppWorkspace.SidebarItem icon="ti ti-chart-line" active={selectedId() === "metrics"} onClick={() => setSelectedId("metrics")}>
                    Metrics
                  </AppWorkspace.SidebarItem>
                  <AppWorkspace.SidebarItem icon="ti ti-map" active={selectedId() === "q2"} onClick={() => setSelectedId("q2")}>
                    Q2 Beta
                  </AppWorkspace.SidebarItem>
                </AppWorkspace.SidebarSection>
              </AppWorkspace.SidebarBody>

              <AppWorkspace.SidebarFooter>
                <AppWorkspace.SidebarItem icon="ti ti-settings">Settings</AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarFooter>
            </AppWorkspace.SidebarDesktop>
          </AppWorkspace.Sidebar>

          <AppWorkspace.Main class="p-3">
            <div class="paper flex h-full min-h-0 flex-col p-4">
              <p class="text-sm font-semibold text-primary">Workspace content</p>
              <p class="mt-1 text-xs text-dimmed">Current selection: {selectedId()}</p>
            </div>
          </AppWorkspace.Main>

          <AppWorkspace.Detail open width="sm">
            <div class="detail-section">
              <h3 class="detail-section-label">Details</h3>
              <p class="text-xs text-dimmed">Detail panels use the same shell across apps.</p>
            </div>
          </AppWorkspace.Detail>
        </AppWorkspace>
      </div>
    </DemoCard>
  );
};

export const NavigationTab = () => (
  <div class="grid grid-cols-1 gap-3">
    <PaginationDemo />
    <FilterChipDemo />
    <AppWorkspaceDemo />
  </div>
);
