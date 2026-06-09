import { AppWorkspace } from "@valentinkolb/cloud/ui";

export type AccountsNavActiveKey =
  | "dashboard"
  | "users"
  | "groups"
  | "requests"
  | "audit"
  | "service-accounts"
  | "deleted-accounts"
  | "reminders"
  | null;

type Props = {
  active: AccountsNavActiveKey;
  isAdmin: boolean;
  pendingRequests: number;
};

type NavItem = {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  badge?: string;
};

const renderItem = (item: NavItem) => (
  <AppWorkspace.SidebarItem
    href={item.href}
    icon={item.icon}
    active={item.active}
    navigation="document"
    meta={item.badge ? <span class="text-[10px] text-dimmed">{item.badge}</span> : undefined}
  >
    {item.label}
  </AppWorkspace.SidebarItem>
);

export default function AccountsNavSidebar(props: Props) {
  const generalItems = (): NavItem[] => [
    { href: "/app/accounts", icon: "ti ti-layout-dashboard", label: "Dashboard", active: props.active === "dashboard" },
    { href: "/app/accounts/groups", icon: "ti ti-users-group", label: "Groups", active: props.active === "groups" },
  ];

  const adminItems = (): NavItem[] => [
    {
      href: "/app/accounts/requests",
      icon: "ti ti-user-plus",
      label: "Requests",
      active: props.active === "requests",
      badge: props.pendingRequests > 0 ? String(props.pendingRequests) : undefined,
    },
    { href: "/app/accounts/users", icon: "ti ti-users", label: "Users", active: props.active === "users" },
    {
      href: "/app/accounts/service-accounts",
      icon: "ti ti-user-key",
      label: "Service Accounts",
      active: props.active === "service-accounts",
    },
    { href: "/app/accounts/audit", icon: "ti ti-clipboard-list", label: "Audit Log", active: props.active === "audit" },
    {
      href: "/app/accounts/deleted-accounts",
      icon: "ti ti-user-off",
      label: "Deleted Accounts",
      active: props.active === "deleted-accounts",
    },
    {
      href: "/app/accounts/reminders",
      icon: "ti ti-mail-share",
      label: "Reminder History",
      active: props.active === "reminders",
    },
  ];

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader title="Accounts" icon="ti ti-users-group" iconStyle="background-color:#3b82f6" />
      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileItems scrollPreserveKey="accounts-sidebar-mobile">
          {generalItems().map(renderItem)}
          {props.isAdmin ? adminItems().map(renderItem) : null}
        </AppWorkspace.SidebarMobileItems>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarBody scrollPreserveKey="accounts-sidebar">
          <AppWorkspace.SidebarSection title="General">{generalItems().map(renderItem)}</AppWorkspace.SidebarSection>
          {props.isAdmin ? <AppWorkspace.SidebarSection title="Admin">{adminItems().map(renderItem)}</AppWorkspace.SidebarSection> : null}
        </AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}
