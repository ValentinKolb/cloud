import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import type { EntityListItem, PaginationResponse } from "@/contracts";
import { getPrimaryAccountBadge, getProviderBadge } from "../../lib/account-badges";
import AddMember from "./AddMember.island";
import RemoveMember from "./RemoveMember.island";
import TabToolbar from "./TabToolbar";

type ManagersTabProps = {
  items: EntityListItem[];
  pagination: PaginationResponse;
  groupId: string;
  groupProvider: "ipa" | "local";
  allManagerIds: string[];
  allManagerGroupIds: string[];
  canManage: boolean;
  isAdmin: boolean;
  groupHref: (groupId: string) => string;
  pageBaseUrl: string;
};

export default function ManagersTab(props: ManagersTabProps) {
  const isEmpty = props.items.length === 0;
  const columns: DataTableColumn<EntityListItem>[] = [
    { id: "type", header: "Type", value: (item) => item.kind, cellClass: "whitespace-nowrap" },
    {
      id: "name",
      header: "Name",
      value: (item) => (item.kind === "user" ? item.user.displayName || item.user.mail || item.user.uid : item.group.name),
    },
    {
      id: "detail",
      header: "Detail",
      value: (item) => (item.kind === "user" ? item.user.mail : item.group.description),
      cellClass: "max-w-[24rem]",
    },
    { id: "access", header: "Access" },
    {
      id: "actions",
      header: "Actions",
      headerClass: "text-right",
      cellClass: "w-10 text-right whitespace-nowrap max-w-none",
    },
  ];
  const rowId = (item: EntityListItem) => (item.kind === "user" ? `user:${item.user.id}` : `group:${item.group.id}`);

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: accounts-group-managers">
      <TabToolbar
        actions={
          props.canManage ? (
            <AddMember
              groupId={props.groupId}
              groupProvider={props.groupProvider}
              membershipRole="managers"
              searchUsers={true}
              searchGroups={props.isAdmin}
              excludeUserIds={props.allManagerIds}
              excludeGroups={props.allManagerGroupIds}
            />
          ) : undefined
        }
      />

      {isEmpty ? (
        <div class="text-center text-sm text-dimmed py-6">This group has no managers.</div>
      ) : (
        <div class="paper overflow-hidden">
          <DataTable
            rows={props.items}
            columns={columns}
            getRowId={rowId}
            hoverRows
            density="compact"
            class="overflow-x-auto"
            scrollPreserveKey="accounts-group-managers-table"
            renderCell={({ row: item, col }) => {
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
                if (col.id === "actions") {
                  return props.canManage ? (
                    <RemoveMember
                      groupId={props.groupId}
                      membershipRole="managers"
                      type="user"
                      id={user.id}
                      label={user.displayName || user.uid}
                    />
                  ) : null;
                }
                return "";
              }

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
              if (col.id === "actions")
                return props.canManage ? (
                  <RemoveMember groupId={props.groupId} membershipRole="managers" type="group" id={group.id} label={group.name} />
                ) : null;
              return "";
            }}
          />
        </div>
      )}

      <Pagination currentPage={props.pagination.page} totalPages={props.pagination.total_pages} baseUrl={props.pageBaseUrl} />
    </div>
  );
}
