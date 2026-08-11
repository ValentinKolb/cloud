import { mutation as mutations } from "@k2b/stdlib/solid";
import { AppWorkspace, Button, IconButton, prompts } from "@k2b/ui";
import { apiClient } from "@/api/client";
import { navigateToNotebookNote } from "../../../lib/soft-navigation";
import { buildNoteUrl } from "../../../params";

type Props = {
  notebookId: string;
  variant?: "compact" | "chip" | "sidebar" | "icon";
  viewTransitionName?: string;
};

type CreateNoteResult = {
  id: string;
};

const CreateNoteButton = (props: Props) => {
  const mutation = mutations.create<CreateNoteResult, void>({
    mutation: async () => {
      const res = await apiClient[":id"].notes.$post({
        param: { id: props.notebookId },
        json: {},
      });
      if (!res.ok) throw new Error("Failed to create note");
      return (await res.json()) as CreateNoteResult;
    },
    onSuccess: (data) => {
      void navigateToNotebookNote(buildNoteUrl(props.notebookId, data.id), { selectInitialTitle: data.id });
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleCreate = () => mutation.mutate();

  if (props.variant === "compact") {
    return (
      <IconButton label="New note" size="xs" onClick={handleCreate} loading={mutation.loading()} loadingLabel="Creating note">
        <i class={`ti ${mutation.loading() ? "ti-loader-2 animate-spin" : "ti-file-plus"}`} />
      </IconButton>
    );
  }

  if (props.variant === "icon") {
    return (
      <AppWorkspace.SidebarIconAction
        label="New note"
        icon={mutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"}
        tone="success"
        onClick={handleCreate}
        disabled={mutation.loading()}
        viewTransitionName={props.viewTransitionName}
      />
    );
  }

  if (props.variant === "chip") {
    return (
      <Button size="sm" onClick={handleCreate} loading={mutation.loading()} loadingLabel="Creating note">
        {mutation.loading() ? (
          <i class="ti ti-loader-2 animate-spin" />
        ) : (
          <>
            <i class="ti ti-plus" />
            <span>New Note</span>
          </>
        )}
      </Button>
    );
  }

  if (props.variant === "sidebar") {
    return (
      <AppWorkspace.SidebarItem
        icon={mutation.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"}
        tone="success"
        onClick={handleCreate}
        disabled={mutation.loading()}
      >
        New Note
      </AppWorkspace.SidebarItem>
    );
  }

  return (
    <Button variant="success" onClick={handleCreate} loading={mutation.loading()} loadingLabel="Creating note">
      {mutation.loading() ? (
        <i class="ti ti-loader-2 animate-spin" />
      ) : (
        <>
          <i class="ti ti-file-plus mr-1 text-emerald-600 dark:text-emerald-400" />
          <span class="text-emerald-700 dark:text-emerald-300">New Note</span>
        </>
      )}
    </Button>
  );
};

export default CreateNoteButton;
