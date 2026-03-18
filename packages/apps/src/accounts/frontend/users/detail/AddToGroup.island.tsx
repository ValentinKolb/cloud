import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { EntitySearch, type EntitySearchResult } from "@valentinkolb/cloud/lib/ui";
import { refreshCurrentPath } from "../../lib/navigation";

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
          apiBaseUrl="/api/accounts"
          groupProvider={props.userProvider === "local" ? "local" : undefined}
          searchUsers={false}
          searchGroups={true}
          excludeGroups={props.excludeGroups}
          placeholder="Search groups..."
          adding={mutation.loading()}
          onSelect={async (result: EntitySearchResult) => {
            close();
            await mutation.mutate(result.id);
          }}
        />
      ),
      { title: "Add to Group", icon: "ti ti-users-plus" },
    );
  };

  return (
    <button type="button" class="btn-secondary btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class="ti ti-plus" />
      <span>{mutation.loading() ? "Adding..." : "Add"}</span>
    </button>
  );
}
