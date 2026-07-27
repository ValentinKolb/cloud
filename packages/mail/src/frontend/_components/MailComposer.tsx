import { navigateTo } from "@k2b/ssr/nav";
import {
  AutocompleteEditor,
  CheckboxCard,
  type Completion,
  MarkdownEditor,
  Panes,
  type PanesNode,
  type PanesValue,
  prompts,
  Select,
  Switch,
  TextInput,
  Tooltip,
  toast,
} from "@valentinkolb/cloud/ui";
import { type DateContext, dates, text } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ComposePreview,
  ComposeSafetyApproval,
  ComposeSafetyReview,
  CreateAttachmentLinkInput,
  CreatedAttachmentLink,
  DraftEditableContent,
  DraftEditableContentInput,
  DraftIntent,
  DraftRecoveryCopy,
  MailCommand,
  MailDraft,
  MailPriority,
  SenderIdentity,
} from "../../contracts";
import { readApiError } from "./api-response";
import { promptAttachmentLinkOptions } from "./attachment-link-ui";
import MailRecipientInput from "./MailRecipientInput";
import { chooseScheduledSendTime } from "./MailScheduleDialog";
import { readMailComposerPanes, readMailUserPreferences, writeMailComposerPanes } from "./MailSettingsStore";
import { type ComposerSeed, createMailDraftSession } from "./mail-draft-session";
import { formatMailRecipients, parseMailRecipients } from "./mail-recipient";

type UploadState = { file: File; progress: number; error: string | null; uploadId: string | null; draftId: string | null };
class ComposeSafetyCancelled extends Error {}
class ComposeSafetyAttachmentRequested extends Error {}

const intentLabel = (intent: DraftIntent): string =>
  intent === "reply" ? "Reply" : intent === "reply_all" ? "Reply all" : intent === "forward" ? "Forward" : "Send";

const intentIcon = (intent: DraftIntent): string =>
  intent === "reply"
    ? "ti-arrow-back-up"
    : intent === "reply_all"
      ? "ti-arrow-back-up-double"
      : intent === "forward"
        ? "ti-arrow-forward-up"
        : "ti-send";

const paneElementVisible = (node: PanesNode, elementId: string): boolean => {
  if (node.type === "split") return node.children.some((child) => paneElementVisible(child, elementId));
  if (!node.elementIds.includes(elementId)) return false;
  if (node.presentation === "stack") return true;
  const activeElementId = node.elementIds.includes(node.activeElementId ?? "") ? node.activeElementId : node.elementIds[0];
  return activeElementId === elementId;
};

export default function MailComposer(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft | null;
  seed?: ComposerSeed;
  surface: "compact" | "full";
  popout?: boolean;
  returnHref: string;
  dateConfig: DateContext;
  canShareAttachments?: boolean;
  onClose?: () => void;
  onQueued?: () => Promise<void>;
}) {
  let attachmentInput: HTMLInputElement | undefined;
  const verifiedIdentities = () => props.identities.filter((identity) => identity.status === "verified");
  const defaultIdentity = () => verifiedIdentities().find((identity) => identity.isDefault) ?? verifiedIdentities()[0];
  const preferences = readMailUserPreferences(props.mailboxId);
  const [identityId, setIdentityId] = createSignal(
    props.initialDraft?.senderIdentityId ??
      (props.seed?.senderIdentityId !== undefined ? (props.seed.senderIdentityId ?? "") : (defaultIdentity()?.id ?? "")),
  );
  const initialIdentity = () => verifiedIdentities().find((identity) => identity.id === identityId()) ?? defaultIdentity();
  const selectedIdentity = () => verifiedIdentities().find((identity) => identity.id === identityId()) ?? null;
  const [to, setTo] = createSignal(props.initialDraft ? formatMailRecipients(props.initialDraft.to) : (props.seed?.to ?? []));
  const [cc, setCc] = createSignal(props.initialDraft ? formatMailRecipients(props.initialDraft.cc) : (props.seed?.cc ?? []));
  const [bcc, setBcc] = createSignal(props.initialDraft ? formatMailRecipients(props.initialDraft.bcc) : []);
  const [subject, setSubject] = createSignal(props.initialDraft?.subject ?? props.seed?.subject ?? "");
  const [body, setBody] = createSignal(props.initialDraft?.body ?? props.seed?.body ?? "");
  const [format, setFormat] = createSignal<"plain" | "markdown">(
    props.initialDraft?.format ?? initialIdentity()?.defaultFormat ?? preferences.composeFormat,
  );
  const [priority, setPriority] = createSignal(props.initialDraft?.priority ?? initialIdentity()?.defaultPriority ?? "normal");
  const [requestDeliveryReceipt, setRequestDeliveryReceipt] = createSignal(
    props.initialDraft?.requestDeliveryReceipt ?? initialIdentity()?.defaultDeliveryReceipt ?? false,
  );
  const [requestReadReceipt, setRequestReadReceipt] = createSignal(
    props.initialDraft?.requestReadReceipt ?? initialIdentity()?.defaultReadReceipt ?? false,
  );
  const deliveryOptionsSummary = createMemo(() => {
    const options: string[] = [];
    if (priority() === "high") options.push("high priority");
    if (priority() === "low") options.push("low priority");
    if (requestDeliveryReceipt()) options.push("delivery receipt");
    if (requestReadReceipt()) options.push("read receipt");
    return options;
  });
  const [includeSourceAttachments, setIncludeSourceAttachments] = createSignal(
    props.seed?.intent === "forward" && (props.seed.sourceAttachmentCount ?? 0) > 0,
  );
  const [uploads, setUploads] = createSignal<UploadState[]>([]);
  const [showCc, setShowCc] = createSignal(
    Boolean(props.initialDraft?.cc.length || props.initialDraft?.bcc.length || props.seed?.cc?.length),
  );
  const [composerPanes, setComposerPanes] = createSignal<PanesValue>(readMailComposerPanes());
  const [preview, setPreview] = createSignal<ComposePreview | null>(null);
  const [previewRevision, setPreviewRevision] = createSignal(0);
  const [handoffInProgress, setHandoffInProgress] = createSignal(false);
  let recoveryController: AbortController | null = null;
  let disposed = false;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let panePersistenceTimer: ReturnType<typeof setTimeout> | null = null;
  const uploadControllers = new Map<File, AbortController>();

  const content = (): DraftEditableContent => ({
    senderIdentityId: identityId(),
    to: parseMailRecipients(to()),
    cc: parseMailRecipients(cc()),
    bcc: parseMailRecipients(bcc()),
    subject: subject(),
    body: body(),
    format: format(),
    priority: priority(),
    requestDeliveryReceipt: requestDeliveryReceipt(),
    requestReadReceipt: requestReadReceipt(),
  });

  const serializedContent = () => JSON.stringify(content());
  const applyDraftContent = (value: DraftEditableContent) => {
    setIdentityId(value.senderIdentityId);
    setTo(formatMailRecipients(value.to));
    setCc(formatMailRecipients(value.cc));
    setBcc(formatMailRecipients(value.bcc));
    setShowCc(Boolean(value.cc.length || value.bcc.length));
    setSubject(value.subject);
    setBody(value.body);
    setFormat(value.format);
    setPriority(value.priority);
    setRequestDeliveryReceipt(value.requestDeliveryReceipt);
    setRequestReadReceipt(value.requestReadReceipt);
  };
  const draftSession = createMailDraftSession({
    mailboxId: props.mailboxId,
    initialDraft: props.initialDraft,
    seed: props.seed,
    hasVerifiedIdentity: () => verifiedIdentities().length > 0,
    includeSourceAttachments,
    content,
    applyDraftContent,
    isDisposed: () => disposed,
    onRecovered: () => toast("Unsaved changes from this browser were restored.", { title: "Draft recovered" }),
  });
  const {
    draft,
    setDraft,
    lease,
    status,
    setStatus,
    statusMessage,
    setStatusMessage,
    beginDraft,
    persist,
    serializeMutation: serializeDraftMutation,
    stopScheduledSave,
    stopHeartbeat,
    acquireLease,
    releaseLease,
    resumeCurrentLease,
  } = draftSession;
  const pendingKey = draftSession.pendingKey;
  const previewMutation = mutations.create<ComposePreview, { draft: DraftEditableContentInput; conversationId: string | null }>({
    mutation: async (input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["compose-preview"].$post(
        {
          param: { mailboxId: props.mailboxId },
          json: input,
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Preview could not be rendered"));
      return await response.json();
    },
    onSuccess: setPreview,
  });
  const editable = createMemo(
    () =>
      verifiedIdentities().length > 0 &&
      status() !== "preparing" &&
      status() !== "readonly" &&
      !handoffInProgress() &&
      (Boolean(lease()) || !draft()),
  );

  const stopPreview = () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
    previewMutation.abort();
  };

  const updateComposerPanes = (value: PanesValue) => {
    setComposerPanes(value);
    if (panePersistenceTimer) clearTimeout(panePersistenceTimer);
    panePersistenceTimer = setTimeout(() => {
      setComposerPanes(writeMailComposerPanes(value));
      panePersistenceTimer = null;
    }, 150);
  };

  const restoreRecoveryCopy = async () => {
    const currentDraft = draft();
    if (!currentDraft || !editable()) return;
    recoveryController?.abort();
    const controller = new AbortController();
    recoveryController = controller;
    try {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["recovery-copies"].$get(
        { param: { mailboxId: props.mailboxId, draftId: currentDraft.id } },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not load draft recovery copies"));
      const copies: DraftRecoveryCopy[] = await response.json();
      if (disposed || recoveryController !== controller) return;
      const unresolved = copies.filter((copy) => !copy.restoredAt);
      if (unresolved.length === 0) {
        setDraft({ ...currentDraft, recoveryCopyCount: 0 });
        return void toast("No unresolved recovery copies remain.", { title: "Draft is current" });
      }
      const labels = new Map(
        unresolved.map((copy, index) => {
          const preview = copy.content.body.trim().replaceAll(/\s+/g, " ").slice(0, 80) || "(empty message)";
          return [
            copy.id,
            `${index + 1}. ${dates.formatDateTimeRelative(copy.createdAt, props.dateConfig)} · ${copy.createdBy.kind} · ${preview}`,
          ];
        }),
      );
      const values = await prompts.form({
        title: "Restore draft changes",
        fields: {
          recoveryCopyId: {
            type: "select",
            label: "Recovery copy",
            options: unresolved.map((copy) => ({ id: copy.id, label: labels.get(copy.id) ?? copy.id })),
            default: unresolved[0]?.id,
            required: true,
          },
        },
        confirmText: "Restore copy",
      });
      if (!values || disposed || recoveryController !== controller) return;
      const selected = unresolved.find((copy) => copy.id === values.recoveryCopyId);
      if (!selected) return void (await prompts.error("The selected recovery copy is no longer available."));
      const currentLease = lease();
      if (!editable() || !currentLease) return void (await prompts.error("This draft is no longer editable in this session."));
      const restoreResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["recovery-copies"][
        ":recoveryCopyId"
      ].restore.$post(
        {
          param: {
            mailboxId: props.mailboxId,
            draftId: currentDraft.id,
            recoveryCopyId: selected.id,
          },
          json: { expectedRevision: currentDraft.revision, leaseToken: currentLease.token },
        },
        { init: { signal: controller.signal } },
      );
      if (!restoreResponse.ok) throw new Error(await readApiError(restoreResponse, "Could not restore draft changes"));
      const restored = await restoreResponse.json();
      if (disposed || recoveryController !== controller) return;
      setDraft(restored);
      applyDraftContent(restored);
      draftSession.markCurrentContentSaved();
      localStorage.removeItem(draftSession.draftKey(restored.id));
      setStatus("saved");
      setStatusMessage("");
      toast.success("Draft changes restored");
    } catch (error) {
      if (!disposed && recoveryController === controller && !(error instanceof DOMException && error.name === "AbortError")) {
        await prompts.error(error instanceof Error ? error.message : "Could not restore draft changes");
      }
    } finally {
      if (recoveryController === controller) recoveryController = null;
    }
  };

  createEffect(() => {
    if (typeof window === "undefined") return;
    const previewDraft = content();
    serializedContent();
    previewRevision();
    if (format() !== "markdown" || !paneElementVisible(composerPanes().root, "preview") || !identityId()) {
      stopPreview();
      return;
    }
    stopPreview();
    previewTimer = setTimeout(
      () =>
        void previewMutation.mutate({
          draft: previewDraft,
          conversationId: draft()?.conversationId ?? props.seed?.conversationId ?? null,
        }),
      250,
    );
  });

  onCleanup(() => {
    disposed = true;
    recoveryController?.abort();
    recoveryController = null;
    for (const controller of uploadControllers.values()) controller.abort();
    uploadControllers.clear();
    stopPreview();
    if (panePersistenceTimer) {
      clearTimeout(panePersistenceTimer);
      writeMailComposerPanes(composerPanes());
    }
  });

  const uploadFile = async (file: File) => {
    const controller = new AbortController();
    uploadControllers.get(file)?.abort();
    uploadControllers.set(file, controller);
    setUploads((current) => [
      ...current.filter((entry) => entry.file !== file),
      { file, progress: 0, error: null, uploadId: null, draftId: null },
    ]);
    try {
      const saved = await persist();
      if (!saved) throw new Error("Save the draft before attaching files.");
      const createResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"].$post(
        {
          param: { mailboxId: props.mailboxId, draftId: saved.id },
          json: { filename: file.name, contentType: file.type || "application/octet-stream", byteLength: file.size },
        },
        { init: { signal: controller.signal } },
      );
      if (!createResponse.ok) throw new Error(await readApiError(createResponse, `Failed to attach ${file.name}`));
      const upload = await createResponse.json();
      setUploads((current) => current.map((entry) => (entry.file === file ? { ...entry, uploadId: upload.id, draftId: saved.id } : entry)));
      for (let offset = 0; offset < file.size; offset += upload.chunkSize) {
        const chunk = file.slice(offset, Math.min(file.size, offset + upload.chunkSize));
        const response = await fetch(
          `/api/mail/mailboxes/${props.mailboxId}/drafts/${saved.id}/attachment-uploads/${upload.id}?offset=${offset}`,
          { method: "PATCH", headers: { "Content-Type": "application/octet-stream" }, body: chunk, signal: controller.signal },
        );
        if (!response.ok) throw new Error(await readApiError(response, `Failed to upload ${file.name}`));
        const progress = file.size === 0 ? 100 : Math.round((Math.min(file.size, offset + chunk.size) / file.size) * 100);
        setUploads((current) => current.map((entry) => (entry.file === file ? { ...entry, progress } : entry)));
      }
      await serializeDraftMutation(async () => {
        const latest = draft() ?? saved;
        const finalizeResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"][
          ":uploadId"
        ].finalize.$post(
          {
            param: { mailboxId: props.mailboxId, draftId: saved.id, uploadId: upload.id },
            json: { expectedRevision: latest.revision },
          },
          { init: { signal: controller.signal } },
        );
        if (!finalizeResponse.ok) throw new Error(await readApiError(finalizeResponse, `Failed to finalize ${file.name}`));
        setDraft(await finalizeResponse.json());
      });
      setUploads((current) => current.filter((entry) => entry.file !== file));
    } finally {
      if (uploadControllers.get(file) === controller) uploadControllers.delete(file);
    }
  };

  const cancelUpload = async (upload: UploadState) => {
    uploadControllers.get(upload.file)?.abort();
    uploadControllers.delete(upload.file);
    if (upload.uploadId && upload.draftId) {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"][":uploadId"].$delete({
        param: { mailboxId: props.mailboxId, draftId: upload.draftId, uploadId: upload.uploadId },
      });
      if (!response.ok) throw new Error(await readApiError(response, `Failed to cancel upload for ${upload.file.name}`));
    }
    setUploads((current) => current.filter((entry) => entry.file !== upload.file));
  };

  const retryUpload = async (upload: UploadState) => {
    try {
      await cancelUpload(upload);
      await uploadFile(upload.file);
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : `Failed to retry ${upload.file.name}`);
    }
  };

  const addFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        await uploadFile(file);
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        setUploads((current) =>
          current.map((entry) =>
            entry.file === file ? { ...entry, error: error instanceof Error ? error.message : "Upload failed" } : entry,
          ),
        );
      }
    }
  };

  const removeAttachment = (attachmentId: string) =>
    serializeDraftMutation(async () => {
      const currentDraft = draft();
      if (!currentDraft) return;
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].attachments[":attachmentId"].$delete({
        param: { mailboxId: props.mailboxId, draftId: currentDraft.id, attachmentId },
        query: { expectedRevision: String(currentDraft.revision) },
      });
      if (!response.ok) return await prompts.error(await readApiError(response, "Failed to remove attachment"));
      setDraft(await response.json());
    });

  const shareAttachment = mutations.create<CreatedAttachmentLink, { attachmentId: string; input: CreateAttachmentLinkInput }>({
    mutation: async ({ attachmentId, input }, { abortSignal }) => {
      const currentDraft = draft();
      if (!currentDraft) throw new Error("Save the draft before sharing an attachment.");
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].attachments[":attachmentId"].links.$post(
        {
          param: { mailboxId: props.mailboxId, draftId: currentDraft.id, attachmentId },
          json: input,
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to share attachment"));
      return response.json();
    },
    onSuccess: ({ link, url }) => {
      const label = link.filename ?? "Download attachment";
      const insertion = format() === "markdown" ? `[${label.replaceAll("]", "\\]")}](${url})` : url;
      setBody((current) => `${current}${current.endsWith("\n") || !current ? "" : "\n\n"}${insertion}`);
      toast.success("Public attachment link inserted");
    },
    onError: (error) => prompts.error(error.message),
  });

  const insertAttachmentLink = async (attachmentId: string) => {
    const input = await promptAttachmentLinkOptions();
    if (input) shareAttachment.mutate({ attachmentId, input });
  };

  const validateDelivery = () => {
    if (uploads().length > 0) throw new Error("Finish or cancel attachment uploads before sending.");
    if (to().length + cc().length + bcc().length === 0) throw new Error("Add at least one recipient.");
    if (!body().trim() && !(draft()?.attachments.length ?? 0)) {
      throw new Error("Write a message or attach a file before sending.");
    }
  };

  const reviewSafety = async (
    saved: MailDraft,
    scheduled: boolean,
    abortSignal: AbortSignal,
  ): Promise<ComposeSafetyApproval | undefined> => {
    const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["safety-review"].$post(
      {
        param: { mailboxId: props.mailboxId, draftId: saved.id },
        json: { expectedRevision: saved.revision },
      },
      { init: { signal: abortSignal } },
    );
    if (!response.ok) throw new Error(await readApiError(response, "Could not review message safety"));
    const review: ComposeSafetyReview = await response.json();
    if (review.warnings.length === 0) return undefined;
    const choice = await prompts.dialog<"approve" | "attachment">(
      (close) => (
        <div class="flex flex-col gap-3">
          <div class="flex max-h-[45vh] flex-col gap-2 overflow-y-auto">
            <For each={review.warnings}>
              {(warning) => (
                <div class="flex items-start gap-3 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3">
                  <i class="ti ti-alert-triangle mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-primary">{warning.title}</p>
                    <p class="mt-1 text-xs leading-5 text-secondary">{warning.description}</p>
                  </div>
                </div>
              )}
            </For>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close(undefined)}>
              Cancel
            </button>
            <Show when={review.warnings.some((warning) => warning.id === "missing_attachment")}>
              <button type="button" class="btn-secondary btn-sm" onClick={() => close("attachment")}>
                <i class="ti ti-paperclip" aria-hidden="true" /> Add attachment
              </button>
            </Show>
            <button type="button" class="btn-primary btn-sm" onClick={() => close("approve")}>
              {scheduled ? "Schedule anyway" : "Send anyway"}
            </button>
          </div>
        </div>
      ),
      { title: "Review before sending", icon: "ti ti-shield-check", size: "small" },
    );
    if (abortSignal.aborted) throw new DOMException("Aborted", "AbortError");
    if (choice === "attachment") throw new ComposeSafetyAttachmentRequested();
    if (choice !== "approve") throw new ComposeSafetyCancelled();
    return {
      revision: review.revision,
      fingerprint: review.fingerprint,
      warningIds: review.warnings.map((warning) => warning.id),
    };
  };

  const send = mutations.create<MailCommand, { scheduledAt?: string }, { scheduledAt?: string }>({
    onBefore: (delivery) => delivery,
    mutation: async (delivery, { abortSignal }) => {
      validateDelivery();
      const saved = await persist();
      if (!saved) throw new Error(statusMessage());
      const safetyApproval = await reviewSafety(saved, Boolean(delivery.scheduledAt), abortSignal);
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post(
        {
          param: { mailboxId: props.mailboxId },
          json: {
            kind: "send",
            draftId: saved.id,
            expectedDraftRevision: saved.revision,
            senderIdentityId: identityId(),
            scheduledAt: delivery.scheduledAt,
            undoSeconds: delivery.scheduledAt ? 0 : preferences.undoSeconds,
            safetyApproval,
            idempotencyKey: crypto.randomUUID(),
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Failed to queue message"));
      const command = await response.json();
      localStorage.removeItem(draftSession.draftKey(saved.id));
      return command;
    },
    onSuccess: (_command, delivery) => {
      const onClose = props.onClose;
      const onQueued = props.onQueued;
      const fullSurface = props.surface === "full";
      const returnHref = props.returnHref;
      const scheduled = Boolean(delivery?.scheduledAt);
      toast.success(
        scheduled
          ? `Delivery scheduled for ${dates.formatDateTime(delivery!.scheduledAt!, props.dateConfig)}`
          : preferences.undoSeconds > 0
            ? "Message queued. You can undo it directly in the conversation."
            : "Message queued",
      );
      onClose?.();
      if (onQueued) {
        void onQueued().catch((error: unknown) => {
          console.warn("Could not refresh the conversation after queueing a message", error);
        });
      }
      if (fullSurface) navigateTo(returnHref);
    },
    onError: (error) => {
      if (error instanceof ComposeSafetyAttachmentRequested) {
        attachmentInput?.click();
        return;
      }
      if (error instanceof ComposeSafetyCancelled) return;
      return prompts.error(error.message);
    },
  });

  const schedule = async () => {
    try {
      validateDelivery();
    } catch (error) {
      return await prompts.error(error instanceof Error ? error.message : "Message is not ready to schedule");
    }
    const scheduledAt = await chooseScheduledSendTime(props.dateConfig);
    if (!disposed && scheduledAt) send.mutate({ scheduledAt });
  };

  const editDeliveryOptions = () =>
    prompts.dialog<boolean>(
      (close) => {
        const [nextPriority, setNextPriority] = createSignal<MailPriority>(priority());
        const [nextDeliveryReceipt, setNextDeliveryReceipt] = createSignal(requestDeliveryReceipt());
        const [nextReadReceipt, setNextReadReceipt] = createSignal(requestReadReceipt());
        const deliveryReceiptSupported = () => selectedIdentity()?.transport.capabilities.dsn === true;
        const save = () => {
          setPriority(nextPriority());
          setRequestDeliveryReceipt(nextDeliveryReceipt());
          setRequestReadReceipt(nextReadReceipt());
          beginDraft();
          close(true);
        };

        return (
          <div class="flex flex-col gap-3">
            <Select
              label="Priority"
              description="Recipients may see high or low importance when their mail client supports it."
              value={nextPriority}
              onChange={(value) => setNextPriority(value === "high" ? "high" : value === "low" ? "low" : "normal")}
              options={[
                { id: "normal", label: "Normal" },
                { id: "high", label: "High", icon: "ti ti-arrow-up" },
                { id: "low", label: "Low", icon: "ti ti-arrow-down" },
              ]}
            />
            <CheckboxCard
              label="Request a delivery receipt"
              description={
                deliveryReceiptSupported()
                  ? "Ask the sending server to report delivery or failure. Receiving servers may not return a report."
                  : "The selected sending server does not advertise delivery receipts."
              }
              icon="ti ti-mail-check"
              value={nextDeliveryReceipt}
              onChange={setNextDeliveryReceipt}
              disabled={!deliveryReceiptSupported()}
            />
            <CheckboxCard
              label="Request a read receipt"
              description="Ask recipients to confirm opening the message. They may decline or their mail client may ignore the request."
              icon="ti ti-eye-check"
              value={nextReadReceipt}
              onChange={setNextReadReceipt}
            />
            <div class="info-block-note flex items-start gap-2 text-xs">
              <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
              <p>Receipt requests are optional signals, not proof that a message was delivered or read.</p>
            </div>
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn-secondary btn-sm" onClick={() => close(false)}>
                Cancel
              </button>
              <button type="button" class="btn-primary btn-sm" onClick={save}>
                <i class="ti ti-check" aria-hidden="true" />
                Apply
              </button>
            </div>
          </div>
        );
      },
      { title: "Delivery options", icon: "ti ti-adjustments", size: "large" },
    );

  const discard = mutations.create<boolean, void>({
    mutation: async (_input, { abortSignal }) => {
      if (uploads().length > 0) throw new Error("Cancel attachment uploads before discarding this draft.");
      if (!draft()) return true;
      const confirmed = await prompts.confirm("This removes the shared draft for everyone with mailbox access.", {
        title: "Discard draft?",
        confirmText: "Discard draft",
        variant: "danger",
      });
      if (!confirmed || abortSignal.aborted) return false;
      stopScheduledSave();
      await serializeDraftMutation(async () => {
        const currentDraft = draft();
        if (!currentDraft) return;
        const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].discard.$post(
          {
            param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
            json: { expectedRevision: currentDraft.revision },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Failed to discard draft"));
        localStorage.removeItem(draftSession.draftKey(currentDraft.id));
        localStorage.removeItem(pendingKey);
      });
      return true;
    },
    onSuccess: (discarded) => {
      if (!discarded) return;
      props.onClose?.();
      if (props.surface === "full") navigateTo(props.returnHref);
    },
    onError: (error) => prompts.error(error.message),
  });
  onCleanup(() => {
    shareAttachment.abort();
    send.abort();
    discard.abort();
  });

  const closeComposer = async () => {
    if (handoffInProgress()) return;
    if (uploads().length > 0) {
      return await prompts.error("Finish or cancel attachment uploads before closing this draft.");
    }
    const hasDraftWork = Boolean(draft() || draftSession.initializing() || localStorage.getItem(pendingKey));
    if (!hasDraftWork) return props.onClose?.();
    if (draft() && !lease() && serializedContent() === draftSession.lastSavedContent()) return props.onClose?.();
    setHandoffInProgress(true);
    stopScheduledSave();
    try {
      const currentDraft = await persist();
      if (disposed) return;
      if (!currentDraft) throw new Error(statusMessage() || "Draft could not be saved");
      await releaseLease(currentDraft);
      if (disposed) return;
      props.onClose?.();
    } catch (error) {
      if (disposed) return;
      setHandoffInProgress(false);
      await prompts.error(error instanceof Error ? error.message : "Draft could not be closed safely");
    }
  };

  const draftHref = (draftId: string, popout = false) =>
    `/app/mail/${props.mailboxId}/compose/${draftId}?return=${encodeURIComponent(props.returnHref)}${popout ? "&window=1" : ""}`;

  const handoffTo = async (href: string | ((draftId: string) => string), popup?: Window): Promise<void> => {
    if (handoffInProgress()) return;
    if (uploads().length > 0) {
      popup?.close();
      await prompts.error("Finish or cancel attachment uploads before moving this draft.");
      return;
    }
    setHandoffInProgress(true);
    stopScheduledSave();
    let releasedDraft: MailDraft | null = null;
    try {
      const currentDraft = await persist();
      if (disposed) return void popup?.close();
      if (!currentDraft) throw new Error(statusMessage());
      await releaseLease(currentDraft);
      if (disposed) return void popup?.close();
      releasedDraft = currentDraft;
      const target = typeof href === "function" ? href(currentDraft.id) : href;
      if (popup) {
        popup.name = `mail-draft-${currentDraft.id}`;
        popup.location.replace(target);
        props.onClose?.();
        if (props.surface === "full") navigateTo(props.returnHref);
        return;
      }
      navigateTo(target);
    } catch (error) {
      popup?.close();
      if (disposed) return;
      if (releasedDraft && !disposed) {
        try {
          await acquireLease(releasedDraft);
        } catch {
          setStatus("readonly");
          setStatusMessage("Draft editing could not be restored. Reload or take over the draft.");
        }
      }
      setHandoffInProgress(false);
      await prompts.error(error instanceof Error ? error.message : "Could not switch composer surface");
    }
  };

  const openFullSize = () => {
    void handoffTo((draftId) => draftHref(draftId));
  };

  const openWindow = () => {
    const popup = window.open("about:blank", "", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
    if (!popup) return void prompts.error("Allow pop-up windows to open this draft in a separate window.");
    void handoffTo((draftId) => draftHref(draftId, true), popup);
  };

  const takeOver = async () => {
    const currentDraft = draft();
    if (!currentDraft) return;
    const confirmed = await prompts.confirm("The other editing session becomes read-only.", {
      title: "Take over draft?",
      confirmText: "Take over",
    });
    if (!confirmed || disposed) return;
    stopHeartbeat();
    const acquired = await acquireLease(currentDraft, true);
    if (!disposed && acquired) {
      setStatus("saved");
      setStatusMessage("Draft editing taken over");
    }
  };

  const composerIntent = () => draft()?.intent ?? props.seed?.intent ?? "new";
  const retryPreview = () => setPreviewRevision((revision) => revision + 1);

  const slashCompletion = createMemo<Completion[]>(() => [
    {
      trigger: "/",
      dropdown: true,
      debounceMs: 180,
      suggest: async (query, context, signal) => {
        const response = await apiClient.mailboxes[":mailboxId"]["compose-suggestions"].$post(
          {
            param: { mailboxId: props.mailboxId },
            json: {
              query,
              draft: content(),
              conversationId: draft()?.conversationId ?? props.seed?.conversationId ?? null,
            },
          },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Compose templates could not be loaded"));
        const suggestions = await response.json();
        return suggestions.map((suggestion) => ({
          text: `/${suggestion.shortcut}`,
          label: suggestion.name,
          hint: suggestion.kind,
          textEdit: {
            start: context.tokenStart,
            end: context.caret,
            text: suggestion.markdown,
          },
        }));
      },
    },
  ]);

  const writeSurface = (fill = false) => (
    <Show
      when={format() === "markdown"}
      fallback={
        <AutocompleteEditor
          value={body}
          onInput={(value) => {
            setBody(value);
            beginDraft();
          }}
          lines={props.surface === "full" ? 26 : 10}
          placeholder="Write your message"
          ariaLabel="Message body"
          spellcheck
          disabled={!editable()}
          completions={slashCompletion()}
          fill={fill}
        />
      }
    >
      <MarkdownEditor
        value={body}
        onInput={(value) => {
          setBody(value);
          beginDraft();
        }}
        placeholder="Write your message"
        ariaLabel="Message body"
        lines={props.surface === "full" ? 26 : 10}
        spellcheck
        disabled={!editable()}
        completions={slashCompletion()}
        fill={fill}
      />
    </Show>
  );

  const previewSurface = () => (
    <div class="relative h-full min-h-72 overflow-hidden bg-white">
      <Show
        when={preview()}
        fallback={
          <Show
            when={previewMutation.error()?.message}
            fallback={<div class="flex h-full min-h-72 items-center justify-center text-sm text-dimmed">Preparing preview...</div>}
          >
            {(message) => (
              <div class="flex h-full min-h-72 flex-col items-center justify-center gap-2 p-4 text-sm text-red-600">
                <span>{message()}</span>
                <button type="button" class="btn-secondary btn-sm" onClick={retryPreview}>
                  Retry
                </button>
              </div>
            )}
          </Show>
        }
      >
        {(value) => <iframe class="h-full min-h-72 w-full border-0 bg-white" sandbox="" srcdoc={value().html} title="Email preview" />}
      </Show>
      <Show when={preview() && previewMutation.error()?.message}>
        <div class="absolute inset-x-2 top-2 flex items-center gap-2 border border-red-200 bg-white px-2 py-1 text-xs text-red-600 shadow-sm">
          <span class="min-w-0 flex-1 truncate">{previewMutation.error()?.message}</span>
          <button type="button" class="btn-simple btn-sm" onClick={retryPreview}>
            Retry
          </button>
        </div>
      </Show>
      <Show when={previewMutation.loading()}>
        <span class="absolute right-2 top-2 text-xs text-dimmed">
          <i class="ti ti-loader-2 animate-spin" aria-hidden="true" /> Updating
        </span>
      </Show>
    </div>
  );

  return (
    <div class="mail-composer-surface h-full min-w-0 overflow-hidden">
      <Show when={!props.popout}>
        <header class={`flex shrink-0 items-center gap-2 px-3 py-2 ${props.surface === "full" ? "bg-[var(--ui-surface-subtle)]" : ""}`}>
          <Show when={props.surface === "full"}>
            <Tooltip content="Minimize composer">
              <button
                type="button"
                class="icon-btn"
                aria-label="Minimize composer"
                disabled={handoffInProgress()}
                onClick={() => void handoffTo(props.returnHref)}
              >
                <i class="ti ti-minimize" aria-hidden="true" />
              </button>
            </Tooltip>
          </Show>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{intentLabel(composerIntent())}</span>
          <Show when={status() === "error" || status() === "readonly"}>
            <span class="min-w-0 truncate text-xs text-red-600 dark:text-red-300" role="status">
              {statusMessage()}
            </span>
          </Show>
          <Show when={status() === "readonly" && draft()}>
            <button type="button" class="btn-secondary btn-sm" onClick={() => (lease() ? void resumeCurrentLease() : void takeOver())}>
              {lease() ? "Retry" : "Take over"}
            </button>
          </Show>
          <Show when={editable() && (draft()?.recoveryCopyCount ?? 0) > 0}>
            <button type="button" class="btn-secondary btn-sm" onClick={() => void restoreRecoveryCopy()}>
              <i class="ti ti-history" aria-hidden="true" /> Recover changes
            </button>
          </Show>
          <Tooltip content="Open in new window">
            <button
              type="button"
              class="icon-btn"
              aria-label="Open in new window"
              disabled={!editable() || handoffInProgress()}
              onClick={openWindow}
            >
              <i class="ti ti-app-window" aria-hidden="true" />
            </button>
          </Tooltip>
          <Show when={props.surface === "compact"}>
            <Tooltip content="Full-size composer">
              <button
                type="button"
                class="icon-btn"
                aria-label="Open full-size composer"
                disabled={!editable() || handoffInProgress()}
                onClick={openFullSize}
              >
                <i class="ti ti-maximize" aria-hidden="true" />
              </button>
            </Tooltip>
            <button
              type="button"
              class="icon-btn"
              aria-label="Close composer"
              disabled={handoffInProgress()}
              onClick={() => void closeComposer()}
            >
              <i class="ti ti-x" aria-hidden="true" />
            </button>
          </Show>
        </header>
      </Show>

      <Show when={props.popout && (status() === "error" || status() === "readonly")}>
        <div
          class="flex shrink-0 items-center gap-2 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
          role="status"
        >
          <span class="min-w-0 flex-1 truncate">{statusMessage()}</span>
          <Show when={status() === "readonly" && draft()}>
            <button type="button" class="btn-secondary btn-sm" onClick={() => (lease() ? void resumeCurrentLease() : void takeOver())}>
              {lease() ? "Retry" : "Take over"}
            </button>
          </Show>
        </div>
      </Show>

      <Show when={props.popout && editable() && (draft()?.recoveryCopyCount ?? 0) > 0}>
        <div class="flex shrink-0 items-center gap-2 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span class="min-w-0 flex-1">Saved conflict changes are available for this draft.</span>
          <button type="button" class="btn-secondary btn-sm" onClick={() => void restoreRecoveryCopy()}>
            <i class="ti ti-history" aria-hidden="true" /> Recover
          </button>
        </div>
      </Show>

      <div class={`flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto ${props.surface === "full" ? "px-4" : "px-3"}`}>
        <div class="grid shrink-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 py-2 text-sm">
          <span class="text-dimmed">From</span>
          <Select
            placeholder="Choose identity"
            value={identityId}
            onChange={(value) => {
              setIdentityId(value);
              if (!draft()) {
                const identity = verifiedIdentities().find((candidate) => candidate.id === value);
                if (identity) {
                  setFormat(identity.defaultFormat);
                  setPriority(identity.defaultPriority);
                  setRequestDeliveryReceipt(identity.defaultDeliveryReceipt);
                  setRequestReadReceipt(identity.defaultReadReceipt);
                }
              }
              beginDraft();
            }}
            options={verifiedIdentities().map((identity) => ({
              id: identity.id,
              label: identity.label,
              description: `${identity.displayName ? `${identity.displayName} · ` : ""}${identity.fromAddress}`,
            }))}
            disabled={!editable()}
          />
          <span class="text-dimmed">To</span>
          <div class="flex min-w-0 items-center gap-2">
            <div class="min-w-0 flex-1">
              <MailRecipientInput
                placeholder="Recipients"
                value={to}
                onChange={(value) => {
                  setTo(value);
                  beginDraft();
                }}
                disabled={!editable()}
              />
            </div>
            <Show when={!showCc()}>
              <button type="button" class="btn-simple btn-sm" onClick={() => setShowCc(true)}>
                Cc/Bcc
              </button>
            </Show>
          </div>
          <Show when={showCc()}>
            <span class="text-dimmed">Cc</span>
            <MailRecipientInput
              placeholder="Cc recipients"
              value={cc}
              onChange={(value) => {
                setCc(value);
                beginDraft();
              }}
              disabled={!editable()}
            />
            <span class="text-dimmed">Bcc</span>
            <MailRecipientInput
              placeholder="Bcc recipients"
              value={bcc}
              onChange={(value) => {
                setBcc(value);
                beginDraft();
              }}
              disabled={!editable()}
            />
          </Show>
          <span class="text-dimmed">Subject</span>
          <TextInput
            ariaLabel="Subject"
            value={subject}
            onInput={(value) => {
              setSubject(value);
              beginDraft();
            }}
            maxLength={998}
            disabled={!editable()}
          />
        </div>

        <div class="min-h-72 flex-1 py-2">
          <Show when={format() === "markdown"} fallback={<div class="h-full min-h-72 overflow-hidden">{writeSurface(true)}</div>}>
            <Panes.Root
              value={composerPanes()}
              onChange={updateComposerPanes}
              class="h-full w-full"
              keepMounted
              allowResize
              allowMove
              allowReorder
              allowHorizontalSplit
              allowVerticalSplit={false}
            >
              <Panes.Element id="editor" title="Write" icon="ti ti-pencil">
                <div class="h-full min-h-0 overflow-hidden">{writeSurface(true)}</div>
              </Panes.Element>
              <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
                {previewSurface()}
              </Panes.Element>
            </Panes.Root>
          </Show>
        </div>

        <Show when={(draft()?.attachments.length ?? 0) > 0 || uploads().length > 0}>
          <div class="flex shrink-0 flex-wrap gap-2 py-2" aria-label="Attached files" role="list">
            <For each={draft()?.attachments ?? []}>
              {(attachment) => (
                <span class="chip max-w-full" role="listitem">
                  <i class="ti ti-paperclip" aria-hidden="true" />
                  <span class="max-w-48 truncate">{attachment.filename}</span>
                  <span class="text-xs text-dimmed">{text.pprintBytes(attachment.byteLength)}</span>
                  <Show when={props.canShareAttachments}>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`Insert public link for ${attachment.filename}`}
                      disabled={!editable() || shareAttachment.loading()}
                      onClick={() => void insertAttachmentLink(attachment.id)}
                    >
                      <i class="ti ti-link" aria-hidden="true" />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Remove ${attachment.filename}`}
                    disabled={!editable()}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <i class="ti ti-x" aria-hidden="true" />
                  </button>
                </span>
              )}
            </For>
            <For each={uploads()}>
              {(upload) => (
                <span class="chip max-w-full" role="listitem">
                  <i class={`ti ${upload.error ? "ti-alert-circle text-red-500" : "ti-loader-2 animate-spin"}`} aria-hidden="true" />
                  <span class="max-w-48 truncate">{upload.file.name}</span>
                  <span class="text-xs text-dimmed">{upload.error ?? `${upload.progress}%`}</span>
                  <Show when={upload.error}>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`Retry ${upload.file.name}`}
                      onClick={() => void retryUpload(upload)}
                    >
                      <i class="ti ti-refresh" aria-hidden="true" />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Cancel ${upload.file.name}`}
                    onClick={() => void cancelUpload(upload).catch((error) => prompts.error(error.message))}
                  >
                    <i class="ti ti-x" aria-hidden="true" />
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={!draft() && props.seed?.intent === "forward" && (props.seed.sourceAttachmentCount ?? 0) > 0}>
          <div class="shrink-0 py-2">
            <Switch
              label={`Include ${props.seed?.sourceAttachmentCount} original attachment${
                props.seed?.sourceAttachmentCount === 1 ? "" : "s"
              }`}
              value={includeSourceAttachments}
              onChange={setIncludeSourceAttachments}
            />
          </div>
        </Show>
      </div>

      <footer class="flex shrink-0 items-center gap-2 bg-[var(--ui-surface-subtle)] px-3 py-2">
        <div class="mail-delivery-actions inline-flex shrink-0">
          <button
            type="button"
            class="btn-primary btn-sm rounded-r-none"
            disabled={!editable() || send.loading() || uploads().length > 0}
            onClick={() => send.mutate({})}
          >
            <i class={`ti ${send.loading() ? "ti-loader-2 animate-spin" : intentIcon(composerIntent())}`} aria-hidden="true" />
            {intentLabel(composerIntent())}
          </button>
          <Tooltip content="Schedule delivery">
            <button
              type="button"
              class="btn-primary btn-sm min-w-8 rounded-l-none border-l border-l-white/30 px-2"
              aria-label="Schedule delivery"
              disabled={!editable() || send.loading() || uploads().length > 0}
              onClick={() => void schedule()}
            >
              <i class="ti ti-clock" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <Tooltip content="Attach files">
          <button type="button" class="icon-btn" aria-label="Attach files" disabled={!editable()} onClick={() => attachmentInput?.click()}>
            <i class="ti ti-paperclip" aria-hidden="true" />
          </button>
        </Tooltip>
        <input
          ref={attachmentInput}
          type="file"
          class="hidden"
          multiple
          disabled={!editable()}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            void addFiles(files);
          }}
        />
        <Select
          placeholder="Message format"
          value={format}
          onChange={(value) => {
            setFormat(value === "plain" ? "plain" : "markdown");
            beginDraft();
          }}
          options={[
            { id: "markdown", label: "Markdown", icon: "ti ti-markdown" },
            { id: "plain", label: "Plain text", icon: "ti ti-align-left" },
          ]}
          disabled={!editable()}
        />
        <Tooltip
          content={deliveryOptionsSummary().length > 0 ? `Delivery options: ${deliveryOptionsSummary().join(", ")}` : "Delivery options"}
        >
          <button
            type="button"
            class="icon-btn relative"
            aria-label="Delivery options"
            disabled={!editable()}
            onClick={() => void editDeliveryOptions()}
          >
            <i class="ti ti-adjustments" aria-hidden="true" />
            <Show when={deliveryOptionsSummary().length > 0}>
              <span class="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--ui-accent)]" aria-hidden="true" />
            </Show>
          </button>
        </Tooltip>
        <span class="flex-1" />
        <Tooltip content="Discard draft">
          <button
            type="button"
            class="icon-btn"
            aria-label="Discard draft"
            disabled={!draft() || !editable() || discard.loading()}
            onClick={() => discard.mutate()}
          >
            <i class={`ti ${discard.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} aria-hidden="true" />
          </button>
        </Tooltip>
      </footer>
    </div>
  );
}
