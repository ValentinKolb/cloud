import { Avatar, DateTimeInput, MarkdownEditor, Placeholder, prompts, Select, Switch, toast } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationCollaboration, ConversationComment, MailAssignableUser } from "../../service/collaboration";
import { readApiError } from "./api-response";

type CollaborationPatch = {
  assigneeUserId?: string | null;
  workStatus?: "open" | "waiting" | "done";
  responseNeeded?: boolean;
  snoozedUntil?: string | null;
};

export default function ConversationCollaborationPanel(props: {
  mailboxId: string;
  conversationId: string;
  currentUserId: string;
  canWrite: boolean;
  initialState: ConversationCollaboration;
  initialComments: ConversationComment[];
  assignableUsers: MailAssignableUser[];
  dateConfig: DateContext;
}) {
  const [state, setState] = createSignal(props.initialState);
  const [comments, setComments] = createSignal(props.initialComments);
  const [commentBody, setCommentBody] = createSignal("");
  const [commentError, setCommentError] = createSignal<string | null>(null);
  const watching = createMemo(() => state().watchers.some((watcher) => watcher.id === props.currentUserId));

  const reload = mutations.create<{ state: ConversationCollaboration; comments: ConversationComment[] }, void>({
    mutation: async () => {
      const [stateResponse, commentsResponse] = await Promise.all([
        apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].collaboration.$get({
          param: { mailboxId: props.mailboxId, conversationId: props.conversationId },
        }),
        apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].comments.$get({
          param: { mailboxId: props.mailboxId, conversationId: props.conversationId },
          query: { limit: "100" },
        }),
      ]);
      if (!stateResponse.ok) throw new Error(await readApiError(stateResponse, "Failed to refresh conversation"));
      if (!commentsResponse.ok) throw new Error(await readApiError(commentsResponse, "Failed to refresh comments"));
      return { state: await stateResponse.json(), comments: (await commentsResponse.json()).items };
    },
    onSuccess: (next) => {
      setState(next.state);
      setComments(next.comments);
    },
  });

  onMount(() => {
    const source = new EventSource(`/api/mail/mailboxes/${props.mailboxId}/events`);
    const onChanged = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { conversationId?: string };
        if (payload.conversationId === props.conversationId) reload.mutate();
      } catch {
        // Ignore malformed events; EventSource reconnects and the next valid event refreshes state.
      }
    };
    source.addEventListener("conversation.changed", onChanged as EventListener);
    onCleanup(() => {
      source.removeEventListener("conversation.changed", onChanged as EventListener);
      source.close();
      reload.abort();
    });
  });

  const update = mutations.create<ConversationCollaboration, CollaborationPatch>({
    mutation: async (patch) => {
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].collaboration.$patch({
        param: { mailboxId: props.mailboxId, conversationId: props.conversationId },
        json: { expectedRevision: state().revision, ...patch },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update conversation"));
      return await response.json();
    },
    onSuccess: setState,
    onError: async (error) => {
      await prompts.error(error.message, { title: "Conversation changed" });
      refreshCurrentPath();
    },
  });

  const toggleWatch = mutations.create<ConversationCollaboration, void>({
    mutation: async () => {
      const route = apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].watchers[":userId"];
      const params = { mailboxId: props.mailboxId, conversationId: props.conversationId, userId: props.currentUserId };
      const response = watching() ? await route.$delete({ param: params }) : await route.$put({ param: params });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update watcher"));
      return await response.json();
    },
    onSuccess: (next) => {
      setState(next);
      toast.success(watching() ? "Watching conversation" : "Stopped watching conversation");
    },
    onError: (error) => prompts.error(error.message),
  });

  const addComment = mutations.create<ConversationComment | null, void>({
    mutation: async () => {
      const body = commentBody().trim();
      if (!body) {
        setCommentError("Write a comment first.");
        return null;
      }
      setCommentError(null);
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].comments.$post({
        param: { mailboxId: props.mailboxId, conversationId: props.conversationId },
        json: { body, mentionUserIds: [] },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add comment"));
      return await response.json();
    },
    onSuccess: (comment) => {
      if (!comment) return;
      setComments((current) => [...current, comment]);
      setCommentBody("");
      toast.success("Comment added");
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <>
      <section class="detail-section">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="detail-section-label mb-0">Collaboration</h2>
          <button type="button" class="btn-simple btn-sm" disabled={toggleWatch.loading()} onClick={() => toggleWatch.mutate()}>
            <i
              class={`ti ${toggleWatch.loading() ? "ti-loader-2 animate-spin" : watching() ? "ti-eye" : "ti-eye-off"}`}
              aria-hidden="true"
            />
            {watching() ? "Watching" : "Watch"}
          </button>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Assignee"
            description="The mailbox member responsible for the next action."
            value={() => state().assignee?.id}
            selectedLabel={() => state().assignee?.displayName}
            onChange={(userId) => update.mutate({ assigneeUserId: userId || null })}
            options={props.assignableUsers.map((user) => ({ id: user.id, label: user.displayName, description: user.description }))}
            clearable
            disabled={!props.canWrite || update.loading()}
          />
          <Select
            label="Status"
            description="Open needs work, waiting is blocked, and done is complete."
            value={() => state().workStatus}
            onChange={(workStatus) => update.mutate({ workStatus: workStatus as CollaborationPatch["workStatus"] })}
            options={[
              { id: "open", label: "Open", icon: "ti ti-circle" },
              { id: "waiting", label: "Waiting", icon: "ti ti-clock-pause" },
              { id: "done", label: "Done", icon: "ti ti-circle-check" },
            ]}
            disabled={!props.canWrite || update.loading()}
          />
        </div>

        <div class="mt-3 flex flex-col gap-3">
          <div>
            <Switch
              label="Response needed"
              value={() => state().responseNeeded}
              onChange={(responseNeeded) => update.mutate({ responseNeeded })}
              disabled={!props.canWrite || update.loading() || state().workStatus === "done"}
            />
            <p class="mt-1 text-xs text-dimmed">Keep this conversation in response-focused views until someone replies.</p>
          </div>
          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1">
              <DateTimeInput
                label="Snooze until"
                description="Hide the conversation from active queue views until this time."
                value={() => state().snoozedUntil}
                onChange={(snoozedUntil) => update.mutate({ snoozedUntil: snoozedUntil || null })}
                dateConfig={props.dateConfig}
                disabled={!props.canWrite || update.loading() || state().workStatus === "done"}
              />
            </div>
            <Show when={state().snoozedUntil}>
              <button
                type="button"
                class="btn-secondary btn-sm mb-0.5 shrink-0"
                disabled={!props.canWrite || update.loading()}
                onClick={() => update.mutate({ snoozedUntil: null })}
              >
                Clear
              </button>
            </Show>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h2 class="detail-section-label">Internal discussion</h2>
        <Show
          when={comments().length > 0}
          fallback={
            <Placeholder
              title="No internal comments"
              description="Add context for everyone who can access this mailbox."
              icon="ti ti-messages"
            />
          }
        >
          <div class="mb-4 flex flex-col gap-3">
            <For each={comments()}>
              {(comment) => (
                <article class="flex items-start gap-2.5">
                  <Avatar
                    username={comment.author.displayName}
                    userId={comment.author.kind === "user" ? comment.author.id : undefined}
                    avatarHash={comment.author.avatarHash}
                    size="sm"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span class="text-xs font-semibold text-primary">{comment.author.displayName}</span>
                      <time
                        class="text-2xs text-dimmed"
                        dateTime={comment.createdAt}
                        title={dates.formatDateTime(comment.createdAt, props.dateConfig)}
                      >
                        {dates.formatDateTimeRelative(comment.createdAt, props.dateConfig)}
                      </time>
                      <Show when={comment.editedAt}>
                        <span class="text-2xs text-dimmed">edited</span>
                      </Show>
                    </div>
                    <p class={`mt-1 whitespace-pre-wrap break-words text-sm ${comment.deletedAt ? "italic text-dimmed" : "text-primary"}`}>
                      {comment.deletedAt ? "Comment deleted" : comment.body}
                    </p>
                  </div>
                </article>
              )}
            </For>
          </div>
        </Show>

        <div>
          <MarkdownEditor
            value={commentBody}
            onInput={setCommentBody}
            onSubmit={() => addComment.mutate()}
            placeholder="Add an internal comment..."
            ariaLabel="Internal comment"
            lines={5}
            noToolbar
            showStats={false}
            error={Boolean(commentError())}
            disabled={addComment.loading()}
          />
          <div class="mt-2 flex items-center justify-between gap-2">
            <p class="text-xs text-red-600 dark:text-red-300" role="alert">
              {commentError()}
            </p>
            <button type="button" class="btn-secondary btn-sm" disabled={addComment.loading()} onClick={() => addComment.mutate()}>
              <i class={`ti ${addComment.loading() ? "ti-loader-2 animate-spin" : "ti-message-plus"}`} aria-hidden="true" /> Add comment
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
