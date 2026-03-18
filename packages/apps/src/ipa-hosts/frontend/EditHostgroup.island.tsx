import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/ipa-hosts/client";
import { refreshCurrentPath } from "./lib/navigation";

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
    onSuccess: () => refreshCurrentPath(),
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
    <button
      type="button"
      class="icon-btn h-6 w-6"
      onClick={handleClick}
      disabled={mutation.loading()}
      aria-label={`Edit hostgroup ${props.cn}`}
    >
      <i class="ti ti-pencil text-sm text-dimmed" />
    </button>
  );
};

export default EditHostgroup;
