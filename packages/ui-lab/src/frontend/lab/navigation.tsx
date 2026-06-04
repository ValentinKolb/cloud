/**
 * Navigation tab — app workspace layouts, pagination, filter chips.
 *
 * Pagination today is HREF-based; the demo intercepts clicks so that
 * scrolling around the lab doesn't trigger a navigation. Behaviour
 * note also added to the description so consumers know what to expect.
 */

import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import {
  AppOverview,
  AppWorkspace,
  dialogCore,
  FilterChip,
  type FilterChipSection,
  Pagination,
  PanelDialog,
  PermissionEditor,
  panelDialogOptions,
  SettingsModal,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { Link } from "@valentinkolb/ssr/nav";
import { createSignal, For } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

export const PaginationDemo = () => {
  const [page, setPage] = createSignal(3);
  return (
    <DemoCard
      id="pagination"
      chip={{ kind: "component", name: "Pagination", from: FROM_UI }}
      description="HREF-based — clicks navigate. The demo intercepts clicks so scrolling around the lab doesn't trigger a real page change."
      code={`<Pagination currentPage={3} totalPages={8} baseUrl="/items?page=" />`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Demo wrapper intercepts anchor navigation while the nested Pagination anchors keep their own keyboard semantics. */}
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

export const NavigationEnhancementDemo = () => {
  const [view, setView] = createSignal<"alpha" | "beta">("alpha");
  const items = () =>
    Array.from({ length: 28 }, (_, index) => ({
      id: `${view()}-${index + 1}`,
      label: `${view() === "alpha" ? "Alpha" : "Beta"} item ${index + 1}`,
    }));

  return (
    <DemoCard
      id="navigation-enhancement"
      chip={{ kind: "component", name: "Link / navigate", from: FROM_UI }}
      description="Progressive navigation helper. Links remain real anchors; enhanced clicks run in a View Transition when supported and keyed data-scroll-preserve regions keep their inner scroll."
      code={`<AppWorkspace.SidebarBody scrollPreserveKey="workspace-sidebar">
  …
</AppWorkspace.SidebarBody>

<Link
  href="/app/example?view=beta"
  scroll="top"
  onNavigate={(nav) => {
    setView("beta");
    nav.push();
  }}
>
  Open beta
</Link>`}
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Link
            href="?nav-demo=alpha"
            class={`btn-sm ${view() === "alpha" ? "btn-primary" : "btn-secondary"}`}
            scroll="top"
            replace
            onNavigate={(nav) => {
              setView("alpha");
              nav.replaceWith();
            }}
          >
            Alpha
          </Link>
          <Link
            href="?nav-demo=beta"
            class={`btn-sm ${view() === "beta" ? "btn-primary" : "btn-secondary"}`}
            scroll="top"
            replace
            onNavigate={(nav) => {
              setView("beta");
              nav.replaceWith();
            }}
          >
            Beta
          </Link>
          <span class="text-xs text-dimmed">Scroll both panes, then switch views.</span>
        </div>

        <div class="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div class="paper flex h-56 flex-col overflow-hidden">
            <div class="border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-dimmed dark:border-zinc-800">
              Preserved sidebar
            </div>
            <div data-scroll-preserve="ui-lab-nav-demo-sidebar" class="min-h-0 flex-1 overflow-auto p-2">
              <For each={items()}>
                {(item) => (
                  <div class="mb-1 rounded-md px-2 py-1.5 text-xs text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <i class="ti ti-chevron-right mr-1 text-[10px] text-dimmed" />
                    {item.label}
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="paper flex h-56 flex-col overflow-hidden">
            <div class="border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-dimmed dark:border-zinc-800">
              Preserved records body
            </div>
            <div data-scroll-preserve="ui-lab-nav-demo-records" class="min-h-0 flex-1 overflow-auto p-2">
              <For each={items()}>
                {(item, index) => (
                  <div class="mb-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                    <p class="font-medium text-primary">{item.label}</p>
                    <p class="text-xs text-dimmed">Row {index() + 1} keeps its scroll context across enhanced navigation.</p>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </DemoCard>
  );
};

export const FilterChipDemo = () => {
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

export const AppWorkspaceDemo = () => {
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
        <AppWorkspace.SidebarItem href="/app" icon="ti ti-home" active navigation="document">Overview</AppWorkspace.SidebarItem>
      </AppWorkspace.SidebarMobileItems>
    </AppWorkspace.SidebarMobile>
    <AppWorkspace.SidebarDesktop>
      <AppWorkspace.SidebarSection title="Navigation">
        <AppWorkspace.SidebarItem href="/app" icon="ti ti-home" active navigation="document">Overview</AppWorkspace.SidebarItem>
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
                <AppWorkspace.SidebarItem
                  icon="ti ti-checklist"
                  meta={12}
                  active={selectedId() === "tasks"}
                  onClick={() => setSelectedId("tasks")}
                >
                  Tasks
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarMobileItems>
            </AppWorkspace.SidebarMobile>
            <AppWorkspace.SidebarDesktop>
              <AppWorkspace.SidebarSection title="Navigation">
                <AppWorkspace.SidebarItem icon="ti ti-home" active={selectedId() === "overview"} onClick={() => setSelectedId("overview")}>
                  Overview
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem
                  icon="ti ti-checklist"
                  meta={12}
                  active={selectedId() === "tasks"}
                  onClick={() => setSelectedId("tasks")}
                >
                  Tasks
                </AppWorkspace.SidebarItem>
                <AppWorkspace.SidebarItem icon="ti ti-users" active={selectedId() === "members"} onClick={() => setSelectedId("members")}>
                  Members
                </AppWorkspace.SidebarItem>
              </AppWorkspace.SidebarSection>

              <AppWorkspace.SidebarBody scrollPreserveKey="ui-lab-workspace-demo-sidebar">
                <AppWorkspace.SidebarSection title="Roadmap">
                  <AppWorkspace.SidebarItem
                    icon="ti ti-file-text"
                    active={selectedId() === "launch"}
                    onClick={() => setSelectedId("launch")}
                  >
                    Launch plan
                  </AppWorkspace.SidebarItem>
                  <AppWorkspace.SidebarItem
                    icon="ti ti-chart-line"
                    active={selectedId() === "metrics"}
                    onClick={() => setSelectedId("metrics")}
                  >
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

const overviewRows = [
  { icon: "ti ti-file-text", title: "Launch checklist", meta: "Product", status: "Updated 2m ago" },
  { icon: "ti ti-sparkles", title: "Prompt library", meta: "AI", status: "12 templates" },
  { icon: "ti ti-lock", title: "Security review", meta: "Ops", status: "Needs owner" },
];

export const AppOverviewDemo = () => {
  const [query, setQuery] = createSignal("");
  const filteredRows = () => overviewRows.filter((row) => row.title.toLowerCase().includes(query().toLowerCase()));

  return (
    <DemoCard
      id="appoverview"
      chip={{ kind: "component", name: "AppOverview", from: FROM_UI }}
      description="Generic overview shell for app landing pages. It provides the app header, responsive main/aside columns, panels, toolbars, and empty states."
      code={`<AppOverview title="Notebooks" subtitle="Shared notes and prompts" icon="ti ti-notebook">
  <AppOverview.Main
    title="Recent notes"
    description="Continue where your team left off."
    toolbar={<TextInput value={query} onInput={setQuery} placeholder="Search notes" clearable />}
  >
    …
  </AppOverview.Main>
  <AppOverview.Aside title="Shortcuts">
    …
  </AppOverview.Aside>
</AppOverview>`}
    >
      <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
        <AppOverview title="Notebooks" subtitle="Shared notes and prompts" icon="ti ti-notebook">
          <AppOverview.Main
            title="Recent notes"
            description="Continue where your team left off."
            toolbar={<TextInput value={query} onInput={setQuery} placeholder="Search notes" clearable icon="ti ti-search" />}
          >
            <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filteredRows().map((row) => (
                <div class="flex items-center gap-3 px-3 py-2">
                  <span class="thumbnail h-9 w-9 text-blue-500">
                    <i class={row.icon} />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-primary">{row.title}</p>
                    <p class="text-xs text-dimmed">{row.meta}</p>
                  </div>
                  <span class="text-xs text-dimmed">{row.status}</span>
                </div>
              ))}
              {filteredRows().length === 0 && (
                <AppOverview.EmptyState title="No notes found" description="Try another search term." icon="ti ti-search" />
              )}
            </div>
          </AppOverview.Main>

          <AppOverview.Aside title="Shortcuts" description="Small supporting panels sit beside the main overview.">
            <div class="grid gap-2">
              <button type="button" class="btn-input justify-start">
                <i class="ti ti-plus" />
                New note
              </button>
              <button type="button" class="btn-input justify-start">
                <i class="ti ti-users" />
                Shared with me
              </button>
            </div>
          </AppOverview.Aside>
        </AppOverview>
      </div>
    </DemoCard>
  );
};

export const SettingsModalDemo = () => (
  <DemoCard
    id="settingsmodal"
    chip={{ kind: "component", name: "SettingsModal", from: FROM_UI }}
    description="Settings shell for tabbed configuration dialogs. Apps can render it inline or inside a bare prompt dialog when they need the dialog chrome to come from SettingsModal."
    code={`prompts.dialog<void>(
  (close) => (
    <SettingsModal title="Notebook settings" icon="ti ti-notebook" onClose={close}>
      <SettingsModal.Tab id="general" title="General" icon="ti ti-settings">
        …
      </SettingsModal.Tab>
      <SettingsModal.Tab id="danger" title="Danger" icon="ti ti-alert-triangle" tone="danger">
        …
      </SettingsModal.Tab>
    </SettingsModal>
  ),
  { surface: "bare", header: false, size: "large" },
);`}
  >
    <div class="h-[30rem] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <SettingsModal title="Notebook settings" subtitle="Inline preview of the settings shell" icon="ti ti-notebook">
        <SettingsModal.Tab id="general" title="General" description="Name, icon, and basic metadata" icon="ti ti-settings">
          <div class="detail-section">
            <h3 class="detail-section-label">General</h3>
            <div class="grid gap-2">
              <TextInput value={() => "Team notebook"} onInput={() => {}} label="Name" />
              <label class="flex items-center justify-between gap-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <span class="text-primary">Show recent notes on overview</span>
                <input type="checkbox" checked />
              </label>
            </div>
          </div>
        </SettingsModal.Tab>
        <SettingsModal.Tab id="access" title="Access" description="Members and shared permissions" icon="ti ti-users">
          <div class="info-block-info">Access controls can use PermissionEditor inside this tab.</div>
        </SettingsModal.Tab>
        <SettingsModal.Tab id="danger" title="Danger" description="Destructive actions" icon="ti ti-alert-triangle" tone="danger">
          <div class="info-block-danger">Danger tabs are visually separated in the tab list.</div>
        </SettingsModal.Tab>
      </SettingsModal>
    </div>
  </DemoCard>
);

export const PanelDialogDemo = () => {
  const openDemo = () => {
    void dialogCore.open<void>(
      (close) => (
        <PanelDialog>
          <PanelDialog.Header title="Edit item" icon="ti ti-pencil" close={close} />
          <PanelDialog.Body>
            <PanelDialog.Section title="Basics" subtitle="Layout only: bring your own inputs and mutation." icon="ti ti-id">
              <TextInput label="Title" value={() => "Launch checklist"} onInput={() => {}} icon="ti ti-text-caption" />
              <TextInput label="Description" value={() => "Coordinate final release tasks."} onInput={() => {}} markdown />
            </PanelDialog.Section>
            <PanelDialog.Section
              title="Classify"
              subtitle="Sections keep complex forms scannable without owning field behavior."
              icon="ti ti-tags"
            >
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <button type="button" class="btn-input justify-start">
                  <i class="ti ti-progress" />
                  In progress
                </button>
                <button type="button" class="btn-input justify-start">
                  <i class="ti ti-flag" />
                  High priority
                </button>
              </div>
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <button type="button" class="btn-simple btn-sm text-red-500">
              <i class="ti ti-trash" />
              Delete
            </button>
            <div class="flex items-center gap-2">
              <button type="button" class="btn-secondary btn-sm" onClick={() => close()}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={() => close()}>
                Save
              </button>
            </div>
          </PanelDialog.Footer>
        </PanelDialog>
      ),
      panelDialogOptions,
    );
  };

  return (
    <DemoCard
      id="paneldialog"
      chip={{ kind: "component", name: "PanelDialog", from: FROM_UI }}
      description="Layout-only modal chrome for complex editors: fixed panel, non-scrolling header/footer, scrollable body, and section cards. State, validation, and mutations stay in the app."
      code={`dialogCore.open<void>(
  (close) => (
    <PanelDialog>
      <PanelDialog.Header title="Edit item" icon="ti ti-pencil" close={close} />
      <PanelDialog.Body>
        <PanelDialog.Section title="Basics" icon="ti ti-id">
          …
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        …
      </PanelDialog.Footer>
    </PanelDialog>
  ),
  panelDialogOptions,
);`}
    >
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div class="mx-auto flex h-[26rem] max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
          <PanelDialog.Header title="Edit item" subtitle="Inline preview of the dialog layout" icon="ti ti-pencil" close={() => {}} />
          <PanelDialog.Body>
            <PanelDialog.Section title="Basics" subtitle="Name and notes shown across app surfaces." icon="ti ti-id">
              <TextInput label="Title" value={() => "Launch checklist"} onInput={() => {}} icon="ti ti-text-caption" />
              <TextInput label="Description" value={() => "Coordinate final release tasks."} onInput={() => {}} markdown />
            </PanelDialog.Section>
            <PanelDialog.Section title="Classify" subtitle="Use regular app controls inside sections." icon="ti ti-tags">
              <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                <button type="button" class="btn-input justify-start">
                  <i class="ti ti-progress" />
                  In progress
                </button>
                <button type="button" class="btn-input justify-start">
                  <i class="ti ti-flag" />
                  High priority
                </button>
              </div>
            </PanelDialog.Section>
          </PanelDialog.Body>
          <PanelDialog.Footer>
            <button type="button" class="btn-simple btn-sm text-red-500">
              <i class="ti ti-trash" />
              Delete
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={openDemo}>
              Open modal
            </button>
          </PanelDialog.Footer>
        </div>
      </div>
    </DemoCard>
  );
};

const permissionEntries: AccessEntry[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    principal: { type: "user", userId: "22222222-2222-4222-8222-222222222222" },
    permission: "admin",
    createdAt: "2026-05-26T20:00:00.000Z",
    displayName: "Mira Roth",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    principal: { type: "group", groupId: "44444444-4444-4444-8444-444444444444" },
    permission: "write",
    createdAt: "2026-05-26T20:05:00.000Z",
    displayName: "Design Systems",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    principal: { type: "authenticated" },
    permission: "read",
    createdAt: "2026-05-26T20:10:00.000Z",
    displayName: "Signed-in users",
  },
];

let permissionId = 6;

const nextPermissionId = () => {
  permissionId += 1;
  return `${permissionId.toString().padStart(8, "0")}-6666-4666-8666-666666666666`;
};

export const PermissionEditorDemo = () => (
  <DemoCard
    id="permissioneditor"
    chip={{ kind: "component", name: "PermissionEditor", from: FROM_UI }}
    description="Access editor with async grant, update, and revoke callbacks. The component owns the optimistic list state; apps close over the resource id in callback implementations."
    code={`<PermissionEditor
  initialEntries={entries}
  allowPublic
  allowedLevels={[
    { level: "read", label: "View" },
    { level: "write", label: "Edit" },
    { level: "admin", label: "Admin" },
  ]}
  grantAccess={(principal, permission) => api.grantAccess(notebookId, principal, permission)}
  updateAccess={(accessId, permission) => api.updateAccess(notebookId, accessId, permission)}
  revokeAccess={(accessId) => api.revokeAccess(notebookId, accessId)}
/>`}
  >
    <div class="paper-highlighted p-3">
      <PermissionEditor
        initialEntries={permissionEntries}
        allowPublic
        allowedLevels={[
          { level: "read", label: "View" },
          { level: "write", label: "Edit" },
          { level: "admin", label: "Admin" },
        ]}
        grantAccess={async (principal: Principal, permission: Exclude<PermissionLevel, "none">) => ({
          id: nextPermissionId(),
          principal,
          permission,
          createdAt: new Date().toISOString(),
          displayName:
            principal.type === "public" ? "Public link" : principal.type === "authenticated" ? "Signed-in users" : "New collaborator",
        })}
        updateAccess={async () => {}}
        revokeAccess={async () => {}}
      />
    </div>
  </DemoCard>
);

export const NavigationTab = () => (
  <div class="grid grid-cols-1 gap-3">
    <PaginationDemo />
    <FilterChipDemo />
    <AppWorkspaceDemo />
    <AppOverviewDemo />
    <SettingsModalDemo />
    <PermissionEditorDemo />
  </div>
);
