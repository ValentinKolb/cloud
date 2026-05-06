import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { EntitySearch, prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

type AddToGroupProps = {
  /** Group id to add to another group */
  groupId: string;
  /** Provider of the current group */
  groupProvider: "ipa" | "local";
  /** IDs to exclude (already member of) */
  excludeGroups?: string[];
};

export default function AddToGroup(props: AddToGroupProps) {
  const mutation = mutations.create<void, { targetGroup: string }>({
    mutation: async (vars) => {
      // Add this group as a member of the target group
      const res = await apiClient.groups[":id"].members.$post({
        param: { id: vars.targetGroup },
        json: { type: "group", id: props.groupId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to add to group.");
      }
    },
    onSuccess: () => {
      refreshCurrentPath();
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const handleClick = () => {
    prompts.dialog(
      (close) => (
        <EntitySearch
          providers={[props.groupProvider]}
          includeGroups
          excludeGroupIds={[...(props.excludeGroups ?? []), props.groupId]}
          placeholder="Search groups..."
          disabled={mutation.loading()}
          onSelect={async (result) => {
            if (result.type === "group") {
              close();
              await mutation.mutate({ targetGroup: result.groupId });
            }
          }}
        />
      ),
      { title: "Add to Group", icon: "ti ti-folder-plus" },
    );
  };

  return (
    <button type="button" class="btn-input btn-input-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class="ti ti-folder-plus" />
      <span>{mutation.loading() ? "Adding..." : "Add to Group"}</span>
    </button>
  );
}
