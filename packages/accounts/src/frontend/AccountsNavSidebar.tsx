import { For, Show } from "solid-js";

type ActiveKey = "dashboard" | "users" | "groups" | "requests" | "deleted-accounts" | "reminders" | null;

type Props = {
  active: ActiveKey;
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

const navItemClass = (isActive: boolean) => `sidebar-item text-xs ${isActive ? "sidebar-item-active" : ""}`;
const mobileItemClass = (isActive: boolean) => `sidebar-item-mobile ${isActive ? "sidebar-item-active" : ""}`;

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
    <>
      <nav class="sidebar-container-mobile">
        <details class="group">
          <summary class="sidebar-mobile-toggle">
            <div class="sidebar-header-icon bg-blue-500">
              <i class="ti ti-users-group text-xs" />
            </div>
            <span class="sidebar-header-title">Accounts</span>
            <span class="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-dimmed transition-transform group-open:rotate-180">
              <i class="ti ti-chevron-down text-sm" />
            </span>
          </summary>
          <div class="sidebar-mobile-actions">
            <For each={generalItems()}>
              {(item) => (
                <a href={item.href} class={mobileItemClass(item.active)}>
                  <i class={item.icon} />
                  {item.label}
                  <Show when={item.badge}>
                    <span class="ml-auto text-[10px] text-dimmed">{item.badge}</span>
                  </Show>
                </a>
              )}
            </For>
            <Show when={props.isAdmin}>
              <For each={adminItems()}>
                {(item) => (
                  <a href={item.href} class={mobileItemClass(item.active)}>
                    <i class={item.icon} />
                    {item.label}
                    <Show when={item.badge}>
                      <span class="ml-auto text-[10px] text-dimmed">{item.badge}</span>
                    </Show>
                  </a>
                )}
              </For>
            </Show>
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="paper flex h-full min-h-0 flex-col gap-4 p-3">
          <div class="flex items-center gap-3">
            <div class="sidebar-header-icon bg-blue-500">
              <i class="ti ti-users-group text-xs" />
            </div>
            <p class="sidebar-header-title">Accounts</p>
          </div>

          <div class="sidebar-body">
            <section class="sidebar-group">
              <p class="sidebar-section-title">General</p>
              <For each={generalItems()}>
                {(item) => (
                  <a href={item.href} class={navItemClass(item.active)}>
                    <i class={`${item.icon} text-sm`} />
                    <span class="flex-1">{item.label}</span>
                    <Show when={item.badge}>
                      <span class="text-[10px] text-dimmed">{item.badge}</span>
                    </Show>
                  </a>
                )}
              </For>
            </section>

            <Show when={props.isAdmin}>
              <section class="sidebar-group">
                <p class="sidebar-section-title">Admin</p>
                <For each={adminItems()}>
                  {(item) => (
                    <a href={item.href} class={navItemClass(item.active)}>
                      <i class={`${item.icon} text-sm`} />
                      <span class="flex-1">{item.label}</span>
                      <Show when={item.badge}>
                        <span class="text-[10px] text-dimmed">{item.badge}</span>
                      </Show>
                    </a>
                  )}
                </For>
              </section>
            </Show>
          </div>
        </div>
      </aside>
    </>
  );
}
