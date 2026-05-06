import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { EntitySearch, prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";

type AddToGroupProps = {
  id: string;
  userProvider: "ipa" | "local";
  /** Group IDs the user is already a member of */
  excludeGroups: string[];
};

export default function AddToGroup(props: AddToGroupProps) {
  const mutation = mutations.create<void, string>({
    mutation: async (groupId) => {
      const res = await apiClient.groups[":id"].members.$post({
        param: { id: groupId },
        json: { type: "user", id: props.id },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to add user to group.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = () => {
    prompts.dialog(
      (close) => (
        <EntitySearch
          providers={props.userProvider === "local" ? ["local"] : undefined}
          includeGroups
          excludeGroupIds={props.excludeGroups}
          placeholder="Search groups..."
          disabled={mutation.loading()}
          onSelect={async (result) => {
            if (result.type === "group") {
              close();
              await mutation.mutate(result.groupId);
            }
          }}
        />
      ),
      { title: "Add to Group", icon: "ti ti-users-plus" },
    );
  };

  return (
    <button type="button" class="btn-input btn-input-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class="ti ti-plus" />
      <span>{mutation.loading() ? "Adding..." : "Add"}</span>
    </button>
  );
}
