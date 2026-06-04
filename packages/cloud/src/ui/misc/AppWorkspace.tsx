import { children, createContext, createMemo, type JSX, Show, useContext } from "solid-js";
import { Link, type LinkNavigateEvent, type LinkProps, type NavigationScrollMode } from "@valentinkolb/ssr/nav";

const SIDEBAR_HEADER = Symbol("AppWorkspace.SidebarHeader");
const SIDEBAR_MOBILE = Symbol("AppWorkspace.SidebarMobile");
const SIDEBAR_DESKTOP = Symbol("AppWorkspace.SidebarDesktop");

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
};

type SidebarMobileSlot = SidebarSlot & {
  readonly kind: typeof SIDEBAR_MOBILE;
};

type SidebarDesktopSlot = SidebarSlot & {
  readonly kind: typeof SIDEBAR_DESKTOP;
};

type SidebarMode = "desktop" | "mobile";

const SidebarModeContext = createContext<SidebarMode>("desktop");

export type AppWorkspaceProps = {
  class?: string;
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
  children: JSX.Element;
};

export type AppWorkspaceSidebarProps = {
  class?: string;
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
  children: JSX.Element;
};

export type AppWorkspaceSidebarSectionProps = {
  title?: string;
  class?: string;
  children: JSX.Element;
};

export type AppWorkspaceSidebarItemTone = "default" | "success" | "danger";
export type AppWorkspaceSidebarIconActionTone = "default" | "success" | "danger";

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
  children: JSX.Element;
};

export type AppWorkspaceSidebarIconGridProps = {
  title?: string;
  columns?: 2 | 3;
  class?: string;
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
  SidebarFooter: (props: { class?: string; children: JSX.Element }) => JSX.Element;
  SidebarItem: (props: AppWorkspaceSidebarItemProps) => JSX.Element;
  SidebarIconGrid: (props: AppWorkspaceSidebarIconGridProps) => JSX.Element;
  SidebarIconAction: (props: AppWorkspaceSidebarIconActionProps) => JSX.Element;
};

const isSidebarSlot = (value: unknown): value is SidebarSlot => !!value && typeof value === "object" && "kind" in value;

const collectSidebarSlots = (value: unknown): SidebarSlot[] => {
  if (Array.isArray(value)) return value.flatMap(collectSidebarSlots);
  return isSidebarSlot(value) ? [value] : [];
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

const AppWorkspaceMain = (props: AppWorkspaceMainProps) => (
  <main class={`order-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:order-2 ${props.class ?? ""}`}>{props.children}</main>
);

const AppWorkspaceDetail = (props: AppWorkspaceDetailProps) => (
  <aside
    id={props.id}
    class={`${props.open ? "flex" : "hidden"} order-2 min-h-0 w-full shrink-0 flex-col overflow-hidden lg:order-3 lg:h-full ${detailWidthClass(props)} ${props.class ?? ""}`}
    style={props.viewTransitionName ? `view-transition-name:${props.viewTransitionName}` : undefined}
  >
    {props.children}
  </aside>
);

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
        class={`${props.mobile ? "h-8 w-8 rounded-lg" : "sidebar-header-icon"} flex shrink-0 items-center justify-center bg-blue-500 text-white`}
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
  const resolved = children(() => props.children);
  const slots = createMemo(() => collectSidebarSlots(resolved()));
  const header = createMemo(() => slots().find((slot): slot is SidebarHeaderSlot => slot.kind === SIDEBAR_HEADER));
  const mobile = createMemo(() => slots().find((slot): slot is SidebarMobileSlot => slot.kind === SIDEBAR_MOBILE));
  const desktop = createMemo(() => slots().find((slot): slot is SidebarDesktopSlot => slot.kind === SIDEBAR_DESKTOP));

  return (
    <>
      <Show when={header() && mobile()}>
        <nav class="sidebar-container-mobile">
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

      <aside class={`sidebar-container ${props.class ?? ""}`}>
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
          <Show when={header()}>
            <div class="relative flex items-center gap-3 pr-7">
              <SidebarHeaderContent header={header()!} />
            </div>
          </Show>
          <SidebarModeContext.Provider value="desktop">{desktop()?.children}</SidebarModeContext.Provider>
        </div>
      </aside>
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
  <div class={`mt-2 max-h-64 overflow-y-auto p-2 ${props.class ?? ""}`} {...scrollPreserveAttr(props.scrollPreserveKey)}>
    {props.children}
  </div>
);

const AppWorkspaceSidebarSection = (props: AppWorkspaceSidebarSectionProps) => (
  <section class={`sidebar-group ${props.class ?? ""}`}>
    <Show when={props.title}>
      <p class="sidebar-section-title">{props.title}</p>
    </Show>
    {props.children}
  </section>
);

const AppWorkspaceSidebarBody = (props: AppWorkspaceSidebarBodyProps) => (
  <div class={`sidebar-body ${props.class ?? ""}`} {...scrollPreserveAttr(props.scrollPreserveKey)}>
    {props.children}
  </div>
);

const AppWorkspaceSidebarFooter = (props: { class?: string; children: JSX.Element }) => (
  <section class={`sidebar-footer ${props.class ?? ""}`}>{props.children}</section>
);

const AppWorkspaceSidebarIconGrid = (props: AppWorkspaceSidebarIconGridProps) => (
  <section class={`sidebar-icon-grid-wrap ${props.class ?? ""}`}>
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
  const mobile = () => mode === "mobile";
  const className = () =>
    mobile()
      ? `sidebar-item-mobile ${props.active ? (props.activeClass ?? activeMobileClass) : ""} ${itemToneClass(props.tone, true)} ${props.disabled ? "pointer-events-none opacity-50" : ""} ${props.class ?? ""}`
      : `sidebar-item text-xs ${props.active ? (props.activeClass ?? "sidebar-item-active") : ""} ${itemToneClass(props.tone, false)} ${props.disabled ? "pointer-events-none opacity-50" : ""} ${props.class ?? ""}`;
  const style = () => (props.viewTransitionName ? `view-transition-name:${props.viewTransitionName}` : undefined);
  const dataAttrs = () =>
    Object.fromEntries(
      Object.entries(props.data ?? {})
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

  const content = (
    <>
      <Show when={props.icon}>
        <i class={`${tablerIconClass(props.icon, "ti-circle")} ${mobile() ? "" : "text-sm"}`} />
      </Show>
      <span class="min-w-0 flex-1 truncate text-left">{props.children}</span>
      <Show when={props.meta}>
        <span class="shrink-0 text-dimmed tabular-nums">{props.meta}</span>
      </Show>
      <Show when={props.actionIcon && !mobile()}>
        <button
          type="button"
          class="sidebar-item-action"
          aria-label={props.actionLabel ?? "Row action"}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onActionClick?.(event);
          }}
        >
          <i class={`${tablerIconClass(props.actionIcon, "ti-dots")} text-xs`} />
        </button>
      </Show>
    </>
  );

  return (
    <Show
      when={props.disabled ? undefined : props.href}
      fallback={
        <button
          type="button"
          class={className()}
          title={props.title}
          style={style()}
          disabled={props.disabled}
          onClick={props.onClick}
          {...dataAttrs()}
        >
          {content}
        </button>
      }
    >
      {(href) => (
        <Show
          when={enhanced(href())}
          fallback={
            <a href={href()} class={className()} title={props.title} style={style()} onClick={props.onClick} {...dataAttrs()}>
              {content}
            </a>
          }
        >
          {(linkProps) => (
            <Link
              href={href()}
              {...linkProps()}
              class={className()}
              title={props.title}
              style={style()}
              onClick={props.onClick}
              {...dataAttrs()}
            >
              {content}
            </Link>
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
        >
          {content}
        </button>
      }
    >
      {(href) => (
        <Show
          when={enhanced(href())}
          fallback={
            <a href={href()} class={className()} title={props.label} aria-label={props.label} style={style()} onClick={props.onClick}>
              {content}
            </a>
          }
        >
          {(linkProps) => (
            <Link
              href={href()}
              {...linkProps()}
              class={className()}
              title={props.label}
              aria-label={props.label}
              style={style()}
              onClick={props.onClick}
            >
              {content}
            </Link>
          )}
        </Show>
      )}
    </Show>
  );
};

const AppWorkspace = ((props: AppWorkspaceProps) => (
  <div class={`app-cols h-full ${props.class ?? ""}`}>{props.children}</div>
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
AppWorkspace.SidebarIconGrid = AppWorkspaceSidebarIconGrid;
AppWorkspace.SidebarIconAction = AppWorkspaceSidebarIconAction;

export default AppWorkspace;
