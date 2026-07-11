import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createMemo, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import Tooltip from "../misc/Tooltip";
import { createInputA11y, InputWrapper } from "./util";

export type DateRangeValue = {
  start: string | null;
  end: string | null;
};

export type DatePreset<T> = {
  label: string;
  value: T;
};

export type DurationPreset = {
  label: string;
  minutes: number;
};

type BasePickerProps<T> = {
  label?: string;
  description?: string | JSX.Element;
  placeholder?: string;
  value: () => T;
  onChange: (value: T) => void;
  presets?: DatePreset<T>[];
  dateConfig?: DateContext;
  clearable?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: () => string | undefined;
};

export type DatePickerProps = BasePickerProps<string | null>;
export type DateTimePickerProps = BasePickerProps<string | null>;
export type DateRangePickerProps = BasePickerProps<DateRangeValue> & {
  withTime?: boolean;
  datePresets?: DatePreset<string | null>[];
  durationPresets?: DurationPreset[];
};

type PanelView = "days" | "months";

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const hasInstantOffset = (value: string) => /[T\s].*([zZ]|[+-]\d{2}:?\d{2})$/.test(value);

const pickerContext = (context?: DateContext): DateContext => ({
  weekStartsOn: 1,
  ...context,
});

const dateKey = (date: Date | string, context?: DateContext): string => dates.formatDateKey(date, pickerContext(context));

const yearMonth = (date: Date, context?: DateContext): { year: number; month: number } => {
  const [year = "1970", month = "1"] = dateKey(date, context).split("-");
  return { year: Number(year), month: Number(month) - 1 };
};

const monthDate = (year: number, month: number, context?: DateContext): Date => {
  const value = `${year}-${String(month + 1).padStart(2, "0")}-01T12:00`;
  if (context?.timeZone) {
    return new Date(zonedDateTimeToInstant(value, context.timeZone));
  }
  return new Date(year, month, 1, 12);
};

const parseDateValue = (value: string | null | undefined, context?: DateContext): Date => {
  if (!value) return dates.today(pickerContext(context));
  return dates.parseCalendarDate(value.slice(0, 10), pickerContext(context));
};

const displayDate = (value: string | null | undefined, context?: DateContext): string => {
  if (!value) return "";
  return dates.formatDate(parseDateValue(value, context), pickerContext(context));
};

const localDateTimeInput = (value: string): string => {
  if (!hasInstantOffset(value)) return value.slice(0, 16);
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const instantToZonedInput = (value: string, timeZone: string): string => {
  if (typeof dates.instantToZonedInput === "function") return dates.instantToZonedInput(value, timeZone);
  return localDateTimeInput(value);
};

const zonedDateTimeToInstant = (value: string, timeZone: string): string => {
  if (typeof dates.zonedDateTimeToInstant === "function") {
    return dates.zonedDateTimeToInstant(value, timeZone, { disambiguation: "compatible" });
  }
  return value;
};

const dateTimeInput = (value: string | null | undefined, context?: DateContext): string => {
  if (!value) return "";
  if (context?.timeZone && hasInstantOffset(value)) return instantToZonedInput(value, context.timeZone);
  return localDateTimeInput(value);
};

const splitDateTime = (value: string | null | undefined, context?: DateContext): { date: string; time: string } => {
  const input = dateTimeInput(value, context);
  const [date = "", time = ""] = input.split("T");
  return { date, time: time.slice(0, 5) };
};

const toDateTimeValue = (date: string, time: string, context?: DateContext): string | null => {
  if (!date) return null;
  const local = `${date}T${time || "00:00"}`;
  if (context?.timeZone) return zonedDateTimeToInstant(local, context.timeZone);
  return local;
};

const isCompleteTime = (value: string): boolean => /^\d{2}:\d{2}$/.test(value);

const formatDateTimeValue = (value: string | null | undefined, context?: DateContext): string => {
  if (!value) return "";
  return dates.formatDateTime(value, pickerContext(context));
};

const compareDateKey = (a: string | null | undefined, b: string | null | undefined): number => (a ?? "").localeCompare(b ?? "");

const inRange = (day: string, range: DateRangeValue): boolean =>
  Boolean(range.start && range.end && day >= range.start && day <= range.end);

const isRangeEdge = (day: string, range: DateRangeValue): boolean => day === range.start || day === range.end;

const timezoneLabel = (context?: DateContext): string | undefined => context?.timeZone;

const formatDateOnlyRangeDuration = (range: DateRangeValue, context?: DateContext): string => {
  if (!range.start || !range.end) return "";
  const start = parseDateValue(range.start, context);
  const end = parseDateValue(range.end, context);
  const days = Math.floor(Math.abs(end.getTime() - start.getTime()) / 86_400_000) + 1;
  return `${days} ${days === 1 ? "day" : "days"}`;
};

function PickerShell<T>(props: {
  owner: BasePickerProps<T>;
  icon: string;
  activeIcon: string;
  valueLabel: () => string;
  valueContent?: () => JSX.Element;
  children: (close: () => void) => JSX.Element;
  clearValue: T;
  timezoneInfo?: boolean;
  footerMeta?: () => JSX.Element | string | undefined;
  onOpen?: () => void;
  wide?: boolean;
}) {
  const disabled = () => props.owner.disabled ?? false;
  const clearable = () => props.owner.clearable ?? false;
  const [isOpen, setIsOpen] = createSignal(false);
  const [isDarkTheme, setIsDarkTheme] = createSignal(false);
  const a11y = createInputA11y({ description: props.owner.description, error: props.owner.error });

  let triggerRef: HTMLDivElement | undefined;
  let dialogRef: HTMLDialogElement | undefined;

  const syncTheme = () => {
    if (typeof document === "undefined") return;
    setIsDarkTheme(document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  };

  const close = () => {
    setIsOpen(false);
    dialogRef?.close();
  };

  const toggle = (open: boolean) => {
    if (disabled()) return;
    if (!open) {
      close();
      return;
    }
    syncTheme();
    props.onOpen?.();
    setIsOpen(true);
    if (dialogRef && triggerRef) {
      const rect = triggerRef.getBoundingClientRect();
      const width = props.owner.presets?.length || props.wide ? 400 : props.timezoneInfo ? 380 : 320;
      const availableWidth = Math.max(280, window.innerWidth - 24);
      const panelWidth = Math.min(width, availableWidth);
      const estimatedHeight = props.owner.presets?.length || props.wide ? 380 : 340;
      const maxLeft = window.innerWidth - panelWidth - 12;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      dialogRef.style.left = `${Math.max(12, Math.min(rect.left, maxLeft))}px`;
      if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
        dialogRef.style.top = "auto";
        dialogRef.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 8)}px`;
      } else {
        dialogRef.style.bottom = "auto";
        dialogRef.style.top = `${rect.bottom + 8}px`;
      }
      dialogRef.style.right = "auto";
      dialogRef.style.margin = "0";
      dialogRef.style.minWidth = "0";
      dialogRef.style.boxSizing = "border-box";
      dialogRef.style.inlineSize = `${panelWidth}px`;
      dialogRef.style.maxInlineSize = "calc(100vw - 24px)";
      dialogRef.style.width = `${panelWidth}px`;
      dialogRef.style.maxWidth = "calc(100vw - 24px)";
      dialogRef.showModal();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
    }
    if ((event.key === "Enter" || event.key === " ") && !isOpen()) {
      event.preventDefault();
      toggle(true);
    }
  };

  onCleanup(() => dialogRef?.close());

  return (
    <InputWrapper
      label={props.owner.label}
      description={props.owner.description}
      error={props.owner.error?.()}
      required={props.owner.required}
      inputId={a11y.inputId}
      descriptionId={a11y.descriptionId}
      errorId={a11y.errorId}
    >
      <div class="relative">
        <div class="group relative flex-1">
          <div class="pointer-events-none absolute inset-y-0 left-2 z-10 flex items-center text-zinc-500">
            <i class={`${isOpen() ? props.activeIcon : props.icon} ${isOpen() ? "text-blue-500" : ""}`} />
          </div>
          <div
            ref={triggerRef}
            id={a11y.inputId}
            class={`input w-full pl-9 pr-8 ${disabled() ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            data-state={isOpen() ? "open" : "closed"}
            onClick={() => toggle(!isOpen())}
            onKeyDown={handleKeyDown}
            tabIndex={disabled() ? -1 : 0}
            role="combobox"
            aria-expanded={isOpen()}
            aria-haspopup="dialog"
            aria-label={!props.owner.label ? (props.owner.placeholder ?? "Pick date") : undefined}
            aria-describedby={a11y.ariaDescribedBy()}
            aria-invalid={!!props.owner.error?.()}
            aria-required={props.owner.required}
            aria-disabled={disabled()}
          >
            <Show
              when={props.valueLabel()}
              fallback={<span class="block truncate text-zinc-400 dark:text-zinc-500">{props.owner.placeholder ?? "Pick date"}</span>}
            >
              <span class="block truncate text-zinc-700 dark:text-zinc-300">{props.valueContent?.() ?? props.valueLabel()}</span>
            </Show>
          </div>

          <Show when={clearable() && props.valueLabel() && !disabled()}>
            <button
              type="button"
              class="absolute inset-y-0 right-2 flex items-center px-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={(event) => {
                event.stopPropagation();
                props.owner.onChange(props.clearValue);
                triggerRef?.focus();
              }}
              tabIndex={-1}
              aria-label="Clear date"
            >
              <i class="ti ti-x text-sm" />
            </button>
          </Show>
        </div>

        <dialog
          ref={dialogRef}
          class="popup overflow-hidden p-0 backdrop:bg-transparent"
          classList={{ dark: isDarkTheme() }}
          onClick={(event) => {
            if (event.target === dialogRef) close();
          }}
          onKeyDown={handleKeyDown}
          aria-label={props.owner.label ?? "Date picker"}
        >
          {props.children(close)}
          <Show when={props.footerMeta !== undefined || (props.timezoneInfo && timezoneLabel(props.owner.dateConfig))}>
            <div class="mx-2.5 mb-2 flex min-h-5 min-w-0 items-center justify-between gap-3 px-1 text-xs text-dimmed">
              <div class="min-w-0 truncate">{props.footerMeta?.()}</div>
              <Show when={props.timezoneInfo && timezoneLabel(props.owner.dateConfig)}>
                <div class="ml-auto inline-flex shrink-0 items-center gap-1">
                  <i class="ti ti-world" />
                  <span>{timezoneLabel(props.owner.dateConfig)}</span>
                </div>
              </Show>
            </div>
          </Show>
        </dialog>
      </div>
    </InputWrapper>
  );
}

function PresetRail<T>(props: { presets?: DatePreset<T>[]; onSelect: (value: T) => void }) {
  return (
    <Show when={props.presets?.length}>
      <div class="m-2 mr-0 flex w-28 shrink-0 self-stretch flex-col gap-1 overflow-y-auto rounded-md bg-zinc-50 p-1.5 dark:bg-zinc-900/70">
        <For each={props.presets}>
          {(preset) => (
            <button
              type="button"
              class="rounded px-2 py-1.5 text-left text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              onClick={() => props.onSelect(preset.value)}
            >
              {preset.label}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

function DatePickerPanel(props: {
  visibleMonth: () => Date;
  setVisibleMonth: (date: Date) => void;
  selected?: () => string | null | undefined;
  range?: () => DateRangeValue;
  onSelect: (date: string) => void;
  onDayPreview?: (date: string | null) => void;
  dateConfig?: DateContext;
}) {
  const [view, setView] = createSignal<PanelView>("days");
  const context = () => pickerContext(props.dateConfig);
  const month = () => yearMonth(props.visibleMonth(), context());
  const weeks = () => dates.getMonthGrid(month().year, month().month, context());
  const weekdays = () => dates.weekdays(context());

  const moveMonth = (delta: number) => props.setVisibleMonth(dates.addMonths(props.visibleMonth(), delta, context()));
  const moveYear = (delta: number) => props.setVisibleMonth(monthDate(month().year + delta, month().month, context()));
  const previousLabel = () => (view() === "days" ? "Previous month" : "Previous year");
  const nextLabel = () => (view() === "days" ? "Next month" : "Next year");

  return (
    <div class="min-w-0 flex-1 p-2">
      <div class="mx-auto w-full max-w-64">
        <div class="mb-2 flex items-center justify-between">
          <Tooltip content={previousLabel()}>
            <button
              type="button"
              class="icon-btn h-7 w-7"
              onClick={() => (view() === "days" ? moveMonth(-1) : moveYear(-1))}
              aria-label={previousLabel()}
            >
              <i class="ti ti-chevron-left" />
            </button>
          </Tooltip>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm font-semibold text-primary transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={() => setView(view() === "days" ? "months" : "days")}
          >
            <Show when={view() === "days"} fallback={month().year}>
              {dates.formatMonthYear(props.visibleMonth(), context())}
            </Show>
          </button>
          <Tooltip content={nextLabel()}>
            <button
              type="button"
              class="icon-btn h-7 w-7"
              onClick={() => (view() === "days" ? moveMonth(1) : moveYear(1))}
              aria-label={nextLabel()}
            >
              <i class="ti ti-chevron-right" />
            </button>
          </Tooltip>
        </div>

        <Show
          when={view() === "days"}
          fallback={
            <div class="grid grid-cols-3 gap-1">
              <For each={monthNames}>
                {(name, index) => {
                  const active = () => index() === month().month;
                  return (
                    <button
                      type="button"
                      class={`h-8 rounded-md px-2 text-sm transition-colors ${
                        active() ? "bg-blue-500 text-white" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                      onClick={() => {
                        props.setVisibleMonth(monthDate(month().year, index(), context()));
                        setView("days");
                      }}
                    >
                      {name}
                    </button>
                  );
                }}
              </For>
            </div>
          }
        >
          <div class="grid grid-cols-7 gap-1 text-center text-xs text-dimmed">
            <For each={weekdays()}>{(day) => <div class="py-0.5">{day}</div>}</For>
          </div>
          <div class="mt-1 grid grid-cols-7 gap-1">
            <For each={weeks().flat()}>
              {(day) => {
                const key = () => dateKey(day, context());
                const selected = () => props.selected?.() === key();
                const range = () => props.range?.() ?? { start: null, end: null };
                const active = () => selected() || isRangeEdge(key(), range());
                const muted = () => !dates.isSameMonth(day, props.visibleMonth(), context());
                return (
                  <button
                    type="button"
                    class={`h-8 rounded-md text-sm transition-colors ${
                      active()
                        ? "bg-blue-500 text-white"
                        : inRange(key(), range())
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200"
                          : muted()
                            ? "text-zinc-300 hover:bg-zinc-100 dark:text-zinc-700 dark:hover:bg-zinc-800"
                            : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => props.onSelect(key())}
                    onBlur={() => props.onDayPreview?.(null)}
                    onFocus={() => props.onDayPreview?.(key())}
                    onPointerEnter={() => props.onDayPreview?.(key())}
                    onPointerLeave={() => props.onDayPreview?.(null)}
                    aria-pressed={active()}
                  >
                    {dates.formatDayNumber(day, context())}
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

function TimeRow(props: { time: string; onChange: (time: string) => void; label?: string }) {
  const normalizeTime = (value: string): string => {
    const [hours = "", minutes = ""] = value.split(":");
    const h = Math.max(0, Math.min(23, Number(hours || 0)));
    const m = Math.max(0, Math.min(59, Number(minutes || 0)));
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const inputTime = (value: string): string => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  };

  return (
    <label class={`grid min-w-0 items-center gap-2 ${props.label ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1"}`}>
      <Show when={props.label}>
        <span class="min-w-0 text-[11px] text-dimmed">{props.label}</span>
      </Show>
      <div class="relative min-w-0 flex-1">
        <input
          type="text"
          inputMode="numeric"
          value={props.time}
          placeholder="09:00"
          class="input h-8 w-full min-w-0 pr-8 text-sm tabular-nums"
          onInput={(event) => props.onChange(inputTime(event.currentTarget.value))}
          onBlur={() => props.onChange(normalizeTime(props.time))}
          aria-label={props.label ? `${props.label} time` : "Time"}
        />
        <i class="ti ti-clock pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500" />
      </div>
    </label>
  );
}

export function DatePicker(props: DatePickerProps) {
  const [visibleMonth, setVisibleMonth] = createSignal(parseDateValue(props.value(), props.dateConfig));
  const valueLabel = () => displayDate(props.value(), props.dateConfig);

  return (
    <PickerShell
      owner={props}
      icon="ti ti-calendar"
      activeIcon="ti ti-calendar-event"
      valueLabel={valueLabel}
      clearValue={null}
      onOpen={() => setVisibleMonth(parseDateValue(props.value(), props.dateConfig))}
    >
      {(close) => (
        <div class="flex">
          <PresetRail
            presets={props.presets}
            onSelect={(value) => {
              props.onChange(value);
              if (value) setVisibleMonth(parseDateValue(value, props.dateConfig));
              close();
            }}
          />
          <DatePickerPanel
            visibleMonth={visibleMonth}
            setVisibleMonth={setVisibleMonth}
            selected={props.value}
            onSelect={(value) => {
              props.onChange(value);
              close();
            }}
            dateConfig={props.dateConfig}
          />
        </div>
      )}
    </PickerShell>
  );
}

export function DateTimePicker(props: DateTimePickerProps) {
  const current = () => splitDateTime(props.value(), props.dateConfig);
  const [visibleMonth, setVisibleMonth] = createSignal(parseDateValue(current().date, props.dateConfig));
  const [draftDate, setDraftDate] = createSignal(current().date);
  const [draftTime, setDraftTime] = createSignal(current().time || "09:00");
  const valueLabel = () => formatDateTimeValue(props.value(), props.dateConfig);

  const syncDraft = () => {
    const next = current();
    setDraftDate(next.date);
    setDraftTime(next.time || "09:00");
    if (next.date) setVisibleMonth(parseDateValue(next.date, props.dateConfig));
  };

  const apply = (close?: () => void) => {
    props.onChange(toDateTimeValue(draftDate(), draftTime(), props.dateConfig));
    close?.();
  };

  return (
    <PickerShell
      owner={props}
      icon="ti ti-calendar-time"
      activeIcon="ti ti-calendar-event"
      valueLabel={valueLabel}
      clearValue={null}
      timezoneInfo
      onOpen={syncDraft}
    >
      {(close) => (
        <div>
          <div class="flex">
            <PresetRail
              presets={props.presets}
              onSelect={(value) => {
                props.onChange(value);
                const next = splitDateTime(value, props.dateConfig);
                setDraftDate(next.date);
                setDraftTime(next.time || "09:00");
                if (next.date) setVisibleMonth(parseDateValue(next.date, props.dateConfig));
                close();
              }}
            />
            <DatePickerPanel
              visibleMonth={visibleMonth}
              setVisibleMonth={setVisibleMonth}
              selected={draftDate}
              onSelect={(value) => {
                setDraftDate(value);
                setVisibleMonth(parseDateValue(value, props.dateConfig));
              }}
              dateConfig={props.dateConfig}
            />
          </div>
          <div class="flex items-center gap-2 px-3 pb-3">
            <TimeRow time={draftTime()} onChange={setDraftTime} />
            <button type="button" class="btn-primary btn-sm h-8" onClick={() => apply(close)} aria-label="Apply date and time">
              <i class="ti ti-check" />
            </button>
          </div>
        </div>
      )}
    </PickerShell>
  );
}

export function DateRangePicker(props: DateRangePickerProps) {
  const withTime = () => props.withTime ?? false;
  const durationPresets = () => props.durationPresets ?? [];
  const range = () => props.value();
  const startParts = () => (withTime() ? splitDateTime(range().start, props.dateConfig) : { date: range().start ?? "", time: "09:00" });
  const endParts = () => (withTime() ? splitDateTime(range().end, props.dateConfig) : { date: range().end ?? "", time: "10:00" });
  const [visibleMonth, setVisibleMonth] = createSignal(parseDateValue(startParts().date || endParts().date, props.dateConfig));
  const [draftRange, setDraftRange] = createSignal<DateRangeValue>({ start: startParts().date || null, end: endParts().date || null });
  const [previewDate, setPreviewDate] = createSignal<string | null>(null);
  const [startTime, setStartTime] = createSignal(startParts().time || "09:00");
  const [endTime, setEndTime] = createSignal(endParts().time || "10:00");

  const syncDraft = () => {
    const start = startParts();
    const end = endParts();
    setDraftRange({ start: start.date || null, end: end.date || null });
    setPreviewDate(null);
    setStartTime(start.time || "09:00");
    setEndTime(end.time || "10:00");
    if (start.date || end.date) setVisibleMonth(parseDateValue(start.date || end.date, props.dateConfig));
  };

  const valueLabel = () => {
    const value = range();
    if (!value.start && !value.end) return "";
    if (withTime()) {
      const start = value.start ? formatDateTimeValue(value.start, props.dateConfig) : "Start";
      const end = value.end ? formatDateTimeValue(value.end, props.dateConfig) : "End";
      return `${start} to ${end}`;
    }
    const start = value.start ? displayDate(value.start, props.dateConfig) : "Start";
    const end = value.end ? displayDate(value.end, props.dateConfig) : "End";
    return `${start} to ${end}`;
  };

  const valueContent = () => {
    const value = range();
    const start = withTime()
      ? value.start
        ? formatDateTimeValue(value.start, props.dateConfig)
        : "Start"
      : value.start
        ? displayDate(value.start, props.dateConfig)
        : "Start";
    const end = withTime()
      ? value.end
        ? formatDateTimeValue(value.end, props.dateConfig)
        : "End"
      : value.end
        ? displayDate(value.end, props.dateConfig)
        : "End";
    return (
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <span class="min-w-0 truncate">{start}</span>
        <i class="ti ti-arrow-narrow-right shrink-0 text-sm text-zinc-400" aria-hidden="true" />
        <span class="min-w-0 truncate">{end}</span>
      </span>
    );
  };

  const commitRange = (close?: () => void) => {
    const draft = draftRange();
    if (!withTime()) {
      props.onChange(draft);
      close?.();
      return;
    }
    props.onChange({
      start: draft.start ? toDateTimeValue(draft.start, startTime(), props.dateConfig) : null,
      end: draft.end ? toDateTimeValue(draft.end, endTime(), props.dateConfig) : null,
    });
    close?.();
  };

  const selectDatePreset = (value: string | null) => {
    if (!value) {
      setDraftRange({ start: null, end: null });
      setPreviewDate(null);
      return;
    }
    setDraftRange({ start: value, end: value });
    setPreviewDate(null);
    setVisibleMonth(parseDateValue(value, props.dateConfig));
  };

  const selectDate = (value: string) => {
    const current = draftRange();
    if (!current.start || current.end) {
      setDraftRange({ start: value, end: null });
      setPreviewDate(null);
      return;
    }
    setPreviewDate(null);
    setDraftRange(compareDateKey(value, current.start) < 0 ? { start: value, end: current.start } : { start: current.start, end: value });
  };

  const displayRange = () => {
    const current = draftRange();
    const preview = previewDate();
    if (!current.start || current.end || !preview) return current;
    return compareDateKey(preview, current.start) < 0 ? { start: preview, end: current.start } : { start: current.start, end: preview };
  };

  const durationPreview = () => {
    const draft = displayRange();
    if (!draft.start || !draft.end) return "";
    if (!withTime()) return formatDateOnlyRangeDuration(draft, props.dateConfig);
    if (!isCompleteTime(startTime()) || !isCompleteTime(endTime())) return "";
    const start = toDateTimeValue(draft.start, startTime(), props.dateConfig);
    const end = toDateTimeValue(draft.end, endTime(), props.dateConfig);
    if (!start || !end) return "";
    return dates.formatDuration(start, end);
  };

  const currentDurationMinutes = createMemo(() => {
    const draft = displayRange();
    if (!draft.start || !draft.end || !isCompleteTime(startTime()) || !isCompleteTime(endTime())) return null;
    const start = toDateTimeValue(draft.start, startTime(), props.dateConfig);
    const end = toDateTimeValue(draft.end, endTime(), props.dateConfig);
    if (!start || !end) return null;
    return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  });

  const applyDuration = (minutes: number) => {
    const draft = draftRange();
    if (!draft.start || !isCompleteTime(startTime())) return;
    const start = toDateTimeValue(draft.start, startTime(), props.dateConfig);
    if (!start) return;
    const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
    const next = splitDateTime(end, props.dateConfig);
    setDraftRange({ start: draft.start, end: next.date || draft.end || draft.start });
    setEndTime(next.time || endTime());
    setPreviewDate(null);
  };

  return (
    <PickerShell
      owner={props}
      icon="ti ti-calendar-stats"
      activeIcon="ti ti-calendar-event"
      valueLabel={valueLabel}
      valueContent={valueContent}
      clearValue={{ start: null, end: null }}
      timezoneInfo={withTime()}
      footerMeta={() => {
        const duration = durationPreview();
        if (!duration) return undefined;
        return (
          <span class="inline-flex items-center gap-1">
            <i class="ti ti-hourglass-low" />
            <span>{duration}</span>
          </span>
        );
      }}
      onOpen={syncDraft}
      wide={!!(props.datePresets?.length || props.presets?.length)}
    >
      {(close) => (
        <div>
          <div class="flex">
            <Show
              when={props.datePresets?.length}
              fallback={
                <PresetRail
                  presets={props.presets}
                  onSelect={(value) => {
                    props.onChange(value);
                    const start = withTime()
                      ? splitDateTime(value.start, props.dateConfig)
                      : { date: value.start ?? "", time: startTime() };
                    const end = withTime() ? splitDateTime(value.end, props.dateConfig) : { date: value.end ?? "", time: endTime() };
                    setDraftRange({ start: start.date || null, end: end.date || null });
                    setPreviewDate(null);
                    setStartTime(start.time || "09:00");
                    setEndTime(end.time || "10:00");
                    if (start.date || end.date) setVisibleMonth(parseDateValue(start.date || end.date, props.dateConfig));
                    close();
                  }}
                />
              }
            >
              <PresetRail presets={props.datePresets} onSelect={selectDatePreset} />
            </Show>
            <DatePickerPanel
              visibleMonth={visibleMonth}
              setVisibleMonth={setVisibleMonth}
              range={displayRange}
              onSelect={selectDate}
              onDayPreview={(date) => {
                const current = draftRange();
                setPreviewDate(current.start && !current.end ? date : null);
              }}
              dateConfig={props.dateConfig}
            />
          </div>
          <Show when={withTime()}>
            <div class={`flex min-w-0 items-end gap-2 px-2.5 ${durationPresets().length > 0 ? "pb-1.5" : "pb-2.5"}`}>
              <div class="min-w-0 flex-1">
                <TimeRow label="Start" time={startTime()} onChange={setStartTime} />
              </div>
              <div class="min-w-0 flex-1">
                <TimeRow label="End" time={endTime()} onChange={setEndTime} />
              </div>
              <button
                type="button"
                class="btn-primary btn-sm h-8 w-9 shrink-0 px-0"
                onClick={() => commitRange(close)}
                aria-label="Apply date range"
              >
                <i class="ti ti-check" />
              </button>
            </div>
            <Show when={durationPresets().length > 0}>
              <div class="flex min-w-0 items-center gap-1.5 px-2.5 pb-2">
                <div class="flex shrink-0 items-center gap-1 text-[11px] text-dimmed">
                  <i class="ti ti-clock-hour-3" />
                  <span>Duration</span>
                </div>
                <div class="flex min-w-0 flex-wrap gap-1">
                  <For each={durationPresets()}>
                    {(preset) => {
                      const active = () => currentDurationMinutes() === preset.minutes;
                      return (
                        <button
                          type="button"
                          class={`btn-segment h-6 rounded-md px-2 text-[11px] ${
                            active() ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : ""
                          }`}
                          aria-pressed={active()}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            applyDuration(preset.minutes);
                          }}
                          onClick={(event) => {
                            if (event.detail > 0) return;
                            applyDuration(preset.minutes);
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </Show>
          <Show when={!withTime()}>
            <div class="flex justify-end px-3 pb-3">
              <button type="button" class="btn-primary btn-sm" onClick={() => commitRange(close)}>
                Apply
              </button>
            </div>
          </Show>
        </div>
      )}
    </PickerShell>
  );
}

export default DatePicker;
