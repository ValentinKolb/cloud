import { apiClient } from "@/notebooks/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { buildNoteUrl } from "../../../params";

type Props = {
  notebookId: string;
  variant?: "compact";
};

type CreateNoteResult = {
  id: string;
};

const CreateNoteButton = (props: Props) => {
  const mutation = mutations.create<CreateNoteResult, { title: string }>({
    mutation: async (data: { title: string }) => {
      const res = await apiClient[":id"].notes.$post({
        param: { id: props.notebookId },
        json: data,
      });
      if (!res.ok) throw new Error("Failed to create page");
      return (await res.json()) as CreateNoteResult;
    },
    onSuccess: (data) => {
      window.location.href = buildNoteUrl(props.notebookId, data.id);
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = async () => {
    const result = await prompts.form({
      title: "New Page",
      icon: "ti ti-file-plus",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          placeholder: "Page title",
        },
      },
    });
    if (result) mutation.mutate(result);
  };

  if (props.variant === "compact") {
    return (
      <button type="button" onClick={handleCreate} disabled={mutation.loading()} class="p-1.5 text-dimmed hover:text-primary">
        <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-file-plus"}`} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCreate}
      disabled={mutation.loading()}
      class="paper btn-md border-emerald-200/50 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-900/10"
    >
      {mutation.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-file-plus mr-1 text-emerald-600 dark:text-emerald-400" />
          <span class="text-emerald-700 dark:text-emerald-300">New Page</span>
        </>
      )}
    </button>
  );
};

export default CreateNoteButton;
