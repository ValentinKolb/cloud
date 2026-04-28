import { dates as calendar } from "@valentinkolb/stdlib";
import dayjs from "dayjs";
import { SelectChip, SegmentedControl } from "@valentinkolb/cloud/ui";
import type { CalendarHeaderProps, CalendarView } from "./types";
import { navigateTo } from "@valentinkolb/cloud/ui";

export default function CalendarHeader(props: CalendarHeaderProps) {
  const currentYear = () => dayjs(props.date).year();
  const currentMonth = () => dayjs(props.date).month();

  // Navigation handlers
  const goToToday = () => {
    navigateTo(calendar.buildCalendarUrl(props.baseUrl, {
      view: props.view,
      date: calendar.today(),
    }));
  };

  const goToPrev = () => {
    const newDate = props.view === "month" ? calendar.addMonths(props.date, -1) : calendar.addWeeks(props.date, -1);
    navigateTo(calendar.buildCalendarUrl(props.baseUrl, {
      view: props.view,
      date: newDate,
    }));
  };

  const goToNext = () => {
    const newDate = props.view === "month" ? calendar.addMonths(props.date, 1) : calendar.addWeeks(props.date, 1);
    navigateTo(calendar.buildCalendarUrl(props.baseUrl, {
      view: props.view,
      date: newDate,
    }));
  };

  const changeView = (view: CalendarView) => {
    navigateTo(calendar.buildCalendarUrl(props.baseUrl, {
      view,
      date: props.date,
    }));
  };

  const changeMonth = (month: number) => {
    const newDate = dayjs(props.date).month(month).toDate();
    navigateTo(calendar.buildCalendarUrl(props.baseUrl, {
      view: props.view,
      date: newDate,
    }));
  };

  const changeYear = (year: number) => {
    const newDate = dayjs(props.date).year(year).toDate();
    navigateTo(calendar.buildCalendarUrl(props.baseUrl, {
      view: props.view,
      date: newDate,
    }));
  };

  // Options for SelectChip
  const monthOptions = () => calendar.months().map((label: string, i: number) => ({ value: i, label }));

  const yearOptions = () => calendar.getYearOptions().map((year) => ({ value: year, label: String(year) }));

  const viewOptions = [
    { value: "week" as const, label: "Week" },
    { value: "month" as const, label: "Month" },
  ];

  return (
    <div class="flex items-center justify-between gap-2">
      {/* Left: Chevrons, Month/Year, Today */}
      <div class="flex items-center gap-2">
        {/* Navigation arrows */}
        <div class="flex items-center">
          <button
            type="button"
            onClick={goToPrev}
            class="p-1 text-dimmed hover:text-primary transition-colors"
            aria-label={props.view === "month" ? "Previous month" : "Previous week"}
          >
            <i class="ti ti-chevron-left" />
          </button>
          <button
            type="button"
            onClick={goToNext}
            class="p-1 text-dimmed hover:text-primary transition-colors"
            aria-label={props.view === "month" ? "Next month" : "Next week"}
          >
            <i class="ti ti-chevron-right" />
          </button>
        </div>

        {/* Month/Year selectors */}
        <SelectChip value={currentMonth()} options={monthOptions()} onChange={changeMonth} />
        <SelectChip value={currentYear()} options={yearOptions()} onChange={changeYear} />
      </div>

      {/* Right: Today button + View Toggle */}
      <div class="flex items-center gap-2">
        <button type="button" onClick={goToToday} class="text-xs text-dimmed hover:text-blue-500 transition-colors">
          Today
        </button>
        <SegmentedControl options={viewOptions} value={() => props.view} onChange={changeView} />
      </div>
    </div>
  );
}
