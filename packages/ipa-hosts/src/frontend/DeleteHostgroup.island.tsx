import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { prompts } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import { refreshCurrentPath } from "@valentinkolb/cloud/ui";

type DeleteHostgroupProps = {
  cn: string;
};

const DeleteHostgroup = (props: DeleteHostgroupProps) => {
  const mutation = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.hostgroups[":cn"].$delete({
        param: { cn: props.cn },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to delete hostgroup.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const confirmed = await prompts.confirm(`Are you sure you want to delete hostgroup "${props.cn}"? This cannot be undone.`, {
      title: "Delete Hostgroup",
      icon: "ti ti-trash",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (confirmed) {
      await mutation.mutate();
    }
  };

  return (
    <button
      type="button"
      class="icon-btn h-6 w-6"
      onClick={handleClick}
      disabled={mutation.loading()}
      aria-label={`Delete hostgroup ${props.cn}`}
    >
      <i class="ti ti-trash text-sm text-red-500" />
    </button>
  );
};

export default DeleteHostgroup;
