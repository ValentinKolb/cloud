import { Checkbox, dialogCore, MultiSelectInput, PanelDialog, panelDialogOptions, TextInput } from "@valentinkolb/cloud/ui";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field } from "../../../service";
import type { FormFieldEntry } from "../../../service/forms";
import { TYPE_LABELS } from "../fields/field-config-editor";
import { isRecordInputField } from "../fields/field-render";
import { fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";
import { FieldInput } from "./form-fields";
export function FormFieldInspector(props: {
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

export const openFormFieldSettingsDialog = (args: { entry: FormFieldEntry; field: Field }) =>
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
