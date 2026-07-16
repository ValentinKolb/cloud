import { Avatar, DateTimeInput, MarkdownEditor, Placeholder, prompts, Select, Switch, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationCollaboration, ConversationComment, MailActivityEvent, MailAssignableUser } from "../../service/collaboration";
import type { MessageDetail } from "../../service/messages";
import type { ConversationReminder } from "../../service/reminders";
import { readApiError } from "./api-response";

type CollaborationPatch = {
  assigneeUserId?: string | null;
  workStatus?: "open" | "waiting" | "done";
  responseNeeded?: boolean;
  snoozedUntil?: string | null;
};

const activityLabel = (action: string): string => action.replaceAll("_", " ");

export default function MailDetailsPanel(props: {
  mailboxId: string;
  conversationId: string;
  currentUserId: string;
  canWrite: boolean;
  initialState: ConversationCollaboration;
  initialComments: ConversationComment[];
  assignableUsers: MailAssignableUser[];
  activity: MailActivityEvent[];
  initialReminder: ConversationReminder | null;
  messages: MessageDetail[];
  subject: string;
  dateConfig: DateContext;
  onClose: () => void;
}) {
  const [state, setState] = createSignal(props.initialState);
  const [comments, setComments] = createSignal(props.initialComments);
  const [commentBody, setCommentBody] = createSignal("");
  const [commentError, setCommentError] = createSignal<string | null>(null);
  const [reminder, setReminderValue] = createSignal(props.initialReminder);
  const watching = createMemo(() => state().watchers.some((watcher) => watcher.id === props.currentUserId));
  const latestMessage = () => props.messages.at(-1);
  const attachmentCount = () => props.messages.reduce((total, message) => total + message.attachments.length, 0);
  const addressList = (addresses: Array<{ name: string | null; address: string }>) =>
    addresses.map((address) => address.name || address.address).join(", ");

  createEffect(() => {
    props.conversationId;
    setState(props.initialState);
    setComments(props.initialComments);
    setReminderValue(props.initialReminder);
    setCommentBody("");
    setCommentError(null);
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
      const param = { mailboxId: props.mailboxId, conversationId: props.conversationId, userId: props.currentUserId };
      const response = watching() ? await route.$delete({ param }) : await route.$put({ param });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update watcher"));
      return await response.json();
    },
    onSuccess: (next) => {
      setState(next);
      toast.success(next.watchers.some((watcher) => watcher.id === props.currentUserId) ? "Following conversation" : "Stopped following");
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
    },
    onError: (error) => prompts.error(error.message),
  });

  const removeComment = mutations.create<string | null, ConversationComment>({
    mutation: async (comment) => {
      const confirmed = await prompts.confirm("The comment remains in the audit trail as deleted.", {
        title: "Delete internal comment?",
        confirmText: "Delete comment",
        variant: "danger",
      });
      if (!confirmed) return null;
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].comments[":commentId"].$delete({
        param: { mailboxId: props.mailboxId, conversationId: props.conversationId, commentId: comment.id },
        json: { expectedRevision: comment.revision },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to delete comment"));
      return comment.id;
    },
    onSuccess: (commentId) => {
      if (commentId)
        setComments((current) =>
          current.map((comment) => (comment.id === commentId ? { ...comment, deletedAt: new Date().toISOString(), body: null } : comment)),
        );
    },
    onError: (error) => prompts.error(error.message),
  });

  const saveReminder = mutations.create<ConversationReminder, string>({
    mutation: async (dueAt) => {
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].reminder.$put({
        param: { mailboxId: props.mailboxId, conversationId: props.conversationId },
        json: { dueAt, expectedRevision: reminder()?.revision ?? null },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to set reminder"));
      return await response.json();
    },
    onSuccess: setReminderValue,
    onError: (error) => prompts.error(error.message),
  });

  const cancelReminder = mutations.create<void, void>({
    mutation: async () => {
      const current = reminder();
      if (!current) return;
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].reminder.$delete({
        param: { mailboxId: props.mailboxId, conversationId: props.conversationId },
        json: { expectedRevision: current.revision },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to cancel reminder"));
    },
    onSuccess: () => setReminderValue(null),
    onError: (error) => prompts.error(error.message),
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="detail-header">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <i class="ti ti-users text-lg text-dimmed" aria-hidden="true" />
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold text-primary">Details</h2>
              <p class="text-xs text-dimmed">Team context and conversation activity</p>
            </div>
          </div>
          <button type="button" class="icon-btn" aria-label="Close details" onClick={props.onClose}>
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div class="detail-stack">
        <section class="detail-section">
          <h3 class="detail-section-label">Mail</h3>
          <dl class="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
            <dt class="text-dimmed">Subject</dt>
            <dd class="truncate text-primary" title={props.subject}>
              {props.subject || "(no subject)"}
            </dd>
            <dt class="text-dimmed">From</dt>
            <dd class="truncate text-primary" title={addressList(latestMessage()?.from ?? [])}>
              {addressList(latestMessage()?.from ?? []) || "Unknown"}
            </dd>
            <dt class="text-dimmed">To</dt>
            <dd class="truncate text-primary" title={addressList(latestMessage()?.to ?? [])}>
              {addressList(latestMessage()?.to ?? []) || "Undisclosed"}
            </dd>
            <dt class="text-dimmed">Thread</dt>
            <dd class="text-primary">
              {props.messages.length} message{props.messages.length === 1 ? "" : "s"}
            </dd>
            <Show when={attachmentCount() > 0}>
              <dt class="text-dimmed">Files</dt>
              <dd class="text-primary">
                {attachmentCount()} attachment{attachmentCount() === 1 ? "" : "s"}
              </dd>
            </Show>
            <Show when={latestMessage()?.messageId}>
              <dt class="text-dimmed">Message ID</dt>
              <dd class="truncate font-mono text-2xs text-secondary" title={latestMessage()?.messageId ?? undefined}>
                {latestMessage()?.messageId}
              </dd>
            </Show>
          </dl>
        </section>

        <section class="detail-section">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="detail-section-label mb-0">Ownership</h3>
            <Tooltip content={watching() ? "Stop following this conversation" : "Add yourself as a follower of this conversation"}>
              <button
                type="button"
                class="btn-simple btn-sm"
                disabled={!props.canWrite || toggleWatch.loading()}
                onClick={() => toggleWatch.mutate()}
              >
                <i class={`ti ${watching() ? "ti-bell-filled" : "ti-bell"}`} aria-hidden="true" /> {watching() ? "Following" : "Follow"}
              </button>
            </Tooltip>
          </div>
          <div class="flex flex-col gap-2">
            <Select
              label="Assignee"
              value={() => state().assignee?.id}
              selectedLabel={() => state().assignee?.displayName}
              onChange={(userId) => update.mutate({ assigneeUserId: userId || null })}
              options={props.assignableUsers.map((user) => ({ id: user.id, label: user.displayName, description: user.description }))}
              clearable
              disabled={!props.canWrite || update.loading()}
            />
            <Select
              label="Status"
              value={() => state().workStatus}
              onChange={(workStatus) => update.mutate({ workStatus: workStatus as CollaborationPatch["workStatus"] })}
              options={[
                { id: "open", label: "Open", icon: "ti ti-circle" },
                { id: "waiting", label: "Waiting", icon: "ti ti-clock-pause" },
                { id: "done", label: "Done", icon: "ti ti-circle-check" },
              ]}
              disabled={!props.canWrite || update.loading()}
            />
            <Switch
              label="Response needed"
              value={() => state().responseNeeded}
              onChange={(responseNeeded) => update.mutate({ responseNeeded })}
              disabled={!props.canWrite || update.loading() || state().workStatus === "done"}
            />
            <DateTimeInput
              label="Snooze until"
              value={() => state().snoozedUntil}
              onChange={(value) => update.mutate({ snoozedUntil: value || null })}
              dateConfig={props.dateConfig}
              disabled={!props.canWrite || update.loading() || state().workStatus === "done"}
            />
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <DateTimeInput
                  label="Personal reminder"
                  value={() => reminder()?.dueAt ?? null}
                  onChange={(value) => value && saveReminder.mutate(value)}
                  dateConfig={props.dateConfig}
                  disabled={saveReminder.loading()}
                />
              </div>
              <Show when={reminder()}>
                <button type="button" class="btn-secondary btn-sm mb-0.5" onClick={() => cancelReminder.mutate()}>
                  Clear
                </button>
              </Show>
            </div>
          </div>
        </section>

        <section class="detail-section">
          <h3 class="detail-section-label">Internal comments</h3>
          <Show
            when={comments().length > 0}
            fallback={
              <Placeholder title="No internal comments" description="Add context for everyone with mailbox access." icon="ti ti-messages" />
            }
          >
            <div class="mb-3 flex flex-col gap-3">
              <For each={comments()}>
                {(comment) => (
                  <article class="group flex items-start gap-2.5">
                    <Avatar
                      username={comment.author.displayName}
                      userId={comment.author.kind === "user" ? comment.author.id : undefined}
                      avatarHash={comment.author.avatarHash}
                      size="sm"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="truncate text-xs font-semibold text-primary">{comment.author.displayName}</span>
                        <time class="text-2xs text-dimmed" dateTime={comment.createdAt}>
                          {dates.formatDateTimeRelative(comment.createdAt, props.dateConfig)}
                        </time>
                        <Show when={comment.author.kind === "user" && comment.author.id === props.currentUserId && !comment.deletedAt}>
                          <button
                            type="button"
                            class="icon-btn ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label="Delete comment"
                            onClick={() => removeComment.mutate(comment)}
                          >
                            <i class="ti ti-trash" aria-hidden="true" />
                          </button>
                        </Show>
                      </div>
                      <p
                        class={`mt-1 whitespace-pre-wrap break-words text-sm ${comment.deletedAt ? "italic text-dimmed" : "text-primary"}`}
                      >
                        {comment.deletedAt ? "Comment deleted" : comment.body}
                      </p>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </Show>
          <MarkdownEditor
            value={commentBody}
            onInput={setCommentBody}
            onSubmit={() => addComment.mutate()}
            placeholder="Add internal comment"
            ariaLabel="Internal comment"
            lines={4}
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
              <i class="ti ti-send" aria-hidden="true" /> Comment
            </button>
          </div>
        </section>

        <Show when={props.activity.length > 0}>
          <section class="detail-section">
            <h3 class="detail-section-label">Recent activity</h3>
            <div class="flex flex-col gap-2">
              <For each={props.activity}>
                {(event) => (
                  <div class="flex min-w-0 items-center gap-2 text-xs">
                    <i
                      class={`ti ${event.outcome === "failed" ? "ti-alert-circle text-red-500" : "ti-circle-check text-dimmed"}`}
                      aria-hidden="true"
                    />
                    <span class="min-w-0 flex-1 truncate text-secondary">
                      <span class="font-medium text-primary">{event.actor.displayName}</span> {activityLabel(event.action)}
                    </span>
                    <time class="shrink-0 text-2xs text-dimmed" dateTime={event.createdAt}>
                      {dates.formatDateTimeRelative(event.createdAt, props.dateConfig)}
                    </time>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
      </div>
    </div>
  );
}
