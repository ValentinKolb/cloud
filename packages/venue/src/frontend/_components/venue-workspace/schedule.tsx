import { CheckboxCardInput, DatePicker, PanelDialog, prompts, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import type {
  DateOverride,
  DateOverrideInput,
  OpeningRule,
  OpeningRuleInput,
  ShiftTemplate,
  ShiftTemplateInput,
  UpcomingSlot,
} from "../../../contracts";
import { weekdayOptions } from "./constants";
import { timeZoneDateConfig, todayDateKey } from "./utils";

export function ProgressBar(props: { slot: UpcomingSlot; compact?: boolean }) {
  const total = () => props.slot.maxPeople ?? Math.max(props.slot.minPeople, props.slot.assignedCount, 1);
  const pct = () => Math.min(100, Math.round((props.slot.assignedCount / total()) * 100));
  return (
    <div>
      <Show when={!props.compact}>
        <div class="mb-1 flex items-center justify-between text-[11px] text-dimmed">
          <span>
            {props.slot.assignedCount}/{props.slot.maxPeople ?? props.slot.minPeople} staffed
          </span>
          <span>{props.slot.missingPeople > 0 ? `${props.slot.missingPeople} missing` : "covered"}</span>
        </div>
      </Show>
      <div class={`${props.compact ? "h-1" : "h-1.5"} overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800`}>
        <div
          class={`h-full rounded-full ${props.slot.missingPeople > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct()}%` }}
        />
      </div>
    </div>
  );
}

export function ScheduleActionButton(props: {
  label: string;
  icon: string;
  tone: "edit" | "delete";
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={`inline-flex h-7 w-7 items-center justify-center rounded-md bg-transparent transition-colors ${
        props.tone === "edit"
          ? "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          : "text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
      }`}
      title={props.label}
      aria-label={props.label}
      disabled={props.loading}
      onClick={props.onClick}
    >
      <i class={props.loading ? "ti ti-loader-2 animate-spin" : props.icon} />
    </button>
  );
}

export function DialogFrame(props: {
  title: string;
  subtitle?: string;
  icon: string;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: JSX.Element;
}) {
  return (
    <PanelDialog>
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PanelDialog.Header title={props.title} subtitle={props.subtitle} icon={props.icon} close={props.onCancel} />
        <PanelDialog.Body>{props.children}</PanelDialog.Body>
        <PanelDialog.Footer>
          <div />
          <div class="flex justify-end gap-2">
            <button type="button" class="btn-secondary btn-sm" onClick={props.onCancel}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={props.onSubmit}>
              {props.submitLabel}
            </button>
          </div>
        </PanelDialog.Footer>
      </div>
    </PanelDialog>
  );
}

export function OpeningRuleDialog(props: { close: (value: OpeningRuleInput | null) => void; initial?: OpeningRule }) {
  const [weekday, setWeekday] = createSignal(String(props.initial?.weekday ?? 1));
  const [startTime, setStartTime] = createSignal(props.initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = createSignal(props.initial?.endTime ?? "17:00");
  const [note, setNote] = createSignal(props.initial?.note ?? "");

  const submit = () => {
    if (!startTime().trim() || !endTime().trim()) {
      prompts.error("Start and end time are required.");
      return;
    }
    props.close({
      weekday: Number(weekday()),
      startTime: startTime().trim(),
      endTime: endTime().trim(),
      note: note().trim() || null,
    });
  };

  return (
    <DialogFrame
      title={props.initial ? "Edit opening hours" : "Add opening hours"}
      icon="ti ti-clock"
      submitLabel={props.initial ? "Save" : "Add"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <SelectInput label="Weekday" value={weekday} onChange={setWeekday} options={weekdayOptions} />
        <div class="grid gap-3 sm:grid-cols-2">
          <TextInput label="Start" value={startTime} onInput={setStartTime} placeholder="09:00" inputMode="numeric" required />
          <TextInput label="End" value={endTime} onInput={setEndTime} placeholder="17:00" inputMode="numeric" required />
        </div>
        <TextInput label="Note" value={note} onInput={setNote} placeholder="Optional" />
      </div>
    </DialogFrame>
  );
}

export function ClosedDayDialog(props: { close: (value: DateOverrideInput | null) => void; timeZone: string; initial?: DateOverride }) {
  const [date, setDate] = createSignal<string | null>(props.initial?.date ?? todayDateKey());
  const [note, setNote] = createSignal(props.initial?.note ?? "Holiday");

  const submit = () => {
    if (!date()) {
      prompts.error("Pick a date.");
      return;
    }
    props.close({ date: date()!, kind: "closed", note: note().trim() || "Holiday" });
  };

  return (
    <DialogFrame
      title={props.initial ? "Edit closed day" : "Add closed day"}
      icon="ti ti-calendar-x"
      submitLabel={props.initial ? "Save" : "Add"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <DatePicker label="Date" value={date} onChange={setDate} dateConfig={timeZoneDateConfig(props.timeZone)} required />
        <TextInput label="Note" value={note} onInput={setNote} placeholder="Public holiday" />
      </div>
    </DialogFrame>
  );
}

type ShiftTemplateDraft = {
  title: string;
  weekday: string;
  startTime: string;
  endTime: string;
  minPeople: string;
  maxPeople: string;
  requireTargetForOpening: boolean;
  active: boolean;
};

const parseOptionalPeople = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
};

const parseRequiredPeople = (value: string): number => Number(value.trim() || "1");

const buildShiftTemplateInput = (
  draft: ShiftTemplateDraft,
): { input: ShiftTemplateInput; error: null } | { input: null; error: string } => {
  const title = draft.title.trim();
  const startTime = draft.startTime.trim();
  const endTime = draft.endTime.trim();
  const min = parseRequiredPeople(draft.minPeople);
  const max = parseOptionalPeople(draft.maxPeople);

  if (!title || !startTime || !endTime || Number.isNaN(min) || (max !== null && Number.isNaN(max))) {
    return { input: null, error: "Title, times, and staffing numbers are required." };
  }
  if (min < 0 || (max !== null && max < 0)) return { input: null, error: "Staffing numbers cannot be negative." };
  if (max !== null && max < min) return { input: null, error: "Max people must be greater than or equal to target people." };
  if (draft.requireTargetForOpening && min < 1) {
    return { input: null, error: "Target people must be at least one when it controls public opening." };
  }

  return {
    input: {
      title,
      weekday: Number(draft.weekday),
      startTime,
      endTime,
      minPeople: min,
      maxPeople: max,
      requireTargetForOpening: draft.requireTargetForOpening,
      active: draft.active,
    },
    error: null,
  };
};

export function ShiftTemplateDialog(props: { close: (value: ShiftTemplateInput | null) => void; initial?: ShiftTemplate }) {
  const [title, setTitle] = createSignal(props.initial?.title ?? "");
  const [weekday, setWeekday] = createSignal(String(props.initial?.weekday ?? 1));
  const [startTime, setStartTime] = createSignal(props.initial?.startTime ?? "09:00");
  const [endTime, setEndTime] = createSignal(props.initial?.endTime ?? "13:00");
  const [minPeople, setMinPeople] = createSignal(String(props.initial?.minPeople ?? 1));
  const [maxPeople, setMaxPeople] = createSignal(props.initial?.maxPeople == null ? "" : String(props.initial.maxPeople));
  const [requireTargetForOpening, setRequireTargetForOpening] = createSignal(props.initial?.requireTargetForOpening ?? false);

  const submit = () => {
    const result = buildShiftTemplateInput({
      title: title(),
      weekday: weekday(),
      startTime: startTime(),
      endTime: endTime(),
      minPeople: minPeople(),
      maxPeople: maxPeople(),
      requireTargetForOpening: requireTargetForOpening(),
      active: props.initial?.active ?? true,
    });
    if (result.error) {
      prompts.error(result.error);
      return;
    }
    props.close(result.input);
  };

  return (
    <DialogFrame
      title={props.initial ? "Edit shift" : "Add shift"}
      icon="ti ti-calendar-plus"
      submitLabel={props.initial ? "Save" : "Add"}
      onCancel={() => props.close(null)}
      onSubmit={submit}
    >
      <div class="grid gap-3">
        <TextInput label="Title" value={title} onInput={setTitle} placeholder="Morning shift" required />
        <SelectInput label="Weekday" value={weekday} onChange={setWeekday} options={weekdayOptions} />
        <div class="grid gap-3 sm:grid-cols-2">
          <TextInput label="Start" value={startTime} onInput={setStartTime} placeholder="09:00" inputMode="numeric" required />
          <TextInput label="End" value={endTime} onInput={setEndTime} placeholder="13:00" inputMode="numeric" required />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <TextInput label="Target people" value={minPeople} onInput={setMinPeople} inputMode="numeric" required />
          <TextInput label="Max people" value={maxPeople} onInput={setMaxPeople} inputMode="numeric" placeholder="Optional" />
        </div>
        <CheckboxCardInput
          label="Require target staffing to open"
          description="The public page counts this shift as open only after the target number of people has signed up."
          icon="ti ti-users-check"
          value={requireTargetForOpening}
          onChange={setRequireTargetForOpening}
          variant="input"
        />
      </div>
    </DialogFrame>
  );
}
