import { IconInput, prompts, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Notebook, NoteTreeNode } from "../sidebar/types";
import { LocalSaveStrip } from "./shared";
import type { NoteSelectOption } from "./types";
import { flattenNoteOptions, readErrorMessage } from "./utils";

export function GeneralSection(props: {
  notebook: Notebook;
  tree: NoteTreeNode[];
  canWrite: boolean;
  onNotebookChange: (notebook: Notebook) => void;
}) {
  const options = createMemo(() => flattenNoteOptions(props.tree));
  const [base, setBase] = createSignal({
    name: props.notebook.name,
    description: props.notebook.description ?? "",
    icon: props.notebook.icon ?? "",
    homepageNoteId: props.notebook.homepageNoteShortId ?? "",
  });
  const [name, setName] = createSignal(base().name);
  const [description, setDescription] = createSignal(base().description);
  const [icon, setIcon] = createSignal(base().icon);
  const [homepageNoteId, setHomepageNoteId] = createSignal(base().homepageNoteId);

  const selectedLabel = () => options().find((option) => option.id === homepageNoteId())?.label;
  const dirty = () =>
    name() !== base().name || description() !== base().description || icon() !== base().icon || homepageNoteId() !== base().homepageNoteId;

  const fetchNotes = async (query: string, signal: AbortSignal): Promise<NoteSelectOption[]> => {
    if (signal.aborted) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? options().filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q)) : options();
    return filtered.slice(0, 50);
  };

  const mutation = mutations.create({
    mutation: async () => {
      if (!name().trim()) throw new Error("Name is required");
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          icon: icon().trim() || null,
          homepageNoteId: homepageNoteId() || null,
        },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update notebook."));
      return (await res.json()) as Notebook;
    },
    onSuccess: (next) => {
      setBase({
        name: next.name,
        description: next.description ?? "",
        icon: next.icon ?? "",
        homepageNoteId: next.homepageNoteShortId ?? "",
      });
      props.onNotebookChange(next);
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TextInput
          label="Name"
          description="Shown in the sidebar and overview."
          value={name}
          onInput={setName}
          icon="ti ti-notebook"
          required
          disabled={!props.canWrite}
        />
        <IconInput
          label="Icon"
          description="Used in the sidebar header."
          value={icon}
          onChange={setIcon}
          placeholder="Search icons..."
          disabled={!props.canWrite}
        />
      </div>

      <TextInput
        label="Description"
        description="Optional short note for the overview."
        value={description}
        onInput={setDescription}
        multiline
        lines={2}
        placeholder="What is this notebook for?"
        icon="ti ti-align-left"
        disabled={!props.canWrite}
      />

      <SelectInput
        label="Homepage"
        description="Opened when this notebook has no URL note and no valid last active note."
        value={homepageNoteId}
        onChange={setHomepageNoteId}
        selectedLabel={selectedLabel}
        fetchData={fetchNotes}
        placeholder="Select a note..."
        icon="ti ti-home"
        activeIcon="ti ti-search"
        clearable
        disabled={!props.canWrite}
      />

      <Show
        when={props.canWrite}
        fallback={<p class="text-xs text-dimmed">You can view this notebook, but only editors can change identity settings.</p>}
      >
        <LocalSaveStrip dirty={dirty()} loading={mutation.loading()} onSave={() => mutation.mutate(undefined)} />
      </Show>
    </div>
  );
}
