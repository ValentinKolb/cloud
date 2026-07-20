import { CheckboxCard, DatePicker, DateRangePicker, Select, Switch, TextInput } from "@valentinkolb/cloud/ui";
import { createMemo, For, Show } from "solid-js";
import { validateResponseScheduleDefinition } from "../../response-schedule-validation";
import type { ResponseScheduleDefinition } from "../../service/response-schedule";

const WEEKDAYS = [
  { id: 1, label: "Monday" },
  { id: 2, label: "Tuesday" },
  { id: 3, label: "Wednesday" },
  { id: 4, label: "Thursday" },
  { id: 5, label: "Friday" },
  { id: 6, label: "Saturday" },
  { id: 7, label: "Sunday" },
] as const;

const timeZones = (() => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

const today = (): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

type Window = { start: string; end: string };
type Weekday = (typeof WEEKDAYS)[number]["id"];
const DEFAULT_WINDOW: Window = { start: "09:00", end: "17:00" };
const FULL_DAY_WINDOW: Window = { start: "00:00", end: "24:00" };

const isFullDayWindow = (windows: readonly Window[]): boolean =>
  windows.length === 1 && windows[0]?.start === FULL_DAY_WINDOW.start && windows[0]?.end === FULL_DAY_WINDOW.end;

function WindowEditor(props: { windows: () => Window[]; onChange: (windows: Window[]) => void; addLabel: string; compact?: boolean }) {
  const update = (index: number, field: keyof Window, value: string) =>
    props.onChange(props.windows().map((window, position) => (position === index ? { ...window, [field]: value } : window)));
  return (
    <div class="flex flex-col gap-2">
      <For each={props.windows()}>
        {(window, index) => (
          <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-end gap-2">
            <TextInput
              label={!props.compact && index() === 0 ? "From" : undefined}
              ariaLabel={`Window ${index() + 1} start`}
              value={() => window.start}
              onInput={(value) => update(index(), "start", value)}
              placeholder="09:00"
              icon="ti ti-clock"
              maxLength={5}
              monospace
            />
            <TextInput
              label={!props.compact && index() === 0 ? "Until" : undefined}
              ariaLabel={`Window ${index() + 1} end`}
              value={() => window.end}
              onInput={(value) => update(index(), "end", value)}
              placeholder="17:00"
              icon="ti ti-clock"
              maxLength={5}
              monospace
            />
            <button
              type="button"
              class={`icon-btn ${props.compact ? "" : "mb-0.5"}`}
              aria-label={`Remove window ${index() + 1}`}
              onClick={() => props.onChange(props.windows().filter((_, position) => position !== index()))}
            >
              <i class="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}
      </For>
      <button
        type="button"
        class="btn-simple btn-sm self-start"
        onClick={() => props.onChange([...props.windows(), { ...DEFAULT_WINDOW }])}
      >
        <i class="ti ti-plus" aria-hidden="true" /> {props.addLabel}
      </button>
    </div>
  );
}

export default function MailResponseScheduleFields(props: {
  value: () => ResponseScheduleDefinition;
  onChange: (value: ResponseScheduleDefinition) => void;
  errors?: () => string[];
}) {
  const previousDayWindows = new Map<Weekday, Window[]>();
  const errors = createMemo(() => props.errors?.() ?? validateResponseScheduleDefinition(props.value()));
  const update = <K extends keyof ResponseScheduleDefinition>(key: K, value: ResponseScheduleDefinition[K]) =>
    props.onChange({ ...props.value(), [key]: value });
  const windowsForDay = (weekday: (typeof WEEKDAYS)[number]["id"]) =>
    props.value().weeklyWindows.filter((window) => window.weekday === weekday);
  const setDayWindows = (weekday: (typeof WEEKDAYS)[number]["id"], windows: Window[]) =>
    update("weeklyWindows", [
      ...props.value().weeklyWindows.filter((window) => window.weekday !== weekday),
      ...windows.map((window) => ({ ...window, weekday })),
    ]);
  const setDayEnabled = (weekday: Weekday, enabled: boolean) => {
    const windows = windowsForDay(weekday).map(({ start, end }) => ({ start, end }));
    if (!enabled) {
      if (windows.length === 0) return;
      previousDayWindows.set(weekday, windows);
      setDayWindows(weekday, []);
      return;
    }
    if (windows.length > 0) return;
    setDayWindows(
      weekday,
      (previousDayWindows.get(weekday) ?? [{ ...DEFAULT_WINDOW }]).map((window) => ({ ...window })),
    );
  };
  const setAllDay = (weekday: Weekday, allDay: boolean) => {
    const windows = windowsForDay(weekday).map(({ start, end }) => ({ start, end }));
    if (allDay) {
      if (!isFullDayWindow(windows)) previousDayWindows.set(weekday, windows);
      setDayWindows(weekday, [{ ...FULL_DAY_WINDOW }]);
      return;
    }
    setDayWindows(
      weekday,
      (previousDayWindows.get(weekday) ?? [{ ...DEFAULT_WINDOW }]).map((window) => ({ ...window })),
    );
  };

  return (
    <div class="flex flex-col gap-2">
      <Show when={errors().length > 0}>
        <div class="flex gap-2 rounded-[var(--ui-radius-control)] border border-[var(--ui-border)] px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <i class="ti ti-alert-circle mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <For each={errors()}>{(error) => <p>{error}</p>}</For>
          </div>
        </div>
      </Show>
      <Select
        label="Time zone"
        description="All dates and times below are evaluated in this time zone."
        icon="ti ti-world"
        value={() => props.value().timeZone}
        selectedLabel={() => props.value().timeZone}
        fetchDebounceMs={0}
        fetchData={async (query) => {
          const normalized = query.trim().toLowerCase();
          return timeZones
            .filter((zone) => !normalized || zone.toLowerCase().includes(normalized))
            .slice(0, 100)
            .map((zone) => ({ id: zone, label: zone }));
        }}
        onChange={(timeZone) => update("timeZone", timeZone)}
      />

      <div>
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-primary">Active date ranges</p>
            <p class="text-xs text-dimmed">Optional. Without a range, the weekly hours repeat indefinitely.</p>
          </div>
          <button
            type="button"
            class="btn-simple btn-sm shrink-0"
            onClick={() => update("activeRanges", [...props.value().activeRanges, { from: today(), to: null }])}
          >
            <i class="ti ti-plus" aria-hidden="true" /> Add range
          </button>
        </div>
        <Show when={props.value().activeRanges.length > 0} fallback={<p class="text-xs text-dimmed">No date limit.</p>}>
          <div class="flex flex-col gap-2">
            <For each={props.value().activeRanges}>
              {(range, index) => (
                <div class="grid grid-cols-[minmax(0,1fr)_2rem] items-end gap-2">
                  <DateRangePicker
                    label={index() === 0 ? "Range" : undefined}
                    value={() => ({ start: range.from, end: range.to })}
                    onChange={(value) =>
                      update(
                        "activeRanges",
                        props
                          .value()
                          .activeRanges.map((item, position) =>
                            position === index() ? { from: value.start ?? item.from, to: value.end } : item,
                          ),
                      )
                    }
                  />
                  <button
                    type="button"
                    class="icon-btn mb-0.5"
                    aria-label={`Remove date range ${index() + 1}`}
                    onClick={() =>
                      update(
                        "activeRanges",
                        props.value().activeRanges.filter((_, position) => position !== index()),
                      )
                    }
                  >
                    <i class="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div>
        <div class="mb-2">
          <div>
            <p class="text-sm font-medium text-primary">Weekly hours</p>
            <p class="text-xs text-dimmed">Set each day independently. Unchecked days are disabled.</p>
          </div>
        </div>
        <div class="flex flex-col gap-2">
          <For each={WEEKDAYS}>
            {(day) => {
              const windows = () => windowsForDay(day.id);
              const active = () => windows().length > 0;
              const allDay = () => isFullDayWindow(windows());
              const dayDescription = () => {
                if (!active()) return "Disabled";
                if (allDay()) return "All day";
                return `${windows().length} ${windows().length === 1 ? "window" : "windows"}`;
              };
              return (
                <div class="grid gap-2 md:grid-cols-[12rem_7rem_minmax(0,1fr)] md:items-start">
                  <CheckboxCard
                    label={day.label}
                    description={dayDescription()}
                    icon={active() ? "ti ti-calendar-check" : "ti ti-calendar-off"}
                    variant="input"
                    value={active}
                    onChange={(enabled) => setDayEnabled(day.id, enabled)}
                  />
                  <Show when={active()}>
                    <div class="flex min-h-12 items-center md:justify-center">
                      <Switch label="All day" value={allDay} onChange={(value) => setAllDay(day.id, value)} />
                    </div>
                    <div class="min-w-0">
                      <Show
                        when={!allDay()}
                        fallback={<div class="flex min-h-12 items-center font-mono text-xs text-dimmed">00:00–24:00</div>}
                      >
                        <WindowEditor
                          windows={windows}
                          onChange={(next) => setDayWindows(day.id, next)}
                          addLabel="Add another window"
                          compact
                        />
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      <div>
        <div class="mb-2 flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-primary">Date exceptions</p>
            <p class="text-xs text-dimmed">Disable replies on a specific date or replace its normal hours.</p>
          </div>
          <button
            type="button"
            class="btn-simple btn-sm shrink-0"
            onClick={() => update("exceptions", [...props.value().exceptions, { date: today(), closed: true, windows: [] }])}
          >
            <i class="ti ti-plus" aria-hidden="true" /> Add exception
          </button>
        </div>
        <Show when={props.value().exceptions.length > 0} fallback={<p class="text-xs text-dimmed">No exceptions.</p>}>
          <div class="flex flex-col gap-2">
            <For each={props.value().exceptions}>
              {(exception, index) => {
                const replace = (next: typeof exception) =>
                  update(
                    "exceptions",
                    props.value().exceptions.map((item, position) => (position === index() ? next : item)),
                  );
                return (
                  <div class="flex flex-col gap-2 py-3">
                    <div class="grid grid-cols-[minmax(0,1fr)_auto_2rem] items-end gap-2">
                      <DatePicker label="Date" value={() => exception.date} onChange={(date) => date && replace({ ...exception, date })} />
                      <div class="mb-0.5 flex h-10 items-center">
                        <Switch
                          label="Disabled"
                          value={() => exception.closed}
                          onChange={(closed) =>
                            replace({
                              ...exception,
                              closed,
                              windows: closed ? [] : exception.windows.length > 0 ? exception.windows : [{ start: "09:00", end: "17:00" }],
                            })
                          }
                        />
                      </div>
                      <button
                        type="button"
                        class="icon-btn mb-0.5"
                        aria-label={`Remove exception ${index() + 1}`}
                        onClick={() =>
                          update(
                            "exceptions",
                            props.value().exceptions.filter((_, position) => position !== index()),
                          )
                        }
                      >
                        <i class="ti ti-trash" aria-hidden="true" />
                      </button>
                    </div>
                    <Show when={!exception.closed}>
                      <WindowEditor
                        windows={() => exception.windows}
                        onChange={(windows) => replace({ ...exception, windows })}
                        addLabel="Add hours"
                      />
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

export const responseScheduleSummary = (definition: ResponseScheduleDefinition): string => {
  const activeDays = new Set(definition.weeklyWindows.map((window) => window.weekday)).size;
  const range = definition.activeRanges[0];
  const rangeLabel = range ? `${range.from} to ${range.to ?? "open ended"}` : "No date limit";
  return `${rangeLabel} · ${activeDays} active ${activeDays === 1 ? "day" : "days"} · ${definition.timeZone}`;
};
