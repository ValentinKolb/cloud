import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { apiClient } from "../../api/client";
import type { AcquiredDraftLease, DraftEditableContent, MailDraft, MailDraftSeed } from "../../contracts";
import { readApiError } from "./api-response";
import { type DraftLeaseHeartbeatResult, recoverDraftLeaseHeartbeat } from "./mail-draft-lease-recovery";
import { advanceMailDraftJournalAfterSave, type MailDraftJournal, readMailDraftJournal } from "./mail-draft-journal";

type ComposerStatus = "local" | "preparing" | "saved" | "saving" | "error" | "readonly";

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

const journalKey = (mailboxId: string, draftId: string): string => `cloud:mail:draft:${mailboxId}:${draftId}`;
const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";

const draftEditableContent = (draft: MailDraft): DraftEditableContent => ({
  senderIdentityId: draft.senderIdentityId,
  to: draft.to,
  cc: draft.cc,
  bcc: draft.bcc,
  subject: draft.subject,
  body: draft.body,
  format: draft.format,
  priority: draft.priority,
  requestDeliveryReceipt: draft.requestDeliveryReceipt,
  requestReadReceipt: draft.requestReadReceipt,
});

export const draftSeedContentChanged = (seed: MailDraftSeed, content: DraftEditableContent): boolean =>
  JSON.stringify(content) !== JSON.stringify(seed.content);

export const createMailDraftSession = (options: {
  mailboxId: string;
  initialDraft?: MailDraft;
  initialSeed?: MailDraftSeed;
  hasVerifiedIdentity: () => boolean;
  content: () => DraftEditableContent;
  applyDraftContent: (content: DraftEditableContent) => void;
  isDisposed: () => boolean;
  onRecovered: () => void;
  onMaterialized: (draft: MailDraft) => void;
}) => {
  const [draft, setDraft] = createSignal<MailDraft | null>(options.initialDraft ?? null);
  const [lease, setLease] = createSignal<AcquiredDraftLease | null>(null);
  const [status, setStatus] = createSignal<ComposerStatus>(options.initialSeed ? "local" : "preparing");
  const [statusMessage, setStatusMessage] = createSignal(options.initialSeed ? "" : "Preparing draft...");
  const [initialized, setInitialized] = createSignal(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatController: AbortController | null = null;
  let heartbeatGeneration = 0;
  let initializePromise: Promise<MailDraft | null> | null = null;
  const seedBaseline = options.initialSeed ? JSON.stringify(options.initialSeed.content) : null;
  let lastSavedContent = seedBaseline ?? "";
  const serializeMutation = createSerializedDraftMutationQueue();

  const serializedContent = () => JSON.stringify(options.content());
  const draftKey = (draftId: string) => journalKey(options.mailboxId, draftId);
  const stopHeartbeat = () => {
    heartbeatGeneration += 1;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    heartbeatController?.abort();
    heartbeatController = null;
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

  const heartbeatLease = async (
    currentDraft: MailDraft,
    currentLease: AcquiredDraftLease,
    signal?: AbortSignal,
  ): Promise<DraftLeaseHeartbeatResult> => {
    try {
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$put(
        {
          param: { mailboxId: options.mailboxId, draftId: currentDraft.id },
          json: { token: currentLease.token },
        },
        { init: { signal } },
      );
      return response.ok ? { kind: "ok", lease: await response.json() } : { kind: "rejected" };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { kind: "unavailable" };
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    const generation = heartbeatGeneration;
    heartbeatTimer = setTimeout(async () => {
      heartbeatTimer = null;
      const activeDraft = draft();
      const activeLease = lease();
      if (!activeDraft || !activeLease) return;
      const controller = new AbortController();
      heartbeatController = controller;
      let heartbeat: DraftLeaseHeartbeatResult;
      try {
        heartbeat = await recoverDraftLeaseHeartbeat({
          heartbeat: () => heartbeatLease(activeDraft, activeLease, controller.signal),
          signal: controller.signal,
        });
      } catch (error) {
        if (options.isDisposed() || generation !== heartbeatGeneration || isAbortError(error)) return;
        heartbeat = { kind: "unavailable" };
      } finally {
        if (heartbeatController === controller) heartbeatController = null;
      }
      if (options.isDisposed() || generation !== heartbeatGeneration) return;
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
    const currentDraft = draft();
    if (!currentDraft) return null;
    if (options.isDisposed()) return null;
    const acquired = await acquireLease(currentDraft);
    if (options.isDisposed()) return null;
    lastSavedContent = JSON.stringify(draftEditableContent(currentDraft));
    setDraft(currentDraft);
    setInitialized(true);
    if (acquired) {
      const recovered = recoverJournal(draftKey(currentDraft.id), currentDraft.revision);
      setStatus("saved");
      setStatusMessage("");
      if (recovered) options.onRecovered();
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

  const persist = async (): Promise<MailDraft | null> => {
    return await serializeMutation(async () => {
      let currentDraft = draft();
      if (!currentDraft && options.initialSeed) {
        const nextContent = options.content();
        setStatus("saving");
        setStatusMessage("Saving draft...");
        const response = await apiClient.mailboxes[":mailboxId"]["draft-seeds"].materialize.$post({
          param: { mailboxId: options.mailboxId },
          json: {
            idempotencyKey: options.initialSeed.id,
            origin: options.initialSeed.origin,
            draft: nextContent,
          },
        });
        if (!response.ok) {
          if (options.isDisposed()) return null;
          setStatus("error");
          setStatusMessage(await readApiError(response, "Draft could not be saved"));
          return null;
        }
        currentDraft = await response.json();
        lastSavedContent = JSON.stringify(draftEditableContent(currentDraft));
        setDraft(currentDraft);
        try {
          options.onMaterialized(currentDraft);
        } catch {
          // URL and local-seed cleanup are best-effort; the durable draft remains authoritative.
        }
        if (options.isDisposed()) return currentDraft;
        const acquired = await acquireLease(currentDraft);
        if (!acquired) return currentDraft;
        setStatus("saved");
        setStatusMessage("");
        return currentDraft;
      }
      if (!currentDraft || !lease()) {
        currentDraft = await ensureDraft();
      }
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
      if (!response.ok) {
        if (options.isDisposed()) return null;
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
      advanceMailDraftJournalAfterSave({
        storage: localStorage,
        key: draftKey(saved.id),
        revision: saved.revision,
        savedContent: nextContent,
      });
      if (options.isDisposed()) return saved;
      setDraft(saved);
      lastSavedContent = serialized;
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
    stopHeartbeat();
    const generation = heartbeatGeneration;
    setStatus("preparing");
    const controller = new AbortController();
    heartbeatController = controller;
    let heartbeat: DraftLeaseHeartbeatResult;
    try {
      heartbeat = await recoverDraftLeaseHeartbeat({
        heartbeat: () => heartbeatLease(currentDraft, currentLease, controller.signal),
        signal: controller.signal,
      });
    } catch (error) {
      if (options.isDisposed() || generation !== heartbeatGeneration || isAbortError(error)) return;
      heartbeat = { kind: "unavailable" };
    } finally {
      if (heartbeatController === controller) heartbeatController = null;
    }
    if (options.isDisposed() || generation !== heartbeatGeneration) return;
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
    if (!initialized() || serialized === lastSavedContent) {
      if (!currentDraft && seedBaseline === serialized) stopScheduledSave();
      return;
    }
    if (!currentDraft) {
      stopScheduledSave();
      saveTimer = setTimeout(() => void persist(), 700);
      return;
    }
    localStorage.setItem(
      draftKey(currentDraft.id),
      JSON.stringify({
        revision: currentDraft.revision,
        content: options.content(),
      } satisfies MailDraftJournal),
    );
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
    if (options.initialSeed) {
      setInitialized(true);
      return;
    }
    void ensureDraft();
  });

  onCleanup(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    }
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
    persist,
    serializeMutation,
    stopScheduledSave,
    stopHeartbeat,
    acquireLease,
    releaseLease,
    resumeCurrentLease,
    releaseLeaseOnExit,
    draftKey,
    markCurrentContentSaved: () => {
      lastSavedContent = serializedContent();
    },
    hasUnsavedChanges: () =>
      !draft() && options.initialSeed
        ? draftSeedContentChanged(options.initialSeed, options.content())
        : serializedContent() !== lastSavedContent,
  };
};
