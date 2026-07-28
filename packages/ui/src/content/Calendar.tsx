import { type DateContext, dates } from "@k2b/stdlib";
import { For, type JSX, Show } from "solid-js";

export type CalendarView = "month" | "week";
export type CalendarItem = {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  deadline: string | null;
  href?: string;
  tone?: "neutral" | "blue" | "green" | "amber" | "red" | "violet" | (string & {});
};
export type CalendarProps<T extends CalendarItem = CalendarItem> = {
  date: Date;
  view?: CalendarView;
  items: readonly T[];
  dateContext?: DateContext;
  views?: readonly CalendarView[];
  onDateChange?: (date: Date) => void;
  onViewChange?: (view: CalendarView) => void;
  hrefForDate?: (date: Date) => string;
  hrefForView?: (view: CalendarView) => string;
  onDaySelect?: (date: Date) => void;
  onItemSelect?: (item: T) => void;
  renderItem?: (item: T, date: Date) => JSX.Element;
  maxItemsPerDay?: number;
  toolbar?: JSX.Element;
  empty?: JSX.Element;
  class?: string;
};

export function Calendar<T extends CalendarItem = CalendarItem>(props: CalendarProps<T>): JSX.Element {
  const view = () => props.view ?? "month";
  const days = () =>
    view() === "week"
      ? dates.getWeekDays(props.date, props.dateContext)
      : dates.getMonthGrid(props.date.getFullYear(), props.date.getMonth(), props.dateContext).flat();
  const label = () =>
    view() === "week"
      ? `${dates.formatFullDate(days()[0]!, props.dateContext)} – ${dates.formatFullDate(days().at(-1)!, props.dateContext)}`
      : dates.formatMonthYear(props.date, props.dateContext);
  const navigate = (amount: number) =>
    props.onDateChange?.(view() === "week" ? dates.addWeeks(props.date, amount, props.dateContext) : dates.addMonths(props.date, amount, props.dateContext));
  const dayItems = (day: Date) =>
    props.items.filter(
      (item) =>
        dates.itemOnDate(item, day, props.dateContext) ||
        (!!item.startsAt && !item.endsAt && dates.isSameDay(new Date(item.startsAt), day, props.dateContext)),
    );
  const limit = () => Math.max(1, props.maxItemsPerDay ?? (view() === "week" ? 8 : 4));
  const itemContent = (item: T, day: Date) => (
    <>
      <Show when={item.startsAt}><time>{dates.formatTime(item.startsAt!, props.dateContext)}</time></Show>
      <span>{props.renderItem?.(item, day) ?? item.title}</span>
    </>
  );
  return (
    <section class={`k2b-calendar ${props.class ?? ""}`} data-view={view()} aria-label={label()}>
      <header class="k2b-calendar__toolbar">
        <div class="k2b-calendar__navigation">
          <button type="button" aria-label={`Previous ${view()}`} onClick={() => navigate(-1)}><i class="ti ti-chevron-left" /></button>
          <button type="button" onClick={() => props.onDateChange?.(dates.today(props.dateContext))}>Today</button>
          <button type="button" aria-label={`Next ${view()}`} onClick={() => navigate(1)}><i class="ti ti-chevron-right" /></button>
        </div>
        <h2>{label()}</h2>
        <div class="k2b-calendar__views">
          <For each={props.views ?? (["month", "week"] as const)}>{(candidate) => (
            <Show
              when={props.hrefForView}
              fallback={<button type="button" aria-pressed={view() === candidate} onClick={() => props.onViewChange?.(candidate)}>{candidate}</button>}
            >
              {(href) => <a href={href()(candidate)} aria-current={view() === candidate ? "page" : undefined}>{candidate}</a>}
            </Show>
          )}</For>
          <Show when={props.toolbar}>{props.toolbar}</Show>
        </div>
      </header>
      <div class="k2b-calendar__weekdays" aria-hidden="true">
        <For each={view() === "week" ? days().map((day) => dates.formatWeekdayShort(day, props.dateContext)) : dates.weekdays(props.dateContext)}>
          {(weekday) => <span>{weekday}</span>}
        </For>
      </div>
      <div class="k2b-calendar__grid">
        <For each={days()}>
          {(day) => {
            const entries = () => dayItems(day);
            const number = <span class="k2b-calendar__day-number" title={dates.formatFullDate(day, props.dateContext)}>{dates.formatDayNumber(day, props.dateContext)}</span>;
            return (
              <section
                class="k2b-calendar__day"
                data-outside={view() === "month" && !dates.isSameMonth(day, props.date, props.dateContext) ? "true" : undefined}
                data-today={dates.isToday(day, props.dateContext) ? "true" : undefined}
                aria-label={dates.formatFullDate(day, props.dateContext)}
              >
                <Show
                  when={props.hrefForDate}
                  fallback={<button type="button" class="k2b-calendar__day-trigger" onClick={() => props.onDaySelect?.(day)}>{number}</button>}
                >
                  {(href) => <a class="k2b-calendar__day-trigger" href={href()(day)}>{number}</a>}
                </Show>
                <div class="k2b-calendar__items">
                  <For each={entries().slice(0, limit())}>{(item) => (
                    <Show
                      when={item.href}
                      fallback={<button type="button" data-tone={item.tone} onClick={() => props.onItemSelect?.(item)}>{itemContent(item, day)}</button>}
                    >
                      {(href) => <a href={href()} data-tone={item.tone}>{itemContent(item, day)}</a>}
                    </Show>
                  )}</For>
                  <Show when={entries().length > limit()}><span class="k2b-calendar__more">+{entries().length - limit()} more</span></Show>
                  <Show when={entries().length === 0 && props.empty}><div class="k2b-calendar__empty">{props.empty}</div></Show>
                </div>
              </section>
            );
          }}
        </For>
      </div>
    </section>
  );
}
