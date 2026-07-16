import { MarkdownEditor, prompts, Select, TagsInput, TextInput, Tooltip, toast } from "@valentinkolb/cloud/ui";
import { navigateTo } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { AcquiredDraftLease, DraftEditableContentInput, DraftIntent, MailDraft, SenderIdentity } from "../../contracts";
import { readApiError } from "./api-response";
import { readMailUserPreferences } from "./MailSettingsStore";

type ComposerStatus = "local" | "preparing" | "saved" | "saving" | "error" | "readonly";
type UploadState = { file: File; progress: number; error: string | null };
type DraftJournal = { revision: number; content: DraftEditableContentInput };

type ComposerSeed = {
  intent: DraftIntent;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
};

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

const normalizeAddresses = (values: string[]) =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((address) => ({ name: null, address: address.toLowerCase() }));

const addressStrings = (addresses: MailDraft["to"]): string[] => addresses.map((address) => address.address);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const journalKey = (mailboxId: string, draftId: string): string => `cloud:mail:draft:${mailboxId}:${draftId}`;
const pendingJournalKey = (mailboxId: string, seed?: ComposerSeed): string =>
  `cloud:mail:draft:${mailboxId}:pending:${seed?.conversationId ?? "new"}:${seed?.sourceMessageId ?? "new"}:${seed?.intent ?? "new"}`;

export default function MailComposer(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  initialDraft?: MailDraft | null;
  seed?: ComposerSeed;
  surface: "compact" | "full";
  returnHref: string;
  onClose?: () => void;
}) {
  let attachmentInput: HTMLInputElement | undefined;
  const verifiedIdentities = () => props.identities.filter((identity) => identity.status === "verified");
  const defaultIdentity = () => verifiedIdentities().find((identity) => identity.isDefault) ?? verifiedIdentities()[0];
  const preferences = readMailUserPreferences(props.mailboxId);
  const [draft, setDraft] = createSignal<MailDraft | null>(props.initialDraft ?? null);
  const [lease, setLease] = createSignal<AcquiredDraftLease | null>(null);
  const [status, setStatus] = createSignal<ComposerStatus>("preparing");
  const [statusMessage, setStatusMessage] = createSignal("Preparing draft...");
  const [identityId, setIdentityId] = createSignal(props.initialDraft?.senderIdentityId ?? defaultIdentity()?.id ?? "");
  const [to, setTo] = createSignal(props.initialDraft ? addressStrings(props.initialDraft.to) : (props.seed?.to ?? []));
  const [cc, setCc] = createSignal(props.initialDraft ? addressStrings(props.initialDraft.cc) : (props.seed?.cc ?? []));
  const [bcc, setBcc] = createSignal(props.initialDraft ? addressStrings(props.initialDraft.bcc) : []);
  const [subject, setSubject] = createSignal(props.initialDraft?.subject ?? props.seed?.subject ?? "");
  const [body, setBody] = createSignal(props.initialDraft?.body ?? props.seed?.body ?? "");
  const [format, setFormat] = createSignal<"plain" | "markdown">(props.initialDraft?.format ?? preferences.composeFormat);
  const [uploads, setUploads] = createSignal<UploadState[]>([]);
  const [showCc, setShowCc] = createSignal(Boolean(props.initialDraft?.cc.length || props.initialDraft?.bcc.length));
  const [initialized, setInitialized] = createSignal(false);
  const [recovered, setRecovered] = createSignal(false);
  const [handoffInProgress, setHandoffInProgress] = createSignal(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let draftMutationQueue: Promise<void> = Promise.resolve();
  let initializePromise: Promise<MailDraft | null> | null = null;
  let disposed = false;
  let lastSavedContent = "";
  const pendingKey = pendingJournalKey(props.mailboxId, props.seed);

  const serializeDraftMutation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = draftMutationQueue.then(operation, operation);
    draftMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const content = (): DraftEditableContentInput => ({
    senderIdentityId: identityId(),
    to: normalizeAddresses(to()),
    cc: normalizeAddresses(cc()),
    bcc: normalizeAddresses(bcc()),
    subject: subject(),
    body: body(),
    format: format(),
  });

  const serializedContent = () => JSON.stringify(content());
  const editable = createMemo(
    () => verifiedIdentities().length > 0 && status() !== "readonly" && !handoffInProgress() && (Boolean(lease()) || !draft()),
  );

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  const stopScheduledSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setInterval(async () => {
      const activeDraft = draft();
      const activeLease = lease();
      if (!activeDraft || !activeLease) return;
      const heartbeat = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$put({
        param: { mailboxId: props.mailboxId, draftId: activeDraft.id },
        json: { token: activeLease.token },
      });
      if (!heartbeat.ok) {
        stopHeartbeat();
        setLease(null);
        setStatus("readonly");
        setStatusMessage("Editing lease expired. Reload or take over the draft.");
      }
    }, 10_000);
  };

  const acquireLease = async (currentDraft: MailDraft, takeover = false): Promise<AcquiredDraftLease | null> => {
    const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$post({
      param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
      json: { takeover },
    });
    if (!response.ok) {
      setStatus("readonly");
      setStatusMessage(await readApiError(response, "Draft is open elsewhere"));
      return null;
    }
    const acquired = await response.json();
    if (disposed) {
      await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$delete({
        param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
        json: { token: acquired.token },
      });
      return null;
    }
    setLease(acquired);
    startHeartbeat();
    return acquired;
  };

  const recoverJournal = (key: string, minimumRevision: number): boolean => {
    const stored = localStorage.getItem(key);
    if (!stored) return false;
    try {
      const journal = JSON.parse(stored) as DraftJournal;
      if (journal.revision < minimumRevision) return false;
      setIdentityId(journal.content.senderIdentityId);
      setTo(addressStrings(journal.content.to));
      setCc(addressStrings(journal.content.cc));
      setBcc(addressStrings(journal.content.bcc));
      setSubject(journal.content.subject);
      setBody(journal.content.body);
      setFormat(journal.content.format);
      setRecovered(true);
      return true;
    } catch {
      localStorage.removeItem(key);
      return false;
    }
  };

  const initialize = async (): Promise<MailDraft | null> => {
    if (verifiedIdentities().length === 0) {
      setStatus("readonly");
      setStatusMessage("Configure and verify a sender identity before composing mail.");
      return null;
    }
    let currentDraft = draft();
    const existingDraft = Boolean(currentDraft);
    if (!currentDraft) {
      setStatus("preparing");
      setStatusMessage("Preparing draft...");
      const response = await apiClient.mailboxes[":mailboxId"].drafts.$post({
        param: { mailboxId: props.mailboxId },
        json: {
          conversationId: props.seed?.conversationId ?? null,
          intent: props.seed?.intent ?? "new",
          sourceMessageId: props.seed?.sourceMessageId ?? null,
          ...content(),
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to create draft"));
      currentDraft = await response.json();
      setDraft(currentDraft);
    }
    if (disposed) return null;
    if (existingDraft) recoverJournal(journalKey(props.mailboxId, currentDraft.id), currentDraft.revision);
    const acquired = await acquireLease(currentDraft);
    if (disposed) return null;
    lastSavedContent = JSON.stringify({
      senderIdentityId: currentDraft.senderIdentityId,
      to: currentDraft.to,
      cc: currentDraft.cc,
      bcc: currentDraft.bcc,
      subject: currentDraft.subject,
      body: currentDraft.body,
      format: currentDraft.format,
    });
    setInitialized(true);
    if (acquired) {
      localStorage.removeItem(pendingKey);
      setStatus("saved");
      setStatusMessage(recovered() ? "Recovered local changes" : "Draft saved");
    }
    return currentDraft;
  };

  const ensureDraft = (): Promise<MailDraft | null> => {
    if (draft() && lease()) return Promise.resolve(draft());
    if (initializePromise) return initializePromise;
    initializePromise = initialize()
      .catch((error: unknown) => {
        setStatus("error");
        setStatusMessage(error instanceof Error ? error.message : "Draft could not be prepared");
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
    return await serializeDraftMutation(async () => {
      const currentDraft = draft();
      if (!currentDraft || !lease()) return null;
      const nextContent = content();
      const serialized = JSON.stringify(nextContent);
      if (serialized === lastSavedContent) return currentDraft;
      setStatus("saving");
      setStatusMessage("Saving draft...");
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].$put({
        param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
        json: { expectedRevision: currentDraft.revision, draft: nextContent },
      });
      if (!response.ok) {
        setStatus("error");
        setStatusMessage(await readApiError(response, "Draft could not be saved"));
        return null;
      }
      const saved = await response.json();
      setDraft(saved);
      lastSavedContent = serialized;
      localStorage.removeItem(journalKey(props.mailboxId, saved.id));
      setStatus("saved");
      setStatusMessage("Draft saved");
      return saved;
    });
  };

  createEffect(() => {
    const serialized = serializedContent();
    const currentDraft = draft();
    if (!initialized() || serialized === lastSavedContent) return;
    localStorage.setItem(
      currentDraft ? journalKey(props.mailboxId, currentDraft.id) : pendingKey,
      JSON.stringify({ revision: currentDraft?.revision ?? 0, content: content() } satisfies DraftJournal),
    );
    if (!currentDraft) beginDraft();
    if (!lease()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persist(), 700);
  });

  onMount(() => {
    if (verifiedIdentities().length === 0) {
      setStatus("readonly");
      setStatusMessage("Configure and verify a sender identity before composing mail.");
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
    setStatusMessage(recoveredPendingDraft ? "Recovered local changes" : "Draft starts when you type");
    if (recoveredPendingDraft) void ensureDraft();
  });

  onCleanup(() => {
    disposed = true;
    stopScheduledSave();
    stopHeartbeat();
    const currentDraft = draft();
    const currentLease = lease();
    if (currentDraft && currentLease) {
      void apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$delete({
        param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
        json: { token: currentLease.token },
      });
    }
  });

  const uploadFile = async (file: File) => {
    const saved = await persist();
    if (!saved) throw new Error("Save the draft before attaching files.");
    setUploads((current) => [...current, { file, progress: 0, error: null }]);
    const createResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"].$post({
      param: { mailboxId: props.mailboxId, draftId: saved.id },
      json: { filename: file.name, contentType: file.type || "application/octet-stream", byteLength: file.size },
    });
    if (!createResponse.ok) throw new Error(await readApiError(createResponse, `Failed to attach ${file.name}`));
    const upload = await createResponse.json();
    for (let offset = 0; offset < file.size; offset += upload.chunkSize) {
      const chunk = file.slice(offset, Math.min(file.size, offset + upload.chunkSize));
      const response = await fetch(
        `/api/mail/mailboxes/${props.mailboxId}/drafts/${saved.id}/attachment-uploads/${upload.id}?offset=${offset}`,
        { method: "PATCH", headers: { "Content-Type": "application/octet-stream" }, body: chunk },
      );
      if (!response.ok) throw new Error(await readApiError(response, `Failed to upload ${file.name}`));
      const progress = file.size === 0 ? 100 : Math.round((Math.min(file.size, offset + chunk.size) / file.size) * 100);
      setUploads((current) => current.map((entry) => (entry.file === file ? { ...entry, progress } : entry)));
    }
    await serializeDraftMutation(async () => {
      const latest = draft() ?? saved;
      const finalizeResponse = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["attachment-uploads"][":uploadId"].finalize.$post(
        {
          param: { mailboxId: props.mailboxId, draftId: saved.id, uploadId: upload.id },
          json: { expectedRevision: latest.revision },
        },
      );
      if (!finalizeResponse.ok) throw new Error(await readApiError(finalizeResponse, `Failed to finalize ${file.name}`));
      setDraft(await finalizeResponse.json());
    });
    setUploads((current) => current.filter((entry) => entry.file !== file));
  };

  const addFiles = async (files: File[]) => {
    for (const file of files) {
      try {
        await uploadFile(file);
      } catch (error) {
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

  const send = mutations.create<void, void>({
    mutation: async () => {
      if (to().length + cc().length + bcc().length === 0) throw new Error("Add at least one recipient.");
      if (!body().trim() && !(draft()?.attachments.length ?? 0)) throw new Error("Write a message or attach a file before sending.");
      const saved = await persist();
      if (!saved) throw new Error(statusMessage());
      const response = await apiClient.mailboxes[":mailboxId"].commands.$post({
        param: { mailboxId: props.mailboxId },
        json: {
          kind: "send",
          draftId: saved.id,
          expectedDraftRevision: saved.revision,
          senderIdentityId: identityId(),
          undoSeconds: preferences.undoSeconds,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (!response.ok) throw new Error(await readApiError(response, "Failed to queue message"));
      localStorage.removeItem(journalKey(props.mailboxId, saved.id));
    },
    onSuccess: () => {
      toast.success("Message queued");
      props.onClose?.();
      if (props.surface === "full") navigateTo(props.returnHref);
    },
    onError: (error) => prompts.error(error.message),
  });

  const discard = async () => {
    const currentDraft = draft();
    if (!currentDraft) return props.onClose?.();
    const confirmed = await prompts.confirm("This removes the shared draft for everyone with mailbox access.", {
      title: "Discard draft?",
      confirmText: "Discard draft",
      variant: "danger",
    });
    if (!confirmed) return;
    const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].discard.$post({
      param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
      json: { expectedRevision: currentDraft.revision },
    });
    if (!response.ok) return prompts.error(await readApiError(response, "Failed to discard draft"));
    localStorage.removeItem(journalKey(props.mailboxId, currentDraft.id));
    props.onClose?.();
    if (props.surface === "full") navigateTo(props.returnHref);
  };

  const releaseLease = async (currentDraft: MailDraft): Promise<void> => {
    const currentLease = lease();
    if (!currentLease) return;
    stopHeartbeat();
    const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"].lease.$delete({
      param: { mailboxId: props.mailboxId, draftId: currentDraft.id },
      json: { token: currentLease.token },
    });
    if (!response.ok) {
      startHeartbeat();
      throw new Error(await readApiError(response, "Could not transfer draft editing"));
    }
    setLease(null);
  };

  const draftHref = (draftId: string, popout = false) =>
    `/app/mail/${props.mailboxId}/compose/${draftId}?return=${encodeURIComponent(props.returnHref)}${popout ? "&window=1" : ""}`;

  const handoffTo = async (href: string | ((draftId: string) => string), popup?: Window): Promise<void> => {
    if (handoffInProgress()) return;
    setHandoffInProgress(true);
    stopScheduledSave();
    try {
      const currentDraft = await persist();
      if (!currentDraft) throw new Error(statusMessage());
      await releaseLease(currentDraft);
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
    if (!confirmed) return;
    stopHeartbeat();
    const acquired = await acquireLease(currentDraft, true);
    if (acquired) {
      setStatus("saved");
      setStatusMessage("Draft editing taken over");
    }
  };

  const composerIntent = () => draft()?.intent ?? props.seed?.intent ?? "new";

  return (
    <div class="mail-composer-surface">
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
        <span
          class={`text-xs ${status() === "error" || status() === "readonly" ? "text-red-600 dark:text-red-300" : "text-dimmed"}`}
          role="status"
        >
          {statusMessage()}
        </span>
        <Show when={status() === "readonly" && draft()}>
          <button type="button" class="btn-secondary btn-sm" onClick={takeOver}>
            Take over
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
            <i class="ti ti-external-link" aria-hidden="true" />
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
          <button type="button" class="icon-btn" aria-label="Close composer" onClick={props.onClose}>
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </Show>
      </header>

      <div class={`flex min-h-0 flex-1 flex-col overflow-y-auto ${props.surface === "full" ? "px-4" : "px-3"}`}>
        <div class="grid shrink-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 py-2 text-sm">
          <span class="text-dimmed">From</span>
          <Select
            placeholder="Choose sender identity"
            value={identityId}
            onChange={(value) => {
              setIdentityId(value);
              beginDraft();
            }}
            options={verifiedIdentities().map((identity) => ({
              id: identity.id,
              label: `${identity.displayName || identity.fromAddress} <${identity.fromAddress}>`,
            }))}
            disabled={!editable()}
          />
          <span class="text-dimmed">To</span>
          <div class="flex min-w-0 items-center gap-2">
            <div class="min-w-0 flex-1">
              <TagsInput
                placeholder="Recipients"
                value={to}
                onChange={(value) => {
                  setTo(value);
                  beginDraft();
                }}
                disabled={!editable()}
              />
            </div>
            <button type="button" class="btn-simple btn-sm" onClick={() => setShowCc((value) => !value)}>
              Cc/Bcc
            </button>
          </div>
          <Show when={showCc()}>
            <span class="text-dimmed">Cc</span>
            <TagsInput
              placeholder="Cc recipients"
              value={cc}
              onChange={(value) => {
                setCc(value);
                beginDraft();
              }}
              disabled={!editable()}
            />
            <span class="text-dimmed">Bcc</span>
            <TagsInput
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
          <Show
            when={format() === "markdown"}
            fallback={
              <TextInput
                ariaLabel="Message body"
                value={body}
                onInput={(value) => {
                  setBody(value);
                  beginDraft();
                }}
                multiline
                lines={props.surface === "full" ? 26 : 10}
                disabled={!editable()}
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
            />
          </Show>
        </div>

        <Show when={(draft()?.attachments.length ?? 0) > 0 || uploads().length > 0}>
          <div class="flex shrink-0 flex-wrap gap-2 py-2" aria-label="Attached files" role="list">
            <For each={draft()?.attachments ?? []}>
              {(attachment) => (
                <span class="chip max-w-full" role="listitem">
                  <i class="ti ti-paperclip" aria-hidden="true" />
                  <span class="max-w-48 truncate">{attachment.filename}</span>
                  <span class="text-xs text-dimmed">{formatBytes(attachment.byteLength)}</span>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`Remove ${attachment.filename}`}
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
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>

      <footer class="flex shrink-0 items-center gap-2 bg-[var(--ui-surface-subtle)] px-3 py-2">
        <button type="button" class="btn-primary btn-sm" disabled={!editable() || send.loading()} onClick={() => send.mutate()}>
          <i class={`ti ${send.loading() ? "ti-loader-2 animate-spin" : intentIcon(composerIntent())}`} aria-hidden="true" />
          {intentLabel(composerIntent())}
        </button>
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
        <span class="flex-1" />
        <Tooltip content="Discard draft">
          <button type="button" class="icon-btn" aria-label="Discard draft" disabled={!draft()} onClick={discard}>
            <i class="ti ti-trash" aria-hidden="true" />
          </button>
        </Tooltip>
      </footer>
    </div>
  );
}
