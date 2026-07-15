import { IconInput, prompts, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { buildNoteTitleTemplateContext, renderNoteTitleTemplate } from "@/lib/note-title-template";
import type { Notebook, NoteTreeNode } from "../sidebar/types";
import { LocalSaveStrip } from "./shared";
import type { NoteSelectOption } from "./types";
import { flattenNoteOptions, readErrorMessage } from "./utils";

export function GeneralSection(props: {
  notebook: Notebook;
  tree: NoteTreeNode[];
  canWrite: boolean;
  dateConfig: DateContext;
  onNotebookChange: (notebook: Notebook) => void;
}) {
  const options = createMemo(() => flattenNoteOptions(props.tree));
  const [base, setBase] = createSignal({
    name: props.notebook.name,
    description: props.notebook.description ?? "",
    icon: props.notebook.icon ?? "",
    homepageNoteId: props.notebook.homepageNoteShortId ?? "",
    defaultNoteTitleTemplate: props.notebook.defaultNoteTitleTemplate,
  });
  const [name, setName] = createSignal(base().name);
  const [description, setDescription] = createSignal(base().description);
  const [icon, setIcon] = createSignal(base().icon);
  const [homepageNoteId, setHomepageNoteId] = createSignal(base().homepageNoteId);
  const [defaultNoteTitleTemplate, setDefaultNoteTitleTemplate] = createSignal(base().defaultNoteTitleTemplate);

  const titlePreview = createMemo(() => {
    try {
      return {
        title: renderNoteTitleTemplate(
          defaultNoteTitleTemplate(),
          buildNoteTitleTemplateContext({
            notebook: { id: props.notebook.id, short_id: props.notebook.shortId, name: name().trim() || props.notebook.name },
            note: { short_id: "ABC123", depth: 0 },
            dateConfig: props.dateConfig,
          }),
        ),
        error: null,
      };
    } catch (error) {
      return { title: null, error: error instanceof Error ? error.message : "Invalid default note title template" };
    }
  });

  const selectedLabel = () => options().find((option) => option.id === homepageNoteId())?.label;
  const dirty = () =>
    name() !== base().name ||
    description() !== base().description ||
    icon() !== base().icon ||
    homepageNoteId() !== base().homepageNoteId ||
    defaultNoteTitleTemplate() !== base().defaultNoteTitleTemplate;

  const fetchNotes = async (query: string, signal: AbortSignal): Promise<NoteSelectOption[]> => {
    if (signal.aborted) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? options().filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(q)) : options();
    return filtered.slice(0, 50);
  };

  const mutation = mutations.create({
    mutation: async () => {
      if (!name().trim()) throw new Error("Name is required");
      if (titlePreview().error) throw new Error(titlePreview().error!);
      const res = await apiClient[":id"].$patch({
        param: { id: props.notebook.shortId },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          icon: icon().trim() || null,
          homepageNoteId: homepageNoteId() || null,
          defaultNoteTitleTemplate: defaultNoteTitleTemplate(),
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
        defaultNoteTitleTemplate: next.defaultNoteTitleTemplate,
      });
      props.onNotebookChange(next);
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
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

      <TextInput
        label="Default note title"
        description="Liquid template used for the initial H1 when new Markdown has no usable title. Supplied content is preserved."
        value={defaultNoteTitleTemplate}
        onInput={setDefaultNoteTitleTemplate}
        multiline
        lines={3}
        icon="ti ti-template"
        required
        disabled={!props.canWrite}
        error={() => titlePreview().error ?? undefined}
        monospace
        maxLength={2_000}
      />

      <div class="flex flex-col gap-1 text-xs">
        <div class="flex items-baseline gap-2">
          <span class="font-semibold">Preview</span>
          <span class={titlePreview().error ? "text-dimmed" : "font-medium"}>{titlePreview().title ?? "Unavailable"}</span>
        </div>
        <p class="text-dimmed">
          Variables: <code>notebook.id</code>, <code>notebook.short_id</code>, <code>notebook.name</code>, <code>note.short_id</code>,{" "}
          <code>note.depth</code>, <code>parent.exists</code>, <code>parent.id</code>, <code>parent.short_id</code>, <code>parent.title</code>,{" "}
          <code>parent.path</code>, <code>date</code>, <code>time</code>, <code>datetime</code>, and <code>timezone</code>.
        </p>
      </div>

      <Show
        when={props.canWrite}
        fallback={<p class="text-xs text-dimmed">You can view this notebook, but only editors can change identity settings.</p>}
      >
        <LocalSaveStrip dirty={dirty()} loading={mutation.loading()} onSave={() => mutation.mutate(undefined)} />
      </Show>
    </div>
  );
}
