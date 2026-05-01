import { createSignal, For, Show } from "solid-js";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { ColorInput, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { apiClient } from "@/api/client";
import type { ContactTag } from "../../service";

type Props = {
  bookId: string;
  initialTags: ContactTag[];
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const errorMessage = async (res: Response, fallback: string) => {
  try {
    const data = (await res.json()) as unknown;
    if (isObject(data) && typeof data["message"] === "string" && data["message"].length > 0) {
      return data["message"];
    }
  } catch {}
  return fallback;
};

const DEFAULT_COLOR = "#6b7280";

/**
 * Inline create/edit form for a single tag. Used for both "Add new" and
 * "Edit existing" — distinguished by the optional `tag` prop.
 */
function TagForm(props: {
  tag?: ContactTag;
  onSave: (data: { name: string; color: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName] = createSignal(props.tag?.name ?? "");
  const [color, setColor] = createSignal(props.tag?.color ?? DEFAULT_COLOR);
  const isNew = () => !props.tag;

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    if (!name().trim()) return;
    props.onSave({ name: name().trim(), color: color() });
    if (isNew()) {
      setName("");
      setColor(DEFAULT_COLOR);
    }
  };

  return (
    <form onSubmit={handleSubmit} class="paper ml-2 flex flex-col gap-2 p-3">
      <TextInput label="Name" placeholder="Tag name" value={name} onInput={setName} required />
      <ColorInput label="Color" value={color} onChange={setColor} />
      <div class="mt-1 flex gap-2">
        <button type="submit" disabled={props.loading} class="btn-primary btn-sm">
          {props.loading ? <i class="ti ti-loader-2 animate-spin" /> : isNew() ? "Create" : "Save"}
        </button>
        <button type="button" onClick={props.onCancel} class="btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function TagRow(props: { tag: ContactTag; onEdit: () => void; onDelete: () => void }) {
  return (
    <div class="group/tag flex items-center gap-2 py-0.5 pl-3">
      <span class="h-4 w-4 shrink-0 rounded-full" style={`background-color: ${props.tag.color}`} />
      <span class="flex-1 truncate text-sm">{props.tag.name}</span>
      <div class="flex items-center gap-1 opacity-0 transition-opacity group-hover/tag:opacity-100">
        <button
          type="button"
          onClick={props.onEdit}
          class="flex h-6 w-6 items-center justify-center p-1 text-dimmed hover:text-primary"
          aria-label={`Edit ${props.tag.name}`}
        >
          <i class="ti ti-pencil text-sm" />
        </button>
        <button
          type="button"
          onClick={props.onDelete}
          class="flex h-6 w-6 items-center justify-center p-1 text-dimmed hover:text-red-500"
          aria-label={`Delete ${props.tag.name}`}
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
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          class="flex items-center gap-2 py-1 pl-3 text-sm text-dimmed transition-colors hover:text-primary"
        >
          <i class="ti ti-plus" />
          <span>Add tag</span>
        </button>
      }
    >
      <TagForm
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

export default function BookTagsManager(props: Props) {
  const [tags, setTags] = createSignal<ContactTag[]>(props.initialTags);
  const [editingId, setEditingId] = createSignal<string | null>(null);

  const createMut = mutations.create<ContactTag, { name: string; color: string }>({
    mutation: async (data) => {
      const res = await apiClient.books[":bookId"].tags.$post({
        param: { bookId: props.bookId },
        json: data,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create tag"));
      return (await res.json()) as ContactTag;
    },
    onSuccess: (created) => setTags([...tags(), created].sort((a, b) => a.name.localeCompare(b.name))),
    onError: (err) => prompts.error(err.message),
  });

  const updateMut = mutations.create<ContactTag, { id: string; name: string; color: string }>({
    mutation: async (data) => {
      const res = await apiClient.books[":bookId"].tags[":tagId"].$patch({
        param: { bookId: props.bookId, tagId: data.id },
        json: { name: data.name, color: data.color },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update tag"));
      return (await res.json()) as ContactTag;
    },
    onSuccess: (updated) => {
      setTags(tags().map((t) => (t.id === updated.id ? updated : t)).sort((a, b) => a.name.localeCompare(b.name)));
      setEditingId(null);
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMut = mutations.create<void, string>({
    mutation: async (id) => {
      const res = await apiClient.books[":bookId"].tags[":tagId"].$delete({
        param: { bookId: props.bookId, tagId: id },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to delete tag"));
    },
    onError: (err) => prompts.error(err.message),
  });

  const handleDelete = async (tag: ContactTag) => {
    const confirmed = await prompts.confirm(`Delete "${tag.name}"? It will be removed from all contacts in this book.`, {
      title: "Delete tag",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    deleteMut.mutate(tag.id);
    setTags(tags().filter((t) => t.id !== tag.id));
  };

  return (
    <div class="flex flex-col border-l-2 border-zinc-200 dark:border-zinc-700">
      <For
        each={tags()}
        fallback={<p class="py-2 pl-3 text-xs text-dimmed">No tags yet — add one below.</p>}
      >
        {(tag) => (
          <Show
            when={editingId() === tag.id}
            fallback={<TagRow tag={tag} onEdit={() => setEditingId(tag.id)} onDelete={() => handleDelete(tag)} />}
          >
            <TagForm
              tag={tag}
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
