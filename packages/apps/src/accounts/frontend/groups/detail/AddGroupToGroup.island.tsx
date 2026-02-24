import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { EntitySearch, type EntitySearchResult } from "@valentinkolb/cloud/lib/ui";
import { refreshCurrentPath } from "../../lib/navigation";

type AddToGroupProps = {
  /** Group CN to add to another group */
  cn: string;
  /** CNs to exclude (already member of) */
  excludeGroups?: string[];
};

export default function AddToGroup(props: AddToGroupProps) {
  const mutation = mutations.create<void, { targetGroup: string }>({
    mutation: async (vars) => {
      // Add this group as a member of the target group
      const res = await apiClient.groups[":cn"].members.$post({
        param: { cn: vars.targetGroup },
        json: { type: "group", id: props.cn },
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
          searchUsers={false}
          searchGroups={true}
          excludeGroups={[...(props.excludeGroups ?? []), props.cn]}
          placeholder="Search groups..."
          adding={mutation.loading()}
          onSelect={async (result: EntitySearchResult) => {
            if (result.type === "group") {
              close();
              await mutation.mutate({ targetGroup: result.id });
            }
          }}
        />
      ),
      { title: "Add to Group", icon: "ti ti-folder-plus" },
    );
  };

  return (
    <button type="button" class="btn-secondary btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class="ti ti-folder-plus" />
      <span>{mutation.loading() ? "Adding..." : "Add to Group"}</span>
    </button>
  );
}
