import { mutation } from "@k2b/stdlib/solid";
import { Button, dialogCore, PanelDialog, Placeholder, panelDialogOptions, prompts, Select, TextInput, toast } from "@k2b/ui";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { z } from "zod";
import { apiClient } from "@/api/client";
import { readResponseError } from "../../../lib/response";

type InvitationContext = Awaited<ReturnType<typeof loadContext>>;

const loadContext = async (spaceId: string, itemId: string, signal?: AbortSignal) => {
  const response = await apiClient[":id"].items[":itemId"]["invitation-context"].$get(
    { param: { id: spaceId, itemId } },
    { init: { signal } },
  );
  if (!response.ok) throw new Error(await readResponseError(response, "Could not load invitation options"));
  return response.json();
};

const parseAttendees = (value: string) => {
  const email = z.string().trim().email();
  const addresses = new Set(
    value
      .split(/[\s,;]+/u)
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  const invalid = [...addresses].find((address) => !email.safeParse(address).success);
  return invalid
    ? { ok: false as const, message: `“${invalid}” is not a valid email address.` }
    : { ok: true as const, attendees: [...addresses].map((address) => ({ name: null, address })) };
};

function InvitationDialog(props: { spaceId: string; itemId: string; method: "request" | "cancel"; close: () => void }) {
  const [context, setContext] = createSignal<InvitationContext | null>(null);
  const [mailboxId, setMailboxId] = createSignal<string | null>(null);
  const [senderIdentityId, setSenderIdentityId] = createSignal<string | null>(null);
  const [recipients, setRecipients] = createSignal("");
  const [validationError, setValidationError] = createSignal<string | null>(null);
  let idempotencyKey = crypto.randomUUID();
  const resetIdempotency = () => {
    idempotencyKey = crypto.randomUUID();
  };

  const load = mutation.create<InvitationContext, void>({
    mutation: async (_input, { abortSignal }) => loadContext(props.spaceId, props.itemId, abortSignal),
    onSuccess: (result) => {
      setContext(result);
      const mailbox = result.mailboxes[0];
      const identity = mailbox?.identities.find((candidate) => candidate.isDefault) ?? mailbox?.identities[0];
      setMailboxId(mailbox?.id ?? null);
      setSenderIdentityId(identity?.id ?? null);
      setRecipients(result.attendees.map((attendee) => attendee.address).join(", "));
    },
  });

  const selectedMailbox = createMemo(() => context()?.mailboxes.find((mailbox) => mailbox.id === mailboxId()) ?? null);

  const chooseMailbox = (nextMailboxId: string | null) => {
    resetIdempotency();
    setMailboxId(nextMailboxId);
    const mailbox = context()?.mailboxes.find((candidate) => candidate.id === nextMailboxId);
    const identity = mailbox?.identities.find((candidate) => candidate.isDefault) ?? mailbox?.identities[0];
    setSenderIdentityId(identity?.id ?? null);
  };

  const create = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const parsed = parseAttendees(recipients());
      if (!parsed.ok) {
        setValidationError(parsed.message);
        return;
      }
      if (!mailboxId() || !senderIdentityId()) {
        setValidationError("Choose a mailbox with a verified sending identity.");
        return;
      }
      setValidationError(null);
      const mailTab = window.open("about:blank", "_blank");
      if (!mailTab) throw new Error("Mail could not open a new tab. Allow pop-ups for Cloud and try again.");
      mailTab.opener = null;
      try {
        const response = await apiClient[":id"].items[":itemId"]["invitation-draft"].$post(
          {
            param: { id: props.spaceId, itemId: props.itemId },
            json: {
              idempotencyKey,
              mailboxId: mailboxId()!,
              senderIdentityId: senderIdentityId()!,
              attendees: parsed.attendees,
              method: props.method,
            },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readResponseError(response, "Could not create the invitation draft"));
        const result = await response.json();
        mailTab.location.replace(new URL(result.href, window.location.origin).href);
        toast.success(props.method === "cancel" ? "Cancellation email created" : "Invitation email created");
        props.close();
      } catch (error) {
        mailTab.close();
        throw error;
      }
    },
    onError: (error) => prompts.error(error.message, { title: "Could not create email" }),
  });

  onMount(() => load.mutate());
  onCleanup(() => {
    load.abort();
    create.abort();
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.method === "cancel" ? "Cancel invitations" : "Invite attendees"}
        subtitle="Spaces owns the event. Mail opens an editable message before anything is sent."
        icon={props.method === "cancel" ? "ti ti-calendar-cancel" : "ti ti-calendar-share"}
        close={props.close}
      />
      <PanelDialog.Body>
        <Show
          when={context()}
          fallback={
            <Placeholder
              state={load.error() ? "error" : "loading"}
              variant="compact"
              title={load.error() ? "Mail senders unavailable" : "Loading Mail senders"}
              description={load.error()?.message}
              action={
                load.error() ? (
                  <Button variant="secondary" size="sm" type="button" onClick={() => load.mutate()}>
                    Retry
                  </Button>
                ) : undefined
              }
            />
          }
        >
          {(value) => (
            <PanelDialog.Section title="Delivery" subtitle="Choose the organizer identity and recipients." icon="ti ti-mail-forward">
              <Show when={value().mailboxes.length === 0}>
                <Placeholder
                  state="empty"
                  variant="compact"
                  icon="ti ti-mail-off"
                  title="No Mail sender is available"
                  description="You need write access to a mailbox with at least one verified sending identity."
                />
              </Show>
              <Select
                label="Mailbox"
                value={() => mailboxId() ?? null}
                onValueChange={chooseMailbox}
                options={value().mailboxes.map((mailbox) => ({
                  value: mailbox.id,
                  label: mailbox.name,
                  icon: "ti ti-mail",
                }))}
                placeholder="No writable Mail mailbox"
                disabled={value().mailboxes.length === 0}
              />
              <Select
                label="From"
                value={() => senderIdentityId() ?? null}
                onValueChange={(value) => {
                  resetIdempotency();
                  setSenderIdentityId(value);
                }}
                options={(selectedMailbox()?.identities ?? []).map((identity) => ({
                  value: identity.id,
                  label: identity.label,
                  description: identity.from.name ? `${identity.from.name} <${identity.from.address}>` : identity.from.address,
                  icon: identity.isDefault ? "ti ti-star" : "ti ti-at",
                }))}
                placeholder="No verified sending identity"
                disabled={!selectedMailbox()}
              />
              <TextInput
                label="Attendees"
                description="Separate email addresses with commas, spaces, or new lines."
                icon="ti ti-users"
                multiline
                lines={3}
                value={recipients}
                onValueChange={(value) => {
                  resetIdempotency();
                  setRecipients(value);
                }}
                error={() => validationError() ?? undefined}
                placeholder="alex@example.com, sam@example.com"
              />
            </PanelDialog.Section>
          )}
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <Button type="button" variant="secondary" onClick={props.close}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={props.method === "cancel" ? "danger" : "primary"}
          disabled={load.loading() || create.loading() || !context() || !mailboxId() || !senderIdentityId()}
          onClick={() => create.mutate()}
        >
          <i class={create.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-mail-plus"} aria-hidden="true" />
          Create Mail
        </Button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

const openDialog = (spaceId: string, itemId: string, method: "request" | "cancel") =>
  dialogCore.open<void>((close) => <InvitationDialog spaceId={spaceId} itemId={itemId} method={method} close={() => close()} />, {
    ...panelDialogOptions,
    cancelBehavior: "ignore",
  });

export default function EventInvitations(props: { spaceId: string; itemId: string }) {
  const [canCancel, setCanCancel] = createSignal(false);
  const [lastDelivery, setLastDelivery] = createSignal<InvitationContext["lastDelivery"]>(null);
  const controller = new AbortController();
  onMount(() => {
    void loadContext(props.spaceId, props.itemId, controller.signal)
      .then((context) => {
        setCanCancel(context.canCancel);
        setLastDelivery(context.lastDelivery);
      })
      .catch(() => undefined);
  });
  onCleanup(() => controller.abort());
  return (
    <section class="detail-section">
      <h3 class="detail-section-label">Invitations</h3>
      <p class="mb-3 text-xs text-dimmed">Invite attendees through Mail without moving calendar ownership out of Spaces.</p>
      <Show when={lastDelivery()?.state === "failed"}>
        <p class="mb-3 text-xs text-danger">
          <i class="ti ti-alert-circle mr-1" aria-hidden="true" />
          {lastDelivery()?.errorMessage ?? "The latest Mail draft could not be created."} Retry by creating the invitation again.
        </p>
      </Show>
      <div class="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => openDialog(props.spaceId, props.itemId, "request")}>
          <i class="ti ti-calendar-share" aria-hidden="true" />
          Invite or update
        </Button>
        <Show when={canCancel()}>
          <Button type="button" variant="ghost" size="sm" onClick={() => openDialog(props.spaceId, props.itemId, "cancel")}>
            <i class="ti ti-calendar-cancel" aria-hidden="true" />
            Cancel invitations
          </Button>
        </Show>
      </div>
    </section>
  );
}
