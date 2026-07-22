import { AppWorkspace } from "../ui";
import { type AdminLink, buildAdminGroups } from "./admin-navigation";
import type { RuntimeContext } from "./runtime";

function isActive(currentPath: string, href: string): boolean {
  const current = new URL(`http://admin.local${currentPath}`);
  const target = new URL(`http://admin.local${href}`);
  if (target.pathname === "/admin") return current.pathname === "/admin";
  if (target.pathname === "/admin/settings") {
    return current.pathname === "/admin/settings" && current.searchParams.get("tab") === target.searchParams.get("tab");
  }
  return current.pathname === target.pathname || current.pathname.startsWith(`${target.pathname}/`);
}

const AdminNavigation = (props: { currentPath: string; groups: ReturnType<typeof buildAdminGroups> }) => (
  <>
    {props.groups.map((group) => (
      <AppWorkspace.SidebarSection title={group.label}>
        {group.links.map((link: AdminLink) => (
          <AppWorkspace.SidebarItem
            href={link.href}
            navigation="document"
            active={isActive(props.currentPath, link.href)}
            title={link.label}
          >
            <AppWorkspace.SidebarItemIcon icon={`ti ${link.icon}`} />
            <AppWorkspace.SidebarItemLabel>{link.label}</AppWorkspace.SidebarItemLabel>
          </AppWorkspace.SidebarItem>
        ))}
      </AppWorkspace.SidebarSection>
    ))}
  </>
);

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
