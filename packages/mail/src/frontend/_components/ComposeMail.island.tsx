import {
  dialogCore,
  FileDropzone,
  MarkdownEditor,
  NumberInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  Select,
  TagsInput,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { DraftIntent, MailCommand, MailDraft, SenderIdentity } from "../../contracts";
import { readApiError } from "./api-response";
import { readMailUserPreferences } from "./MailSettingsStore";

type ComposeValues = {
  identityId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  format: "markdown" | "plain";
  undoSeconds: number;
  attachments: File[];
};

const addresses = (values: string[]) => values.map((address) => ({ name: null, address: address.trim().toLowerCase() }));

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function ComposeDialog(props: {
  title: string;
  identities: SenderIdentity[];
  initialTo: string[];
  initialSubject: string;
  preferences: ReturnType<typeof readMailUserPreferences>;
  close: (value: ComposeValues | null) => void;
}) {
  const defaultIdentity = props.identities.find((identity) => identity.isDefault)?.id ?? props.identities[0]?.id ?? "";
  const [identityId, setIdentityId] = createSignal(defaultIdentity);
  const [to, setTo] = createSignal(props.initialTo);
  const [cc, setCc] = createSignal<string[]>([]);
  const [bcc, setBcc] = createSignal<string[]>([]);
  const [subject, setSubject] = createSignal(props.initialSubject);
  const [body, setBody] = createSignal("");
  const [format, setFormat] = createSignal<"markdown" | "plain">(props.preferences.composeFormat);
  const [undoSeconds, setUndoSeconds] = createSignal(props.preferences.undoSeconds);
  const [attachments, setAttachments] = createSignal<File[]>([]);
  const [error, setError] = createSignal<string | null>(null);

  const addFiles = (files: File[]) => {
    setAttachments((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...files.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
  };

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (!identityId()) return setError("Choose a sender identity.");
    if (to().length === 0) return setError("Add at least one recipient.");
    if (!body().trim()) return setError("Write a message before sending.");
    setError(null);
    props.close({
      identityId: identityId(),
      to: to(),
      cc: cc(),
      bcc: bcc(),
      subject: subject().trim(),
      body: body(),
      format: format(),
      undoSeconds: undoSeconds(),
      attachments: attachments(),
    });
  };

  return (
    <PanelDialog>
      <form class="flex h-full min-h-0 flex-col" onSubmit={submit}>
        <PanelDialog.Header title={props.title} subtitle="Send from this mailbox" icon="ti ti-pencil" close={() => props.close(null)} />
        <PanelDialog.Body scrollPreserveKey="mail-compose-body">
          <PanelDialog.Section title="Recipients" subtitle="Choose a verified sender and add recipients." icon="ti ti-address-book">
            <Select
              label="From"
              value={identityId}
              onChange={setIdentityId}
              options={props.identities.map((identity) => ({
                id: identity.id,
                label: `${identity.displayName || identity.fromAddress} <${identity.fromAddress}>`,
              }))}
              required
            />
            <TagsInput
              label="To"
              description="Separate addresses with commas."
              value={to}
              onChange={setTo}
              icon="ti ti-mail-forward"
              required
            />
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TagsInput label="Cc" value={cc} onChange={setCc} icon="ti ti-copy" />
              <TagsInput label="Bcc" value={bcc} onChange={setBcc} icon="ti ti-eye-off" />
            </div>
          </PanelDialog.Section>

          <PanelDialog.Section title="Message" subtitle="Markdown is rendered when the message is delivered." icon="ti ti-message">
            <TextInput label="Subject" value={subject} onInput={setSubject} maxLength={998} />
            <Select
              label="Format"
              value={format}
              onChange={(value) => setFormat(value === "plain" ? "plain" : "markdown")}
              options={[
                { id: "markdown", label: "Markdown", icon: "ti ti-markdown" },
                { id: "plain", label: "Plain text", icon: "ti ti-align-left" },
              ]}
            />
            <Show
              when={format() === "markdown"}
              fallback={
                <TextInput
                  label="Message"
                  value={body}
                  onInput={setBody}
                  multiline
                  lines={16}
                  required
                  error={() => (error() === "Write a message before sending." ? (error() ?? undefined) : undefined)}
                />
              }
            >
              <div>
                <label class="mb-1 block text-sm font-medium text-secondary" for="mail-compose-body-editor">
                  Message <span aria-hidden="true">*</span>
                </label>
                <MarkdownEditor
                  id="mail-compose-body-editor"
                  value={body}
                  onInput={setBody}
                  onSubmit={() => submit()}
                  placeholder="Write your message..."
                  lines={16}
                  ariaLabel="Message"
                  ariaRequired
                  error={error() === "Write a message before sending."}
                  spellcheck
                />
              </div>
            </Show>
          </PanelDialog.Section>

          <PanelDialog.Section
            title="Attachments"
            subtitle="Files are stored with the draft before delivery is queued."
            icon="ti ti-paperclip"
          >
            <FileDropzone
              title="Drop files or click to choose"
              subtitle="Attach one or more files to this message."
              icon="ti-paperclip"
              onDrop={addFiles}
            />
            <Show when={attachments().length > 0}>
              <div class="flex flex-col gap-1" role="list" aria-label="Selected attachments">
                <For each={attachments()}>
                  {(file) => (
                    <div
                      class="flex min-w-0 items-center gap-2 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-3 py-2 text-xs"
                      role="listitem"
                    >
                      <i class="ti ti-file shrink-0 text-dimmed" aria-hidden="true" />
                      <span class="min-w-0 flex-1 truncate text-primary">{file.name}</span>
                      <span class="shrink-0 tabular-nums text-dimmed">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setAttachments((current) => current.filter((entry) => entry !== file))}
                      >
                        <i class="ti ti-x" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </PanelDialog.Section>

          <PanelDialog.Section
            title="Delivery"
            subtitle="Delay delivery briefly so the message can still be cancelled."
            icon="ti ti-clock-pause"
          >
            <NumberInput
              label="Undo window"
              value={undoSeconds}
              onInput={(value) => setUndoSeconds(value ?? 0)}
              min={0}
              max={60}
              allowNegative={false}
              suffix="seconds"
            />
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <p class="min-h-5 text-xs text-red-600 dark:text-red-300" role="alert">
            {error()}
          </p>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={() => props.close(null)}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm">
              <i class="ti ti-send" aria-hidden="true" /> Send
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

export default function ComposeMail(props: {
  mailboxId: string;
  identities: SenderIdentity[];
  label?: string;
  class?: string;
  conversationId?: string | null;
  intent?: DraftIntent;
  sourceMessageId?: string | null;
  initialTo?: string[];
  initialSubject?: string;
}) {
  const send = mutations.create<{ draft: MailDraft; command: MailCommand } | null, void>({
    mutation: async () => {
      const verified = props.identities.filter((identity) => identity.status === "verified");
      if (verified.length === 0) throw new Error("Configure and verify a sender identity before composing mail.");
      const values = await dialogCore.open<ComposeValues | null>(
        (close) => (
          <ComposeDialog
            title={
              props.intent === "forward" ? "Forward" : props.intent === "reply" || props.intent === "reply_all" ? "Reply" : "New message"
            }
            identities={verified}
            initialTo={props.initialTo ?? []}
            initialSubject={props.initialSubject ?? ""}
            preferences={readMailUserPreferences(props.mailboxId)}
            close={close}
          />
        ),
        panelDialogOptions,
      );
      if (!values) return null;

      const draftResponse = await apiClient.mailboxes[":mailboxId"].drafts.$post({
        param: { mailboxId: props.mailboxId },
        json: {
          conversationId: props.conversationId ?? null,
          intent: props.intent,
          sourceMessageId: props.sourceMessageId ?? null,
          senderIdentityId: values.identityId,
          to: addresses(values.to),
          cc: addresses(values.cc),
          bcc: addresses(values.bcc),
          subject: values.subject,
          body: values.body,
          format: values.format,
        },
      });
      if (!draftResponse.ok) throw new Error(await readApiError(draftResponse, "Failed to save draft"));
      let draft = await draftResponse.json();

      for (const file of values.attachments) {
        const query = new URLSearchParams({ expectedRevision: String(draft.revision), filename: file.name });
        const attachmentResponse = await fetch(`/api/mail/mailboxes/${props.mailboxId}/drafts/${draft.id}/attachments?${query}`, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!attachmentResponse.ok) throw new Error(await readApiError(attachmentResponse, `Failed to attach ${file.name}`));
        draft = (await attachmentResponse.json()) as MailDraft;
      }

      const commandResponse = await apiClient.mailboxes[":mailboxId"].commands.$post({
        param: { mailboxId: props.mailboxId },
        json: {
          kind: "send",
          draftId: draft.id,
          expectedDraftRevision: draft.revision,
          senderIdentityId: values.identityId,
          undoSeconds: values.undoSeconds,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      if (!commandResponse.ok) throw new Error(await readApiError(commandResponse, "Failed to queue message"));
      return { draft, command: await commandResponse.json() };
    },
    onSuccess: (result) => {
      if (result) toast.success("Message queued");
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <button type="button" class={props.class ?? "btn-primary btn-sm"} onClick={() => send.mutate()} disabled={send.loading()}>
      <i class={`ti ${send.loading() ? "ti-loader-2 animate-spin" : "ti-pencil"}`} aria-hidden="true" />
      {props.label ?? "Compose"}
    </button>
  );
}
