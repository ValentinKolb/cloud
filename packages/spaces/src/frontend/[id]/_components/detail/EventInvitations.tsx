import { documentNavigate } from "@k2b/ssr/nav";
import { mutation } from "@k2b/stdlib/solid";
import { PanelDialog, prompts, Select, TextInput, toast } from "@valentinkolb/cloud/ui";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
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
  const [recipients, setRecipients] = createSignal("");
  const [validationError, setValidationError] = createSignal<string | null>(null);
  const idempotencyKey = crypto.randomUUID();

  const load = mutation.create<InvitationContext, void>({
    mutation: async (_input, { abortSignal }) => loadContext(props.spaceId, props.itemId, abortSignal),
    onSuccess: (result) => {
      setContext(result);
      setMailboxId(result.mailboxes[0]?.id ?? null);
      setRecipients(result.attendees.map((attendee) => attendee.address).join(", "));
    },
  });

  const create = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const parsed = parseAttendees(recipients());
      if (!parsed.ok) {
        setValidationError(parsed.message);
        return;
      }
      if (!mailboxId()) {
        setValidationError("Choose a mailbox with a verified sending identity.");
        return;
      }
      setValidationError(null);
      const response = await apiClient[":id"].items[":itemId"]["invitation-draft"].$post(
        {
          param: { id: props.spaceId, itemId: props.itemId },
          json: {
            idempotencyKey,
            mailboxId: mailboxId()!,
            attendees: parsed.attendees,
            method: props.method,
          },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readResponseError(response, "Could not create the invitation draft"));
      const result = await response.json();
      toast.success(props.method === "cancel" ? "Cancellation draft created" : "Invitation draft created");
      props.close();
      documentNavigate(result.href);
    },
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
        <Show when={context()} fallback={<p class="text-sm text-dimmed">{load.error()?.message ?? "Loading Mail senders…"}</p>}>
          {(value) => (
            <PanelDialog.Section title="Delivery" subtitle="Choose the organizer identity and recipients." icon="ti ti-mail-forward">
              <Select
                label="Send from"
                value={() => mailboxId() ?? undefined}
                onChange={setMailboxId}
                options={value().mailboxes.map((mailbox) => ({
                  id: mailbox.id,
                  label: mailbox.name,
                  description: mailbox.from.name ? `${mailbox.from.name} <${mailbox.from.address}>` : mailbox.from.address,
                  icon: "ti ti-mail",
                }))}
                placeholder="No writable Mail mailbox"
                disabled={value().mailboxes.length === 0}
              />
              <TextInput
                label="Attendees"
                description="Separate email addresses with commas, spaces, or new lines."
                icon="ti ti-users"
                multiline
                lines={3}
                value={recipients}
                onInput={setRecipients}
                error={() => validationError() ?? undefined}
                placeholder="alex@example.com, sam@example.com"
              />
            </PanelDialog.Section>
          )}
        </Show>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <button type="button" class="btn-secondary" onClick={props.close}>
          Cancel
        </button>
        <button
          type="button"
          class={props.method === "cancel" ? "btn-danger" : "btn-primary"}
          disabled={load.loading() || create.loading() || !context()}
          onClick={() => create.mutate()}
        >
          <i class={create.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-edit"} aria-hidden="true" />
          Create Mail draft
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

const openDialog = (spaceId: string, itemId: string, method: "request" | "cancel") =>
  prompts.dialog<void>((close) => <InvitationDialog spaceId={spaceId} itemId={itemId} method={method} close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "medium",
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
        <button type="button" class="btn-secondary btn-sm" onClick={() => openDialog(props.spaceId, props.itemId, "request")}>
          <i class="ti ti-calendar-share" aria-hidden="true" />
          Invite or update
        </button>
        <Show when={canCancel()}>
          <button type="button" class="btn-simple btn-sm" onClick={() => openDialog(props.spaceId, props.itemId, "cancel")}>
            <i class="ti ti-calendar-cancel" aria-hidden="true" />
            Cancel invitations
          </button>
        </Show>
      </div>
    </section>
  );
}
