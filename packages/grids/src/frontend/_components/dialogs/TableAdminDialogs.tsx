import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import { Checkbox, CopyButton, dialogCore, IconInput, navigateTo, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form, Table } from "../../service";
import { errorMessage } from "./api-helpers";
import { GridsBareDialog, gridsBareDialogOptions } from "./dialog-layout";
import FormsManager from "./FormsManager";
import { defaultConfigForType, TYPE_LABELS, TYPE_OPTIONS } from "./field-config-editor";
import { openFieldEditDialog, type TableHeader, TablePermissions } from "./TableFieldDialogs";

export const openTableSettingsDialog = (args: {
  table: TableHeader;
  initialAccessEntries: AccessEntry[];
  onSaved: (table: Table) => void;
  onDeleted?: () => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <GridsBareDialog title={`Table settings — ${args.table.name}`} icon="ti ti-settings" close={() => close()}>
        <TableSettingsBody
          table={args.table}
          initialAccessEntries={args.initialAccessEntries}
          onSaved={args.onSaved}
          onDeleted={args.onDeleted}
          onCancel={() => close()}
        />
      </GridsBareDialog>
    ),
    gridsBareDialogOptions,
  );

export const openFieldManagerDialog = (args: {
  table: TableHeader;
  fields: Field[];
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onFieldsChanged: (fields: Field[]) => void;
}) =>
  dialogCore.open<void>(
    (close) => (
      <GridsBareDialog title={`Fields — ${args.table.name}`} icon="ti ti-columns-3" close={() => close()}>
        <FieldManagerBody {...args} />
      </GridsBareDialog>
    ),
    gridsBareDialogOptions,
  );

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
  return (await res.json()) as Field;
};

const FIELD_TYPE_ICONS: Record<string, string> = {
  text: "ti ti-typography",
  longtext: "ti ti-align-left",
  number: "ti ti-number",
  decimal: "ti ti-currency-euro",
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
  number: "42",
  decimal: "19.99 EUR",
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
  number: "Numeric values with optional limits.",
  decimal: "Money-safe numbers with fixed decimals.",
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
            <For each={TYPE_OPTIONS}>
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
      <GridsBareDialog title={`Forms — ${args.tableName}`} icon="ti ti-forms" close={() => close()}>
        <FormsManager
          tableId={args.tableId}
          fields={args.fields}
          initialForms={args.initialForms}
          initialFormAccessEntries={args.initialFormAccessEntries}
          onFormsChanged={args.onFormsChanged}
          canManage
        />
      </GridsBareDialog>
    ),
    gridsBareDialogOptions,
  );

export const deleteFieldWithChecks = async (field: Field): Promise<boolean> => {
  const depsRes = await apiClient.fields[":fieldId"].dependents.$get({ param: { fieldId: field.id } });
  if (depsRes.ok) {
    const deps = (await depsRes.json()) as {
      hasBlocking: boolean;
      dependents: Array<{ type: string; resourceName: string; blocking: boolean }>;
    };
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
      return (await res.json()) as Table;
    },
    onSuccess: (next) => {
      setDirty(false);
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
    const ok = await prompts.confirm(
      `Permanently delete "${name()}" and all of its fields, records, files, and audit history. This cannot be undone.`,
      { title: "Delete table?", variant: "danger", confirmText: "Delete" },
    );
    if (ok) deleteMut.mutate(undefined);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <section class="paper p-4">
          <header class="mb-2 flex items-start gap-2">
            <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
              <i class="ti ti-id text-sm" />
            </span>
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Identity</h3>
              <p class="mt-0.5 text-[11px] leading-snug text-dimmed">Name and description shown around this table.</p>
            </div>
          </header>
          <div class="flex flex-col gap-3">
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
              label="Use forms for new records"
              description="Users add records through forms by default. Admins can still manage table structure here."
              value={disableDirectInsert}
              onChange={wrap(setDisableDirectInsert)}
            />
          </div>
        </section>

        <section class="paper p-4">
          <header class="mb-2 flex items-start gap-2">
            <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
              <i class="ti ti-lock text-sm" />
            </span>
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-secondary">Permissions</h3>
              <p class="mt-0.5 text-[11px] leading-snug text-dimmed">Table grants override base grants for this table.</p>
            </div>
          </header>
          <TablePermissions tableId={props.table.id} initialEntries={props.initialAccessEntries} />
        </section>

        <section class="paper p-4 border-red-200/70 dark:border-red-900/60">
          <header class="mb-2 flex items-start gap-2">
            <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-500 dark:bg-red-950/40">
              <i class="ti ti-trash text-sm" />
            </span>
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-[0.12em] text-red-500">Danger zone</h3>
              <p class="mt-0.5 text-[11px] leading-snug text-dimmed">Delete the table and all dependent data.</p>
            </div>
          </header>
          <button type="button" class="btn-danger btn-sm" onClick={deleteTable} disabled={deleteMut.loading()}>
            <i class="ti ti-trash" /> Delete table
          </button>
        </section>
      </div>

      <div class="paper flex shrink-0 items-center justify-end gap-2 p-4">
        <button type="button" class="btn-input btn-sm" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={() => saveMut.mutate(undefined)} disabled={!dirty() || saveMut.loading()}>
          {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </div>
    </div>
  );
}

function FieldManagerBody(props: {
  table: TableHeader;
  fields: Field[];
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onFieldsChanged: (fields: Field[]) => void;
}) {
  const [fields, setFields] = createSignal([...props.fields].sort((a, b) => a.position - b.position));

  const updateFields = (next: Field[]) => {
    setFields(next);
    props.onFieldsChanged(next);
  };

  const reorderMut = mutations.create<void, string[]>({
    mutation: async (fieldIds) => {
      const res = await apiClient.fields["by-table"][":tableId"].reorder.$post({
        param: { tableId: props.table.id },
        json: { fieldIds },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to reorder fields"));
    },
    onError: (e) => prompts.error(e.message),
  });

  const moveField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    const next = [...fields()];
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateFields(next);
    reorderMut.mutate(next.map((f) => f.id));
  };

  const deleteField = async (field: Field) => {
    if (await deleteFieldWithChecks(field)) updateFields(fields().filter((f) => f.id !== field.id));
  };

  const editField = (field: Field) => {
    openFieldEditDialog({
      field,
      otherTables: props.otherTables,
      fieldsByTable: { ...props.fieldsByTable, [props.table.id]: fields() },
      onSaved: (updated) => updateFields(fields().map((f) => (f.id === updated.id ? updated : f))),
      onDeleted: () => deleteField(field),
    });
  };

  const addField = async () => {
    const created = await createFieldFromPrompt({ table: props.table });
    if (!created) return;
    updateFields([...fields(), created]);
    editField(created);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <Show when={fields().length > 0} fallback={<p class="paper p-4 text-xs text-dimmed">No fields yet.</p>}>
        <ul class="flex flex-col gap-2">
          <For each={fields()}>
            {(field, index) => (
              <li class="group paper transition-colors hover:bg-zinc-50 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-600 dark:hover:bg-zinc-800/40">
                <div class="flex min-h-12 items-center gap-2 px-3 py-2">
                  <div class="flex w-6 shrink-0 flex-col items-center">
                    <button
                      type="button"
                      class="flex h-4 w-6 items-center justify-center text-dimmed transition-colors hover:text-blue-500 disabled:opacity-30"
                      onClick={() => moveField(index(), -1)}
                      disabled={index() === 0 || reorderMut.loading()}
                      title="Move up"
                      aria-label="Move up"
                    >
                      <i class="ti ti-chevron-up text-xs" />
                    </button>
                    <button
                      type="button"
                      class="flex h-4 w-6 items-center justify-center text-dimmed transition-colors hover:text-blue-500 disabled:opacity-30"
                      onClick={() => moveField(index(), 1)}
                      disabled={index() === fields().length - 1 || reorderMut.loading()}
                      title="Move down"
                      aria-label="Move down"
                    >
                      <i class="ti ti-chevron-down text-xs" />
                    </button>
                  </div>
                  <button
                    type="button"
                    class="flex min-h-8 flex-1 min-w-0 items-center gap-2 text-left focus:outline-none focus-visible:outline-none"
                    onClick={() => editField(field)}
                  >
                    <Show when={field.icon}>{(icon) => <i class={`${icon()} text-sm text-dimmed shrink-0`} />}</Show>
                    <span class="text-sm font-semibold text-primary truncate">{field.name}</span>
                    <span class="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-dimmed dark:bg-zinc-800">
                      {TYPE_LABELS[field.type] ?? field.type}
                    </span>
                    <Show when={field.required}>
                      <span class="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        required
                      </span>
                    </Show>
                    <Show when={field.presentable}>
                      <span class="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        label
                      </span>
                    </Show>
                  </button>
                  <div class="flex shrink-0 items-center gap-0">
                    <button type="button" class="icon-btn" onClick={() => editField(field)} title="Edit field" aria-label="Edit field">
                      <i class="ti ti-pencil" />
                    </button>
                    <CopyButton
                      text={`#${field.shortId}`}
                      label="Copy ref"
                      class="btn-simple btn-sm shrink-0 !text-zinc-400 hover:!text-zinc-700 dark:!text-zinc-500 dark:hover:!text-zinc-200"
                    />
                  </div>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <button type="button" class="btn-input btn-input-sm self-start text-emerald-600 hover:text-emerald-700" onClick={addField}>
        <i class="ti ti-plus" /> Add field
      </button>
    </div>
  );
}
