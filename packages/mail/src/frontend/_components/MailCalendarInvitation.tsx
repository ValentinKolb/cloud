import { documentNavigate } from "@k2b/ssr/nav";
import { type DateContext, dates } from "@k2b/stdlib";
import { mutation } from "@k2b/stdlib/solid";
import { Button, ButtonLink, Placeholder, Select, StatusBadge, toast } from "@k2b/ui";
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
  let responseIdempotencyKeys = new Map<"accepted" | "tentative" | "declined", string>();
  let destinationTouched = false;

  const chooseSpace = (spaceId: string | null) => {
    destinationTouched = true;
    responseIdempotencyKeys = new Map();
    setSelectedSpaceId(spaceId);
  };
  const reconcileDestination = () => {
    if (destinationTouched) return;
    const available = destinations();
    if (!available) return;
    const existingSpaceId = preview()?.existing?.spaceId ?? null;
    setSelectedSpaceId(
      existingSpaceId
        ? available.items.some((space) => space.id === existingSpaceId)
          ? existingSpaceId
          : null
        : (available.selectedSpaceId ?? available.items[0]?.id ?? null),
    );
  };
  const responseIdempotencyKey = (participationStatus: "accepted" | "tentative" | "declined") => {
    const existing = responseIdempotencyKeys.get(participationStatus);
    if (existing) return existing;
    const created = crypto.randomUUID();
    responseIdempotencyKeys.set(participationStatus, created);
    return created;
  };

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

  const previewLoad = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      setPreview(await loadPreview(abortSignal));
      reconcileDestination();
    },
  });

  const destinationLoad = mutation.create<void, void>({
    mutation: async (_input, { abortSignal }) => {
      setDestinations(await loadDestinations(abortSignal));
      reconcileDestination();
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
      const current = preview();
      if (current) {
        setPreview({
          ...current,
          existing: { ...result, sequence: current.invitation.sequence, method: current.invitation.method },
        });
      }
    },
  });

  const respond = mutation.create<void, "accepted" | "tentative" | "declined">({
    mutation: async (participationStatus, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"].messages[":messageId"]["calendar-invitation"].respond.$post(
        {
          param: { mailboxId: props.mailboxId, messageId: props.messageId },
          json: {
            participationStatus,
            idempotencyKey: responseIdempotencyKey(participationStatus),
            ...(selectedSpaceId() ? { spaceId: selectedSpaceId()! } : {}),
          },
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
  const linkedSpaceIsWritable = () => {
    const existingSpaceId = preview()?.existing?.spaceId;
    return !existingSpaceId || destinationOptions().some((space) => space.id === existingSpaceId);
  };
  const hasWritableDestination = () => linkedSpaceIsWritable() && destinationOptions().some((space) => space.id === selectedSpaceId());
  const canRespond = () =>
    props.canWrite && hasWritableDestination() && invitation()?.method === "request" && Boolean(invitation()?.organizer) && !isCancelled();
  const destinationOptions = createMemo(() =>
    (destinations()?.items ?? []).map((space) => ({ id: space.id, label: space.name, color: space.color, icon: "ti ti-calendar-event" })),
  );

  onMount(() => {
    previewLoad.mutate();
    if (props.canWrite) destinationLoad.mutate();
  });
  onCleanup(() => {
    previewLoad.abort();
    destinationLoad.abort();
    importEvent.abort();
    respond.abort();
  });

  return (
    <div class="mt-3 min-h-24 rounded-[var(--ui-radius-surface)] bg-[var(--ui-surface-subtle)] p-3" aria-live="polite">
      <Show
        when={preview()}
        fallback={
          <Placeholder
            state={previewLoad.error() ? "error" : "loading"}
            variant="compact"
            title={previewLoad.error() ? "Calendar invitation unavailable" : "Reading calendar invitation"}
            description={previewLoad.error()?.message}
            action={
              previewLoad.error() ? (
                <Button variant="secondary" size="sm" type="button" onClick={() => previewLoad.mutate()}>
                  Retry
                </Button>
              ) : undefined
            }
          />
        }
      >
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
                      value={() => selectedSpaceId() ?? null}
                      onValueChange={chooseSpace}
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
                      disabled={respond.loading() || importEvent.loading()}
                      onClick={() => respond.mutate("accepted")}
                    >
                      <i class="ti ti-check" aria-hidden="true" /> Accept
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={respond.loading() || importEvent.loading()}
                      onClick={() => respond.mutate("tentative")}
                    >
                      Maybe
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={respond.loading() || importEvent.loading()}
                      onClick={() => respond.mutate("declined")}
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
            <Show when={props.canWrite && destinationLoad.loading()}>
              <p class="text-xs text-dimmed">Loading writable Spaces…</p>
            </Show>
            <Show when={props.canWrite && destinationLoad.error()}>
              <div class="flex flex-wrap items-center gap-2 text-xs text-danger">
                <span>{destinationLoad.error()?.message}</span>
                <Button variant="ghost" size="sm" type="button" onClick={() => destinationLoad.mutate()}>
                  Retry
                </Button>
              </div>
            </Show>
            <Show when={props.canWrite && value().existing && destinations() && !linkedSpaceIsWritable()}>
              <p class="text-xs text-dimmed">This event is linked to a Space where you do not have write access.</p>
            </Show>
            <Show when={props.canWrite && destinations() && destinationOptions().length === 0}>
              <p class="text-xs text-dimmed">No writable Space is available. Ask a Space owner for write access.</p>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
