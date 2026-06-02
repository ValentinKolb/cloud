import {
  CheckboxCard,
  DatePicker,
  type DatePreset,
  DateRangePicker,
  type DateRangeValue,
  DateTimePicker,
  type DurationPreset,
  EntitySearch,
  type EntitySearchPrincipal,
  NumberInput,
  PanelDialog,
  SegmentedControl,
  SelectInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { type DateContext, dates } from "@valentinkolb/stdlib";
import { createSignal, For, Show } from "solid-js";
import type { Recurrence, SpaceColumn, SpaceItem, SpaceItemAssignee, SpaceTag } from "@/contracts";
import {
  emptyRecurrenceState,
  type RecurrenceEndMode,
  type RecurrenceFrequency,
  type RecurrencePreset,
  recurrenceEndOptions,
  recurrenceFrequencyOptions,
  recurrenceFromFormState,
  recurrenceToFormState,
  weekdayOptions,
} from "./recurrence";

type Priority = "low" | "medium" | "high" | "urgent";
type ItemType = "task" | "event";

export type ItemFormData = {
  columnId: string;
  title: string;
  description?: string;
  location?: string | null;
  url?: string | null;
  startsAt?: string;
  endsAt?: string;
  allDay?: boolean;
  recurrence?: Recurrence | null;
  deadline?: string;
  priority?: Priority | null;
  assigneeIds?: string[];
  tagIds?: string[];
};

type Props = {
  /** Existing item for edit mode, undefined for create mode */
  item?: SpaceItem;
  defaults?: Partial<ItemFormData> & { type?: ItemType };
  columns: SpaceColumn[];
  tags?: SpaceTag[];
  onSubmit: (data: ItemFormData) => void;
  onCancel: () => void;
  submitLabel?: string;
  title?: string;
  icon?: string;
  dateConfig?: DateContext;
};

const PRIORITY_OPTIONS = [
  { id: "urgent", label: "Urgent", icon: "ti ti-alert-circle" },
  { id: "high", label: "High", icon: "ti ti-arrows-up" },
  { id: "medium", label: "Medium", icon: "ti ti-arrow-up" },
  { id: "low", label: "Low", icon: "ti ti-arrow-down" },
  { id: "", label: "None", icon: "ti ti-minus" },
];

const pickerContext = (dateConfig?: DateContext): DateContext => ({ weekStartsOn: 1, ...dateConfig });

const dateKey = (date: Date | string, dateConfig?: DateContext) => dates.formatDateKey(date, pickerContext(dateConfig));

const datePart = (value: string, dateConfig?: DateContext): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : dateKey(value, dateConfig);

const instantFromLocalDateTime = (date: string, time: string, dateConfig?: DateContext): string => {
  const value = `${date}T${time}`;
  if (dateConfig?.timeZone) {
    return dates.zonedDateTimeToInstant(value, dateConfig.timeZone, { disambiguation: "compatible" });
  }
  return new Date(value).toISOString();
};

const allDayStart = (date: string, dateConfig?: DateContext): string => instantFromLocalDateTime(date, "00:00", dateConfig);

const allDayEnd = (date: string, dateConfig?: DateContext): string => {
  const nextDay = dates.addDays(dates.parseCalendarDate(date, pickerContext(dateConfig)), 1, pickerContext(dateConfig));
  return allDayStart(dateKey(nextDay, dateConfig), dateConfig);
};

const dateOnlyEndKey = (end: string, dateConfig?: DateContext): string => {
  const context = pickerContext(dateConfig);
  const endDate = new Date(end);
  const endKey = dateKey(endDate, context);
  const dayStart = dates.startOfDay(endDate, context);
  if (endDate.getTime() !== dayStart.getTime()) return endKey;
  return dateKey(dates.addDays(dates.parseCalendarDate(endKey, context), -1, context), context);
};

const dateOnlyRange = (start: string, end: string, dateConfig?: DateContext): DateRangeValue => ({
  start: start ? dateKey(start, dateConfig) : null,
  end: end ? dateOnlyEndKey(end, dateConfig) : null,
});

const scheduleDatePresets = (dateConfig?: DateContext): DatePreset<string | null>[] => {
  const context = pickerContext(dateConfig);
  const today = dates.today(context);
  const tomorrow = dates.addDays(today, 1, context);
  const nextWeek = dates.addWeeks(today, 1, context);
  return [
    { label: "Today", value: dateKey(today, context) },
    { label: "Tomorrow", value: dateKey(tomorrow, context) },
    { label: "Next week", value: dateKey(nextWeek, context) },
  ];
};

const EVENT_DURATION_PRESETS: DurationPreset[] = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
  { label: "3h", minutes: 180 },
];

const deadlinePresets = (dateConfig?: DateContext): DatePreset<string | null>[] => {
  const context = pickerContext(dateConfig);
  const todayDate = dates.today(context);
  const tomorrowDate = dates.addDays(todayDate, 1, context);
  const weekStart = dates.startOfWeek(todayDate, context);
  const friday = dates.addDays(weekStart, 4, context);
  return [
    { label: "Today", value: instantFromLocalDateTime(dateKey(todayDate, context), "17:00", context) },
    { label: "Tomorrow", value: instantFromLocalDateTime(dateKey(tomorrowDate, context), "17:00", context) },
    { label: "End of week", value: instantFromLocalDateTime(dateKey(friday, context), "17:00", context) },
  ];
};

/**
 * Unified form for creating and editing items.
 * - Create mode: item is undefined, shows type selector and tags
 * - Edit mode: item is provided, type is fixed based on existing data
 */
export default function ItemForm(props: Props) {
  const isEditMode = () => !!props.item;
  const initialIsEvent = () => Boolean(props.item?.startsAt && props.item?.endsAt);
  const dateTimeInitial = (value?: string | null) => (props.dateConfig?.timeZone ? (value ?? "") : (value?.slice(0, 16) ?? ""));

  // Form state
  const [title, setTitle] = createSignal(props.item?.title ?? "");
  const [description, setDescription] = createSignal(props.item?.description ?? "");
  const [location, setLocation] = createSignal(props.item?.location ?? "");
  const [url, setUrl] = createSignal(props.item?.url ?? "");
  const [columnId, setColumnId] = createSignal(props.item?.columnId ?? props.defaults?.columnId ?? props.columns[0]?.id ?? "");
  const [itemType, setItemType] = createSignal<ItemType>(
    initialIsEvent() ? "event" : isEditMode() ? "task" : (props.defaults?.type ?? "event"),
  );
  const [deadline, setDeadline] = createSignal(dateTimeInitial(props.item?.deadline ?? props.defaults?.deadline));
  const [startsAt, setStartsAt] = createSignal(dateTimeInitial(props.item?.startsAt ?? props.defaults?.startsAt));
  const [endsAt, setEndsAt] = createSignal(dateTimeInitial(props.item?.endsAt ?? props.defaults?.endsAt));
  const [allDay, setAllDay] = createSignal(props.item?.allDay ?? props.defaults?.allDay ?? false);
  const initialRecurrence = recurrenceToFormState(props.item?.recurrence ?? props.defaults?.recurrence, props.dateConfig);
  const [recurrenceEnabled, setRecurrenceEnabled] = createSignal(initialRecurrence.preset !== "never");
  const [recurrencePreset] = createSignal<RecurrencePreset>(initialRecurrence.preset === "never" ? "custom" : initialRecurrence.preset);
  const [recurrenceFrequency, setRecurrenceFrequency] = createSignal<RecurrenceFrequency>(initialRecurrence.frequency);
  const [recurrenceInterval, setRecurrenceInterval] = createSignal<number | null>(initialRecurrence.interval);
  const [recurrenceByDay, setRecurrenceByDay] = createSignal<string[]>(initialRecurrence.byDay);
  const [recurrenceEndMode, setRecurrenceEndMode] = createSignal<RecurrenceEndMode>(initialRecurrence.endMode);
  const [recurrenceUntil, setRecurrenceUntil] = createSignal(initialRecurrence.until);
  const [recurrenceCount, setRecurrenceCount] = createSignal<number | null>(initialRecurrence.count);
  const [priority, setPriority] = createSignal(props.item?.priority ?? props.defaults?.priority ?? "");
  const [assignees, setAssignees] = createSignal<SpaceItemAssignee[]>(props.item?.assignees ?? []);
  const [selectedTags, setSelectedTags] = createSignal<string[]>(props.item?.tags?.map((t) => t.id) ?? props.defaults?.tagIds ?? []);
  const [error, setError] = createSignal("");
  const [advancedOpen, setAdvancedOpen] = createSignal(false);

  const isEvent = () => itemType() === "event";
  const showAdvanced = () => advancedOpen();
  const defaultTitle = () => (isEditMode() ? (isEvent() ? "Edit event" : "Edit task") : isEvent() ? "New event" : "New task");
  const defaultSubmitLabel = () => (isEditMode() ? (isEvent() ? "Save Event" : "Save Task") : isEvent() ? "Create Event" : "Create Task");
  const eventRange = () =>
    allDay() ? dateOnlyRange(startsAt(), endsAt(), props.dateConfig) : { start: startsAt() || null, end: endsAt() || null };

  const columnOptions = () =>
    props.columns.map((c) => ({
      id: c.id,
      label: c.name,
      icon: "ti ti-layout-list",
    }));

  const defaultColumnId = () => props.columns[0]?.id ?? "";

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  };

  const toggleRecurrenceDay = (day: string) => {
    setRecurrenceByDay((prev) => (prev.includes(day) ? prev.filter((value) => value !== day) : [...prev, day]));
  };

  const handleRecurrenceEnabled = (enabled: boolean) => {
    setRecurrenceEnabled(enabled);
    if (!enabled) {
      const empty = emptyRecurrenceState();
      setRecurrenceFrequency(empty.frequency);
      setRecurrenceInterval(empty.interval);
      setRecurrenceByDay(empty.byDay);
      setRecurrenceEndMode(empty.endMode);
      setRecurrenceUntil(empty.until);
      setRecurrenceCount(empty.count);
    }
  };

  const addAssignee = (principal: EntitySearchPrincipal) => {
    if (principal.type !== "user") return;
    setAssignees((prev) => {
      if (prev.some((assignee) => assignee.id === principal.userId)) return prev;
      return [...prev, { id: principal.userId, displayName: principal.displayName }];
    });
  };

  const removeAssignee = (id: string) => {
    setAssignees((prev) => prev.filter((assignee) => assignee.id !== id));
  };

  const handleTypeChange = (type: ItemType) => {
    setItemType(type);
    if (type === "task") {
      setStartsAt("");
      setEndsAt("");
    } else {
      setDeadline("");
    }
  };

  const handleAllDayChange = (enabled: boolean) => {
    if (enabled === allDay()) return;
    if (enabled) {
      const nextRange = dateOnlyRange(startsAt(), endsAt(), props.dateConfig);
      setStartsAt(nextRange.start ?? "");
      setEndsAt(nextRange.end ?? nextRange.start ?? "");
    } else if (startsAt()) {
      const start = instantFromLocalDateTime(datePart(startsAt(), props.dateConfig), "09:00", props.dateConfig);
      const end = instantFromLocalDateTime(datePart(endsAt() || startsAt(), props.dateConfig), "10:00", props.dateConfig);
      setStartsAt(start);
      setEndsAt(end);
    }
    setAllDay(enabled);
    setError("");
  };

  const submitEventStart = () => {
    if (!allDay()) return startsAt() ? new Date(startsAt()).toISOString() : undefined;
    const range = eventRange();
    return range.start ? allDayStart(range.start, props.dateConfig) : undefined;
  };
  const submitEventEnd = () => {
    if (!allDay()) return endsAt() ? new Date(endsAt()).toISOString() : undefined;
    const range = eventRange();
    return range.end ? allDayEnd(range.end, props.dateConfig) : undefined;
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    setError("");

    if (!title().trim()) {
      setError("Title is required");
      return;
    }

    if (!isEvent() && !columnId()) {
      setError("Please select a status");
      return;
    }

    const eventStartsAt = submitEventStart();
    const eventEndsAt = submitEventEnd();

    if (isEvent()) {
      if (!eventStartsAt || !eventEndsAt) {
        setError("Events require both start and end time");
        return;
      }
      if (new Date(eventEndsAt) <= new Date(eventStartsAt)) {
        setError("End time must be after start time");
        return;
      }
      if (url().trim()) {
        try {
          new URL(url().trim());
        } catch {
          setError("Event URL must be a valid URL");
          return;
        }
      }
    }

    props.onSubmit({
      columnId: columnId() || defaultColumnId(),
      title: title().trim(),
      description: description().trim() || undefined,
      location: isEvent() ? location().trim() || (isEditMode() ? null : undefined) : undefined,
      url: isEvent() ? url().trim() || (isEditMode() ? null : undefined) : undefined,
      startsAt: isEvent() ? eventStartsAt : undefined,
      endsAt: isEvent() ? eventEndsAt : undefined,
      allDay: isEvent() ? allDay() : false,
      recurrence:
        isEvent() && recurrenceEnabled()
          ? recurrenceFromFormState(
              {
                preset: recurrencePreset(),
                frequency: recurrenceFrequency(),
                interval: recurrenceInterval() ?? 1,
                byDay: recurrenceByDay(),
                endMode: recurrenceEndMode(),
                until: recurrenceUntil(),
                count: recurrenceCount(),
              },
              startsAt(),
              props.dateConfig,
            )
          : null,
      deadline: !isEvent() && deadline() ? new Date(deadline()).toISOString() : undefined,
      priority: (priority() || (isEditMode() ? null : undefined)) as Priority | null | undefined,
      assigneeIds: isEditMode() || assignees().length > 0 ? assignees().map((assignee) => assignee.id) : undefined,
      tagIds: isEditMode() || selectedTags().length > 0 ? selectedTags() : undefined,
    });
  };

  return (
    <PanelDialog>
      <form onSubmit={handleSubmit} class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelDialog.Header title={props.title ?? defaultTitle()} icon={props.icon ?? "ti ti-pencil"} close={props.onCancel} />
        <PanelDialog.Body>
          <div class="flex flex-col gap-4">
            <Show when={!isEditMode()}>
              <div>
                <p class="mb-1 block text-sm font-medium">Type</p>
                <p class="mb-2 text-xs text-dimmed">Tasks have a deadline, events have a start and end time</p>
                <SegmentedControl
                  options={[
                    { value: "task" as const, label: "Task", icon: "ti ti-checkbox" },
                    {
                      value: "event" as const,
                      label: "Event",
                      icon: "ti ti-calendar-event",
                    },
                  ]}
                  value={itemType}
                  onChange={handleTypeChange}
                />
              </div>
            </Show>
            <TextInput
              label="Title"
              description={!isEditMode() ? "A short summary of what needs to be done" : undefined}
              placeholder="What needs to be done?"
              icon="ti ti-text-caption"
              value={title}
              onInput={(v) => {
                setTitle(v);
                setError("");
              }}
              required
            />
            <TextInput
              label="Description"
              description={!isEditMode() ? "Optional details or notes" : undefined}
              placeholder="Description in markdown ..."
              value={description}
              onInput={setDescription}
              markdown
            />
            <Show when={!isEvent()}>
              <DateTimePicker
                label="Deadline"
                description={!isEditMode() ? "When should this be completed?" : undefined}
                value={() => deadline() || null}
                onChange={(value) => setDeadline(value ?? "")}
                dateConfig={props.dateConfig}
                presets={deadlinePresets(props.dateConfig)}
                clearable
              />
            </Show>

            <Show when={isEvent()}>
              <DateRangePicker
                withTime={!allDay()}
                label="Schedule"
                description={!isEditMode() ? (allDay() ? "Calendar days for the event" : "Start and end time for the event") : undefined}
                value={eventRange}
                onChange={(value) => {
                  setStartsAt(value.start ?? "");
                  setEndsAt(value.end ?? "");
                  setError("");
                }}
                dateConfig={props.dateConfig}
                datePresets={scheduleDatePresets(props.dateConfig)}
                durationPresets={allDay() ? undefined : EVENT_DURATION_PRESETS}
                required
                clearable
              />
              <CheckboxCard
                label="All-day event"
                description="Use dates only and show the event in the all-day calendar row"
                icon="ti ti-calendar"
                variant="input"
                value={allDay}
                onChange={handleAllDayChange}
              />
            </Show>
          </div>

          <Show when={showAdvanced() && isEvent()}>
            <PanelDialog.Section title="Repeat" subtitle="Optional recurring event series." icon="ti ti-repeat">
              <CheckboxCard
                label="Repeat event"
                description="Create a recurring event series"
                icon="ti ti-repeat"
                variant="input"
                value={recurrenceEnabled}
                onChange={handleRecurrenceEnabled}
              />
              <Show when={recurrenceEnabled()}>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <SelectInput
                    label="Frequency"
                    description={!isEditMode() ? "Repeat cadence" : undefined}
                    icon="ti ti-repeat"
                    value={recurrenceFrequency}
                    onChange={(value) => setRecurrenceFrequency(value as RecurrenceFrequency)}
                    options={recurrenceFrequencyOptions}
                  />
                  <NumberInput
                    label="Every"
                    description={!isEditMode() ? "Interval between repeats" : undefined}
                    icon="ti ti-refresh"
                    value={recurrenceInterval}
                    onChange={setRecurrenceInterval}
                    min={1}
                    step={1}
                    allowNegative={false}
                  />
                </div>
                <Show when={recurrenceFrequency() === "weekly"}>
                  <div>
                    <p class="mb-1 block text-sm font-medium">Weekdays</p>
                    <p class="mb-2 text-xs text-dimmed">Leave empty to use the event start weekday</p>
                    <div class="grid grid-cols-7 gap-1">
                      <For each={weekdayOptions}>
                        {(day) => (
                          <button
                            type="button"
                            aria-label={day.fullLabel}
                            aria-pressed={recurrenceByDay().includes(day.id)}
                            class={`btn-segment justify-center px-0 ${
                              recurrenceByDay().includes(day.id) ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : ""
                            }`}
                            onClick={() => toggleRecurrenceDay(day.id)}
                          >
                            {day.label}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
                <SelectInput
                  label="Ends"
                  description={!isEditMode() ? "Limit the series when needed" : undefined}
                  icon="ti ti-calendar-due"
                  value={recurrenceEndMode}
                  onChange={(value) => setRecurrenceEndMode(value as RecurrenceEndMode)}
                  options={recurrenceEndOptions}
                />
              </Show>
              <Show when={recurrenceEnabled() && recurrenceEndMode() !== "never"}>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Show when={recurrenceEndMode() === "on"}>
                    <DatePicker
                      label="Until"
                      description={!isEditMode() ? "Last date that may contain an occurrence" : undefined}
                      value={() => recurrenceUntil() || null}
                      onChange={(value) => setRecurrenceUntil(value ?? "")}
                      dateConfig={props.dateConfig}
                      clearable
                    />
                  </Show>
                  <Show when={recurrenceEndMode() === "after"}>
                    <NumberInput
                      label="Occurrences"
                      description={!isEditMode() ? "Maximum number of generated events" : undefined}
                      icon="ti ti-list-numbers"
                      value={recurrenceCount}
                      onChange={setRecurrenceCount}
                      min={1}
                      step={1}
                      allowNegative={false}
                      clearable
                    />
                  </Show>
                </div>
              </Show>
            </PanelDialog.Section>
          </Show>

          <Show when={showAdvanced() && isEvent()}>
            <PanelDialog.Section
              title="Event details"
              subtitle="Location and external reference for calendar subscriptions."
              icon="ti ti-map-pin"
            >
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <TextInput
                  label="Location"
                  description={!isEditMode() ? "Where does it happen?" : undefined}
                  placeholder="Office, meeting room, or address"
                  icon="ti ti-map-pin"
                  value={location}
                  onInput={setLocation}
                />
                <TextInput
                  label="URL"
                  description={!isEditMode() ? "Meeting link or reference" : undefined}
                  placeholder="https://..."
                  icon="ti ti-link"
                  type="url"
                  inputMode="url"
                  value={url}
                  onInput={(v) => {
                    setUrl(v);
                    setError("");
                  }}
                />
              </div>
            </PanelDialog.Section>
          </Show>

          <Show when={showAdvanced()}>
            <PanelDialog.Section title="Organize" subtitle="Workflow, priority, tags, and ownership." icon="ti ti-tags">
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <SelectInput
                  label="Kanban"
                  description={!isEditMode() ? "Current workflow state" : undefined}
                  placeholder="Select column"
                  icon="ti ti-progress"
                  value={columnId}
                  onChange={setColumnId}
                  options={columnOptions()}
                  required={!isEvent()}
                />
                <SelectInput
                  label="Priority"
                  description={!isEditMode() ? "How urgent is this?" : undefined}
                  placeholder="Select priority"
                  icon="ti ti-flag"
                  value={priority}
                  onChange={setPriority}
                  options={PRIORITY_OPTIONS}
                  clearable
                />
              </div>
              <Show when={props.tags && props.tags.length > 0}>
                <div>
                  <p class="mb-1 block text-sm font-medium">Tags</p>
                  <Show when={!isEditMode()}>
                    <p class="mb-2 text-xs text-dimmed">Categorize with tags</p>
                  </Show>
                  <div class="flex flex-wrap gap-2">
                    <For each={props.tags}>
                      {(tag) => (
                        <button
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          class={`flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-all ${
                            selectedTags().includes(tag.id) ? "opacity-100" : "opacity-40 hover:opacity-70"
                          }`}
                          style={`background-color: ${tag.color}${selectedTags().includes(tag.id) ? "30" : "15"}; color: ${tag.color}`}
                        >
                          <span class="h-2 w-2 rounded-full" style={`background-color: ${tag.color}`} />
                          {tag.name}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <div class="flex flex-col gap-3">
                <div>
                  <p class="mb-1 block text-sm font-medium">Assignees</p>
                  <p class="text-xs text-dimmed">Assign initial owners or leave unassigned</p>
                </div>
                <Show when={assignees().length > 0}>
                  <div class="flex flex-wrap gap-2">
                    <For each={assignees()}>
                      {(assignee) => (
                        <span class="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                          <span class="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-[10px] dark:bg-zinc-700">
                            {assignee.displayName.charAt(0).toUpperCase()}
                          </span>
                          <span>{assignee.displayName}</span>
                          <button type="button" onClick={() => removeAssignee(assignee.id)} class="text-dimmed hover:text-red-500">
                            <i class="ti ti-x text-xs" />
                          </button>
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
                <EntitySearch
                  includeUsers
                  excludeUserIds={assignees().map((assignee) => assignee.id)}
                  onSelect={addAssignee}
                  placeholder="Search users to assign..."
                  resultsHeightClass="h-36"
                />
              </div>
            </PanelDialog.Section>
          </Show>

          <Show when={error()}>
            <div class="flex items-center gap-1 text-sm text-red-500">
              <i class="ti ti-alert-circle" />
              {error()}
            </div>
          </Show>
        </PanelDialog.Body>

        <PanelDialog.Footer>
          <Show fallback={<span />} when={isEditMode() || !advancedOpen()}>
            <button
              type="button"
              class="btn-secondary btn-sm"
              aria-expanded={advancedOpen()}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <i class={`ti ${advancedOpen() ? "ti-eye-off" : "ti-eye"}`} />
              <span>{advancedOpen() ? "Hide options" : "More options"}</span>
            </button>
          </Show>
          <div class="flex items-center gap-2">
            <button type="button" onClick={props.onCancel} class="btn-secondary btn-sm">
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm">
              {props.submitLabel ?? defaultSubmitLabel()}
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}
