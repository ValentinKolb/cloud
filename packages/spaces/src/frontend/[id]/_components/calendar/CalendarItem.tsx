import { dates as calendar } from "@valentinkolb/stdlib";
import type { CalendarItemDisplayProps } from "./types";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

const shouldRouteClientSide = (event: MouseEvent) =>
  !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** Renders a calendar item in different variants */
export default function CalendarItem(props: CalendarItemDisplayProps) {
  const isEvent = Boolean(props.item.startsAt && props.item.endsAt);
  const isDeadline = Boolean(props.item.deadline && !props.item.startsAt);

  // Build item URL with calendar params preserved
  const itemUrl = calendar.buildCalendarUrl(props.baseUrl, {
    view: props.currentView,
    date: props.currentDate,
    item: props.item.id,
  });

  // Priority icon helper
  const priorityIcon = (() => {
    switch (props.item.priority) {
      case "urgent":
        return "ti-alert-circle text-red-500";
      case "high":
        return "ti-arrow-up text-orange-500";
      case "medium":
        return "ti-minus text-yellow-500";
      case "low":
        return "ti-arrow-down text-blue-500";
      default:
        return null;
    }
  })();

  // Dot variant - colored circle for events, orange for deadlines
  if (props.variant === "dot") {
    return (
      <span
        class={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isDeadline ? "bg-orange-500" : ""}`}
        style={isDeadline ? undefined : `background-color: ${props.item.spaceColor}`}
        title={props.item.title}
      />
    );
  }

  // Compact variant - minimal, black/white with subtle indicator
  if (props.variant === "compact") {
    return (
      <a
        href={itemUrl}
        data-space-item-id={props.item.id}
        onClick={(event) => {
          if (!shouldRouteClientSide(event)) return;
          event.preventDefault();
          requestSpacesRouteNavigation(itemUrl);
        }}
        class="relative z-20 group flex items-center gap-1 px-1 py-0.5 text-[11px] truncate hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors"
        title={props.item.title}
      >
        {/* Type indicator */}
        {isDeadline && priorityIcon && <i class={`ti ${priorityIcon} text-[10px] shrink-0`} />}
        {isDeadline && !priorityIcon && <i class="ti ti-checkbox text-dimmed text-[10px] shrink-0" />}
        {isEvent && <span class="w-1.5 h-1.5 rounded-full shrink-0" style={`background-color: ${props.item.spaceColor}`} />}

        {/* Title */}
        <span class="truncate text-primary">{props.item.title}</span>

        {/* Time for events */}
        {isEvent && props.item.startsAt && (
          <span class="text-dimmed text-[10px] shrink-0 hidden group-hover:inline">{calendar.formatTime(props.item.startsAt)}</span>
        )}
      </a>
    );
  }

  // Full variant - for week view, more details
  return (
    <a
      href={itemUrl}
      data-space-item-id={props.item.id}
      onClick={(event) => {
        if (!shouldRouteClientSide(event)) return;
        event.preventDefault();
        requestSpacesRouteNavigation(itemUrl);
      }}
      class="relative z-20 block p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border-l-2"
      style={`border-color: ${isDeadline ? "#f97316" : props.item.spaceColor}`}
    >
      {/* Title */}
      <p class="text-xs font-medium truncate text-primary">{props.item.title}</p>

      {/* Time/Deadline info with priority icon */}
      <div class="flex items-center gap-1 text-[10px] text-dimmed">
        {priorityIcon && <i class={`ti ${priorityIcon} text-[10px]`} />}
        {isEvent && props.item.startsAt && props.item.endsAt && (
          <span>
            {calendar.formatTime(props.item.startsAt)} – {calendar.formatTime(props.item.endsAt)}
          </span>
        )}
        {isDeadline && props.item.deadline && (
          <span class="text-orange-600 dark:text-orange-400">Deadline {calendar.formatTime(props.item.deadline)}</span>
        )}
      </div>
    </a>
  );
}
