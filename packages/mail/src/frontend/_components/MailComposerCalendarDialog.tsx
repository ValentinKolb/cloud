import { type DateContext, dates } from "@k2b/stdlib";
import { mutation, query } from "@k2b/stdlib/solid";
import {
  Button,
  DateTimePicker,
  dialogCore,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  SegmentedControl,
  Select,
  TextInput,
} from "@k2b/ui";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
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
  const [attempted, setAttempted] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const destinationQuery = query.create({
    source: () => props.mailboxId,
    load: async (mailboxId, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["calendar-destinations"].$get(
        { param: { mailboxId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Spaces could not be loaded"));
      return response.json();
    },
  });
  createEffect(() => {
    const value = destinationQuery.data();
    if (!value) return;
    setDestinations(value.items);
    if (!spaceId()) setSpaceId(value.selectedSpaceId ?? value.items[0]?.id ?? "");
  });

  const eventQuery = query.create({
    source: spaceId,
    enabled: () => Boolean(spaceId()),
    load: async (nextSpaceId, { abortSignal }) => {
      const response = await apiClient.mailboxes[":mailboxId"]["calendar-events"].$get(
        { param: { mailboxId: props.mailboxId }, query: { spaceId: nextSpaceId } },
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Events could not be loaded"));
      return response.json();
    },
  });
  createEffect(() => {
    const values = eventQuery.data() ?? [];
    setEvents(values);
    setEventId(values[0]?.id ?? "");
  });

  const loading = () => destinationQuery.loading() || eventQuery.loading();

  const selectSpace = (value: string | null) => {
    const next = value ?? "";
    setSpaceId(next);
    setEvents([]);
    setEventId("");
    setAttempted(false);
    setError(null);
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

  const attachMutation = mutation.create<MailDraft, void, { invitationKey: string }>({
    onBefore: () => ({ invitationKey: crypto.randomUUID() }),
    mutation: async (_, { abortSignal, invitationKey }) => {
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
            { init: { signal: abortSignal } },
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
        { init: { signal: abortSignal } },
      );
      if (!response.ok) throw new Error(await readApiError(response, "Invitation could not be attached"));
      return response.json();
    },
    onSuccess: (draft) => props.close(draft),
    onError: (cause) => setError(cause.message),
  });
  const saving = attachMutation.loading;

  const attach = async () => {
    if (saving()) return;
    setAttempted(true);
    if (validationError()) return;
    setError(null);
    await attachMutation.mutate();
  };

  onCleanup(() => attachMutation.abort());

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
        closeDisabled={saving()}
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
            <Show
              when={!destinationQuery.loading()}
              fallback={<Placeholder state="loading" variant="compact" align="left" title="Loading writable Spaces" />}
            >
              <Show
                when={!destinationQuery.error()}
                fallback={
                  <Placeholder
                    state="error"
                    variant="compact"
                    align="left"
                    title="Writable Spaces unavailable"
                    description={destinationQuery.error()?.message}
                    action={
                      <Button variant="secondary" size="sm" type="button" onClick={() => void destinationQuery.refresh()}>
                        Retry
                      </Button>
                    }
                  />
                }
              >
                <Show
                  when={destinations().length > 0}
                  fallback={
                    <Placeholder
                      state="empty"
                      variant="compact"
                      align="left"
                      icon="ti ti-calendar-off"
                      title="No writable Spaces"
                      description="Create a Space or ask for write access first."
                    />
                  }
                >
                  <Select
                    label="Space"
                    placeholder="Choose a Space"
                    value={spaceId}
                    onValueChange={selectSpace}
                    options={destinations().map((space) => ({ id: space.id, label: space.name, color: space.color }))}
                    disabled={saving() || Boolean(createdEventId())}
                  />
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
                    <Show
                      when={!eventQuery.loading()}
                      fallback={<Placeholder state="loading" variant="compact" align="left" title="Loading events" />}
                    >
                      <Show
                        when={!eventQuery.error()}
                        fallback={
                          <Placeholder
                            state="error"
                            variant="compact"
                            align="left"
                            title="Events unavailable"
                            description={eventQuery.error()?.message}
                            action={
                              <Button variant="secondary" size="sm" type="button" onClick={() => void eventQuery.refresh()}>
                                Retry
                              </Button>
                            }
                          />
                        }
                      >
                        <Show
                          when={events().length > 0}
                          fallback={
                            <Placeholder
                              state="empty"
                              variant="compact"
                              align="left"
                              icon="ti ti-calendar-off"
                              title="No events in this Space"
                              description="Choose New event to create one."
                            />
                          }
                        >
                          <Select
                            label="Event"
                            placeholder="Choose an event"
                            value={eventId}
                            onValueChange={setEventId}
                            options={events().map((event) => ({
                              id: event.id,
                              label: event.title,
                              description: `${dates.formatDateTime(event.startsAt, props.dateConfig)}${event.location ? ` · ${event.location}` : ""}`,
                              icon: "ti ti-calendar-event",
                            }))}
                            disabled={saving()}
                          />
                        </Show>
                      </Show>
                    </Show>
                  </Show>
                </Show>
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
        <Button
          size="sm"
          type="button"
          loading={saving()}
          loadingLabel="Attaching invitation"
          disabled={loading() || !spaceId() || Boolean(destinationQuery.error()) || (mode() === "existing" && Boolean(eventQuery.error()))}
          onClick={() => void attach()}
        >
          <i class="ti ti-paperclip" aria-hidden="true" />
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
