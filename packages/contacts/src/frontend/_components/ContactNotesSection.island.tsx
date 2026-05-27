import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactNote } from "../../service";

type Props = {
  bookId: string;
  contactId: string;
  currentUserId: string;
  initialNotes: ContactNote[];
  /** Whether the current user has write access to the book. Hides compose + edit/delete when false. */
  canWrite: boolean;
  /** Whether the current user is a book admin. Admins can delete notes from
   *  any author (the server enforces the same rule). */
  isBookAdmin: boolean;
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

/**
 * Append-only notes timeline for a contact. Append-only in spirit:
 * users can edit their own notes and book admins can prune — but the panel
 * presents them as chronological journal entries, newest first.
 */
export default function ContactNotesSection(props: Props) {
  const [notes, setNotes] = createSignal<ContactNote[]>(props.initialNotes);
  const [draft, setDraft] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingContent, setEditingContent] = createSignal("");

  // When the user navigates between contacts, the panel reuses this island.
  // First run honours the SSR-provided initialNotes. Subsequent runs (real
  // contact switch) clear the list immediately so the previous contact's
  // notes do not flash in the new contact's panel.
  let isFirstRun = true;
  createEffect(() => {
    const cid = props.contactId;
    if (!isFirstRun) {
      setNotes([]);
    }
    isFirstRun = false;
    setDraft("");
    setEditingId(null);
    setEditingContent("");
    void cid;
    void refresh();
  });

  const refresh = async () => {
    const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.$get({
      param: { bookId: props.bookId, contactId: props.contactId },
    });
    if (res.ok) {
      const data = (await res.json()) as ContactNote[];
      setNotes(data);
    }
  };

  const createMutation = mutations.create<ContactNote, string>({
    mutation: async (content) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.$post({
        param: { bookId: props.bookId, contactId: props.contactId },
        json: { content },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to add note"));
      return (await res.json()) as ContactNote;
    },
    onSuccess: () => {
      setDraft("");
      toast.success("Note added");
      void refresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMutation = mutations.create<ContactNote, { noteId: string; content: string }>({
    mutation: async (vars) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes[":noteId"].$patch({
        param: { bookId: props.bookId, contactId: props.contactId, noteId: vars.noteId },
        json: { content: vars.content },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update note"));
      return (await res.json()) as ContactNote;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditingContent("");
      toast.success("Note updated");
      void refresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<string | null, ContactNote>({
    mutation: async (note) => {
      const confirmed = await prompts.confirm("Delete this note? This cannot be undone.", {
        title: "Delete note",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return null;

      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes[":noteId"].$delete({
        param: { bookId: props.bookId, contactId: props.contactId, noteId: note.id },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to delete note"));
      return note.id;
    },
    onSuccess: (deletedId) => {
      if (!deletedId) return;
      toast.success("Note deleted");
      void refresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const submitDraft = () => {
    const content = draft().trim();
    if (!content) return;
    createMutation.mutate(content);
  };

  const submitEdit = (noteId: string) => {
    const content = editingContent().trim();
    if (!content) return;
    updateMutation.mutate({ noteId, content });
  };

  const startEdit = (note: ContactNote) => {
    setEditingId(note.id);
    setEditingContent(note.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="detail-section-label">Notes</h3>
        <span class="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {notes().length} {notes().length === 1 ? "note" : "notes"}
        </span>
      </div>

      <Show when={props.canWrite}>
        <form
          class="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <TextInput
            value={draft}
            onInput={setDraft}
            placeholder="Write a note in markdown…"
            markdown
            disabled={createMutation.loading()}
            onSubmit={submitDraft}
          />
          <button
            type="submit"
            disabled={createMutation.loading() || !draft().trim()}
            class="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-send" />}
            Post note
          </button>
        </form>
      </Show>

      <Show when={notes().length > 0} fallback={<p class="text-xs text-dimmed">No notes yet.</p>}>
        <ol class="flex flex-col gap-3">
          <For each={notes()}>
            {(note) => {
              const isOwn = () => note.authorUserId === props.currentUserId;
              const isEditing = () => editingId() === note.id;
              return (
                <li class="group flex flex-col gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <div class="flex items-center gap-2">
                    <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] dark:bg-zinc-700">
                      {(note.authorDisplayName || "?").charAt(0).toUpperCase()}
                    </div>
                    <span class="truncate text-xs font-medium text-primary">{note.authorDisplayName}</span>
                    <span class="text-[11px] text-dimmed" title={dates.formatDateTime(note.createdAt)}>
                      {dates.formatDateTimeRelative(note.createdAt)}
                    </span>
                    <Show when={note.updatedAt !== note.createdAt}>
                      <span class="text-[11px] text-dimmed italic" title={dates.formatDateTime(note.updatedAt)}>
                        (edited)
                      </span>
                    </Show>
                    <Show when={props.canWrite && !isEditing() && (isOwn() || props.isBookAdmin)}>
                      <div class="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Show when={isOwn()}>
                          <button
                            type="button"
                            onClick={() => startEdit(note)}
                            class="btn-simple btn-sm text-xs text-dimmed hover:text-primary"
                            aria-label="Edit note"
                            title="Edit"
                          >
                            <i class="ti ti-pencil" />
                          </button>
                        </Show>
                        <button
                          type="button"
                          onClick={() => deleteMutation.mutate(note)}
                          disabled={deleteMutation.loading()}
                          class="btn-simple btn-sm text-xs text-dimmed hover:text-red-500"
                          aria-label="Delete note"
                          title={isOwn() ? "Delete" : "Delete (admin)"}
                        >
                          <i class="ti ti-trash" />
                        </button>
                      </div>
                    </Show>
                  </div>

                  <Show when={isEditing()} fallback={<MarkdownView html={markdown.render(note.content)} smallHeadings class="text-sm" />}>
                    <div class="flex flex-col gap-1.5">
                      <TextInput
                        value={editingContent}
                        onInput={setEditingContent}
                        markdown
                        disabled={updateMutation.loading()}
                        onSubmit={() => submitEdit(note.id)}
                      />
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => submitEdit(note.id)}
                          disabled={updateMutation.loading() || !editingContent().trim()}
                          class="inline-flex items-center gap-1.5 px-3 py-1 text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
                        >
                          {updateMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-check" />}
                          Save
                        </button>
                        <button type="button" onClick={cancelEdit} class="btn-simple btn-sm text-xs text-dimmed hover:text-primary">
                          Cancel
                        </button>
                      </div>
                    </div>
                  </Show>
                </li>
              );
            }}
          </For>
        </ol>
      </Show>
    </div>
  );
}
