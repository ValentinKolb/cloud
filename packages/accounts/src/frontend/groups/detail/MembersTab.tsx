import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import type { EntityListItem, PaginationResponse } from "@/contracts";
import { getPrimaryAccountBadge, getProviderBadge } from "../../lib/account-badges";
import AddMember from "./AddMember.island";
import RemoveMember from "./RemoveMember.island";
import TabToolbar from "./TabToolbar";

type MembersTabProps = {
  items: EntityListItem[];
  pagination: PaginationResponse;
  search: string;
  groupId: string;
  groupProvider: "ipa" | "local";
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
  const columns: DataTableColumn<EntityListItem>[] = [
    { id: "type", header: "Type", value: (item) => item.kind, cellClass: "whitespace-nowrap" },
    {
      id: "name",
      header: "Name",
      value: (item) =>
        item.kind === "user" ? item.user.displayName || item.user.mail || item.user.uid : item.kind === "group" ? item.group.name : item.serviceAccount.name,
    },
    {
      id: "detail",
      header: "Detail",
      value: (item) => (item.kind === "user" ? item.user.mail : item.kind === "group" ? item.group.description : item.serviceAccount.appId),
      cellClass: "max-w-[24rem]",
    },
    { id: "access", header: "Access" },
    { id: "membership", header: "Membership" },
    {
      id: "actions",
      header: "Actions",
      headerClass: "text-right",
      cellClass: "w-10 text-right whitespace-nowrap max-w-none",
    },
  ];
  const rowId = (item: EntityListItem) =>
    item.kind === "user" ? `user:${item.user.id}` : item.kind === "group" ? `group:${item.group.id}` : `service_account:${item.serviceAccount.id}`;

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: accounts-group-members">
      <TabToolbar
        indirectToggleUrl={props.toggleIndirectUrl}
        indirect={props.indirect}
        actions={
          props.canManage ? (
            <AddMember
              groupId={props.groupId}
              groupProvider={props.groupProvider}
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
          <DataTable
            rows={props.items}
            columns={columns}
            getRowId={rowId}
            hoverRows
            density="compact"
            class="overflow-x-auto"
            scrollPreserveKey="accounts-group-members-table"
            renderCell={({ row: item, col }) => {
              const isIndirect = item.relation?.direct === false;
              const membershipClass = isIndirect
                ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
              if (item.kind === "user") {
                const user = item.user;
                const accessBadge = getPrimaryAccountBadge(user);
                const href = props.isAdmin ? `/app/accounts/users/${user.id}` : undefined;
                if (col.id === "type") return <span class="text-dimmed">User</span>;
                if (col.id === "name") {
                  const label = `${user.displayName || user.mail || user.uid} (${user.uid})`;
                  return href ? (
                    <a href={href} class="block truncate font-medium text-primary hover:underline">
                      {label}
                    </a>
                  ) : (
                    <span class="truncate font-medium text-primary">{label}</span>
                  );
                }
                if (col.id === "detail") {
                  const value = user.mail || "-";
                  return href ? (
                    <a href={href} class="block truncate text-dimmed" tabindex={-1} title={value}>
                      {value}
                    </a>
                  ) : (
                    <span class="truncate text-dimmed" title={value}>
                      {value}
                    </span>
                  );
                }
                if (col.id === "access")
                  return <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${accessBadge.className}`}>{accessBadge.label}</span>;
                if (col.id === "membership")
                  return (
                    <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${membershipClass}`}>
                      {isIndirect ? "Indirect" : "Direct"}
                    </span>
                  );
                if (col.id === "actions") {
                  return props.canManage && !isIndirect ? (
                    <RemoveMember
                      groupId={props.groupId}
                      membershipRole="members"
                      type="user"
                      id={user.id}
                      label={user.displayName || user.uid}
                    />
                  ) : null;
                }
                return "";
              }

              if (item.kind === "service_account") return "";

              const group = item.group;
              const providerBadge = getProviderBadge(group.provider);
              const href = props.groupHref(group.id);
              if (col.id === "type") return <span class="text-dimmed">Group</span>;
              if (col.id === "name")
                return (
                  <a href={href} class="block truncate font-medium text-primary hover:underline">
                    {group.name}
                  </a>
                );
              if (col.id === "detail") {
                return (
                  <a href={href} class="block truncate text-dimmed" tabindex={-1} title={group.description || "No description"}>
                    {group.description || <span class="italic">No description</span>}
                  </a>
                );
              }
              if (col.id === "access")
                return (
                  <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>{providerBadge.label}</span>
                );
              if (col.id === "membership")
                return (
                  <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${membershipClass}`}>
                    {isIndirect ? "Indirect" : "Direct"}
                  </span>
                );
              if (col.id === "actions") {
                return props.canManage && !isIndirect ? (
                  <RemoveMember groupId={props.groupId} membershipRole="members" type="group" id={group.id} label={group.name} />
                ) : null;
              }
              return "";
            }}
          />
        </div>
      )}

      <Pagination currentPage={props.pagination.page} totalPages={props.pagination.total_pages} baseUrl={props.pageBaseUrl} />
    </div>
  );
}
