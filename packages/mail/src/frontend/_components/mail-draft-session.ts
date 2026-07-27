import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { apiClient } from "../../api/client";
import type { AcquiredDraftLease, DraftEditableContent, DraftIntent, MailDraft } from "../../contracts";
import { readApiError } from "./api-response";
import { type MailDraftJournal, promoteMailDraftJournal, readMailDraftJournal } from "./mail-draft-journal";

export type ComposerStatus = "local" | "preparing" | "saved" | "saving" | "error" | "readonly";

export type ComposerSeed = {
  intent: DraftIntent;
  senderIdentityId?: string | null;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  sourceAttachmentCount?: number;
};

export const createSerializedDraftMutationQueue = () => {
  let queue: Promise<void> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
};

export const mergeCreatedDraftContent = (
  current: DraftEditableContent,
  submitted: DraftEditableContent,
  created: MailDraft,
): DraftEditableContent | null => {
  if (JSON.stringify(current) === JSON.stringify(submitted)) return created;
  if (
    current.senderIdentityId !== submitted.senderIdentityId ||
    created.senderIdentityId !== submitted.senderIdentityId ||
    !created.initialSignatureSource ||
    current.body.endsWith(created.initialSignatureSource)
  ) {
    return null;
  }
  return {
    ...current,
    body: [current.body.trimEnd(), created.initialSignatureSource].filter(Boolean).join("\n\n"),
  };
};

type LeaseHeartbeatResult = { kind: "ok"; lease: AcquiredDraftLease } | { kind: "rejected" } | { kind: "unavailable" };

const journalKey = (mailboxId: string, draftId: string): string => `cloud:mail:draft:${mailboxId}:${draftId}`;
const pendingJournalKey = (mailboxId: string, seed?: ComposerSeed): string =>
  `cloud:mail:draft:${mailboxId}:pending:${seed?.conversationId ?? "new"}:${seed?.sourceMessageId ?? "new"}:${seed?.intent ?? "new"}`;

export const createMailDraftSession = (options: {
  mailboxId: string;
  initialDraft?: MailDraft | null;
  seed?: ComposerSeed;
  hasVerifiedIdentity: () => boolean;
  includeSourceAttachments: () => boolean;
  content: () => DraftEditableContent;
  applyDraftContent: (content: DraftEditableContent) => void;
  isDisposed: () => boolean;
  onRecovered: () => void;
}) => {
  const [draft, setDraft] = createSignal<MailDraft | null>(options.initialDraft ?? null);
  const [lease, setLease] = createSignal<AcquiredDraftLease | null>(null);
  const [status, setStatus] = createSignal<ComposerStatus>("preparing");
  const [statusMessage, setStatusMessage] = createSignal("Preparing draft...");
  const [initialized, setInitialized] = createSignal(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let initializePromise: Promise<MailDraft | null> | null = null;
  let lastSavedContent = "";
  const pendingKey = pendingJournalKey(options.mailboxId, options.seed);

  const serializeMutation = createSerializedDraftMutationQueue();

  const serializedContent = () => JSON.stringify(options.content());
  const draftKey = (draftId: string) => journalKey(options.mailboxId, draftId);
  const stopHeartbeat = () => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  };
  const stopScheduledSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  };

  const releaseLeaseOnExit = (): Promise<void> => {
    const currentDraft = draft();
    const currentLease = lease();
    if (!currentDraft || !currentLease) return Promise.resolve();
    return fetch(`/api/mail/mailboxes/${options.mailboxId}/drafts/${currentDraft.id}/lease`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: currentLease.token }),
      credentials: "same-origin",
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => undefined);
  };

  const releaseLease = async (currentDraft: MailDraft): Promise<void> => {
    const currentLease = lease();
    if (!currentLease) return;
    stopHeartbeat();
    try {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$delete({
        param: { mailboxId: options.mailboxId, draftId: currentDraft.id },
        json: { token: currentLease.token },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not transfer draft editing"));
      setLease(null);
    } catch (error) {
      startHeartbeat();
      throw error;
    }
  };

  const heartbeatLease = async (currentDraft: MailDraft, currentLease: AcquiredDraftLease): Promise<LeaseHeartbeatResult> => {
    try {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$put({
        param: { mailboxId: options.mailboxId, draftId: currentDraft.id },
        json: { token: currentLease.token },
      });
      return response.ok ? { kind: "ok", lease: await response.json() } : { kind: "rejected" };
    } catch {
      return { kind: "unavailable" };
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setTimeout(async () => {
      heartbeatTimer = null;
      const activeDraft = draft();
      const activeLease = lease();
      if (!activeDraft || !activeLease) return;
      const heartbeat = await heartbeatLease(activeDraft, activeLease);
      if (options.isDisposed()) return;
      if (heartbeat.kind === "unavailable") {
        setStatus("readonly");
        setStatusMessage("Connection lost. Retry to resume editing.");
        return;
      }
      if (heartbeat.kind === "rejected") {
        setLease(null);
        setStatus("readonly");
        setStatusMessage("Editing lease expired. Reload or take over the draft.");
        return;
      }
      setLease(heartbeat.lease);
      startHeartbeat();
    }, 10_000);
  };

  const acquireLease = async (currentDraft: MailDraft, takeover = false): Promise<AcquiredDraftLease | null> => {
    const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$post({
      param: { mailboxId: options.mailboxId, draftId: currentDraft.id },
      json: { takeover },
    });
    if (options.isDisposed()) return null;
    if (!response.ok) {
      setStatus("readonly");
      setStatusMessage(await readApiError(response, "Draft is open elsewhere"));
      return null;
    }
    const acquired = await response.json();
    if (options.isDisposed()) {
      await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$delete({
        param: { mailboxId: options.mailboxId, draftId: currentDraft.id },
        json: { token: acquired.token },
      });
      return null;
    }
    setLease(acquired);
    startHeartbeat();
    return acquired;
  };

  const recoverJournal = (key: string, minimumRevision: number): boolean => {
    const journal = readMailDraftJournal(localStorage, key);
    if (!journal || journal.revision < minimumRevision) return false;
    options.applyDraftContent(journal.content);
    return true;
  };

  const initialize = async (): Promise<MailDraft | null> => {
    if (!options.hasVerifiedIdentity()) {
      setStatus("readonly");
      setStatusMessage("Configure and verify an identity before composing mail.");
      return null;
    }
    let currentDraft = draft();
    const isExistingDraft = Boolean(currentDraft);
    let submittedContent: DraftEditableContent | null = null;
    let serverContent: DraftEditableContent | null = null;
    if (!currentDraft) {
      setStatusMessage("Preparing draft...");
      submittedContent = options.content();
      const response = await apiClient.mailboxes[":mailboxId"].drafts.$post({
        param: { mailboxId: options.mailboxId },
        json: {
          conversationId: options.seed?.conversationId ?? null,
          intent: options.seed?.intent ?? "new",
          sourceMessageId: options.seed?.sourceMessageId ?? null,
          includeSourceAttachments: options.includeSourceAttachments(),
          ...submittedContent,
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to create draft"));
      currentDraft = await response.json();
      if (options.isDisposed()) return null;
      const currentContent = options.content();
      const mergedContent = mergeCreatedDraftContent(currentContent, submittedContent, currentDraft);
      if (mergedContent) options.applyDraftContent(mergedContent);
      serverContent = {
        senderIdentityId: currentDraft.senderIdentityId,
        to: currentDraft.to,
        cc: currentDraft.cc,
        bcc: currentDraft.bcc,
        subject: currentDraft.subject,
        body: currentDraft.body,
        format: currentDraft.format,
        priority: currentDraft.priority,
        requestDeliveryReceipt: currentDraft.requestDeliveryReceipt,
        requestReadReceipt: currentDraft.requestReadReceipt,
      };
    }
    if (options.isDisposed()) return null;
    const acquired = await acquireLease(currentDraft);
    if (options.isDisposed()) return null;
    if (submittedContent && serverContent) {
      promoteMailDraftJournal({
        storage: localStorage,
        pendingKey,
        draftKey: draftKey(currentDraft.id),
        revision: currentDraft.revision,
        submittedContent,
        currentContent: options.content(),
        serverContent,
      });
    }
    const recovered = recoverJournal(draftKey(currentDraft.id), currentDraft.revision);
    lastSavedContent = JSON.stringify({
      senderIdentityId: currentDraft.senderIdentityId,
      to: currentDraft.to,
      cc: currentDraft.cc,
      bcc: currentDraft.bcc,
      subject: currentDraft.subject,
      body: currentDraft.body,
      format: currentDraft.format,
      priority: currentDraft.priority,
      requestDeliveryReceipt: currentDraft.requestDeliveryReceipt,
      requestReadReceipt: currentDraft.requestReadReceipt,
    });
    setDraft(currentDraft);
    setInitialized(true);
    if (acquired) {
      setStatus("saved");
      setStatusMessage("");
      if (recovered && isExistingDraft) options.onRecovered();
    }
    return currentDraft;
  };

  const ensureDraft = (): Promise<MailDraft | null> => {
    if (draft() && lease()) return Promise.resolve(draft());
    if (initializePromise) return initializePromise;
    initializePromise = initialize()
      .catch((error: unknown) => {
        if (!options.isDisposed()) {
          setStatus("error");
          setStatusMessage(error instanceof Error ? error.message : "Draft could not be prepared");
        }
        return null;
      })
      .finally(() => {
        initializePromise = null;
      });
    return initializePromise;
  };

  const beginDraft = () => {
    if (!draft()) void ensureDraft();
  };

  const persist = async (): Promise<MailDraft | null> => {
    if (!draft() || !lease()) await ensureDraft();
    return await serializeMutation(async () => {
      const currentDraft = draft();
      if (!currentDraft || !lease()) return null;
      const nextContent = options.content();
      const serialized = JSON.stringify(nextContent);
      if (serialized === lastSavedContent) return currentDraft;
      setStatus("saving");
      setStatusMessage("Saving draft...");
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].$put({
        param: { mailboxId: options.mailboxId, draftId: currentDraft.id },
        json: { expectedRevision: currentDraft.revision, draft: nextContent },
      });
      if (options.isDisposed()) return null;
      if (!response.ok) {
        const message = await readApiError(response, "Draft could not be saved");
        setStatus("error");
        setStatusMessage(message);
        if (message.includes("recovery copy")) {
          setDraft((current) =>
            current
              ? {
                  ...current,
                  recoveryCopyCount: current.recoveryCopyCount + 1,
                }
              : current,
          );
        }
        return null;
      }
      const saved = await response.json();
      setDraft(saved);
      lastSavedContent = serialized;
      localStorage.removeItem(draftKey(saved.id));
      setStatus("saved");
      setStatusMessage("");
      return saved;
    });
  };

  const resumeCurrentLease = async () => {
    const currentDraft = draft();
    const currentLease = lease();
    if (options.isDisposed() || !currentDraft) return;
    if (!currentLease) return void (await ensureDraft());
    setStatus("preparing");
    const heartbeat = await heartbeatLease(currentDraft, currentLease);
    if (options.isDisposed()) return;
    if (heartbeat.kind === "ok") {
      setLease(heartbeat.lease);
      setStatus("saved");
      setStatusMessage("");
      startHeartbeat();
      return;
    }
    if (heartbeat.kind === "unavailable") {
      setStatus("readonly");
      setStatusMessage("Connection lost. Retry to resume editing.");
      return;
    }
    setLease(null);
    await ensureDraft();
  };

  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) {
      if (!draft() || !lease()) return;
      stopHeartbeat();
      setStatus("preparing");
      return;
    }
    void releaseLeaseOnExit();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) void resumeCurrentLease();
  };

  createEffect(() => {
    const serialized = serializedContent();
    const currentDraft = draft();
    if (!initialized() || serialized === lastSavedContent) return;
    localStorage.setItem(
      currentDraft ? draftKey(currentDraft.id) : pendingKey,
      JSON.stringify({
        revision: currentDraft?.revision ?? 0,
        content: options.content(),
      } satisfies MailDraftJournal),
    );
    if (!currentDraft) void ensureDraft();
    if (!lease()) return;
    stopScheduledSave();
    saveTimer = setTimeout(() => void persist(), 700);
  });

  onMount(() => {
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    if (!options.hasVerifiedIdentity()) {
      setStatus("readonly");
      setStatusMessage("Configure and verify an identity before composing mail.");
      return;
    }
    if (draft()) {
      void ensureDraft();
      return;
    }
    const recoveredPendingDraft = recoverJournal(pendingKey, 0);
    lastSavedContent = serializedContent();
    setInitialized(true);
    setStatus("local");
    setStatusMessage("");
    if (recoveredPendingDraft) {
      options.onRecovered();
      void ensureDraft();
    }
  });

  onCleanup(() => {
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    stopScheduledSave();
    stopHeartbeat();
    void releaseLeaseOnExit();
  });

  return {
    draft,
    setDraft,
    lease,
    setLease,
    status,
    setStatus,
    statusMessage,
    setStatusMessage,
    ensureDraft,
    beginDraft,
    persist,
    serializeMutation,
    stopScheduledSave,
    stopHeartbeat,
    acquireLease,
    releaseLease,
    resumeCurrentLease,
    releaseLeaseOnExit,
    pendingKey,
    draftKey,
    initializing: () => Boolean(initializePromise),
    lastSavedContent: () => lastSavedContent,
    markCurrentContentSaved: () => {
      lastSavedContent = serializedContent();
    },
  };
};
