import type { AccessEntry } from "@valentinkolb/cloud/contracts";
import {
  Checkbox,
  CopyButton,
  DialogHeader,
  dialogCore,
  navigateTo,
  PermissionEditor,
  prompts,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, Form, Table } from "../../service";
import { errorMessage } from "./api-helpers";
import { FieldInput } from "./form-fields";
import FormsManager from "./FormsManager.island";
import {
  defaultConfigForType,
  FIELD_TYPE_DESCRIPTIONS,
  FieldConfigEditor,
  type FieldConfigState,
  TYPE_LABELS,
  TYPE_OPTIONS,
} from "./field-config-editor";
import { SectionCard } from "./SectionCard";

type TableHeader = {
  id: string;
  /** UUID of the parent base. Kept for API calls that still take UUIDs. */
  baseId: string;
  /** URL-safe slug of the parent base. Used for href construction. */
  baseShortId: string;
  /** URL-safe slug of this table. Used for href construction. */
  shortId: string;
  name: string;
  description: string | null;
  disableDirectInsert: boolean;
};

type Props = {
  table: TableHeader;
  initialFields: Field[];
  initialForms: Form[];
  initialAccessEntries: AccessEntry[];
  /** Per-form ACL entries, keyed by form id. Pre-fetched server-side
   *  so the per-form Permissions section in FormsManager renders
   *  without a client-fetch on first expand. */
  initialFormAccessEntries: Record<string, AccessEntry[]>;
  /** Other tables in the same base — needed for the relation type's
   *  targetTableId picker. */
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
};

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
  const [tDisableDirectInsert, setTDisableDirectInsert] = createSignal(
    props.table.disableDirectInsert
  );
  const [tDirty, setTDirty] = createSignal(false);

  const setName = (v: string) => {
    setTName(v);
    setTDirty(true);
  };
  const setDesc = (v: string) => {
    setTDesc(v);
    setTDirty(true);
  };
  const setDisableDirectInsert = (v: boolean) => {
    setTDisableDirectInsert(v);
    setTDirty(true);
  };

  const updateTableMut = mutations.create<Table, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$patch({
        param: { tableId: props.table.id },
        json: {
          name: tName().trim(),
          description: tDesc().trim() || null,
          disableDirectInsert: tDisableDirectInsert(),
        },
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
  // Fields section — reorderable cards, edit on click
  // -------------------------------------------------------------------
  const [fields, setFields] = createSignal<Field[]>(
    [...props.initialFields].sort((a, b) => a.position - b.position)
  );

  const reorderMut = mutations.create<void, string[]>({
    mutation: async (fieldIds) => {
      const res = await apiClient.fields["by-table"][":tableId"].reorder.$post({
        param: { tableId: props.table.id },
        json: { fieldIds },
      });
      if (res.status >= 400)
        throw new Error(await errorMessage(res, "Failed to reorder"));
    },
    onError: (e) => prompts.error(e.message),
  });

  /**
   * Move a field one slot up (-1) or down (+1) and persist the new order.
   *
   * Replaces the previous DnD reorder: the drag-handle hitbox was small
   * (the grip icon area), poorly discoverable, and finicky on
   * trackpads / touch. Arrow buttons are KISS — always discoverable,
   * accessible by default, work on every input device. Same wire-shape
   * (POST /fields/by-table/:t/reorder with the full id list), only the
   * trigger changes. Mirrors the existing FormsManager pattern so the
   * two reorder surfaces feel the same.
   */
  const moveField = (index: number, direction: -1 | 1) => {
    if (reorderMut.loading()) return;
    const next = [...fields()];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setFields(next);
    reorderMut.mutate(next.map((f) => f.id));
  };

  // -------------------------------------------------------------------
  // Field add / update / delete
  // -------------------------------------------------------------------
  const handleAddField = async () => {
    const result = await prompts.form({
      title: "Add field",
      icon: "ti ti-plus",
      fields: {
        name: {
          type: "text",
          label: "Name",
          required: true,
          placeholder: "e.g. Status",
        },
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
    // Open the edit modal immediately so the user can configure the
    // freshly created field without an extra click. Mirrors the
    // pre-modal behaviour where the new card auto-expanded.
    openFieldEditDialog({
      field: created,
      otherTables: props.otherTables,
      fieldsByTable: props.fieldsByTable,
      onSaved: (updated) => {
        setFields(fields().map((f) => (f.id === updated.id ? updated : f)));
      },
      onDeleted: async () => {
        await handleDeleteField(created);
      },
    });
  };

  const handleDeleteField = async (field: Field) => {
    const depsRes = await apiClient.fields[":fieldId"].dependents.$get({
      param: { fieldId: field.id },
    });
    if (depsRes.ok) {
      const deps = (await depsRes.json()) as {
        hasBlocking: boolean;
        dependents: Array<{
          type: string;
          resourceName: string;
          blocking: boolean;
        }>;
      };
      if (deps.hasBlocking) {
        const blockers = deps.dependents
          .filter((d) => d.blocking)
          .map((d) => `• ${d.type}: ${d.resourceName}`)
          .join("\n");
        prompts.error(
          `Cannot delete — remove these references first:\n\n${blockers}`
        );
        return;
      }
    }
    const confirmed = await prompts.confirm(
      `Soft-delete "${field.name}"? Records keep their data; the column is hidden from the UI.`,
      {
        title: "Delete field?",
        variant: "danger",
        confirmText: "Delete",
      }
    );
    if (!confirmed) return;

    const res = await apiClient.fields[":fieldId"].$delete({
      param: { fieldId: field.id },
    });
    if (res.status >= 400) {
      prompts.error(await errorMessage(res, "Failed to delete field"));
      return;
    }
    setFields(fields().filter((f) => f.id !== field.id));
  };

  // -------------------------------------------------------------------
  // Danger zone — delete table
  // -------------------------------------------------------------------
  const deleteTableMut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.tables[":tableId"].$delete({
        param: { tableId: props.table.id },
      });
      if (res.status >= 400)
        throw new Error(await errorMessage(res, "Failed to delete table"));
    },
    onSuccess: () => navigateTo(`/app/grids/${props.table.baseShortId}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleDeleteTable = async () => {
    const confirmed = await prompts.confirm(
      `Permanently delete "${tName()}" and all of its fields, records, and audit history. This cannot be undone.`,
      { title: "Delete table?", variant: "danger", confirmText: "Delete" }
    );
    if (!confirmed) return;
    deleteTableMut.mutate(undefined);
  };

  // -------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------
  return (
    // Full-bleed: the editor wants the whole main column. No max-width.
    <div class="flex flex-col gap-2">
      {/* Page header — sits on the page background, no paper card. */}
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-primary">Edit table</h1>
        <a
          href={`/app/grids/${props.table.baseShortId}?table=${props.table.shortId}`}
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
          <Checkbox
            label="Disable direct insert"
            description="When enabled, records can only be added through a form. Direct insert from the records grid or API is blocked. Useful for submission-inbox tables."
            value={tDisableDirectInsert}
            onChange={setDisableDirectInsert}
          />
          <Show when={tDirty()}>
            <button
              type="submit"
              class="btn-primary btn-sm self-start"
              disabled={updateTableMut.loading()}
            >
              {updateTableMut.loading() ? (
                <i class="ti ti-loader-2 animate-spin" />
              ) : (
                "Save"
              )}
            </button>
          </Show>
        </form>
      </SectionCard>

      <SectionCard
        title="Fields"
        subtitle="Use the arrows to reorder. Click a field to open its editor."
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
                const total = () => fields().length;
                const openEditor = () => {
                  openFieldEditDialog({
                    field,
                    otherTables: props.otherTables,
                    fieldsByTable: props.fieldsByTable,
                    onSaved: (updated) => {
                      setFields(
                        fields().map((f) =>
                          f.id === updated.id ? updated : f
                        )
                      );
                    },
                    onDeleted: async () => {
                      await handleDeleteField(field);
                    },
                  });
                };
                return (
                  <li class="group rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                    {/* Card row — arrows + click-to-edit + copy-ref.
                        Hover bg lives on the whole <li> (via `group`)
                        so the entire row darkens uniformly instead of
                        just the click-target middle section. The
                        pencil icon turns blue-500 on group-hover as
                        an affordance cue. */}
                    <div class="flex items-center">
                      {/* Reorder arrows — each button is a fixed-height
                          flex box that centers its chevron, so the
                          two-arrow column sits visually balanced in
                          the row. Without the explicit `h-4 flex
                          items-center justify-center`, the chevron
                          glyph's intrinsic baseline offset (tabler
                          renders chevron-up slightly higher in its
                          em-box) made the top arrow look pushed
                          upward, leaving asymmetric whitespace above
                          vs below. Hover color is `text-blue-500` —
                          the previous `text-primary` was too close to
                          the dimmed default to read as a state change. */}
                      <div class="flex flex-col pl-2 shrink-0">
                        <button
                          type="button"
                          class="h-4 flex items-center justify-center text-dimmed hover:text-blue-500 disabled:opacity-30 transition-colors"
                          onClick={() => moveField(index(), -1)}
                          disabled={index() === 0 || reorderMut.loading()}
                          title="Move up"
                          aria-label="Move up"
                        >
                          <i class="ti ti-chevron-up text-xs" />
                        </button>
                        <button
                          type="button"
                          class="h-4 flex items-center justify-center text-dimmed hover:text-blue-500 disabled:opacity-30 transition-colors"
                          onClick={() => moveField(index(), 1)}
                          disabled={index() === total() - 1 || reorderMut.loading()}
                          title="Move down"
                          aria-label="Move down"
                        >
                          <i class="ti ti-chevron-down text-xs" />
                        </button>
                      </div>
                      <button
                        type="button"
                        class="flex flex-1 min-w-0 items-center gap-2 px-3 py-2 text-left"
                        onClick={openEditor}
                        aria-label={`Edit field ${field.name}`}
                      >
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
                        <i class="ti ti-pencil text-sm text-dimmed group-hover:text-blue-500 transition-colors" />
                      </button>
                      {/* Power-user hook: copy the field's `#short_id`
                          token so users can paste it straight into a
                          formula (`#abc12 + 1`). */}
                      <CopyButton
                        text={`#${field.shortId}`}
                        label="Copy ref"
                        class="btn-simple btn-sm mr-2 shrink-0"
                      />
                    </div>
                  </li>
                );
              }}
            </For>
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
        meta={`${props.initialForms.filter((f) => !f.isDefault).length} form${
          props.initialForms.filter((f) => !f.isDefault).length === 1 ? "" : "s"
        }`}
      >
        <FormsManager
          tableId={props.table.id}
          fields={fields()}
          initialForms={props.initialForms}
          initialFormAccessEntries={props.initialFormAccessEntries}
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
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onSaved: (next: Field) => void;
  onDeleted: () => Promise<void> | void;
};

const openFieldEditDialog = (args: OpenFieldEditArgs): Promise<void> =>
  dialogCore.open<void>(
    (close) => (
      <div class="flex flex-col gap-4">
        <DialogHeader
          title={`Edit field — ${args.field.name}`}
          icon="ti ti-pencil"
          close={() => close()}
        />
        <FieldEditor
          field={args.field}
          otherTables={args.otherTables}
          fieldsByTable={args.fieldsByTable}
          onSaved={(next) => {
            args.onSaved(next);
            close();
          }}
          onDeleted={async () => {
            await args.onDeleted();
            close();
          }}
          onCancel={() => close()}
        />
      </div>
    ),
    {
      // Same panel sizing pattern as CreateRecordDialog: 48rem wide,
      // 86vh tall cap with internal scroll, opaque tint + blurred
      // backdrop so the page behind reads as muted not visible.
      panelClassName:
        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[min(96vw,48rem)] max-h-[86vh] overflow-x-hidden overflow-y-auto rounded-2xl border-0 bg-white/95 p-4 text-zinc-900 shadow-none ring-1 ring-inset ring-zinc-300/60 dark:bg-zinc-950/95 dark:text-zinc-100 dark:ring-zinc-700/60 backdrop:bg-black/45 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm",
    },
  );

// =============================================================================
// FieldEditor — body of the field-edit modal
// =============================================================================

function FieldEditor(props: {
  field: Field;
  otherTables: Array<{ id: string; name: string }>;
  fieldsByTable: Record<string, Field[]>;
  onSaved: (next: Field) => void;
  onDeleted: () => void;
  /** Optional cancel handler — only set when the editor is rendered
   *  inside a dialog. The footer adds a "Cancel" button next to Save
   *  so users have a clear way out without triggering a save. */
  onCancel?: () => void;
}) {
  const [name, setName] = createSignal(props.field.name);
  const [description, setDescription] = createSignal(
    props.field.description ?? ""
  );
  const [required, setRequired] = createSignal(props.field.required);
  const [presentable, setPresentable] = createSignal(props.field.presentable);
  const [hideInTable, setHideInTable] = createSignal(props.field.hideInTable);
  const [defaultValue, setDefaultValue] = createSignal<unknown>(
    props.field.defaultValue
  );
  const [indexed, setIndexed] = createSignal(props.field.indexed);
  const [uniqueConstraint, setUniqueConstraint] = createSignal(
    props.field.uniqueConstraint
  );
  const [config, setConfig] = createSignal<FieldConfigState>(
    (props.field.config as FieldConfigState) ?? {}
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
          presentable: presentable(),
          hideInTable: hideInTable(),
          defaultValue: defaultValue(),
          indexed: indexed(),
          uniqueConstraint: uniqueConstraint(),
          config: config() as Record<string, unknown>,
        },
      });
      if (!res.ok)
        throw new Error(await errorMessage(res, "Failed to save field"));
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
    <div class="px-4 pb-4 pt-1 flex flex-col gap-4">
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
        {/* Name + Datatype side by side. Symmetric description on both so
            the two columns visually align (Name's description was missing
            before, which made the Datatype row taller by ~1 text line). */}
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
        description="Shown beside the field in the edit modal and the record detail panel."
        value={description}
        onInput={wrap(setDescription)}
        icon="ti ti-info-circle"
        multiline
        lines={2}
        placeholder="e.g. Use the ISO-639-1 language code"
      />

      <div class="flex flex-col gap-2">
        <label class="inline-flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={required()}
            onChange={(e) => wrap(setRequired)(e.currentTarget.checked)}
          />
          Required — every record must have a value for this field
        </label>
        <label class="inline-flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={presentable()}
            onChange={(e) => wrap(setPresentable)(e.currentTarget.checked)}
          />
          Presentable — show this field whenever the record is referenced
          elsewhere (relation cells, picker labels)
        </label>
        <label class="inline-flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={hideInTable()}
            onChange={(e) => wrap(setHideInTable)(e.currentTarget.checked)}
          />
          Hide in table — only show this field in the detail panel by default
          (views can still include it)
        </label>
        <label class="inline-flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={indexed()}
            onChange={(e) => wrap(setIndexed)(e.currentTarget.checked)}
          />
          Indexed — faster filter and sort on this field. Costs disk; recommend
          for fields you frequently query
        </label>
        <label class="inline-flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={uniqueConstraint()}
            onChange={(e) => wrap(setUniqueConstraint)(e.currentTarget.checked)}
          />
          Unique values — no two records can share the same value. Existing
          duplicates block enabling
        </label>
      </div>

      {/* Default value — fills records that don't supply this field on
          create. Renders via the shared FieldInput so the value editor
          matches the field type (NumberInput for number, SelectInput
          for single-select, etc). Saved as `defaultValue` on the field
          row; null/undefined = no default. */}
      <div class="flex flex-col gap-1">
        <p class="text-xs font-medium text-secondary">
          Default value (optional)
        </p>
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
        <p class="text-[11px] text-dimmed leading-snug">
          Used for records created without this field set (e.g. via direct API
          inserts or imports).
        </p>
      </div>

      <FieldConfigEditor
        type={props.field.type}
        currentTableId={props.field.tableId}
        config={config}
        onChange={(next) => {
          setConfig(next);
          setDirty(true);
        }}
        otherTables={props.otherTables}
        fieldsByTable={props.fieldsByTable}
      />

      <div class="flex items-center justify-between gap-2 pt-2">
        <button
          type="button"
          class="btn-simple btn-sm text-red-500 hover:text-red-600"
          onClick={props.onDeleted}
        >
          <i class="ti ti-trash" /> Delete field
        </button>
        <div class="flex items-center gap-2">
          <Show when={props.onCancel}>
            <button
              type="button"
              class="btn-input btn-sm"
              onClick={() => props.onCancel?.()}
            >
              Cancel
            </button>
          </Show>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={handleSave}
            disabled={!dirty() || updateMut.loading()}
          >
            {updateMut.loading() ? (
              <i class="ti ti-loader-2 animate-spin" />
            ) : (
              "Save"
            )}
          </button>
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
  const [entries, setEntries] = createSignal<AccessEntry[]>(
    props.initialEntries
  );
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
        if (!res.ok)
          throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        // Re-fetch the canonical list so the new entry has its displayName etc.
        const listRes = await apiClient.access["by-table"][":tableId"].$get({
          param: { tableId: props.tableId },
        });
        const list = listRes.ok
          ? ((await listRes.json()) as AccessEntry[])
          : entries();
        setEntries(list);
        return (
          list.find((e) => e.id === created.accessId) ?? list[list.length - 1]!
        );
      }}
      updateAccess={async (accessId, permission) => {
        const res = await apiClient.access[":accessId"].$patch({
          param: { accessId },
          json: { permission },
        });
        if (res.status >= 400)
          throw new Error(await errorMessage(res, "Failed to update access"));
        setEntries(
          entries().map((e) => (e.id === accessId ? { ...e, permission } : e))
        );
      }}
      revokeAccess={async (accessId) => {
        const res = await apiClient.access[":accessId"].$delete({
          param: { accessId },
        });
        if (res.status >= 400)
          throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}
