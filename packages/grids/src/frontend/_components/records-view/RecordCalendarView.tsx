import { Calendar, type CalendarEvent, Placeholder } from "@valentinkolb/cloud/ui";
import { dates as calendar, type DateContext } from "@valentinkolb/stdlib";
import { createMemo, Show } from "solid-js";
import type { RecordDisplayConfig } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import { displayRecordTitle, type GridsCalendarView } from "./display-mode";

export function RecordCalendarView(props: {
  items: GridRecord[];
  fields: Field[];
  displayConfig: RecordDisplayConfig;
  calendarState: { view: GridsCalendarView; date: string };
  onCalendarChange: (next: { view: GridsCalendarView; date: string }) => void;
  selectedRecordId?: string | null;
  onRecordClick: (record: GridRecord) => void;
  dateConfig?: DateContext;
}) {
  const dateField = () => {
    const fieldId = props.displayConfig.calendar?.dateFieldId;
    return fieldId ? props.fields.find((field) => field.id === fieldId && field.type === "date" && !field.deletedAt) : undefined;
  };
  const includeTime = () => Boolean((dateField()?.config as { includeTime?: boolean } | undefined)?.includeTime);
  const events = createMemo<CalendarEvent[]>(() => {
    const field = dateField();
    if (!field) return [];
    return props.items.flatMap((record) => {
      const raw = record.data[field.id];
      if (typeof raw !== "string" || !raw.trim()) return [];
      return [
        {
          id: record.id,
          title: displayRecordTitle(record, props.fields),
          start: raw,
          allDay: !includeTime(),
          color: "blue",
          meta: field.name,
        } satisfies CalendarEvent,
      ];
    });
  });
  const selectedDate = () => calendar.parseCalendarDate(props.calendarState.date, props.dateConfig);
  const commit = (next: { view?: string; date?: Date | string }) => {
    const view = (next.view ?? props.calendarState.view) as GridsCalendarView;
    const date = next.date ? calendar.formatDateKey(next.date, props.dateConfig) : props.calendarState.date;
    props.onCalendarChange({ view, date });
  };

  return (
    <div class="paper min-h-0 flex-1 overflow-hidden">
      <Show
        when={dateField()}
        fallback={
          <Placeholder icon="ti ti-calendar" class="min-h-48 justify-center">
            Choose a date field in settings.
          </Placeholder>
        }
      >
        <Calendar
          class="h-full"
          date={selectedDate()}
          view={props.calendarState.view}
          views={["day", "week", "month", "year"]}
          events={events()}
          selectedEventId={props.selectedRecordId ?? undefined}
          dateConfig={props.dateConfig}
          onViewChange={(view) => commit({ view })}
          onDateChange={(date, view) => commit({ date, view })}
          onEventClick={(event) => {
            const record = props.items.find((item) => item.id === event.id);
            if (record) props.onRecordClick(record);
          }}
        />
      </Show>
    </div>
  );
}
