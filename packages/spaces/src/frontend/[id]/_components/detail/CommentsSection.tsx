import { Show, For, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { markdown } from "@valentinkolb/cloud/shared";
import { MarkdownView, TextInput, prompts } from "@valentinkolb/cloud/ui";
import type { SpaceComment } from "@/contracts";

type Props = {
  spaceId: string;
  itemId: string;
  comments: SpaceComment[];
  currentUserId: string;
  onUpdate: () => void;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const getResponseErrorMessage = async (res: Response, fallback: string) => {
  try {
    const data = (await res.json()) as unknown;
    if (isObject(data) && typeof data["message"] === "string" && data["message"].length > 0) {
      return data["message"];
    }
  } catch {}
  return fallback;
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
        throw new Error(await getResponseErrorMessage(res, "Failed to add comment"));
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
        throw new Error(await getResponseErrorMessage(res, "Failed to delete comment"));
      }
      return res.json();
    },
    onSuccess: () => props.onUpdate(),
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

  const handleDelete = async (id: string) => {
    const confirmed = await prompts.confirm("Are you sure? This cannot be undone.", {
      title: "Delete Comment",
      icon: "ti ti-trash",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    deleteCommentMutation.mutate(id);
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

  const sortedComments = () => [...props.comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div class="flex flex-col gap-3">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h3 class="detail-section-label">Comments</h3>
        <span class="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {props.comments.length} {props.comments.length === 1 ? "comment" : "comments"}
        </span>
      </div>

      <div class="flex flex-col gap-3">
        <Show when={sortedComments().length > 0} fallback={<p class="text-xs text-dimmed">No comments yet.</p>}>
          <For each={sortedComments()}>
            {(comment) => (
              <div class={`flex ${comment.userId === props.currentUserId ? "justify-end" : "justify-start"}`}>
                <div
                  class={`group w-[90%] max-w-[90%] border border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50 ${
                    comment.userId === props.currentUserId ? "rounded-xl rounded-br-[2px]" : "rounded-xl rounded-bl-[2px]"
                  }`}
                >
                  <div class="flex items-start gap-2">
                    <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs dark:bg-zinc-700">
                      {(comment.userName ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-xs font-medium text-primary">{comment.userName ?? "Unknown"}</span>
                        <span class="text-xs text-dimmed">{formatDate(comment.createdAt)}</span>
                        <Show when={comment.canDelete}>
                          <button
                            type="button"
                            onClick={() => handleDelete(comment.id)}
                            disabled={deleteCommentMutation.loading()}
                            class="btn-simple ml-auto text-xs text-dimmed hover:text-red-500 disabled:opacity-50"
                          >
                            <i class="ti ti-trash" />
                          </button>
                        </Show>
                      </div>
                      <div class="mt-1">
                        <MarkdownView html={markdown.render(comment.content)} smallHeadings class="text-sm" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      <form onSubmit={handleSubmit} class="flex flex-col gap-1.5">
        <TextInput
          value={() => newComment()}
          onInput={setNewComment}
          placeholder="Comment in markdown ..."
          markdown
          disabled={createCommentMutation.loading()}
          onSubmit={submitNewComment}
        />
        <button
          type="submit"
          disabled={createCommentMutation.loading() || !newComment().trim()}
          class="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createCommentMutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-send" />}
          Comment
        </button>
      </form>
    </div>
  );
}
