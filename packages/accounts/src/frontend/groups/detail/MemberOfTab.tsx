import { DataTable, type DataTableColumn, Pagination } from "@valentinkolb/cloud/ui";
import type { EntityListItem, PaginationResponse } from "@/contracts";
import { getProviderBadge } from "../../lib/account-badges";
import AddGroupToGroup from "./AddGroupToGroup.island";
import RemoveFromGroup from "./RemoveFromGroup.island";
import TabToolbar from "./TabToolbar";

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
  const columns: DataTableColumn<EntityListItem>[] = [
    { id: "group", header: "Group", value: (item) => (item.kind === "group" ? item.group.name : "") },
    {
      id: "description",
      header: "Description",
      value: (item) => (item.kind === "group" ? item.group.description : ""),
      cellClass: "max-w-[24rem]",
    },
    { id: "provider", header: "Provider", value: (item) => (item.kind === "group" ? item.group.provider : "") },
    {
      id: "actions",
      header: "Actions",
      headerClass: "text-right",
      cellClass: "w-10 text-right whitespace-nowrap max-w-none",
    },
  ];

  return (
    <div class="flex flex-col gap-2" style="view-transition-name: accounts-group-member-of">
      <TabToolbar
        actions={
          props.isAdmin ? (
            <AddGroupToGroup groupId={props.groupId} groupProvider={props.groupProvider} excludeGroups={props.allParentGroupIds} />
          ) : undefined
        }
      />

      {!hasGroups ? (
        <div class="text-center text-sm text-dimmed py-6">This group is not a member of any other group.</div>
      ) : (
        <div class="paper overflow-hidden">
          <DataTable
            rows={props.items}
            columns={columns}
            getRowId={(item) => (item.kind === "group" ? item.group.id : "unknown")}
            hoverRows
            density="compact"
            class="overflow-x-auto"
            scrollPreserveKey="accounts-group-member-of-table"
            renderCell={({ row: item, col }) => {
              if (item.kind !== "group") return "";
              const group = item.group;
              const href = props.groupHref(group.id);
              const providerBadge = getProviderBadge(group.provider);
              if (col.id === "group")
                return (
                  <a href={href} class="block truncate font-medium text-primary hover:underline">
                    {group.name}
                  </a>
                );
              if (col.id === "description") {
                return (
                  <a href={href} class="block truncate text-dimmed" tabindex={-1} title={group.description || "No description"}>
                    {group.description || <span class="italic">No description</span>}
                  </a>
                );
              }
              if (col.id === "provider")
                return (
                  <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${providerBadge.className}`}>{providerBadge.label}</span>
                );
              if (col.id === "actions")
                return props.isAdmin ? (
                  <RemoveFromGroup groupId={props.groupId} parentGroupId={group.id} parentGroupName={group.name} />
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
