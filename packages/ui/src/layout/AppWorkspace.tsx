import { Link, type LinkNavigateEvent, type NavigationScrollMode } from "@k2b/ssr/nav";
import { children, createContext, createMemo, createUniqueId, type JSX, Show, useContext } from "solid-js";
import {
  APP_WORKSPACE_DETAIL_DEFAULT,
  APP_WORKSPACE_DETAIL_MAX,
  APP_WORKSPACE_DETAIL_MIN,
  APP_WORKSPACE_DRAWER_DEFAULT,
  APP_WORKSPACE_DRAWER_MAX,
  APP_WORKSPACE_DRAWER_MIN,
  APP_WORKSPACE_PANE_DEFAULT,
  APP_WORKSPACE_PANE_MAX,
  APP_WORKSPACE_PANE_MIN,
  APP_WORKSPACE_SIDEBAR_COLLAPSED,
  APP_WORKSPACE_SIDEBAR_DEFAULT,
  APP_WORKSPACE_SIDEBAR_MAX,
  APP_WORKSPACE_SIDEBAR_MIN,
  appWorkspacePanelVariable,
  resolveAppWorkspaceSidebarWidth,
} from "./app-workspace-state";

const ResizeContext = createContext(true);
type SidebarMode = "desktop" | "mobile";
const SidebarModeContext = createContext<SidebarMode>("desktop");
const MAIN_PANE = Symbol("AppWorkspace.MainPane");
const SIDEBAR_HEADER = Symbol("AppWorkspace.SidebarHeader");
const SIDEBAR_MOBILE = Symbol("AppWorkspace.SidebarMobile");
const SIDEBAR_DESKTOP = Symbol("AppWorkspace.SidebarDesktop");
const SIDEBAR_ITEM_ICON = Symbol("AppWorkspace.SidebarItemIcon");
const SIDEBAR_ITEM_LABEL = Symbol("AppWorkspace.SidebarItemLabel");
const SIDEBAR_ITEM_META = Symbol("AppWorkspace.SidebarItemMeta");
const SIDEBAR_ITEM_ACTION = Symbol("AppWorkspace.SidebarItemAction");

type MainPaneSlot = {
  kind: typeof MAIN_PANE;
  props: AppWorkspaceMainPaneProps;
  domId: string;
};
type SidebarHeaderSlot = AppWorkspaceSidebarHeaderProps & { kind: typeof SIDEBAR_HEADER };
type SidebarChildSlot =
  | SidebarHeaderSlot
  | { kind: typeof SIDEBAR_MOBILE; children: JSX.Element }
  | { kind: typeof SIDEBAR_DESKTOP; children: JSX.Element };
type SidebarItemSlot =
  | (AppWorkspaceSidebarItemIconProps & { kind: typeof SIDEBAR_ITEM_ICON })
  | (AppWorkspaceSidebarItemLabelProps & { kind: typeof SIDEBAR_ITEM_LABEL })
  | (AppWorkspaceSidebarItemMetaProps & { kind: typeof SIDEBAR_ITEM_META })
  | (AppWorkspaceSidebarItemActionProps & { kind: typeof SIDEBAR_ITEM_ACTION });

const flatten = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(flatten);
  return value === null || value === undefined || typeof value === "boolean" ? [] : [value];
};
const mainPaneSlot = (value: unknown): value is MainPaneSlot =>
  Boolean(value && typeof value === "object" && "kind" in value && (value as MainPaneSlot).kind === MAIN_PANE);
const sidebarChildSlot = (value: unknown): value is SidebarChildSlot =>
  Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      [SIDEBAR_HEADER, SIDEBAR_MOBILE, SIDEBAR_DESKTOP].includes((value as SidebarChildSlot).kind),
  );
const sidebarItemSlot = (value: unknown): value is SidebarItemSlot =>
  Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      [SIDEBAR_ITEM_ICON, SIDEBAR_ITEM_LABEL, SIDEBAR_ITEM_META, SIDEBAR_ITEM_ACTION].includes(
        (value as SidebarItemSlot).kind,
      ),
  );

type ResizeHandleProps = {
  kind: "sidebar" | "pane" | "detail" | "drawer";
  edge: "start" | "end" | "top";
  target: () => HTMLElement | undefined;
  variable: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  collapsible?: boolean;
  shadow?: boolean;
};

function ResizeHandle(props: ResizeHandleProps): JSX.Element {
  const resize = (event: PointerEvent) => {
    const target = props.target();
    const workspace = target?.closest<HTMLElement>("[data-k2b-app-workspace]");
    if (!target || !workspace || event.button !== 0) return;
    event.preventDefault();
    const bounds = target.getBoundingClientRect();
    const origin = props.kind === "drawer" ? bounds.height : bounds.width;
    const start = props.kind === "drawer" ? event.clientY : event.clientX;
    const direction = props.edge === "start" || props.edge === "top" ? -1 : 1;
    const move = (next: PointerEvent) => {
      const position = props.kind === "drawer" ? next.clientY : next.clientX;
      const requested = origin + (position - start) * direction;
      if (props.kind === "sidebar") {
        const resolved = resolveAppWorkspaceSidebarWidth(requested, props.maxSize, Boolean(props.collapsible));
        workspace.style.setProperty(props.variable, `${resolved.width}px`);
        workspace.dataset.sidebarCollapsed = resolved.collapsed ? "true" : "false";
      } else {
        workspace.style.setProperty(props.variable, `${Math.round(Math.max(props.minSize, Math.min(props.maxSize, requested)))}px`);
      }
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    document.body.style.setProperty("cursor", props.kind === "drawer" ? "row-resize" : "col-resize");
    document.body.style.setProperty("user-select", "none");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const keyboard = (event: KeyboardEvent) => {
    const target = props.target();
    const workspace = target?.closest<HTMLElement>("[data-k2b-app-workspace]");
    if (!target || !workspace || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = props.kind === "drawer" ? target.getBoundingClientRect().height : target.getBoundingClientRect().width;
    const delta = event.shiftKey ? 32 : 8;
    const horizontalDirection = props.edge === "start" ? -1 : 1;
    const next =
      event.key === "Home"
        ? props.minSize
        : event.key === "End"
          ? props.maxSize
          : props.kind === "drawer"
            ? current + (event.key === "ArrowUp" ? delta : event.key === "ArrowDown" ? -delta : 0)
            : current + (event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0) * horizontalDirection;
    workspace.style.setProperty(props.variable, `${Math.round(Math.max(props.minSize, Math.min(props.maxSize, next)))}px`);
  };
  return (
    <div
      class="k2b-app-workspace__resize"
      data-kind={props.kind}
      data-edge={props.edge}
      data-shadow={props.shadow ? "true" : undefined}
      role="separator"
      tabIndex={0}
      aria-orientation={props.kind === "drawer" ? "horizontal" : "vertical"}
      aria-label={`Resize ${props.kind}`}
      onPointerDown={resize}
      onKeyDown={keyboard}
    />
  );
}

export type AppWorkspaceProps = { children: JSX.Element; class?: string; resizable?: boolean };
export type AppWorkspaceContentProps = { children: JSX.Element; class?: string };
export type AppWorkspaceMainProps = {
  children: JSX.Element;
  class?: string;
  mobilePane?: string;
  "aria-busy"?: boolean | "true" | "false";
};
export type AppWorkspaceMainPaneProps = {
  id: string;
  label: string;
  open?: boolean;
  resizable?: boolean;
  resizeShadow?: boolean;
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  class?: string;
  children: JSX.Element;
};
export type AppWorkspaceDetailWidth = "sm" | "md" | "lg" | "xl";
export type AppWorkspaceDetailProps = {
  children: JSX.Element;
  open: boolean;
  id?: string;
  class?: string;
  width?: AppWorkspaceDetailWidth;
  widthClass?: string;
  viewTransitionName?: string;
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
};
export type AppWorkspaceBottomDrawerHeight = "sm" | "md" | "lg";
export type AppWorkspaceBottomDrawerProps = {
  children: JSX.Element;
  open: boolean;
  id?: string;
  class?: string;
  height?: AppWorkspaceBottomDrawerHeight;
  minHeight?: number;
  maxHeight?: number;
  viewTransitionName?: string;
  resizable?: boolean;
};
export type AppWorkspaceSidebarProps = {
  children: JSX.Element;
  class?: string;
  resizable?: boolean;
  resizeShadow?: boolean;
  collapsible?: boolean;
};
export type AppWorkspaceSidebarHeaderProps = {
  title: string;
  subtitle?: string;
  icon?: string | false;
  iconStyle?: string;
  iconViewTransitionName?: string;
  titleViewTransitionName?: string;
  action?: JSX.Element;
  showDesktop?: boolean;
};
export type AppWorkspaceSidebarVisibility = "always" | "expanded" | "collapsed";
export type AppWorkspaceSidebarBodyProps = {
  children: JSX.Element;
  class?: string;
  scrollPreserveKey?: string | false;
  sidebarMode?: AppWorkspaceSidebarVisibility;
};
export type AppWorkspaceSidebarSectionProps = AppWorkspaceSidebarBodyProps & { title?: string };
export type AppWorkspaceSidebarItemTone = "default" | "success" | "danger";
export type AppWorkspaceSidebarItemProps = {
  children: JSX.Element;
  href?: string;
  navigation?: "enhanced" | "document";
  replace?: boolean;
  scroll?: NavigationScrollMode;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
  onClick?: (event: MouseEvent) => void;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
  icon?: string;
  meta?: JSX.Element;
  tone?: AppWorkspaceSidebarItemTone;
  title?: string;
  viewTransitionName?: string;
  class?: string;
  actionIcon?: string;
  actionLabel?: string;
  onActionClick?: (event: MouseEvent) => void;
  data?: Record<string, string | number | boolean | null | undefined>;
  sidebarMode?: AppWorkspaceSidebarVisibility;
};
export type AppWorkspaceSidebarIconGridProps = AppWorkspaceSidebarBodyProps & { title?: string; columns?: 2 | 3 };
export type AppWorkspaceSidebarIconActionProps = {
  href?: string | null;
  navigation?: "enhanced" | "document";
  replace?: boolean;
  scroll?: NavigationScrollMode;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  tone?: AppWorkspaceSidebarItemTone;
  viewTransitionName?: string;
  onClick?: (event: MouseEvent) => void;
  sidebarMode?: AppWorkspaceSidebarVisibility;
};
export type AppWorkspaceSidebarItemIconProps = { icon?: string; children?: JSX.Element };
export type AppWorkspaceSidebarItemLabelProps = { children: JSX.Element; marquee?: boolean };
export type AppWorkspaceSidebarItemMetaProps = { children: JSX.Element };
export type AppWorkspaceSidebarItemActionProps = {
  icon?: string;
  label: string;
  href?: string;
  navigation?: "enhanced" | "document";
  onSelect?: (event: MouseEvent) => void;
  children?: JSX.Element;
};

const modeAttrs = (mode?: AppWorkspaceSidebarVisibility) =>
  mode && mode !== "always" ? { "data-sidebar-mode": mode } : {};
const scrollAttrs = (key?: string | false) => (key ? { "data-scroll-preserve": key } : {});
const iconClass = (icon: string | undefined, fallback = "ti-circle") =>
  icon?.startsWith("ti ") ? icon : `ti ${icon || fallback}`;

function AppWorkspaceMainPane(props: AppWorkspaceMainPaneProps): JSX.Element {
  return {
    kind: MAIN_PANE,
    props,
    domId: `k2b-workspace-pane-${createUniqueId()}`,
  } satisfies MainPaneSlot as unknown as JSX.Element;
}

function AppWorkspaceMain(props: AppWorkspaceMainProps): JSX.Element {
  const rootResizable = useContext(ResizeContext);
  const resolved = children(() => props.children);
  const values = createMemo(() => flatten(resolved()));
  const regions = createMemo(() => {
    const all = values();
    const primary = all.filter((value) => !mainPaneSlot(value));
    const primaryIndex = all.findIndex((value) => !mainPaneSlot(value));
    let inserted = false;
    const result: Array<
      | { type: "primary"; index: number; children: unknown[] }
      | { type: "pane"; index: number; slot: MainPaneSlot }
    > = [];
    all.forEach((value, index) => {
      if (mainPaneSlot(value)) {
        if (value.props.open !== false) result.push({ type: "pane", index, slot: value });
      } else if (!inserted) {
        inserted = true;
        result.push({ type: "primary", index: primaryIndex, children: primary });
      }
    });
    return result;
  });
  const hasPanes = () => regions().some((region) => region.type === "pane");

  return (
    <main
      class={`k2b-app-workspace__main ${hasPanes() ? "has-panes" : ""} ${props.class ?? ""}`}
      data-mobile-pane={props.mobilePane}
      aria-busy={props["aria-busy"]}
    >
      <Show when={hasPanes()} fallback={resolved() as JSX.Element}>
        {regions().flatMap((region) => {
          const anchor = regions().find((candidate) => candidate.type === "primary") ?? regions()[0];
          if (region.type === "primary") {
            return (
              <div
                class="k2b-app-workspace__main-primary"
                data-workspace-main-region="main"
                data-mobile-active={(props.mobilePane ?? "main") === "main" ? "true" : undefined}
              >
                {region.children as JSX.Element}
              </div>
            );
          }
          const pane = region.slot;
          const variable = appWorkspacePanelVariable("pane", pane.props.id);
          let element: HTMLElement | undefined;
          const isAnchor = region === anchor;
          const resizable = !isAnchor && (pane.props.resizable ?? rootResizable);
          const content = (
            <section
              ref={element}
              id={pane.domId}
              class={`k2b-app-workspace__main-pane ${isAnchor ? "is-primary" : ""} ${pane.props.class ?? ""}`}
              aria-label={pane.props.label}
              data-workspace-main-region={pane.props.id}
              data-mobile-active={(props.mobilePane ?? (anchor?.type === "pane" ? anchor.slot.props.id : "main")) === pane.props.id ? "true" : undefined}
              style={
                isAnchor
                  ? undefined
                  : { "--k2b-workspace-panel-size": `var(${variable}, ${pane.props.defaultSize ?? APP_WORKSPACE_PANE_DEFAULT}px)` }
              }
            >
              {pane.props.children}
            </section>
          );
          if (!resizable) return content;
          const before = region.index < (anchor?.index ?? 0);
          const handle = (
            <ResizeHandle
              kind="pane"
              edge={before ? "end" : "start"}
              target={() => element}
              variable={variable}
              defaultSize={pane.props.defaultSize ?? APP_WORKSPACE_PANE_DEFAULT}
              minSize={pane.props.minSize ?? APP_WORKSPACE_PANE_MIN}
              maxSize={pane.props.maxSize ?? APP_WORKSPACE_PANE_MAX}
              shadow={pane.props.resizeShadow !== false}
            />
          );
          return before ? [content, handle] : [handle, content];
        })}
      </Show>
    </main>
  );
}

function AppWorkspaceDetail(props: AppWorkspaceDetailProps): JSX.Element {
  let detail: HTMLElement | undefined;
  const rootResizable = useContext(ResizeContext);
  const id = () => props.id ?? "primary";
  const variable = () => appWorkspacePanelVariable("detail", id());
  const widths = { sm: 288, md: 384, lg: 512, xl: 640 };
  return (
    <Show when={props.open}>
      <Show when={props.resizable ?? rootResizable}>
        <ResizeHandle
          kind="detail"
          edge="start"
          target={() => detail}
          variable={variable()}
          defaultSize={widths[props.width ?? "md"]}
          minSize={props.minWidth ?? APP_WORKSPACE_DETAIL_MIN}
          maxSize={props.maxWidth ?? APP_WORKSPACE_DETAIL_MAX}
        />
      </Show>
      <aside
        ref={detail}
        class={`k2b-app-workspace__detail ${props.widthClass ?? ""} ${props.class ?? ""}`}
        data-width={props.width ?? "md"}
        style={{
          "--k2b-workspace-panel-size": `var(${variable()}, ${widths[props.width ?? "md"] ?? APP_WORKSPACE_DETAIL_DEFAULT}px)`,
          "view-transition-name": props.viewTransitionName,
        }}
      >
        {props.children}
      </aside>
    </Show>
  );
}

function AppWorkspaceBottomDrawer(props: AppWorkspaceBottomDrawerProps): JSX.Element {
  let drawer: HTMLElement | undefined;
  const rootResizable = useContext(ResizeContext);
  const id = () => props.id ?? "primary";
  const variable = () => appWorkspacePanelVariable("drawer", id());
  const heights = { sm: 160, md: 240, lg: 400 };
  return (
    <Show when={props.open}>
      <Show when={props.resizable ?? rootResizable}>
        <ResizeHandle
          kind="drawer"
          edge="top"
          target={() => drawer}
          variable={variable()}
          defaultSize={heights[props.height ?? "md"]}
          minSize={props.minHeight ?? APP_WORKSPACE_DRAWER_MIN}
          maxSize={props.maxHeight ?? APP_WORKSPACE_DRAWER_MAX}
        />
      </Show>
      <aside
        ref={drawer}
        class={`k2b-app-workspace__drawer ${props.class ?? ""}`}
        data-height={props.height ?? "md"}
        style={{
          "--k2b-workspace-panel-size": `var(${variable()}, ${heights[props.height ?? "md"] ?? APP_WORKSPACE_DRAWER_DEFAULT}px)`,
          "view-transition-name": props.viewTransitionName,
        }}
      >
        {props.children}
      </aside>
    </Show>
  );
}

const AppWorkspaceSidebarHeader = (props: AppWorkspaceSidebarHeaderProps): JSX.Element =>
  ({ kind: SIDEBAR_HEADER, ...props }) satisfies SidebarHeaderSlot as unknown as JSX.Element;

const SidebarHeaderContent = (props: { header: SidebarHeaderSlot; mobile?: boolean }) => (
  <header class="k2b-app-workspace__sidebar-header" data-show-desktop={props.header.showDesktop === false ? "false" : undefined}>
    <Show when={props.header.icon !== false}>
      <span
        class="k2b-app-workspace__sidebar-header-icon"
        style={`${props.header.iconStyle ?? ""}${props.header.iconViewTransitionName ? `;view-transition-name:${props.header.iconViewTransitionName}` : ""}`}
        aria-hidden="true"
      >
        <i class={iconClass(props.header.icon || undefined, "ti-layout-sidebar-left")} />
      </span>
    </Show>
    <span class="k2b-app-workspace__sidebar-heading">
      <strong style={{ "view-transition-name": props.header.titleViewTransitionName }}>{props.header.title}</strong>
      <Show when={!props.mobile && props.header.subtitle}>{(subtitle) => <small>{subtitle()}</small>}</Show>
    </span>
    <Show when={!props.mobile && props.header.action}><span class="k2b-app-workspace__sidebar-action">{props.header.action}</span></Show>
  </header>
);

function AppWorkspaceSidebar(props: AppWorkspaceSidebarProps): JSX.Element {
  let sidebar: HTMLElement | undefined;
  const rootResizable = useContext(ResizeContext);
  const resizable = () => props.resizable ?? rootResizable;
  const resolved = children(() => props.children);
  const slots = createMemo(() => flatten(resolved()).filter(sidebarChildSlot));
  const header = () => slots().find((slot): slot is SidebarHeaderSlot => slot.kind === SIDEBAR_HEADER);
  const mobile = () => slots().find((slot) => slot.kind === SIDEBAR_MOBILE);
  const desktop = () => slots().find((slot) => slot.kind === SIDEBAR_DESKTOP);
  return (
    <>
      <aside
        ref={sidebar}
        class={`k2b-app-workspace__sidebar ${props.class ?? ""}`}
        data-collapsible={props.collapsible ? "true" : undefined}
      >
        <Show when={header() && mobile()}>
          <nav class="k2b-app-workspace__sidebar-mobile">
            <details>
              <summary>
                <SidebarHeaderContent header={header()!} mobile />
                <i class="ti ti-chevron-down" aria-hidden="true" />
              </summary>
              <SidebarModeContext.Provider value="mobile">{mobile()!.children}</SidebarModeContext.Provider>
            </details>
          </nav>
        </Show>
        <div class="k2b-app-workspace__sidebar-desktop">
          <Show when={header() && header()!.showDesktop !== false}>
            <SidebarHeaderContent header={header()!} />
          </Show>
          <SidebarModeContext.Provider value="desktop">{desktop()?.children}</SidebarModeContext.Provider>
        </div>
      </aside>
      <Show when={resizable()}>
        <ResizeHandle
          kind="sidebar"
          edge="end"
          target={() => sidebar}
          variable="--k2b-workspace-sidebar-width"
          defaultSize={APP_WORKSPACE_SIDEBAR_DEFAULT}
          minSize={props.collapsible ? APP_WORKSPACE_SIDEBAR_COLLAPSED : APP_WORKSPACE_SIDEBAR_MIN}
          maxSize={APP_WORKSPACE_SIDEBAR_MAX}
          collapsible={props.collapsible}
          shadow={props.resizeShadow !== false}
        />
      </Show>
    </>
  );
}

const AppWorkspaceSidebarMobile = (props: { children: JSX.Element }): JSX.Element =>
  ({ kind: SIDEBAR_MOBILE, children: props.children }) as unknown as JSX.Element;
const AppWorkspaceSidebarDesktop = (props: { children: JSX.Element }): JSX.Element =>
  ({ kind: SIDEBAR_DESKTOP, children: props.children }) as unknown as JSX.Element;
const AppWorkspaceSidebarMobileItems = (props: { children: JSX.Element; scrollPreserveKey?: string | false }) => (
  <div class="k2b-app-workspace__sidebar-mobile-items" {...scrollAttrs(props.scrollPreserveKey)}>{props.children}</div>
);
const AppWorkspaceSidebarBody = (props: AppWorkspaceSidebarBodyProps) => (
  <div class={`k2b-app-workspace__sidebar-body ${props.class ?? ""}`} {...scrollAttrs(props.scrollPreserveKey)} {...modeAttrs(props.sidebarMode)}>
    {props.children}
  </div>
);
const AppWorkspaceSidebarMobileBody = (props: AppWorkspaceSidebarBodyProps) => (
  <div class={`k2b-app-workspace__sidebar-mobile-body ${props.class ?? ""}`} {...scrollAttrs(props.scrollPreserveKey)} {...modeAttrs(props.sidebarMode)}>
    {props.children}
  </div>
);
const AppWorkspaceSidebarFooter = (props: AppWorkspaceSidebarBodyProps) => (
  <footer class={`k2b-app-workspace__sidebar-footer ${props.class ?? ""}`} {...modeAttrs(props.sidebarMode)}>{props.children}</footer>
);
const AppWorkspaceSidebarSection = (props: AppWorkspaceSidebarSectionProps) => (
  <section class={`k2b-app-workspace__sidebar-section ${props.class ?? ""}`} {...modeAttrs(props.sidebarMode)}>
    <Show when={props.title}>{(title) => <h2>{title()}</h2>}</Show>
    {props.children}
  </section>
);

const AppWorkspaceSidebarItemIcon = (props: AppWorkspaceSidebarItemIconProps): JSX.Element =>
  ({ kind: SIDEBAR_ITEM_ICON, ...props }) as unknown as JSX.Element;
const AppWorkspaceSidebarItemLabel = (props: AppWorkspaceSidebarItemLabelProps): JSX.Element =>
  ({ kind: SIDEBAR_ITEM_LABEL, ...props }) as unknown as JSX.Element;
const AppWorkspaceSidebarItemMeta = (props: AppWorkspaceSidebarItemMetaProps): JSX.Element =>
  ({ kind: SIDEBAR_ITEM_META, ...props }) as unknown as JSX.Element;
const AppWorkspaceSidebarItemAction = (props: AppWorkspaceSidebarItemActionProps): JSX.Element =>
  ({ kind: SIDEBAR_ITEM_ACTION, ...props }) as unknown as JSX.Element;

function AppWorkspaceSidebarItem(props: AppWorkspaceSidebarItemProps): JSX.Element {
  const mode = useContext(SidebarModeContext);
  const resolved = children(() => props.children);
  const values = createMemo(() => flatten(resolved()));
  const slots = createMemo(() => values().filter(sidebarItemSlot));
  const iconSlot = () => slots().find((slot) => slot.kind === SIDEBAR_ITEM_ICON) as
    | (AppWorkspaceSidebarItemIconProps & { kind: typeof SIDEBAR_ITEM_ICON })
    | undefined;
  const labelSlot = () => slots().find((slot) => slot.kind === SIDEBAR_ITEM_LABEL) as
    | (AppWorkspaceSidebarItemLabelProps & { kind: typeof SIDEBAR_ITEM_LABEL })
    | undefined;
  const metaSlot = () => slots().find((slot) => slot.kind === SIDEBAR_ITEM_META) as
    | (AppWorkspaceSidebarItemMetaProps & { kind: typeof SIDEBAR_ITEM_META })
    | undefined;
  const actionSlot = () => slots().find((slot) => slot.kind === SIDEBAR_ITEM_ACTION) as
    | (AppWorkspaceSidebarItemActionProps & { kind: typeof SIDEBAR_ITEM_ACTION })
    | undefined;
  const legacy = () => values().filter((value) => !sidebarItemSlot(value));
  const label = () => labelSlot()?.children ?? (legacy().length === 1 ? legacy()[0] : legacy());
  const icon = () => iconSlot()?.icon ?? props.icon;
  const iconContent = () => iconSlot()?.children;
  const meta = () => metaSlot()?.children ?? props.meta;
  const hasAction = () => Boolean(actionSlot() || props.actionIcon);
  const className = () =>
    `k2b-app-workspace__sidebar-item ${hasAction() ? "has-action" : ""} ${props.active ? (props.activeClass ?? "is-active") : ""} ${props.class ?? ""}`;
  const data = () =>
    Object.fromEntries(
      Object.entries({ ...props.data, ...(props.sidebarMode ? { "sidebar-mode": props.sidebarMode } : {}) })
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [`data-${key}`, String(value)]),
    );
  const mainContent = (
    <>
      <Show when={iconContent() || icon()}>
        <span class="k2b-app-workspace__sidebar-item-icon" aria-hidden="true">
          {iconContent() ?? <i class={iconClass(icon())} />}
        </span>
      </Show>
      <span class="k2b-app-workspace__sidebar-item-label" data-marquee={labelSlot()?.marquee === false ? undefined : "true"}>
        {label() as JSX.Element}
      </span>
      <Show when={meta()}>{(value) => <span class="k2b-app-workspace__sidebar-item-meta">{value()}</span>}</Show>
    </>
  );
  const action = () => {
    const slot = actionSlot();
    if (!hasAction()) return null;
    const content = slot?.children ?? <i class={iconClass(slot?.icon ?? props.actionIcon, "ti-dots")} />;
    const label = slot?.label ?? props.actionLabel ?? "Row action";
    const select = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      slot?.onSelect?.(event);
      props.onActionClick?.(event);
    };
    return slot?.href ? (
      <a href={slot.href} class="k2b-app-workspace__sidebar-item-action" aria-label={label} onClick={select}>
        {content}
      </a>
    ) : (
      <button type="button" class="k2b-app-workspace__sidebar-item-action" aria-label={label} onClick={select}>
        {content}
      </button>
    );
  };
  const common = {
    class: className(),
    title: props.title,
    "aria-current": props.active ? ("page" as const) : undefined,
    "data-tone": props.tone,
    "data-mode": mode,
    style: { "view-transition-name": props.viewTransitionName },
    ...data(),
  };
  if (hasAction()) {
    if (!props.href || props.disabled) {
      return (
        <div {...common}>
          <button type="button" class="k2b-app-workspace__sidebar-item-main" disabled={props.disabled} onClick={props.onClick}>
            {mainContent}
          </button>
          {action()}
        </div>
      );
    }
    if (props.navigation === "document") {
      return (
        <div {...common}>
          <a href={props.href} class="k2b-app-workspace__sidebar-item-main" onClick={props.onClick}>{mainContent}</a>
          {action()}
        </div>
      );
    }
    return (
      <div {...common}>
        <Link
          href={props.href}
          class="k2b-app-workspace__sidebar-item-main"
          replace={props.replace}
          scroll={props.scroll}
          onNavigate={props.onNavigate}
          onClick={props.onClick}
        >
          {mainContent}
        </Link>
        {action()}
      </div>
    );
  }
  if (!props.href || props.disabled) {
    return <button type="button" {...common} disabled={props.disabled} onClick={props.onClick}>{mainContent}</button>;
  }
  if (props.navigation === "document") {
    return <a href={props.href} {...common} onClick={props.onClick}>{mainContent}</a>;
  }
  return (
    <Link
      href={props.href}
      {...common}
      replace={props.replace}
      scroll={props.scroll}
      onNavigate={props.onNavigate}
      onClick={props.onClick}
    >
      {mainContent}
    </Link>
  );
}

const AppWorkspaceSidebarIconGrid = (props: AppWorkspaceSidebarIconGridProps) => (
  <section class={`k2b-app-workspace__sidebar-icon-grid-wrap ${props.class ?? ""}`} {...modeAttrs(props.sidebarMode)}>
    <Show when={props.title}>{(title) => <h2>{title()}</h2>}</Show>
    <div class="k2b-app-workspace__sidebar-icon-grid" data-columns={props.columns ?? 2}>{props.children}</div>
  </section>
);

const AppWorkspaceSidebarIconAction = (props: AppWorkspaceSidebarIconActionProps) => {
  const content = <i class={iconClass(props.icon)} aria-hidden="true" />;
  const className = `k2b-app-workspace__sidebar-icon-action ${props.active ? "is-active" : ""}`;
  const attrs = { class: className, title: props.label, "aria-label": props.label, "data-tone": props.tone, ...modeAttrs(props.sidebarMode) };
  if (!props.href || props.disabled) return <button type="button" {...attrs} disabled={props.disabled} onClick={props.onClick}>{content}</button>;
  if (props.navigation === "document") return <a href={props.href} {...attrs} onClick={props.onClick}>{content}</a>;
  return <Link href={props.href} {...attrs} replace={props.replace} scroll={props.scroll} onNavigate={props.onNavigate} onClick={props.onClick}>{content}</Link>;
};

type AppWorkspaceComponent = ((props: AppWorkspaceProps) => JSX.Element) & {
  Content: (props: AppWorkspaceContentProps) => JSX.Element;
  Main: (props: AppWorkspaceMainProps) => JSX.Element;
  MainPane: (props: AppWorkspaceMainPaneProps) => JSX.Element;
  Detail: (props: AppWorkspaceDetailProps) => JSX.Element;
  BottomDrawer: (props: AppWorkspaceBottomDrawerProps) => JSX.Element;
  Sidebar: (props: AppWorkspaceSidebarProps) => JSX.Element;
  SidebarHeader: (props: AppWorkspaceSidebarHeaderProps) => JSX.Element;
  SidebarMobile: (props: { children: JSX.Element }) => JSX.Element;
  SidebarMobileItems: (props: { children: JSX.Element; scrollPreserveKey?: string | false }) => JSX.Element;
  SidebarMobileBody: (props: AppWorkspaceSidebarBodyProps) => JSX.Element;
  SidebarDesktop: (props: { children: JSX.Element }) => JSX.Element;
  SidebarSection: (props: AppWorkspaceSidebarSectionProps) => JSX.Element;
  SidebarBody: (props: AppWorkspaceSidebarBodyProps) => JSX.Element;
  SidebarFooter: (props: AppWorkspaceSidebarBodyProps) => JSX.Element;
  SidebarItem: (props: AppWorkspaceSidebarItemProps) => JSX.Element;
  SidebarItemIcon: (props: AppWorkspaceSidebarItemIconProps) => JSX.Element;
  SidebarItemLabel: (props: AppWorkspaceSidebarItemLabelProps) => JSX.Element;
  SidebarItemMeta: (props: AppWorkspaceSidebarItemMetaProps) => JSX.Element;
  SidebarItemAction: (props: AppWorkspaceSidebarItemActionProps) => JSX.Element;
  SidebarIconGrid: (props: AppWorkspaceSidebarIconGridProps) => JSX.Element;
  SidebarIconAction: (props: AppWorkspaceSidebarIconActionProps) => JSX.Element;
};

const AppWorkspace = ((props: AppWorkspaceProps) => (
  <ResizeContext.Provider value={props.resizable !== false}>
    <div
      class={`k2b-app-workspace ${props.class ?? ""}`}
      data-k2b-app-workspace
      data-workspace-resizable={props.resizable === false ? "false" : "true"}
    >
      {props.children}
    </div>
  </ResizeContext.Provider>
)) as AppWorkspaceComponent;

AppWorkspace.Content = (props) => <div class={`k2b-app-workspace__content ${props.class ?? ""}`}>{props.children}</div>;
AppWorkspace.Main = AppWorkspaceMain;
AppWorkspace.MainPane = AppWorkspaceMainPane;
AppWorkspace.Detail = AppWorkspaceDetail;
AppWorkspace.BottomDrawer = AppWorkspaceBottomDrawer;
AppWorkspace.Sidebar = AppWorkspaceSidebar;
AppWorkspace.SidebarHeader = AppWorkspaceSidebarHeader;
AppWorkspace.SidebarMobile = AppWorkspaceSidebarMobile;
AppWorkspace.SidebarMobileItems = AppWorkspaceSidebarMobileItems;
AppWorkspace.SidebarMobileBody = AppWorkspaceSidebarMobileBody;
AppWorkspace.SidebarDesktop = AppWorkspaceSidebarDesktop;
AppWorkspace.SidebarSection = AppWorkspaceSidebarSection;
AppWorkspace.SidebarBody = AppWorkspaceSidebarBody;
AppWorkspace.SidebarFooter = AppWorkspaceSidebarFooter;
AppWorkspace.SidebarItem = AppWorkspaceSidebarItem;
AppWorkspace.SidebarItemIcon = AppWorkspaceSidebarItemIcon;
AppWorkspace.SidebarItemLabel = AppWorkspaceSidebarItemLabel;
AppWorkspace.SidebarItemMeta = AppWorkspaceSidebarItemMeta;
AppWorkspace.SidebarItemAction = AppWorkspaceSidebarItemAction;
AppWorkspace.SidebarIconGrid = AppWorkspaceSidebarIconGrid;
AppWorkspace.SidebarIconAction = AppWorkspaceSidebarIconAction;

export default AppWorkspace;
