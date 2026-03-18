import { For, Show } from "solid-js";
import type { BaseUser } from "@/accounts/contracts";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { buildUserDetailUrl, buildUsersPageBaseUrl, buildUsersUrl, type UsersListState } from "../lib/url-state";
import { getPrimaryAccountBadge, getSupplementalRoleColor, getSupplementalRoles } from "../lib/account-badges";
import CreateUserForm from "./new/CreateUserForm.island";
type AccountRequest = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  comment: string | null;
  createdAt: string;
};
type Props = {
  users: BaseUser[];
  total: number;
  perPage: number;
  activeId: string | null;
  pendingRequests: AccountRequest[];
  listState: UsersListState;
  basePath?: string;
  freeIpaEnabled?: boolean;
};
export default function UserSidebar(props: Props) {
  const basePath = props.basePath ?? "/app/accounts/users";
  const totalPages = Math.max(1, Math.ceil(props.total / props.perPage));
  const paginationBaseUrl = buildUsersPageBaseUrl(
    { search: props.listState.search, provider: props.listState.provider, profile: props.listState.profile },
    { basePath },
  );
  return (
    <nav class="flex flex-col h-full">
      <div class="p-2">
        <SearchBar
          action={buildUsersUrl({ ...props.listState, search: "", page: 1 }, { basePath })}
          value={props.listState.search}
        />
      </div>
      <div class="px-3 pb-1 text-[10px] text-dimmed">
        {props.listState.search
          ? `${props.total} result${props.total !== 1 ? "s" : ""}`
          : `${props.total} user${props.total !== 1 ? "s" : ""}`}
      </div>
      <Show when={props.pendingRequests.length > 0}>
        <div class="info-block-warning mx-2 mb-1">
          <h3 class="mb-1 flex items-center gap-1 text-[10px] font-semibold">
            <i class="ti ti-user-plus text-xs" /> {props.pendingRequests.length} pending request
            {props.pendingRequests.length !== 1 ? "s" : ""}
          </h3>
          <div class="flex flex-col">
            <For each={props.pendingRequests}>
              {(req) => (
                <a
                  href={`/app/accounts/users/new?request=${req.id}`}
                  class="flex items-center justify-between py-1 text-[10px] transition-colors hover:text-primary"
                >
                  <span class="truncate">{req.displayName || `${req.firstName} ${req.lastName}`}</span>
                  <i class="ti ti-chevron-right text-[10px] shrink-0 opacity-70" />
                </a>
              )}
            </For>
          </div>
        </div>
      </Show>
      <div class="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <For each={props.users}>
          {(user) => {
            const isActive = user.id === props.activeId;
            return (
              <a
                href={buildUserDetailUrl(user.id, props.listState)}
                class={`list-item text-xs flex-col items-start gap-0.5 py-2 ${isActive ? "list-item-active" : ""}`}
              >
                <span class="font-medium text-primary truncate w-full">{user.displayName}</span>
                <span class="flex items-center gap-1 w-full">
                  <span class="text-dimmed truncate">{user.uid}</span>
                  {(() => {
                    const badge = getPrimaryAccountBadge(user);
                    return <span class={`text-[9px] px-1 py-px rounded shrink-0 ${badge.className}`}>{badge.label}</span>;
                  })()}
                  <For each={getSupplementalRoles(user)}>
                    {(role) => (
                      <span class={`text-[9px] px-1 py-px rounded shrink-0 ${getSupplementalRoleColor(role)}`}>{role}</span>
                    )}
                  </For>
                </span>
                <Show when={user.mail}>
                  <span class="text-[10px] text-dimmed truncate w-full">{user.mail}</span>
                </Show>
              </a>
            );
          }}
        </For>
        <Show when={props.users.length === 0}>
          <div class="px-3 py-4 text-xs text-dimmed text-center">No users found.</div>
        </Show>
      </div>
      <div class="px-2 pb-2">
        <Pagination currentPage={props.listState.page} totalPages={totalPages} baseUrl={paginationBaseUrl} />
      </div>
      <div class="p-2 [&>a]:w-full">
        <CreateUserForm buttonClass="btn-input btn-input-sm flex w-full items-center justify-center gap-1" freeIpaEnabled={props.freeIpaEnabled} />
      </div>
    </nav>
  );
}
