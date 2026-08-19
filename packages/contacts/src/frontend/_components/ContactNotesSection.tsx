import { dates, type Paginated } from "@k2b/stdlib";
import { mutation as mutations, query } from "@k2b/stdlib/solid";
import { Avatar, Button, Discussion, IconButton, MarkdownView, prompts, Tooltip, toast } from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ContactNote } from "../../service";
import { readErrorMessage } from "./api";
import { createContactQuerySource, parseContactQuerySource } from "./contact-query-source";
import { listenForContactsLiveInvalidation } from "./contacts-live";
import { CONTACT_NOTE_COMPOSE_EVENT } from "./context";

type Props = {
  bookId: string;
  contactId: string;
  currentUserId: string;
  initialNotesPage?: Paginated<ContactNote>;
  /** Whether the current user has write access to the book. Hides compose + edit/delete when false. */
  canWrite: boolean;
};

/**
 * Notes timeline for a contact. Authors can correct a new note briefly; after
 * that the panel presents it as immutable chronological context.
 */
export default function ContactNotesSection(props: Props) {
  const perPage = props.initialNotesPage?.perPage ?? 30;
  const emptyPage: Paginated<ContactNote> = { items: [], page: 1, perPage, total: 0, hasNext: false };
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = createSignal(false);
  let sectionRoot: HTMLElement | undefined;
  let disposed = false;
  const initialSource = createContactQuerySource({ bookId: props.bookId, contactId: props.contactId });
  const source = () => createContactQuerySource({ bookId: props.bookId, contactId: props.contactId });

  const notesQuery = query.createInfinite<string, Paginated<ContactNote>, number>({
    source,
    ...(props.initialNotesPage ? { initial: { source: initialSource, pages: [props.initialNotesPage] } } : {}),
    loadPage: async (currentSource, { cursor, abortSignal }) => {
      const { bookId, contactId } = parseContactQuerySource(currentSource);
      const res = await apiClient.books[":bookId"].contacts[":contactId"].notes.page.$get(
        {
          param: { bookId, contactId },
          query: { page: String(cursor ?? 1), per_page: String(perPage) },
        },
        { init: { signal: abortSignal } },
      );
      if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load notes"));
      return res.json();
    },
    getNextCursor: (page) => (page.hasNext ? page.page + 1 : null),
    subscribe: ({ invalidate }) =>
      listenForContactsLiveInvalidation("notes", (event) => {
        if (event.type !== "notes.changed" || event.bookId !== props.bookId || event.contactId !== props.contactId) return;
        return invalidate();
      }),
  });
  const notesPage = createMemo(() => {
    const pages = notesQuery.pages();
    const first = pages[0] ?? emptyPage;
    const last = pages.at(-1) ?? first;
    const seen = new Set<string>();
    const items = pages
      .flatMap((page) => page.items)
      .filter((note) => {
        if (seen.has(note.id)) return false;
        seen.add(note.id);
        return true;
      })
      .reverse();
    return { ...last, items, total: Math.max(first.total, last.total) };
  });

  createEffect(() => {
    void source();
    setComposerOpen(false);
    setEditingId(null);
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
    void notesQuery.invalidate().catch(() => toast.error("The comment was saved, but the comments list could not be reloaded."));
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
        setComposerOpen(false);
      }
      toast.success("Comment added");
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
      }
      toast.success("Comment updated");
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
      toast.success("Comment deleted");
      reconcile(target);
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteNote = async (note: ContactNote) => {
    if (disposed || deleteConfirming() || deleteMutation.loading()) return;
    const target = { bookId: props.bookId, contactId: props.contactId, noteId: note.id };
    setDeleteConfirming(true);
    try {
      const confirmed = await prompts.confirm("Delete this comment? This cannot be undone.", {
        title: "Delete comment",
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
  };

  const cancelEdit = () => {
    setEditingId(null);
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
      label="Comments"
      icon="ti ti-message"
      count={notesPage().total}
      actions={
        props.canWrite && !composerOpen() ? (
          <Button variant="ghost" size="xs" onClick={() => setComposerOpen(true)}>
            <i class="ti ti-plus" aria-hidden="true" /> Add comment
          </Button>
        ) : undefined
      }
      data-contacts-editor={composerOpen() || editingId() ? "true" : undefined}
    >
      <Show when={props.canWrite && composerOpen()}>
        <Discussion.Composer
          label="Add comment"
          placeholder="Write a comment in markdown…"
          submitLabel="Post comment"
          cancelLabel="Cancel"
          onCancel={() => setComposerOpen(false)}
          lines={5}
          onSubmit={async (content) => {
            await createMutation.mutate({ bookId: props.bookId, contactId: props.contactId, content });
            return createMutation.error() === null;
          }}
        />
      </Show>

      <Discussion.List
        loading={(notesQuery.loading() || notesQuery.refreshing()) && notesPage().items.length === 0}
        loadingLabel="Loading comments"
        error={notesQuery.error()?.message}
        onRetry={() => notesQuery.refresh()}
        hasMore={notesPage().hasNext}
        loadingMore={notesQuery.loadingMore()}
        loadMoreLabel="Load earlier comments"
        onLoadMore={() => notesQuery.loadMore()}
      >
        <For each={notesPage().items}>
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
                  props.canWrite && !isEditing() && (note.canEdit || note.canDelete) ? (
                    <>
                      <Show when={note.canEdit && isOwn()}>
                        <Tooltip.Anchor content="Edit comment">
                          <IconButton variant="ghost" size="xs" onClick={() => startEdit(note)} label="Edit comment">
                            <i class="ti ti-pencil" aria-hidden="true" />
                          </IconButton>
                        </Tooltip.Anchor>
                      </Show>
                      <Show when={note.canDelete && isOwn()}>
                        <Tooltip.Anchor content="Delete comment">
                          <IconButton
                            variant="ghost"
                            size="xs"
                            onClick={() => void deleteNote(note)}
                            disabled={deleteConfirming() || deleteMutation.loading()}
                            label="Delete comment"
                          >
                            <i class="ti ti-trash" aria-hidden="true" />
                          </IconButton>
                        </Tooltip.Anchor>
                      </Show>
                    </>
                  ) : undefined
                }
              >
                <Show when={isEditing()} fallback={<MarkdownView markdown={note.content} headingScale="compact" />}>
                  <Discussion.Composer
                    label="Edit comment"
                    initialValue={note.content}
                    submitLabel="Save comment"
                    cancelLabel="Cancel"
                    onCancel={cancelEdit}
                    lines={3}
                    onSubmit={async (content) => {
                      await updateMutation.mutate({ bookId: props.bookId, contactId: props.contactId, noteId: note.id, content });
                      return updateMutation.error() === null;
                    }}
                  />
                </Show>
              </Discussion.Item>
            );
          }}
        </For>
      </Discussion.List>
    </Discussion>
  );
}
