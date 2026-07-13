import { SegmentedControl } from "@valentinkolb/cloud/ui";
import { createSignal } from "solid-js";
import type { Priority } from "@/contracts";
import {
  type EventsDaysAhead,
  readAllSettings,
  readWidgetSettings,
  type SpaceUserSettings,
  type ViewType,
  type WidgetSettings,
  writeAllSettings,
  writeWidgetSettings,
} from "../settings/SpaceSettingsStore";

const VIEW_OPTIONS: { value: ViewType; label: string; icon: string }[] = [
  { value: "list", label: "Overview", icon: "ti-home" },
  { value: "table", label: "Table", icon: "ti-table" },
  { value: "kanban", label: "Kanban", icon: "ti-layout-kanban" },
  { value: "calendar", label: "Calendar", icon: "ti-calendar" },
];

const EVENTS_DAYS_OPTIONS = [
  { value: "1" as const, label: "Today" },
  { value: "3" as const, label: "3 days" },
  { value: "7" as const, label: "1 week" },
  { value: "14" as const, label: "2 weeks" },
];

const TASKS_PRIORITY_OPTIONS = [
  { value: "" as const, label: "All" },
  { value: "low" as const, label: "Low+" },
  { value: "medium" as const, label: "Med+" },
  { value: "high" as const, label: "High+" },
  { value: "urgent" as const, label: "Urgent" },
];

function LocalSettingsForm(props: { spaceId: string; initialSettings: SpaceUserSettings }) {
  const [settings, setSettings] = createSignal<SpaceUserSettings>(props.initialSettings);

  const updateSetting = <K extends keyof SpaceUserSettings>(key: K, value: SpaceUserSettings[K]) => {
    const newSettings = { ...settings(), [key]: value };
    setSettings(newSettings);

    const allSettings = readAllSettings();
    allSettings.spaces[props.spaceId] = newSettings;
    writeAllSettings(allSettings);
  };

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Default View</p>
        <SegmentedControl
          options={VIEW_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
            icon: `ti ${o.icon}`,
          }))}
          value={() => settings().view}
          onChange={(v) => updateSetting("view", v)}
        />
      </div>

      <p class="text-xs text-dimmed">These are your personal defaults for this space.</p>
    </div>
  );
}

function WidgetSettingsForm() {
  const [settings, setSettings] = createSignal<WidgetSettings>(readWidgetSettings());

  const updateSetting = <K extends keyof WidgetSettings>(key: K, value: WidgetSettings[K]) => {
    const newSettings = { ...settings(), [key]: value };
    setSettings(newSettings);
    writeWidgetSettings(newSettings);
  };

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Events: Time Range</p>
        <SegmentedControl
          options={EVENTS_DAYS_OPTIONS}
          value={() => String(settings().eventsDaysAhead)}
          onChange={(v) => updateSetting("eventsDaysAhead", Number(v) as EventsDaysAhead)}
        />
      </div>

      <div class="flex flex-col gap-1">
        <p class="text-xs text-secondary">Tasks: Minimum Priority</p>
        <SegmentedControl
          options={TASKS_PRIORITY_OPTIONS}
          value={() => settings().tasksMinPriority ?? ""}
          onChange={(v) => updateSetting("tasksMinPriority", (v || null) as Priority | null)}
        />
      </div>

      <p class="text-xs text-dimmed">These settings apply to the home page widgets across all spaces, not just this one.</p>
    </div>
  );
}

export function DefaultsSection(props: { spaceId: string; initialSettings: SpaceUserSettings }) {
  return (
    <div class="flex flex-col gap-6">
      <LocalSettingsForm spaceId={props.spaceId} initialSettings={props.initialSettings} />
      <WidgetSettingsForm />
    </div>
  );
}
