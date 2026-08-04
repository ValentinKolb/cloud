import { type DateContext, dates } from "@k2b/stdlib";
import { mutation as mutations } from "@k2b/stdlib/solid";
import {
  Avatar,
  Button,
  ButtonLink,
  ColorInput,
  DateTimePicker,
  formatFileViewSize,
  IconButton,
  MarkdownEditor,
  MultiSelectInput,
  Placeholder,
  prompts,
  Select,
  StatusBadge,
  TextInput,
  Tooltip,
  toast,
} from "@k2b/ui";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { ConversationCollaboration, ConversationComment, MailActivityEvent, MailAssignableUser } from "../../service/collaboration";
import type { ConversationLocalTags, LocalTag } from "../../service/local-tags";
import type { MessageDetail } from "../../service/messages";
import type { ConversationPresenceParticipant } from "../../service/presence";
import type { ConversationReminder } from "../../service/reminders";
import type { MailDetailErrors } from "../../service/workspace";
import { readApiError } from "./api-response";
import MailConversationContext from "./MailConversationContext";
import { openMailMessageInspector } from "./MailMessageInspectorDialog";
import { getMailAction } from "./mail-actions";
import { presentMailActivity } from "./mail-activity-presentation";
import { listUnavailableMailDetailSections } from "./mail-detail-availability";
import {
  applyMailCollaborationPatch,
  applyMailTagIds,
  createMailDetailUpdateQueue,
  type MailCollaborationPatch,
  queuedCollaborationPatch,
  queuedReminderDueAt,
  queuedTagIds,
} from "./mail-detail-update-queue";
import {
  reconcileAvailableTags,
  reconcileCollaboration,
  reconcileComments,
  reconcileConversationTags,
  reconcileReminder,
} from "./mail-details-reconciliation";

const avatarSource = (userId: string | undefined, avatarHash: string | null): string | undefined =>
  userId && avatarHash ? `/api/accounts/users/${encodeURIComponent(userId)}/avatar?rev=${encodeURIComponent(avatarHash)}` : undefined;

export default function MailDetailsPanel(props: {
  mailboxId: string;
  conversationId: string;
  active: boolean;
  currentUserId: string;
  canWrite: boolean;
  canAdmin: boolean;
  initialState: ConversationCollaboration;
  initialLocalTags: LocalTag[];
  initialConversationLocalTags: ConversationLocalTags;
  initialComments: ConversationComment[];
  assignableUsers: MailAssignableUser[];
  presence: ConversationPresenceParticipant[];
  activity: MailActivityEvent[];
  initialReminder: ConversationReminder | null;
  detailErrors: MailDetailErrors;
  messages: MessageDetail[];
  subject: string;
  flagged: boolean;
  dateConfig: DateContext;
  onCollaborationChange: (state: ConversationCollaboration) => void;
  onConversationTagsChange: (state: ConversationLocalTags) => void;
  onOpenHref: (href: string) => void | Promise<void>;
  onReconcile: () => void | Promise<void>;
}) {
  const [state, setState] = createSignal(props.initialState);
  const [availableTags, setAvailableTags] = createSignal(props.initialLocalTags);
  const [tagState, setTagState] = createSignal(props.initialConversationLocalTags);
  const [comments, setComments] = createSignal(props.initialComments);
  const [commentBody, setCommentBody] = createSignal("");
  const [replyingTo, setReplyingTo] = createSignal<ConversationComment | null>(null);
  const [commentError, setCommentError] = createSignal<string | null>(null);
  const [reminderDueAt, setReminderDueAt] = createSignal(props.initialReminder?.state === "pending" ? props.initialReminder.dueAt : null);
  let confirmedState = props.initialState;
  let confirmedTagState = props.initialConversationLocalTags;
  let confirmedReminder = props.initialReminder;
  let tagController: AbortController | null = null;
  let disposed = false;
  let confirmedAvailableTagIds = new Set(props.initialLocalTags.map((tag) => tag.id));
  const latestMessage = () => props.messages.at(-1);
  const attachmentCount = () => props.messages.reduce((total, message) => total + message.attachments.length, 0);
  const activityItems = createMemo(() => presentMailActivity(props.activity));
  const unavailableSections = createMemo(() => listUnavailableMailDetailSections(props.detailErrors));
  const addressList = (addresses: Array<{ name: string | null; address: string }>) =>
    addresses.map((address) => address.name || address.address).join(", ");

  const applyCollaborationPatch = (current: ConversationCollaboration, patch: MailCollaborationPatch) =>
    applyMailCollaborationPatch(current, patch, props.assignableUsers);

  const applyTagIds = (current: ConversationLocalTags, tagIds: readonly string[]) => applyMailTagIds(current, availableTags(), tagIds);

  type DetailUpdateResult =
    | { kind: "collaboration"; value: ConversationCollaboration }
    | { kind: "tags"; value: ConversationLocalTags }
    | { kind: "reminder"; value: ConversationReminder };

  const detailUpdates = createMailDetailUpdateQueue<DetailUpdateResult>({
    run: async (operation, signal) => {
      const param = { mailboxId: props.mailboxId, conversationId: props.conversationId };
      if (operation.kind === "collaboration") {
        const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].collaboration.$patch(
          { param, json: { expectedRevision: confirmedState.revision, ...operation.patch } },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Failed to update conversation"));
        return { kind: "collaboration", value: await response.json() };
      }
      if (operation.kind === "tags") {
        const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"]["local-tags"].$put(
          { param, json: { expectedRevision: confirmedState.revision, tagIds: operation.tagIds } },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Failed to update tags"));
        return { kind: "tags", value: await response.json() };
      }
      if (operation.kind === "reminder") {
        const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].reminder.$put(
          { param, json: { dueAt: operation.dueAt, expectedRevision: confirmedReminder?.revision ?? null } },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Failed to set reminder"));
        return { kind: "reminder", value: await response.json() };
      }
      if (!confirmedReminder || confirmedReminder.state !== "pending") {
        throw new Error("No pending reminder is available to cancel.");
      }
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].reminder.$delete(
        { param, json: { expectedRevision: confirmedReminder.revision } },
        { init: { signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to cancel reminder"));
      return { kind: "reminder", value: await response.json() };
    },
    onSuccess: (result, _operation, queued) => {
      if (result.kind === "collaboration") {
        confirmedState = reconcileCollaboration(confirmedState, result.value);
        confirmedTagState = {
          ...confirmedTagState,
          conversationRevision: confirmedState.revision,
        };
        setState(applyCollaborationPatch(confirmedState, queuedCollaborationPatch(queued)));
        setTagState((current) => ({ ...current, conversationRevision: confirmedState.revision }));
        props.onCollaborationChange(confirmedState);
        return;
      }
      if (result.kind === "tags") {
        confirmedTagState = reconcileConversationTags(confirmedTagState, result.value);
        confirmedState = {
          ...confirmedState,
          revision: Math.max(confirmedState.revision, confirmedTagState.conversationRevision),
        };
        const pendingTags = queuedTagIds(queued);
        setTagState(pendingTags ? applyTagIds(confirmedTagState, pendingTags) : confirmedTagState);
        setState(applyCollaborationPatch(confirmedState, queuedCollaborationPatch(queued)));
        props.onConversationTagsChange(confirmedTagState);
        return;
      }
      confirmedReminder = reconcileReminder(confirmedReminder, result.value);
      const pendingReminder = queuedReminderDueAt(queued);
      setReminderDueAt(
        pendingReminder.pending ? pendingReminder.dueAt : confirmedReminder?.state === "pending" ? confirmedReminder.dueAt : null,
      );
    },
    onError: async (error) => {
      setState(confirmedState);
      setTagState(confirmedTagState);
      setReminderDueAt(confirmedReminder?.state === "pending" ? confirmedReminder.dueAt : null);
      await prompts.error(error.message, { title: "Conversation changed" });
      await props.onReconcile();
    },
  });

  const updateCollaboration = (patch: MailCollaborationPatch) => {
    setState((current) => applyCollaborationPatch(current, patch));
    detailUpdates.enqueue({ kind: "collaboration", patch });
  };

  const updateConversationTags = (tagIds: string[]) => {
    setTagState((current) => applyTagIds(current, tagIds));
    detailUpdates.enqueue({ kind: "tags", tagIds });
  };

  const updateReminder = (dueAt: string) => {
    setReminderDueAt(dueAt);
    detailUpdates.enqueue({ kind: "reminder", dueAt });
  };

  const clearReminder = () => {
    setReminderDueAt(null);
    detailUpdates.enqueue({ kind: "cancel_reminder" });
  };

  const createTag = async () => {
    const values = await prompts.dialog<{ name: string; color: string } | null>(
      (close) => {
        const [name, setName] = createSignal("");
        const [color, setColor] = createSignal("#6b7280");
        return (
          <form
            class="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name().trim()) close({ name: name().trim(), color: color() });
            }}
          >
            <TextInput label="Name" placeholder="Tag name" value={name} onValueChange={setName} required />
            <ColorInput label="Color" value={color} onValueChange={setColor} />
            <div class="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={!name().trim()}>
                <i class="ti ti-tag-plus" aria-hidden="true" /> Create tag
              </Button>
            </div>
          </form>
        );
      },
      { title: "Create tag", icon: "ti ti-tag-plus" },
    );
    if (!values || disposed) return;
    tagController?.abort();
    const controller = new AbortController();
    tagController = controller;
    try {
      const response = await apiClient.mailboxes[":mailboxId"]["local-tags"].$post(
        {
          param: { mailboxId: props.mailboxId },
          json: values,
        },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to create tag"));
      const created = await response.json();
      if (disposed || tagController !== controller) return;
      confirmedAvailableTagIds.add(created.id);
      setAvailableTags((current) =>
        [...current.filter((tag) => tag.id !== created.id), created].sort((left, right) => left.name.localeCompare(right.name)),
      );
      toast.success(`Created ${created.name}`);
    } catch (error) {
      if (!disposed && tagController === controller && !(error instanceof DOMException && error.name === "AbortError")) {
        await prompts.error(error instanceof Error ? error.message : "Failed to create tag");
      }
    } finally {
      if (tagController === controller) tagController = null;
    }
  };

  const addComment = mutations.create<ConversationComment | null, void>({
    mutation: async (_input, { abortSignal }) => {
      const body = commentBody().trim();
      if (!body) {
        setCommentError("Write a comment first.");
        return null;
      }
      setCommentError(null);
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].comments.$post(
        {
          param: {
            mailboxId: props.mailboxId,
            conversationId: props.conversationId,
          },
          json: {
            body,
            parentCommentId: replyingTo()?.id ?? null,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to add comment"));
      return await response.json();
    },
    onSuccess: (comment) => {
      if (!comment) return;
      setComments((current) => [...current, comment]);
      setCommentBody("");
      setReplyingTo(null);
    },
    onError: (error) => prompts.error(error.message),
  });

  const removeComment = mutations.create<string | null, ConversationComment>({
    mutation: async (comment, { abortSignal }) => {
      const conversationId = props.conversationId;
      const confirmed = await prompts.confirm("The comment remains in the audit trail as deleted.", {
        title: "Delete internal comment?",
        confirmText: "Delete comment",
        variant: "danger",
      });
      if (!confirmed || abortSignal.aborted || conversationId !== props.conversationId) return null;
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].comments[":commentId"].$delete(
        {
          param: {
            mailboxId: props.mailboxId,
            conversationId,
            commentId: comment.id,
          },
          json: { expectedRevision: comment.revision },
        },
        { init: { signal: abortSignal } },
      );
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

  const editComment = mutations.create<ConversationComment | null, ConversationComment>({
    mutation: async (comment, { abortSignal }) => {
      const conversationId = props.conversationId;
      const values = await prompts.form({
        title: "Edit internal comment",
        icon: "ti ti-edit",
        fields: {
          body: {
            type: "text",
            label: "Comment",
            default: comment.body ?? "",
            required: true,
            multiline: true,
            lines: 6,
          },
        },
        confirmText: "Save comment",
      });
      if (!values || abortSignal.aborted || conversationId !== props.conversationId) return null;
      const body = String(values.body ?? "").trim();
      if (!body) throw new Error("Comment cannot be empty");
      const response = await apiClient.mailboxes[":mailboxId"].conversations[":conversationId"].comments[":commentId"].$patch(
        {
          param: {
            mailboxId: props.mailboxId,
            conversationId,
            commentId: comment.id,
          },
          json: {
            expectedRevision: comment.revision,
            body,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to update comment"));
      return response.json();
    },
    onSuccess: (comment) => {
      if (!comment) return;
      setComments((current) => current.map((item) => (item.id === comment.id ? comment : item)));
      toast.success("Comment updated");
    },
    onError: (error) => prompts.error(error.message),
  });

  createEffect(
    on(
      () => props.conversationId,
      () => {
        detailUpdates.reset();
        addComment.abort();
        removeComment.abort();
        editComment.abort();
        confirmedState = props.initialState;
        confirmedTagState = props.initialConversationLocalTags;
        confirmedReminder = props.initialReminder;
        setState(props.initialState);
        setAvailableTags(props.initialLocalTags);
        setTagState(props.initialConversationLocalTags);
        setComments(props.initialComments);
        setReminderDueAt(props.initialReminder?.state === "pending" ? props.initialReminder.dueAt : null);
        confirmedAvailableTagIds = new Set(props.initialLocalTags.map((tag) => tag.id));
        setCommentBody("");
        setReplyingTo(null);
        setCommentError(null);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.initialState,
      (incoming) => {
        confirmedState = reconcileCollaboration(confirmedState, incoming);
        setState(applyCollaborationPatch(confirmedState, queuedCollaborationPatch(detailUpdates.pending())));
      },
    ),
  );
  createEffect(
    on(
      () => props.initialConversationLocalTags,
      (incoming) => {
        confirmedTagState = reconcileConversationTags(confirmedTagState, incoming);
        const pendingTags = queuedTagIds(detailUpdates.pending());
        setTagState(pendingTags ? applyTagIds(confirmedTagState, pendingTags) : confirmedTagState);
      },
    ),
  );
  createEffect(
    on(
      () => props.initialComments,
      (incoming) => setComments((current) => reconcileComments(current, incoming)),
    ),
  );
  createEffect(
    on(
      () => props.initialLocalTags,
      (incoming) => {
        setAvailableTags((current) => {
          const reconciled = reconcileAvailableTags(current, incoming, confirmedAvailableTagIds);
          confirmedAvailableTagIds = reconciled.confirmedIds;
          return reconciled.tags;
        });
      },
    ),
  );
  createEffect(
    on(
      () => props.initialReminder,
      (incoming) => {
        confirmedReminder = reconcileReminder(confirmedReminder, incoming);
        const pendingReminder = queuedReminderDueAt(detailUpdates.pending());
        setReminderDueAt(
          pendingReminder.pending ? pendingReminder.dueAt : confirmedReminder?.state === "pending" ? confirmedReminder.dueAt : null,
        );
      },
    ),
  );

  onCleanup(() => {
    disposed = true;
    tagController?.abort();
    tagController = null;
    addComment.abort();
    removeComment.abort();
    editComment.abort();
    detailUpdates.reset();
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="detail-stack focus:outline-none" data-mail-details-heading tabIndex={-1}>
        <Show when={unavailableSections().length > 0}>
          <section class="detail-section">
            <Placeholder
              state="error"
              variant="compact"
              align="left"
              title="Some conversation details are temporarily unavailable"
              description={`Could not refresh ${unavailableSections().join(", ")}. Previously loaded values remain visible where available.`}
              action={
                <Button variant="secondary" size="sm" type="button" onClick={() => void props.onReconcile()}>
                  <i class="ti ti-refresh" aria-hidden="true" /> Retry
                </Button>
              }
            />
          </section>
        </Show>
        <Show when={props.presence.length > 0}>
          <section class="detail-section">
            <h3 class="detail-section-label">Here now</h3>
            <div class="flex flex-col gap-2">
              <For each={props.presence}>
                {(participant) => (
                  <div class="flex items-center gap-2">
                    <Avatar name={participant.displayName} src={avatarSource(participant.userId, participant.avatarHash)} size="sm" />
                    <span class="min-w-0 flex-1 truncate text-sm text-primary">{participant.displayName}</span>
                    <StatusBadge
                      tone={participant.mode === "composing" ? "running" : "neutral"}
                      label={participant.mode === "composing" ? "Composing" : "Viewing"}
                      icon={participant.mode === "composing" ? "ti ti-pencil" : "ti ti-eye"}
                    />
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>
        <section class="detail-section">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="detail-section-label mb-0">Tags</h3>
            <Tooltip content="Create tag">
              <IconButton type="button" label="Create tag" disabled={!props.canWrite} onClick={() => void createTag()}>
                <i class="ti ti-tag-plus" aria-hidden="true" />
              </IconButton>
            </Tooltip>
          </div>
          <MultiSelectInput
            value={() => tagState().tags.map((tag) => tag.id)}
            onValueChange={updateConversationTags}
            options={availableTags().map((tag) => ({
              id: tag.id,
              label: tag.name,
              icon: "ti ti-tag",
              color: tag.color,
            }))}
            selectedOptions={() =>
              tagState().tags.map((tag) => ({
                id: tag.id,
                label: tag.name,
                icon: "ti ti-tag",
                color: tag.color,
              }))
            }
            placeholder="Select tags"
            clearable
            disabled={!props.canWrite}
          />
        </section>

        <section class="detail-section">
          <div class="mb-3 flex items-center justify-between gap-2">
            <h3 class="detail-section-label mb-0">Workflow</h3>
            <Show when={props.flagged}>
              <StatusBadge tone="warning" label="Flagged" icon={getMailAction("flag").icon} />
            </Show>
          </div>
          <div class="flex flex-col gap-2">
            <Select
              label="Assignee"
              value={() => state().assignee?.id ?? null}
              selectedLabel={() => state().assignee?.displayName}
              onValueChange={(userId) => updateCollaboration({ assigneeUserId: userId || null })}
              options={props.assignableUsers.map((user) => ({
                id: user.id,
                label: user.displayName,
                description: user.description,
              }))}
              clearable
              disabled={!props.canWrite || Boolean(props.detailErrors.assignableUsers)}
            />
            <Select
              label="Status"
              value={() => state().workStatus}
              onValueChange={(workStatus) =>
                updateCollaboration({
                  workStatus: workStatus as MailCollaborationPatch["workStatus"],
                })
              }
              options={[
                { id: "needs_action", label: "Needs action", icon: "ti ti-message-reply" },
                { id: "waiting", label: "Waiting for reply", icon: "ti ti-hourglass" },
                { id: "done", label: "Done", icon: "ti ti-circle-check" },
              ]}
              disabled={!props.canWrite}
            />
            <DateTimePicker
              label="Snooze until"
              value={() => state().snoozedUntil}
              onValueChange={(value) => updateCollaboration({ snoozedUntil: value || null })}
              dateConfig={props.dateConfig}
              disabled={!props.canWrite || state().workStatus === "done"}
            />
            <div class="flex items-end gap-2">
              <div class="min-w-0 flex-1">
                <DateTimePicker
                  label="Personal reminder"
                  value={reminderDueAt}
                  onValueChange={(value) => value && updateReminder(value)}
                  dateConfig={props.dateConfig}
                  disabled={Boolean(props.detailErrors.reminder)}
                />
              </div>
              <Show when={reminderDueAt()}>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  class="mb-0.5"
                  disabled={Boolean(props.detailErrors.reminder)}
                  onClick={clearReminder}
                >
                  Clear
                </Button>
              </Show>
            </div>
          </div>
        </section>

        <MailConversationContext
          mailboxId={props.mailboxId}
          conversationId={props.conversationId}
          active={props.active}
          onOpenHref={props.onOpenHref}
        />

        <section class="detail-section">
          <h3 class="detail-section-label">Team notes</h3>
          <Show
            when={comments().length > 0}
            fallback={
              <Show when={!props.detailErrors.comments}>
                <Placeholder title="No team notes" description="Add context for everyone with mailbox access." icon="ti ti-messages" />
              </Show>
            }
          >
            <div class="mb-3 flex flex-col gap-3">
              <For each={comments()}>
                {(comment) => {
                  const parent = () => comments().find((candidate) => candidate.id === comment.parentCommentId);
                  const canModerate = () =>
                    !comment.deletedAt && (props.canAdmin || (comment.author.kind === "user" && comment.author.id === props.currentUserId));
                  return (
                    <article class="group flex min-w-0 flex-col gap-1.5">
                      <div class="flex min-w-0 items-center gap-2">
                        <Avatar
                          name={comment.author.displayName}
                          src={avatarSource(comment.author.kind === "user" ? comment.author.id : undefined, comment.author.avatarHash)}
                          size="xs"
                        />
                        <span class="truncate text-xs font-semibold text-primary">{comment.author.displayName}</span>
                        <time
                          class="shrink-0 text-[11px] text-dimmed"
                          dateTime={comment.createdAt}
                          title={dates.formatDateTime(comment.createdAt, props.dateConfig)}
                        >
                          {dates.formatDateTimeRelative(comment.createdAt, props.dateConfig)}
                        </time>
                        <span class="ml-auto flex shrink-0 items-center gap-0.5">
                          <Show when={canModerate()}>
                            <span class="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                              <Tooltip content="Edit comment">
                                <IconButton type="button" label="Edit comment" onClick={() => editComment.mutate(comment)}>
                                  <i class="ti ti-edit" aria-hidden="true" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip content="Delete comment">
                                <IconButton type="button" label="Delete comment" onClick={() => removeComment.mutate(comment)}>
                                  <i class="ti ti-trash" aria-hidden="true" />
                                </IconButton>
                              </Tooltip>
                            </span>
                          </Show>
                          <Show when={!comment.deletedAt}>
                            <Tooltip content={`Reply to ${comment.author.displayName}`}>
                              <IconButton
                                type="button"
                                label={`Reply to ${comment.author.displayName}`}
                                onClick={() => {
                                  setReplyingTo(comment);
                                  setCommentBody("");
                                }}
                              >
                                <i class="ti ti-arrow-back-up" aria-hidden="true" />
                              </IconButton>
                            </Tooltip>
                          </Show>
                        </span>
                      </div>
                      <Show when={comment.parentCommentId}>
                        <p class="truncate text-[11px] text-dimmed">
                          <i class="ti ti-arrow-back-up mr-1" aria-hidden="true" />
                          Reply to {parent()?.author.displayName ?? "an earlier comment"}
                        </p>
                      </Show>
                      <p class={`whitespace-pre-wrap break-words text-sm ${comment.deletedAt ? "italic text-dimmed" : "text-primary"}`}>
                        {comment.deletedAt ? "Comment deleted" : comment.body}
                      </p>
                    </article>
                  );
                }}
              </For>
            </div>
          </Show>
          <Show when={!props.detailErrors.comments}>
            <Show when={replyingTo()}>
              {(comment) => (
                <div class="mb-2 flex items-center gap-2 text-xs text-dimmed">
                  <i class="ti ti-arrow-back-up" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">Replying to {comment().author.displayName}</span>
                  <Tooltip content="Cancel reply">
                    <IconButton type="button" label="Cancel reply" onClick={() => setReplyingTo(null)}>
                      <i class="ti ti-x" aria-hidden="true" />
                    </IconButton>
                  </Tooltip>
                </div>
              )}
            </Show>
            <MarkdownEditor
              value={commentBody}
              onValueChange={setCommentBody}
              onSubmit={() => addComment.mutate()}
              placeholder="Add internal comment"
              aria-label="Internal comment"
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
              <Button variant="secondary" size="sm" type="button" disabled={addComment.loading()} onClick={() => addComment.mutate()}>
                <i class="ti ti-send" aria-hidden="true" /> Comment
              </Button>
            </div>
          </Show>
        </section>

        <Show when={props.activity.length > 0}>
          <details class="detail-section group/recent-activity">
            <summary class="flex cursor-pointer list-none items-center justify-between gap-2">
              <span class="detail-section-label mb-0">Recent activity</span>
              <i class="ti ti-chevron-down text-dimmed transition-transform group-open/recent-activity:rotate-180" aria-hidden="true" />
            </summary>
            <div class="mt-3 flex max-h-56 flex-col gap-2 overflow-y-auto overscroll-contain pr-1">
              <For each={activityItems()}>
                {(event) => (
                  <div class="flex min-w-0 items-center gap-2 text-xs">
                    <i
                      class={`ti ${event.outcome === "failed" ? "ti-alert-circle text-red-500" : "ti-circle-check text-dimmed"}`}
                      aria-hidden="true"
                    />
                    <span class="min-w-0 flex-1 truncate text-secondary">
                      <span class="font-medium text-primary">{event.actor.displayName}</span> {event.label}
                      <Show when={event.count > 1}> ({event.count})</Show>
                    </span>
                    <time class="shrink-0 text-xs text-dimmed" dateTime={event.createdAt}>
                      {dates.formatDateTimeRelative(event.createdAt, props.dateConfig)}
                    </time>
                  </div>
                )}
              </For>
            </div>
          </details>
        </Show>

        <details class="detail-section group/mail-details">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-2">
            <span class="detail-section-label mb-0">Mail details</span>
            <i class="ti ti-chevron-down text-dimmed transition-transform group-open/mail-details:rotate-180" aria-hidden="true" />
          </summary>
          <dl class="mt-3 grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-xs">
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
              {props.messages.length} message
              {props.messages.length === 1 ? "" : "s"}
            </dd>
            <Show when={attachmentCount() > 0}>
              <dt class="text-dimmed">Files</dt>
              <dd class="text-primary">
                {attachmentCount()} attachment
                {attachmentCount() === 1 ? "" : "s"}
              </dd>
            </Show>
            <Show when={latestMessage()?.messageId}>
              <dt class="text-dimmed">Message ID</dt>
              <dd class="truncate font-mono text-xs text-secondary" title={latestMessage()?.messageId ?? undefined}>
                {latestMessage()?.messageId}
              </dd>
            </Show>
            <Show when={latestMessage()}>
              {(message) => (
                <>
                  <dt class="text-dimmed">Size</dt>
                  <dd class="text-primary">{formatFileViewSize(message().sizeBytes)}</dd>
                  <dt class="text-dimmed">Content</dt>
                  <dd class="truncate text-primary" title={message().contentType ?? undefined}>
                    {message().contentType ?? "Unavailable"}
                  </dd>
                  <dt class="text-dimmed">Mirror</dt>
                  <dd class="text-primary">{message().hydrationStatus}</dd>
                </>
              )}
            </Show>
          </dl>
          <Show when={latestMessage()}>
            {(message) => (
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() =>
                    void openMailMessageInspector({
                      mailboxId: props.mailboxId,
                      messages: props.messages,
                      initialMessageId: message().id,
                      initialTab: "headers",
                    })
                  }
                >
                  <i class="ti ti-list-details" aria-hidden="true" /> Headers
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() =>
                    void openMailMessageInspector({
                      mailboxId: props.mailboxId,
                      messages: props.messages,
                      initialMessageId: message().id,
                      initialTab: "source",
                    })
                  }
                >
                  <i class="ti ti-code" aria-hidden="true" /> Source
                </Button>
                <Show when={message().sourceAvailable}>
                  <ButtonLink
                    variant="secondary"
                    size="sm"
                    href={`/api/mail/mailboxes/${props.mailboxId}/messages/${message().id}/source`}
                    download={`${message().subject.trim() || "message"}.eml`}
                  >
                    <i class="ti ti-download" aria-hidden="true" /> Download .eml
                  </ButtonLink>
                </Show>
              </div>
            )}
          </Show>
        </details>
      </div>
    </div>
  );
}
