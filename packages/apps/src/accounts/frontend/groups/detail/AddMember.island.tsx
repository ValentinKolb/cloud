import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { EntitySearch, type EntitySearchResult } from "@valentinkolb/cloud/lib/ui";
import { refreshCurrentPath } from "../../lib/navigation";

type AddMemberProps = {
  /** Group CN */
  cn: string;
  /** "members" or "managers" */
  membershipRole: "members" | "managers";
  /** Search for users */
  searchUsers?: boolean;
  /** Search for groups */
  searchGroups?: boolean;
  /** User UUIDs to exclude (already members/managers) */
  excludeUserIds?: string[];
  /** CNs to exclude (already members/managers) */
  excludeGroups?: string[];
};

export default function AddMember(props: AddMemberProps) {
  const mutation = mutations.create<void, { type: "user" | "group"; id: string }>({
    mutation: async (vars) => {
      const endpoint = props.membershipRole === "members" ? apiClient.groups[":cn"].members.$post : apiClient.groups[":cn"].managers.$post;
      const res = await endpoint({ param: { cn: props.cn }, json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? `Failed to add ${props.membershipRole.slice(0, -1)}.`);
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = () => {
    const title = props.membershipRole === "members" ? "Add Member" : "Add Manager";
    const icon = props.membershipRole === "members" ? "ti ti-user-plus" : "ti ti-shield-plus";

    prompts.dialog(
      (close) => (
        <EntitySearch
          groupCn={props.cn}
          searchUsers={props.searchUsers !== false}
          searchGroups={props.searchGroups}
          excludeUserIds={props.excludeUserIds}
          excludeGroups={props.excludeGroups}
          placeholder={props.searchGroups ? "Search users or groups..." : "Search users..."}
          adding={mutation.loading()}
          onSelect={async (result: EntitySearchResult) => {
            close();
            await mutation.mutate({ type: result.type, id: result.id });
          }}
        />
      ),
      { title, icon },
    );
  };

  return (
    <button type="button" class="btn-secondary btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class={props.membershipRole === "members" ? "ti ti-user-plus" : "ti ti-shield-plus"} />
      <span>{mutation.loading() ? "Adding..." : "Add"}</span>
    </button>
  );
}
