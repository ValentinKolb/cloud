import { Show } from "solid-js";

type Props = {
  active: "users" | "groups" | "requests" | null;
  isAdmin: boolean;
  pendingRequests: number;
};

const navItemClass = (isActive: boolean) => `sidebar-item text-xs ${isActive ? "sidebar-item-active" : ""}`;

export default function AccountsNavSidebar(props: Props) {
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
            <a href="/me" class="sidebar-item-mobile">
              <i class="ti ti-user" />
              My Profile
            </a>
            <Show when={props.isAdmin}>
              <a href="/app/accounts/requests" class={`sidebar-item-mobile ${props.active === "requests" ? "sidebar-item-active" : ""}`}>
                <i class="ti ti-user-plus" />
                Requests
                <Show when={props.pendingRequests > 0}>
                  <span class="ml-1 text-[10px] text-dimmed">({props.pendingRequests})</span>
                </Show>
              </a>
            </Show>
            <Show when={props.isAdmin}>
              <a href="/app/accounts/users" class={`sidebar-item-mobile ${props.active === "users" ? "sidebar-item-active" : ""}`}>
                <i class="ti ti-users" />
                Users
              </a>
            </Show>
            <a href="/app/accounts/groups" class={`sidebar-item-mobile ${props.active === "groups" ? "sidebar-item-active" : ""}`}>
              <i class="ti ti-users-group" />
              Groups
            </a>
          </div>
        </details>
      </nav>

      <aside class="sidebar-container">
        <div class="sidebar-header">
          <div class="sidebar-header-icon bg-blue-500">
            <i class="ti ti-users-group text-xs" />
          </div>
          <div class="sidebar-header-text">
            <p class="sidebar-header-title">Accounts</p>
          </div>
        </div>

        <div class="sidebar-body mt-2">
          <section class="sidebar-group">
            <p class="sidebar-section-title">Navigation</p>
            <a href="/me" class="sidebar-item text-xs">
              <i class="ti ti-user text-sm" />
              <span>My Profile</span>
            </a>
            <Show when={props.isAdmin}>
              <a href="/app/accounts/requests" class={navItemClass(props.active === "requests")}>
                <i class="ti ti-user-plus text-sm" />
                <span class="flex-1">Requests</span>
                <Show when={props.pendingRequests > 0}>
                  <span class="text-[10px] text-dimmed">{props.pendingRequests}</span>
                </Show>
              </a>
            </Show>
            <Show when={props.isAdmin}>
              <a href="/app/accounts/users" class={navItemClass(props.active === "users")}>
                <i class="ti ti-users text-sm" />
                <span>Users</span>
              </a>
            </Show>
            <a href="/app/accounts/groups" class={navItemClass(props.active === "groups")}>
              <i class="ti ti-users-group text-sm" />
              <span>Groups</span>
            </a>
          </section>
        </div>
      </aside>
    </>
  );
}
