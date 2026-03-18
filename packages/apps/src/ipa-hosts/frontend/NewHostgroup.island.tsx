import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { apiClient } from "@/ipa-hosts/client";
import { refreshCurrentPath } from "./lib/navigation";

const NewHostgroup = () => {
  const mutation = mutations.create<void, { name: string; description?: string }>({
    mutation: async (vars) => {
      const res = await apiClient.hostgroups.$post({ json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to create hostgroup.");
      }
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (err) => prompts.error(err.message),
  });

  const handleClick = async () => {
    const result = await prompts.form({
      title: "New Hostgroup",
      icon: "ti ti-plus",
      confirmText: "Create",
      fields: {
        name: {
          type: "text" as const,
          label: "Name",
          placeholder: "e.g. webservers",
          required: true,
        },
        description: {
          type: "text" as const,
          label: "Description",
          placeholder: "Optional description...",
        },
      },
    });
    if (result?.name) {
      await mutation.mutate({
        name: result.name,
        description: result.description,
      });
    }
  };

  return (
    <button type="button" class="btn-simple btn-sm" onClick={handleClick} disabled={mutation.loading()}>
      <i class="ti ti-plus" />
      New Hostgroup
    </button>
  );
};

export default NewHostgroup;
