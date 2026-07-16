import { AppOverview, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook } from "../service/notebooks";
import { setLastNotebookId } from "./[id]/_components/settings/NotebookSettingsStore";

type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  icon: string;
};

type Props = {
  notebooks: Notebook[];
  templates: TemplateSummary[];
  initialQuery: string;
};

type CreatedNotebook = {
  id: string;
  shortId: string;
};

const notebookMatches = (notebook: Notebook, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${notebook.name} ${notebook.description ?? ""} ${notebook.shortId}`.toLowerCase().includes(q);
};

const setQueryParam = (value: string) => {
  const url = new URL(window.location.href);
  const trimmed = value.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  window.history.replaceState({}, "", url.toString());
};

const errorMessage = async (res: Response, fallback: string) => {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  } catch {
    // Keep fallback.
  }
  return fallback;
};

export default function NotebooksOverview(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);

  const filteredNotebooks = createMemo(() => props.notebooks.filter((notebook) => notebookMatches(notebook, query())));

  const openNotebook = (notebook: CreatedNotebook) => {
    setLastNotebookId(notebook.shortId);
    navigateTo(`/app/notebooks/${notebook.shortId}`);
  };

  const createNotebookMutation = mutations.create<CreatedNotebook, { name: string; description?: string }>({
    mutation: async (input) => {
      const res = await apiClient.index.$post({
        json: { name: input.name, description: input.description || undefined },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create notebook"));
      return (await res.json()) as CreatedNotebook;
    },
    onSuccess: openNotebook,
    onError: (e) => prompts.error(e.message),
  });

  const createFromTemplateMutation = mutations.create<CreatedNotebook, { templateId: string; name?: string }>({
    mutation: async (input) => {
      const res = await apiClient.templates[":templateId"].$post({
        param: { templateId: input.templateId },
        json: { name: input.name?.trim() || undefined },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create notebook from template"));
      return (await res.json()) as CreatedNotebook;
    },
    onSuccess: openNotebook,
    onError: (e) => prompts.error(e.message),
  });

  const createBlank = async () => {
    const result = await prompts.form({
      title: "New notebook",
      icon: "ti ti-notebook",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "Notebook name" },
        description: { type: "text", label: "Description", multiline: true, placeholder: "Optional description" },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createNotebookMutation.mutate({
      name: String(result.name).trim(),
      description: String(result.description ?? "").trim(),
    });
  };

  const createFromTemplate = async (template: TemplateSummary) => {
    const result = await prompts.form({
      title: template.name,
      icon: template.icon,
      fields: {
        name: {
          type: "text",
          label: "Name",
          placeholder: template.name,
        },
      },
      confirmText: "Create",
    });
    if (!result) return;
    createFromTemplateMutation.mutate({
      templateId: template.id,
      name: String(result.name ?? "").trim() || undefined,
    });
  };

  const onSearchInput = (value: string) => {
    setQuery(value);
    setQueryParam(value);
  };

  return (
    <AppOverview
      title="Notebooks"
      subtitle="Collaborative notes, linked knowledge, scripts, and reusable workspaces."
      icon="ti ti-note"
    >
      <AppOverview.Main
        title="Your notebooks"
        description={
          props.notebooks.length === 0
            ? "Start from a template, or create a blank notebook."
            : `${props.notebooks.length} notebook${props.notebooks.length === 1 ? "" : "s"} available`
        }
        toolbar={
          <TextInput
            name="notebooks-search"
            type="search"
            ariaLabel="Search notebooks"
            placeholder="Search notebooks..."
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={query}
            onInput={onSearchInput}
            clearable
            onClear={() => onSearchInput("")}
          />
        }
      >
        <Show
          when={props.notebooks.length > 0}
          fallback={
            <AppOverview.EmptyState title="No notebooks yet" icon="ti ti-notebook" class="min-h-72">
              <p class="max-w-sm text-xs text-dimmed">
                Templates create a complete starter workspace with useful notes, links, tables, and small automations.
              </p>
            </AppOverview.EmptyState>
          }
        >
          <Show
            when={filteredNotebooks().length > 0}
            fallback={
              <AppOverview.EmptyState title="No matching notebooks" description="Try a different search term." icon="ti ti-search" />
            }
          >
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <For each={filteredNotebooks()}>
                {(notebook) => (
                  <a
                    href={`/app/notebooks/${notebook.shortId}`}
                    class="paper group flex items-center gap-2 p-4 no-underline transition-all hover:paper-highlighted"
                  >
                    <div class="thumbnail flex h-10 w-10 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                      <i class={`${notebook.icon || "ti ti-notebook"} text-lg text-blue-600 dark:text-blue-400`} />
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="text-sm font-semibold text-primary block truncate">{notebook.name}</span>
                      <p class="text-xs text-dimmed truncate">{notebook.description || "No description"}</p>
                    </div>
                    <i class="ti ti-chevron-right text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                  </a>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </AppOverview.Main>

      <AppOverview.Aside title="Create" description="Choose a useful starter, or start blank.">
        <div class="grid grid-cols-1 gap-2">
          <For each={props.templates}>
            {(template) => (
              <button
                type="button"
                class="paper group flex items-start gap-2 p-4 text-left transition-all hover:paper-highlighted"
                onClick={() => createFromTemplate(template)}
                disabled={createFromTemplateMutation.loading()}
              >
                <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                  <i class={`${template.icon} text-lg text-primary`} />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-primary">{template.name}</span>
                  <span class="block text-xs text-dimmed leading-snug line-clamp-2">{template.description}</span>
                </span>
                <i class="ti ti-chevron-right mt-1 shrink-0 text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
              </button>
            )}
          </For>

          <button
            type="button"
            class="paper group flex items-start gap-2 p-4 text-left transition-all hover:paper-highlighted"
            onClick={createBlank}
            disabled={createNotebookMutation.loading()}
          >
            <span class="thumbnail flex h-9 w-9 shrink-0 items-center justify-center bg-blue-100 dark:bg-blue-900/50">
              <i class="ti ti-plus text-lg text-blue-600 dark:text-blue-400" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-primary">Blank notebook</span>
              <span class="block text-xs text-dimmed leading-snug">Create an empty notebook with the standard welcome note.</span>
            </span>
            <i class="ti ti-chevron-right mt-1 shrink-0 text-dimmed transition-transform group-hover:translate-x-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
          </button>
        </div>
      </AppOverview.Aside>
    </AppOverview>
  );
}
