import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { IconButton, prompts, Tooltip, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";

type Props = {
  cn: string;
  description: string | null;
};

const EditHostgroup = (props: Props) => {
  const mutation = mutations.create<void, { description?: string }>({
    mutation: async (vars) => {
      const res = await apiClient.hostgroups[":cn"].$patch({
        param: { cn: props.cn },
        json: vars,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to update hostgroup.");
      }
    },
    onSuccess: () => {
      toast.success("Hostgroup updated");
      refreshCurrentPath();
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: `Edit ${props.cn}`,
      icon: "ti ti-pencil",
      confirmText: "Save",
      fields: {
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Optional description...",
          default: props.description ?? "",
        },
      },
    });
    if (result) {
      await mutation.mutate({ description: result.description ?? "" });
    }
  };

  return (
    <Tooltip content={`Edit hostgroup ${props.cn}`}>
      <IconButton
        size="xs"
        label={`Edit hostgroup ${props.cn}`}
        onClick={handleClick}
        loading={mutation.loading()}
        loadingLabel={`Editing hostgroup ${props.cn}`}
      >
        <i class="ti ti-pencil" aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );
};

export default EditHostgroup;
