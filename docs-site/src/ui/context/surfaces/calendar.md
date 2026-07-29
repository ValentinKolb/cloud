# Calendar

`Calendar` renders portable day, week, month, year, and compact mobile-month
views. The application owns the selected date and view, canonical URLs, event
data, permissions, and editor flows.

## Use Calendar

Use it for schedules that need timezone-aware placement, all-day and timed
events, or direct manipulation. Keep date and view state in the URL when the
calendar is a primary application surface.

## Import

```tsx
import {
  Calendar,
  type CalendarAttendee,
  type CalendarDayBadge,
  type CalendarEvent,
  type CalendarEventColor,
  type CalendarEventRenderContext,
  type CalendarEventTimeChange,
  type CalendarLabels,
  type CalendarProps,
  type CalendarRecurrence,
  type CalendarResource,
  type CalendarView,
} from "@k2b/ui";
```

## Events

Every `CalendarEvent` has an `id`, `title`, and `start`. `end` and `allDay`
control placement. `color` accepts the shared semantic palette; `colorHex`
supports an application-defined calendar color.

Optional event detail includes `meta`, `description`, `location`,
`calendarName`, attendees, resources, and recurrence metadata. `display:
"background"` renders a non-interactive time range. `href` or
`getEventHref` makes an event a canonical link.

`renderEvent` receives the normalized `CalendarEventRenderContext`, including
the effective start, end, duration, time label, and compact or fill state.
Custom output must retain useful visible event text.

## Views and navigation

`view` accepts:

- `day` for one timed column;
- `week` for seven timed columns;
- `month` for the standard month grid;
- `year` for a compact twelve-month overview;
- `mobile-month` for a bounded month picker with the selected day's agenda.

Limit the switcher with `views`. `getDateHref`, `getViewHref`, and
`getEventHref` keep navigation functional in the server response.
`onNavigate` progressively enhances those links after hydration.

Use `onDateChange`, `onViewChange`, and `onEventClick` only when client state
is appropriate. `navigationPending` exposes loading state without replacing
the canonical links.

## Date and layout policy

`dateConfig` passes the `@k2b/stdlib` date context. `timeZone` and
`firstDayOfWeek` are convenience overrides. `withWeekNumbers` adds week
labels.

Day and week views accept `startHour`, `endHour`, `visibleStartHour`, and
`visibleEndHour`. `hideAllDay` and `allDayMaxHeightRem` control the all-day
lane. `selectedDate`, `selectedEventId`, and `dayBadges` add host-owned
selection and compact status context.

## Interaction

The following callbacks enable matching hydrated interactions:

- `onEventDrop` moves an event;
- `onEventResize` changes a timed event duration;
- `onEventDoubleClick` opens an event-specific action;
- `onSlotClick` and `onSlotDoubleClick` select empty time.

The callbacks receive `CalendarEventTimeChange` values. The host validates
permissions and persists changes; the component never writes schedule data.

`toolbarActions` and `toolbarContent` add bounded application controls without
replacing the calendar navigation.

## Accessibility

Canonical links remain available before hydration. Date cells, navigation,
events, and interaction handles have text or accessible labels. Color is
supplementary to event title, time, and metadata.

## Runtime

All views, labels, dates, and links render on the server. Drag, resize,
pointer-slot selection, prefetch, and callback navigation require hydration.

## Example

```tsx
const events: CalendarEvent[] = [
  {
    id: "review",
    title: "Design review",
    start: "2026-07-15T09:00:00Z",
    end: "2026-07-15T10:00:00Z",
    color: "emerald",
    location: "Studio",
  },
  {
    id: "release",
    title: "Release",
    start: "2026-07-18T00:00:00Z",
    allDay: true,
    color: "blue",
  },
];

<Calendar
  date="2026-07-15T12:00:00Z"
  events={events}
  view="month"
  views={["day", "week", "month", "year"]}
  timeZone="UTC"
  withWeekNumbers
  getDateHref={(date, view) =>
    `?view=${view}&date=${date.toISOString()}`
  }
  getViewHref={(view) => `?view=${view}`}
/>;
```
