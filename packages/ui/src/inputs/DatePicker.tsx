import { type DateContext, dates } from "@k2b/stdlib";
import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { createFieldMeta, Field, fieldDescribedBy } from "../internal/field";
import {
  type DateRangeValue,
  dateKey,
  displayDate,
  filterTimeInput,
  formatDateOnlyRangeDuration,
  formatDateTimeValue,
  inRange,
  isCompleteTime,
  isRangeEdge,
  monthDate,
  normalizeTimeInput,
  orderedRange,
  parseDateValue,
  pickerContext,
  previewRange,
  splitDateTime,
  toDateTimeValue,
  yearMonth,
} from "./date-picker";

export type { DateRangeValue } from "./date-picker";

export type DatePreset<T> = {
  label: string;
  value: T;
};

export type DurationPreset = {
  label: string;
  minutes: number;
};

type BasePickerProps<T> = {
  id?: string;
  class?: string;
  label?: JSX.Element;
  description?: JSX.Element;
  error?: JSX.Element;
  placeholder?: string;
  value: T;
  onValueChange?: (value: T) => void;
  presets?: readonly DatePreset<T>[];
  dateConfig?: DateContext;
  clearable?: boolean;
  disabled?: boolean;
  required?: boolean;
};

export type DatePickerProps = BasePickerProps<string | null>;
export type DateTimePickerProps = BasePickerProps<string | null>;
export type DateRangePickerProps = BasePickerProps<DateRangeValue> & {
  withTime?: boolean;
  datePresets?: readonly DatePreset<string | null>[];
  durationPresets?: readonly DurationPreset[];
};

type PanelView = "days" | "months";

const popoverIsOpen = (popover: HTMLElement | undefined): boolean => {
  if (!popover) return false;
  try {
    return popover.matches(":popover-open");
  } catch {
    return false;
  }
};

export const placeDatePopover = (trigger: HTMLElement, popover: HTMLElement, wide: boolean): void => {
  const margin = 8;
  const gap = 4;
  const rect = trigger.getBoundingClientRect();
  const preferredWidth = wide ? 440 : 336;
  const width = Math.min(Math.max(rect.width, preferredWidth), window.innerWidth - margin * 2);
  popover.style.width = `${width}px`;

  const popoverRect = popover.getBoundingClientRect();
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  const roomBelow = window.innerHeight - rect.bottom - gap - margin;
  const roomAbove = rect.top - gap - margin;
  const opensAbove = popoverRect.height > roomBelow && roomAbove > roomBelow;
  const top = opensAbove
    ? Math.max(margin, rect.top - popoverRect.height - gap)
    : Math.min(rect.bottom + gap, window.innerHeight - popoverRect.height - margin);

  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(margin, top)}px`;
};

function PickerShell<T>(props: {
  owner: BasePickerProps<T>;
  icon: string;
  valueLabel: () => string;
  valueContent?: () => JSX.Element;
  children: (close: () => void) => JSX.Element;
  clearValue: T;
  onOpen?: () => void;
  footerMeta?: () => JSX.Element;
  wide?: boolean;
  timezone?: string;
}): JSX.Element {
  const meta = createFieldMeta(props.owner.id);
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let popover: HTMLDivElement | undefined;

  const place = () => {
    if (trigger && popover && open()) placeDatePopover(trigger, popover, props.wide ?? false);
  };

  const close = () => {
    if (popoverIsOpen(popover)) popover?.hidePopover();
    setOpen(false);
  };

  const show = () => {
    if (props.owner.disabled || !popover || popoverIsOpen(popover)) return;
    props.onOpen?.();
    popover.showPopover();
    setOpen(true);
    queueMicrotask(() => {
      place();
      const initial =
        popover?.querySelector<HTMLElement>('[data-date-focus="true"]') ??
        popover?.querySelector<HTMLElement>('[data-date-day]:not([data-outside="true"])');
      initial?.focus();
    });
  };

  const toggle = () => (open() ? close() : show());

  onMount(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    onCleanup(() => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    });
  });
  onCleanup(close);

  return (
    <Field
      class={props.owner.class}
      label={props.owner.label}
      description={props.owner.description}
      error={props.owner.error}
      required={props.owner.required}
      meta={meta}
    >
      <div class="k2b-date-picker" data-invalid={props.owner.error ? "true" : undefined}>
        <button
          ref={trigger}
          id={meta.controlId}
          type="button"
          class="k2b-date-trigger"
          data-placeholder={props.valueLabel() ? undefined : "true"}
          data-open={open() ? "true" : undefined}
          disabled={props.owner.disabled}
          aria-haspopup="dialog"
          aria-expanded={open()}
          aria-controls={`${meta.controlId}-popover`}
          aria-describedby={fieldDescribedBy(meta, props.owner.description, props.owner.error)}
          aria-invalid={props.owner.error ? "true" : undefined}
          onClick={toggle}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              show();
            }
          }}
        >
          <i class={`${props.icon} k2b-date-trigger__icon`} aria-hidden="true" />
          <span class="k2b-date-trigger__value">
            <Show when={props.valueLabel()} fallback={props.owner.placeholder ?? "Pick date"}>
              {props.valueContent?.() ?? props.valueLabel()}
            </Show>
          </span>
          <i class="ti ti-chevron-down k2b-date-trigger__chevron" aria-hidden="true" />
        </button>

        <Show when={props.owner.clearable && props.valueLabel() && !props.owner.disabled}>
          <button
            type="button"
            class="k2b-date-trigger__clear"
            aria-label="Clear date"
            onClick={(event) => {
              event.stopPropagation();
              props.owner.onValueChange?.(props.clearValue);
              trigger?.focus();
            }}
          >
            <i class="ti ti-x" aria-hidden="true" />
          </button>
        </Show>

        <div
          ref={popover}
          id={`${meta.controlId}-popover`}
          class="k2b-date-popover"
          popover="auto"
          role="dialog"
          aria-label={typeof props.owner.label === "string" ? props.owner.label : "Date picker"}
          onToggle={(event) => {
            const nextOpen = event.newState === "open";
            setOpen(nextOpen);
            if (nextOpen) queueMicrotask(place);
          }}
        >
          {props.children(close)}
          <Show when={props.footerMeta || props.timezone}>
            <footer class="k2b-date-popover__footer">
              <span>{props.footerMeta?.()}</span>
              <Show when={props.timezone}>
                <span class="k2b-date-popover__timezone">
                  <i class="ti ti-world" aria-hidden="true" />
                  {props.timezone}
                </span>
              </Show>
            </footer>
          </Show>
        </div>
      </div>
    </Field>
  );
}

function PresetRail<T>(props: { presets?: readonly DatePreset<T>[]; onSelect: (value: T) => void }): JSX.Element {
  return (
    <Show when={props.presets?.length}>
      <aside class="k2b-date-presets" aria-label="Date presets">
        <For each={props.presets}>
          {(preset) => (
            <button type="button" onClick={() => props.onSelect(preset.value)}>
              {preset.label}
            </button>
          )}
        </For>
      </aside>
    </Show>
  );
}

function DatePickerPanel(props: {
  visibleMonth: () => Date;
  setVisibleMonth: (date: Date) => void;
  selected?: () => string | null | undefined;
  range?: () => DateRangeValue;
  focusDate?: () => string | null | undefined;
  onSelect: (date: string) => void;
  onDayPreview?: (date: string | null) => void;
  dateConfig?: DateContext;
}): JSX.Element {
  const [view, setView] = createSignal<PanelView>("days");
  const context = () => pickerContext(props.dateConfig);
  const month = () => yearMonth(props.visibleMonth(), context());
  const weeks = () => dates.getMonthGrid(month().year, month().month, context());
  const weekdays = () => dates.weekdays(context());
  const monthNames = () => dates.months(context());
  const defaultFocus = () => props.focusDate?.() || props.selected?.() || dateKey(dates.today(context()), context());

  const moveMonth = (delta: number) => props.setVisibleMonth(dates.addMonths(props.visibleMonth(), delta, context()));
  const moveYear = (delta: number) => props.setVisibleMonth(monthDate(month().year + delta, month().month, context()));
  const previousLabel = () => (view() === "days" ? "Previous month" : "Previous year");
  const nextLabel = () => (view() === "days" ? "Next month" : "Next year");

  const focusDate = (source: HTMLButtonElement, date: Date) => {
    const targetKey = dateKey(date, context());
    if (!dates.isSameMonth(date, props.visibleMonth(), context())) props.setVisibleMonth(date);
    queueMicrotask(() => source.closest(".k2b-date-calendar")?.querySelector<HTMLElement>(`[data-date-day="${targetKey}"]`)?.focus());
  };

  const handleDayKeyDown = (event: KeyboardEvent, day: Date) => {
    const deltas: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const delta = deltas[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      focusDate(event.currentTarget as HTMLButtonElement, dates.addDays(day, delta, context()));
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      focusDate(event.currentTarget as HTMLButtonElement, dates.addMonths(day, event.key === "PageUp" ? -1 : 1, context()));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const buttons = Array.from(
        (event.currentTarget as HTMLButtonElement).closest(".k2b-date-grid")!.querySelectorAll<HTMLButtonElement>("[data-date-day]"),
      );
      const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
      const offset = event.key === "Home" ? -(index % 7) : 6 - (index % 7);
      focusDate(event.currentTarget as HTMLButtonElement, dates.addDays(day, offset, context()));
    }
  };

  return (
    <section class="k2b-date-calendar" aria-label="Calendar">
      <header class="k2b-date-calendar__header">
        <button
          type="button"
          class="k2b-date-calendar__nav"
          onClick={() => (view() === "days" ? moveMonth(-1) : moveYear(-1))}
          aria-label={previousLabel()}
        >
          <i class="ti ti-chevron-left" aria-hidden="true" />
        </button>
        <button type="button" class="k2b-date-calendar__title" onClick={() => setView(view() === "days" ? "months" : "days")}>
          <Show when={view() === "days"} fallback={month().year}>
            {dates.formatMonthYear(props.visibleMonth(), context())}
          </Show>
        </button>
        <button
          type="button"
          class="k2b-date-calendar__nav"
          onClick={() => (view() === "days" ? moveMonth(1) : moveYear(1))}
          aria-label={nextLabel()}
        >
          <i class="ti ti-chevron-right" aria-hidden="true" />
        </button>
      </header>

      <Show
        when={view() === "days"}
        fallback={
          <div class="k2b-date-months" role="grid" aria-label={`Months in ${month().year}`}>
            <For each={monthNames()}>
              {(name, index) => (
                <button
                  type="button"
                  role="gridcell"
                  data-selected={index() === month().month ? "true" : undefined}
                  onClick={() => {
                    props.setVisibleMonth(monthDate(month().year, index(), context()));
                    setView("days");
                  }}
                >
                  {name}
                </button>
              )}
            </For>
          </div>
        }
      >
        <div class="k2b-date-weekdays" aria-hidden="true">
          <For each={weekdays()}>{(day) => <span>{day}</span>}</For>
        </div>
        <div class="k2b-date-grid" role="grid">
          <For each={weeks().flat()}>
            {(day) => {
              const key = () => dateKey(day, context());
              const selected = () => props.selected?.() === key();
              const range = () => props.range?.() ?? { start: null, end: null };
              const active = () => selected() || isRangeEdge(key(), range());
              const outside = () => !dates.isSameMonth(day, props.visibleMonth(), context());
              const focusable = () => key() === defaultFocus();
              return (
                <button
                  type="button"
                  role="gridcell"
                  data-date-day={key()}
                  data-date-focus={focusable() ? "true" : undefined}
                  data-outside={outside() ? "true" : undefined}
                  data-in-range={inRange(key(), range()) && !active() ? "true" : undefined}
                  aria-selected={active()}
                  tabIndex={focusable() ? 0 : -1}
                  onClick={() => props.onSelect(key())}
                  onKeyDown={(event) => handleDayKeyDown(event, day)}
                  onBlur={() => props.onDayPreview?.(null)}
                  onFocus={() => props.onDayPreview?.(key())}
                  onPointerEnter={() => props.onDayPreview?.(key())}
                  onPointerLeave={() => props.onDayPreview?.(null)}
                >
                  {dates.formatDayNumber(day, context())}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}

function TimeInput(props: { time: string; onChange: (time: string) => void; label?: string }): JSX.Element {
  return (
    <label class="k2b-date-time">
      <Show when={props.label}>
        <span>{props.label}</span>
      </Show>
      <span class="k2b-date-time__control">
        <input
          type="text"
          inputMode="numeric"
          value={props.time}
          placeholder="09:00"
          onInput={(event) => props.onChange(filterTimeInput(event.currentTarget.value))}
          onBlur={() => props.onChange(normalizeTimeInput(props.time))}
          aria-label={props.label ? `${props.label} time` : "Time"}
        />
        <i class="ti ti-clock" aria-hidden="true" />
      </span>
    </label>
  );
}

export function DatePicker(props: DatePickerProps): JSX.Element {
  const [visibleMonth, setVisibleMonth] = createSignal(parseDateValue(props.value, props.dateConfig));
  const valueLabel = () => displayDate(props.value, props.dateConfig);

  return (
    <PickerShell
      owner={props}
      icon="ti ti-calendar"
      valueLabel={valueLabel}
      clearValue={null}
      onOpen={() => setVisibleMonth(parseDateValue(props.value, props.dateConfig))}
      wide={Boolean(props.presets?.length)}
    >
      {(close) => (
        <div class="k2b-date-popover__body">
          <PresetRail
            presets={props.presets}
            onSelect={(value) => {
              props.onValueChange?.(value);
              close();
            }}
          />
          <DatePickerPanel
            visibleMonth={visibleMonth}
            setVisibleMonth={setVisibleMonth}
            selected={() => props.value}
            focusDate={() => props.value}
            onSelect={(value) => {
              props.onValueChange?.(value);
              close();
            }}
            dateConfig={props.dateConfig}
          />
        </div>
      )}
    </PickerShell>
  );
}

export function DateTimePicker(props: DateTimePickerProps): JSX.Element {
  const parts = () => splitDateTime(props.value, props.dateConfig);
  const [visibleMonth, setVisibleMonth] = createSignal(parseDateValue(parts().date, props.dateConfig));
  const [draftDate, setDraftDate] = createSignal(parts().date);
  const [draftTime, setDraftTime] = createSignal(parts().time || "09:00");
  const valueLabel = () => formatDateTimeValue(props.value, props.dateConfig);

  const syncDraft = () => {
    const next = parts();
    setDraftDate(next.date);
    setDraftTime(next.time || "09:00");
    setVisibleMonth(parseDateValue(next.date, props.dateConfig));
  };

  return (
    <PickerShell
      owner={props}
      icon="ti ti-calendar-time"
      valueLabel={valueLabel}
      clearValue={null}
      timezone={props.dateConfig?.timeZone}
      onOpen={syncDraft}
      wide={Boolean(props.presets?.length)}
    >
      {(close) => (
        <>
          <div class="k2b-date-popover__body">
            <PresetRail
              presets={props.presets}
              onSelect={(value) => {
                props.onValueChange?.(value);
                close();
              }}
            />
            <DatePickerPanel
              visibleMonth={visibleMonth}
              setVisibleMonth={setVisibleMonth}
              selected={draftDate}
              focusDate={draftDate}
              onSelect={(value) => {
                setDraftDate(value);
                setVisibleMonth(parseDateValue(value, props.dateConfig));
              }}
              dateConfig={props.dateConfig}
            />
          </div>
          <div class="k2b-date-actions">
            <TimeInput time={draftTime()} onChange={setDraftTime} />
            <button
              type="button"
              class="k2b-date-apply"
              disabled={!draftDate() || !isCompleteTime(draftTime())}
              onClick={() => {
                props.onValueChange?.(toDateTimeValue(draftDate(), draftTime(), props.dateConfig));
                close();
              }}
            >
              Apply
            </button>
          </div>
        </>
      )}
    </PickerShell>
  );
}

export function DateRangePicker(props: DateRangePickerProps): JSX.Element {
  const withTime = () => props.withTime ?? false;
  const parts = () => ({
    start: withTime() ? splitDateTime(props.value.start, props.dateConfig) : { date: props.value.start ?? "", time: "09:00" },
    end: withTime() ? splitDateTime(props.value.end, props.dateConfig) : { date: props.value.end ?? "", time: "10:00" },
  });
  const [visibleMonth, setVisibleMonth] = createSignal(parseDateValue(parts().start.date || parts().end.date, props.dateConfig));
  const [draftRange, setDraftRange] = createSignal<DateRangeValue>({
    start: parts().start.date || null,
    end: parts().end.date || null,
  });
  const [previewDate, setPreviewDate] = createSignal<string | null>(null);
  const [startTime, setStartTime] = createSignal(parts().start.time || "09:00");
  const [endTime, setEndTime] = createSignal(parts().end.time || "10:00");
  const displayRange = createMemo(() => previewRange(draftRange(), previewDate()));

  const syncDraft = () => {
    const next = parts();
    setDraftRange({ start: next.start.date || null, end: next.end.date || null });
    setPreviewDate(null);
    setStartTime(next.start.time || "09:00");
    setEndTime(next.end.time || "10:00");
    setVisibleMonth(parseDateValue(next.start.date || next.end.date, props.dateConfig));
  };

  const valueLabel = () => {
    if (!props.value.start && !props.value.end) return "";
    const format = withTime() ? formatDateTimeValue : displayDate;
    return `${props.value.start ? format(props.value.start, props.dateConfig) : "Start"} to ${
      props.value.end ? format(props.value.end, props.dateConfig) : "End"
    }`;
  };

  const valueContent = () => {
    const format = withTime() ? formatDateTimeValue : displayDate;
    return (
      <span class="k2b-date-range-value">
        <span>{props.value.start ? format(props.value.start, props.dateConfig) : "Start"}</span>
        <i class="ti ti-arrow-narrow-right" aria-hidden="true" />
        <span>{props.value.end ? format(props.value.end, props.dateConfig) : "End"}</span>
      </span>
    );
  };

  const selectDate = (value: string) => {
    const current = draftRange();
    if (!current.start || current.end) {
      setDraftRange({ start: value, end: null });
    } else {
      setDraftRange(orderedRange(current.start, value));
    }
    setPreviewDate(null);
  };

  const applyDuration = (minutes: number) => {
    const current = draftRange();
    if (!current.start || !isCompleteTime(startTime())) return;
    const start = toDateTimeValue(current.start, startTime(), props.dateConfig);
    if (!start) return;
    const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
    const next = splitDateTime(end, props.dateConfig);
    setDraftRange({ start: current.start, end: next.date || current.end || current.start });
    setEndTime(next.time || endTime());
  };

  const durationMinutes = createMemo(() => {
    const current = displayRange();
    if (!current.start || !current.end || !isCompleteTime(startTime()) || !isCompleteTime(endTime())) return null;
    const start = toDateTimeValue(current.start, startTime(), props.dateConfig);
    const end = toDateTimeValue(current.end, endTime(), props.dateConfig);
    if (!start || !end) return null;
    return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  });

  const durationLabel = () => {
    const current = displayRange();
    if (!current.start || !current.end) return "";
    if (!withTime()) return formatDateOnlyRangeDuration(current, props.dateConfig);
    if (!isCompleteTime(startTime()) || !isCompleteTime(endTime())) return "";
    const start = toDateTimeValue(current.start, startTime(), props.dateConfig);
    const end = toDateTimeValue(current.end, endTime(), props.dateConfig);
    return start && end ? dates.formatDuration(start, end) : "";
  };

  const commit = (close: () => void) => {
    const current = draftRange();
    if (!withTime()) {
      props.onValueChange?.(current);
      close();
      return;
    }
    props.onValueChange?.({
      start: current.start ? toDateTimeValue(current.start, startTime(), props.dateConfig) : null,
      end: current.end ? toDateTimeValue(current.end, endTime(), props.dateConfig) : null,
    });
    close();
  };

  return (
    <PickerShell
      owner={props}
      icon="ti ti-calendar-stats"
      valueLabel={valueLabel}
      valueContent={valueContent}
      clearValue={{ start: null, end: null }}
      timezone={withTime() ? props.dateConfig?.timeZone : undefined}
      footerMeta={() => (
        <Show when={durationLabel()}>
          <span class="k2b-date-duration">
            <i class="ti ti-hourglass-low" aria-hidden="true" />
            {durationLabel()}
          </span>
        </Show>
      )}
      onOpen={syncDraft}
      wide={Boolean(props.datePresets?.length || props.presets?.length)}
    >
      {(close) => (
        <>
          <div class="k2b-date-popover__body">
            <Show
              when={props.datePresets?.length}
              fallback={
                <PresetRail
                  presets={props.presets}
                  onSelect={(value) => {
                    props.onValueChange?.(value);
                    close();
                  }}
                />
              }
            >
              <PresetRail
                presets={props.datePresets}
                onSelect={(value) => {
                  setDraftRange(value ? { start: value, end: value } : { start: null, end: null });
                  if (value) setVisibleMonth(parseDateValue(value, props.dateConfig));
                }}
              />
            </Show>
            <DatePickerPanel
              visibleMonth={visibleMonth}
              setVisibleMonth={setVisibleMonth}
              range={displayRange}
              focusDate={() => draftRange().start}
              onSelect={selectDate}
              onDayPreview={(value) => {
                const current = draftRange();
                setPreviewDate(current.start && !current.end ? value : null);
              }}
              dateConfig={props.dateConfig}
            />
          </div>

          <Show when={withTime()}>
            <div class="k2b-date-range-times">
              <TimeInput label="Start" time={startTime()} onChange={setStartTime} />
              <TimeInput label="End" time={endTime()} onChange={setEndTime} />
            </div>
            <Show when={props.durationPresets?.length}>
              <div class="k2b-date-durations" role="group" aria-label="Duration presets">
                <For each={props.durationPresets}>
                  {(preset) => (
                    <button type="button" aria-pressed={durationMinutes() === preset.minutes} onClick={() => applyDuration(preset.minutes)}>
                      {preset.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <div class="k2b-date-actions">
            <button type="button" class="k2b-date-apply" disabled={!draftRange().start || !draftRange().end} onClick={() => commit(close)}>
              Apply
            </button>
          </div>
        </>
      )}
    </PickerShell>
  );
}
