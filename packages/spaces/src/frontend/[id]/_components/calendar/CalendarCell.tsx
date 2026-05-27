import type { JSX } from "solid-js";
import { dates as calendar } from "@valentinkolb/stdlib";
import type { CalendarCellProps } from "./types";
import { requestSpacesRouteNavigation } from "../workspace/workspace-events";

type Props = CalendarCellProps & {
  children: JSX.Element;
};

/**
 * Calendar cell - SSR component.
 * Minimal styling, mobile link overlay for day navigation.
 */
export default function CalendarCell(props: Props) {
  const weekUrl = calendar.buildCalendarUrl(props.baseUrl, {
    view: "week",
    date: props.date,
  });

  const ariaLabel = `${props.date.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}, ${props.items.length} ${props.items.length === 1 ? "Event" : "Events"}`;

  return (
    <div
      class={`relative h-full flex flex-col overflow-hidden transition-colors ${
        props.isToday
          ? "bg-blue-50/50 dark:bg-blue-900/20"
          : props.isCurrentMonth
            ? "hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
            : "bg-zinc-100/50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/30"
      }`}
      role="gridcell"
      aria-label={ariaLabel}
      tabindex={0}
    >
      {/* Mobile: Full cell link overlay - goes to week view */}
      <a
        href={weekUrl}
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          requestSpacesRouteNavigation(weekUrl);
        }}
        class="md:hidden absolute inset-0 z-10"
        aria-label={`View ${ariaLabel}`}
      >
        <span class="sr-only">View {ariaLabel}</span>
      </a>
      {/* Content */}
      {props.children}
    </div>
  );
}
