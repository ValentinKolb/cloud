import { For, Show } from "solid-js";
import type { BaseUser } from "@/accounts/contracts";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import { SearchBar } from "@valentinkolb/cloud/lib/islands";
import { buildUserDetailUrl, buildUsersPageBaseUrl, type UsersListState } from "../lib/url-state";
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
};
const ROLE_COLORS: Record<string, string> = {
  admin: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300",
  ipa: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
  "ipa-limited": "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300",
  "group-manager": "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300",
  guest: "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300",
};
export default function UserSidebar(props: Props) {
  const basePath = props.basePath ?? "/app/accounts/users";
  const totalPages = Math.max(1, Math.ceil(props.total / props.perPage));
  const paginationBaseUrl = buildUsersPageBaseUrl({ search: props.listState.search }, { basePath });
  return (
    <nav class="flex flex-col h-full">
      <div class="p-2">
        <SearchBar action={basePath} value={props.listState.search} />
      </div>
      <div class="px-3 pb-1 text-[10px] text-dimmed">
        {props.listState.search
          ? `${props.total} result${props.total !== 1 ? "s" : ""}`
          : `${props.total} user${props.total !== 1 ? "s" : ""}`}
      </div>
      <Show when={props.pendingRequests.length > 0}>
        <div class="mx-2 mb-1 p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <h3 class="text-[10px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1 mb-1">
            <i class="ti ti-user-plus text-xs" /> {props.pendingRequests.length} pending request
            {props.pendingRequests.length !== 1 ? "s" : ""}
          </h3>
          <div class="flex flex-col">
            <For each={props.pendingRequests}>
              {(req) => (
                <a
                  href={`/app/accounts/users/new?request=${req.id}`}
                  class="flex items-center justify-between py-1 text-[10px] hover:text-amber-800 dark:hover:text-amber-300 transition-colors"
                >
                  <span class="truncate text-amber-700 dark:text-amber-400">{req.displayName || `${req.firstName} ${req.lastName}`}</span>
                  <i class="ti ti-chevron-right text-amber-400 text-[10px] shrink-0" />
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
                  <For each={user.roles}>
                    {(role) => (
                      <span class={`text-[9px] px-1 py-px rounded shrink-0 ${ROLE_COLORS[role] ?? ROLE_COLORS.guest}`}>{role}</span>
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
        <a href="/app/accounts/users/new" class="btn-secondary btn-sm flex items-center justify-center gap-1">
          <i class="ti ti-plus" /> New User
        </a>
      </div>
    </nav>
  );
}
