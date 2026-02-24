import { Show, For, createSignal } from "solid-js";
import { apiClient } from "@/spaces/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { markdown } from "@valentinkolb/cloud/lib/shared";
import { TextInput } from "@valentinkolb/cloud/lib/ui";
import { MarkdownView } from "@valentinkolb/cloud/lib/ui";
import type { SpaceComment } from "@/spaces/contracts";

type Props = {
  spaceId: string;
  itemId: string;
  comments: SpaceComment[];
  currentUserId: string;
  onUpdate: () => void;
};

export default function CommentsSection(props: Props) {
  const [newComment, setNewComment] = createSignal("");

  const createCommentMutation = mutations.create({
    mutation: async (content: string) => {
      const res = await apiClient[":id"].items[":itemId"].comments.$post({
        param: { id: props.spaceId, itemId: props.itemId },
        json: { content },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to add comment");
      }
      return res.json();
    },
    onSuccess: () => {
      setNewComment("");
      props.onUpdate();
    },
    onError: (err) => prompts.error(err.message),
  });

  const deleteCommentMutation = mutations.create({
    mutation: async (id: string) => {
      const res = await apiClient[":id"].items[":itemId"].comments[":commentId"].$delete({
        param: { id: props.spaceId, itemId: props.itemId, commentId: id },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error("message" in data ? data.message : "Failed to delete comment");
      }
      return res.json();
    },
    onSuccess: () => props.onUpdate(),
    onError: (err) => prompts.error(err.message),
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const content = newComment().trim();
    if (content) {
      createCommentMutation.mutate(content);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await prompts.confirm("Are you sure? This cannot be undone.", {
      title: "Delete Comment",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (confirmed) {
      deleteCommentMutation.mutate(id);
    }
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
    return date.toLocaleDateString();
  };

  // Sort newest first
  const sortedComments = () => [...props.comments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div class="flex flex-col gap-3">
      {/* Header */}
      <div class="text-xs text-dimmed">
        {props.comments.length > 0 ? `${props.comments.length} comment${props.comments.length > 1 ? "s" : ""}` : "Comments"}
      </div>

      {/* Add comment input */}
      <form onSubmit={handleSubmit} class="flex flex-col gap-1.5">
        <TextInput
          value={() => newComment()}
          onInput={setNewComment}
          placeholder="Comment in markdown ..."
          markdown
          disabled={createCommentMutation.loading()}
          onSubmit={() => {
            const content = newComment().trim();
            if (content) createCommentMutation.mutate(content);
          }}
        />
        <button
          type="submit"
          disabled={createCommentMutation.loading() || !newComment().trim()}
          class="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {createCommentMutation.loading() ? (
            <i class="ti ti-loader-2 animate-spin" />
          ) : (
            <>
              <i class="ti ti-send" />
              Comment
            </>
          )}
        </button>
      </form>

      {/* Comments list - newest first */}
      <div class="flex flex-col gap-2">
        <For each={sortedComments()}>
          {(comment) => (
            <div class="group p-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <div class="flex items-start gap-2">
                <div class="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs shrink-0">
                  {(comment.userName ?? "?").charAt(0).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-dimmed">{comment.userName ?? "Unknown"}</span>
                    <span class="text-xs text-dimmed">{formatDate(comment.createdAt)}</span>
                    <Show when={comment.userId === props.currentUserId}>
                      <button
                        type="button"
                        onClick={() => handleDelete(comment.id)}
                        disabled={deleteCommentMutation.loading()}
                        class="text-xs text-dimmed hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 ml-auto"
                      >
                        <i class="ti ti-trash" />
                      </button>
                    </Show>
                  </div>
                  <div class="mt-0.5">
                    <MarkdownView html={markdown.render(comment.content)} smallHeadings class="text-sm" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
