import type { BaseGroup } from "@/accounts/contracts";
import { GroupView } from "@valentinkolb/cloud/lib/ui";
import AddGroupToGroup from "./AddGroupToGroup.island";
import RemoveFromGroup from "./RemoveFromGroup.island";

type MemberOfTabProps = {
  groupId: string;
  parentGroups: BaseGroup[];
  allParentGroupIds: string[];
  isAdmin: boolean;
  groupHref: (groupId: string) => string;
};

export default function MemberOfTab(props: MemberOfTabProps) {
  const hasGroups = props.parentGroups.length > 0;

  return (
    <div class="flex flex-col gap-3">
      {props.isAdmin && (
        <div class="flex justify-end">
          <AddGroupToGroup groupId={props.groupId} excludeGroups={props.allParentGroupIds} />
        </div>
      )}

      {!hasGroups ? (
        <div class="text-center text-sm text-dimmed py-6">This group is not a member of any other group.</div>
      ) : (
        <div class="flex flex-col gap-1">
          <h3 class="section-label mb-0">Parent Groups</h3>
          <div class="paper overflow-hidden">
            {props.parentGroups.map((group, i) => (
              <div class={`flex items-center gap-3 p-3 ${i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""}`}>
                <a href={props.groupHref(group.id)} class="flex-1 min-w-0 hover:opacity-80 transition-opacity">
                  <GroupView group={group} />
                </a>
                {props.isAdmin && <RemoveFromGroup groupId={props.groupId} parentGroupId={group.id} parentGroupName={group.name} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
