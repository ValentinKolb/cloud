import { markdown } from "@valentinkolb/cloud/shared";
import { Avatar, MarkdownView, Placeholder, prompts, TextInput, toast } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { SpaceComment } from "@/contracts";
import { readResponseError } from "../../../lib/response";

type Props = {
  spaceId: string;
  itemId: string;
  comments: SpaceComment[];
  currentUserId: string;
  onUpdate: () => void;
  dateConfig?: DateContext;
  canWrite: boolean;
};

export default function CommentsSection(props: Props) {
  const [newComment, setNewComment] = createSignal("");
  const [composerOpen, setComposerOpen] = createSignal(false);

  const createCommentMutation = mutations.create({
    mutation: async (content: string) => {
      const res = await apiClient[":id"].items[":itemId"].comments.$post({
        param: { id: props.spaceId, itemId: props.itemId },
        json: { content },
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to add comment"));
      }
      return res.json();
    },
    onSuccess: () => {
      setNewComment("");
      setComposerOpen(false);
      toast.success("Comment added");
      props.onUpdate();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteCommentMutation = mutations.create<boolean, string>({
    mutation: async (id: string) => {
      const confirmed = await prompts.confirm("Are you sure? This cannot be undone.", {
        title: "Delete Comment",
        icon: "ti ti-trash",
        variant: "danger",
        confirmText: "Delete",
      });
      if (!confirmed) return false;

      const res = await apiClient[":id"].items[":itemId"].comments[":commentId"].$delete({
        param: { id: props.spaceId, itemId: props.itemId, commentId: id },
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, "Failed to delete comment"));
      }
      await res.json();
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) return;
      toast.success("Comment deleted");
      props.onUpdate();
    },
    onError: (err) => prompts.error(err.message),
  });

  const submitNewComment = () => {
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
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="detail-section-label mb-0">Comments</h3>
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center rounded-md bg-[var(--ui-surface-subtle)] px-2 py-0.5 text-[11px] font-medium text-secondary">
            {props.comments.length} {props.comments.length === 1 ? "comment" : "comments"}
          </span>
          <Show when={props.canWrite && !composerOpen()}>
            <button type="button" class="btn-simple btn-sm" onClick={() => setComposerOpen(true)}>
              <i class="ti ti-plus" /> Add comment
            </button>
          </Show>
        </div>
      </div>

      <Show
        when={sortedComments().length > 0}
        fallback={
          <Placeholder align="left" class="px-0 py-2">
            No comments yet.
          </Placeholder>
        }
      >
        <ol class="flex flex-col gap-3">
          <For each={sortedComments()}>
            {(comment) => (
              <li class="group flex gap-2">
                <Avatar username={comment.userName ?? "Unknown"} userId={comment.userId} avatarHash={comment.userAvatarHash} size="xs" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="truncate text-xs font-medium text-primary">{comment.userName ?? "Unknown"}</span>
                    <span class="text-[11px] text-dimmed" title={dates.formatDateTime(comment.createdAt, props.dateConfig)}>
                      {formatDate(comment.createdAt)}
                    </span>
                    <Show when={props.canWrite && comment.canDelete}>
                      <button
                        type="button"
                        onClick={() => deleteCommentMutation.mutate(comment.id)}
                        disabled={deleteCommentMutation.loading()}
                        class="icon-btn ml-auto h-7 w-7 opacity-100 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 dark:hover:text-red-400"
                        aria-label="Delete comment"
                        title="Delete comment"
                      >
                        <i class="ti ti-trash" />
                      </button>
                    </Show>
                  </div>
                  <div class="mt-1">
                    <MarkdownView html={markdown.render(comment.content)} smallHeadings class="text-sm" />
                  </div>
                </div>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <Show when={props.canWrite && composerOpen()}>
        <form onSubmit={handleSubmit} class="flex flex-col gap-2">
          <TextInput
            value={() => newComment()}
            onInput={setNewComment}
            placeholder="Write a comment in markdown…"
            markdown
            disabled={createCommentMutation.loading()}
            onSubmit={submitNewComment}
          />
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => {
                setNewComment("");
                setComposerOpen(false);
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={createCommentMutation.loading() || !newComment().trim()} class="btn-primary btn-sm">
              {createCommentMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-send" />}
              Post comment
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
}
