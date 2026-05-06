import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { EntitySearch, prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

type AddMemberProps = {
  /** Group id */
  groupId: string;
  /** Provider of the current group */
  groupProvider: "ipa" | "local";
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
      const endpoint = props.membershipRole === "members" ? apiClient.groups[":id"].members.$post : apiClient.groups[":id"].managers.$post;
      const res = await endpoint({ param: { id: props.groupId }, json: vars });
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
          providers={[props.groupProvider]}
          includeUsers={props.searchUsers !== false}
          includeGroups={props.searchGroups}
          excludeUserIds={props.excludeUserIds}
          excludeGroupIds={props.excludeGroups}
          placeholder={props.searchGroups ? "Search users or groups..." : "Search users..."}
          disabled={mutation.loading()}
          onSelect={async (result) => {
            close();
            if (result.type === "user") await mutation.mutate({ type: "user", id: result.userId });
            else if (result.type === "group") await mutation.mutate({ type: "group", id: result.groupId });
          }}
        />
      ),
      { title, icon },
    );
  };

  return (
    <button type="button" class="btn-input btn-input-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class={props.membershipRole === "members" ? "ti ti-user-plus" : "ti ti-shield-plus"} />
      <span>{mutation.loading() ? "Adding..." : "Add"}</span>
    </button>
  );
}
