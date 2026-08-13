import { type DateContext, dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import { Avatar, Button, Discussion, IconButton, MarkdownEditor, MarkdownView, Placeholder, prompts, Tooltip, toast } from "@k2b/ui";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceComment } from "@/contracts";
import { readResponseError } from "../../../lib/response";

type Props = {
  spaceId: string;
  itemId: string;
  recurrenceId: string | null;
  comments: SpaceComment[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadError?: string;
  onLoadMore: () => void;
  onRetry: () => void;
  currentUserId: string;
  onUpdate: () => void;
  dateConfig?: DateContext;
  canWrite: boolean;
};

export default function CommentsSection(props: Props) {
  const [newComment, setNewComment] = createSignal("");

  const createCommentMutation = mutations.create({
    mutation: async (content: string) => {
      const res = await apiClient[":id"].items[":itemId"].comments.$post({
        param: { id: props.spaceId, itemId: props.itemId },
        query: props.recurrenceId ? { recurrence_id: props.recurrenceId } : {},
        json: { content },
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to add comment"));
      }
      return res.json();
    },
    onSuccess: () => {
      setNewComment("");
      toast.success("Comment added");
      props.onUpdate();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteCommentMutation = mutations.create<void, string>({
    mutation: async (id: string) => {
      const res = await apiClient[":id"].items[":itemId"].comments[":commentId"].$delete({
        param: { id: props.spaceId, itemId: props.itemId, commentId: id },
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to delete comment"));
      }
      await res.json();
    },
    onSuccess: () => {
      toast.success("Comment deleted");
      props.onUpdate();
    },
    onError: (err) => prompts.error(err.message),
  });
  let deletePromptPending = false;
  const deleteComment = async (id: string) => {
    if (deletePromptPending || deleteCommentMutation.loading()) return;
    deletePromptPending = true;
    try {
      const confirmed = await prompts.confirm("Are you sure? This cannot be undone.", {
        title: "Delete Comment",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (confirmed) void deleteCommentMutation.mutate(id);
    } finally {
      deletePromptPending = false;
    }
  };

  const submitNewComment = () => {
    if (createCommentMutation.loading()) return;
    const content = newComment().trim();
    if (!content) return;
    createCommentMutation.mutate(content);
  };

  const handleSubmit = (event: Event) => {
    event.preventDefault();
    submitNewComment();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return dates.formatDate(date, props.dateConfig);
  };

  const sortedComments = () => [...props.comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <Discussion
      label={props.recurrenceId ? "Occurrence comments" : "Comments"}
      icon="ti ti-message"
      count={`${props.total} ${props.total === 1 ? "comment" : "comments"}`}
      style="view-transition-name: space-item-detail-comments"
    >
      <Show when={props.loadError}>
        <div class="flex items-center justify-between gap-2 text-xs text-red-600" role="alert">
          <span>{props.loadError}</span>
          <Button type="button" variant="ghost" size="xs" onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      </Show>
      <Show when={props.canWrite}>
        <Discussion.Composer
          onSubmit={handleSubmit}
          insetAction={
            <Tooltip.Anchor content="Post comment (Ctrl/Cmd+Enter)">
              <IconButton
                type="submit"
                label="Post comment"
                disabled={createCommentMutation.loading() || !newComment().trim()}
                loading={createCommentMutation.loading()}
                size="sm"
                variant="primary"
              >
                <i class="ti ti-send" aria-hidden="true" />
              </IconButton>
            </Tooltip.Anchor>
          }
        >
          <MarkdownEditor
            aria-label="Add comment"
            value={newComment}
            onValueChange={setNewComment}
            placeholder="Write a comment in markdown…"
            lines={4}
            noToolbar
            showStats={false}
            disabled={createCommentMutation.loading()}
            onSubmit={submitNewComment}
          />
        </Discussion.Composer>
      </Show>

      <Show
        when={sortedComments().length > 0}
        fallback={
          <Placeholder
            align="left"
            class="px-0 py-2"
            description={<>{props.recurrenceId ? "No comments for this occurrence yet." : "No comments yet."}</>}
          />
        }
      >
        <Show when={props.hasMore}>
          <Button type="button" variant="ghost" size="xs" class="self-start" disabled={props.loadingMore} onClick={props.onLoadMore}>
            <i class={`ti ${props.loadingMore ? "ti-loader-2 animate-spin" : "ti-history"}`} aria-hidden="true" /> Load earlier comments
          </Button>
        </Show>
        <Discussion.List>
          <For each={sortedComments()}>
            {(comment) => (
              <Discussion.Item
                avatar={
                  <Avatar
                    name={comment.userName ?? "Unknown"}
                    fallback={((comment.userName ?? "Unknown").trim() || "?").slice(0, 2).toUpperCase()}
                    src={
                      comment.userId && comment.userAvatarHash
                        ? `/api/accounts/users/${encodeURIComponent(comment.userId)}/avatar?rev=${encodeURIComponent(comment.userAvatarHash)}`
                        : undefined
                    }
                    size="xs"
                  />
                }
                author={comment.userName ?? "Unknown"}
                timestamp={
                  <time dateTime={comment.createdAt} title={dates.formatDateTime(comment.createdAt, props.dateConfig)}>
                    {formatDate(comment.createdAt)}
                  </time>
                }
                actions={
                  props.canWrite && comment.canDelete ? (
                    <Tooltip.Anchor content="Delete comment">
                      <IconButton
                        label="Delete comment"
                        size="xs"
                        onClick={() => void deleteComment(comment.id)}
                        disabled={deleteCommentMutation.loading()}
                        class="hover:text-red-600 dark:hover:text-red-400"
                      >
                        <i class="ti ti-trash" aria-hidden="true" />
                      </IconButton>
                    </Tooltip.Anchor>
                  ) : undefined
                }
              >
                <MarkdownView markdown={comment.content} headingScale="compact" class="text-sm" />
              </Discussion.Item>
            )}
          </For>
        </Discussion.List>
      </Show>
    </Discussion>
  );
}
