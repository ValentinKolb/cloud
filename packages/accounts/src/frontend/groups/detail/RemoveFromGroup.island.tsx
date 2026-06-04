import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { RemoveBtn } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";

type RemoveFromGroupProps = {
  /** Group id to remove from parent */
  groupId: string;
  /** Parent group id */
  parentGroupId: string;
  /** Parent group label */
  parentGroupName: string;
};

export default function RemoveFromGroup(props: RemoveFromGroupProps) {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      // Remove this group from the parent group
      const res = await apiClient.groups[":id"].members.$delete({
        param: { id: props.parentGroupId },
        json: { type: "group", id: props.groupId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to remove from group.");
      }
    },
    onSuccess: () => {
      refreshCurrentPath();
    },
    onError: (err) => {
      prompts.error(err.message);
    },
  });

  const handleClick = async () => {
    const confirmed = await prompts.confirm(`Remove this group from "${props.parentGroupName}"?`, {
      title: "Remove from Group",
      icon: "ti ti-folder-minus",
      confirmText: "Remove",
      cancelText: "Cancel",
      variant: "danger",
    });

    if (confirmed) {
      await mutation.mutate();
    }
  };

  return <RemoveBtn ariaLabel={`Remove from ${props.parentGroupName}`} onClick={handleClick} loading={mutation.loading()} />;
}
