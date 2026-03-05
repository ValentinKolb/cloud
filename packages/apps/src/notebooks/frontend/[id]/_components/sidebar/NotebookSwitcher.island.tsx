import { For, Show } from "solid-js";
import { apiClient } from "@/notebooks/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { setLastNotebookId } from "../settings/NotebookSettingsStore";
import { listAccessibleNotebooks } from "./notebooks";
import type { Notebook } from "./types";
import { navigateTo } from "../../../lib/navigation";

type Props = {
  currentNotebook: Notebook;
  variant: "compact" | "full";
};

type CreateNotebookResult = {
  id: string;
};

const NotebookSwitcher = (props: Props) => {
  const createMut = mutations.create<CreateNotebookResult, { name: string; description?: string }>({
    mutation: async (data: { name: string; description?: string }) => {
      const res = await apiClient.index.$post({ json: data });
      if (!res.ok) throw new Error("Failed to create notebook");
      return (await res.json()) as CreateNotebookResult;
    },
    onSuccess: (data) => {
      setLastNotebookId(data.id);
      navigateTo(`/app/notebooks/${data.id}`);
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleOpen = async () => {
    let notebooks: Notebook[] = [];
    try {
      notebooks = await listAccessibleNotebooks();
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Failed to load notebooks.");
    }

    const result = await prompts.dialog<{ action: "switch"; id: string } | { action: "create" }>(
      (close) => (
        <div class="flex flex-col gap-3">
          <div class="flex flex-col gap-1 max-h-72 overflow-y-auto">
            <For each={notebooks}>
              {(nb) => (
                <button
                  type="button"
                  onClick={() => close({ action: "switch", id: nb.id })}
                  class={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-left transition-colors ${
                    nb.id === props.currentNotebook.id
                      ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                      : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <i class={`ti ${nb.icon || "ti-notebook"} text-base`} />
                  <span class="truncate flex-1">{nb.name}</span>
                  {nb.id === props.currentNotebook.id && <i class="ti ti-check text-xs" />}
                </button>
              )}
            </For>

            <Show when={notebooks.length === 0}>
              <p class="flex items-center justify-center gap-1.5 py-4 text-xs text-dimmed">
                <i class="ti ti-notebook text-sm" />
                No notebooks found
              </p>
            </Show>
          </div>

          <hr class="border-zinc-200 dark:border-zinc-700" />

          <button
            type="button"
            onClick={() => close({ action: "create" })}
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-left text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <i class="ti ti-plus text-base" />
            <span>New Notebook</span>
          </button>
        </div>
      ),
      { title: "Switch Notebook", icon: "ti ti-notebook" },
    );

    if (!result) return;

    if (result.action === "switch") {
      setLastNotebookId(result.id);
      navigateTo(`/app/notebooks/${result.id}`);
    } else if (result.action === "create") {
      const formResult = await prompts.form({
        title: "New Notebook",
        icon: "ti ti-notebook",
        fields: {
          name: {
            type: "text" as const,
            label: "Name",
            required: true,
            placeholder: "Notebook name",
          },
          description: {
            type: "text" as const,
            label: "Description",
            multiline: true,
            placeholder: "Optional description",
          },
        },
      });
      if (formResult) createMut.mutate(formResult);
    }
  };

  return (
    <button
      type="button"
      onClick={handleOpen}
      class={`flex items-center gap-2 text-left min-w-0 ${
        props.variant === "full" ? "font-semibold text-lg w-full" : "font-medium text-sm flex-1"
      }`}
    >
      <span class="truncate">{props.currentNotebook.name}</span>
      <i class="ti ti-selector text-dimmed text-xs shrink-0" />
    </button>
  );
};

export default NotebookSwitcher;
