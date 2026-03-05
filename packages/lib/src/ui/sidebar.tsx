import { For, Show, createMemo, type JSX } from "solid-js";

export type SidebarRow = {
  id: string;
  label?: string;
  href?: string;
  icon?: string;
  labelIcon?: string;
  meta?: string;
  active?: boolean;
  class?: string;
  content?: JSX.Element;
  actionIcon?: string;
  actionLabel?: string;
  onActionClick?: (event: MouseEvent) => void;
};

export type SidebarSection = {
  title?: string;
  rows: SidebarRow[];
};

export type SidebarTreeNode = {
  id: string;
  label: string;
  icon?: string;
  labelIcon?: string;
  meta?: string;
  active?: boolean;
  href?: string;
  actionIcon?: string;
  actionLabel?: string;
  onActionClick?: (event: MouseEvent, nodeId: string) => void;
  children?: SidebarTreeNode[];
};

export type SidebarTreeSpec = {
  title?: string;
  nodes: SidebarTreeNode[];
  selectedId?: string;
  expandedIds?: string[];
  onToggle?: (nodeId: string) => void;
  onSelect?: (nodeId: string) => void;
};

export type SidebarSpec = {
  header: {
    title: string;
    subtitle?: string;
    icon?: string | JSX.Element;
    settingsHref?: string;
  };
  actions?: SidebarSection[] | SidebarRow[];
  nav?: SidebarSection[] | SidebarRow[];
  tree?: SidebarTreeSpec;
  controls?: JSX.Element;
  footer?: SidebarSection[] | SidebarRow[];
  mobile?: {
    mode?: "auto" | "hidden";
    defaultOpen?: boolean;
    toggleIcon?: "chevron" | "eye";
    include?: Array<"settings" | "actions" | "nav" | "tree" | "controls" | "footer">;
  };
};

type SidebarLayoutProps = {
  render?: "both" | "mobile" | "desktop";
  mobile?: {
    header: JSX.Element;
    items?: JSX.Element;
    body?: JSX.Element;
    defaultOpen?: boolean;
    bodyClass?: string;
    toggleIcon?: "chevron" | "eye";
  };
  desktop: {
    class?: string;
    header: JSX.Element;
    actions?: JSX.Element;
    body?: JSX.Element;
    footer?: JSX.Element;
  };
};

type SidebarFromSpecProps = {
  spec: SidebarSpec;
  render?: "both" | "mobile" | "desktop";
  desktopClass?: string;
};

const normalizeSections = (sections?: SidebarSection[] | SidebarRow[], title?: string): SidebarSection[] => {
  if (!sections || sections.length === 0) return [];
  if ("rows" in sections[0]!) {
    return sections as SidebarSection[];
  }
  return [{ title, rows: sections as SidebarRow[] }];
};

function SidebarRowItem(props: { row: SidebarRow; mobile?: boolean }) {
  if (props.row.content) return <>{props.row.content}</>;

  const sharedLabel = (
    <>
      <Show when={props.row.icon}>
        <i class={`ti ${props.row.icon} text-sm`} />
      </Show>
      <div class="min-w-0 flex-1 text-left">
        <span class="block truncate">{props.row.label}</span>
        <Show when={props.row.meta}>
          <span class="sidebar-item-meta block truncate">{props.row.meta}</span>
        </Show>
      </div>
      <Show when={props.row.labelIcon}>
        <i class={`ti ${props.row.labelIcon} text-xs text-dimmed`} />
      </Show>
      <Show when={props.row.actionIcon && !props.mobile}>
        <button
          type="button"
          class="sidebar-item-action"
          aria-label={props.row.actionLabel ?? "Row action"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.row.onActionClick?.(event);
          }}
        >
          <i class={`ti ${props.row.actionIcon}`} />
        </button>
      </Show>
    </>
  );

  if (props.mobile) {
    if (props.row.href) {
      return (
        <a
          href={props.row.href}
          class={`btn-input btn-input-sm ${props.row.active ? "bg-blue-50/70 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-400/40" : ""} ${props.row.class ?? ""}`}
          data-row={props.row.id}
        >
          <Show when={props.row.icon}>
            <i class={`ti ${props.row.icon}`} />
          </Show>
          <span>{props.row.label}</span>
        </a>
      );
    }
    return (
      <button
        type="button"
        class={`btn-input btn-input-sm ${props.row.active ? "bg-blue-50/70 text-blue-700 ring-1 ring-inset ring-blue-500/35 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-400/40" : ""} ${props.row.class ?? ""}`}
        data-row={props.row.id}
      >
        <Show when={props.row.icon}>
          <i class={`ti ${props.row.icon}`} />
        </Show>
        <span>{props.row.label}</span>
      </button>
    );
  }

  if (props.row.href) {
    return (
      <a href={props.row.href} class={`sidebar-item ${props.row.active ? "sidebar-item-active" : ""} ${props.row.class ?? ""}`} data-row={props.row.id}>
        {sharedLabel}
      </a>
    );
  }

  return (
    <button
      type="button"
      class={`sidebar-item ${props.row.active ? "sidebar-item-active" : ""} ${props.row.class ?? ""}`}
      data-row={props.row.id}
    >
      {sharedLabel}
    </button>
  );
}

function SidebarTree(props: { tree: SidebarTreeSpec; level?: number }) {
  const level = props.level ?? 0;
  const expanded = createMemo(() => new Set(props.tree.expandedIds ?? []));

  return (
    <div class="sidebar-tree" role={level === 0 ? "tree" : undefined}>
      <For each={props.tree.nodes}>
        {(node) => {
          const hasChildren = () => (node.children?.length ?? 0) > 0;
          const isExpanded = () => expanded().has(node.id);
          const isSelected = () => node.active || props.tree.selectedId === node.id;
          const showLeafIcon = () => !hasChildren() && !!node.icon;

          return (
            <div class="sidebar-tree-item" role="treeitem" aria-level={level + 1} aria-expanded={hasChildren() ? isExpanded() : undefined}>
              <div class={`sidebar-tree-row ${isSelected() ? "sidebar-item-active" : ""}`} style={`--sidebar-level:${level}`}>
                <button
                  type="button"
                  class="sidebar-tree-toggle"
                  onClick={() => {
                    if (!hasChildren()) return;
                    props.tree.onToggle?.(node.id);
                  }}
                  aria-label={hasChildren() ? (isExpanded() ? "Collapse" : "Expand") : undefined}
                >
                  <Show when={hasChildren()} fallback={showLeafIcon() ? <i class={`ti ${node.icon} text-xs`} /> : <span class="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />}>
                    <i class={`ti ${isExpanded() ? "ti-chevron-down" : "ti-chevron-right"} text-[10px]`} />
                  </Show>
                </button>
                <Show when={hasChildren() && node.icon}>
                  <i class={`ti ${node.icon} text-xs text-dimmed`} />
                </Show>
                <Show
                  when={node.href}
                  fallback={
                    <button type="button" class="min-w-0 flex-1 truncate text-left" onClick={() => props.tree.onSelect?.(node.id)}>
                      {node.label}
                    </button>
                  }
                >
                  <a href={node.href!} class="min-w-0 flex-1 truncate">
                    {node.label}
                  </a>
                </Show>
                <Show when={node.labelIcon}>
                  <i class={`ti ${node.labelIcon} text-xs text-dimmed`} />
                </Show>
                <Show when={node.actionIcon}>
                  <button
                    type="button"
                    class="sidebar-item-action"
                    aria-label={node.actionLabel ?? "Row action"}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      node.onActionClick?.(event, node.id);
                    }}
                  >
                    <i class={`ti ${node.actionIcon}`} />
                  </button>
                </Show>
              </div>
              <Show when={hasChildren() && isExpanded()}>
                <div class="sidebar-tree-children">
                  <SidebarTree tree={{ ...props.tree, nodes: node.children ?? [] }} level={level + 1} />
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}

export function SidebarFromSpec(props: SidebarFromSpecProps) {
  const include = createMemo(() => new Set(props.spec.mobile?.include ?? ["settings", "actions", "nav", "tree", "controls", "footer"]));
  const mobileMode = props.spec.mobile?.mode ?? "auto";

  const actionSections = createMemo(() => normalizeSections(props.spec.actions, "Actions"));
  const navSections = createMemo(() => normalizeSections(props.spec.nav, "Navigation"));
  const footerSections = createMemo(() => normalizeSections(props.spec.footer));

  const desktopHeader = (
    <>
      <Show when={typeof props.spec.header.icon === "string"}>
        <div class="w-6 h-6 rounded bg-blue-500 flex items-center justify-center text-white shrink-0">
          <i class={`ti ${(props.spec.header.icon as string) || "ti-layout-sidebar"} text-xs`} />
        </div>
      </Show>
      <Show when={typeof props.spec.header.icon !== "string" && props.spec.header.icon}>{props.spec.header.icon as JSX.Element}</Show>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-primary">{props.spec.header.title}</p>
        <Show when={props.spec.header.subtitle}>
          <p class="text-xs text-dimmed truncate">{props.spec.header.subtitle}</p>
        </Show>
      </div>
      <Show when={props.spec.header.settingsHref}>
        <a href={props.spec.header.settingsHref!} class="p-0.5 text-dimmed hover:text-primary transition-colors shrink-0" title="Settings">
          <i class="ti ti-settings text-xs" />
        </a>
      </Show>
    </>
  );

  const desktopActions = (
    <>
      <For each={actionSections()}>
        {(section) => (
          <section class="sidebar-section">
            <Show when={section.title}>
              <p class="sidebar-section-title">{section.title}</p>
            </Show>
            <div class="flex flex-col gap-1">
              <For each={section.rows}>{(row) => <SidebarRowItem row={row} />}</For>
            </div>
          </section>
        )}
      </For>
      <For each={navSections()}>
        {(section) => (
          <section class="sidebar-section">
            <Show when={section.title}>
              <p class="sidebar-section-title">{section.title}</p>
            </Show>
            <div class="flex flex-col gap-1">
              <For each={section.rows}>{(row) => <SidebarRowItem row={row} />}</For>
            </div>
          </section>
        )}
      </For>
    </>
  );

  const desktopBody = (
    <>
      <Show when={props.spec.tree}>
        <section class="sidebar-section">
          <Show when={props.spec.tree?.title}>
            <p class="sidebar-section-title">{props.spec.tree?.title}</p>
          </Show>
          <SidebarTree tree={props.spec.tree!} />
        </section>
      </Show>
      <Show when={props.spec.controls}>
        <section class="sidebar-section">{props.spec.controls}</section>
      </Show>
    </>
  );

  const desktopFooter = (
    <For each={footerSections()}>
      {(section) => (
        <section class="sidebar-section">
          <Show when={section.title}>
            <p class="sidebar-section-title">{section.title}</p>
          </Show>
          <div class="flex flex-col gap-1">
            <For each={section.rows}>{(row) => <SidebarRowItem row={row} />}</For>
          </div>
        </section>
      )}
    </For>
  );

  const mobileHeader = (
    <>
      <Show when={typeof props.spec.header.icon === "string"}>
        <div class="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center text-white shrink-0">
          <i class={`ti ${(props.spec.header.icon as string) || "ti-layout-sidebar"} text-sm`} />
        </div>
      </Show>
      <Show when={typeof props.spec.header.icon !== "string" && props.spec.header.icon}>{props.spec.header.icon as JSX.Element}</Show>
      <span class="font-semibold truncate flex-1">{props.spec.header.title}</span>
    </>
  );

  const mobileItems = (
    <>
      <Show when={include().has("settings") && props.spec.header.settingsHref}>
        <a href={props.spec.header.settingsHref!} class="btn-input btn-input-sm">
          <i class="ti ti-settings" />
          Settings
        </a>
      </Show>
      <Show when={include().has("actions")}>
        <For each={actionSections()}>
          {(section) => <For each={section.rows}>{(row) => <SidebarRowItem row={row} mobile />}</For>}
        </For>
      </Show>
      <Show when={include().has("nav")}>
        <For each={navSections()}>
          {(section) => <For each={section.rows}>{(row) => <SidebarRowItem row={row} mobile />}</For>}
        </For>
      </Show>
      <Show when={include().has("footer")}>
        <For each={footerSections()}>
          {(section) => <For each={section.rows}>{(row) => <SidebarRowItem row={row} mobile />}</For>}
        </For>
      </Show>
    </>
  );

  const mobileBody = (
    <>
      <Show when={include().has("tree") && props.spec.tree}>
        <section class="sidebar-section">
          <Show when={props.spec.tree?.title}>
            <p class="sidebar-section-title">{props.spec.tree?.title}</p>
          </Show>
          <SidebarTree tree={props.spec.tree!} />
        </section>
      </Show>
      <Show when={include().has("controls") && props.spec.controls}>
        <section class="sidebar-section">{props.spec.controls}</section>
      </Show>
    </>
  );

  return (
    <SidebarLayout
      render={props.render}
      desktop={{
        class: props.desktopClass,
        header: desktopHeader,
        actions: desktopActions,
        body: desktopBody,
        footer: desktopFooter,
      }}
      mobile={
        mobileMode === "hidden"
          ? undefined
          : {
              defaultOpen: props.spec.mobile?.defaultOpen,
              toggleIcon: props.spec.mobile?.toggleIcon,
              header: mobileHeader,
              items: mobileItems,
              body: mobileBody,
            }
      }
    />
  );
}

export function SidebarLayout(props: SidebarLayoutProps) {
  const renderMode = props.render ?? "both";
  const mobileOpenProps = props.mobile?.defaultOpen ? { open: true } : {};

  return (
    <>
      <Show when={(renderMode === "both" || renderMode === "mobile") && props.mobile}>
        <nav class="lg:hidden flex flex-col gap-3">
          <details class="group" {...mobileOpenProps}>
            <summary class="sidebar-header cursor-pointer select-none list-none">
              {props.mobile!.header}
              <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
                <i class={`ti ${props.mobile?.toggleIcon === "eye" ? "ti-eye" : "ti-chevron-down"} text-sm`} />
              </span>
            </summary>
            <Show when={props.mobile?.items}>
              <div class="mt-2 flex flex-wrap gap-2">{props.mobile?.items}</div>
            </Show>
            <Show when={props.mobile?.body}>
              <div class={`mt-2 ${props.mobile?.bodyClass ?? "max-h-64 overflow-y-auto p-2"}`}>{props.mobile?.body}</div>
            </Show>
          </details>
        </nav>
      </Show>

      <Show when={renderMode === "both" || renderMode === "desktop"}>
        <aside class={`hidden lg:flex flex-col min-h-0 overflow-y-auto ${props.desktop.class ?? ""}`}>
          <div class="sidebar-header">{props.desktop.header}</div>
          <Show when={props.desktop.actions}>
            <div class="flex flex-col gap-3">{props.desktop.actions}</div>
          </Show>
          <Show when={props.desktop.body}>
            <div class={`sidebar-body ${props.desktop.actions ? "mt-2" : ""}`}>{props.desktop.body}</div>
          </Show>
          <Show when={props.desktop.footer}>
            <div class="sidebar-footer">{props.desktop.footer}</div>
          </Show>
        </aside>
      </Show>
    </>
  );
}

export default SidebarLayout;
