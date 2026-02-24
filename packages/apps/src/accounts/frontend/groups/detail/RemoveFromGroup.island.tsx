import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/accounts/client";
import { RemoveBtn } from "@valentinkolb/cloud/lib/ui";
import { refreshCurrentPath } from "../../lib/navigation";

type RemoveFromGroupProps = {
  /** Group CN to remove from parent */
  cn: string;
  /** Parent group CN */
  parentCn: string;
};

export default function RemoveFromGroup(props: RemoveFromGroupProps) {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      // Remove this group from the parent group
      const res = await apiClient.groups[":cn"].members.$delete({
        param: { cn: props.parentCn },
        json: { type: "group", id: props.cn },
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
    const confirmed = await prompts.confirm(`Remove this group from "${props.parentCn}"?`, {
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

  return <RemoveBtn ariaLabel={`Remove from ${props.parentCn}`} onClick={handleClick} loading={mutation.loading()} />;
}
