import { apiClient } from "@/notebooks/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { setLastNotebookId } from "./[id]/_components/settings/NotebookSettingsStore";

type CreatedNotebook = {
  id: string;
};

const CreateNotebookButton = () => {
  const mutation = mutations.create<CreatedNotebook, { name: string; description?: string }>({
    mutation: async (data: { name: string; description?: string }) => {
      const res = await apiClient.index.$post({ json: data });
      if (!res.ok) {
        const body = await res.json();
        throw new Error("message" in body ? body.message : "Failed");
      }
      return (await res.json()) as CreatedNotebook;
    },
    onSuccess: (data) => {
      setLastNotebookId(data.id);
      window.location.href = `/app/notebooks/${data.id}`;
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = async () => {
    const result = await prompts.form({
      title: "New Notebook",
      icon: "ti ti-notebook",
      fields: {
        name: { type: "text" as const, label: "Name", required: true, placeholder: "Notebook name" },
        description: { type: "text" as const, label: "Description", multiline: true, placeholder: "Optional description" },
      },
    });
    if (result) mutation.mutate(result);
  };

  return (
    <button class="btn-primary btn-sm inline-flex items-center gap-2" disabled={mutation.loading()} onClick={handleCreate}>
      {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-plus" />}
      New Notebook
    </button>
  );
};

export default CreateNotebookButton;
