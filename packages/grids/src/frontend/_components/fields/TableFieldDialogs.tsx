import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { CheckboxCard, dialogCore, IconInput, PermissionEditor, prompts, Select, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, type JSX, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ColumnSpec } from "../../../contracts";
import type { Field } from "../../../service";
import { confirmDiscardIfDirty, GridsBareDialog, gridsBareDialogOptions } from "../dialogs/dialog-layout";
import { ColumnFormatControls, type ColumnFormatControlsHandle } from "../dialogs/ViewColumnSettingsDialog";
import { FieldInput } from "../forms/form-fields";
import { errorMessage } from "../utils/api-helpers";
import { FIELD_TYPE_DESCRIPTIONS, FieldConfigEditor, type FieldConfigState, TYPE_LABELS } from "./field-config-editor";

export type TableHeader = {
  id: string;
  /** UUID of the parent base. Kept for API calls that still take UUIDs. */
  baseId: string;
  /** URL-safe slug of the parent base. Used for href construction. */
  baseShortId: string;
  /** URL-safe slug of this table. Used for href construction. */
  shortId: string;
  name: string;
  description: string | null;
  icon?: string | null;
  columns: ColumnSpec[];
  disableDirectInsert: boolean;
};

// =============================================================================
// openFieldEditDialog — open FieldEditor inside a centered modal
// =============================================================================
//
// Previously the field editor expanded inline below each card. With many
// fields configured, the page grew to several screens tall and the user
// lost track of where they were while scrolling through configs. A modal
// gives clear focus, a fixed viewport, and a single visible thing at a
// time — matches Airtable's mental model.
//
// The dialog body re-uses the existing `FieldEditor` component verbatim;
// only the chrome (header, panel sizing, backdrop) lives here. Save /
// delete close the dialog after the parent's state-update callbacks
// fire, so the page list reflects the change immediately.

type OpenFieldEditArgs = {
  field: Field;
  baseShortId?: string;
  tableShortId?: string;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  tableColumns?: ColumnSpec[];
  onSaved: (next: Field) => void;
  onTableColumnsSaved?: (columns: ColumnSpec[]) => void;
  onDeleted: () => Promise<void> | void;
};

export const openFieldEditDialog = (args: OpenFieldEditArgs): Promise<void> =>
  dialogCore.open<void>((close) => <FieldEditDialog args={args} close={close} />, gridsBareDialogOptions);

function FieldEditDialog(props: { args: OpenFieldEditArgs; close: () => void }) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <GridsBareDialog title={`Edit field — ${props.args.field.name}`} icon="ti ti-pencil" close={closeIfClean}>
      <FieldEditor
        field={props.args.field}
        baseShortId={props.args.baseShortId}
        tableShortId={props.args.tableShortId}
        otherTables={props.args.otherTables}
        fieldsByTable={props.args.fieldsByTable}
        tableColumns={props.args.tableColumns}
        onDirtyChange={setDirty}
        onSaved={(next) => {
          setDirty(false);
          props.args.onSaved(next);
          props.close();
        }}
        onTableColumnsSaved={props.args.onTableColumnsSaved}
        onDeleted={async () => {
          await props.args.onDeleted();
          props.close();
        }}
        onCancel={closeIfClean}
      />
    </GridsBareDialog>
  );
}

// =============================================================================
// FieldEditor — body of the field-edit modal
// =============================================================================

function FieldEditor(props: {
  field: Field;
  baseShortId?: string;
  tableShortId?: string;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  tableColumns?: ColumnSpec[];
  onSaved: (next: Field) => void;
  onTableColumnsSaved?: (columns: ColumnSpec[]) => void;
  onDeleted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Optional cancel handler — only set when the editor is rendered
   *  inside a dialog. The footer adds a "Cancel" button next to Save
   *  so users have a clear way out without triggering a save. */
  onCancel?: () => void;
}) {
  const [name, setName] = createSignal(props.field.name);
  const [description, setDescription] = createSignal(props.field.description ?? "");
  const [icon, setIcon] = createSignal(props.field.icon ?? "");
  const [required, setRequired] = createSignal(props.field.required);
  const [presentable, setPresentable] = createSignal(props.field.presentable);
  const [hideInTable, setHideInTable] = createSignal(props.field.hideInTable);
  const [defaultValue, setDefaultValue] = createSignal<unknown>(props.field.defaultValue);
  const [dateDefaultMode, setDateDefaultMode] = createSignal<"none" | "fixed" | "now">(
    props.field.type === "date" &&
      typeof props.field.defaultValue === "object" &&
      props.field.defaultValue !== null &&
      (props.field.defaultValue as { kind?: unknown }).kind === "now"
      ? "now"
      : props.field.defaultValue === null || props.field.defaultValue === undefined
        ? "none"
        : "fixed",
  );
  const [indexed, setIndexed] = createSignal(props.field.indexed);
  const [uniqueConstraint, setUniqueConstraint] = createSignal(props.field.uniqueConstraint);
  const [config, setConfig] = createSignal<FieldConfigState>((props.field.config as FieldConfigState) ?? {});
  const initialColumn = () => props.tableColumns?.find((column) => column.fieldId === props.field.id);
  const [columnLabel, setColumnLabel] = createSignal(initialColumn()?.label ?? "");
  let formatControls: ColumnFormatControlsHandle | undefined;
  const [dirty, setDirty] = createSignal(false);
  const supportsDefaultValue = () => props.field.type !== "file";

  // Touch-tracker — any field-level edit flips the dirty bit.
  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
      props.onDirtyChange?.(true);
    };

  const cleanColumn = (column: ColumnSpec): ColumnSpec => ({
    fieldId: column.fieldId,
    ...(column.label?.trim() ? { label: column.label.trim() } : {}),
    ...(column.format ? { format: column.format } : {}),
  });

  const buildNextTableColumns = (): ColumnSpec[] | undefined => {
    if (!props.tableColumns) return undefined;
    const nextColumn = cleanColumn({
      fieldId: props.field.id,
      label: columnLabel(),
      format: formatControls?.value(),
    });
    const next = props.tableColumns.filter((column) => column.fieldId !== props.field.id);
    if (!hideInTable()) {
      const existingIndex = props.tableColumns.findIndex((column) => column.fieldId === props.field.id);
      if (existingIndex >= 0) next.splice(existingIndex, 0, nextColumn);
      else next.push(nextColumn);
    }
    return next.map(cleanColumn);
  };

  const updateMut = mutations.create<{ field: Field; tableColumns?: ColumnSpec[] }, void>({
    mutation: async () => {
      const res = await apiClient.fields[":fieldId"].$patch({
        param: { fieldId: props.field.id },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          icon: icon().trim() || null,
          required: required(),
          presentable: presentable(),
          hideInTable: hideInTable(),
          defaultValue: supportsDefaultValue() ? defaultValue() : null,
          indexed: indexed(),
          uniqueConstraint: uniqueConstraint(),
          config: config() as Record<string, unknown>,
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save field"));
      const field = await res.json();
      const nextTableColumns = buildNextTableColumns();
      if (!nextTableColumns) return { field };
      if (JSON.stringify(nextTableColumns) === JSON.stringify(props.tableColumns)) return { field };
      const tableRes = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.field.tableId },
        json: { columns: nextTableColumns },
      });
      if (!tableRes.ok) throw new Error(await errorMessage(tableRes, "Failed to save table display"));
      const table = await tableRes.json();
      return { field, tableColumns: table.columns };
    },
    onSuccess: (next) => {
      setDirty(false);
      props.onDirtyChange?.(false);
      if (next.tableColumns) props.onTableColumnsSaved?.(next.tableColumns);
      props.onSaved(next.field);
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleSave = () => {
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    updateMut.mutate(undefined);
  };

  const typeLabel = TYPE_LABELS[props.field.type] ?? props.field.type;
  const typeDescription = FIELD_TYPE_DESCRIPTIONS[props.field.type];

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {/* Type primer — short, type-specific blurb so the constraint
          inputs further down ("precision", "decimal places", "regex" etc.) make
          immediate sense to non-power users. */}
        <Show when={typeDescription}>
          <div class="info-block-info text-xs flex items-start gap-2">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span>{typeDescription}</span>
          </div>
        </Show>

        <FieldEditorSection title="Identity" subtitle="How this field appears in tables, forms, and detail panels." icon="ti ti-id">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextInput
              label="Name"
              description="Used as the column header and default form label."
              value={name}
              onInput={wrap(setName)}
              icon="ti ti-typography"
              required
            />
            <TextInput
              label="Datatype"
              description="Field types can't be changed after creation."
              icon="ti ti-category"
              value={() => typeLabel}
              disabled
            />
          </div>

          <TextInput
            label="Description (optional)"
            description="Shown in forms and record details."
            value={description}
            onInput={wrap(setDescription)}
            icon="ti ti-info-circle"
            multiline
            lines={2}
            placeholder="e.g. Use the ISO-639-1 language code"
          />

          <IconInput label="Icon (optional)" value={icon} onChange={wrap(setIcon)} placeholder="Search icons..." />
        </FieldEditorSection>

        <FieldEditorSection
          title="Record behavior"
          subtitle="Rules that affect how users create, read, and reference records."
          icon="ti ti-toggle-right"
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <CheckboxCard
              label="Required"
              description="Every record must have a value for this field."
              icon="ti ti-asterisk"
              value={required}
              onChange={wrap(setRequired)}
            />
            <CheckboxCard
              label="Use as record label"
              description="Show this field when another table links to this record."
              icon="ti ti-tag"
              value={presentable}
              onChange={wrap(setPresentable)}
            />
            <CheckboxCard
              label="Hide in table"
              description="Keep it out of the default table view; detail panels and custom views can still show it."
              icon="ti ti-eye-off"
              value={hideInTable}
              onChange={wrap(setHideInTable)}
            />
            <CheckboxCard
              label="Unique values"
              description="No two records can share the same value. Existing duplicates block saving."
              icon="ti ti-fingerprint"
              value={uniqueConstraint}
              onChange={wrap(setUniqueConstraint)}
            />
          </div>
        </FieldEditorSection>

        <FieldEditorSection title="Query performance" subtitle="Use only for fields that are filtered or sorted often." icon="ti ti-bolt">
          <CheckboxCard
            label="Indexed"
            description="Faster filters and sorts on this field. Costs disk and write work."
            icon="ti ti-database-search"
            value={indexed}
            onChange={wrap(setIndexed)}
          />
        </FieldEditorSection>

        <Show when={props.tableColumns}>
          <FieldEditorSection
            title="Table display"
            subtitle="Default label and cell format in this table. Saved views can override this."
            icon="ti ti-table"
          >
            <TextInput
              label="Table column name"
              description="Empty uses the field name."
              value={columnLabel}
              onInput={wrap(setColumnLabel)}
              icon="ti ti-heading"
              clearable
            />
            <ColumnFormatControls
              field={{
                type: props.field.type,
                config: config() as Record<string, unknown>,
              }}
              currentFormat={initialColumn()?.format}
              expose={(handle) => {
                formatControls = handle;
              }}
              onChange={() => {
                setDirty(true);
                props.onDirtyChange?.(true);
              }}
            />
          </FieldEditorSection>
        </Show>

        <Show when={supportsDefaultValue()}>
          {/* Default value — fills records that don't supply this field on
            create. Renders via the shared FieldInput so the value editor
            matches the field type (NumberInput for number, SelectInput
            for select, etc). Saved as `defaultValue` on the field
            row; null/undefined = no default. */}
          <FieldEditorSection title="Default" subtitle="Optional value used when a create request omits this field." icon="ti ti-file-plus">
            <Show
              when={props.field.type === "date"}
              fallback={
                <FieldInput
                  field={{
                    ...props.field,
                    config: config() as Record<string, unknown>,
                  }}
                  entry={{
                    kind: "user_input",
                    fieldId: props.field.id,
                    required: false,
                  }}
                  value={defaultValue()}
                  onChange={(v) => wrap(setDefaultValue)(v)}
                />
              }
            >
              <Select
                label="Default value"
                value={dateDefaultMode}
                onChange={(v) => {
                  const mode = (v as "none" | "fixed" | "now" | null) ?? "none";
                  setDateDefaultMode(mode);
                  wrap(setDefaultValue)(mode === "now" ? { kind: "now" } : mode === "none" ? null : null);
                }}
                options={[
                  { id: "none", label: "None" },
                  { id: "fixed", label: "Fixed date" },
                  { id: "now", label: "Current date when created" },
                ]}
              />
              <Show when={dateDefaultMode() === "fixed"}>
                <FieldInput
                  field={{
                    ...props.field,
                    config: config() as Record<string, unknown>,
                  }}
                  entry={{
                    kind: "user_input",
                    fieldId: props.field.id,
                    required: false,
                  }}
                  value={defaultValue()}
                  onChange={(v) => wrap(setDefaultValue)(v)}
                />
              </Show>
            </Show>
            <p class="text-[11px] text-dimmed leading-snug">Leave empty when users should choose the value themselves.</p>
          </FieldEditorSection>
        </Show>

        <FieldEditorSection title="Type settings" subtitle="Constraints and options specific to this datatype." icon="ti ti-adjustments">
          <FieldConfigEditor
            currentFieldId={props.field.id}
            type={props.field.type}
            currentTableId={props.field.tableId}
            baseShortId={props.baseShortId}
            tableShortId={props.tableShortId}
            config={config}
            onChange={(next) => {
              setConfig(next);
              setDirty(true);
              props.onDirtyChange?.(true);
            }}
            otherTables={props.otherTables}
            fieldsByTable={props.fieldsByTable}
          />
        </FieldEditorSection>
      </div>

      <div class="paper flex shrink-0 items-center justify-between gap-2 p-4">
        <button type="button" class="btn-simple btn-sm text-red-500 hover:text-red-600" onClick={props.onDeleted}>
          <i class="ti ti-trash" /> Delete field
        </button>
        <div class="flex items-center gap-2">
          <Show when={props.onCancel}>
            <button type="button" class="btn-input btn-sm" onClick={() => props.onCancel?.()}>
              Cancel
            </button>
          </Show>
          <button type="button" class="btn-primary btn-sm" onClick={handleSave} disabled={!dirty() || updateMut.loading()}>
            {updateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditorSection(props: { title: string; subtitle?: string; icon: string; children: JSX.Element }) {
  return (
    <section class="paper p-4">
      <header class="mb-2 flex items-start gap-2">
        <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
          <i class={`${props.icon} text-sm`} />
        </span>
        <div class="min-w-0">
          <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">{props.title}</h3>
          <Show when={props.subtitle}>
            <p class="mt-0.5 text-[11px] leading-snug text-dimmed">{props.subtitle}</p>
          </Show>
        </div>
      </header>
      <div class="flex flex-col gap-3">{props.children}</div>
    </section>
  );
}

// =============================================================================
// TablePermissions — wraps the platform PermissionEditor with table-API wires
// =============================================================================

export function TablePermissions(props: { tableId: string; initialEntries: AccessEntry[] }) {
  const [entries, setEntries] = createSignal<AccessEntry[]>(props.initialEntries);
  return (
    <PermissionEditor
      initialEntries={entries()}
      canEdit
      // Tables only carry read/write — admin (now: base-admin) is
      // managed from the Base settings page. Without this cap the
      // editor would offer 'Manage' which the API now rejects.
      allowedLevels={[
        { level: "read", label: "View" },
        { level: "write", label: "Edit" },
      ]}
      grantAccess={async (principal, permission) => {
        const res = await apiClient.access["by-table"][":tableId"].$post({
          param: { tableId: props.tableId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = await res.json();
        // Re-fetch the canonical list so the new entry has its displayName etc.
        const listRes = await apiClient.access["by-table"][":tableId"].$get({
          param: { tableId: props.tableId },
        });
        const list = listRes.ok ? await listRes.json() : entries();
        setEntries(list);
        return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
      }}
      updateAccess={async (accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
      }}
      revokeAccess={async (accessId) => {
        const res = await apiClient.access[":accessId"].$delete({
          param: { accessId },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}
