import { MultiSelectInput, Select } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import type { RecordDisplayConfig, RecordDisplayMode } from "../../../contracts";
import type { Field } from "../../../service";
import { fieldOption, fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";

const MODE_OPTIONS = [
  {
    id: "table",
    label: "Table",
    description: "Dense rows and columns.",
    icon: "ti ti-table",
  },
  {
    id: "cards",
    label: "Cards",
    description: "Visual record cards.",
    icon: "ti ti-layout-grid",
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Records placed by date.",
    icon: "ti ti-calendar",
  },
];

const withDefaults = (value: RecordDisplayConfig): RecordDisplayConfig => ({
  mode: value.mode ?? "table",
  cards: value.cards ?? {},
  calendar: value.calendar ?? {},
});

export function RecordDisplayConfigEditor(props: {
  value: () => RecordDisplayConfig;
  onChange: (value: RecordDisplayConfig) => void;
  fields: () => Field[];
}) {
  const display = () => withDefaults(props.value());
  const liveFields = () => props.fields().filter((field) => !field.deletedAt);
  const cardFieldOptions = () =>
    liveFields()
      .filter((field) => field.type !== "file")
      .map((field) => fieldOption(field, "Shown on card"));
  const cardSelectedOptions = () => {
    const byId = new Map(cardFieldOptions().map((option) => [option.id, option]));
    return (display().cards?.fieldIds ?? []).flatMap((id) => {
      const option = byId.get(id);
      return option ? [option] : [];
    });
  };
  const imageFieldOptions = () =>
    liveFields()
      .filter((field) => field.type === "file")
      .map((field) => ({
        id: field.id,
        label: field.name,
        description: "First image file becomes the card cover.",
        icon: fieldTypeIcon(field.type, field.icon),
      }));
  const imageFieldLabel = () => {
    const fieldId = display().cards?.imageFieldId;
    return fieldId ? liveFields().find((field) => field.id === fieldId)?.name : undefined;
  };
  const dateFieldOptions = () =>
    liveFields()
      .filter((field) => field.type === "date")
      .map((field) => ({
        id: field.id,
        label: field.name,
        description: `${fieldTypeLabel(field.type)} · used as event date`,
        icon: fieldTypeIcon(field.type, field.icon),
      }));
  const dateFieldLabel = () => {
    const fieldId = display().calendar?.dateFieldId;
    return fieldId ? liveFields().find((field) => field.id === fieldId)?.name : undefined;
  };

  const patch = (next: Partial<RecordDisplayConfig>) => props.onChange({ ...display(), ...next });
  const patchCards = (cards: NonNullable<RecordDisplayConfig["cards"]>) => patch({ cards: { ...display().cards, ...cards } });
  const patchCalendar = (calendar: NonNullable<RecordDisplayConfig["calendar"]>) =>
    patch({ calendar: { ...display().calendar, ...calendar } });
  const changeMode = (mode: RecordDisplayMode) => {
    if (mode === "calendar" && !display().calendar?.dateFieldId) {
      patch({ mode, calendar: { ...display().calendar, dateFieldId: dateFieldOptions()[0]?.id ?? null } });
      return;
    }
    patch({ mode });
  };

  return (
    <div class="flex flex-col gap-4">
      <Select
        label="Display"
        description="Choose how this table or view is shown."
        value={() => display().mode}
        onChange={(mode) => changeMode(mode as RecordDisplayMode)}
        options={MODE_OPTIONS}
      />

      <Show when={display().mode === "cards"}>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Select
            label="Cover image"
            description="Optional image shown at the top of each card."
            placeholder={imageFieldOptions().length > 0 ? "No cover image" : "No file fields"}
            value={() => display().cards?.imageFieldId ?? ""}
            onChange={(imageFieldId) => patchCards({ imageFieldId: imageFieldId || null })}
            selectedLabel={imageFieldLabel}
            options={imageFieldOptions()}
            clearable
            disabled={imageFieldOptions().length === 0}
          />
          <MultiSelectInput
            label="Card fields"
            description="Pick only the fields people need at a glance."
            placeholder="Choose fields"
            icon="ti ti-layout-list"
            value={() => display().cards?.fieldIds ?? []}
            onChange={(fieldIds) => patchCards({ fieldIds })}
            options={cardFieldOptions()}
            selectedOptions={cardSelectedOptions}
            clearable
          />
        </div>
        <p class="text-xs text-dimmed">Cards still use the same GQL source and permissions.</p>
      </Show>

      <Show when={display().mode === "calendar"}>
        <Select
          label="Date field"
          description="Records are placed in the calendar by this date."
          placeholder={dateFieldOptions().length > 0 ? "Choose date field" : "No date fields"}
          value={() => display().calendar?.dateFieldId ?? ""}
          onChange={(dateFieldId) => patchCalendar({ dateFieldId: dateFieldId || null })}
          selectedLabel={dateFieldLabel}
          options={dateFieldOptions()}
          clearable
          disabled={dateFieldOptions().length === 0}
        />
        <Show when={dateFieldOptions().length === 0}>
          <div class="info-block-warning text-xs">Add a date field before using calendar display.</div>
        </Show>
      </Show>
    </div>
  );
}
