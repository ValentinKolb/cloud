import { dates } from "@k2b/stdlib";
import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Avatar, Button, Discussion, IconButton, MarkdownEditor, MarkdownView, Placeholder, prompts, Tooltip, toast } from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactNote } from "../../service";
import { readErrorMessage } from "./api";
import { createContactQuerySource, isCurrentQuerySnapshot, parseContactQuerySource } from "./contact-query-source";
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
  const [draft, setDraft] = createSignal("");
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingContent, setEditingContent] = createSignal("");
  const [deleteConfirming, setDeleteConfirming] = createSignal(false);
  let sectionRoot: HTMLElement | undefined;
  let disposed = false;
  const initialSource = createContactQuerySource({ bookId: props.bookId, contactId: props.contactId });
  const source = () => createContactQuerySource({ bookId: props.bookId, contactId: props.contactId });

  const notesQuery = query.create<string, { source: string; notes: ContactNote[] }>({
    source,
    initial: { source: initialSource, data: { source: initialSource, notes: props.initialNotes } },
    load: async (currentSource, { abortSignal }) => {
      const { bookId, contactId } = parseContactQuerySource(currentSource);
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.$get(
        { param: { bookId, contactId } },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load notes"));
      return { source: currentSource, notes: await res.json() };
    },
    subscribe: ({ invalidate }) =>
      listenForContactsLiveInvalidation("notes", (event) => {
        if (event.type !== "notes.changed" || event.bookId !== props.bookId || event.contactId !== props.contactId) return;
        return invalidate();
      }),
  });
  const notes = createMemo(() => {
    const loaded = notesQuery.data();
    return isCurrentQuerySnapshot(loaded, source()) ? loaded.notes : [];
  });

  createEffect(() => {
    void source();
    setDraft("");
    setComposerOpen(false);
    setEditingId(null);
    setEditingContent("");
  });

  onMount(() => {
    const openComposer = (event: Event) => {
      const detail = (event as CustomEvent<{ contactId?: string }>).detail;
      if (detail?.contactId !== props.contactId) return;
      setComposerOpen(true);
      requestAnimationFrame(() => sectionRoot?.scrollIntoView({ block: "start", behavior: "smooth" }));
    };
    window.addEventListener(CONTACT_NOTE_COMPOSE_EVENT, openComposer);
    onCleanup(() => {
      window.removeEventListener(CONTACT_NOTE_COMPOSE_EVENT, openComposer);
    });
  });

  type WriteTarget = { bookId: string; contactId: string };
  const reconcile = (target: WriteTarget) => {
    if (source() !== createContactQuerySource(target)) return;
    void notesQuery.invalidate().catch(() => toast.error("The note was saved, but the notes list could not be reloaded."));
  };

  const createMutation = mutations.create<{ target: WriteTarget; note: ContactNote }, WriteTarget & { content: string }>({
    mutation: async (target, { abortSignal }) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.$post(
        {
          param: { bookId: target.bookId, contactId: target.contactId },
          json: { content: target.content },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to add note"));
      return { target, note: await res.json() };
    },
    onSuccess: ({ target }) => {
      if (source() === createContactQuerySource(target)) {
        setDraft("");
        setComposerOpen(false);
      }
      toast.success("Note added");
      reconcile(target);
    },
    onError: (err) => prompts.error(err.message),
  });

  const updateMutation = mutations.create<{ target: WriteTarget; note: ContactNote }, WriteTarget & { noteId: string; content: string }>({
    mutation: async (target, { abortSignal }) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes[":noteId"].$patch(
        {
          param: {
            bookId: target.bookId,
            contactId: target.contactId,
            noteId: target.noteId,
          },
          json: { content: target.content },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update note"));
      return { target, note: await res.json() };
    },
    onSuccess: ({ target }) => {
      if (source() === createContactQuerySource(target)) {
        setEditingId(null);
        setEditingContent("");
      }
      toast.success("Note updated");
      reconcile(target);
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteMutation = mutations.create<WriteTarget, WriteTarget & { noteId: string }>({
    mutation: async (target, { abortSignal }) => {
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes[":noteId"].$delete(
        {
          param: {
            bookId: target.bookId,
            contactId: target.contactId,
            noteId: target.noteId,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to delete note"));
      return target;
    },
    onSuccess: (target) => {
      toast.success("Note deleted");
      reconcile(target);
    },
    onError: (err) => prompts.error(err.message),
  });

  const submitDraft = () => {
    const content = draft().trim();
    if (!content) return;
    createMutation.mutate({ bookId: props.bookId, contactId: props.contactId, content });
  };

  const submitEdit = (noteId: string) => {
    const content = editingContent().trim();
    if (!content) return;
    updateMutation.mutate({ bookId: props.bookId, contactId: props.contactId, noteId, content });
  };

  const deleteNote = async (note: ContactNote) => {
    if (disposed || deleteConfirming() || deleteMutation.loading()) return;
    const target = { bookId: props.bookId, contactId: props.contactId, noteId: note.id };
    setDeleteConfirming(true);
    try {
      const confirmed = await prompts.confirm("Delete this note? This cannot be undone.", {
        title: "Delete note",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed || disposed) return;
      await deleteMutation.mutate(target);
    } finally {
      if (!disposed) setDeleteConfirming(false);
    }
  };

  const startEdit = (note: ContactNote) => {
    setEditingId(note.id);
    setEditingContent(note.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

  onCleanup(() => {
    disposed = true;
    createMutation.abort();
    updateMutation.abort();
    deleteMutation.abort();
  });

  return (
    <Discussion
      ref={sectionRoot}
      label="Notes"
      icon="ti ti-note"
      count={`${notes().length} ${notes().length === 1 ? "note" : "notes"}`}
      actions={
        props.canWrite && !composerOpen() ? (
          <Button variant="ghost" size="xs" onClick={() => setComposerOpen(true)}>
            <i class="ti ti-plus" aria-hidden="true" /> Add note
          </Button>
        ) : undefined
      }
      data-contacts-editor={composerOpen() || editingId() ? "true" : undefined}
    >
      <Show when={props.canWrite && composerOpen()}>
        <Discussion.Composer
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
          actions={
            <>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setDraft("");
                  setComposerOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="xs" disabled={!draft().trim()} loading={createMutation.loading()}>
                <i class="ti ti-send" aria-hidden="true" /> Post note
              </Button>
            </>
          }
        >
          <MarkdownEditor
            aria-label="Add note"
            value={draft}
            onValueChange={setDraft}
            placeholder="Write a note in markdown…"
            lines={5}
            noToolbar
            showStats={false}
            disabled={createMutation.loading()}
            onSubmit={submitDraft}
          />
        </Discussion.Composer>
      </Show>

      <Show when={notesQuery.error()}>
        {(error) => (
          <Placeholder
            state="error"
            align="left"
            class="px-0 py-2"
            title="Could not load notes"
            description={error().message}
            action={
              <Button type="button" variant="secondary" size="xs" onClick={() => void notesQuery.refresh()}>
                Try again
              </Button>
            }
          />
        )}
      </Show>

      <Show
        when={!(notesQuery.loading() || (notesQuery.refreshing() && notes().length === 0) || (notesQuery.error() && notes().length === 0))}
        fallback={
          <Show when={!notesQuery.error()}>
            <Placeholder state="loading" align="left" class="px-0 py-2" description={<>Loading notes…</>} />
          </Show>
        }
      >
        <Show when={notes().length > 0} fallback={<Placeholder align="left" class="px-0 py-2" description={<>No notes yet.</>} />}>
          <Discussion.List>
            <For each={notes()}>
              {(note) => {
                const isOwn = () => note.authorUserId === props.currentUserId;
                const isEditing = () => editingId() === note.id;
                return (
                  <Discussion.Item
                    avatar={
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
                    }
                    author={note.authorDisplayName}
                    timestamp={
                      <time dateTime={note.createdAt} title={dates.formatDateTime(note.createdAt)}>
                        {dates.formatDateTimeRelative(note.createdAt)}
                      </time>
                    }
                    meta={note.updatedAt !== note.createdAt ? <span title={dates.formatDateTime(note.updatedAt)}>edited</span> : undefined}
                    actions={
                      props.canWrite && !isEditing() && (isOwn() || props.isBookAdmin) ? (
                        <>
                          <Show when={isOwn()}>
                            <Tooltip.Anchor content="Edit note">
                              <IconButton variant="ghost" size="xs" onClick={() => startEdit(note)} label="Edit note">
                                <i class="ti ti-pencil" aria-hidden="true" />
                              </IconButton>
                            </Tooltip.Anchor>
                          </Show>
                          <Tooltip.Anchor content={isOwn() ? "Delete note" : "Delete note as admin"}>
                            <IconButton
                              variant="ghost"
                              size="xs"
                              onClick={() => void deleteNote(note)}
                              disabled={deleteConfirming() || deleteMutation.loading()}
                              label={isOwn() ? "Delete note" : "Delete note as admin"}
                            >
                              <i class="ti ti-trash" aria-hidden="true" />
                            </IconButton>
                          </Tooltip.Anchor>
                        </>
                      ) : undefined
                    }
                  >
                    <Show when={isEditing()} fallback={<MarkdownView markdown={note.content} headingScale="compact" />}>
                      <Discussion.Composer
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitEdit(note.id);
                        }}
                        actions={
                          <>
                            <Button type="button" variant="ghost" size="xs" onClick={cancelEdit}>
                              Cancel
                            </Button>
                            <Button type="submit" size="xs" disabled={!editingContent().trim()} loading={updateMutation.loading()}>
                              <i class="ti ti-check" aria-hidden="true" /> Save
                            </Button>
                          </>
                        }
                      >
                        <MarkdownEditor
                          aria-label="Edit note"
                          value={editingContent}
                          onValueChange={setEditingContent}
                          lines={3}
                          noToolbar
                          showStats={false}
                          disabled={updateMutation.loading()}
                          onSubmit={() => submitEdit(note.id)}
                        />
                      </Discussion.Composer>
                    </Show>
                  </Discussion.Item>
                );
              }}
            </For>
          </Discussion.List>
        </Show>
      </Show>
    </Discussion>
  );
}
