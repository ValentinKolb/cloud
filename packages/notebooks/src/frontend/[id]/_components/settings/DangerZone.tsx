import { navigateTo } from "@k2b/ssr/nav";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Button, prompts, SettingsGroup, toast } from "@k2b/ui";
import { apiClient } from "@/api/client";
import type { Notebook } from "../sidebar/types";
import { readErrorMessage } from "./utils";

export function DangerZone(props: { notebook: Notebook }) {
  const mutation = mutations.create({
    mutation: async () => {
      const res = await apiClient[":id"].$delete({
        param: { id: props.notebook.id },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete notebook."));
    },
    onSuccess: () => navigateTo("/app/notebooks"),
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async () => {
    const enteredName = await prompts.prompt(`Type "${props.notebook.name}" to permanently delete this notebook and all its data.`, "", {
      title: "Delete notebook",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (enteredName === null) return;
    if (enteredName !== props.notebook.name) {
      toast.error("Notebook name does not match");
      return;
    }
    mutation.mutate(undefined);
  };

  return (
    <SettingsGroup title="Delete notebook" description="Permanently remove its notes, versions, attachments, and access grants.">
      <SettingsGroup.Action>
        <Button variant="danger" onClick={handleDelete} loading={mutation.loading()} loadingLabel="Deleting">
          {mutation.loading() ? (
            <>
              <i class="ti ti-loader-2 animate-spin" aria-hidden="true" />
              Deleting
            </>
          ) : (
            <>
              <i class="ti ti-trash" aria-hidden="true" />
              Delete notebook
            </>
          )}
        </Button>
      </SettingsGroup.Action>
    </SettingsGroup>
  );
}
