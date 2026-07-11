import {
  Checkbox,
  dialogCore,
  MultiSelectInput,
  PanelDialog,
  Placeholder,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { createEffect, createMemo, createSignal, Index, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field } from "../../../service";
import type { FormFieldEntry } from "../../../service/forms";
import { TYPE_LABELS } from "../fields/field-config-editor";
import { isRecordInputField } from "../fields/field-render";
import { fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";
import { FieldInput } from "./form-fields";

const canBeFormInput = (field: Field) => isRecordInputField(field.type);

export function FormFieldsEditor(props: {
  tableFields: Field[];
  entries: () => FormFieldEntry[];
  setEntries: (next: FormFieldEntry[]) => void;
}) {
  const [selectedEntryIndex, setSelectedEntryIndex] = createSignal(0);
  const includedIds = createMemo(() => new Set(props.entries().map((entry) => entry.fieldId)));
  const addable = createMemo(() =>
    props.tableFields.filter((field) => !field.deletedAt && canBeFormInput(field) && !includedIds().has(field.id)),
  );
  const fieldById = createMemo(() => new Map(props.tableFields.map((field) => [field.id, field])));
  const selectedIndex = createMemo(() => Math.min(selectedEntryIndex(), Math.max(props.entries().length - 1, 0)));
  const selectedEntry = createMemo(() => props.entries()[selectedIndex()] ?? null);
  const selectedField = createMemo(() => {
    const entry = selectedEntry();
    return entry ? fieldById().get(entry.fieldId) : undefined;
  });

  const replaceEntries = (next: FormFieldEntry[]) => {
    props.setEntries(next);
  };

  const addEntry = async (fieldId: string) => {
    const field = fieldById().get(fieldId);
    if (!field) return;
    const kind = await chooseFormFieldEntryKind(field);
    if (!kind) return;
    replaceEntries([
      ...props.entries(),
      kind === "form_value" ? { kind: "form_value", fieldId, value: null } : { kind: "user_input", fieldId, required: field.required },
    ]);
    setSelectedEntryIndex(props.entries().length);
  };

  const removeEntry = (index: number) => {
    replaceEntries(props.entries().filter((_, i) => i !== index));
    setSelectedEntryIndex(Math.max(0, Math.min(index, props.entries().length - 2)));
  };

  const updateEntry = (index: number, patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => {
    replaceEntries(
      props.entries().map((entry, i) => {
        if (i !== index || entry.kind !== "user_input") return entry;
        return { ...entry, ...patch };
      }),
    );
  };

  const updateFormValue = (index: number, value: unknown) => {
    replaceEntries(
      props.entries().map((entry, i) => {
        if (i !== index || entry.kind !== "form_value") return entry;
        return { ...entry, value };
      }),
    );
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= props.entries().length) return;
    const next = [...props.entries()];
    [next[index], next[target]] = [next[target]!, next[index]!];
    replaceEntries(next);
    setSelectedEntryIndex(target);
  };

  const openFieldSettings = async (index: number) => {
    const entry = props.entries()[index];
    const field = entry ? fieldById().get(entry.fieldId) : undefined;
    if (!entry || !field) return;
    const next = await openFormFieldSettingsDialog({ entry, field });
    if (!next) return;
    replaceEntries(props.entries().map((current, i) => (i === index ? next : current)));
    setSelectedEntryIndex(index);
  };

  return (
    <div class="grid min-h-[28rem] grid-cols-1 gap-3 md:grid-cols-2">
      <div class="flex min-h-0 flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-sm font-semibold text-primary">Form fields</p>
            <p class="text-[11px] text-dimmed">Order and choose what visitors see.</p>
          </div>
          <span class="text-[10px] text-dimmed">{props.entries().length}</span>
        </div>
        <Show
          when={props.entries().length > 0}
          fallback={
            <Placeholder surface="paper" align="left" class="p-3">
              No fields yet.
            </Placeholder>
          }
        >
          <ul class="flex min-h-0 flex-col gap-1 overflow-y-auto">
            <Index each={props.entries()}>
              {(entry, idx) => {
                const field = () => fieldById().get(entry().fieldId);
                const selected = () => selectedIndex() === idx;
                return (
                  <li>
                    <div
                      class={`paper flex w-full items-center gap-2 px-2 py-2 text-left transition-colors ${
                        selected()
                          ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                          : "hover:paper-highlighted"
                      }`}
                    >
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => setSelectedEntryIndex(idx)}
                      >
                        <Show when={field()} fallback={<i class="ti ti-alert-triangle text-dimmed" />}>
                          {(f) => <i class={`${fieldTypeIcon(f().type, f().icon)} shrink-0 text-dimmed`} />}
                        </Show>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-sm font-medium text-primary">{field()?.name ?? "Missing field"}</span>
                          <span class="block truncate text-[10px] text-dimmed">
                            {entry().kind === "form_value" ? "Fixed value" : fieldTypeLabel(field()?.type ?? "text")}
                          </span>
                        </span>
                      </button>
                      <Show when={entry().kind === "form_value"}>
                        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-secondary dark:bg-zinc-800">Fixed</span>
                      </Show>
                      <Show when={entry().kind === "user_input" && (entry() as Extract<FormFieldEntry, { kind: "user_input" }>).required}>
                        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-secondary dark:bg-zinc-800">Required</span>
                      </Show>
                      <div class="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          class="icon-btn"
                          onClick={() => moveEntry(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          aria-label="Move up"
                        >
                          <i class="ti ti-arrow-up" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn"
                          onClick={() => moveEntry(idx, 1)}
                          disabled={idx === props.entries().length - 1}
                          title="Move down"
                          aria-label="Move down"
                        >
                          <i class="ti ti-arrow-down" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn md:hidden"
                          onClick={() => void openFieldSettings(idx)}
                          title="Edit field settings"
                          aria-label="Edit field settings"
                        >
                          <i class="ti ti-pencil" />
                        </button>
                        <button
                          type="button"
                          class="icon-btn text-red-500 hover:text-red-600"
                          onClick={() => removeEntry(idx)}
                          title="Remove from form"
                          aria-label="Remove from form"
                        >
                          <i class="ti ti-trash" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }}
            </Index>
          </ul>
        </Show>
        <Show when={addable().length > 0}>
          <Select
            label="Add field"
            description="Pick a table field, then choose how the form uses it."
            value={() => ""}
            onChange={(value) => {
              if (value) void addEntry(value);
            }}
            options={addable().map((field) => ({
              id: field.id,
              label: field.name,
              description: fieldTypeLabel(field.type),
              icon: fieldTypeIcon(field.type, field.icon),
            }))}
            placeholder="Pick a field..."
          />
        </Show>
      </div>

      <FormFieldInspector
        class="hidden md:flex"
        entry={selectedEntry}
        field={selectedField}
        index={selectedIndex}
        updateEntry={updateEntry}
        updateFormValue={updateFormValue}
      />
    </div>
  );
}

function FormFieldInspector(props: {
  class?: string;
  entry: () => FormFieldEntry | null;
  field: () => Field | undefined;
  index: () => number;
  updateEntry: (index: number, patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => void;
  updateFormValue: (index: number, value: unknown) => void;
}) {
  const userEntry = createMemo(() =>
    props.entry()?.kind === "user_input" ? (props.entry() as Extract<FormFieldEntry, { kind: "user_input" }>) : null,
  );
  const valueEntry = createMemo(() =>
    props.entry()?.kind === "form_value" ? (props.entry() as Extract<FormFieldEntry, { kind: "form_value" }>) : null,
  );

  return (
    <Show
      when={props.entry() && props.field()}
      fallback={
        <div class={`paper min-h-64 items-center justify-center p-4 text-sm text-dimmed ${props.class ?? "flex"}`}>
          Select a field to configure it.
        </div>
      }
    >
      <div class={`paper min-h-0 flex-col gap-3 p-4 ${props.class ?? "flex"}`}>
        <FormFieldSettings
          entry={props.entry}
          field={props.field}
          userEntry={userEntry}
          valueEntry={valueEntry}
          updateEntry={(patch) => props.updateEntry(props.index(), patch)}
          updateFormValue={(value) => props.updateFormValue(props.index(), value)}
        />
      </div>
    </Show>
  );
}

function FormFieldSettings(props: {
  entry: () => FormFieldEntry | null;
  field: () => Field | undefined;
  userEntry: () => Extract<FormFieldEntry, { kind: "user_input" }> | null;
  valueEntry: () => Extract<FormFieldEntry, { kind: "form_value" }> | null;
  updateEntry: (patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => void;
  updateFormValue: (value: unknown) => void;
}) {
  return (
    <>
      <div class="flex items-start gap-3">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
          <i class={`${fieldTypeIcon(props.field()!.type, props.field()!.icon)} text-sm`} />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold text-primary">{props.field()!.name}</p>
          <p class="text-[11px] text-dimmed">
            {fieldTypeLabel(props.field()!.type)}
            <Show when={props.valueEntry()}> · fixed value</Show>
          </p>
        </div>
      </div>

      <Show when={props.userEntry()}>
        {(entry) => (
          <>
            <Checkbox
              label="Required"
              description="Visitors must provide a value before submitting."
              value={() => entry().required}
              onChange={(required) => props.updateEntry({ required })}
            />
            <div class="flex flex-col gap-3">
              <TextInput
                label="Label override (optional)"
                description="Use a different label on this form."
                icon="ti ti-tag"
                value={() => entry().label ?? ""}
                onInput={(value) => props.updateEntry({ label: value.trim() === "" ? undefined : value })}
                placeholder={props.field()!.name}
              />
              <TextInput
                label="Help text (optional)"
                description="Shown below the input."
                icon="ti ti-info-circle"
                value={() => entry().helpText ?? ""}
                onInput={(value) => props.updateEntry({ helpText: value.trim() === "" ? undefined : value })}
                placeholder="Extra context for visitors"
                multiline
                lines={2}
              />
            </div>
            <InlineCreateEditor field={props.field()!} entry={entry()} onChange={(patch) => props.updateEntry(patch)} />
          </>
        )}
      </Show>

      <Show when={props.valueEntry()}>
        {(entry) => (
          <>
            <div class="info-block-info text-xs">This field is hidden from visitors. Every submission stores the fixed value below.</div>
            <FieldInput
              field={props.field()!}
              entry={{ kind: "user_input", fieldId: props.field()!.id, required: false }}
              value={entry().value}
              onChange={props.updateFormValue}
            />
          </>
        )}
      </Show>
    </>
  );
}

const cloneFormFieldEntry = (entry: FormFieldEntry): FormFieldEntry => {
  if (entry.kind === "form_value") return { ...entry };
  return {
    ...entry,
    inlineCreate: entry.inlineCreate
      ? {
          enabled: entry.inlineCreate.enabled,
          fields: (entry.inlineCreate.fields ?? []).map((field) => ({ ...field })),
        }
      : undefined,
  };
};

const openFormFieldSettingsDialog = (args: { entry: FormFieldEntry; field: Field }) =>
  dialogCore.open<FormFieldEntry | null>((close) => {
    const [draft, setDraft] = createSignal<FormFieldEntry>(cloneFormFieldEntry(args.entry));
    const userEntry = createMemo(() =>
      draft().kind === "user_input" ? (draft() as Extract<FormFieldEntry, { kind: "user_input" }>) : null,
    );
    const valueEntry = createMemo(() =>
      draft().kind === "form_value" ? (draft() as Extract<FormFieldEntry, { kind: "form_value" }>) : null,
    );
    const updateEntry = (patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => {
      setDraft((current) => (current.kind === "user_input" ? { ...current, ...patch } : current));
    };
    const updateFormValue = (value: unknown) => {
      setDraft((current) => (current.kind === "form_value" ? { ...current, value } : current));
    };

    return (
      <PanelDialog>
        <PanelDialog.Header
          title={`Field settings — ${args.field.name}`}
          icon={fieldTypeIcon(args.field.type, args.field.icon)}
          close={() => close(null)}
        />
        <PanelDialog.Body>
          <FormFieldSettings
            entry={draft}
            field={() => args.field}
            userEntry={userEntry}
            valueEntry={valueEntry}
            updateEntry={updateEntry}
            updateFormValue={updateFormValue}
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span class="text-[11px] text-dimmed">Confirm stages the field settings. Use the main form Save to persist.</span>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-input btn-sm" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={() => close(cloneFormFieldEntry(draft()))}>
              Confirm
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);

const chooseFormFieldEntryKind = (field: Field) =>
  prompts.dialog<"user_input" | "form_value">(
    (close) => (
      <div class="flex flex-col gap-4">
        <div class="info-block-info text-xs">
          <p class="font-semibold">How should "{field.name}" be used?</p>
          <p class="mt-1">
            Form field means the visitor fills it in. Fixed value means the visitor never sees it; every submission stores the value you
            configure next.
          </p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={() => close("form_value")}>
            <i class="ti ti-lock" /> Add fixed value
          </button>
          <button type="button" class="btn-primary btn-sm" onClick={() => close("user_input")}>
            <i class="ti ti-pencil" /> Add form field
          </button>
        </div>
      </div>
    ),
    { title: "Add field", icon: fieldTypeIcon(field.type, field.icon), size: "small" },
  );
function InlineCreateEditor(props: {
  field: Field;
  entry: Extract<FormFieldEntry, { kind: "user_input" }> | null;
  onChange: (patch: Partial<Extract<FormFieldEntry, { kind: "user_input" }>>) => void;
}) {
  const targetTableId = () =>
    props.field.type === "relation" ? (props.field.config as { targetTableId?: string }).targetTableId : undefined;
  const [targetFields, setTargetFields] = createSignal<Field[]>([]);

  createEffect(() => {
    const tableId = targetTableId();
    setTargetFields([]);
    if (!tableId) return;
    void (async () => {
      const res = await apiClient.fields["by-table"][":tableId"].$get({ param: { tableId } });
      if (res.ok && targetTableId() === tableId) setTargetFields(await res.json());
    })();
  });

  const enabled = () => Boolean(props.entry?.inlineCreate?.enabled);
  const selectedFieldIds = () => (props.entry?.inlineCreate?.fields ?? []).map((entry) => entry.fieldId);
  const candidateFields = createMemo(() =>
    targetFields().filter((field) => !field.deletedAt && isRecordInputField(field.type) && field.type !== "relation"),
  );
  const fieldOption = (field: Field) => ({
    id: field.id,
    label: field.name,
    description: TYPE_LABELS[field.type] ?? field.type,
    icon: fieldTypeIcon(field.type, field.icon),
  });
  const candidateOptions = createMemo(() => candidateFields().map(fieldOption));
  const selectedInlineOptions = createMemo(() =>
    selectedFieldIds()
      .map((fieldId) => targetFields().find((field) => field.id === fieldId))
      .filter((field): field is Field => Boolean(field))
      .map(fieldOption),
  );

  const setEnabled = (next: boolean) => {
    props.onChange(
      next
        ? {
            inlineCreate: {
              enabled: true,
              fields:
                props.entry?.inlineCreate?.fields ??
                candidateFields()
                  .slice(0, 1)
                  .map((field) => ({ fieldId: field.id, required: field.required })),
            },
          }
        : { inlineCreate: undefined },
    );
  };

  const setInlineFieldIds = (ids: string[]) => {
    const fieldById = new Map(candidateFields().map((field) => [field.id, field]));
    props.onChange({
      inlineCreate: {
        enabled: true,
        fields: ids
          .map((fieldId) => {
            const field = fieldById.get(fieldId);
            return field ? { fieldId, required: field.required } : null;
          })
          .filter((entry): entry is { fieldId: string; required: boolean } => Boolean(entry)),
      },
    });
  };

  return (
    <Show when={targetTableId()}>
      <div class="paper mt-1 flex flex-col gap-2 p-3">
        <Checkbox
          label="Create related records inline"
          description="Let this form create the linked record together with the main record. Nothing is saved until submit."
          value={enabled}
          onChange={setEnabled}
        />
        <Show when={enabled()}>
          <MultiSelectInput
            label="Inline fields"
            description="Fields shown for the new linked record."
            placeholder="Pick fields..."
            icon="ti ti-columns"
            value={selectedFieldIds}
            onChange={setInlineFieldIds}
            options={candidateOptions()}
            selectedOptions={selectedInlineOptions}
            clearable
          />
        </Show>
      </div>
    </Show>
  );
}
