import type { BaseUser, BaseGroup, PaginationResponse } from "@/accounts/contracts";
import { GroupView, Pagination, UserView } from "@valentinkolb/cloud/lib/ui";
import TabToolbar from "./TabToolbar";
import AddMember from "./AddMember.island";
import RemoveMember from "./RemoveMember.island";

type MembersTabProps = {
  users: BaseUser[];
  memberGroups: BaseGroup[];
  pagination: PaginationResponse;
  search: string;
  groupId: string;
  allMemberIds: string[];
  allMemberGroupIds: string[];
  isAdmin: boolean;
  canManage: boolean;
  indirect: boolean;
  /** Direct member user UIDs (only set when indirect=true) */
  directMemberUserUids: string[];
  /** Direct member group IDs (only set when indirect=true) */
  directMemberGroupIds: string[];
  groupHref: (groupId: string) => string;
  pageBaseUrl: string;
  toggleIndirectUrl: string;
};

export default function MembersTab(props: MembersTabProps) {
  const directUserSet = new Set(props.directMemberUserUids);
  const directGroupSet = new Set(props.directMemberGroupIds);

  const hasGroups = props.memberGroups.length > 0;
  const hasUsers = props.users.length > 0;
  const isEmpty = !hasGroups && !hasUsers;

  return (
    <div class="flex flex-col gap-3">
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

      {props.indirect && <div class="info-block-info text-xs">Showing all members including indirect (via child groups).</div>}

      {isEmpty ? (
        <div class="text-center text-sm text-dimmed py-6">
          {props.search ? "No members found matching your search." : "This group has no members."}
        </div>
      ) : (
        <>
          {hasGroups && (
            <div class="flex flex-col gap-1">
              <h3 class="section-label mb-0">Groups</h3>
              <div class="paper overflow-hidden">
                {props.memberGroups.map((group, i) => {
                  const isIndirect = props.indirect && !directGroupSet.has(group.id);
                  return (
                    <div class={`flex items-center gap-3 p-3 ${i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""}`}>
                      <a href={props.groupHref(group.id)} class="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                        <GroupView group={group} />
                      </a>
                      {isIndirect && (
                        <span class="tag bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 shrink-0">indirect</span>
                      )}
                      {props.canManage && !isIndirect && (
                        <RemoveMember groupId={props.groupId} membershipRole="members" type="group" id={group.id} label={group.name} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasUsers && (
            <div class="flex flex-col gap-1">
              <h3 class="section-label mb-0">Users</h3>
              <div class="paper overflow-hidden">
                {props.users.map((user, i) => {
                  const isIndirect = props.indirect && !directUserSet.has(user.uid);
                  return (
                    <div class={`flex items-center gap-3 p-3 ${i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""}`}>
                      {props.isAdmin ? (
                        <a href={`/app/accounts/users/${user.id}`} class="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                          <UserView user={user} />
                        </a>
                      ) : (
                        <div class="flex-1 min-w-0">
                          <UserView user={user} />
                        </div>
                      )}
                      {isIndirect && (
                        <span class="tag bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 shrink-0">indirect</span>
                      )}
                      {props.canManage && !isIndirect && (
                        <RemoveMember groupId={props.groupId} membershipRole="members" type="user" id={user.id} label={user.displayName} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <Pagination currentPage={props.pagination.page} totalPages={props.pagination.total_pages} baseUrl={props.pageBaseUrl} />
    </div>
  );
}
