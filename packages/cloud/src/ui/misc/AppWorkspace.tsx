import {
  captureScroll,
  documentNavigate,
  type LinkNavigateEvent,
  type LinkProps,
  type NavigationScrollMode,
  navigate,
  restoreScroll,
  startViewTransition,
} from "@valentinkolb/ssr/nav";
import { children, createContext, createMemo, type JSX, Show, useContext } from "solid-js";

const SIDEBAR_HEADER = Symbol("AppWorkspace.SidebarHeader");
const SIDEBAR_MOBILE = Symbol("AppWorkspace.SidebarMobile");
const SIDEBAR_DESKTOP = Symbol("AppWorkspace.SidebarDesktop");
const SIDEBAR_ITEM_ICON = Symbol("AppWorkspace.SidebarItemIcon");
const SIDEBAR_ITEM_LABEL = Symbol("AppWorkspace.SidebarItemLabel");
const SIDEBAR_ITEM_META = Symbol("AppWorkspace.SidebarItemMeta");
const SIDEBAR_ITEM_ACTION = Symbol("AppWorkspace.SidebarItemAction");

type SidebarSlotKind = typeof SIDEBAR_HEADER | typeof SIDEBAR_MOBILE | typeof SIDEBAR_DESKTOP;

type SidebarSlot = {
  readonly kind: SidebarSlotKind;
  children?: JSX.Element;
};

type SidebarHeaderSlot = SidebarSlot & {
  readonly kind: typeof SIDEBAR_HEADER;
  title: string;
  subtitle?: string;
  icon?: string | false;
  iconStyle?: string;
  iconViewTransitionName?: string;
  titleViewTransitionName?: string;
  action?: JSX.Element;
  showDesktop?: boolean;
};

type SidebarMobileSlot = SidebarSlot & {
  readonly kind: typeof SIDEBAR_MOBILE;
};

type SidebarDesktopSlot = SidebarSlot & {
  readonly kind: typeof SIDEBAR_DESKTOP;
};

type SidebarItemIconSlot = {
  readonly kind: typeof SIDEBAR_ITEM_ICON;
  icon?: string;
  children?: JSX.Element;
};

type SidebarItemLabelSlot = {
  readonly kind: typeof SIDEBAR_ITEM_LABEL;
  children: JSX.Element;
  marquee?: boolean;
};

type SidebarItemMetaSlot = {
  readonly kind: typeof SIDEBAR_ITEM_META;
  children: JSX.Element;
};

type SidebarItemActionSlot = {
  readonly kind: typeof SIDEBAR_ITEM_ACTION;
  icon?: string;
  label: string;
  href?: string;
  navigation?: "enhanced" | "document";
  onSelect?: (event: MouseEvent) => void;
  children?: JSX.Element;
};

type SidebarItemSlot = SidebarItemIconSlot | SidebarItemLabelSlot | SidebarItemMetaSlot | SidebarItemActionSlot;

type SidebarMode = "desktop" | "mobile";

const SidebarModeContext = createContext<SidebarMode>("desktop");
const AppWorkspaceResizeContext = createContext(true);

export type AppWorkspaceProps = {
  class?: string;
  resizable?: boolean;
  children: JSX.Element;
};

export type AppWorkspaceMainProps = {
  class?: string;
  children: JSX.Element;
};

export type AppWorkspaceDetailWidth = "sm" | "md" | "lg" | "xl";

export type AppWorkspaceDetailProps = {
  id?: string;
  open: boolean;
  width?: AppWorkspaceDetailWidth;
  widthClass?: string;
  viewTransitionName?: string;
  class?: string;
  resizable?: boolean;
  children: JSX.Element;
};

export type AppWorkspaceSidebarProps = {
  class?: string;
  resizable?: boolean;
  collapsible?: boolean;
  children: JSX.Element;
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

export type AppWorkspaceSidebarMobileProps = {
  children: JSX.Element;
};

export type AppWorkspaceSidebarMobileItemsProps = {
  scrollPreserveKey?: string | false;
  children: JSX.Element;
};

export type AppWorkspaceSidebarBodyProps = {
  class?: string;
  scrollPreserveKey?: string | false;
  sidebarMode?: AppWorkspaceSidebarVisibility;
  children: JSX.Element;
};

export type AppWorkspaceSidebarSectionProps = {
  title?: string;
  class?: string;
  sidebarMode?: AppWorkspaceSidebarVisibility;
  children: JSX.Element;
};

export type AppWorkspaceSidebarItemTone = "default" | "success" | "danger";
export type AppWorkspaceSidebarIconActionTone = "default" | "success" | "danger";
export type AppWorkspaceSidebarVisibility = "always" | "expanded" | "collapsed";

export type AppWorkspaceSidebarItemProps = {
  href?: string;
  navigation?: "enhanced" | "document";
  replace?: boolean;
  scroll?: NavigationScrollMode;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
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
  onClick?: (event: MouseEvent) => void;
  data?: Record<string, string | number | boolean | null | undefined>;
  sidebarMode?: AppWorkspaceSidebarVisibility;
  children: JSX.Element;
};

export type AppWorkspaceSidebarIconGridProps = {
  title?: string;
  columns?: 2 | 3;
  class?: string;
  sidebarMode?: AppWorkspaceSidebarVisibility;
  children: JSX.Element;
};

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
  tone?: AppWorkspaceSidebarIconActionTone;
  viewTransitionName?: string;
  onClick?: (event: MouseEvent) => void;
  sidebarMode?: AppWorkspaceSidebarVisibility;
};

export type AppWorkspaceSidebarItemIconProps = {
  icon?: string;
  children?: JSX.Element;
};

export type AppWorkspaceSidebarItemLabelProps = {
  marquee?: boolean;
  children: JSX.Element;
};

export type AppWorkspaceSidebarItemMetaProps = {
  children: JSX.Element;
};

export type AppWorkspaceSidebarItemActionProps = {
  icon?: string;
  label: string;
  href?: string;
  navigation?: "enhanced" | "document";
  onSelect?: (event: MouseEvent) => void;
  children?: JSX.Element;
};

type AppWorkspaceComponent = ((props: AppWorkspaceProps) => JSX.Element) & {
  Main: (props: AppWorkspaceMainProps) => JSX.Element;
  Detail: (props: AppWorkspaceDetailProps) => JSX.Element;
  Sidebar: (props: AppWorkspaceSidebarProps) => JSX.Element;
  SidebarHeader: (props: AppWorkspaceSidebarHeaderProps) => JSX.Element;
  SidebarMobile: (props: AppWorkspaceSidebarMobileProps) => JSX.Element;
  SidebarMobileItems: (props: AppWorkspaceSidebarMobileItemsProps) => JSX.Element;
  SidebarMobileBody: (props: AppWorkspaceSidebarBodyProps) => JSX.Element;
  SidebarDesktop: (props: { children: JSX.Element }) => JSX.Element;
  SidebarSection: (props: AppWorkspaceSidebarSectionProps) => JSX.Element;
  SidebarBody: (props: AppWorkspaceSidebarBodyProps) => JSX.Element;
  SidebarFooter: (props: { class?: string; sidebarMode?: AppWorkspaceSidebarVisibility; children: JSX.Element }) => JSX.Element;
  SidebarItem: (props: AppWorkspaceSidebarItemProps) => JSX.Element;
  SidebarItemIcon: (props: AppWorkspaceSidebarItemIconProps) => JSX.Element;
  SidebarItemLabel: (props: AppWorkspaceSidebarItemLabelProps) => JSX.Element;
  SidebarItemMeta: (props: AppWorkspaceSidebarItemMetaProps) => JSX.Element;
  SidebarItemAction: (props: AppWorkspaceSidebarItemActionProps) => JSX.Element;
  SidebarIconGrid: (props: AppWorkspaceSidebarIconGridProps) => JSX.Element;
  SidebarIconAction: (props: AppWorkspaceSidebarIconActionProps) => JSX.Element;
};

const isSidebarSlot = (value: unknown): value is SidebarSlot => !!value && typeof value === "object" && "kind" in value;

const collectSidebarSlots = (value: unknown): SidebarSlot[] => {
  if (Array.isArray(value)) return value.flatMap(collectSidebarSlots);
  return isSidebarSlot(value) ? [value] : [];
};

const isSidebarItemSlot = (value: unknown): value is SidebarItemSlot =>
  !!value &&
  typeof value === "object" &&
  "kind" in value &&
  [SIDEBAR_ITEM_ICON, SIDEBAR_ITEM_LABEL, SIDEBAR_ITEM_META, SIDEBAR_ITEM_ACTION].includes(
    (value as SidebarItemSlot).kind as typeof SIDEBAR_ITEM_ICON,
  );

const collectSidebarItemSlots = (value: unknown): SidebarItemSlot[] => {
  if (Array.isArray(value)) return value.flatMap(collectSidebarItemSlots);
  return isSidebarItemSlot(value) ? [value] : [];
};

const tablerIconClass = (icon: string | null | undefined, fallback: string): string => {
  const value = icon?.trim() || fallback;
  return value.startsWith("ti ") ? value : `ti ${value}`;
};

const shouldEnhanceNavigation = (href: string | null | undefined, mode: "enhanced" | "document" | undefined): href is string => {
  if (!href || mode === "document") return false;
  if (/^(https?:)?\/\//.test(href)) return false;
  if (/^(mailto|tel|sms):/.test(href)) return false;
  return true;
};

const linkEnhancementProps = (props: {
  href: string;
  navigation?: "enhanced" | "document";
  replace?: boolean;
  scroll?: NavigationScrollMode;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
}): Pick<LinkProps, "replace" | "scroll" | "onNavigate"> | undefined => {
  if (!shouldEnhanceNavigation(props.href, props.navigation)) return undefined;
  return {
    replace: props.replace,
    scroll: props.scroll,
    onNavigate:
      props.onNavigate ??
      ((nav) => {
        nav.push();
      }),
  };
};

const shouldHandleEnhancedClick = (event: MouseEvent, anchor: HTMLAnchorElement): boolean => {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;
  return new URL(anchor.href, window.location.href).origin === window.location.origin;
};

const handleEnhancedClick = (
  event: MouseEvent & { currentTarget: HTMLAnchorElement },
  href: string,
  props: Pick<LinkProps, "replace" | "scroll" | "onNavigate">,
) => {
  if (!shouldHandleEnhancedClick(event, event.currentTarget)) return;

  const url = new URL(href, window.location.href);
  const scroll = props.scroll ?? "top";
  const replace = Boolean(props.replace);
  const scrollSnapshot = captureScroll();

  event.preventDefault();

  if (!props.onNavigate) {
    navigate(href, { replace, scroll, scrollSnapshot });
    return;
  }

  startViewTransition(() =>
    props.onNavigate!({
      event,
      href,
      url,
      replace,
      scroll,
      push: (nextHref = href, options = {}) =>
        navigate(nextHref, { replace: false, scroll, scrollSnapshot, viewTransition: false, ...options }),
      replaceWith: (nextHref = href, options = {}) =>
        navigate(nextHref, { replace: true, scroll, scrollSnapshot, viewTransition: false, ...options }),
      fallback: (nextHref = href) => documentNavigate(nextHref, { replace }),
      scrollSnapshot,
      captureScroll,
      restoreScroll,
    }),
  );
};

const detailWidthClass = (props: AppWorkspaceDetailProps): string => {
  if (props.widthClass) return props.widthClass;
  switch (props.width ?? "md") {
    case "sm":
      return "lg:w-80 xl:w-72";
    case "lg":
      return "lg:w-[30rem] xl:w-[34rem]";
    case "xl":
      return "lg:w-[34rem] xl:w-[40rem]";
    case "md":
    default:
      return "lg:w-[20rem] xl:w-[24rem]";
  }
};

const detailDefaultWidth = (props: AppWorkspaceDetailProps): number => {
  switch (props.width ?? "md") {
    case "sm":
      return 288;
    case "lg":
      return 480;
    case "xl":
      return 544;
    case "md":
    default:
      return 384;
  }
};

const AppWorkspaceResizeHandle = (props: { kind: "sidebar" | "detail"; defaultWidth: number; collapsible?: boolean }) => (
  <button
    type="button"
    role="separator"
    aria-label={props.kind === "sidebar" ? "Resize navigation" : "Resize detail panel"}
    aria-orientation="vertical"
    aria-valuemin={props.kind === "sidebar" ? (props.collapsible ? 64 : 176) : 288}
    aria-valuemax={props.kind === "sidebar" ? 360 : 640}
    aria-valuenow={props.defaultWidth}
    data-app-workspace-resize={props.kind}
    class={`workspace-resize-handle workspace-resize-handle-${props.kind}`}
    style={props.kind === "detail" ? `--workspace-detail-default:${props.defaultWidth}px` : undefined}
  >
    <span aria-hidden="true" />
  </button>
);

const AppWorkspaceMain = (props: AppWorkspaceMainProps) => (
  <main class={`workspace-main order-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:order-2 ${props.class ?? ""}`}>
    {props.children}
  </main>
);

const AppWorkspaceDetail = (props: AppWorkspaceDetailProps) => {
  const rootResizable = useContext(AppWorkspaceResizeContext);
  const resizable = () => props.resizable ?? (props.widthClass ? false : rootResizable);
  const defaultWidth = () => detailDefaultWidth(props);
  return (
    <>
      <aside
        id={props.id}
        data-workspace-resizable={resizable() ? "true" : "false"}
        class={`workspace-detail ${props.open ? "flex" : "hidden"} order-2 min-h-0 w-full shrink-0 flex-col overflow-hidden lg:order-3 lg:h-full ${detailWidthClass(props)} ${props.class ?? ""}`}
        style={`${props.viewTransitionName ? `view-transition-name:${props.viewTransitionName};` : ""}--workspace-detail-default:${defaultWidth()}px`}
      >
        {props.children}
      </aside>
      <Show when={resizable()}>
        <AppWorkspaceResizeHandle kind="detail" defaultWidth={defaultWidth()} />
      </Show>
    </>
  );
};

function AppWorkspaceSidebarItemIcon(props: AppWorkspaceSidebarItemIconProps): JSX.Element {
  return { kind: SIDEBAR_ITEM_ICON, ...props } satisfies SidebarItemIconSlot as unknown as JSX.Element;
}

function AppWorkspaceSidebarItemLabel(props: AppWorkspaceSidebarItemLabelProps): JSX.Element {
  return { kind: SIDEBAR_ITEM_LABEL, ...props } satisfies SidebarItemLabelSlot as unknown as JSX.Element;
}

function AppWorkspaceSidebarItemMeta(props: AppWorkspaceSidebarItemMetaProps): JSX.Element {
  return { kind: SIDEBAR_ITEM_META, ...props } satisfies SidebarItemMetaSlot as unknown as JSX.Element;
}

function AppWorkspaceSidebarItemAction(props: AppWorkspaceSidebarItemActionProps): JSX.Element {
  return { kind: SIDEBAR_ITEM_ACTION, ...props } satisfies SidebarItemActionSlot as unknown as JSX.Element;
}

function AppWorkspaceSidebarHeader(props: AppWorkspaceSidebarHeaderProps): JSX.Element {
  return {
    kind: SIDEBAR_HEADER,
    ...props,
  } satisfies SidebarHeaderSlot as unknown as JSX.Element;
}

function AppWorkspaceSidebarMobile(props: AppWorkspaceSidebarMobileProps): JSX.Element {
  return {
    kind: SIDEBAR_MOBILE,
    children: props.children,
  } satisfies SidebarMobileSlot as unknown as JSX.Element;
}

function AppWorkspaceSidebarDesktop(props: { children: JSX.Element }): JSX.Element {
  return {
    kind: SIDEBAR_DESKTOP,
    children: props.children,
  } satisfies SidebarDesktopSlot as unknown as JSX.Element;
}

const SidebarHeaderContent = (props: { header: SidebarHeaderSlot; mobile?: boolean }) => (
  <>
    <Show when={props.header.icon !== false}>
      <div
        class={`${props.mobile ? "sidebar-header-icon-mobile h-8 w-8 rounded-lg" : "sidebar-header-icon"} flex shrink-0 items-center justify-center bg-blue-500 text-white`}
        style={`${props.header.iconStyle ?? ""}${props.header.iconViewTransitionName ? `;view-transition-name:${props.header.iconViewTransitionName}` : ""}`}
      >
        <i class={`${tablerIconClass(props.header.icon || undefined, "ti-layout-sidebar")} ${props.mobile ? "text-sm" : "text-xs"}`} />
      </div>
    </Show>
    <div class="min-w-0 flex-1">
      <p
        class={props.mobile ? "truncate font-semibold" : "sidebar-header-title"}
        style={props.header.titleViewTransitionName ? `view-transition-name:${props.header.titleViewTransitionName}` : undefined}
      >
        {props.header.title}
      </p>
      <Show when={!props.mobile && props.header.subtitle}>
        <p class="sidebar-header-subtitle">{props.header.subtitle}</p>
      </Show>
    </div>
    <Show when={!props.mobile && props.header.action}>{props.header.action}</Show>
  </>
);

const AppWorkspaceSidebar = (props: AppWorkspaceSidebarProps) => {
  const rootResizable = useContext(AppWorkspaceResizeContext);
  const resizable = () => props.resizable ?? rootResizable;
  const resolved = children(() => props.children);
  const slots = createMemo(() => collectSidebarSlots(resolved()));
  const header = createMemo(() => slots().find((slot): slot is SidebarHeaderSlot => slot.kind === SIDEBAR_HEADER));
  const mobile = createMemo(() => slots().find((slot): slot is SidebarMobileSlot => slot.kind === SIDEBAR_MOBILE));
  const desktop = createMemo(() => slots().find((slot): slot is SidebarDesktopSlot => slot.kind === SIDEBAR_DESKTOP));

  return (
    <>
      <Show when={header() && mobile()}>
        <nav class="workspace-sidebar-mobile sidebar-container-mobile">
          <details class="group">
            <summary class="sidebar-mobile-toggle">
              <SidebarHeaderContent header={header()!} mobile />
              <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
                <i class="ti ti-chevron-down text-sm" />
              </span>
            </summary>
            <SidebarModeContext.Provider value="mobile">{mobile()!.children}</SidebarModeContext.Provider>
          </details>
        </nav>
      </Show>

      <aside
        class={`workspace-sidebar sidebar-container ${props.class ?? ""}`}
        data-workspace-resizable={resizable() ? "true" : "false"}
        data-workspace-collapsible={props.collapsible ? "true" : "false"}
      >
        <div class="workspace-sidebar-surface paper flex h-full min-h-0 flex-col gap-4 p-3">
          <Show when={header() && header()!.showDesktop !== false}>
            <div class="workspace-sidebar-header relative flex items-center gap-3">
              <SidebarHeaderContent header={header()!} />
            </div>
          </Show>
          <SidebarModeContext.Provider value="desktop">{desktop()?.children}</SidebarModeContext.Provider>
        </div>
      </aside>
      <Show when={resizable()}>
        <AppWorkspaceResizeHandle kind="sidebar" defaultWidth={208} collapsible={props.collapsible} />
      </Show>
    </>
  );
};

const scrollPreserveAttr = (key: string | false | undefined) => (key ? { "data-scroll-preserve": key } : {});

const AppWorkspaceSidebarMobileItems = (props: AppWorkspaceSidebarMobileItemsProps) => (
  <div class="sidebar-mobile-actions" {...scrollPreserveAttr(props.scrollPreserveKey)}>
    {props.children}
  </div>
);

const AppWorkspaceSidebarMobileBody = (props: AppWorkspaceSidebarBodyProps) => (
  <div
    class={`mt-2 flex max-h-64 flex-col gap-3 overflow-y-auto p-2 ${props.class ?? ""}`}
    {...scrollPreserveAttr(props.scrollPreserveKey)}
  >
    {props.children}
  </div>
);

const sidebarModeAttr = (mode: AppWorkspaceSidebarVisibility | undefined) =>
  mode && mode !== "always" ? { "data-sidebar-mode": mode } : {};

const AppWorkspaceSidebarSection = (props: AppWorkspaceSidebarSectionProps) => (
  <section class={`sidebar-group ${props.class ?? ""}`} {...sidebarModeAttr(props.sidebarMode)}>
    <Show when={props.title}>
      <p class="sidebar-section-title">{props.title}</p>
    </Show>
    {props.children}
  </section>
);

const AppWorkspaceSidebarBody = (props: AppWorkspaceSidebarBodyProps) => (
  <div class={`sidebar-body ${props.class ?? ""}`} {...scrollPreserveAttr(props.scrollPreserveKey)} {...sidebarModeAttr(props.sidebarMode)}>
    {props.children}
  </div>
);

const AppWorkspaceSidebarFooter = (props: { class?: string; sidebarMode?: AppWorkspaceSidebarVisibility; children: JSX.Element }) => (
  <section class={`sidebar-footer ${props.class ?? ""}`} {...sidebarModeAttr(props.sidebarMode)}>
    {props.children}
  </section>
);

const AppWorkspaceSidebarIconGrid = (props: AppWorkspaceSidebarIconGridProps) => (
  <section class={`sidebar-icon-grid-wrap ${props.class ?? ""}`} {...sidebarModeAttr(props.sidebarMode)}>
    <Show when={props.title}>
      <p class="sidebar-section-title">{props.title}</p>
    </Show>
    <div class={`sidebar-icon-grid ${props.columns === 3 ? "grid-cols-3" : "grid-cols-2"}`}>{props.children}</div>
  </section>
);

const itemToneClass = (tone: AppWorkspaceSidebarItemTone | undefined, mobile: boolean): string => {
  if (tone === "success") {
    return mobile
      ? "border-green-500/25 bg-green-50/70 text-green-700 dark:border-green-400/30 dark:bg-green-950/30 dark:text-green-300"
      : "text-green-600 bg-green-500/10 hover:bg-green-500/20 dark:text-green-400";
  }
  if (tone === "danger") {
    return mobile
      ? "border-red-500/25 bg-red-50/70 text-red-700 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-300"
      : "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30";
  }
  return "";
};

const activeMobileClass = "border-blue-500/35 bg-blue-50/70 text-blue-700 dark:border-blue-400/40 dark:bg-blue-950/40 dark:text-blue-200";

const iconActionToneClass = (tone: AppWorkspaceSidebarIconActionTone | undefined): string => {
  if (tone === "success") return "sidebar-icon-action-success";
  if (tone === "danger") return "sidebar-icon-action-danger";
  return "";
};

const AppWorkspaceSidebarItem = (props: AppWorkspaceSidebarItemProps) => {
  const mode = useContext(SidebarModeContext);
  const resolved = children(() => props.children);
  const slots = createMemo(() => collectSidebarItemSlots(resolved()));
  const iconSlot = createMemo(() => slots().find((slot): slot is SidebarItemIconSlot => slot.kind === SIDEBAR_ITEM_ICON));
  const labelSlot = createMemo(() => slots().find((slot): slot is SidebarItemLabelSlot => slot.kind === SIDEBAR_ITEM_LABEL));
  const metaSlot = createMemo(() => slots().find((slot): slot is SidebarItemMetaSlot => slot.kind === SIDEBAR_ITEM_META));
  const actionSlot = createMemo(() => slots().find((slot): slot is SidebarItemActionSlot => slot.kind === SIDEBAR_ITEM_ACTION));
  const mobile = () => mode === "mobile";
  const hasAction = () => Boolean(actionSlot() || props.actionIcon);
  const className = () =>
    mobile()
      ? `sidebar-item-mobile ${hasAction() ? "sidebar-item-has-action" : ""} ${props.active ? (props.activeClass ?? activeMobileClass) : ""} ${itemToneClass(props.tone, true)} ${props.disabled ? "pointer-events-none opacity-50" : ""} ${props.class ?? ""}`
      : `sidebar-item group text-xs ${hasAction() ? "sidebar-item-has-action" : ""} ${props.active ? (props.activeClass ?? "sidebar-item-active") : ""} ${itemToneClass(props.tone, false)} ${props.disabled ? "pointer-events-none opacity-50" : ""} ${props.class ?? ""}`;
  const style = () => (props.viewTransitionName ? `view-transition-name:${props.viewTransitionName}` : undefined);
  const dataAttrs = () =>
    Object.fromEntries(
      Object.entries({
        ...props.data,
        ...(props.sidebarMode && props.sidebarMode !== "always" ? { "sidebar-mode": props.sidebarMode } : {}),
      })
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [`data-${key}`, String(value)]),
    );
  const enhanced = (href: string) =>
    linkEnhancementProps({
      href,
      navigation: props.navigation,
      replace: props.replace,
      scroll: props.scroll,
      onNavigate: props.onNavigate,
    });

  const legacyChildren = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value.flatMap(legacyChildren);
    return isSidebarItemSlot(value) ? [] : [value];
  };
  const labelContent = createMemo(() => {
    if (labelSlot()) return labelSlot()!.children;
    const content = legacyChildren(resolved());
    return content.length === 1 ? content[0] : content;
  });
  const iconContent = () => iconSlot()?.children;
  const iconName = () => iconSlot()?.icon ?? props.icon;
  const metaContent = () => metaSlot()?.children ?? props.meta;

  const mainContent = (
    <>
      <Show when={iconContent() || iconName()}>
        <span class="sidebar-item-icon" aria-hidden="true">
          <Show when={iconContent()} fallback={<i class={`${tablerIconClass(iconName(), "ti-circle")} ${mobile() ? "" : "text-sm"}`} />}>
            {iconContent()}
          </Show>
        </span>
      </Show>
      <span class="sidebar-item-label" data-app-workspace-label data-marquee={labelSlot()?.marquee === false ? undefined : "true"}>
        <span class="sidebar-item-label-text" data-app-workspace-label-text>
          {labelContent() as JSX.Element}
        </span>
      </span>
      <Show when={metaContent()}>
        <span class="sidebar-item-meta-trailing">{metaContent()}</span>
      </Show>
    </>
  );
  const actionContent = () =>
    actionSlot()?.children ?? <i class={`${tablerIconClass(actionSlot()?.icon ?? props.actionIcon, "ti-dots")} text-xs`} />;
  const actionLabel = () => actionSlot()?.label ?? props.actionLabel ?? "Row action";
  const actionSelect = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    actionSlot()?.onSelect?.(event);
    props.onActionClick?.(event);
  };
  const actionButton = () => {
    const slot = actionSlot();
    if (!hasAction()) return null;
    if (slot?.href) {
      const linkProps = linkEnhancementProps({ href: slot.href, navigation: slot.navigation });
      return (
        <a
          href={slot.href}
          class="sidebar-item-action"
          aria-label={actionLabel()}
          title={actionLabel()}
          onClick={(event) => {
            event.stopPropagation();
            slot.onSelect?.(event);
            if (linkProps) handleEnhancedClick(event, slot.href!, linkProps);
          }}
        >
          {actionContent()}
        </a>
      );
    }
    return (
      <button type="button" class="sidebar-item-action" aria-label={actionLabel()} title={actionLabel()} onClick={actionSelect}>
        {actionContent()}
      </button>
    );
  };
  const actionRowContentClass = "sidebar-item-main";

  const renderWithAction = () => (
    <Show
      when={props.disabled ? undefined : props.href}
      fallback={
        <div class={className()} title={props.title} style={style()} data-app-workspace-item {...dataAttrs()}>
          <button type="button" class={actionRowContentClass} disabled={props.disabled} onClick={props.onClick}>
            {mainContent}
          </button>
          {actionButton()}
        </div>
      }
    >
      {(href) => (
        <Show
          when={enhanced(href())}
          fallback={
            <div class={className()} title={props.title} style={style()} data-app-workspace-item {...dataAttrs()}>
              <a href={href()} class={actionRowContentClass} aria-current={props.active ? "page" : undefined} onClick={props.onClick}>
                {mainContent}
              </a>
              {actionButton()}
            </div>
          }
        >
          {(linkProps) => (
            <div class={className()} title={props.title} style={style()} data-app-workspace-item {...dataAttrs()}>
              <a
                href={href()}
                class={actionRowContentClass}
                aria-current={props.active ? "page" : undefined}
                onClick={(event) => {
                  props.onClick?.(event);
                  handleEnhancedClick(event, href(), linkProps());
                }}
              >
                {mainContent}
              </a>
              {actionButton()}
            </div>
          )}
        </Show>
      )}
    </Show>
  );

  if (hasAction()) return renderWithAction();

  return (
    <Show
      when={props.disabled ? undefined : props.href}
      fallback={
        <button
          type="button"
          class={className()}
          title={props.title}
          style={style()}
          data-app-workspace-item
          disabled={props.disabled}
          onClick={props.onClick}
          {...dataAttrs()}
        >
          {mainContent}
        </button>
      }
    >
      {(href) => (
        <Show
          when={enhanced(href())}
          fallback={
            <a
              href={href()}
              class={className()}
              title={props.title}
              style={style()}
              aria-current={props.active ? "page" : undefined}
              data-app-workspace-item
              onClick={props.onClick}
              {...dataAttrs()}
            >
              {mainContent}
            </a>
          }
        >
          {(linkProps) => (
            <a
              href={href()}
              class={className()}
              title={props.title}
              style={style()}
              aria-current={props.active ? "page" : undefined}
              data-app-workspace-item
              onClick={(event) => {
                props.onClick?.(event);
                handleEnhancedClick(event, href(), linkProps());
              }}
              {...dataAttrs()}
            >
              {mainContent}
            </a>
          )}
        </Show>
      )}
    </Show>
  );
};

const AppWorkspaceSidebarIconAction = (props: AppWorkspaceSidebarIconActionProps) => {
  const className = () =>
    `sidebar-icon-action ${props.active ? "sidebar-icon-action-active" : ""} ${iconActionToneClass(props.tone)} ${props.disabled ? "pointer-events-none opacity-40" : ""}`;
  const style = () => (props.viewTransitionName ? `view-transition-name:${props.viewTransitionName}` : undefined);
  const content = <i class={`${tablerIconClass(props.icon, "ti-circle")} text-base`} />;
  const href = () => (props.href && !props.disabled ? props.href : null);
  const enhanced = (href: string) =>
    linkEnhancementProps({
      href,
      navigation: props.navigation,
      replace: props.replace,
      scroll: props.scroll,
      onNavigate: props.onNavigate,
    });

  return (
    <Show
      when={href()}
      fallback={
        <button
          type="button"
          class={className()}
          title={props.label}
          aria-label={props.label}
          disabled={props.disabled}
          style={style()}
          onClick={props.onClick}
          {...sidebarModeAttr(props.sidebarMode)}
        >
          {content}
        </button>
      }
    >
      {(href) => (
        <Show
          when={enhanced(href())}
          fallback={
            <a
              href={href()}
              class={className()}
              title={props.label}
              aria-label={props.label}
              style={style()}
              onClick={props.onClick}
              {...sidebarModeAttr(props.sidebarMode)}
            >
              {content}
            </a>
          }
        >
          {(linkProps) => (
            <a
              href={href()}
              class={className()}
              title={props.label}
              aria-label={props.label}
              style={style()}
              onClick={(event) => {
                props.onClick?.(event);
                handleEnhancedClick(event, href(), linkProps());
              }}
              {...sidebarModeAttr(props.sidebarMode)}
            >
              {content}
            </a>
          )}
        </Show>
      )}
    </Show>
  );
};

const AppWorkspace = ((props: AppWorkspaceProps) => (
  <AppWorkspaceResizeContext.Provider value={props.resizable !== false}>
    <div class={`app-workspace app-cols relative h-full ${props.class ?? ""}`} data-app-workspace>
      {props.children}
    </div>
  </AppWorkspaceResizeContext.Provider>
)) as AppWorkspaceComponent;

AppWorkspace.Main = AppWorkspaceMain;
AppWorkspace.Detail = AppWorkspaceDetail;
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
