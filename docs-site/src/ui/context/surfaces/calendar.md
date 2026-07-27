# Calendar

`Calendar` renders controlled day, week, month, year, and mobile-month schedule views from one event array. The application owns the selected view and date, canonical URLs, event persistence, and editor flows.

## Use Calendar

Use it for schedules where events need consistent all-day, timed, overlapping, month, and year representations.

Keep the view and date in the URL when the calendar is a primary application surface. Use the interaction callbacks to update application state, then persist changes through the application's mutation layer.

## Import

```tsx
import {
  Calendar,
  type CalendarEvent,
  type CalendarEventTimeChange,
  type CalendarView,
} from "@valentinkolb/cloud/ui";
```

## Properties

### View and date

| Property | Type | Default | Purpose |
| --- | --- | --- | --- |
| `date` | `Date \| string` | required | Anchors the visible day, week, month, or year. |
| `view` | `CalendarView` | `"month"` | Selects `day`, `week`, `month`, `year`, or `mobile-month`. |
| `views` | `CalendarView[]` | component defaults | Limits the view selector. |
| `selectedDate` | `Date \| string` | `date` | Selects the agenda day in `mobile-month`. |
| `labels` | `CalendarLabels` | English defaults | Overrides toolbar and empty-state labels. |
| `dateConfig` | `DateContext` | none | Supplies locale, timezone, and calendar math configuration. |
| `timeZone` | `string` | `dateConfig.timeZone` | Overrides the rendering timezone. |
| `firstDayOfWeek` | `0 \| 1` | configured value or Monday | Starts weeks on Sunday or Monday. |
| `withWeekNumbers` | `boolean` | `false` | Adds week numbers to month and schedule views. |

### Events

Every event requires `id`, `title`, and `start`. `end` defaults to one hour after the start.

```ts
type CalendarEvent = {
  id: string;
  title: string;
  start: Date | string;
  end?: Date | string;
  allDay?: boolean;
  color?: "blue" | "emerald" | "amber" | "red" | "violet" | "cyan" | "zinc";
  colorHex?: string;
  href?: string;
  display?: "event" | "background";
  meta?: string;
  description?: string;
  location?: string;
  calendarName?: string;
  attendees?: CalendarAttendee[];
  resources?: CalendarResource[];
  recurrence?: CalendarRecurrence;
};
```

`getEventHref` can derive a destination when it is not stored on the event. `renderEvent` replaces the event body while Calendar retains the surrounding event semantics and layout.

The event type can also carry attendees, resources, recurrence metadata, and a calendar name for custom rendering and application callbacks. The default renderer does not expand recurrence rules. Pass the occurrences that the current view must display.

### Schedule layout

| Property | Purpose |
| --- | --- |
| `startHour`, `endHour` | Mark the working-hours range; defaults are 8 and 18. |
| `visibleStartHour`, `visibleEndHour` | Bound the visible time grid; defaults are 0 and 23. |
| `hideAllDay` | Removes the all-day row. |
| `allDayMaxHeightRem` | Caps the independently scrollable all-day row; default is 7rem. |
| `dayBadges` | Adds `{ icon?, label }` metadata by date key. |
| `selectedEventId` | Applies the selected treatment to one event. |
| `toolbarActions`, `toolbarContent` | Insert application-owned controls or content around the built-in toolbar. |

## Navigation

Use `getViewHref` and `getDateHref` to produce canonical links. Calendar uses those links in SSR output.

`onNavigate` can progressively enhance navigation after the application has loaded the target state. `onNavigateHref` is the non-view-transition alternative. `onPrefetch` can preload a canonical target. Set `navigationPending` while navigation is in progress.

`onViewChange` and `onDateChange` report controlled state changes. They do not persist the URL or data.

## Event interactions

| Callback | Purpose |
| --- | --- |
| `onEventClick` | Selects or opens an event. |
| `onEventDoubleClick` | Opens an event editor. |
| `onSlotClick`, `onSlotDoubleClick` | Select or create from a time slot. |
| `onEventDrop` | Reports a moved event with its next start, end, and all-day state. |
| `onEventResize` | Reports a resized event with its next time range. |

Drag, resize, and slot callbacks report intent only. Update the controlled event array and persist the change in application code.

## Accessibility

Supply real links for views, dates, and events whenever navigation exists. Event controls include the event title and time range in their accessible label. The view selector uses a keyboard-navigable radio group.

Keep event titles useful without color. Use `labels` when the surrounding product language is not English. Do not put essential information only in a hover surface.

## Runtime

Calendar renders its initial view and canonical links on the server. Hydration enables controlled view changes, the live current-time marker, event selection, drag, resize, and slot interactions.

## Example

```tsx
const [view, setView] = createSignal<CalendarView>("week");
const [date, setDate] = createSignal(new Date(2026, 4, 27));
const [events, setEvents] = createSignal<CalendarEvent[]>(initialEvents);

const updateTime = (
  event: CalendarEvent,
  next: CalendarEventTimeChange,
) => {
  setEvents((current) =>
    current.map((item) =>
      item.id === event.id ? { ...item, ...next } : item
    )
  );
};

<Calendar
  view={view()}
  date={date()}
  events={events()}
  startHour={8}
  endHour={18}
  getViewHref={(nextView) => buildCalendarUrl({ view: nextView, date: date() })}
  getDateHref={(nextDate, currentView) => buildCalendarUrl({ view: currentView, date: nextDate })}
  onViewChange={setView}
  onDateChange={setDate}
  onEventDrop={updateTime}
  onEventResize={updateTime}
/>;
```
