import { For, Show, createSignal, createMemo } from "solid-js";
import { apiClient } from "@/api/client";
import {
  Select,
  TextInput,
  prompts,
  refreshCurrentPath,
  navigateTo,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Field, Form, Table } from "../../service";
import { errorMessage } from "./api-helpers";
import FormsManager from "./FormsManager.island";
import {
  FieldConfigEditor,
  TYPE_OPTIONS,
  TYPE_LABELS,
  type FieldConfigState,
  defaultConfigForType,
} from "./field-config-editor";

type Props = {
  table: { id: string; name: string; description: string | null; baseId: string };
  initialFields: Field[];
  initialForms: Form[];
  /** Other tables in the base — needed by relation fields' targetTableId picker. */
  otherTables: Array<{ id: string; name: string }>;
  /** Other tables' fields — needed by relation displayFieldId / lookup-rollup target. */
  fieldsByTable: Record<string, Field[]>;
  canManage: boolean;
};

type Mode = { kind: "list" } | { kind: "field"; fieldId: string | null };

/**
 * Single-island table-editor button + modal. Renders a pencil button; opening
 * it mounts the `TableEditorBody` inside a large dialog with two views:
 *
 *   1. "list"  — general settings (name + description + delete) on top,
 *                fields list below with per-row edit/delete.
 *   2. "field" — slide-in editor for a single field (add or edit).
 *                Includes the FieldConfigEditor for type-specific constraints.
 *
 * State lives inside the dialog body; `refreshCurrentPath()` after each
 * mutation re-renders the SSR table so the page reflects new field configs
 * and lookup/rollup/formula re-enrichment.
 */
export default function TableEditor(props: Props) {
  if (!props.canManage) return null;

  const open = async () => {
    await prompts.dialog<void>(
      (close) => (
        <TableEditorBody
          table={props.table}
          initialFields={props.initialFields}
          initialForms={props.initialForms}
          otherTables={props.otherTables}
          fieldsByTable={props.fieldsByTable}
          onClose={close}
        />
      ),
      { title: `Edit table: ${props.table.name}`, icon: "ti ti-table-options", size: "large" },
    );
    refreshCurrentPath();
  };

  return (
    <button
      type="button"
      class="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-dimmed hover:text-primary p-0.5"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open();
      }}
      title="Edit table"
    >
      <i class="ti ti-edit" />
    </button>
  );
}

// =============================================================================
// Modal body
// =============================================================================

function TableEditorBody(props: {
  table: { id: string; name: string; description: string | null; baseId: string };
  initialFields: Field[];
  initialForms: Form[];
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onClose: (v: void) => void;
}) {
  const [mode, setMode] = createSignal<Mode>({ kind: "list" });
  const [fields, setFields] = createSignal<Field[]>(props.initialFields);

  const editingField = createMemo<Field | null>(() => {
    const m = mode();
    if (m.kind !== "field" || !m.fieldId) return null;
    return fields().find((f) => f.id === m.fieldId) ?? null;
  });

  return (
    <div class="flex flex-col gap-4 min-w-[36rem]">
      <Show when={mode().kind === "list"} fallback={null}>
        <ListView
          table={props.table}
          fields={fields}
          initialForms={props.initialForms}
          onEditField={(fieldId) => setMode({ kind: "field", fieldId })}
          onAddField={() => setMode({ kind: "field", fieldId: null })}
          onFieldsChange={setFields}
          onDeletedTable={() => props.onClose()}
        />
      </Show>
      <Show when={mode().kind === "field"} fallback={null}>
        <FieldView
          tableId={props.table.id}
          field={editingField()}
          otherTables={props.otherTables}
          fieldsByTable={props.fieldsByTable}
          onCancel={() => setMode({ kind: "list" })}
          onSaved={(updated) => {
            const next = fields().some((f) => f.id === updated.id)
              ? fields().map((f) => (f.id === updated.id ? updated : f))
              : [...fields(), updated];
            setFields(next);
            setMode({ kind: "list" });
          }}
        />
      </Show>
    </div>
  );
}

// =============================================================================
// List view: general settings + fields list
// =============================================================================

function ListView(props: {
  table: { id: string; name: string; description: string | null };
  fields: () => Field[];
  initialForms: Form[];
  onEditField: (fieldId: string) => void;
  onAddField: () => void;
  onFieldsChange: (next: Field[]) => void;
  onDeletedTable: () => void;
}) {
  const [name, setName] = createSignal(props.table.name);
  const [description, setDescription] = createSignal(props.table.description ?? "");
  const [hasChanges, setHasChanges] = createSignal(false);

  const update = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setHasChanges(true);
  };

  const updateMut = mutations.create<Table, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: { name: name().trim(), description: description().trim() || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save table"));
      return (await res.json()) as Table;
    },
    onSuccess: () => setHasChanges(false),
    onError: (e) => prompts.error(e.message),
  });

  const deleteTableMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({ param: { tableId: props.table.id } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => {
      props.onDeletedTable();
      navigateTo(`/app/grids/${(props.table as { baseId?: string }).baseId ?? ""}`.replace(/\/$/, ""));
    },
    onError: (e) => prompts.error(e.message),
  });

  const deleteFieldMut = mutations.create<string, Field>({
    mutation: async (field) => {
      const depsRes = await apiClient.fields[":fieldId"].dependents.$get({
        param: { fieldId: field.id },
      });
      if (depsRes.ok) {
        const deps = (await depsRes.json()) as { hasBlocking: boolean; dependents: Array<{ type: string; resourceName: string; blocking: boolean }> };
        if (deps.hasBlocking) {
          const blockers = deps.dependents
            .filter((d) => d.blocking)
            .map((d) => `• ${d.type}: ${d.resourceName}`)
            .join("\n");
          throw new Error(`Cannot delete — remove these references first:\n\n${blockers}`);
        }
      }
      const res = await apiClient.fields[":fieldId"].$delete({ param: { fieldId: field.id } });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete field"));
      return field.id;
    },
    onSuccess: (fieldId) => {
      props.onFieldsChange(props.fields().filter((f) => f.id !== fieldId));
    },
    onError: (e) => prompts.error(e.message),
  });

  const handleSaveTable = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    updateMut.mutate(undefined);
  };

  const handleDeleteTable = async () => {
    const confirmed = await prompts.confirm(
      `Permanently delete "${props.table.name}" and all of its fields, records, and audit history. This cannot be undone.`,
      { title: "Delete table?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteTableMut.mutate(undefined);
  };

  const handleDeleteField = async (field: Field) => {
    const confirmed = await prompts.confirm(
      `Soft-delete field "${field.name}"? Records keep their data; the column is hidden from the UI.`,
      { title: "Delete field?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteFieldMut.mutate(field);
  };

  return (
    <div class="flex flex-col gap-6">
      <section class="flex flex-col gap-3">
        <h3 class="section-label">General</h3>
        <form onSubmit={handleSaveTable} class="flex flex-col gap-3">
          <TextInput
            label="Name"
            value={name}
            onInput={update(setName)}
            icon="ti ti-typography"
            required
          />
          <TextInput
            label="Description"
            value={description}
            onInput={update(setDescription)}
            icon="ti ti-align-left"
            multiline
          />
          <Show when={hasChanges()}>
            <button type="submit" disabled={updateMut.loading()} class="btn-primary btn-sm self-start">
              {updateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
            </button>
          </Show>
        </form>
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h3 class="section-label">Fields</h3>
          <button type="button" class="btn-simple btn-sm text-xs" onClick={props.onAddField}>
            <i class="ti ti-plus" /> Add field
          </button>
        </div>
        <Show
          when={props.fields().length > 0}
          fallback={<div class="text-xs text-dimmed py-2">No fields yet. Click "Add field" above.</div>}
        >
          <ul class="flex flex-col gap-0.5 border-l-2 border-zinc-200 dark:border-zinc-700 pl-3">
            <For each={props.fields()}>
              {(f) => (
                <li class="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <span class="flex items-center gap-2 min-w-0">
                    <span class="truncate text-primary">{f.name}</span>
                    <span class="text-[10px] text-dimmed">{TYPE_LABELS[f.type] ?? f.type}</span>
                  </span>
                  <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      class="text-xs text-dimmed hover:text-primary p-1"
                      onClick={() => props.onEditField(f.id)}
                      title="Edit field"
                    >
                      <i class="ti ti-edit" />
                    </button>
                    <button
                      type="button"
                      class="text-xs text-dimmed hover:text-red-500 p-1"
                      onClick={() => handleDeleteField(f)}
                      title="Delete field"
                    >
                      <i class="ti ti-trash" />
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="flex flex-col gap-3">
        <h3 class="section-label">Forms</h3>
        <FormsManager
          tableId={props.table.id}
          fields={props.fields()}
          initialForms={props.initialForms}
          canManage
        />
      </section>

      <hr class="border-zinc-200 dark:border-zinc-700" />

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-red-500">Danger Zone</h3>
        <button
          type="button"
          class="btn-danger btn-sm self-start"
          onClick={handleDeleteTable}
          disabled={deleteTableMut.loading()}
        >
          <i class="ti ti-trash mr-1" /> Delete table
        </button>
      </section>
    </div>
  );
}

// =============================================================================
// Field view: add or edit a single field
// =============================================================================

function FieldView(props: {
  tableId: string;
  field: Field | null;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onCancel: () => void;
  onSaved: (field: Field) => void;
}) {
  const isNew = () => props.field === null;
  const [name, setName] = createSignal(props.field?.name ?? "");
  // Type is locked once a field exists. New fields default to plain text.
  const [type, setType] = createSignal<string>(props.field?.type ?? "text");
  const [config, setConfig] = createSignal<FieldConfigState>(
    (props.field?.config as FieldConfigState | undefined) ?? defaultConfigForType("text"),
  );

  // Switching the type for a new field: reset config to that type's defaults
  // so we don't carry stale fields between, e.g., decimal precision and rating scale.
  const onTypeChange = (next: string) => {
    setType(next);
    setConfig(defaultConfigForType(next));
  };

  const createMut = mutations.create<Field, void>({
    mutation: async () => {
      const res = await apiClient.fields["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: { name: name().trim(), type: type(), config: config() as Record<string, unknown> },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create field"));
      return (await res.json()) as Field;
    },
    onSuccess: (f) => props.onSaved(f),
    onError: (e) => prompts.error(e.message),
  });

  const updateMut = mutations.create<Field, void>({
    mutation: async () => {
      const res = await apiClient.fields[":fieldId"].$patch({
        param: { fieldId: props.field!.id },
        json: { name: name().trim(), config: config() as Record<string, unknown> },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update field"));
      return (await res.json()) as Field;
    },
    onSuccess: (f) => props.onSaved(f),
    onError: (e) => prompts.error(e.message),
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      prompts.error("Name is required");
      return;
    }
    if (isNew()) createMut.mutate(undefined);
    else updateMut.mutate(undefined);
  };

  const loading = () => createMut.loading() || updateMut.loading();

  return (
    <form onSubmit={handleSubmit} class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="text-dimmed hover:text-primary p-1.5"
          onClick={props.onCancel}
          title="Back"
        >
          <i class="ti ti-arrow-left" />
        </button>
        <h3 class="text-sm font-medium">{isNew() ? "New field" : `Edit field: ${props.field!.name}`}</h3>
      </div>

      <TextInput label="Name" value={name} onInput={setName} icon="ti ti-typography" required />

      <Show
        when={isNew()}
        fallback={
          <div class="flex flex-col gap-1">
            <span class="text-xs text-secondary">Type</span>
            <span class="px-2 py-1.5 text-sm text-dimmed bg-zinc-50 dark:bg-zinc-800/40 rounded-md border border-zinc-200 dark:border-zinc-700">
              {TYPE_LABELS[type()] ?? type()}{" "}
              <span class="text-[10px]">(type can't be changed after creation)</span>
            </span>
          </div>
        }
      >
        <Select
          label="Type"
          value={type}
          onChange={onTypeChange}
          options={TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
        />
      </Show>

      <FieldConfigEditor
        type={type()}
        config={config}
        onChange={setConfig}
        otherTables={props.otherTables}
        fieldsByTable={props.fieldsByTable}
      />

      <div class="flex justify-end gap-2 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <button type="button" class="btn-secondary btn-sm" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" class="btn-primary btn-sm" disabled={loading()}>
          {loading() ? <i class="ti ti-loader-2 animate-spin" /> : isNew() ? "Create field" : "Save"}
        </button>
      </div>
    </form>
  );
}
