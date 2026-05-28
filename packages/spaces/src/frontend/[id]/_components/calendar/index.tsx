import {
  type CalendarEvent,
  Calendar as CoreCalendar,
  type CalendarEventTimeChange,
  type CalendarView as CoreCalendarView,
  dialogCore,
  panelDialogOptions,
  prompts,
  toast,
} from "@valentinkolb/cloud/ui";
import { dates as calendar } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { CalendarItem } from "@/contracts";
import { requestCurrentSpacesRouteRefresh, requestSpacesRouteNavigation } from "../workspace/workspace-events";
import CalendarDetailNavigation from "./CalendarDetailNavigation";
import ItemForm, { type ItemFormData } from "../shared/ItemForm";
import { editItemWithDialog, handleEditItemSuccess } from "../shared/editItem";
import type { CalendarProps, CalendarView } from "./types";

const eventStart = (item: CalendarItem) => item.startsAt ?? item.deadline ?? calendar.today().toISOString();
const eventEnd = (item: CalendarItem) => item.endsAt ?? item.deadline ?? eventStart(item);

const CALENDAR_TAGS_PARAM = "ctags";

const buildCalendarHref = (baseUrl: string, view: CalendarView, date: Date, tagIds: string[], item?: string) => {
  const url = new URL(baseUrl, "http://spaces.local");
  url.searchParams.set("view", "calendar");
  url.searchParams.set("cv", view);
  url.searchParams.set("cd", calendar.formatDateKey(date));
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

const toCalendarEvent = (item: CalendarItem, baseUrl: string, view: CalendarView, date: Date, tagIds: string[]): CalendarEvent => {
  const isDeadline = Boolean(item.deadline && !item.startsAt);
  return {
    id: item.id,
    title: item.title,
    start: eventStart(item),
    end: eventEnd(item),
    allDay: item.allDay || !item.startsAt,
    color: priorityColor(item),
    colorHex: isDeadline ? undefined : item.spaceColor,
    href: buildCalendarHref(baseUrl, view, date, tagIds, item.id),
    dataSpaceItemId: item.id,
    calendarName: item.spaceName,
    meta: isDeadline ? "Deadline" : item.spaceName,
  };
};

export default function Calendar(props: CalendarProps) {
  const rootId = `space-calendar-${props.spaceId}`;
  const events = () => props.items.map((item) => toCalendarEvent(item, props.baseUrl, props.view, props.date, props.selectedTagIds));
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
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, view, date, props.selectedTagIds), { replace, scroll: "preserve" });
  };
  const toggleTag = (tagId: string) => {
    const selected = props.selectedTagIds.includes(tagId)
      ? props.selectedTagIds.filter((id) => id !== tagId)
      : [...props.selectedTagIds, tagId];
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, props.view, props.date, selected), { replace: true, scroll: "preserve" });
  };
  const clearTags = () => {
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, props.view, props.date, []), { replace: true, scroll: "preserve" });
  };
  const selectEvent = (event: CalendarEvent) => {
    const itemId = event.dataSpaceItemId ?? event.id;
    requestSpacesRouteNavigation(buildCalendarHref(props.baseUrl, props.view, props.date, props.selectedTagIds, itemId), {
      scroll: "preserve",
    });
  };
  const updateEventTime = mutations.create<void, { event: CalendarEvent; next: CalendarEventTimeChange }>({
    mutation: async ({ event, next }) => {
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
  });
  const createEvent = mutations.create<boolean, CalendarEventTimeChange>({
    mutation: async (slot) => {
      const result = await dialogCore.open<ItemFormData | null>(
        (close) => (
          <ItemForm
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
          />
        ),
        panelDialogOptions,
      );
      if (!result) return false;
      const res = await apiClient[":id"].items.$post({
        param: { id: props.spaceId },
        json: { ...result, priority: result.priority ?? undefined },
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
      const itemId = event.dataSpaceItemId ?? event.id;
      const itemRes = await apiClient[":id"].items[":itemId"].$get({ param: { id: props.spaceId, itemId } });
      if (!itemRes.ok) throw new Error("Could not load event");
      return editItemWithDialog({ spaceId: props.spaceId, item: await itemRes.json(), columns: props.columns, tags: props.tags });
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
        getViewHref={(view) => buildCalendarHref(props.baseUrl, view as CalendarView, props.date, props.selectedTagIds)}
        getDateHref={(date, view) => buildCalendarHref(props.baseUrl, view as CalendarView, date, props.selectedTagIds)}
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
