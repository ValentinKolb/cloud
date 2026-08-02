import { refreshCurrentPath } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, prompts, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";

const NewHostgroup = () => {
  const mutation = mutations.create<void, { name: string; description?: string }>({
    mutation: async (vars) => {
      const res = await apiClient.hostgroups.$post({ json: vars });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Failed to create hostgroup.");
      }
    },
    onSuccess: () => {
      toast.success("Hostgroup created");
      refreshCurrentPath();
    },
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
    <Button size="sm" variant="secondary" onClick={handleClick} loading={mutation.loading()} loadingLabel="Creating hostgroup">
      <i class="ti ti-plus" aria-hidden="true" />
      New Hostgroup
    </Button>
  );
};

export default NewHostgroup;
