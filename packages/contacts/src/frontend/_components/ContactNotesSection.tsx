import { dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Avatar, Button, IconButton, MarkdownView, Placeholder, prompts, TextInput, Tooltip, toast } from "@k2b/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactNote } from "../../service";
import { readErrorMessage } from "./api";
import { listenForContactsLiveInvalidation } from "./contacts-live";
import { CONTACT_NOTE_COMPOSE_EVENT } from "./context";

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

/**
 * Append-only notes timeline for a contact. Append-only in spirit:
 * users can edit their own notes and book admins can prune — but the panel
 * presents them as chronological journal entries, newest first.
 */
export default function ContactNotesSection(props: Props) {
  const [notes, setNotes] = createSignal<ContactNote[]>(props.initialNotes);
  const [draft, setDraft] = createSignal("");
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingContent, setEditingContent] = createSignal("");
  let sectionRoot: HTMLDivElement | undefined;
  let initializedTarget = false;

  const loadMutation = mutations.create<ContactNote[], { bookId: string; contactId: string }>({
    mutation: async (target, ctx) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.$get(
        { param: target },
        { init: { signal: ctx.abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load notes"));
      return await res.json();
    },
    onSuccess: setNotes,
  });

  const refresh = async (throwOnError = false) => {
    await loadMutation.mutate({ bookId: props.bookId, contactId: props.contactId });
    if (throwOnError && loadMutation.error()) throw loadMutation.error();
  };

  // When the user navigates between contacts, the panel reuses this island.
  // First run honours the SSR-provided initialNotes. Subsequent runs (real
  // contact switch) clear the list immediately so the previous contact's
  // notes do not flash in the new contact's panel.
  createEffect(() => {
    const cid = props.contactId;
    if (initializedTarget) {
      setNotes([]);
      void refresh();
    }
    initializedTarget = true;
    setDraft("");
    setComposerOpen(false);
    setEditingId(null);
    setEditingContent("");
    void cid;
  });

  onMount(() => {
    const openComposer = (event: Event) => {
      const detail = (event as CustomEvent<{ contactId?: string }>).detail;
      if (detail?.contactId !== props.contactId) return;
      setComposerOpen(true);
      requestAnimationFrame(() => sectionRoot?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };
    window.addEventListener(CONTACT_NOTE_COMPOSE_EVENT, openComposer);
    const stopLiveInvalidations = listenForContactsLiveInvalidation((event) => {
      if (event.type !== "notes.changed" || event.bookId !== props.bookId || event.contactId !== props.contactId) return;
      return refresh(true);
    });
    onCleanup(() => {
      stopLiveInvalidations();
      window.removeEventListener(CONTACT_NOTE_COMPOSE_EVENT, openComposer);
    });
  });

  const createMutation = mutations.create<ContactNote, string>({
    mutation: async (content) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.$post({
        param: { bookId: props.bookId, contactId: props.contactId },
        json: { content },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to add note"));
      return await res.json();
    },
    onSuccess: () => {
      setDraft("");
      setComposerOpen(false);
      toast.success("Note added");
      void refresh();
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMutation = mutations.create<ContactNote, { noteId: string; content: string }>({
    mutation: async (vars) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes[":noteId"].$patch({
        param: {
          bookId: props.bookId,
          contactId: props.contactId,
          noteId: vars.noteId,
        },
        json: { content: vars.content },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update note"));
      return await res.json();
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
        param: {
          bookId: props.bookId,
          contactId: props.contactId,
          noteId: note.id,
        },
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete note"));
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
    <div ref={sectionRoot} class="flex flex-col gap-3" data-contacts-editor={composerOpen() || editingId() ? "true" : undefined}>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="detail-section-label mb-0">Notes</h3>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center rounded-md bg-[var(--ui-surface-subtle)] px-2 py-0.5 text-[11px] font-medium text-secondary">
            {notes().length} {notes().length === 1 ? "note" : "notes"}
          </span>
          <Show when={props.canWrite && !composerOpen()}>
            <Button variant="ghost" size="sm" onClick={() => setComposerOpen(true)}>
              <i class="ti ti-plus" /> Add note
            </Button>
          </Show>
        </div>
      </div>

      <Show when={props.canWrite && composerOpen()}>
        <form
          class="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <TextInput
            aria-label="Add note"
            value={draft}
            onValueChange={setDraft}
            placeholder="Write a note in markdown…"
            markdown
            disabled={createMutation.loading()}
            onSubmit={submitDraft}
          />
          <div class="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft("");
                setComposerOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!draft().trim()} loading={createMutation.loading()}>
              <i class="ti ti-send" />
              Post note
            </Button>
          </div>
        </form>
      </Show>

      <Show
        when={notes().length > 0}
        fallback={
          <Placeholder align="left" class="px-0 py-2" description={<>
            No notes yet.
          </>} />
        }
      >
        <ol class="flex flex-col gap-3">
          <For each={notes()}>
            {(note) => {
              const isOwn = () => note.authorUserId === props.currentUserId;
              const isEditing = () => editingId() === note.id;
              return (
                <li class="group flex flex-col gap-1.5">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Avatar
                      name={note.authorDisplayName}
                      fallback={(note.authorDisplayName.trim() || "?").slice(0, 2).toUpperCase()}
                      src={
                        note.authorUserId && note.authorAvatarHash
                          ? `/api/accounts/users/${encodeURIComponent(note.authorUserId)}/avatar?rev=${encodeURIComponent(note.authorAvatarHash)}`
                          : undefined
                      }
                      size="xs"
                    />
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
                      <div class="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <Show when={isOwn()}>
                          <Tooltip content="Edit note">
                            <IconButton
                              size="xs"
                              onClick={() => startEdit(note)}
                              class="text-xs text-dimmed hover:text-primary"
                              label="Edit note"
                            >
                              <i class="ti ti-pencil" />
                            </IconButton>
                          </Tooltip>
                        </Show>
                        <Tooltip content={isOwn() ? "Delete note" : "Delete note as admin"}>
                          <IconButton
                            size="xs"
                            onClick={() => deleteMutation.mutate(note)}
                            disabled={deleteMutation.loading()}
                            class="text-xs text-dimmed hover:text-red-500"
                            label={isOwn() ? "Delete note" : "Delete note as admin"}
                          >
                            <i class="ti ti-trash" />
                          </IconButton>
                        </Tooltip>
                      </div>
                    </Show>
                  </div>

                  <Show when={isEditing()} fallback={<MarkdownView html={markdown.render(note.content)} smallHeadings class="text-sm" />}>
                    <div class="flex flex-col gap-1.5">
                      <TextInput
                        aria-label="Edit note"
                        value={editingContent}
                        onValueChange={setEditingContent}
                        markdown
                        disabled={updateMutation.loading()}
                        onSubmit={() => submitEdit(note.id)}
                      />
                      <div class="flex flex-wrap items-center justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={cancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => submitEdit(note.id)}
                          disabled={!editingContent().trim()}
                          loading={updateMutation.loading()}
                        >
                          <i class="ti ti-check" />
                          Save
                        </Button>
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
