import type { BaseUser, BaseGroup } from "@/accounts/contracts";
import { GroupView, UserView } from "@valentinkolb/cloud/lib/ui";
import TabToolbar from "./TabToolbar";
import AddMember from "./AddMember.island";
import RemoveMember from "./RemoveMember.island";

type ManagersTabProps = {
  managerUsers: BaseUser[];
  managerGroups: BaseGroup[];
  cn: string;
  allManagerIds: string[];
  allManagerGroupCns: string[];
  isAdmin: boolean;
  groupHref: (groupCn: string) => string;
};

export default function ManagersTab(props: ManagersTabProps) {
  const hasUsers = props.managerUsers.length > 0;
  const hasGroups = props.managerGroups.length > 0;
  const isEmpty = !hasUsers && !hasGroups;

  return (
    <div class="flex flex-col gap-3">
      <TabToolbar
        actions={
          props.isAdmin ? (
            <AddMember
              cn={props.cn}
              membershipRole="managers"
              searchUsers={true}
              searchGroups={true}
              excludeUserIds={props.allManagerIds}
              excludeGroups={props.allManagerGroupCns}
            />
          ) : undefined
        }
      />

      {isEmpty ? (
        <div class="text-center text-sm text-dimmed py-6">This group has no managers.</div>
      ) : (
        <>
          {hasGroups && (
            <div class="flex flex-col gap-1">
              <h3 class="section-label mb-0">Groups</h3>
              <div class="paper overflow-hidden">
                {props.managerGroups.map((group, i) => (
                  <div class={`flex items-center gap-3 p-3 ${i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""}`}>
                    <a href={props.groupHref(group.cn)} class="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                      <GroupView group={group} />
                    </a>
                    {props.isAdmin && <RemoveMember cn={props.cn} membershipRole="managers" type="group" id={group.cn} label={group.cn} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasUsers && (
            <div class="flex flex-col gap-1">
              <h3 class="section-label mb-0">Users</h3>
              <div class="paper overflow-hidden">
                {props.managerUsers.map((user, i) => (
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
                    {props.isAdmin && (
                      <RemoveMember cn={props.cn} membershipRole="managers" type="user" id={user.id} label={user.displayName} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
