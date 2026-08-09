import { dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Avatar, Button, Discussion, IconButton, MarkdownEditor, MarkdownView, Placeholder, prompts, Tooltip, toast } from "@k2b/ui";
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
  let sectionRoot: HTMLElement | undefined;
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
    onSuccess: (createdNote) => {
      setNotes((current) => [createdNote, ...current.filter((note) => note.id !== createdNote.id)]);
      setDraft("");
      setComposerOpen(false);
      toast.success("Note added");
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
                            onClick={() => deleteMutation.mutate(note)}
                            disabled={deleteMutation.loading()}
                            label={isOwn() ? "Delete note" : "Delete note as admin"}
                          >
                            <i class="ti ti-trash" aria-hidden="true" />
                          </IconButton>
                        </Tooltip.Anchor>
                      </>
                    ) : undefined
                  }
                >
                  <Show when={isEditing()} fallback={<MarkdownView markdown={note.content} smallHeadings />}>
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
    </Discussion>
  );
}
