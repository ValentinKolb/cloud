import { prompts, toast } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceTag } from "@/contracts";
import { NameColorForm } from "./NameColorForm";
import { readErrorMessage } from "./utils";

function TagRow(props: { tag: SpaceTag; onEdit: () => void; onDelete: () => void }) {
  return (
    <div class="group/tag flex items-center gap-2 py-0.5">
      <span class="w-4 h-4 rounded-full shrink-0" style={`background-color: ${props.tag.color}`} />
      <span class="flex-1 text-sm truncate">{props.tag.name}</span>
      <div class="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover/tag:opacity-100 sm:group-focus-within/tag:opacity-100">
        <button type="button" onClick={props.onEdit} class="icon-btn h-7 w-7" aria-label={`Edit ${props.tag.name}`} title="Edit tag">
          <i class="ti ti-pencil text-sm" />
        </button>
        <button
          type="button"
          onClick={props.onDelete}
          class="icon-btn h-7 w-7 hover:text-red-600 dark:hover:text-red-400"
          aria-label={`Delete ${props.tag.name}`}
          title="Delete tag"
        >
          <i class="ti ti-x text-sm" />
        </button>
      </div>
    </div>
  );
}

function AddTagButton(props: { onSave: (data: { name: string; color: string }) => void; loading: boolean }) {
  const [isOpen, setIsOpen] = createSignal(false);

  return (
    <Show
      when={isOpen()}
      fallback={
        <button type="button" onClick={() => setIsOpen(true)} class="btn-simple btn-sm self-start">
          <i class="ti ti-plus" />
          <span>Add tag</span>
        </button>
      }
    >
      <NameColorForm
        mode="create"
        nameLabel="Name"
        namePlaceholder="Tag name"
        createLabel="Create"
        onSave={(data) => {
          props.onSave(data);
          setIsOpen(false);
        }}
        onCancel={() => setIsOpen(false)}
        loading={props.loading}
      />
    </Show>
  );
}

export function TagsSection(props: { spaceId: string; tags: SpaceTag[] }) {
  const [tags, setTags] = createSignal([...props.tags]);
  const [editingId, setEditingId] = createSignal<string | null>(null);

  const createMut = mutations.create({
    mutation: async (data: { name: string; color: string }) => {
      const res = await apiClient[":id"].tags.$post({
        param: { id: props.spaceId },
        json: data,
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to create tag"));
      }
      return res.json();
    },
    onSuccess: (newTag) => {
      setTags([...tags(), newTag as SpaceTag]);
      toast.success("Tag created");
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMut = mutations.create({
    mutation: async (data: { id: string; name: string; color: string }) => {
      const res = await apiClient[":id"].tags[":tagId"].$patch({
        param: { id: props.spaceId, tagId: data.id },
        json: { name: data.name, color: data.color },
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to update tag"));
      }
      return res.json();
    },
    onSuccess: (updated) => {
      setTags(tags().map((t) => (t.id === (updated as SpaceTag).id ? (updated as SpaceTag) : t)));
      setEditingId(null);
      toast.success("Tag updated");
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMut = mutations.create<SpaceTag | null, SpaceTag>({
    mutation: async (tag: SpaceTag) => {
      const confirmed = await prompts.confirm("Delete this tag?", {
        title: "Delete Tag",
        variant: "danger",
      });
      if (!confirmed) return null;

      const res = await apiClient[":id"].tags[":tagId"].$delete({
        param: { id: props.spaceId, tagId: tag.id },
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res, "Failed to delete tag"));
      }
      return tag;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      setTags(tags().filter((t) => t.id !== deleted.id));
      toast.success("Tag deleted");
    },
    onError: (err) => prompts.error(err.message),
  });

  return (
    <div class="flex flex-col gap-1">
      <For each={tags()}>
        {(tag) => (
          <Show
            when={editingId() === tag.id}
            fallback={<TagRow tag={tag} onEdit={() => setEditingId(tag.id)} onDelete={() => deleteMut.mutate(tag)} />}
          >
            <NameColorForm
              mode="edit"
              initialName={tag.name}
              initialColor={tag.color}
              nameLabel="Name"
              namePlaceholder="Tag name"
              createLabel="Create"
              onSave={(data) => updateMut.mutate({ id: tag.id, ...data })}
              onCancel={() => setEditingId(null)}
              loading={updateMut.loading()}
            />
          </Show>
        )}
      </For>

      <AddTagButton onSave={(data) => createMut.mutate(data)} loading={createMut.loading()} />
    </div>
  );
}
