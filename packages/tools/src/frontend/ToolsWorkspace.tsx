import { AppWorkspace } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import ToolSearchButton from "./ToolSearchButton.island";
import { categories, categoryOrder, tools } from "./tools/registry";

type ToolsWorkspaceProps = {
  activeToolId?: string;
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

  const sidebarContent = (options: { showSearch?: boolean; registerShortcut?: boolean } = {}) => (
    <>
      <AppWorkspace.SidebarSection title="Start">
        <AppWorkspace.SidebarItem href="/tools" navigation="document" icon="ti ti-layout-grid" active={!props.activeToolId}>
          Overview
        </AppWorkspace.SidebarItem>
        {options.showSearch ? <ToolSearchButton variant="sidebar" registerShortcut={options.registerShortcut} /> : null}
      </AppWorkspace.SidebarSection>
      {categoryOrder.map((category) => {
        const items = tools.filter((tool) => tool.category === category);
        if (items.length === 0) return null;
        return <AppWorkspace.SidebarSection title={categories[category].label}>{items.map(renderItem)}</AppWorkspace.SidebarSection>;
      })}
    </>
  );

  return (
    <AppWorkspace class="cloud-ui-soft flex-1 min-h-0">
      <AppWorkspace.Sidebar>
        <AppWorkspace.SidebarHeader
          title="Tools"
          subtitle="Utilities"
          icon="ti ti-tools"
          iconStyle="background-color: var(--color-blue-500)"
        />
        <AppWorkspace.SidebarMobile>
          <AppWorkspace.SidebarMobileItems scrollPreserveKey="tools-sidebar-mobile">
            <AppWorkspace.SidebarItem href="/tools" navigation="document" icon="ti ti-layout-grid" active={!props.activeToolId}>
              Overview
            </AppWorkspace.SidebarItem>
            <ToolSearchButton variant="sidebar-mobile" />
            {tools.filter((tool) => tool.featured).map(renderItem)}
          </AppWorkspace.SidebarMobileItems>
          <AppWorkspace.SidebarMobileBody scrollPreserveKey="tools-sidebar-mobile-body">{sidebarContent()}</AppWorkspace.SidebarMobileBody>
        </AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarDesktop>
          <AppWorkspace.SidebarBody scrollPreserveKey="tools-sidebar">
            {sidebarContent({ showSearch: true, registerShortcut: true })}
          </AppWorkspace.SidebarBody>
        </AppWorkspace.SidebarDesktop>
      </AppWorkspace.Sidebar>
      <AppWorkspace.Main
        class={props.activeToolId === "image" || props.activeToolId === "webhooks" ? "overflow-hidden" : "p-4 overflow-y-auto"}
      >
        {props.children}
      </AppWorkspace.Main>
    </AppWorkspace>
  );
};
