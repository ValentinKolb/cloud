import { type DateContext, dates } from "@k2b/stdlib";
import { Button, DateTimePicker, dialogCore, PanelDialog, panelDialogOptions, SegmentedControl, Select, TextInput } from "@k2b/ui";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { apiClient } from "../../api/client";
import type { CalendarEvent } from "../../app-integration-contracts";
import type { MailDraft } from "../../contracts";
import { readApiError } from "./api-response";

type CalendarDestination = { id: string; name: string; color: string };

const defaultRange = (): { startsAt: string; endsAt: string } => {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setMinutes(0, 0, 0);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString() };
};

function MailComposerCalendarDialog(props: {
  mailboxId: string;
  draftId: string;
  recipientCount: number;
  dateConfig: DateContext;
  close: (value: MailDraft | null) => void;
}) {
  const defaults = defaultRange();
  const [mode, setMode] = createSignal<"existing" | "create">("existing");
  const [destinations, setDestinations] = createSignal<CalendarDestination[]>([]);
  const [spaceId, setSpaceId] = createSignal("");
  const [events, setEvents] = createSignal<CalendarEvent[]>([]);
  const [eventId, setEventId] = createSignal("");
  const [createdEventId, setCreatedEventId] = createSignal("");
  const [title, setTitle] = createSignal("");
  const [location, setLocation] = createSignal("");
  const [startsAt, setStartsAt] = createSignal<string | null>(defaults.startsAt);
  const [endsAt, setEndsAt] = createSignal<string | null>(defaults.endsAt);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let controller: AbortController | null = null;
  const invitationKey = crypto.randomUUID();

  const nextController = () => {
    controller?.abort();
    controller = new AbortController();
    return controller;
  };

  const loadEvents = async (nextSpaceId: string, signal: AbortSignal) => {
    setEvents([]);
    setEventId("");
    if (!nextSpaceId) return;
    const response = await apiClient.mailboxes[":mailboxId"]["calendar-events"].$get(
      { param: { mailboxId: props.mailboxId }, query: { spaceId: nextSpaceId } },
      { init: { signal } },
    );
    if (!response.ok) throw new Error(await readApiError(response, "Events could not be loaded"));
    const values = await response.json();
    if (signal.aborted) return;
    setEvents(values);
    setEventId(values[0]?.id ?? "");
  };

  onMount(() => {
    const request = nextController();
    void (async () => {
      try {
        const response = await apiClient.mailboxes[":mailboxId"]["calendar-destinations"].$get(
          { param: { mailboxId: props.mailboxId } },
          { init: { signal: request.signal } },
        );
        if (!response.ok) throw new Error(await readApiError(response, "Spaces could not be loaded"));
        const value = await response.json();
        setDestinations(value.items);
        const selected = value.selectedSpaceId ?? value.items[0]?.id ?? "";
        setSpaceId(selected);
        await loadEvents(selected, request.signal);
      } catch (cause) {
        if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Calendar options could not be loaded");
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    })();
  });
  onCleanup(() => controller?.abort());

  const selectSpace = (value: string | null) => {
    const next = value ?? "";
    setSpaceId(next);
    setAttempted(false);
    setError(null);
    setLoading(true);
    const request = nextController();
    void loadEvents(next, request.signal)
      .catch((cause) => {
        if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Events could not be loaded");
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
  };

  const validationError = createMemo(() => {
    if (props.recipientCount === 0) return "Add at least one To or Cc recipient first.";
    if (!spaceId()) return "Choose a writable Space.";
    if (mode() === "existing") return eventId() ? null : "Choose an event.";
    if (!title().trim()) return "Enter an event title.";
    if (!startsAt() || !endsAt()) return "Choose a start and end time.";
    if (new Date(endsAt()!) <= new Date(startsAt()!)) return "End time must be after start time.";
    return null;
  });

  const attach = async () => {
    if (saving()) return;
    setAttempted(true);
    if (validationError()) return;
    setSaving(true);
    setError(null);
    const request = nextController();
    try {
      let itemId = eventId();
      if (mode() === "create") {
        itemId = createdEventId();
        if (!itemId) {
          const response = await apiClient.mailboxes[":mailboxId"]["calendar-events"].$post(
            {
              param: { mailboxId: props.mailboxId },
              json: {
                spaceId: spaceId(),
                title: title().trim(),
                location: location().trim() || undefined,
                startsAt: startsAt()!,
                endsAt: endsAt()!,
              },
            },
            { init: { signal: request.signal } },
          );
          if (!response.ok) throw new Error(await readApiError(response, "Event could not be created"));
          itemId = (await response.json()).id;
          setCreatedEventId(itemId);
        }
      }
      const response = await apiClient.mailboxes[":mailboxId"].drafts[":draftId"]["calendar-invitation"].$post(
        {
          param: { mailboxId: props.mailboxId, draftId: props.draftId },
          json: { itemId, idempotencyKey: invitationKey },
        },
        { init: { signal: request.signal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Invitation could not be attached"));
      props.close(await response.json());
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Invitation could not be attached");
        setSaving(false);
      }
    }
  };

  const closeDialog = () => {
    if (!saving()) props.close(null);
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Add calendar invitation"
        subtitle="Attach an existing event or create one in Spaces"
        icon="ti ti-calendar-plus"
        close={closeDialog}
      />
      <PanelDialog.Body>
        <PanelDialog.Section
          title="Event"
          subtitle="To and Cc recipients become attendees. Bcc recipients stay private."
          icon="ti ti-calendar-event"
        >
          <div class="flex flex-col gap-3">
            <SegmentedControl<"existing" | "create">
              ariaLabel="Calendar event source"
              value={mode}
              onValueChange={(value) => {
                setMode(value);
                setAttempted(false);
                setError(null);
              }}
              disabled={saving() || Boolean(createdEventId())}
              options={[
                { value: "existing", label: "Existing event", icon: "ti ti-calendar" },
                { value: "create", label: "New event", icon: "ti ti-calendar-plus" },
              ]}
            />
            <Select
              label="Space"
              placeholder={loading() ? "Loading Spaces..." : "Choose a Space"}
              value={spaceId}
              onValueChange={selectSpace}
              options={destinations().map((space) => ({ id: space.id, label: space.name, color: space.color }))}
              disabled={loading() || saving() || Boolean(createdEventId())}
            />
            <Show when={!loading() && destinations().length === 0}>
              <p class="text-xs text-dimmed">No writable Spaces are available. Create a Space or ask for write access first.</p>
            </Show>
            <Show
              when={mode() === "existing"}
              fallback={
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="sm:col-span-2">
                    <TextInput
                      label="Title"
                      value={title}
                      onValueChange={setTitle}
                      maxLength={200}
                      disabled={saving() || Boolean(createdEventId())}
                    />
                  </div>
                  <div class="sm:col-span-2">
                    <TextInput
                      label="Location"
                      value={location}
                      onValueChange={setLocation}
                      maxLength={500}
                      disabled={saving() || Boolean(createdEventId())}
                    />
                  </div>
                  <DateTimePicker
                    label="Starts"
                    value={startsAt}
                    onValueChange={setStartsAt}
                    dateConfig={props.dateConfig}
                    disabled={saving() || Boolean(createdEventId())}
                  />
                  <DateTimePicker
                    label="Ends"
                    value={endsAt}
                    onValueChange={setEndsAt}
                    dateConfig={props.dateConfig}
                    disabled={saving() || Boolean(createdEventId())}
                  />
                </div>
              }
            >
              <Select
                label="Event"
                placeholder={loading() ? "Loading events..." : "Choose an event"}
                value={eventId}
                onValueChange={setEventId}
                options={events().map((event) => ({
                  id: event.id,
                  label: event.title,
                  description: `${dates.formatDateTime(event.startsAt, props.dateConfig)}${event.location ? ` · ${event.location}` : ""}`,
                  icon: "ti ti-calendar-event",
                }))}
                disabled={loading() || saving()}
              />
              <Show when={!loading() && Boolean(spaceId()) && events().length === 0}>
                <p class="text-xs text-dimmed">No events are available in this Space. Choose New event to create one.</p>
              </Show>
            </Show>
            <Show when={error() ?? (attempted() ? validationError() : null)}>
              {(message) => (
                <p class="text-xs text-danger" role="alert">
                  {message()}
                </p>
              )}
            </Show>
            <Show when={createdEventId() && error()}>
              <p class="text-xs text-dimmed">The event was created in Spaces. Retry to attach the same invitation.</p>
            </Show>
          </div>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <Button variant="secondary" size="sm" type="button" disabled={saving()} onClick={closeDialog}>
          Cancel
        </Button>
        <Button size="sm" type="button" disabled={loading() || saving()} onClick={() => void attach()}>
          <i class={`ti ${saving() ? "ti-loader-2 animate-spin" : "ti-paperclip"}`} aria-hidden="true" />
          Attach invitation
        </Button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openMailComposerCalendarDialog = (params: {
  mailboxId: string;
  draftId: string;
  recipientCount: number;
  dateConfig: DateContext;
}): Promise<MailDraft | null | undefined> =>
  dialogCore.open<MailDraft | null>((close) => <MailComposerCalendarDialog {...params} close={close} />, {
    ...panelDialogOptions,
    cancelBehavior: "ignore",
  });
