import { navigateTo } from "@k2b/ssr/nav";
import { CheckboxCard, type Completion, type PanesValue, prompts, Select, TextInput, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type {
  ComposePreview,
  ComposeSafetyApproval,
  ComposeSafetyReview,
  DraftEditableContent,
  DraftEditableContentInput,
  DraftIntent,
  DraftRecoveryCopy,
  MailCommand,
  MailDraft,
  MailDraftSeed,
  MailPriority,
  SenderIdentity,
} from "../../contracts";
import { readApiError } from "./api-response";
import MailComposerAttachments from "./MailComposerAttachments";
import MailComposerEditor, { mailComposerPaneVisible } from "./MailComposerEditor";
import MailRecipientInput from "./MailRecipientInput";
import { chooseScheduledSendTime } from "./MailScheduleDialog";
import { readMailComposerPanes, readMailUserPreferences, writeMailComposerPanes } from "./MailSettingsStore";
import { mailDraftHref, mailDraftSeedHref } from "./mail-compose-route";
import { createMailComposerAttachmentManager } from "./mail-composer-attachment-manager";
import { focusMailComposerEditorAtStart } from "./mail-composer-editor-focus";
import { createMailComposerTransition } from "./mail-composer-transition";
import { removeMailDraftSeed } from "./mail-draft-seed-store";
import { createMailDraftSession } from "./mail-draft-session";
import { formatMailRecipients, parseMailRecipients } from "./mail-recipient";

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

export default function MailComposer(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft;
  initialSeed?: MailDraftSeed;
  popout?: boolean;
  returnHref: string;
  dateConfig: DateContext;
  canShareAttachments?: boolean;
}) {
  const initial = props.initialDraft ?? props.initialSeed;
  if (!initial) throw new Error("MailComposer requires a draft or compose seed");
  const initialContent = props.initialDraft
    ? {
        senderIdentityId: props.initialDraft.senderIdentityId,
        to: props.initialDraft.to,
        cc: props.initialDraft.cc,
        bcc: props.initialDraft.bcc,
        subject: props.initialDraft.subject,
        body: props.initialDraft.body,
        format: props.initialDraft.format,
        priority: props.initialDraft.priority,
        requestDeliveryReceipt: props.initialDraft.requestDeliveryReceipt,
        requestReadReceipt: props.initialDraft.requestReadReceipt,
      }
    : props.initialSeed!.content;
  let attachmentInput: HTMLInputElement | undefined;
  let initialEditorFocusApplied = false;
  const verifiedIdentities = () => props.identities.filter((identity) => identity.status === "verified");
  const preferences = readMailUserPreferences(props.mailboxId);
  const [identityId, setIdentityId] = createSignal(initialContent.senderIdentityId);
  const selectedIdentity = () => verifiedIdentities().find((identity) => identity.id === identityId()) ?? null;
  const [to, setTo] = createSignal(formatMailRecipients(initialContent.to));
  const [cc, setCc] = createSignal(formatMailRecipients(initialContent.cc));
  const [bcc, setBcc] = createSignal(formatMailRecipients(initialContent.bcc));
  const [subject, setSubject] = createSignal(initialContent.subject);
  const [body, setBody] = createSignal(initialContent.body);
  const [format, setFormat] = createSignal<"plain" | "markdown">(initialContent.format);
  const [priority, setPriority] = createSignal(initialContent.priority);
  const [requestDeliveryReceipt, setRequestDeliveryReceipt] = createSignal(initialContent.requestDeliveryReceipt);
  const [requestReadReceipt, setRequestReadReceipt] = createSignal(initialContent.requestReadReceipt);
  const deliveryOptionsSummary = createMemo(() => {
    const options: string[] = [];
    if (priority() === "high") options.push("high priority");
    if (priority() === "low") options.push("low priority");
    if (requestDeliveryReceipt()) options.push("delivery receipt");
    if (requestReadReceipt()) options.push("read receipt");
    return options;
  });
  const [showCc, setShowCc] = createSignal(Boolean(initialContent.cc.length || initialContent.bcc.length));
  const [composerPanes, setComposerPanes] = createSignal<PanesValue>(readMailComposerPanes());
  const [preview, setPreview] = createSignal<ComposePreview | null>(null);
  const [previewRevision, setPreviewRevision] = createSignal(0);
  const composerTransition = createMailComposerTransition();
  let recoveryController: AbortController | null = null;
  let disposed = false;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  let panePersistenceTimer: ReturnType<typeof setTimeout> | null = null;
  const clearInitialSeed = () => {
    if (!props.initialSeed) return;
    try {
      removeMailDraftSeed(localStorage, props.mailboxId, props.initialSeed.id);
    } catch {
      // Expired local seed cleanup must never block leaving the composer.
    }
  };

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
    initialSeed: props.initialSeed,
    hasVerifiedIdentity: () => verifiedIdentities().length > 0,
    content,
    applyDraftContent,
    isDisposed: () => disposed,
    onRecovered: () => toast("Unsaved changes from this browser were restored.", { title: "Draft recovered" }),
    onMaterialized: (materialized) => {
      if (props.initialSeed) {
        clearInitialSeed();
        window.history.replaceState(
          window.history.state,
          "",
          mailDraftHref(props.mailboxId, materialized.id, props.returnHref, {
            popout: props.popout,
          }),
        );
      }
    },
  });
  const {
    draft,
    setDraft,
    lease,
    status,
    setStatus,
    statusMessage,
    setStatusMessage,
    persist,
    serializeMutation: serializeDraftMutation,
    stopScheduledSave,
    stopHeartbeat,
    acquireLease,
    releaseLease,
    resumeCurrentLease,
    hasUnsavedChanges,
  } = draftSession;
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
  const canEditDraft = createMemo(
    () => verifiedIdentities().length > 0 && status() !== "preparing" && status() !== "readonly" && (Boolean(lease()) || !draft()),
  );
  const editable = createMemo(() => canEditDraft() && composerTransition.active() === null);
  const focusFreshEditorAtStart = (element: HTMLTextAreaElement) => {
    if (!props.initialSeed || initialEditorFocusApplied) return;
    queueMicrotask(() => {
      if (initialEditorFocusApplied || disposed || !editable() || !element.isConnected) return;
      initialEditorFocusApplied = true;
      focusMailComposerEditorAtStart(element);
    });
  };
  const attachments = createMailComposerAttachmentManager({
    mailboxId: props.mailboxId,
    draft,
    initialAttachments: () => props.initialSeed?.attachments ?? [],
    setDraft,
    editable,
    persist,
    serializeDraftMutation,
    transition: composerTransition,
    format,
    setBody,
    isDisposed: () => disposed,
  });
  const uploads = attachments.uploads;

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
    const reservation = composerTransition.reserve("recovery");
    if (!reservation) return;
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
      if (!canEditDraft() || !currentLease) return void (await prompts.error("This draft is no longer editable in this session."));
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
      composerTransition.release(reservation);
    }
  };

  createEffect(() => {
    if (typeof window === "undefined") return;
    const previewDraft = content();
    previewRevision();
    if (format() !== "markdown" || !mailComposerPaneVisible(composerPanes().root, "preview") || !identityId()) {
      stopPreview();
      return;
    }
    stopPreview();
    previewTimer = setTimeout(
      () =>
        void previewMutation.mutate({
          draft: previewDraft,
          conversationId: draft()?.conversationId ?? initial.conversationId,
        }),
      250,
    );
  });

  onCleanup(() => {
    disposed = true;
    recoveryController?.abort();
    recoveryController = null;
    stopPreview();
    if (panePersistenceTimer) {
      clearTimeout(panePersistenceTimer);
      writeMailComposerPanes(composerPanes());
    }
  });

  const validateDelivery = () => {
    if (uploads().length > 0) throw new Error("Finish or cancel attachment uploads before sending.");
    if (to().length + cc().length + bcc().length === 0) throw new Error("Add at least one recipient.");
    if (!body().trim() && !(draft()?.attachments.length ?? props.initialSeed?.attachments.length ?? 0)) {
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
      { title: "Review before sending", icon: "ti ti-shield-check", size: "medium" },
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

  let attachAfterDeliveryReview = false;
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
      const returnHref = props.returnHref;
      const scheduled = Boolean(delivery?.scheduledAt);
      toast.success(
        scheduled
          ? `Delivery scheduled for ${dates.formatDateTime(delivery!.scheduledAt!, props.dateConfig)}`
          : preferences.undoSeconds > 0
            ? "Message queued. You can undo it directly in the conversation."
            : "Message queued",
      );
      navigateTo(returnHref);
    },
    onError: (error) => {
      if (error instanceof ComposeSafetyAttachmentRequested) {
        attachAfterDeliveryReview = true;
        return;
      }
      if (error instanceof ComposeSafetyCancelled) return;
      return prompts.error(error.message);
    },
  });

  const finishDeliveryTransition = (reservation: ReturnType<typeof composerTransition.reserve>) => {
    if (!reservation) return;
    composerTransition.release(reservation);
    if (attachAfterDeliveryReview && !disposed) {
      attachAfterDeliveryReview = false;
      attachmentInput?.click();
    }
  };

  const sendDraft = async (delivery: { scheduledAt?: string }) => {
    if (!editable() || uploads().length > 0) return;
    const reservation = composerTransition.reserve("send");
    if (!reservation) return;
    try {
      await send.mutate(delivery);
    } finally {
      finishDeliveryTransition(reservation);
    }
  };

  const schedule = async () => {
    if (!editable() || uploads().length > 0) return;
    const reservation = composerTransition.reserve("send");
    if (!reservation) return;
    try {
      validateDelivery();
      const scheduledAt = await chooseScheduledSendTime(props.dateConfig);
      if (!disposed && scheduledAt) await send.mutate({ scheduledAt });
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Message is not ready to schedule");
    } finally {
      finishDeliveryTransition(reservation);
    }
  };

  const openDeliveryOptionsDialog = () =>
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
      { title: "Delivery options", icon: "ti ti-adjustments", size: "medium" },
    );

  const editDeliveryOptions = async () => {
    if (!editable()) return;
    const reservation = composerTransition.reserve("delivery_options");
    if (!reservation) return;
    try {
      await openDeliveryOptionsDialog();
    } finally {
      composerTransition.release(reservation);
    }
  };

  const discard = mutations.create<boolean, void>({
    mutation: async (_input, { abortSignal }) => {
      if (uploads().length > 0) throw new Error("Cancel attachment uploads before discarding this draft.");
      if (!draft()) {
        clearInitialSeed();
        return true;
      }
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
      });
      return true;
    },
    onSuccess: (discarded) => {
      if (!discarded) return;
      navigateTo(props.returnHref);
    },
    onError: (error) => prompts.error(error.message),
  });
  const discardDraft = async () => {
    if (!editable()) return;
    const reservation = composerTransition.reserve("discard");
    if (!reservation) return;
    try {
      await discard.mutate();
    } finally {
      composerTransition.release(reservation);
    }
  };
  onCleanup(() => {
    send.abort();
    discard.abort();
  });

  const draftHref = (draftId: string, popout = false) => mailDraftHref(props.mailboxId, draftId, props.returnHref, { popout });

  const handoffTo = async (href: string | ((draftId: string) => string), popup?: Window): Promise<void> => {
    if (uploads().length > 0) {
      popup?.close();
      await prompts.error("Finish or cancel attachment uploads before moving this draft.");
      return;
    }
    const reservation = composerTransition.reserve("handoff");
    if (!reservation) return void popup?.close();
    stopScheduledSave();
    let releasedDraft: MailDraft | null = null;
    try {
      if (!draft() && !hasUnsavedChanges() && typeof href === "string") {
        clearInitialSeed();
        navigateTo(href);
        return;
      }
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
        navigateTo(props.returnHref);
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
      await prompts.error(error instanceof Error ? error.message : "Could not open the draft in the requested window");
    } finally {
      composerTransition.release(reservation);
    }
  };

  const openWindow = () => {
    const popup = window.open("about:blank", "", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
    if (!popup) return void prompts.error("Allow pop-up windows to open this draft in a separate window.");
    if (!draft() && !hasUnsavedChanges() && props.initialSeed) {
      popup.location.replace(mailDraftSeedHref(props.mailboxId, props.initialSeed.id, props.returnHref, { popout: true }));
      navigateTo(props.returnHref);
      return;
    }
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

  const composerIntent = () => draft()?.intent ?? initial.intent;
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
              conversationId: draft()?.conversationId ?? initial.conversationId,
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

  return (
    <div class="mail-composer-surface h-full min-w-0 overflow-hidden">
      <Show when={!props.popout}>
        <header class="flex shrink-0 items-center gap-2 bg-[var(--ui-surface-subtle)] px-3 py-2">
          <Tooltip content="Back to mailbox">
            <button
              type="button"
              class="icon-btn"
              aria-label="Back to mailbox"
              disabled={composerTransition.active() !== null}
              onClick={() => void handoffTo(props.returnHref)}
            >
              <i class="ti ti-arrow-left" aria-hidden="true" />
            </button>
          </Tooltip>
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
            <button type="button" class="icon-btn" aria-label="Open in new window" disabled={!editable()} onClick={openWindow}>
              <i class="ti ti-app-window" aria-hidden="true" />
            </button>
          </Tooltip>
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

      <div class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4">
        <div class="grid shrink-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 py-2 text-sm">
          <span class="text-dimmed">From</span>
          <Select
            placeholder="Choose identity"
            value={identityId}
            onChange={(value) => {
              setIdentityId(value);
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
              <MailRecipientInput placeholder="Recipients" value={to} onChange={setTo} disabled={!editable()} />
            </div>
            <Show when={!showCc()}>
              <button type="button" class="btn-simple btn-sm" disabled={!editable()} onClick={() => setShowCc(true)}>
                Cc/Bcc
              </button>
            </Show>
          </div>
          <Show when={showCc()}>
            <span class="text-dimmed">Cc</span>
            <MailRecipientInput placeholder="Cc recipients" value={cc} onChange={setCc} disabled={!editable()} />
            <span class="text-dimmed">Bcc</span>
            <MailRecipientInput placeholder="Bcc recipients" value={bcc} onChange={setBcc} disabled={!editable()} />
          </Show>
          <span class="text-dimmed">Subject</span>
          <TextInput ariaLabel="Subject" value={subject} onInput={setSubject} maxLength={998} disabled={!editable()} />
        </div>

        <MailComposerEditor
          format={format}
          body={body}
          onBodyInput={setBody}
          editable={editable}
          completions={slashCompletion}
          panes={composerPanes}
          onPanesChange={updateComposerPanes}
          preview={preview}
          previewLoading={previewMutation.loading}
          previewError={() => previewMutation.error()?.message}
          onRetryPreview={retryPreview}
          onEditorReady={focusFreshEditorAtStart}
        />

        <MailComposerAttachments
          attachments={() => draft()?.attachments ?? props.initialSeed?.attachments ?? []}
          uploads={uploads}
          editable={editable}
          canShare={Boolean(props.canShareAttachments)}
          shareLoading={attachments.shareLoading}
          onInsertLink={(attachmentId) => void attachments.insertAttachmentLink(attachmentId)}
          onRemove={(attachmentId) => void attachments.removeAttachment(attachmentId)}
          onRetryUpload={(upload) => void attachments.retryUpload(upload)}
          onCancelUpload={(upload) => void attachments.cancelUpload(upload).catch((error) => prompts.error(error.message))}
        />
      </div>

      <footer class="flex shrink-0 items-center gap-2 bg-[var(--ui-surface-subtle)] px-3 py-2">
        <div class="mail-delivery-actions inline-flex shrink-0">
          <button
            type="button"
            class="btn-primary btn-sm rounded-r-none"
            disabled={!editable() || send.loading() || uploads().length > 0}
            onClick={() => void sendDraft({})}
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
            void attachments.addFiles(files);
          }}
        />
        <Select
          placeholder="Message format"
          value={format}
          onChange={(value) => {
            setFormat(value === "plain" ? "plain" : "markdown");
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
            disabled={!editable() || discard.loading()}
            onClick={() => void discardDraft()}
          >
            <i class={`ti ${discard.loading() ? "ti-loader-2 animate-spin" : "ti-trash"}`} aria-hidden="true" />
          </button>
        </Tooltip>
      </footer>
    </div>
  );
}
