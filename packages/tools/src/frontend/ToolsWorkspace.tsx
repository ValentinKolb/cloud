import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import ToolSearchButton from "./ToolSearchButton.island";
import { categories, categoryOrder, tools } from "./tools/registry";

type ToolsWorkspaceProps = {
  activeToolId?: string;
  layout?: "main" | "regions";
  children: JSX.Element;
};

export const ToolsWorkspace = (props: ToolsWorkspaceProps) => {
  const renderItem = (tool: (typeof tools)[number]) => (
    <AppWorkspace.SidebarItem
      href={`/tools/${tool.id}`}
      navigation="document"
      icon={tool.icon}
      active={props.activeToolId === tool.id}
      title={tool.name}
      meta={tool.featured ? <i class="ti ti-star-filled text-[10px]" /> : undefined}
    >
      {tool.name}
    </AppWorkspace.SidebarItem>
  );

  const categoryNavigation = (sidebarMode?: "expanded") => (
    <>
      {categoryOrder.map((category) => {
        const items = tools.filter((tool) => tool.category === category);
        if (items.length === 0) return null;
        return (
          <AppWorkspace.SidebarSection title={categories[category].label} sidebarMode={sidebarMode}>
            {items.map(renderItem)}
          </AppWorkspace.SidebarSection>
        );
      })}
    </>
  );

  return (
    <AppWorkspace class="cloud-ui-soft flex-1 min-h-0">
      <AppWorkspace.Sidebar collapsible>
        <AppWorkspace.SidebarHeader
          title="Tools"
          subtitle="Utilities"
          icon="ti ti-tools"
          iconStyle="background-color: color-mix(in srgb, var(--app-accent) 12%, var(--ui-surface)); color: var(--ui-app-accent-text); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 24%, transparent)"
          showDesktop={false}
        />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems scrollPreserveKey="tools-sidebar-mobile">
            <AppWorkspace.SidebarItem href="/tools" navigation="document" icon="ti ti-layout-grid" active={!props.activeToolId}>
              Overview
            </AppWorkspace.SidebarItem>
            <ToolSearchButton variant="sidebar-mobile" />
            {tools.filter((tool) => tool.featured).map(renderItem)}
          </AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarMobileBody scrollPreserveKey="tools-sidebar-mobile-body">
            {categoryNavigation()}
          </AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey="tools-sidebar">
            <AppWorkspace.SidebarIconGrid columns={2}>
              <AppWorkspace.SidebarIconAction
                href="/tools"
                navigation="document"
                icon="ti ti-layout-grid"
                label="Overview"
                active={!props.activeToolId}
              />
              <ToolSearchButton variant="icon" registerShortcut />
            </AppWorkspace.SidebarIconGrid>
            {categoryNavigation("expanded")}
          </AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>
      <AppWorkspace.Content>
        {props.layout === "regions" ? (
          props.children
        ) : (
          <AppWorkspace.Main
            class={props.activeToolId ? "tools-main overflow-y-auto p-[var(--ui-space-shell)]" : "tools-main overflow-y-auto"}
          >
            {props.children}
          </AppWorkspace.Main>
        )}
      </AppWorkspace.Content>
    </AppWorkspace>
  );
};
