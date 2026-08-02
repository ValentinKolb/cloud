import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { IconButton, prompts, Tooltip, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";

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
    onSuccess: () => {
      toast.success("Hostgroup deleted");
      refreshCurrentPath();
    },
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
    <Tooltip content={`Delete hostgroup ${props.cn}`}>
      <IconButton
        size="xs"
        variant="danger"
        label={`Delete hostgroup ${props.cn}`}
        onClick={handleClick}
        loading={mutation.loading()}
        loadingLabel={`Deleting hostgroup ${props.cn}`}
      >
        <i class="ti ti-trash" aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );
};

export default DeleteHostgroup;
