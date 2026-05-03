import { For, Show, createSignal, onCleanup } from "solid-js";
import { apiClient } from "@/api/client";
import {
  PermissionEditor,
  TextInput,
  prompts,
  navigateTo,
  refreshCurrentPath,
} from "@valentinkolb/cloud/ui";
import type { AccessEntry, PermissionLevel, Principal } from "@valentinkolb/cloud/contracts";
import { SectionCard } from "./SectionCard";
import {
  dnd,
  mutation as mutations,
  type DndBuildIntentContext,
} from "@valentinkolb/stdlib/solid";
import type { Field, Form, Table } from "../../service";
import { errorMessage } from "./api-helpers";
import FormsManager from "./FormsManager.island";
import {
  FieldConfigEditor,
  TYPE_OPTIONS,
  TYPE_LABELS,
  FIELD_TYPE_DESCRIPTIONS,
  type FieldConfigState,
  defaultConfigForType,
} from "./field-config-editor";

type TableHeader = {
  id: string;
  baseId: string;
  name: string;
  description: string | null;
};

type Props = {
  table: TableHeader;
  initialFields: Field[];
  initialForms: Form[];
  initialAccessEntries: AccessEntry[];
  /** Other tables in the same base — needed for the relation type's
   *  targetTableId picker. */
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
};

type DragMeta = { fieldId: string };
type DropMeta = { kind: "field"; index: number };
type DropIntent = { insertIndex: number };

/**
 * Full-screen table editor. Three sections stacked top-to-bottom:
 *
 *  1. General — table name + description, save-on-change.
 *  2. Fields — drag-and-drop reorderable list of cards. Each card collapses
 *     to a one-liner; clicking expands it for inline edit (name +
 *     description + type-specific config). Add new field at the bottom.
 *  3. Danger Zone — delete table.
 *
 * DnD uses `@valentinkolb/stdlib/solid`'s `dnd.create` (same module the
 * spaces Kanban uses). Persistence: a single
 * `POST /api/grids/fields/by-table/:tableId/reorder` after each drop.
 */
export default function TableEditPage(props: Props) {
  // -------------------------------------------------------------------
  // General section — table name + description
  // -------------------------------------------------------------------
  const [tName, setTName] = createSignal(props.table.name);
  const [tDesc, setTDesc] = createSignal(props.table.description ?? "");
  const [tDirty, setTDirty] = createSignal(false);

  const setName = (v: string) => {
    setTName(v);
    setTDirty(true);
  };
  const setDesc = (v: string) => {
    setTDesc(v);
    setTDirty(true);
  };

  const updateTableMut = mutations.create<Table, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: { name: tName().trim(), description: tDesc().trim() || null },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return (await res.json()) as Table;
    },
    onSuccess: () => setTDirty(false),
    onError: (e) => prompts.error(e.message),
  });

  const handleTableSave = (e: Event) => {
    e.preventDefault();
    if (!tName().trim()) {
      prompts.error("Name is required");
      return;
    }
    updateTableMut.mutate(undefined);
  };

  // -------------------------------------------------------------------
  // Fields section — reorderable cards with expand/collapse
  // -------------------------------------------------------------------
  const [fields, setFields] = createSignal<Field[]>(
    [...props.initialFields].sort((a, b) => a.position - b.position),
  );
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  // -------------------------------------------------------------------
  // DnD: single list, item-on-item drop targets compute insert index.
  // -------------------------------------------------------------------
  const reorderMut = mutations.create<void, string[]>({
    mutation: async (fieldIds) => {
      const res = await apiClient.fields["by-table"][":tableId"].reorder.$post({
        param: { tableId: props.table.id },
        json: { fieldIds },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to reorder"));
    },
    onError: (e) => prompts.error(e.message),
  });

  const buildIntent = (
    ctx: DndBuildIntentContext<DragMeta, DropMeta, DropIntent>,
  ): DropIntent | null => {
    if (!ctx.over) return null;
    // Pointer below midpoint of the over-card → insert AFTER it.
    const insertIndex =
      ctx.pointer.y <= ctx.over.rect.top + ctx.over.rect.height / 2
        ? ctx.over.meta.index
        : ctx.over.meta.index + 1;
    return { insertIndex };
  };

  const fieldDnd = dnd.create<DragMeta, DropMeta, DropIntent>({
    buildIntent,
    onDrop: ({ active, intent }) => {
      if (!intent) return;
      const list = fields();
      const sourceIdx = list.findIndex((f) => f.id === active.meta.fieldId);
      if (sourceIdx < 0) return;
      // Adjust insert index when moving down within the same list.
      let target = intent.insertIndex;
      if (sourceIdx < target) target -= 1;
      if (target === sourceIdx) return;

      const next = [...list];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(target, 0, moved!);
      setFields(next);
      reorderMut.mutate(next.map((f) => f.id));
    },
  });

  onCleanup(() => fieldDnd.destroy());

  // True when an indicator should appear BEFORE the `index`-th card. We
  // suppress no-op positions (right before / right after the dragged
  // card itself) so the user only sees the indicator at meaningful
  // landing slots. The active drag id is `drag:field:<fieldId>`; we
  // parse it back out to locate the source row.
  const sourceIndex = () => {
    const id = fieldDnd.activeId();
    if (!id) return -1;
    const fid = id.startsWith("drag:field:") ? id.slice("drag:field:".length) : null;
    return fid ? fields().findIndex((f) => f.id === fid) : -1;
  };

  const isDropIndicatorVisible = (index: number) => {
    if (!fieldDnd.isDragging()) return false;
    const intent = fieldDnd.intent();
    if (!intent || intent.insertIndex !== index) return false;
    const src = sourceIndex();
    if (src < 0) return true;
    return src !== index && src !== index - 1;
  };

  // -------------------------------------------------------------------
  // Field add / update / delete
  // -------------------------------------------------------------------
  const handleAddField = async () => {
    const result = await prompts.form({
      title: "Add field",
      icon: "ti ti-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Status" },
        type: {
          type: "select",
          label: "Type",
          options: TYPE_OPTIONS.map((o) => ({ id: o.value, label: o.label })),
          required: true,
        },
      },
      confirmText: "Create",
      size: "medium",
    });
    if (!result) return;
    const name = String(result.name).trim();
    const type = String(result.type);

    const res = await apiClient.fields["by-table"][":tableId"].$post({
      param: { tableId: props.table.id },
      json: { name, type, config: defaultConfigForType(type) },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to create field"));
      return;
    }
    const created = (await res.json()) as Field;
    setFields([...fields(), created]);
    setExpandedId(created.id);
    refreshCurrentPath();
  };

  const handleDeleteField = async (field: Field) => {
    const depsRes = await apiClient.fields[":fieldId"].dependents.$get({
      param: { fieldId: field.id },
    });
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
        return;
      }
    }
    const confirmed = await prompts.confirm(
      `Soft-delete "${field.name}"? Records keep their data; the column is hidden from the UI.`,
      { title: "Delete field?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;

    const res = await apiClient.fields[":fieldId"].$delete({ param: { fieldId: field.id } });
    if (res.status >= 400) {
      prompts.error(await errorMessage(res, "Failed to delete field"));
      return;
    }
    setFields(fields().filter((f) => f.id !== field.id));
    refreshCurrentPath();
  };

  // -------------------------------------------------------------------
  // Danger zone — delete table
  // -------------------------------------------------------------------
  const deleteTableMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({
        param: { tableId: props.table.id },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => navigateTo(`/app/grids/${props.table.baseId}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleDeleteTable = async () => {
    const confirmed = await prompts.confirm(
      `Permanently delete "${tName()}" and all of its fields, records, and audit history. This cannot be undone.`,
      { title: "Delete table?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteTableMut.mutate(undefined);
  };

  // -------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------
  return (
    // Full-bleed: the editor wants the whole main column. No max-width.
    <div class="flex flex-col gap-4 p-6">
      {/* Page header — sits on the page background, no paper card. */}
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-primary">Edit table</h1>
        <a
          href={`/app/grids/${props.table.baseId}?table=${props.table.id}`}
          class="btn-input btn-input-sm"
        >
          <i class="ti ti-arrow-left" /> Back to records
        </a>
      </header>

      <SectionCard
        title="General"
        subtitle="Table name and description shown to viewers."
      >
        <form onSubmit={handleTableSave} class="flex flex-col gap-3">
          <TextInput
            label="Name"
            value={tName}
            onInput={setName}
            icon="ti ti-typography"
            required
          />
          <TextInput
            label="Description"
            description="Optional — shown to viewers as table-level context."
            value={tDesc}
            onInput={setDesc}
            icon="ti ti-align-left"
            multiline
          />
          <Show when={tDirty()}>
            <button
              type="submit"
              class="btn-primary btn-sm self-start"
              disabled={updateTableMut.loading()}
            >
              {updateTableMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
            </button>
          </Show>
        </form>
      </SectionCard>

      <SectionCard
        title="Fields"
        subtitle="Drag to reorder. Click a field to edit its details."
        meta={`${fields().length} field${fields().length === 1 ? "" : "s"}`}
      >
        <Show
          when={fields().length > 0}
          fallback={
            <p class="text-xs text-dimmed">
              No fields yet. Click "Add field" below to create the first one.
            </p>
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={fields()}>
              {(field, index) => {
                const dragId = `drag:field:${field.id}`;
                const dropId = `drop:field:${field.id}`;
                const isDragging = () => fieldDnd.activeId() === dragId;
                const isExpanded = () => expandedId() === field.id;
                return (
                  <>
                    {/* Drop indicator BEFORE this card. Only visible when
                        the drag's intent points to this slot AND landing
                        here wouldn't be a no-op. */}
                    <Show when={isDropIndicatorVisible(index())}>
                      <div class="relative h-2">
                        <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-md bg-blue-500/80 dark:bg-blue-400/80" />
                      </div>
                    </Show>
                    <li
                      ref={(el) => {
                        fieldDnd.draggable(el, () => ({
                          id: dragId,
                          disabled: reorderMut.loading() || isExpanded(),
                          focusable: false,
                          keyboard: false,
                          handleSelector: "[data-dnd-handle]",
                          meta: { fieldId: field.id },
                        }));
                        fieldDnd.droppable(el, () => ({
                          id: dropId,
                          disabled: reorderMut.loading(),
                          meta: { kind: "field", index: index() },
                        }));
                      }}
                      data-card-index={index()}
                      class={`rounded-lg border border-zinc-200 dark:border-zinc-700 transition-colors ${
                        isDragging() ? "opacity-40" : ""
                      } ${isExpanded() ? "ring-2 ring-blue-500/30 dark:ring-blue-400/30" : ""}`}
                    >
                      {/* Card header — visible in both states */}
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 px-3 py-2 text-left"
                        onClick={() => setExpandedId(isExpanded() ? null : field.id)}
                        aria-expanded={isExpanded()}
                      >
                        <span
                          data-dnd-handle
                          class="cursor-grab active:cursor-grabbing text-dimmed hover:text-primary p-1 -ml-1"
                          aria-label="Drag to reorder"
                          title="Drag to reorder"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <i class="ti ti-grip-vertical" />
                        </span>
                        <span class="flex-1 min-w-0 flex items-baseline gap-2">
                          <span class="text-sm font-semibold text-primary truncate">
                            {field.name}
                          </span>
                          <span class="text-[10px] text-dimmed">
                            {TYPE_LABELS[field.type] ?? field.type}
                          </span>
                          <Show when={field.required}>
                            <span class="text-[10px] text-amber-600 dark:text-amber-400">
                              required
                            </span>
                          </Show>
                        </span>
                        <Show when={field.description}>
                          <span class="text-xs text-dimmed truncate hidden md:inline max-w-[20rem]">
                            {field.description}
                          </span>
                        </Show>
                        <i
                          class={`ti ti-chevron-down text-sm text-dimmed transition-transform ${
                            isExpanded() ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      <Show when={isExpanded()}>
                        <FieldEditor
                          field={field}
                          otherTables={props.otherTables}
                          fieldsByTable={props.fieldsByTable}
                          onSaved={(updated) => {
                            setFields(fields().map((f) => (f.id === updated.id ? updated : f)));
                          }}
                          onDeleted={() => handleDeleteField(field)}
                        />
                      </Show>
                    </li>
                  </>
                );
              }}
            </For>
            <Show when={isDropIndicatorVisible(fields().length)}>
              <div class="relative h-2">
                <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-md bg-blue-500/80 dark:bg-blue-400/80" />
              </div>
            </Show>
          </ul>
        </Show>

        <button
          type="button"
          class="btn-input btn-input-sm self-start text-emerald-600 hover:text-emerald-700"
          onClick={handleAddField}
        >
          <i class="ti ti-plus" /> Add field
        </button>
      </SectionCard>

      <SectionCard
        title="Permissions"
        subtitle="Grants resolve most-specific-first: table > base, user > group."
      >
        <div class="info-block-info text-xs flex items-start gap-2">
          <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
          <span>
            Within the same tier, "no access" wins over a positive grant. Set
            base-level grants for the team default; tighten or loosen per table
            here.
          </span>
        </div>
        <TablePermissions
          tableId={props.table.id}
          initialEntries={props.initialAccessEntries}
        />
      </SectionCard>

      <SectionCard
        title="Forms"
        subtitle="Public links to fill the table without a login."
      >
        <FormsManager
          tableId={props.table.id}
          fields={fields()}
          initialForms={props.initialForms}
          canManage
        />
      </SectionCard>

      <SectionCard
        title="Danger zone"
        subtitle="Permanently delete this table and all of its data. This cannot be undone."
        variant="danger"
      >
        <button
          type="button"
          class="btn-danger btn-sm self-start"
          onClick={handleDeleteTable}
          disabled={deleteTableMut.loading()}
        >
          <i class="ti ti-trash" /> Delete table
        </button>
      </SectionCard>
    </div>
  );
}

// =============================================================================
// FieldEditor — body of an expanded field card
// =============================================================================

function FieldEditor(props: {
  field: Field;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onSaved: (next: Field) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = createSignal(props.field.name);
  const [description, setDescription] = createSignal(props.field.description ?? "");
  const [required, setRequired] = createSignal(props.field.required);
  const [config, setConfig] = createSignal<FieldConfigState>(
    (props.field.config as FieldConfigState) ?? {},
  );
  const [dirty, setDirty] = createSignal(false);

  // Touch-tracker — any field-level edit flips the dirty bit.
  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const updateMut = mutations.create<Field, void>({
    mutation: async () => {
      const res = await apiClient.fields[":fieldId"].$patch({
        param: { fieldId: props.field.id },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          required: required(),
          config: config() as Record<string, unknown>,
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save field"));
      return (await res.json()) as Field;
    },
    onSuccess: (next) => {
      setDirty(false);
      props.onSaved(next);
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
    <div class="border-t border-zinc-100 dark:border-zinc-800 px-4 py-4 flex flex-col gap-4">
      {/* Type primer — short, type-specific blurb so the constraint
          inputs further down ("precision", "scale", "regex" etc.) make
          immediate sense to non-power users. */}
      <Show when={typeDescription}>
        <div class="info-block-info text-xs flex items-start gap-2">
          <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
          <span>{typeDescription}</span>
        </div>
      </Show>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextInput
          label="Name"
          value={name}
          onInput={wrap(setName)}
          icon="ti ti-typography"
          required
        />
        {/* Type display — uses the same TextInput visual the Name input
            uses (with disabled styling) so heights line up. */}
        <TextInput
          label="Type (immutable)"
          icon="ti ti-category"
          value={() => typeLabel}
          disabled
        />
      </div>

      <TextInput
        label="Description (optional)"
        description="Shown beside the field in the edit modal and the record detail panel."
        value={description}
        onInput={wrap(setDescription)}
        icon="ti ti-info-circle"
        multiline
        lines={2}
        placeholder="e.g. Use the ISO-639-1 language code"
      />

      <label class="inline-flex items-center gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={required()}
          onChange={(e) => wrap(setRequired)(e.currentTarget.checked)}
        />
        Required — every record must have a value for this field
      </label>

      <FieldConfigEditor
        type={props.field.type}
        config={config}
        onChange={(next) => {
          setConfig(next);
          setDirty(true);
        }}
        otherTables={props.otherTables}
        fieldsByTable={props.fieldsByTable}
      />

      <div class="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <button
          type="button"
          class="btn-simple btn-sm text-red-500 hover:text-red-600"
          onClick={props.onDeleted}
        >
          <i class="ti ti-trash" /> Delete field
        </button>
        <div class="flex items-center gap-2">
          <Show when={dirty()}>
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={handleSave}
              disabled={updateMut.loading()}
            >
              {updateMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// TablePermissions — wraps the platform PermissionEditor with table-API wires
// =============================================================================

function TablePermissions(props: {
  tableId: string;
  initialEntries: AccessEntry[];
}) {
  const [entries, setEntries] = createSignal<AccessEntry[]>(props.initialEntries);
  return (
    <PermissionEditor
      resourceId={props.tableId}
      initialEntries={entries()}
      canEdit
      grantAccess={async (resourceId: string, principal: Principal, permission: PermissionLevel) => {
        const res = await apiClient.access["by-table"][":tableId"].$post({
          param: { tableId: resourceId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        // Re-fetch the canonical list so the new entry has its displayName etc.
        const listRes = await apiClient.access["by-table"][":tableId"].$get({
          param: { tableId: resourceId },
        });
        const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
        setEntries(list);
        return list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!;
      }}
      updateAccess={async (_resourceId, accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(entries().map((e) => (e.id === accessId ? { ...e, permission } : e)));
      }}
      revokeAccess={async (_resourceId, accessId) => {
        const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}
