import { type DateContext, dates } from "@k2b/stdlib";
import { Avatar, Button, Discussion, IconButton, MarkdownView, Placeholder, prompts, TextInput, Tooltip, toast } from "@k2b/ui";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { RecordComment, RecordCommentPage } from "../../../service/record-comments";

type CommentPermissions = { actorUserId: string | null; canWrite: boolean; canModerate: boolean };
type CommentsResponse = RecordCommentPage & { permissions: CommentPermissions };

type Props = {
  endpoint: string;
  title?: string;
  emptyText?: string;
  dateConfig?: DateContext;
};

const responseError = async (response: Response, fallback: string): Promise<string> => {
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string" ? payload.message : fallback;
};

const withCursor = (endpoint: string, cursor: string): string => {
  const url = new URL(endpoint, window.location.origin);
  url.searchParams.set("cursor", cursor);
  return `${url.pathname}${url.search}`;
};

const relativeTime = (value: string, dateConfig?: DateContext): string => {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return dates.formatDate(value, dateConfig);
};

export default function RecordComments(props: Props) {
  const [comments, setComments] = createSignal<RecordComment[]>([]);
  const [permissions, setPermissions] = createSignal<CommentPermissions>({ actorUserId: null, canWrite: false, canModerate: false });
  const [nextCursor, setNextCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [composerOpen, setComposerOpen] = createSignal(false);
  const [body, setBody] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editingBody, setEditingBody] = createSignal("");
  const [savingId, setSavingId] = createSignal<string | null>(null);
  let requestSequence = 0;

  const load = async (cursor?: string, append = false) => {
    const sequence = ++requestSequence;
    append ? setLoadingOlder(true) : setLoading(true);
    if (!append) setError(null);
    try {
      const response = await fetch(cursor ? withCursor(props.endpoint, cursor) : props.endpoint, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not load comments."));
      const page = (await response.json()) as CommentsResponse;
      if (sequence !== requestSequence) return;
      setComments((current) => (append ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
      setPermissions(page.permissions);
    } catch (cause) {
      if (sequence !== requestSequence) return;
      const message = cause instanceof Error ? cause.message : "Could not load comments.";
      if (append) toast.error(message);
      else setError(message);
    } finally {
      if (sequence === requestSequence) {
        setLoading(false);
        setLoadingOlder(false);
      }
    }
  };

  createEffect(() => {
    const endpoint = props.endpoint;
    if (!endpoint) return;
    setComments([]);
    setNextCursor(null);
    setComposerOpen(false);
    setBody("");
    void load();
  });

  const canManage = (comment: RecordComment) =>
    !comment.deletedAt &&
    Boolean(permissions().canModerate || (comment.authorUserId && comment.authorUserId === permissions().actorUserId));

  const post = async () => {
    const normalized = body().trim();
    if (!normalized || submitting()) return;
    const temporaryId = `pending-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    setSubmitting(true);
    setComments((current) => [
      {
        id: temporaryId,
        authorUserId: permissions().actorUserId,
        authorDisplayName: "You",
        authorAvatarHash: null,
        body: normalized,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      ...current,
    ]);
    setBody("");
    try {
      const response = await fetch(props.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: normalized }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not post comment."));
      const created = (await response.json()) as RecordComment;
      setComments((current) => current.map((comment) => (comment.id === temporaryId ? created : comment)));
      setComposerOpen(false);
      toast.success("Comment posted");
    } catch (cause) {
      setComments((current) => current.filter((comment) => comment.id !== temporaryId));
      setBody(normalized);
      prompts.error(cause instanceof Error ? cause.message : "Could not post comment.");
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async (comment: RecordComment) => {
    const normalized = editingBody().trim();
    if (!normalized || savingId()) return;
    setSavingId(comment.id);
    try {
      const response = await fetch(`${props.endpoint}/${encodeURIComponent(comment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: normalized }),
      });
      if (!response.ok) throw new Error(await responseError(response, "Could not update comment."));
      const updated = (await response.json()) as RecordComment;
      setComments((current) => current.map((item) => (item.id === comment.id ? updated : item)));
      setEditingId(null);
      toast.success("Comment updated");
    } catch (cause) {
      prompts.error(cause instanceof Error ? cause.message : "Could not update comment.");
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (comment: RecordComment) => {
    if (
      !(await prompts.confirm("The comment remains visible as deleted in the thread.", {
        title: "Delete comment?",
        variant: "danger",
        confirmText: "Delete",
      }))
    )
      return;
    setSavingId(comment.id);
    try {
      const response = await fetch(`${props.endpoint}/${encodeURIComponent(comment.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response, "Could not delete comment."));
      const now = new Date().toISOString();
      setComments((current) =>
        current.map((item) => (item.id === comment.id ? { ...item, body: null, deletedAt: now, updatedAt: now } : item)),
      );
      toast.success("Comment deleted");
    } catch (cause) {
      prompts.error(cause instanceof Error ? cause.message : "Could not delete comment.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Discussion
      label={props.title ?? "Comments"}
      as="h2"
      surface="bare"
      class="min-w-0"
      actions={
        permissions().canWrite && !composerOpen() ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setComposerOpen(true)}>
            <i class="ti ti-plus" aria-hidden="true" /> Add comment
          </Button>
        ) : undefined
      }
    >
      <Show when={!loading()} fallback={<Placeholder state="loading" align="left" class="px-0 py-2" description="Loading comments…" />}>
        <Show
          when={!error()}
          fallback={
            <Placeholder
              state="error"
              align="left"
              class="px-0 py-2"
              description={error() ?? "Could not load comments."}
              action={
                <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
                  Retry
                </Button>
              }
            />
          }
        >
          <Show
            when={comments().length > 0}
            fallback={<Placeholder align="left" class="px-0 py-2" description={props.emptyText ?? "No comments yet."} />}
          >
            <Show when={nextCursor()}>
              {(cursor) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="self-start"
                  disabled={loadingOlder()}
                  onClick={() => void load(cursor(), true)}
                >
                  <i class={`ti ${loadingOlder() ? "ti-loader-2 animate-spin" : "ti-history"}`} aria-hidden="true" /> Load earlier comments
                </Button>
              )}
            </Show>
            <Discussion.List class="max-h-[24rem] overflow-y-auto overscroll-y-contain pr-1">
              <For each={[...comments()].reverse()}>
                {(comment) => (
                  <Discussion.Item
                    aria-busy={comment.id.startsWith("pending-") ? "true" : undefined}
                    avatar={
                      <Avatar
                        name={comment.authorDisplayName}
                        src={
                          comment.authorUserId && comment.authorAvatarHash
                            ? `/api/accounts/users/${encodeURIComponent(comment.authorUserId)}/avatar?rev=${encodeURIComponent(comment.authorAvatarHash)}`
                            : undefined
                        }
                        size="xs"
                      />
                    }
                    author={comment.authorDisplayName}
                    timestamp={
                      <Tooltip.Anchor content={dates.formatDateTime(comment.createdAt, props.dateConfig)}>
                        <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt, props.dateConfig)}</time>
                      </Tooltip.Anchor>
                    }
                    meta={comment.updatedAt !== comment.createdAt && !comment.deletedAt ? "edited" : undefined}
                    actions={
                      canManage(comment) && !comment.id.startsWith("pending-") ? (
                        <>
                          <Tooltip.Anchor content="Edit comment">
                            <IconButton
                              type="button"
                              label="Edit comment"
                              variant="ghost"
                              size="sm"
                              class="h-7! w-7!"
                              disabled={Boolean(savingId())}
                              onClick={() => {
                                setEditingId(comment.id);
                                setEditingBody(comment.body ?? "");
                              }}
                            >
                              <i class="ti ti-pencil" aria-hidden="true" />
                            </IconButton>
                          </Tooltip.Anchor>
                          <Tooltip.Anchor content="Delete comment">
                            <IconButton
                              type="button"
                              label="Delete comment"
                              variant="ghost"
                              size="sm"
                              class="h-7! w-7! hover:text-danger"
                              disabled={Boolean(savingId())}
                              onClick={() => void remove(comment)}
                            >
                              <i class="ti ti-trash" aria-hidden="true" />
                            </IconButton>
                          </Tooltip.Anchor>
                        </>
                      ) : undefined
                    }
                  >
                    <Show
                      when={editingId() === comment.id}
                      fallback={
                        <Show
                          when={!comment.deletedAt && comment.body}
                          fallback={<p class="mt-1 text-sm italic text-dimmed">Comment deleted</p>}
                        >
                          {(markdown) => <MarkdownView markdown={markdown()} smallHeadings />}
                        </Show>
                      }
                    >
                      <form
                        class="mt-2 flex flex-col gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveEdit(comment);
                        }}
                      >
                        <TextInput
                          aria-label="Edit comment"
                          value={() => editingBody()}
                          onValueChange={setEditingBody}
                          markdown
                          disabled={savingId() === comment.id}
                        />
                        <div class="flex justify-end gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <Button type="submit" size="sm" disabled={!editingBody().trim() || savingId() === comment.id}>
                            Save
                          </Button>
                        </div>
                      </form>
                    </Show>
                  </Discussion.Item>
                )}
              </For>
            </Discussion.List>
          </Show>
        </Show>
      </Show>

      <Show when={permissions().canWrite && composerOpen()}>
        <Discussion.Composer
          onSubmit={(event) => {
            event.preventDefault();
            void post();
          }}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setComposerOpen(false);
                  setBody("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting() || !body().trim()}>
                <i class={`ti ${submitting() ? "ti-loader-2 animate-spin" : "ti-send"}`} aria-hidden="true" /> Post comment
              </Button>
            </>
          }
        >
          <TextInput
            aria-label="Add comment"
            value={() => body()}
            onValueChange={setBody}
            placeholder="Write a comment in Markdown…"
            markdown
            disabled={submitting()}
            onSubmit={() => void post()}
          />
        </Discussion.Composer>
      </Show>
    </Discussion>
  );
}
