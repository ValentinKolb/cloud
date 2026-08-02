import { documentNavigate } from "@k2b/ssr/nav";
import { type DateContext, dates } from "@k2b/stdlib";
import { mutation } from "@k2b/stdlib/solid";
import { Button, ButtonLink, Select, StatusBadge, toast } from "@k2b/ui";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import { readApiError } from "./api-response";
import { mailDraftHref } from "./mail-compose-route";

export default function MailCalendarInvitation(props: {
  mailboxId: string;
  messageId: string;
  requestUrl: string;
  canWrite: boolean;
  dateConfig: DateContext;
}) {
  const [preview, setPreview] = createSignal<Awaited<ReturnType<typeof loadPreview>> | null>(null);
  const [destinations, setDestinations] = createSignal<Awaited<ReturnType<typeof loadDestinations>> | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(null);

  const loadPreview = async (signal: AbortSignal) => {
    const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["calendar-invitation"].$get(
      { param: { mailboxId: props.mailboxId, messageId: props.messageId } },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await readApiError(response, "Could not read this calendar invitation"));
    return response.json();
  };
  const loadDestinations = async (signal: AbortSignal) => {
    const response = await apiClient.mailboxes[":mailboxId"]["calendar-destinations"].$get(
      { param: { mailboxId: props.mailboxId } },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await readApiError(response, "Could not load calendar destinations"));
    return response.json();
  };

  const loading = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const [nextPreview, nextDestinations] = await Promise.all([
        loadPreview(abortSignal),
        props.canWrite ? loadDestinations(abortSignal) : Promise.resolve(null),
      ]);
      setPreview(nextPreview);
      setDestinations(nextDestinations);
      setSelectedSpaceId(nextPreview.existing?.spaceId ?? nextDestinations?.selectedSpaceId ?? nextDestinations?.items[0]?.id ?? null);
    },
  });

  const importEvent = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["calendar-invitation"].import.$post(
        {
          param: { mailboxId: props.mailboxId, messageId: props.messageId },
          json: selectedSpaceId() ? { spaceId: selectedSpaceId()! } : {},
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not add this event to Spaces"));
      const result = await response.json();
      toast.success(
        result.outcome === "created"
          ? "Event added to Spaces"
          : result.outcome === "unchanged"
            ? "Event is already up to date"
            : "Event updated in Spaces",
      );
      window.open(result.href, "_blank", "noopener,noreferrer");
      const current = preview();
      if (current) {
        setPreview({
          ...current,
          existing: { ...result, sequence: current.invitation.sequence, method: current.invitation.method },
        });
      }
    },
  });

  const respond = mutation.create<void, { participationStatus: "accepted" | "tentative" | "declined"; idempotencyKey: string }>({
    mutation: async ({ participationStatus, idempotencyKey }, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["calendar-invitation"].respond.$post(
        {
          param: { mailboxId: props.mailboxId, messageId: props.messageId },
          json: { participationStatus, idempotencyKey },
        },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Could not create the calendar response"));
      const draft = await response.json();
      documentNavigate(mailDraftHref(props.mailboxId, draft.id, props.requestUrl));
    },
  });

  const invitation = () => preview()?.invitation;
  const isCancelled = () => invitation()?.method === "cancel" || invitation()?.status === "cancelled";
  const canRespond = () =>
    props.canWrite &&
    Boolean(preview()?.existing) &&
    invitation()?.method === "request" &&
    Boolean(invitation()?.organizer) &&
    !isCancelled();
  const destinationOptions = createMemo(() =>
    (destinations()?.items ?? []).map((space) => ({ id: space.id, label: space.name, color: space.color, icon: "ti ti-calendar-event" })),
  );

  onMount(() => loading.mutate());
  onCleanup(() => {
    loading.abort();
    importEvent.abort();
    respond.abort();
  });

  return (
    <div class="mt-3 min-h-24 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-3" aria-live="polite">
      <Show when={preview()} fallback={<p class="text-xs text-dimmed">{loading.error()?.message ?? "Reading calendar invitation…"}</p>}>
        {(value) => (
          <div class="flex flex-col gap-3">
            <div class="flex items-start gap-3">
              <span class={`mail-calendar-invitation-icon shrink-0 ${isCancelled() ? "text-danger" : "text-accent"}`}>
                <i class={`ti ${isCancelled() ? "ti-calendar-cancel" : "ti-calendar-event"}`} aria-hidden="true" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 class="truncate text-sm font-semibold text-primary">{value().invitation.title}</h3>
                  <Show when={isCancelled()}>
                    <StatusBadge tone="error" label="Cancelled" />
                  </Show>
                </div>
                <p class="mt-0.5 text-xs text-secondary">
                  {dates.formatDateTime(value().invitation.startsAt, props.dateConfig)} –{" "}
                  {dates.formatDateTime(value().invitation.endsAt, props.dateConfig)}
                </p>
                <Show when={value().invitation.location}>
                  {(location) => (
                    <p class="mt-0.5 truncate text-xs text-dimmed">
                      <i class="ti ti-map-pin mr-1" aria-hidden="true" />
                      {location()}
                    </p>
                  )}
                </Show>
                <Show when={value().invitation.organizer}>
                  {(organizer) => <p class="mt-0.5 truncate text-xs text-dimmed">Organized by {organizer().name ?? organizer().address}</p>}
                </Show>
                <Show when={value().response}>
                  {(response) => (
                    <p class="mt-1 text-xs text-secondary">
                      <i class="ti ti-edit mr-1" aria-hidden="true" />
                      {response().participationStatus === "accepted"
                        ? "Acceptance"
                        : response().participationStatus === "tentative"
                          ? "Tentative response"
                          : "Decline"}{" "}
                      draft prepared in Mail
                    </p>
                  )}
                </Show>
              </div>
            </div>

            <Show when={props.canWrite}>
              <div class="flex flex-wrap items-end gap-2">
                <Show when={!value().existing && destinationOptions().length > 1}>
                  <div class="min-w-48 flex-1">
                    <Select
                      aria-label="Destination Space"
                      value={() => selectedSpaceId() ?? undefined}
                      onValueChange={setSelectedSpaceId}
                      options={destinationOptions()}
                      placeholder="Choose a Space"
                    />
                  </div>
                </Show>
                <Show
                  when={value().existing}
                  fallback={
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={!selectedSpaceId() || importEvent.loading()}
                      onClick={() => importEvent.mutate()}
                    >
                      <i class={importEvent.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-calendar-plus"} aria-hidden="true" />
                      Add to Spaces
                    </Button>
                  }
                >
                  {(existing) => (
                    <ButtonLink variant="secondary" size="sm" href={existing().href} target="_blank" rel="noreferrer">
                      <i class="ti ti-external-link" aria-hidden="true" />
                      Open in Spaces
                    </ButtonLink>
                  )}
                </Show>
                <Show when={canRespond()}>
                  <div class="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      type="button"
                      disabled={respond.loading()}
                      onClick={() => respond.mutate({ participationStatus: "accepted", idempotencyKey: crypto.randomUUID() })}
                    >
                      <i class="ti ti-check" aria-hidden="true" /> Accept
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={respond.loading()}
                      onClick={() => respond.mutate({ participationStatus: "tentative", idempotencyKey: crypto.randomUUID() })}
                    >
                      Maybe
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={respond.loading()}
                      onClick={() => respond.mutate({ participationStatus: "declined", idempotencyKey: crypto.randomUUID() })}
                    >
                      Decline
                    </Button>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={importEvent.error() || respond.error()}>
              <p class="text-xs text-danger">{importEvent.error()?.message ?? respond.error()?.message}</p>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
