import type { EntityListItem, PaginationResponse } from "@/accounts/contracts";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import TabToolbar from "./TabToolbar";
import AddMember from "./AddMember.island";
import RemoveMember from "./RemoveMember.island";
import { getPrimaryAccountBadge, getProviderBadge } from "../../lib/account-badges";

type MembersTabProps = {
  items: EntityListItem[];
  pagination: PaginationResponse;
  search: string;
  groupId: string;
  allMemberIds: string[];
  allMemberGroupIds: string[];
  isAdmin: boolean;
  canManage: boolean;
  indirect: boolean;
  groupHref: (groupId: string) => string;
  pageBaseUrl: string;
  toggleIndirectUrl: string;
};

export default function MembersTab(props: MembersTabProps) {
  const isEmpty = props.items.length === 0;

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: accounts-group-members">
      <TabToolbar
        indirectToggleUrl={props.toggleIndirectUrl}
        indirect={props.indirect}
        actions={
          props.canManage ? (
            <AddMember
              groupId={props.groupId}
              membershipRole="members"
              searchUsers={true}
              searchGroups={props.isAdmin}
              excludeUserIds={props.allMemberIds}
              excludeGroups={props.allMemberGroupIds}
            />
          ) : undefined
        }
      />

      {props.indirect && <p class="text-xs text-dimmed">Showing all members including indirect memberships via child groups.</p>}

      {isEmpty ? (
        <div class="text-center text-sm text-dimmed py-6">
          {props.search ? "No members found matching your search." : "This group has no members."}
        </div>
      ) : (
        <div class="paper overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-zinc-100 dark:border-zinc-800">
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Type</th>
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Name</th>
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Detail</th>
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Access</th>
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Membership</th>
                  <th class="px-2 py-1.5 text-right font-medium text-dimmed align-middle">Actions</th>
                </tr>
              </thead>
              <tbody>
                {props.items.map((item) => {
                    if (item.kind === "user") {
                      const user = item.user;
                      const accessBadge = getPrimaryAccountBadge(user);
                      const href = props.isAdmin ? `/app/accounts/users/${user.id}` : undefined;
                      const isIndirect = item.relation?.direct === false;
                      return (
                        <tr class="border-b border-zinc-50 dark:border-zinc-800/50">
                          <td class="px-3 py-1 text-dimmed align-middle">User</td>
                          <td class="p-0">
                            {href ? (
                              <a href={href} class="group block px-3 py-1 font-medium text-primary">
                                <span class="truncate group-hover:underline">{user.displayName || user.mail || user.uid} ({user.uid})</span>
                              </a>
                            ) : (
                              <div class="truncate px-3 py-1 font-medium text-primary">{user.displayName || user.mail || user.uid} ({user.uid})</div>
                            )}
                          </td>
                          <td class="max-w-[20rem] p-0 text-dimmed">
                            {href ? (
                              <a href={href} class="block truncate px-3 py-1" tabindex={-1} title={user.mail || "-"}>
                                {user.mail || "-"}
                              </a>
                            ) : (
                              <div class="truncate px-3 py-1" title={user.mail || "-"}>{user.mail || "-"}</div>
                            )}
                          </td>
                          <td class="p-0">
                            {href ? (
                              <a href={href} class="block px-3 py-1" tabindex={-1}>
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${accessBadge.className}`}>{accessBadge.label}</span>
                              </a>
                            ) : (
                              <div class="px-3 py-1">
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${accessBadge.className}`}>{accessBadge.label}</span>
                              </div>
                            )}
                          </td>
                          <td class="p-0">
                            {href ? (
                              <a href={href} class="block px-3 py-1" tabindex={-1}>
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isIndirect ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}>
                                  {isIndirect ? "Indirect" : "Direct"}
                                </span>
                              </a>
                            ) : (
                              <div class="px-3 py-1">
                                <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isIndirect ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}>
                                  {isIndirect ? "Indirect" : "Direct"}
                                </span>
                              </div>
                            )}
                          </td>
                          <td class="w-10 p-0 text-right align-middle">
                            <div class="flex items-center justify-end px-2 py-1">
                              {props.canManage && !isIndirect ? (
                                <RemoveMember groupId={props.groupId} membershipRole="members" type="user" id={user.id} label={user.displayName || user.uid} />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const group = item.group;
                    const isIndirect = item.relation?.direct === false;
                    const providerBadge = getProviderBadge(group.provider);
                    return (
                      <tr class="border-b border-zinc-50 dark:border-zinc-800/50">
                        <td class="px-3 py-1 text-dimmed align-middle">Group</td>
                        <td class="p-0">
                          <a href={props.groupHref(group.id)} class="group block px-3 py-1 font-medium text-primary">
                            <span class="truncate group-hover:underline">{group.name}</span>
                          </a>
                        </td>
                        <td class="max-w-[24rem] p-0 text-dimmed">
                          <a href={props.groupHref(group.id)} class="block truncate px-3 py-1" tabindex={-1} title={group.description || "No description"}>
                            {group.description || <span class="italic">No description</span>}
                          </a>
                        </td>
                        <td class="p-0">
                          <a href={props.groupHref(group.id)} class="block px-3 py-1" tabindex={-1}>
                            <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>{providerBadge.label}</span>
                          </a>
                        </td>
                        <td class="p-0">
                          <a href={props.groupHref(group.id)} class="block px-3 py-1" tabindex={-1}>
                            <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isIndirect ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}>
                              {isIndirect ? "Indirect" : "Direct"}
                            </span>
                          </a>
                        </td>
                        <td class="w-10 p-0 text-right align-middle">
                          <div class="flex items-center justify-end px-2 py-1">
                            {props.canManage && !isIndirect ? (
                              <RemoveMember groupId={props.groupId} membershipRole="members" type="group" id={group.id} label={group.name} />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Pagination currentPage={props.pagination.page} totalPages={props.pagination.total_pages} baseUrl={props.pageBaseUrl} />
    </div>
  );
}
