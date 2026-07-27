import { Placeholder, prompts, Select } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { MailDraft, SenderIdentity } from "../../contracts";
import { readApiError } from "./api-response";
import { parseMailtoIntent } from "./mail-compose-intent";
import { mailDraftHref, mailDraftReturnHref } from "./mail-compose-route";

type WritableMailbox = {
  id: string;
  name: string;
  description: string | null;
};

export default function MailComposeIntentPage(props: {
  mailboxes: WritableMailbox[];
  initialMailboxId: string;
  mailto: string | null;
  returnHref: string | null;
}) {
  const parsedIntent = parseMailtoIntent(props.mailto);
  const [mailboxId, setMailboxId] = createSignal(props.initialMailboxId);
  const [identities, setIdentities] = createSignal<SenderIdentity[]>([]);
  const [identityId, setIdentityId] = createSignal("");
  const [identityLoading, setIdentityLoading] = createSignal(false);
  const [identityError, setIdentityError] = createSignal<string | null>(null);
  const [identityReload, setIdentityReload] = createSignal(0);
  let identityController: AbortController | null = null;
  let identityRequest = 0;

  createEffect(() => {
    const selectedMailboxId = mailboxId();
    identityReload();
    const request = ++identityRequest;
    identityController?.abort();
    identityController = null;
    setIdentities([]);
    setIdentityId("");
    setIdentityError(null);
    setIdentityLoading(Boolean(selectedMailboxId));
    if (!selectedMailboxId) return;
    const controller = new AbortController();
    identityController = controller;
    void (async () => {
      try {
        const response = await apiClient.mailboxes[":mailboxId"]["sender-identities"].$get(
          { param: { mailboxId: selectedMailboxId } },
          { init: { signal: controller.signal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Could not load sending identities"));
        const verified = (await response.json()).filter((identity) => identity.status === "verified");
        if (request !== identityRequest) return;
        setIdentities(verified);
        const defaultIdentity = verified.find((identity) => identity.isDefault);
        setIdentityId(defaultIdentity?.id ?? (verified.length === 1 ? verified[0]!.id : ""));
      } catch (error) {
        if (request !== identityRequest || controller.signal.aborted) return;
        setIdentityError(error instanceof Error ? error.message : "Could not load sending identities");
      } finally {
        if (request === identityRequest) {
          identityController = null;
          setIdentityLoading(false);
        }
      }
    })();
  });

  const selectedMailbox = createMemo(() => props.mailboxes.find((mailbox) => mailbox.id === mailboxId()) ?? null);
  const selectedIdentity = createMemo(() => identities().find((identity) => identity.id === identityId()) ?? null);
  const draftCreation = mutations.create<MailDraft, { mailboxId: string; identity: SenderIdentity }>({
    mutation: async ({ mailboxId: selectedMailboxId, identity }, { abortSignal }) => {
      if (!parsedIntent.ok) throw new Error(parsedIntent.message);
      const response = await apiClient.mailboxes[":mailboxId"].drafts.$post(
        {
          param: { mailboxId: selectedMailboxId },
          json: {
            senderIdentityId: identity.id,
            to: parsedIntent.intent.to,
            cc: parsedIntent.intent.cc,
            bcc: parsedIntent.intent.bcc,
            subject: parsedIntent.intent.subject,
            body: parsedIntent.intent.body,
            ...(parsedIntent.intent.body ? { format: "plain" as const } : {}),
            intent: "new",
            conversationId: null,
            sourceMessageId: null,
            includeSourceAttachments: false,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not create draft"));
      return response.json();
    },
    onSuccess: (draft) => {
      const fallbackReturnHref = `/app/mail/${draft.mailboxId}`;
      const returnHref = props.returnHref ? mailDraftReturnHref(props.returnHref, draft.mailboxId) : fallbackReturnHref;
      window.location.replace(mailDraftHref(draft.mailboxId, draft.id, returnHref));
    },
    onError: (error) => prompts.error(error.message, { title: "Could not start message" }),
  });

  onCleanup(() => {
    identityRequest += 1;
    identityController?.abort();
    draftCreation.abort();
  });

  const createDraft = () => {
    const selectedMailboxId = mailboxId();
    const identity = selectedIdentity();
    if (!selectedMailboxId || !identity || draftCreation.loading()) return;
    draftCreation.mutate({ mailboxId: selectedMailboxId, identity });
  };

  return (
    <div class="flex h-full min-h-0 items-start justify-center overflow-y-auto p-3 sm:p-6">
      <section class="paper mt-[8vh] flex w-full max-w-xl flex-col gap-4 p-4 sm:p-6" aria-labelledby="mail-compose-intent-title">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-selected)] text-accent">
            <i class="ti ti-pencil" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <h1 id="mail-compose-intent-title" class="text-lg font-semibold text-primary">
              New message
            </h1>
            <p class="text-sm text-secondary">Choose the mailbox and verified sender that should own this draft.</p>
          </div>
        </div>

        <Show
          when={props.mailboxes.length > 0}
          fallback={
            <Placeholder
              state="empty"
              title="No writable mailbox"
              description="Ask a mailbox administrator for Write access before composing mail."
            />
          }
        >
          <Show when={parsedIntent.ok} fallback={<div class="info-block-error text-sm">{!parsedIntent.ok && parsedIntent.message}</div>}>
            <div class="flex flex-col gap-3">
              <Select
                label="Mailbox"
                placeholder="Choose mailbox"
                value={mailboxId}
                onChange={setMailboxId}
                options={props.mailboxes.map((mailbox) => ({
                  id: mailbox.id,
                  label: mailbox.name,
                  description: mailbox.description ?? undefined,
                }))}
                disabled={draftCreation.loading()}
              />
              <Select
                label="From"
                placeholder={identityLoading() ? "Loading senders..." : "Choose sender"}
                value={identityId}
                onChange={setIdentityId}
                options={identities().map((identity) => ({
                  id: identity.id,
                  label: identity.label,
                  description: `${identity.displayName ? `${identity.displayName} · ` : ""}${identity.fromAddress}`,
                }))}
                disabled={!mailboxId() || identityLoading() || draftCreation.loading()}
              />
              <Show when={identityError()}>
                {(message) => (
                  <div class="info-block-error flex items-center justify-between gap-3 text-sm" role="alert">
                    <span>{message()}</span>
                    <button type="button" class="btn-secondary btn-sm" onClick={() => setIdentityReload((current) => current + 1)}>
                      Retry
                    </button>
                  </div>
                )}
              </Show>
              <Show when={mailboxId() && !identityLoading() && !identityError() && identities().length === 0}>
                <div class="info-block-note text-sm">
                  This mailbox has no verified sender. Add and verify an identity in mailbox Settings before composing.
                </div>
              </Show>
            </div>
            <Show when={props.mailto}>
              <div class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] p-3 text-sm">
                <p class="font-medium text-primary">Email link</p>
                <p class="mt-1 truncate text-secondary">
                  {parsedIntent.ok && parsedIntent.intent.to.length > 0
                    ? `To ${parsedIntent.intent.to.map((recipient) => recipient.address).join(", ")}`
                    : "No recipient supplied"}
                </p>
                <Show when={parsedIntent.ok && parsedIntent.intent.subject}>
                  <p class="truncate text-secondary">{parsedIntent.ok && parsedIntent.intent.subject}</p>
                </Show>
              </div>
            </Show>
            <div class="flex items-center justify-between gap-3">
              <a class="btn-secondary btn-sm" href={selectedMailbox() ? `/app/mail/${selectedMailbox()!.id}` : "/app/mail"}>
                Cancel
              </a>
              <button
                type="button"
                class="btn-primary btn-sm"
                disabled={!selectedMailbox() || !selectedIdentity() || identityLoading() || draftCreation.loading()}
                onClick={createDraft}
              >
                <i class={`ti ${draftCreation.loading() ? "ti-loader-2 animate-spin" : "ti-arrow-right"}`} aria-hidden="true" />
                Continue
              </button>
            </div>
          </Show>
        </Show>
      </section>
    </div>
  );
}
