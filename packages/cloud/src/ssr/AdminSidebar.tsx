import { AppWorkspace } from "../ui";
import { activeAdminHref } from "./admin-active-link";
import { type AdminLink, buildAdminGroups } from "./admin-navigation";
import type { RuntimeContext } from "./runtime";

const AdminNavigation = (props: { currentPath: string; groups: ReturnType<typeof buildAdminGroups> }) => {
  const activeHref = activeAdminHref(
    props.currentPath,
    props.groups.flatMap((group) => group.links.map((link: AdminLink) => link.href)),
  );
  return (
    <>
      {props.groups.map((group) => (
        <AppWorkspace.SidebarSection title={group.label}>
          {group.links.map((link: AdminLink) => (
            <AppWorkspace.SidebarItem href={link.href} navigation="document" active={link.href === activeHref} title={link.label}>
              <AppWorkspace.SidebarItemIcon icon={`ti ${link.icon}`} />
              <AppWorkspace.SidebarItemLabel>{link.label}</AppWorkspace.SidebarItemLabel>
            </AppWorkspace.SidebarItem>
          ))}
        </AppWorkspace.SidebarSection>
      ))}
    </>
  );
};

export default function AdminSidebar({ currentPath, apps }: { currentPath: string; apps: readonly RuntimeContext["apps"][number][] }) {
  const groups = buildAdminGroups(apps);

  return (
    <AppWorkspace.Sidebar resizable={false}>
      <AppWorkspace.SidebarHeader
        title="Admin"
        icon="ti ti-settings"
        iconStyle="background-color: color-mix(in srgb, var(--app-accent) 12%, var(--ui-surface)); color: var(--ui-app-accent-text); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 24%, transparent)"
      />

      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="admin-sidebar-mobile">
          <AdminNavigation currentPath={currentPath} groups={groups} />
        </AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>

      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarBody scrollPreserveKey="admin-sidebar">
          <AdminNavigation currentPath={currentPath} groups={groups} />
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
