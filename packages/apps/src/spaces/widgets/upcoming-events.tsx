import type { Context } from "hono";
import type { SessionUser, CalendarItem } from "@/spaces/contracts";
import { spacesService } from "../service";
import { parseWidgetSettings } from "@/spaces/frontend/[id]/_components/settings/SpaceSettingsStore";
import type { Widget } from "@valentinkolb/cloud/contracts/app";

// =============================================================================
// Helpers
// =============================================================================

/** Format time for display */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format date for display */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return "Heute";
  if (date.toDateString() === tomorrow.toDateString()) return "Morgen";

  return date.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Check if event is happening now */
function isNow(startsAt: string, endsAt: string): boolean {
  const now = new Date();
  return new Date(startsAt) <= now && new Date(endsAt) >= now;
}

/** Check if event is all-day (spans full days) */
function isAllDay(startsAt: string, endsAt: string): boolean {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 0 && end.getMinutes() === 0;
}

/** Format days ahead for display */
function formatDaysAhead(days: number): string {
  if (days === 1) return "Today";
  if (days === 3) return "3 days";
  if (days === 7) return "1 week";
  if (days === 14) return "2 weeks";
  return `${days} days`;
}

// =============================================================================
// Components
// =============================================================================

function EventItem({ event }: { event: CalendarItem }) {
  const allDay = event.startsAt && event.endsAt && isAllDay(event.startsAt, event.endsAt);
  const happeningNow = event.startsAt && event.endsAt && isNow(event.startsAt, event.endsAt);

  return (
    <a
      href={`/app/spaces/${event.spaceId}?item=${event.id}`}
      class="flex items-start gap-2 p-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors group"
    >
      {/* Color indicator */}
      <div class="w-1 h-full min-h-8 rounded-full shrink-0" style={`background-color: ${event.spaceColor}`} />

      {/* Content */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          {happeningNow && <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" title="Happening now" />}
          <span class="text-sm font-medium text-primary truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {event.title}
          </span>
        </div>
        <div class="flex items-center gap-2 text-xs text-dimmed mt-0.5">
          {event.startsAt && (
            <span class="shrink-0 whitespace-nowrap">
              {formatDate(event.startsAt)}
              {!allDay && `, ${formatTime(event.startsAt)}`}
              {allDay && " (ganztägig)"}
            </span>
          )}
          <span class="text-zinc-300 dark:text-zinc-600 shrink-0">·</span>
          <span class="truncate">{event.spaceName}</span>
        </div>
      </div>
    </a>
  );
}

function EventsContent({ events }: { events: CalendarItem[] }) {
  if (events.length === 0) {
    return (
      <div class="flex-1 flex items-center justify-center text-dimmed text-xs gap-2">
        <i class="ti ti-calendar-off text-sm" />
        <span>No upcoming events</span>
      </div>
    );
  }

  return (
    <div class="flex-1 overflow-y-auto -mx-2">
      <div class="flex flex-col gap-0.5">
        {events.slice(0, 10).map((event) => (
          <EventItem event={event} />
        ))}
      </div>
      {events.length > 10 && <div class="text-xs text-dimmed text-center py-2">+{events.length - 10} more events</div>}
    </div>
  );
}

// =============================================================================
// Widget Factory
// =============================================================================

/**
 * Create upcoming events widget.
 * Shows events for the configured time range.
 * Settings are configured in Space Settings sidebar.
 */
export async function createUpcomingEventsWidget(c: Context, user?: SessionUser): Promise<Widget> {
  if (!user) return null;

  // Parse widget settings from cookie
  const cookieHeader = c.req.header("Cookie");
  const widgetSettings = parseWidgetSettings(cookieHeader);
  const daysAhead = widgetSettings.eventsDaysAhead;

  // Calculate date range
  const now = new Date();
  const from = now.toISOString();
  const to = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  // Fetch events from all spaces the user has access to
  const events = await spacesService.item.calendar.list({
    userId: user.id,
    groups: user.memberofGroup,
    from,
    to,
  });

  // Filter to only events (has startsAt and endsAt)
  const upcomingEvents = events.filter((e) => e.startsAt && e.endsAt);

  return {
    id: "upcoming-events",
    title: "Upcoming Events",
    icon: "calendar-event",
    content: (
      <div class="flex flex-col gap-2 flex-1 min-h-0">
        <div class="flex items-center justify-between -mt-1">
          <span class="text-xs text-dimmed">{formatDaysAhead(daysAhead)}</span>
        </div>
        <EventsContent events={upcomingEvents} />
      </div>
    ),
  };
}
