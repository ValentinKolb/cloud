import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  Checkbox,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  navigateTo,
  panelDialogOptions,
  PanelDialog,
  prompts,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form, Table } from "../../../service";
import { defaultConfigForType, TYPE_LABELS, TYPE_OPTIONS } from "../fields/field-config-editor";
import { type TableHeader, TablePermissions } from "../fields/TableFieldDialogs";
import FormsManager from "../forms/FormsManager";
import { errorMessage } from "../utils/api-helpers";

export const openTableSettingsDialog = (args: {
  table: TableHeader;
  initialAccessEntries: AccessEntry[];
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
}) => dialogCore.open<void>((close) => <TableSettingsDialog args={args} close={close} />, panelDialogOptions);

function TableSettingsDialog(props: {
  args: { table: TableHeader; initialAccessEntries: AccessEntry[]; onSaved: (table: Table) => void; onDeleted?: () => void };
  close: () => void;
}) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <PanelDialog>
      <PanelDialog.Header title={`Table settings — ${props.args.table.name}`} icon="ti ti-settings" close={closeIfClean} />
      <TableSettingsBody
        table={props.args.table}
        initialAccessEntries={props.args.initialAccessEntries}
        onDirtyChange={setDirty}
        onSaved={(table) => {
          setDirty(false);
          props.args.onSaved(table);
        }}
        onDeleted={props.args.onDeleted}
        onCancel={closeIfClean}
      />
    </PanelDialog>
  );
}

export const createFieldFromPrompt = async (args: { table: TableHeader }): Promise<Field | null> => {
  const type = await chooseFieldType();
  if (!type) return null;

  const result = await prompts.form({
    title: `Add ${TYPE_LABELS[type] ?? "field"}`,
    icon: FIELD_TYPE_ICONS[type] ?? "ti ti-plus",
    fields: {
      name: { type: "text", label: "Name", required: true, placeholder: "e.g. Status" },
    },
    confirmText: "Create",
    size: "small",
  });
  if (!result) return null;
  const name = String(result.name).trim();
  const res = await apiClient.fields["by-table"][":tableId"].$post({
    param: { tableId: args.table.id },
    json: { name, type, config: defaultConfigForType(type) },
  });
  if (!res.ok) {
    prompts.error(await errorMessage(res, "Failed to create field"));
    return null;
  }
  return res.json();
};

const FIELD_TYPE_ICONS: Record<string, string> = {
  text: "ti ti-typography",
  longtext: "ti ti-align-left",
  number: "ti ti-number",
  boolean: "ti ti-toggle-left",
  date: "ti ti-calendar",
  select: "ti ti-list-details",
  autonumber: "ti ti-sort-ascending-numbers",
  percent: "ti ti-percentage",
  duration: "ti ti-clock-hour-4",
  json: "ti ti-braces",
  file: "ti ti-paperclip",
  relation: "ti ti-hierarchy",
  lookup: "ti ti-arrow-up-right",
  rollup: "ti ti-math-function",
  formula: "ti ti-function",
};

const FIELD_TYPE_EXAMPLES: Record<string, string> = {
  text: "Book title",
  longtext: "Internal notes in Markdown",
  number: "19.99 EUR",
  boolean: "Yes / no",
  date: "2026-05-15",
  select: "Status: shipped",
  autonumber: "INV-00042",
  percent: "12.5%",
  duration: "01:30:00",
  json: '{ "raw": true }',
  file: "invoice.pdf",
  relation: "Customer -> Orders",
  lookup: "Customer email",
  rollup: "Sum order total",
  formula: "price * qty",
};

const FIELD_TYPE_PICKER_DESCRIPTIONS: Record<string, string> = {
  text: "Short values like names, titles, or codes.",
  longtext: "Paragraphs, notes, or Markdown content.",
  number: "Decimal-safe numbers with optional limits, units, and fixed places.",
  boolean: "A simple yes/no checkbox.",
  date: "Calendar dates, optionally with time.",
  select: "One or more options from a fixed list.",
  autonumber: "Generated sequence for each record.",
  percent: "Percent values from 0 to 100.",
  duration: "Lengths of time in seconds or HH:MM:SS.",
  json: "Structured data when no type fits.",
  file: "Small files stored in Postgres.",
  relation: "Links to records in another table.",
  lookup: "Shows a value from a linked record.",
  rollup: "Aggregates values through a relation.",
  formula: "Computes a value from other fields.",
};

const CREATE_TYPE_OPTIONS = TYPE_OPTIONS.filter((type) => type.value !== "json");

const chooseFieldType = () =>
  prompts.dialog<string>(
    (close) => (
      <div class="max-h-[86vh] overflow-y-auto">
        <div class="flex flex-col gap-2">
          <section class="paper p-4">
            <div class="flex items-start gap-3">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-dimmed dark:bg-zinc-800">
                <i class="ti ti-plus text-lg" />
              </span>
              <div class="min-w-0">
                <h2 class="text-lg font-semibold">Choose field type</h2>
                <p class="mt-1 text-sm text-secondary">Pick the basic data shape first. You can tune details after the field exists.</p>
              </div>
              <button type="button" class="icon-btn ml-auto" onClick={() => close(undefined)} aria-label="Close">
                <i class="ti ti-x" />
              </button>
            </div>
          </section>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <For each={CREATE_TYPE_OPTIONS}>
              {(type) => (
                <button
                  type="button"
                  class="paper p-3 text-left transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-900"
                  onClick={() => close(type.value)}
                >
                  <div class="flex items-start gap-3">
                    <span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
                      <i class={`${FIELD_TYPE_ICONS[type.value] ?? "ti ti-database"} text-base`} />
                    </span>
                    <div class="min-w-0">
                      <div class="text-sm font-semibold text-primary">{type.label}</div>
                      <div class="mt-1 truncate text-xs font-medium text-secondary">{FIELD_TYPE_EXAMPLES[type.value] ?? "Value"}</div>
                      <p class="mt-1 text-xs leading-snug text-dimmed">
                        {FIELD_TYPE_PICKER_DESCRIPTIONS[type.value] ?? "Store this value on each record."}
                      </p>
                    </div>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    ),
    { surface: "bare", header: false, size: "large" },
  );

export const openFormsDialog = (args: {
  tableId: string;
  tableName: string;
  fields: Field[];
  initialForms: Form[];
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  onFormsChanged?: (forms: Form[]) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title={`Forms — ${args.tableName}`} icon="ti ti-forms" close={() => close()} />
        <PanelDialog.Body>
          <FormsManager
            tableId={args.tableId}
            fields={args.fields}
            initialForms={args.initialForms}
            initialFormAccessEntries={args.initialFormAccessEntries}
            onFormsChanged={args.onFormsChanged}
            canManage
          />
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

export const deleteFieldWithChecks = async (field: Field): Promise<boolean> => {
  const depsRes = await apiClient.fields[":fieldId"].dependents.$get({ param: { fieldId: field.id } });
  if (depsRes.ok) {
    const deps = await depsRes.json();
    if (deps.hasBlocking) {
      const blockers = deps.dependents
        .filter((d) => d.blocking)
        .map((d) => `• ${d.type}: ${d.resourceName}`)
        .join("\n");
      prompts.error(`Cannot delete — remove these references first:\n\n${blockers}`);
      return false;
    }
  }
  const confirmed = await prompts.confirm(`Soft-delete "${field.name}"? Records keep their data; the column is hidden from the UI.`, {
    title: "Delete field?",
    variant: "danger",
    confirmText: "Delete",
  });
  if (!confirmed) return false;
  const res = await apiClient.fields[":fieldId"].$delete({ param: { fieldId: field.id } });
  if (res.status >= 400) {
    prompts.error(await errorMessage(res, "Failed to delete field"));
    return false;
  }
  return true;
};

function TableSettingsBody(props: {
  table: TableHeader;
  initialAccessEntries: AccessEntry[];
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal(props.table.name);
  const [description, setDescription] = createSignal(props.table.description ?? "");
  const [icon, setIcon] = createSignal(props.table.icon ?? "");
  const [disableDirectInsert, setDisableDirectInsert] = createSignal(props.table.disableDirectInsert);
  const [dirty, setDirty] = createSignal(false);
  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
      props.onDirtyChange?.(true);
    };

  const saveMut = mutations.create<Table, void>({
    mutation: async () => {
      const trimmed = name().trim();
      if (!trimmed) throw new Error("Name is required");
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: {
          name: trimmed,
          description: description().trim() || null,
          icon: icon() || null,
          disableDirectInsert: disableDirectInsert(),
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table"));
      return res.json();
    },
    onSuccess: (next) => {
      setDirty(false);
      props.onDirtyChange?.(false);
      props.onSaved(next);
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({ param: { tableId: props.table.id } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => {
      props.onDeleted?.();
      navigateTo(`/app/grids/${props.table.baseShortId}`);
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteTable = async () => {
    const ok = await prompts.confirm(`Delete "${name()}" and move its fields, records, files, and audit history out of the active app.`, {
      title: "Delete table?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (ok) deleteMut.mutate(undefined);
  };

  return (
    <>
      <PanelDialog.Body>
        <PanelDialog.Section title="Identity" subtitle="Name and description shown around this table." icon="ti ti-id">
          <TextInput label="Name" value={name} onInput={wrap(setName)} icon="ti ti-typography" required />
          <IconInput label="Icon" value={icon} onChange={wrap(setIcon)} placeholder="Search icons..." />
          <TextInput
            label="Description"
            value={description}
            onInput={wrap(setDescription)}
            icon="ti ti-align-left"
            multiline
            lines={2}
            placeholder="Optional"
          />
          <Checkbox
            label="Add records through forms"
            description="New records use forms by default. Admins can still edit the table directly."
            value={disableDirectInsert}
            onChange={wrap(setDisableDirectInsert)}
          />
        </PanelDialog.Section>

        <PanelDialog.Section title="Permissions" subtitle="These permissions apply only to this table." icon="ti ti-lock">
          <TablePermissions tableId={props.table.id} initialEntries={props.initialAccessEntries} />
        </PanelDialog.Section>

        <PanelDialog.Section title="Danger zone" subtitle="Remove this table from the active app." icon="ti ti-trash">
          <button type="button" class="btn-danger btn-sm" onClick={deleteTable} disabled={deleteMut.loading()}>
            <i class="ti ti-trash" /> Delete table
          </button>
        </PanelDialog.Section>
      </PanelDialog.Body>

      <PanelDialog.Footer>
        <span />
        <div class="flex items-center justify-end gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => saveMut.mutate(undefined)}
            disabled={!dirty() || saveMut.loading()}
          >
            {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </div>
      </PanelDialog.Footer>
    </>
  );
}
