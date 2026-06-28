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
  createPanesValue,
  DockWorkspace,
  type DockWorkspaceState,
  dialogCore,
  FilterChip,
  type FilterChipSection,
  normalizePanesValue,
  Pagination,
  PanelDialog,
  Panes,
  type PanesValue,
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

          <AppWorkspace.Detail open width="sm" class="detail-stack">
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

export const DockWorkspaceDemo = (props: { initialState?: DockWorkspaceState | null }) => (
  <DemoCard
    id="dockworkspace"
    chip={{ kind: "component", name: "DockWorkspace", from: FROM_UI }}
    description="IDE-style workspace shell with one result pane and sectioned bottom panes. Resize the result area and bottom sections; drag tabs between sections to rearrange context."
    code={`<DockWorkspace storageKey="ui-lab.dockworkspace">
  <DockWorkspace.Result title="Result" icon="ti ti-chart-line">
    <ResultView />
  </DockWorkspace.Result>
  <DockWorkspace.Pane id="query" title="Query" icon="ti ti-code" section="editor">
    <QueryEditor />
  </DockWorkspace.Pane>
  <DockWorkspace.Pane id="sources" title="Sources" icon="ti ti-database" section="context">
    <SourcesPanel />
  </DockWorkspace.Pane>
  <DockWorkspace.Pane id="saved" title="Saved" icon="ti ti-device-floppy" section="context">
    <SavedQueries />
  </DockWorkspace.Pane>
</DockWorkspace>`}
  >
    <div class="h-[34rem] overflow-hidden">
      <DockWorkspace storageKey="ui-lab.dockworkspace.demo" initialState={props.initialState}>
        <DockWorkspace.Result title="Result" icon="ti ti-chart-line">
          <div class="paper flex h-full min-h-0 flex-col p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Preview</p>
                <h3 class="text-lg font-semibold text-primary">Revenue by channel</h3>
              </div>
              <div class="rounded bg-zinc-100 px-2 py-1 text-xs text-secondary dark:bg-zinc-900">auto refreshed</div>
            </div>
            <div class="grid min-h-0 flex-1 grid-cols-8 items-end gap-2 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900/70">
              {[42, 64, 51, 78, 69, 92, 58, 83].map((height, index) => (
                <div class="flex min-h-0 flex-col justify-end gap-2">
                  <div class="rounded-t bg-blue-500/80 dark:bg-blue-400/80" style={{ height: `${height}%`, "min-height": "1.5rem" }} />
                  <span class="text-center text-[10px] text-dimmed">{index + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </DockWorkspace.Result>

        <DockWorkspace.Pane id="query" title="Query" icon="ti ti-code" section="editor">
          <div class="h-full bg-fuchsia-50/40 dark:bg-fuchsia-950/10">
            <div class="paper h-full p-3 font-mono text-sm leading-6 text-zinc-900 dark:text-zinc-100">
              <p>
                <span class="text-blue-600 dark:text-blue-300">metric</span> sales.revenue{" "}
                <span class="text-emerald-600 dark:text-emerald-300">sum</span>
              </p>
              <p>
                <span class="text-blue-600 dark:text-blue-300">every</span> 1h
              </p>
              <p>
                <span class="text-blue-600 dark:text-blue-300">since</span> 24h
              </p>
              <p>
                <span class="text-blue-600 dark:text-blue-300">where</span> channel=web
              </p>
            </div>
          </div>
        </DockWorkspace.Pane>

        <DockWorkspace.Pane id="sources" title="Sources" icon="ti ti-database" section="context">
          <div class="h-full bg-fuchsia-50/40 dark:bg-fuchsia-950/10">
            <div class="paper grid h-full content-start gap-2 p-3">
              {["Webshop", "Importer", "Billing"].map((name) => (
                <button
                  type="button"
                  class="rounded-md bg-zinc-100/70 px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
                >
                  <span class="font-medium text-primary">{name}</span>
                  <span class="block text-xs text-dimmed">Click to scope query</span>
                </button>
              ))}
            </div>
          </div>
        </DockWorkspace.Pane>

        <DockWorkspace.Pane id="saved" title="Saved" icon="ti ti-device-floppy" section="context">
          <div class="h-full bg-fuchsia-50/40 dark:bg-fuchsia-950/10">
            <div class="paper grid h-full content-start gap-2 p-3">
              {["Revenue today", "Checkout errors", "Returning users"].map((name) => (
                <button
                  type="button"
                  class="rounded-md bg-zinc-100/70 px-3 py-2 text-left text-sm transition hover:bg-zinc-100 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
                >
                  <span class="font-medium text-primary">{name}</span>
                  <code class="block truncate text-[11px] text-dimmed">metric example.query sum every 1h since 24h</code>
                </button>
              ))}
            </div>
          </div>
        </DockWorkspace.Pane>

        <DockWorkspace.Pane id="reference" title="Reference" icon="ti ti-book" section="help">
          <div class="h-full bg-fuchsia-50/40 text-sm dark:bg-fuchsia-950/10">
            <div class="paper h-full space-y-3 p-3">
              <p class="font-medium text-primary">Query snippets</p>
              <p class="text-dimmed">Drag this tab into another bottom section or resize the section splitters.</p>
              <div class="rounded-md bg-zinc-100/70 p-3 font-mono text-xs dark:bg-zinc-900/60">
                metric &lt;name&gt; latest
                <br />
                since 10m
              </div>
            </div>
          </div>
        </DockWorkspace.Pane>
      </DockWorkspace>
    </div>
  </DemoCard>
);

const paneColors = [
  { id: "red", name: "Red", icon: "ti ti-flame", class: "bg-red-100 dark:bg-red-950/40" },
  { id: "orange", name: "Orange", icon: "ti ti-sun", class: "bg-orange-100 dark:bg-orange-950/40" },
  { id: "yellow", name: "Yellow", icon: "ti ti-bulb", class: "bg-yellow-100 dark:bg-yellow-950/40" },
  { id: "green", name: "Green", icon: "ti ti-leaf", class: "bg-emerald-100 dark:bg-emerald-950/40" },
  { id: "mint", name: "Mint", icon: "ti ti-sparkles", class: "bg-teal-100 dark:bg-teal-950/40" },
  { id: "blue", name: "Blue", icon: "ti ti-droplet", class: "bg-blue-100 dark:bg-blue-950/40" },
  { id: "violet", name: "Violet", icon: "ti ti-moon-stars", class: "bg-violet-100 dark:bg-violet-950/40" },
  { id: "pink", name: "Pink", icon: "ti ti-heart", class: "bg-pink-100 dark:bg-pink-950/40" },
  { id: "slate", name: "Slate", icon: "ti ti-cube", class: "bg-slate-100 dark:bg-slate-900/70" },
  { id: "amber", name: "Amber", icon: "ti ti-bolt", class: "bg-amber-100 dark:bg-amber-950/40" },
] as const;

const resetPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "root",
    direction: "vertical",
    sizes: [58, 42],
    children: [
      {
        type: "split",
        id: "top-row",
        direction: "horizontal",
        sizes: [38, 34, 28],
        children: [
          {
            type: "leaf",
            id: "warm",
            elementIds: ["red", "orange", "yellow"],
            activeElementId: "red",
            presentation: "tabs",
          },
          {
            type: "leaf",
            id: "forest",
            elementIds: ["green", "mint"],
            activeElementId: "green",
            presentation: "tabs",
          },
          {
            type: "leaf",
            id: "blue-leaf",
            elementIds: ["blue"],
            activeElementId: "blue",
            presentation: "single",
          },
        ],
      },
      {
        type: "split",
        id: "bottom-row",
        direction: "horizontal",
        sizes: [52, 48],
        children: [
          {
            type: "leaf",
            id: "violet-leaf",
            elementIds: ["violet", "pink"],
            activeElementId: "violet",
            presentation: "tabs",
          },
          {
            type: "split",
            id: "neutral-stack",
            direction: "vertical",
            sizes: [48, 52],
            children: [
              {
                type: "leaf",
                id: "slate-leaf",
                elementIds: ["slate"],
                activeElementId: "slate",
                presentation: "single",
              },
              {
                type: "leaf",
                id: "amber-leaf",
                elementIds: ["amber"],
                activeElementId: "amber",
                presentation: "single",
              },
            ],
          },
        ],
      },
    ],
  },
});

const ColorPane = (props: { name: string; class: string }) => {
  return (
    <div class={`flex h-full min-h-0 items-center justify-center p-6 ${props.class}`}>
      <div class="rounded-lg bg-white/75 px-4 py-3 text-center shadow-sm backdrop-blur dark:bg-zinc-950/70">
        <p class="text-lg font-semibold text-primary">{props.name}</p>
        <p class="text-xs text-dimmed">switch tabs, resize rails, drag headers, drop on edges</p>
        <p class="mt-2 font-mono text-[10px] text-dimmed">kept mounted while inactive</p>
      </div>
    </div>
  );
};

const editorFiles = [
  {
    id: "invoice.tsx",
    title: "invoice.tsx",
    icon: "ti ti-file-type-tsx",
    badge: "React",
    class: "bg-blue-50 dark:bg-blue-950/30",
    body: ["export const Invoice = () => (", '  <Template.Preview paper="a4" />', ");"],
  },
  {
    id: "template.html",
    title: "template.html",
    icon: "ti ti-file-type-html",
    badge: "HTML",
    class: "bg-orange-50 dark:bg-orange-950/30",
    body: ["<section>", "  <h1>{{ invoice.number }}</h1>", "  {% for item in items %}...{% endfor %}", "</section>"],
  },
  {
    id: "print.css",
    title: "print.css",
    icon: "ti ti-file-type-css",
    badge: "CSS",
    class: "bg-violet-50 dark:bg-violet-950/30",
    body: ["@page { size: A4; margin: 20mm; }", ".invoice-table { page-break-inside: auto; }"],
  },
  {
    id: "sample.json",
    title: "sample.json",
    icon: "ti ti-json",
    badge: "JSON",
    class: "bg-emerald-50 dark:bg-emerald-950/30",
    body: ['{ "customer": "Example AG",', '  "total": "1,240.00 EUR" }'],
  },
] as const;

const activatePaneElement = (node: PanesValue["root"], elementId: string): PanesValue["root"] => {
  if (node.type === "leaf") {
    return node.elementIds.includes(elementId) ? { ...node, activeElementId: elementId } : node;
  }
  return { ...node, children: node.children.map((child) => activatePaneElement(child, elementId)) };
};

export const PanesProgrammaticTabsDemo = () => {
  const initialIds = editorFiles.slice(0, 2).map((file) => file.id);
  const [openFileIds, setOpenFileIds] = createSignal<string[]>(initialIds);
  const [value, setValue] = createSignal<PanesValue>(createPanesValue(initialIds));
  const filesById = new Map<string, (typeof editorFiles)[number]>(editorFiles.map((file) => [file.id, file]));
  const closedFiles = () => editorFiles.filter((file) => !openFileIds().includes(file.id));
  const activeFileId = () => {
    const findActive = (node: PanesValue["root"]): string | undefined => {
      if (node.type === "leaf") return node.activeElementId;
      for (const child of node.children) {
        const active = findActive(child);
        if (active) return active;
      }
      return undefined;
    };
    return findActive(value().root);
  };

  const openFile = (fileId: string) => {
    const nextIds = openFileIds().includes(fileId) ? openFileIds() : [...openFileIds(), fileId];
    setOpenFileIds(nextIds);
    setValue((current) => {
      const normalized = normalizePanesValue(current, nextIds);
      return { root: activatePaneElement(normalized.root, fileId) };
    });
  };

  const closeFile = (fileId: string) => {
    if (openFileIds().length <= 1) return;
    const nextIds = openFileIds().filter((id) => id !== fileId);
    setOpenFileIds(nextIds);
    setValue((current) => normalizePanesValue(current, nextIds));
  };

  return (
    <DemoCard
      id="panes-programmatic-tabs"
      chip={{ kind: "component", name: "Panes", from: FROM_UI }}
      description="Programmatic tabs for editor-style open files. The app owns the open IDs and normalizes the controlled Panes value after opening or closing a file."
      code={`const [openFileIds, setOpenFileIds] = createSignal(["invoice.tsx"]);
const [value, setValue] = createSignal(createPanesValue(openFileIds()));
const filesById = new Map(files.map((file) => [file.id, file]));

const openFile = (id: string) => {
  const nextIds = openFileIds().includes(id) ? openFileIds() : [...openFileIds(), id];
  setOpenFileIds(nextIds);
  setValue((current) => normalizePanesValue(current, nextIds));
};

const closeFile = (id: string) => {
  const nextIds = openFileIds().filter((fileId) => fileId !== id);
  setOpenFileIds(nextIds);
  setValue((current) => normalizePanesValue(current, nextIds));
};

<Panes.Root value={value()} onChange={setValue} class="h-full w-full">
  <For each={openFileIds()}>
    {(id) => {
      const file = filesById.get(id);
      return (
        <Panes.Element
          id={file.id}
          title={file.title}
          icon={file.icon}
          closable={() => openFileIds().length > 1}
          onClose={() => closeFile(file.id)}
        >
          <Editor file={file} />
        </Panes.Element>
      );
    }}
  </For>
</Panes.Root>`}
    >
      <div class="grid min-w-0 gap-3 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div class="paper flex min-w-0 flex-col gap-2 p-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-dimmed">Files</p>
          <For each={editorFiles}>
            {(file) => (
              <button
                type="button"
                class={`flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                  openFileIds().includes(file.id)
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
                onClick={() => openFile(file.id)}
              >
                <i class={`${file.icon} shrink-0 text-base`} />
                <span class="min-w-0 flex-1 truncate">{file.title}</span>
                <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-dimmed dark:bg-zinc-900">{file.badge}</span>
              </button>
            )}
          </For>
          <button
            type="button"
            class="btn-input btn-sm mt-1 justify-center"
            disabled={closedFiles().length === 0}
            onClick={() => openFile(closedFiles()[0]?.id ?? editorFiles[0].id)}
          >
            <i class="ti ti-plus" /> Open next closed file
          </button>
        </div>

        <div class="flex min-w-0 flex-col gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-dimmed">
            <span>{openFileIds().length} open files</span>
            <span class="font-mono">active: {activeFileId() ?? "none"}</span>
          </div>
          <div class="h-80 min-w-0 overflow-hidden rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
            <Panes.Root
              value={value()}
              onChange={setValue}
              class="h-full w-full"
              allowResize
              allowMove
              allowReorder
              allowHorizontalSplit
              allowVerticalSplit
            >
              <For each={openFileIds()}>
                {(id) => {
                  const file = filesById.get(id) ?? editorFiles[0];
                  return (
                    <Panes.Element
                      id={file.id}
                      title={file.title}
                      icon={file.icon}
                      closable={() => openFileIds().length > 1}
                      onClose={() => closeFile(file.id)}
                    >
                      <div class={`flex h-full min-h-0 flex-col ${file.class}`}>
                        <div class="border-b border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                          <div class="min-w-0">
                            <p class="truncate text-sm font-semibold text-primary">{file.title}</p>
                            <p class="text-xs text-dimmed">{file.badge} editor content stays owned by the tab element.</p>
                          </div>
                        </div>
                        <pre class="m-0 min-h-0 flex-1 overflow-auto p-4 text-xs leading-6 text-primary">
                          <code>{file.body.join("\n")}</code>
                        </pre>
                      </div>
                    </Panes.Element>
                  );
                }}
              </For>
            </Panes.Root>
          </div>
        </div>
      </div>
    </DemoCard>
  );
};

export const PanesDemo = () => {
  const [value, setValue] = createSignal<PanesValue>(resetPanesValue());
  const [editable, setEditable] = createSignal(true);

  return (
    <DemoCard
      id="panes"
      chip={{ kind: "component", name: "Panes", from: FROM_UI }}
      description="Controlled split-pane primitive. Resize uses stable gap-2 rails; tabs and single-pane headers can be moved, reordered, or split while edit mode is enabled."
      code={`const [value, setValue] = createSignal<PanesValue>(initialValue);
const [editable, setEditable] = createSignal(true);

<Panes.Root
  value={value()}
  onChange={setValue}
  allowResize={editable}
  allowMove={editable}
  allowReorder={editable}
  allowHorizontalSplit={editable}
  allowVerticalSplit={editable}
>
  <Panes.Element id="red" title="Red" icon="ti ti-flame">…</Panes.Element>
  <Panes.Element id="blue" title="Blue" icon="ti ti-droplet">…</Panes.Element>
</Panes.Root>`}
    >
      <div class="flex min-w-0 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class={editable() ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setEditable((v) => !v)}>
            <i class={editable() ? "ti ti-lock-open" : "ti ti-lock"} /> {editable() ? "Editing on" : "Editing off"}
          </button>
          <button type="button" class="btn-input btn-sm" onClick={() => setValue(resetPanesValue())}>
            <i class="ti ti-restore" /> Reset layout
          </button>
        </div>
        <div class="h-[34rem] w-full max-w-full min-w-0 overflow-hidden rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
          <Panes.Root
            value={value()}
            onChange={setValue}
            class="h-full w-full"
            allowResize={editable}
            allowMove={editable}
            allowReorder={editable}
            allowHorizontalSplit={editable}
            allowVerticalSplit={editable}
          >
            <For each={paneColors}>
              {(color) => (
                <Panes.Element id={color.id} title={color.name} icon={color.icon}>
                  <ColorPane name={color.name} class={color.class} />
                </Panes.Element>
              )}
            </For>
          </Panes.Root>
        </div>
      </div>
    </DemoCard>
  );
};

const overviewRows = [
  { icon: "ti ti-file-text", title: "Launch checklist", meta: "Product", status: "Updated 2m ago" },
  { icon: "ti ti-sparkles", title: "Prompt library", meta: "AI", status: "12 templates" },
  { icon: "ti ti-lock", title: "Security review", meta: "Ops", status: "Needs owner" },
];

const overviewStarters = [
  { icon: "ti ti-list-check", title: "Project notes", description: "Notes, decisions, tasks, and reusable prompts." },
  { icon: "ti ti-users", title: "Team handbook", description: "Shared docs, onboarding pages, and operating notes." },
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
    title="Your notebooks"
    description="3 notebooks available"
    toolbar={<TextInput value={query} onInput={setQuery} placeholder="Search notes" clearable />}
  >
    …
  </AppOverview.Main>
  <AppOverview.Aside title="Create" description="Choose a starter, or start blank.">
    <button class="paper p-4 text-left flex items-start gap-3">Project notes</button>
    <button class="paper p-4 text-left flex items-start gap-3">Blank notebook</button>
  </AppOverview.Aside>
</AppOverview>`}
    >
      <div class="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
        <AppOverview title="Notebooks" subtitle="Shared notes and prompts" icon="ti ti-notebook">
          <AppOverview.Main
            title="Your notebooks"
            description={`${overviewRows.length} notebooks available`}
            toolbar={<TextInput value={query} onInput={setQuery} placeholder="Search notes" clearable icon="ti ti-search" />}
          >
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredRows().map((row) => (
                <div class="paper flex items-center gap-4 p-4">
                  <span class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
                    <i class={`${row.icon} text-lg`} />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-primary">{row.title}</p>
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

          <AppOverview.Aside title="Create" description="Choose a useful starter, or start blank.">
            <div class="grid grid-cols-1 gap-2">
              {overviewStarters.map((starter) => (
                <button type="button" class="paper flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted">
                  <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                    <i class={`${starter.icon} text-lg text-primary`} />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm font-semibold text-primary">{starter.title}</span>
                    <span class="line-clamp-2 block text-xs leading-snug text-dimmed">{starter.description}</span>
                  </span>
                </button>
              ))}
              <button type="button" class="paper flex items-start gap-3 p-4 text-left transition-all hover:paper-highlighted">
                <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-blue-100 dark:bg-blue-900/50">
                  <i class="ti ti-plus text-lg text-blue-600 dark:text-blue-400" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-primary">Blank notebook</span>
                  <span class="block text-xs leading-snug text-dimmed">Create an empty notebook with the standard welcome note.</span>
                </span>
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
      description="Layout-only chrome for complex editors. Use the default contained surface for classic modals and surface='floating' for settings pages where header/footer and sections are the paper surfaces."
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
        <div class="grid gap-2 xl:grid-cols-2">
          <div class="flex h-[26rem] min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            <PanelDialog>
              <PanelDialog.Header title="Edit item" subtitle="Contained modal surface" icon="ti ti-pencil" close={() => {}} />
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
                <button type="button" class="btn-primary btn-sm" onClick={() => openDemo()}>
                  Open modal
                </button>
              </PanelDialog.Footer>
            </PanelDialog>
          </div>

          <div class="h-[26rem] min-w-0">
            <PanelDialog surface="floating">
              <PanelDialog.Header title="Settings" subtitle="Floating surface preview" icon="ti ti-settings" close={() => {}} />
              <PanelDialog.Body>
                <PanelDialog.Section title="Identity" subtitle="Settings fields live directly in the section paper." icon="ti ti-id">
                  <TextInput label="Name" value={() => "Cloud"} onInput={() => {}} icon="ti ti-text-caption" />
                  <TextInput label="Contact email" value={() => "support@example.org"} onInput={() => {}} type="email" />
                </PanelDialog.Section>
                <PanelDialog.Section title="Policy" subtitle="The body has no frame or side padding." icon="ti ti-shield-lock">
                  <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <button type="button" class="btn-input justify-start">
                      <i class="ti ti-lock" />
                      Admin only
                    </button>
                    <button type="button" class="btn-input justify-start">
                      <i class="ti ti-history" />
                      Audit changes
                    </button>
                  </div>
                </PanelDialog.Section>
              </PanelDialog.Body>
              <PanelDialog.Footer>
                <span class="text-xs text-dimmed">No unsaved changes</span>
                <span class="text-xs text-dimmed">Use on settings pages</span>
              </PanelDialog.Footer>
            </PanelDialog>
          </div>
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
