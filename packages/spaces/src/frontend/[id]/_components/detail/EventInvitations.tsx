import { mutation, query } from "@k2b/stdlib/solid";
import {
  Button,
  DetailPanel,
  dialogCore,
  NoticeCard,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  toast,
} from "@k2b/ui";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
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

function InvitationDialog(props: {
  spaceId: string;
  itemId: string;
  method: "request" | "cancel";
  close: () => void;
  onCreated: () => void;
}) {
  const [mailboxId, setMailboxId] = createSignal<string | null>(null);
  const [senderIdentityId, setSenderIdentityId] = createSignal<string | null>(null);
  const [recipients, setRecipients] = createSignal("");
  const [validationError, setValidationError] = createSignal<string | null>(null);
  let idempotencyKey = crypto.randomUUID();
  const resetIdempotency = () => {
    idempotencyKey = crypto.randomUUID();
  };

  const contextQuery = query.create<string, InvitationContext>({
    source: () => `${props.spaceId}:${props.itemId}`,
    load: async (_source, { abortSignal }) => loadContext(props.spaceId, props.itemId, abortSignal),
  });
  const context = contextQuery.data;
  let initializedContext: InvitationContext | null = null;
  createEffect(() => {
    const result = context();
    if (!result || result === initializedContext) return;
    initializedContext = result;
    const mailbox = result.mailboxes[0];
    const identity = mailbox?.identities.find((candidate) => candidate.isDefault) ?? mailbox?.identities[0];
    setMailboxId(mailbox?.id ?? null);
    setSenderIdentityId(identity?.id ?? null);
    setRecipients(result.attendees.map((attendee) => attendee.address).join(", "));
  });

  const selectedMailbox = createMemo(() => context()?.mailboxes.find((mailbox) => mailbox.id === mailboxId()) ?? null);

  const chooseMailbox = (nextMailboxId: string | null) => {
    resetIdempotency();
    setMailboxId(nextMailboxId);
    const mailbox = context()?.mailboxes.find((candidate) => candidate.id === nextMailboxId);
    const identity = mailbox?.identities.find((candidate) => candidate.isDefault) ?? mailbox?.identities[0];
    setSenderIdentityId(identity?.id ?? null);
  };

  type InvitationIntent = {
    idempotencyKey: string;
    mailboxId: string;
    senderIdentityId: string;
    attendees: Array<{ name: null; address: string }>;
    method: "request" | "cancel";
    mailTab: Window;
  };
  const create = mutation.create<void, InvitationIntent>({
    mutation: async (intent, { abortSignal }) => {
      try {
        const response = await apiClient[":id"].items[":itemId"]["invitation-draft"].$post(
          {
            param: { id: props.spaceId, itemId: props.itemId },
            json: {
              idempotencyKey: intent.idempotencyKey,
              mailboxId: intent.mailboxId,
              senderIdentityId: intent.senderIdentityId,
              attendees: intent.attendees,
              method: intent.method,
            },
          },
          { init: { signal: abortSignal } },
        );
        if (!response.ok) throw new Error(await readResponseError(response, "Could not create the invitation draft"));
        const result = await response.json();
        intent.mailTab.location.replace(new URL(result.href, window.location.origin).href);
        toast.success(props.method === "cancel" ? "Cancellation opened in Mail" : "Invitation opened in Mail");
        props.onCreated();
        props.close();
      } catch (error) {
        intent.mailTab.close();
        throw error;
      }
    },
    onError: (error) =>
      prompts.error(error.message, {
        title: props.method === "cancel" ? "Could not prepare cancellation" : "Could not prepare invitation",
      }),
  });
  const createInvitation = () => {
    if (create.loading()) return;
    const parsed = parseAttendees(recipients());
    if (!parsed.ok) {
      setValidationError(parsed.message);
      return;
    }
    const selectedMailboxId = mailboxId();
    const selectedSenderIdentityId = senderIdentityId();
    if (!selectedMailboxId || !selectedSenderIdentityId) {
      setValidationError("Choose a mailbox with a verified sending identity.");
      return;
    }
    setValidationError(null);
    const mailTab = window.open("about:blank", "_blank");
    if (!mailTab) {
      void prompts.error("Mail could not open a new tab. Allow pop-ups for Cloud and try again.");
      return;
    }
    mailTab.opener = null;
    void create.mutate({
      idempotencyKey,
      mailboxId: selectedMailboxId,
      senderIdentityId: selectedSenderIdentityId,
      attendees: parsed.attendees,
      method: props.method,
      mailTab,
    });
  };

  onCleanup(() => {
    create.abort();
  });

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={props.method === "cancel" ? "Prepare cancellation" : "Prepare invitation"}
        subtitle="Choose the sender and recipients."
        icon={props.method === "cancel" ? "ti ti-calendar-cancel" : "ti ti-calendar-share"}
        close={props.close}
      />
      <PanelDialog.Body>
        <NoticeCard
          tone="info"
          title="Review before sending"
          detail={
            props.method === "cancel"
              ? "Nothing is sent yet. Review the cancellation in Mail before sending it."
              : "Nothing is sent yet. People who already received this invitation will get an update when you send it."
          }
        />
        <Show
          when={context()}
          fallback={
            <Placeholder
              state={contextQuery.error() ? "error" : "loading"}
              variant="compact"
              title={contextQuery.error() ? "Mail senders unavailable" : "Loading Mail senders"}
              description={contextQuery.error()?.message}
              action={
                contextQuery.error() ? (
                  <Button variant="secondary" size="sm" type="button" onClick={() => void contextQuery.refresh()}>
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
          loading={create.loading()}
          loadingLabel={props.method === "cancel" ? "Preparing cancellation" : "Preparing invitation"}
          disabled={contextQuery.loading() || !context() || !mailboxId() || !senderIdentityId()}
          onClick={createInvitation}
        >
          <i class="ti ti-mail-plus" aria-hidden="true" />
          Continue in Mail
        </Button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

const openDialog = (spaceId: string, itemId: string, method: "request" | "cancel", onCreated: () => void) =>
  dialogCore.open<void>(
    (close) => <InvitationDialog spaceId={spaceId} itemId={itemId} method={method} close={() => close()} onCreated={onCreated} />,
    panelDialogOptions,
  );

export default function EventInvitations(props: { spaceId: string; itemId: string }) {
  const contextQuery = query.create<string, InvitationContext>({
    source: () => `${props.spaceId}:${props.itemId}`,
    load: async (_source, { abortSignal }) => loadContext(props.spaceId, props.itemId, abortSignal),
  });
  const context = contextQuery.data;
  const reconcile = () => {
    void contextQuery.invalidate().catch(() => prompts.error("Invitation prepared, but its status could not be refreshed."));
  };
  return (
    <DetailPanel.Section title="Invitations" icon="ti ti-calendar-share" tone="accent">
      <Show when={contextQuery.error()}>
        {(error) => (
          <Placeholder
            state="error"
            variant="compact"
            align="left"
            class="mb-2"
            title="Invitation status unavailable"
            description={error().message}
            action={
              <Button type="button" variant="secondary" size="xs" onClick={() => void contextQuery.refresh()}>
                Retry
              </Button>
            }
          />
        )}
      </Show>
      <Show when={context()?.lastDelivery?.state === "failed"}>
        <NoticeCard
          tone="danger"
          class="mb-2"
          title="Mail draft failed"
          detail={`${context()?.lastDelivery?.errorMessage ?? "The latest Mail draft could not be created."} Retry by creating the invitation again.`}
        />
      </Show>
      <div class="flex flex-col gap-1">
        <DetailPanel.Action
          type="button"
          leading={<i class="ti ti-calendar-share" aria-hidden="true" />}
          title="Prepare invitation"
          onClick={() => openDialog(props.spaceId, props.itemId, "request", reconcile)}
        />
        <Show when={context()?.canCancel}>
          <DetailPanel.Action
            type="button"
            leading={<i class="ti ti-calendar-cancel" aria-hidden="true" />}
            title="Prepare cancellation"
            onClick={() => openDialog(props.spaceId, props.itemId, "cancel", reconcile)}
          />
        </Show>
      </div>
    </DetailPanel.Section>
  );
}
