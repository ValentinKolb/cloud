import type { EntityListItem, PaginationResponse } from "@/accounts/contracts";
import { Pagination } from "@valentinkolb/cloud/lib/ui";
import TabToolbar from "./TabToolbar";
import AddGroupToGroup from "./AddGroupToGroup.island";
import RemoveFromGroup from "./RemoveFromGroup.island";
import { getProviderBadge } from "../../lib/account-badges";

type MemberOfTabProps = {
  groupId: string;
  groupProvider: "ipa" | "local";
  items: EntityListItem[];
  allParentGroupIds: string[];
  isAdmin: boolean;
  groupHref: (groupId: string) => string;
  pagination: PaginationResponse;
  pageBaseUrl: string;
};

export default function MemberOfTab(props: MemberOfTabProps) {
  const hasGroups = props.items.length > 0;

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: accounts-group-member-of">
      <TabToolbar
        actions={
          props.isAdmin ? <AddGroupToGroup groupId={props.groupId} groupProvider={props.groupProvider} excludeGroups={props.allParentGroupIds} /> : undefined
        }
      />

      {!hasGroups ? (
        <div class="text-center text-sm text-dimmed py-6">This group is not a member of any other group.</div>
      ) : (
        <div class="paper overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-zinc-100 dark:border-zinc-800">
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Group</th>
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Description</th>
                  <th class="px-3 py-1.5 text-left font-medium text-dimmed align-middle">Provider</th>
                  <th class="px-2 py-1.5 text-right font-medium text-dimmed align-middle">Actions</th>
                </tr>
              </thead>
              <tbody>
                {props.items.map((item) => {
                    if (item.kind !== "group") return null;
                    const group = item.group;
                    const providerBadge = getProviderBadge(group.provider);
                    return (
                      <tr class="border-b border-zinc-50 dark:border-zinc-800/50">
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
                        <td class="w-10 p-0 text-right align-middle">
                          <div class="flex items-center justify-end px-2 py-1">
                            {props.isAdmin ? <RemoveFromGroup groupId={props.groupId} parentGroupId={group.id} parentGroupName={group.name} /> : null}
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
