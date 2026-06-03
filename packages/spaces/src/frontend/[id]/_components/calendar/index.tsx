import {
  type CalendarEvent,
  type CalendarEventTimeChange,
  Calendar as CoreCalendar,
  type CalendarView as CoreCalendarView,
  dialogCore,
  PanelDialog,
  panelDialogOptions,
  prompts,
  toast,
} from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { dates as calendar } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { CalendarItem, SpaceItem } from "@/contracts";
import { editItemWithDialog, handleEditItemSuccess } from "../shared/editItem";
import ItemForm, { type ItemFormData } from "../shared/ItemForm";
import { recurrenceUntilBefore } from "../shared/recurrence";
import { requestCurrentSpacesRouteRefresh, requestSpacesRouteNavigation } from "../workspace/workspace-events";
import CalendarDetailNavigation from "./CalendarDetailNavigation";
import type { CalendarProps, CalendarView } from "./types";

const eventStart = (item: CalendarItem) => item.startsAt ?? item.deadline ?? calendar.today().toISOString();
const eventEnd = (item: CalendarItem) => item.endsAt ?? item.deadline ?? eventStart(item);

const CALENDAR_TAGS_PARAM = "ctags";

const buildCalendarHref = (baseUrl: string, view: CalendarView, date: Date, tagIds: string[], item?: string, dateConfig?: DateContext) => {
  const url = new URL(baseUrl, "http://spaces.local");
  url.searchParams.set("view", "calendar");
  url.searchParams.set("cv", view);
  url.searchParams.set("cd", calendar.formatDateKey(date, dateConfig));
  if (tagIds.length > 0) url.searchParams.set(CALENDAR_TAGS_PARAM, tagIds.join(","));
  else url.searchParams.delete(CALENDAR_TAGS_PARAM);
  if (item) url.searchParams.set("item", item);
  else url.searchParams.delete("item");
  return `${url.pathname}?${url.searchParams.toString()}`;
};

const priorityColor = (item: CalendarItem) => {
  if (!item.deadline || item.startsAt) return undefined;
  if (item.priority === "urgent" || item.priority === "high") return "red";
  return "amber";
};

const toCalendarEvent = (
  item: CalendarItem,
  baseUrl: string,
  view: CalendarView,
  date: Date,
  tagIds: string[],
  dateConfig?: DateContext,
): CalendarEvent => {
  const isDeadline = Boolean(item.deadline && !item.startsAt);
  const detailItemId = item.recurringEventId ?? item.id;
  return {
    id: item.id,
    title: item.title,
    start: eventStart(item),
    end: eventEnd(item),
    allDay: item.allDay || !item.startsAt,
    color: priorityColor(item),
    colorHex: isDeadline ? undefined : item.spaceColor,
    href: buildCalendarHref(baseUrl, view, date, tagIds, detailItemId, dateConfig),
    dataSpaceItemId: detailItemId,
    calendarName: item.spaceName,
    location: item.location ?? undefined,
    meta: isDeadline ? "Deadline" : item.spaceName,
    recurrence: item.recurrence
      ? {
          rrule: item.recurrence.rrule,
          exdate: item.recurrence.exdate,
          recurrenceId: item.recurrenceId ?? undefined,
        }
      : item.recurrenceId
        ? { rrule: "", recurrenceId: item.recurrenceId }
        : undefined,
  };
};

type RecurringEditScope = "occurrence" | "future" | "series";

const isRecurringCalendarEvent = (event: CalendarEvent) => Boolean(event.recurrence?.recurrenceId);

const recurrenceIdFromEvent = (event: CalendarEvent): string | null => {
  const value = event.recurrence?.recurrenceId;
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const upsertUntil = (rrule: string, until: string) =>
  [
    ...rrule
      .split(";")
      .filter((part) => !part.startsWith("UNTIL=") && !part.startsWith("COUNT="))
      .filter(Boolean),
    `UNTIL=${until}`,
  ].join(";");

const normalizeCreatePayload = (data: ItemFormData) => ({
  ...data,
  location: data.location ?? undefined,
  url: data.url ?? undefined,
  priority: data.priority ?? undefined,
  recurrence: data.recurrence ?? undefined,
});

const createPayloadFromItem = (item: SpaceItem, overrides: Partial<ItemFormData> = {}): ItemFormData => ({
  columnId: overrides.columnId ?? item.columnId,
  title: overrides.title ?? item.title,
  description: overrides.description ?? item.description ?? undefined,
  location: overrides.location ?? item.location ?? undefined,
  url: overrides.url ?? item.url ?? undefined,
  startsAt: overrides.startsAt ?? item.startsAt ?? undefined,
  endsAt: overrides.endsAt ?? item.endsAt ?? undefined,
  allDay: overrides.allDay ?? item.allDay,
  deadline: overrides.deadline ?? item.deadline ?? undefined,
  priority: overrides.priority ?? item.priority ?? undefined,
  recurrence: overrides.recurrence ?? item.recurrence,
  assigneeIds: overrides.assigneeIds ?? item.assignees?.map((assignee) => assignee.id),
  tagIds: overrides.tagIds ?? item.tags?.map((tag) => tag.id),
});

const chooseRecurringEditScope = async (): Promise<RecurringEditScope | null> =>
  (await dialogCore.open<RecurringEditScope | null>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Edit recurring event" icon="ti ti-repeat" close={() => close(null)} />
        <PanelDialog.Body>
          <PanelDialog.Section
            title="Apply changes"
            subtitle="Choose how this edit should affect the recurring series."
            icon="ti ti-calendar-repeat"
          >
            <div class="grid grid-cols-1 gap-2">
              {[
                ["occurrence", "This occurrence", "Only this visible event instance changes.", "ti ti-calendar-event"],
                ["future", "This and future", "Split the series from this occurrence onward.", "ti ti-arrow-forward-up"],
                ["series", "Entire series", "Update the source event and all generated occurrences.", "ti ti-repeat"],
              ].map(([scope, label, description, icon]) => (
                <button
                  type="button"
                  class="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-blue-500/50 dark:hover:bg-blue-500/10"
                  onClick={() => close(scope as RecurringEditScope)}
                >
                  <i class={`${icon} mt-0.5 text-base text-blue-500`} />
                  <span class="min-w-0">
                    <span class="block text-sm font-medium text-primary">{label}</span>
                    <span class="block text-xs text-dimmed">{description}</span>
                  </span>
                </button>
              ))}
            </div>
          </PanelDialog.Section>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <button type="button" class="btn-secondary btn-sm" onClick={() => close(null)}>
            Cancel
          </button>
        </PanelDialog.Footer>
      </PanelDialog>
    ),
    panelDialogOptions,
  )) ?? null;

export default function Calendar(props: CalendarProps) {
  const rootId = `space-calendar-${props.spaceId}`;
  const events = () =>
    props.items.map((item) => toCalendarEvent(item, props.baseUrl, props.view, props.date, props.selectedTagIds, props.dateConfig));
  const dayBadges = () =>
    Object.fromEntries(
      Object.entries(props.weather ?? {}).map(([date, weather]) => [
        date,
        {
          icon: weather.icon,
          label: `${Math.round(weather.tempMax)}°`,
        },
      ]),
    );
  const routeTo = (view: CalendarView, date: Date, replace = false) => {
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, view, date, props.selectedTagIds, undefined, props.dateConfig), {
      replace,
      scroll: "preserve",
    });
  };
  const toggleTag = (tagId: string) => {
    const selected = props.selectedTagIds.includes(tagId)
      ? props.selectedTagIds.filter((id) => id !== tagId)
      : [...props.selectedTagIds, tagId];
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, props.view, props.date, selected, undefined, props.dateConfig), {
      replace: true,
      scroll: "preserve",
    });
  };
  const clearTags = () => {
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, props.view, props.date, [], undefined, props.dateConfig), {
      replace: true,
      scroll: "preserve",
    });
  };
  const selectEvent = (event: CalendarEvent) => {
    const itemId = event.dataSpaceItemId ?? event.id;
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, props.view, props.date, props.selectedTagIds, itemId, props.dateConfig), {
      scroll: "preserve",
    });
  };
  const fetchItem = async (event: CalendarEvent) => {
    const itemId = event.dataSpaceItemId ?? event.id;
    const itemRes = await apiClient[":id"].items[":itemId"].$get({ param: { id: props.spaceId, itemId } });
    if (!itemRes.ok) throw new Error("Could not load event");
    return itemRes.json();
  };
  const createItem = async (data: ItemFormData & { recurringEventId?: string; recurrenceId?: string }) => {
    const res = await apiClient[":id"].items.$post({
      param: { id: props.spaceId },
      json: normalizeCreatePayload(data),
    });
    if (!res.ok) throw new Error("Could not create event");
  };
  const patchItem = async (itemId: string, data: Partial<ItemFormData>) => {
    const json: Record<string, unknown> = {};
    if ("columnId" in data) json.columnId = data.columnId;
    if ("title" in data) json.title = data.title;
    if ("description" in data) json.description = data.description ?? null;
    if ("location" in data) json.location = data.location ?? null;
    if ("url" in data) json.url = data.url ?? null;
    if ("priority" in data) json.priority = data.priority ?? null;
    if ("recurrence" in data) json.recurrence = data.recurrence;
    if ("deadline" in data) json.deadline = data.deadline ?? null;
    if ("startsAt" in data) json.startsAt = data.startsAt ?? null;
    if ("endsAt" in data) json.endsAt = data.endsAt ?? null;
    if ("allDay" in data) json.allDay = data.allDay;
    if ("assigneeIds" in data) json.assigneeIds = data.assigneeIds;
    if ("tagIds" in data) json.tagIds = data.tagIds;
    const res = await apiClient[":id"].items[":itemId"].$patch({
      param: { id: props.spaceId, itemId },
      json,
    });
    if (!res.ok) throw new Error("Could not update event");
  };
  const applyRecurringTimeChange = async (event: CalendarEvent, next: CalendarEventTimeChange) => {
    const recurrenceId = recurrenceIdFromEvent(event);
    if (!recurrenceId) return false;
    const parent = await fetchItem(event);
    const scope = await chooseRecurringEditScope();
    if (!scope) return true;

    if (scope === "occurrence") {
      await createItem({
        ...createPayloadFromItem(parent, {
          startsAt: next.start.toISOString(),
          endsAt: next.end.toISOString(),
          allDay: next.allDay ?? false,
          recurrence: null,
        }),
        recurringEventId: parent.id,
        recurrenceId,
      });
      return true;
    }

    if (scope === "future") {
      const parentRecurrence = parent.recurrence;
      if (!parentRecurrence) throw new Error("Recurring series data is missing");
      await patchItem(parent.id, {
        recurrence: { ...parentRecurrence, rrule: upsertUntil(parentRecurrence.rrule, recurrenceUntilBefore(recurrenceId)) },
      });
      await createItem(
        createPayloadFromItem(parent, {
          startsAt: next.start.toISOString(),
          endsAt: next.end.toISOString(),
          allDay: next.allDay ?? false,
          recurrence: { ...parentRecurrence, dtstart: next.start.toISOString(), exdate: [] },
        }),
      );
      return true;
    }

    await patchItem(parent.id, {
      startsAt: next.start.toISOString(),
      endsAt: next.end.toISOString(),
      allDay: next.allDay ?? false,
      recurrence: parent.recurrence ? { ...parent.recurrence, dtstart: next.start.toISOString() } : undefined,
    });
    return true;
  };
  const updateEventTime = mutations.create<void, { event: CalendarEvent; next: CalendarEventTimeChange }>({
    mutation: async ({ event, next }) => {
      if (isRecurringCalendarEvent(event)) {
        await applyRecurringTimeChange(event, next);
        return;
      }
      const itemId = event.dataSpaceItemId ?? event.id;
      const res = await apiClient[":id"].items[":itemId"].$patch({
        param: { id: props.spaceId, itemId },
        json: {
          startsAt: next.start.toISOString(),
          endsAt: next.end.toISOString(),
          deadline: null,
          allDay: next.allDay ?? false,
        },
      });
      if (!res.ok) throw new Error("Could not update event time");
    },
    onSuccess: () => requestCurrentSpacesRouteRefresh({ scroll: "preserve" }),
    onError: (error) => prompts.error(error.message),
  });
  const createEvent = mutations.create<boolean, CalendarEventTimeChange>({
    mutation: async (slot) => {
      const result = await dialogCore.open<ItemFormData | null>(
        (close) => (
          <ItemForm
            spaceId={props.spaceId}
            columns={props.columns}
            tags={props.tags}
            defaults={{
              type: "event",
              startsAt: slot.start.toISOString(),
              endsAt: slot.end.toISOString(),
              allDay: slot.allDay ?? false,
              tagIds: props.selectedTagIds,
            }}
            onSubmit={(data) => close(data)}
            onCancel={() => close(null)}
            title="New event"
            icon="ti ti-calendar-plus"
            dateConfig={props.dateConfig}
          />
        ),
        panelDialogOptions,
      );
      if (!result) return false;
      const res = await apiClient[":id"].items.$post({
        param: { id: props.spaceId },
        json: {
          ...normalizeCreatePayload(result),
        },
      });
      if (!res.ok) throw new Error("Could not create event");
      return true;
    },
    onSuccess: (created) => {
      if (!created) return;
      toast.success("Event created");
      requestCurrentSpacesRouteRefresh({ scroll: "preserve" });
    },
    onError: (error) => prompts.error(error.message),
  });
  const editEvent = mutations.create<boolean, CalendarEvent>({
    mutation: async (event) => {
      const parent = await fetchItem(event);
      const recurrenceId = recurrenceIdFromEvent(event);
      if (!recurrenceId) {
        return editItemWithDialog({
          spaceId: props.spaceId,
          item: parent,
          columns: props.columns,
          tags: props.tags,
          dateConfig: props.dateConfig,
        });
      }

      const scope = await chooseRecurringEditScope();
      if (!scope) return false;
      if (scope === "series") {
        return editItemWithDialog({
          spaceId: props.spaceId,
          item: parent,
          columns: props.columns,
          tags: props.tags,
          dateConfig: props.dateConfig,
        });
      }

      const formItem: SpaceItem = {
        ...parent,
        startsAt: new Date(event.start).toISOString(),
        endsAt: event.end ? new Date(event.end).toISOString() : parent.endsAt,
        allDay: event.allDay ?? parent.allDay,
        recurrence: scope === "future" ? parent.recurrence : null,
      };
      const result = await dialogCore.open<ItemFormData | null>(
        (close) => (
          <ItemForm
            spaceId={props.spaceId}
            item={formItem}
            columns={props.columns}
            tags={props.tags}
            onSubmit={(data) => close(data)}
            onCancel={() => close(null)}
            submitLabel="Save Item"
            title={scope === "future" ? "Edit future events" : "Edit occurrence"}
            icon={scope === "future" ? "ti ti-arrow-forward-up" : "ti ti-calendar-event"}
            dateConfig={props.dateConfig}
          />
        ),
        panelDialogOptions,
      );
      if (!result) return false;

      if (scope === "occurrence") {
        await createItem({ ...result, recurrence: null, recurringEventId: parent.id, recurrenceId });
        return true;
      }

      const parentRecurrence = parent.recurrence;
      if (!parentRecurrence) throw new Error("Recurring series data is missing");
      await patchItem(parent.id, {
        recurrence: { ...parentRecurrence, rrule: upsertUntil(parentRecurrence.rrule, recurrenceUntilBefore(recurrenceId)) },
      });
      await createItem({
        ...result,
        recurrence: result.recurrence ?? { ...parentRecurrence, dtstart: result.startsAt ?? recurrenceId, exdate: [] },
      });
      return true;
    },
    onSuccess: handleEditItemSuccess,
    onError: (error) => prompts.error(error.message),
  });

  return (
    <div id={rootId} class="flex min-h-0 flex-1 flex-col gap-2">
      <CalendarDetailNavigation rootId={rootId} />
      <Show when={props.tags.length > 0}>
        <div class="flex flex-wrap items-center gap-1.5 px-1">
          <button
            type="button"
            class={`btn-segment ${props.selectedTagIds.length === 0 ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : ""}`}
            onClick={clearTags}
          >
            All tags
          </button>
          <For each={props.tags}>
            {(tag) => (
              <button
                type="button"
                class={`btn-segment gap-1.5 ${props.selectedTagIds.includes(tag.id) ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : ""}`}
                onClick={() => toggleTag(tag.id)}
              >
                <span class="h-2 w-2 rounded-full" style={{ "background-color": tag.color }} />
                {tag.name}
              </button>
            )}
          </For>
        </div>
      </Show>
      <CoreCalendar
        class="flex-1"
        view={props.view}
        date={props.date}
        events={events()}
        startHour={8}
        endHour={20}
        withWeekNumbers
        dayBadges={dayBadges()}
        dateConfig={props.dateConfig}
        getViewHref={(view) =>
          buildCalendarHref(props.baseUrl, view as CalendarView, props.date, props.selectedTagIds, undefined, props.dateConfig)
        }
        getDateHref={(date, view) =>
          buildCalendarHref(props.baseUrl, view as CalendarView, date, props.selectedTagIds, undefined, props.dateConfig)
        }
        getEventHref={(event) => event.href}
        selectedEventId={props.selectedItemId}
        onViewChange={(view: CoreCalendarView) => routeTo(view as CalendarView, props.date)}
        onDateChange={(date, view) => routeTo(view as CalendarView, date)}
        onEventClick={selectEvent}
        onEventDrop={(event, next) => updateEventTime.mutate({ event, next })}
        onEventResize={(event, next) => updateEventTime.mutate({ event, next })}
        onEventDoubleClick={(event) => editEvent.mutate(event)}
        onSlotDoubleClick={(slot) => createEvent.mutate(slot)}
      />
    </div>
  );
}
