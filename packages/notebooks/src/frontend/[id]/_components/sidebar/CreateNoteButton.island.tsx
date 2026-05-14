import { apiClient } from "@/api/client";
import { prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { buildNoteUrl } from "../../../params";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";

type Props = {
  notebookId: string;
  variant?: "compact" | "chip" | "sidebar";
};

type CreateNoteResult = {
  id: string;
  shortId: string;
};

const CreateNoteButton = (props: Props) => {
  const mutation = mutations.create<CreateNoteResult, { title: string }>({
    mutation: async (data: { title: string }) => {
      const res = await apiClient[":id"].notes.$post({
        param: { id: props.notebookId },
        json: data,
      });
      if (!res.ok) throw new Error("Failed to create note");
      return (await res.json()) as CreateNoteResult;
    },
    onSuccess: (data) => {
      void navigateToNotebookNote(buildNoteUrl(props.notebookId, data.shortId));
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = async () => {
    const result = await prompts.form({
      title: "New Note",
      icon: "ti ti-file-plus",
      fields: {
        title: {
          type: "text" as const,
          label: "Title",
          required: true,
          placeholder: "Note title",
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

  if (props.variant === "chip") {
    return (
      <button type="button" onClick={handleCreate} disabled={mutation.loading()} class="btn-primary btn-sm">
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-plus" />
            <span>New Note</span>
          </>
        )}
      </button>
    );
  }

  if (props.variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={handleCreate}
        disabled={mutation.loading()}
        class="sidebar-item w-full min-h-8 px-2 py-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20"
      >
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-plus" />
            <span>New Note</span>
          </>
        )}
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
          <span class="text-emerald-700 dark:text-emerald-300">New Note</span>
        </>
      )}
    </button>
  );
};

export default CreateNoteButton;
