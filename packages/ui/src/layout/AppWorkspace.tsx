import { Link, type LinkNavigateEvent, type NavigationScrollMode } from "@k2b/ssr/nav";
import { type JSX, Show } from "solid-js";

export type AppWorkspaceProps = {
  children: JSX.Element;
  class?: string;
};

export type AppWorkspaceContentProps = {
  children: JSX.Element;
  class?: string;
};

export type AppWorkspaceMainProps = {
  children: JSX.Element;
  class?: string;
  "aria-busy"?: boolean | "true" | "false";
};

export type AppWorkspaceDetailProps = {
  children: JSX.Element;
  open: boolean;
  class?: string;
  width?: "sm" | "md" | "lg" | "xl";
};

export type AppWorkspaceSidebarProps = {
  children: JSX.Element;
  class?: string;
};

export type AppWorkspaceSidebarHeaderProps = {
  title: string;
  subtitle?: string;
  icon?: string | false;
  action?: JSX.Element;
};

export type AppWorkspaceSidebarSectionProps = {
  children: JSX.Element;
  title?: string;
  class?: string;
};

export type AppWorkspaceSidebarItemProps = {
  children: JSX.Element;
  href?: string;
  navigation?: "enhanced" | "document";
  replace?: boolean;
  scroll?: NavigationScrollMode;
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
  onClick?: JSX.EventHandlerUnion<HTMLAnchorElement | HTMLButtonElement, MouseEvent>;
  active?: boolean;
  disabled?: boolean;
  icon?: string;
  meta?: JSX.Element;
  title?: string;
  class?: string;
};

type AppWorkspaceComponent = ((props: AppWorkspaceProps) => JSX.Element) & {
  Content: (props: AppWorkspaceContentProps) => JSX.Element;
  Main: (props: AppWorkspaceMainProps) => JSX.Element;
  Detail: (props: AppWorkspaceDetailProps) => JSX.Element;
  Sidebar: (props: AppWorkspaceSidebarProps) => JSX.Element;
  SidebarHeader: (props: AppWorkspaceSidebarHeaderProps) => JSX.Element;
  SidebarBody: (props: AppWorkspaceSidebarProps) => JSX.Element;
  SidebarFooter: (props: AppWorkspaceSidebarProps) => JSX.Element;
  SidebarSection: (props: AppWorkspaceSidebarSectionProps) => JSX.Element;
  SidebarItem: (props: AppWorkspaceSidebarItemProps) => JSX.Element;
};

const AppWorkspaceContent = (props: AppWorkspaceContentProps): JSX.Element => (
  <div class={`k2b-app-workspace__content ${props.class ?? ""}`}>{props.children}</div>
);

const AppWorkspaceMain = (props: AppWorkspaceMainProps): JSX.Element => (
  <main class={`k2b-app-workspace__main ${props.class ?? ""}`} aria-busy={props["aria-busy"]}>
    {props.children}
  </main>
);

const AppWorkspaceDetail = (props: AppWorkspaceDetailProps): JSX.Element => (
  <Show when={props.open}>
    <aside class={`k2b-app-workspace__detail ${props.class ?? ""}`} data-width={props.width ?? "md"}>
      {props.children}
    </aside>
  </Show>
);

const AppWorkspaceSidebar = (props: AppWorkspaceSidebarProps): JSX.Element => (
  <aside class={`k2b-app-workspace__sidebar ${props.class ?? ""}`}>{props.children}</aside>
);

const AppWorkspaceSidebarHeader = (props: AppWorkspaceSidebarHeaderProps): JSX.Element => (
  <header class="k2b-app-workspace__sidebar-header">
    <Show when={props.icon !== false}>
      <span class="k2b-app-workspace__sidebar-header-icon" aria-hidden="true">
        <i class={props.icon || "ti ti-layout-sidebar-left"} />
      </span>
    </Show>
    <span class="k2b-app-workspace__sidebar-heading">
      <strong>{props.title}</strong>
      <Show when={props.subtitle}>
        <small>{props.subtitle}</small>
      </Show>
    </span>
    <Show when={props.action}>
      <span class="k2b-app-workspace__sidebar-action">{props.action}</span>
    </Show>
  </header>
);

const AppWorkspaceSidebarBody = (props: AppWorkspaceSidebarProps): JSX.Element => (
  <div class={`k2b-app-workspace__sidebar-body ${props.class ?? ""}`}>{props.children}</div>
);

const AppWorkspaceSidebarFooter = (props: AppWorkspaceSidebarProps): JSX.Element => (
  <footer class={`k2b-app-workspace__sidebar-footer ${props.class ?? ""}`}>{props.children}</footer>
);

const AppWorkspaceSidebarSection = (props: AppWorkspaceSidebarSectionProps): JSX.Element => (
  <section class={`k2b-app-workspace__sidebar-section ${props.class ?? ""}`}>
    <Show when={props.title}>
      <h2>{props.title}</h2>
    </Show>
    {props.children}
  </section>
);

const itemContent = (props: AppWorkspaceSidebarItemProps): JSX.Element => (
  <>
    <Show when={props.icon}>{(icon) => <i class={`${icon()} k2b-app-workspace__sidebar-item-icon`} aria-hidden="true" />}</Show>
    <span class="k2b-app-workspace__sidebar-item-label">{props.children}</span>
    <Show when={props.meta}>
      <span class="k2b-app-workspace__sidebar-item-meta">{props.meta}</span>
    </Show>
  </>
);

const AppWorkspaceSidebarItem = (props: AppWorkspaceSidebarItemProps): JSX.Element => {
  const className = () => `k2b-app-workspace__sidebar-item ${props.active ? "is-active" : ""} ${props.class ?? ""}`;

  if (!props.href || props.disabled) {
    return (
      <button
        type="button"
        class={className()}
        disabled={props.disabled}
        title={props.title}
        onClick={props.onClick as JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>}
      >
        {itemContent(props)}
      </button>
    );
  }

  if (props.navigation === "document") {
    return (
      <a
        href={props.href}
        class={className()}
        aria-current={props.active ? "page" : undefined}
        title={props.title}
        onClick={props.onClick as JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>}
      >
        {itemContent(props)}
      </a>
    );
  }

  return (
    <Link
      href={props.href}
      class={className()}
      aria-current={props.active ? "page" : undefined}
      title={props.title}
      replace={props.replace}
      scroll={props.scroll}
      onNavigate={props.onNavigate}
      onClick={props.onClick as JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>}
    >
      {itemContent(props)}
    </Link>
  );
};

const AppWorkspace = ((props: AppWorkspaceProps) => (
  <div class={`k2b-app-workspace ${props.class ?? ""}`} data-k2b-app-workspace>
    {props.children}
  </div>
)) as AppWorkspaceComponent;

AppWorkspace.Content = AppWorkspaceContent;
AppWorkspace.Main = AppWorkspaceMain;
AppWorkspace.Detail = AppWorkspaceDetail;
AppWorkspace.Sidebar = AppWorkspaceSidebar;
AppWorkspace.SidebarHeader = AppWorkspaceSidebarHeader;
AppWorkspace.SidebarBody = AppWorkspaceSidebarBody;
AppWorkspace.SidebarFooter = AppWorkspaceSidebarFooter;
AppWorkspace.SidebarSection = AppWorkspaceSidebarSection;
AppWorkspace.SidebarItem = AppWorkspaceSidebarItem;

export default AppWorkspace;
