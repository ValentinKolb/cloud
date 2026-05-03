import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { apiClient } from "@/api/client";
import {
  Select,
  TextInput,
  navigateTo,
  prompts,
  refreshCurrentPath,
} from "@valentinkolb/cloud/ui";
import {
  dnd,
  mutation as mutations,
  type DndBuildIntentContext,
} from "@valentinkolb/stdlib/solid";
import type { Field } from "../../service";
import type {
  FormatSpec,
  ViewColumn,
  ViewConfig,
} from "../../service/views";
import type { View } from "../../service";
import { errorMessage } from "./api-helpers";
import FilterPanel, { type FilterLeaf } from "./FilterPanel";
import SortPanel, { type SortRow } from "./SortPanel";
import { SectionCard } from "./SectionCard";
import { TYPE_LABELS } from "./field-config-editor";

type Props = {
  baseId: string;
  tableId: string;
  initialView: View;
  fields: Field[];
};

type DragMeta = { columnIdx: number };
type DropMeta = { kind: "col"; index: number };
type DropIntent = { insertIndex: number };

/**
 * Full-screen view editor. Sections (one SectionCard each):
 *  - General (name + shared toggle)
 *  - Filter   (FilterPanel re-mounted, persists to view.config.filter)
 *  - Sort     (SortPanel re-mounted)
 *  - Columns  (DnD-reorderable list of ViewColumns; toggle inherit-vs-
 *              custom; per-column format gear; pick from remaining
 *              fields to add)
 *  - Limit    (top-N number input)
 *  - Danger   (delete view)
 *
 * Each section persists to the view via PATCH /api/grids/views/:viewId.
 * The page does NOT auto-save — every section has its own Save button.
 * Mirrors the table-edit page's UX (and re-uses SectionCard).
 */
export default function ViewEditPage(props: Props) {
  return (
    <div class="flex flex-col gap-4 p-6">
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-primary">Edit view</h1>
        <a
          href={`/app/grids/${props.baseId}?table=${props.tableId}&view=${props.initialView.id}`}
          class="btn-input btn-input-sm"
        >
          <i class="ti ti-arrow-left" /> Back to records
        </a>
      </header>

      <GeneralSection viewId={props.initialView.id} initial={props.initialView} />
      <FilterSection
        viewId={props.initialView.id}
        fields={props.fields}
        initialFilter={props.initialView.config.filter as unknown}
      />
      <SortSection
        viewId={props.initialView.id}
        fields={props.fields}
        initialSort={(props.initialView.config.sort ?? []) as SortRow[]}
      />
      <ColumnsSection
        viewId={props.initialView.id}
        fields={props.fields}
        initialColumns={props.initialView.config.columns}
      />
      <LimitSection
        viewId={props.initialView.id}
        initial={props.initialView.config.limit}
      />
      <SectionCard
        title="Danger zone"
        subtitle="Permanently delete this view. Records remain — only the saved filter / sort / columns go away."
        variant="danger"
      >
        <DeleteButton
          viewId={props.initialView.id}
          baseId={props.baseId}
          tableId={props.tableId}
          name={props.initialView.name}
        />
      </SectionCard>
    </div>
  );
}

// =============================================================================
// Shared helper — patch the view's config (merging into existing)
// =============================================================================

const patchViewConfig = async (
  viewId: string,
  patch: Partial<ViewConfig>,
): Promise<View> => {
  // Fetch current to merge — the API replaces config wholesale, so we
  // need to send everything together. (Tiny round-trip cost; this only
  // happens on Save clicks, not on every keystroke.)
  const cur = await apiClient.views[":viewId"].$get({ param: { viewId } });
  if (!cur.ok) throw new Error(await errorMessage(cur, "Failed to load view"));
  const current = (await cur.json()) as View;
  const merged = { ...current.config, ...patch } as ViewConfig;
  // Strip undefined keys so `delete view.config.foo` round-trips correctly.
  for (const k of Object.keys(merged) as (keyof ViewConfig)[]) {
    if (merged[k] === undefined) delete merged[k];
  }
  const res = await apiClient.views[":viewId"].$patch({
    param: { viewId },
    json: { config: merged },
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
  return (await res.json()) as View;
};

// =============================================================================
// General — name + shared
// =============================================================================

function GeneralSection(props: { viewId: string; initial: View }) {
  const [name, setName] = createSignal(props.initial.name);
  const [shared, setShared] = createSignal(props.initial.ownerUserId === null);
  const [dirty, setDirty] = createSignal(false);

  const wrap =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const mut = mutations.create<View, void>({
    mutation: async () => {
      const res = await apiClient.views[":viewId"].$patch({
        param: { viewId: props.viewId },
        json: { name: name().trim(), shared: shared() },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save"));
      return (await res.json()) as View;
    },
    onSuccess: () => setDirty(false),
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard title="General" subtitle="Name and visibility scope.">
      <TextInput
        label="Name"
        value={name}
        onInput={wrap(setName)}
        icon="ti ti-typography"
        required
      />
      <label class="inline-flex items-center gap-2 text-xs text-secondary">
        <input
          type="checkbox"
          checked={shared()}
          onChange={(e) => wrap(setShared)(e.currentTarget.checked)}
        />
        Shared — visible to everyone with read access on this table
      </label>
      <Show when={dirty()}>
        <button
          type="button"
          class="btn-primary btn-sm self-start"
          onClick={() => {
            if (!name().trim()) {
              prompts.error("Name is required");
              return;
            }
            mut.mutate(undefined);
          }}
          disabled={mut.loading()}
        >
          {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
        </button>
      </Show>
    </SectionCard>
  );
}

// =============================================================================
// Filter — re-mounted FilterPanel, persists to config.filter
// =============================================================================

function FilterSection(props: { viewId: string; fields: Field[]; initialFilter: unknown }) {
  const initialLeaves = parseFilterTreeToLeaves(props.initialFilter);
  const [rows, setRows] = createSignal<FilterLeaf[]>(initialLeaves);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);

  const apply = async (leaves: FilterLeaf[]) => {
    const filter = leaves.length === 0 ? undefined : { op: "AND" as const, filters: leaves };
    try {
      await patchViewConfig(props.viewId, { filter });
      setSavedAt(Date.now());
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SectionCard
      title="Filter"
      subtitle="Records that don't match are hidden in this view."
      meta={savedAt() ? "Saved" : undefined}
    >
      <Show
        when={rows().length > 0}
        fallback={
          <div class="flex items-center gap-2 text-xs">
            <span class="text-dimmed">No filter — view shows every record.</span>
            <button
              type="button"
              class="btn-input btn-input-sm text-emerald-600 hover:text-emerald-700"
              onClick={() => {
                const blank = blankFilterLeaf(props.fields);
                if (blank) setRows([blank]);
              }}
            >
              <i class="ti ti-filter-plus" /> Add filter
            </button>
          </div>
        }
      >
        <FilterPanel
          fields={props.fields}
          rows={rows}
          onRowsChange={setRows}
          initialFromUrl={initialLeaves}
          onApply={apply}
        />
      </Show>
    </SectionCard>
  );
}

// =============================================================================
// Sort — re-mounted SortPanel
// =============================================================================

function SortSection(props: { viewId: string; fields: Field[]; initialSort: SortRow[] }) {
  const [rows, setRows] = createSignal<SortRow[]>(props.initialSort);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);

  const apply = async (next: SortRow[]) => {
    const sort = next.length === 0 ? undefined : next;
    try {
      await patchViewConfig(props.viewId, { sort });
      setSavedAt(Date.now());
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SectionCard
      title="Sort"
      subtitle="Records appear in this order. Top to bottom = primary first."
      meta={savedAt() ? "Saved" : undefined}
    >
      <Show
        when={rows().length > 0}
        fallback={
          <div class="flex items-center gap-2 text-xs">
            <span class="text-dimmed">No sort — records appear in insertion order.</span>
            <button
              type="button"
              class="btn-input btn-input-sm text-emerald-600 hover:text-emerald-700"
              onClick={() => {
                const first = props.fields.find((f) => !f.deletedAt);
                if (first) setRows([{ fieldId: first.id, direction: "asc" }]);
              }}
            >
              <i class="ti ti-arrows-sort" /> Add sort
            </button>
          </div>
        }
      >
        <SortPanel
          fields={props.fields}
          rows={rows}
          onRowsChange={setRows}
          initialFromUrl={props.initialSort}
          onApply={apply}
        />
      </Show>
    </SectionCard>
  );
}

// =============================================================================
// Columns — DnD reorder, toggle visibility, per-column format gear
// =============================================================================

function ColumnsSection(props: {
  viewId: string;
  fields: Field[];
  initialColumns: ViewColumn[] | undefined;
}) {
  const [columns, setColumns] = createSignal<ViewColumn[] | undefined>(props.initialColumns);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const fieldsById = createMemo(() => new Map(props.fields.map((f) => [f.id, f])));

  const persist = async (next: ViewColumn[] | undefined) => {
    setColumns(next);
    try {
      await patchViewConfig(props.viewId, { columns: next });
      setSavedAt(Date.now());
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Computed lists
  const visible = () =>
    (columns() ?? []).filter(
      (c): c is Extract<ViewColumn, { kind: "field" }> => c.kind === "field",
    );
  const usedIds = createMemo(() => new Set(visible().map((c) => c.fieldId)));
  const addable = createMemo(() =>
    props.fields.filter((f) => !f.deletedAt && !usedIds().has(f.id)),
  );

  // ── DnD ───────────────────────────────────────────────────────────
  const buildIntent = (
    ctx: DndBuildIntentContext<DragMeta, DropMeta, DropIntent>,
  ): DropIntent | null => {
    if (!ctx.over) return null;
    const insertIndex =
      ctx.pointer.y <= ctx.over.rect.top + ctx.over.rect.height / 2
        ? ctx.over.meta.index
        : ctx.over.meta.index + 1;
    return { insertIndex };
  };
  const colDnd = dnd.create<DragMeta, DropMeta, DropIntent>({
    buildIntent,
    onDrop: ({ active, intent }) => {
      if (!intent) return;
      const list = visible();
      const sourceIdx = active.meta.columnIdx;
      let target = intent.insertIndex;
      if (sourceIdx < target) target -= 1;
      if (target === sourceIdx) return;
      const next = [...list];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(target, 0, moved!);
      void persist(next);
    },
  });
  onCleanup(() => colDnd.destroy());

  const sourceIndex = () => {
    const id = colDnd.activeId();
    if (!id || !id.startsWith("drag:col:")) return -1;
    return Number(id.slice("drag:col:".length));
  };
  const isDropIndicatorVisible = (index: number) => {
    if (!colDnd.isDragging()) return false;
    const intent = colDnd.intent();
    if (!intent || intent.insertIndex !== index) return false;
    const src = sourceIndex();
    if (src < 0) return true;
    return src !== index && src !== index - 1;
  };

  // ── Handlers ──────────────────────────────────────────────────────
  const startCustomizing = () => {
    // Auto-populate from table-default (non-hideInTable, by position)
    // so the user has something to remove rather than starting empty.
    const seed: ViewColumn[] = props.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ kind: "field", fieldId: f.id }));
    void persist(seed);
  };

  const resetToInherit = async () => {
    const ok = await prompts.confirm(
      'Reset to table default? Custom column ordering and per-column formats will be lost.',
      { title: "Reset columns?", variant: "danger", confirmText: "Reset" },
    );
    if (!ok) return;
    void persist(undefined);
  };

  const removeColumn = (idx: number) => {
    void persist(visible().filter((_, i) => i !== idx));
  };

  const addColumn = (fieldId: string) => {
    void persist([...visible(), { kind: "field", fieldId }]);
  };

  const editFormat = async (idx: number) => {
    const col = visible()[idx];
    if (!col) return;
    const f = fieldsById().get(col.fieldId);
    if (!f) return;
    const next = await pickFormatSpec(f, col.format);
    if (next === undefined) return; // cancelled
    const updated: ViewColumn[] = visible().map((c, i) =>
      i === idx
        ? next === null
          ? { kind: "field", fieldId: c.fieldId }
          : { kind: "field", fieldId: c.fieldId, format: next }
        : c,
    );
    void persist(updated);
  };

  return (
    <SectionCard
      title="Columns"
      subtitle="Drag to reorder. Click ⚙ to set per-column format. Hidden fields can be added explicitly."
      meta={
        columns() === undefined
          ? "Inheriting"
          : `${visible().length} column${visible().length === 1 ? "" : "s"}`
      }
      action={
        savedAt() ? <span class="text-[10px] text-emerald-600">Saved</span> : undefined
      }
    >
      <Show
        when={columns() !== undefined}
        fallback={
          <div class="info-block-info text-xs flex items-start gap-2">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span class="flex-1">
              Inheriting table default: every field where{" "}
              <code class="font-mono">!hideInTable</code> is shown in{" "}
              <code class="font-mono">position</code> order.
            </span>
            <button
              type="button"
              class="btn-input btn-input-sm shrink-0"
              onClick={startCustomizing}
            >
              <i class="ti ti-pencil" /> Customize
            </button>
          </div>
        }
      >
        <ul class="flex flex-col gap-2">
          <For each={visible()}>
            {(col, idx) => {
              const dragId = `drag:col:${idx()}`;
              const dropId = `drop:col:${idx()}`;
              const isDragging = () => colDnd.activeId() === dragId;
              const f = () => fieldsById().get(col.fieldId);
              return (
                <>
                  <Show when={isDropIndicatorVisible(idx())}>
                    <div class="relative h-2">
                      <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-md bg-blue-500/80 dark:bg-blue-400/80" />
                    </div>
                  </Show>
                  <li
                    ref={(el) => {
                      colDnd.draggable(el, () => ({
                        id: dragId,
                        focusable: false,
                        keyboard: false,
                        handleSelector: "[data-dnd-handle]",
                        meta: { columnIdx: idx() },
                      }));
                      colDnd.droppable(el, () => ({
                        id: dropId,
                        meta: { kind: "col", index: idx() },
                      }));
                    }}
                    class={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                      isDragging() ? "opacity-40" : ""
                    } border-zinc-200 dark:border-zinc-700`}
                  >
                    <span
                      data-dnd-handle
                      class="cursor-grab active:cursor-grabbing text-dimmed hover:text-primary -ml-1"
                      title="Drag to reorder"
                    >
                      <i class="ti ti-grip-vertical" />
                    </span>
                    <Show when={f()} fallback={<span class="text-xs text-red-500">deleted field</span>}>
                      <span class="flex-1 min-w-0 flex items-baseline gap-2">
                        <span class="text-sm font-medium text-primary truncate">{f()!.name}</span>
                        <span class="text-[10px] text-dimmed">
                          {TYPE_LABELS[f()!.type] ?? f()!.type}
                        </span>
                        <Show when={col.format}>
                          <span class="text-[10px] text-blue-600 dark:text-blue-400">
                            format: {col.format!.kind}
                          </span>
                        </Show>
                      </span>
                      <button
                        type="button"
                        class="text-dimmed hover:text-primary p-1"
                        onClick={() => editFormat(idx())}
                        title="Format override"
                        aria-label="Format override"
                      >
                        <i class="ti ti-settings" />
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="text-dimmed hover:text-red-500 p-1"
                      onClick={() => removeColumn(idx())}
                      title="Remove column"
                      aria-label="Remove column"
                    >
                      <i class="ti ti-x" />
                    </button>
                  </li>
                </>
              );
            }}
          </For>
          <Show when={isDropIndicatorVisible(visible().length)}>
            <div class="relative h-2">
              <div class="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-md bg-blue-500/80 dark:bg-blue-400/80" />
            </div>
          </Show>
        </ul>

        <Show when={addable().length > 0}>
          <div class="flex items-center gap-2">
            <span class="text-xs text-dimmed">Add column:</span>
            <div class="min-w-[14rem]">
              <Select
                value={() => ""}
                onChange={(v) => v && addColumn(v)}
                options={addable().map((f) => ({
                  id: f.id,
                  label: f.name,
                  description: TYPE_LABELS[f.type] ?? f.type,
                }))}
                placeholder="Pick a field..."
              />
            </div>
          </div>
        </Show>

        <button
          type="button"
          class="btn-simple btn-sm text-orange-500 hover:text-orange-600 self-start"
          onClick={resetToInherit}
        >
          <i class="ti ti-rotate" /> Reset to table default
        </button>
      </Show>
    </SectionCard>
  );
}

// =============================================================================
// Limit — top-N
// =============================================================================

function LimitSection(props: { viewId: string; initial: number | undefined }) {
  const [value, setValue] = createSignal<string>(
    props.initial !== undefined ? String(props.initial) : "",
  );
  const [dirty, setDirty] = createSignal(false);

  const mut = mutations.create<View, void>({
    mutation: async () => {
      const trimmed = value().trim();
      const n = trimmed === "" ? undefined : Number(trimmed);
      if (n !== undefined && (!Number.isInteger(n) || n < 1)) {
        throw new Error("Limit must be a positive integer or empty");
      }
      return await patchViewConfig(props.viewId, { limit: n });
    },
    onSuccess: () => setDirty(false),
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard
      title="Limit"
      subtitle="Show at most N records. Empty = no limit."
    >
      <div class="flex items-center gap-2 max-w-sm">
        <input
          type="number"
          min="1"
          class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent px-2 py-1.5 text-sm flex-1"
          placeholder="unlimited"
          value={value()}
          onInput={(e) => {
            setValue(e.currentTarget.value);
            setDirty(true);
          }}
        />
        <Show when={dirty()}>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => mut.mutate(undefined)}
            disabled={mut.loading()}
          >
            {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </Show>
      </div>
    </SectionCard>
  );
}

// =============================================================================
// Delete
// =============================================================================

function DeleteButton(props: {
  viewId: string;
  baseId: string;
  tableId: string;
  name: string;
}) {
  const mut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.views[":viewId"].$delete({
        param: { viewId: props.viewId },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete view"));
    },
    onSuccess: () => navigateTo(`/app/grids/${props.baseId}?table=${props.tableId}`),
    onError: (e) => prompts.error(e.message),
  });

  const handleDelete = async () => {
    const ok = await prompts.confirm(
      `Delete view "${props.name}"? Records remain — only the saved configuration goes away.`,
      { title: "Delete view?", variant: "danger", confirmText: "Delete" },
    );
    if (!ok) return;
    mut.mutate(undefined);
  };

  return (
    <button
      type="button"
      class="btn-danger btn-sm self-start"
      onClick={handleDelete}
      disabled={mut.loading()}
    >
      <i class="ti ti-trash" /> Delete view
    </button>
  );
}

// =============================================================================
// Helpers
// =============================================================================

const parseFilterTreeToLeaves = (raw: unknown): FilterLeaf[] => {
  if (!raw || typeof raw !== "object") return [];
  const tree = raw as { op?: string; filters?: unknown };
  if (tree.op !== "AND" || !Array.isArray(tree.filters)) return [];
  return tree.filters.filter(
    (f: unknown): f is FilterLeaf =>
      typeof f === "object" && f !== null && "fieldId" in f && "op" in f,
  );
};

const blankFilterLeaf = (fields: Field[]): FilterLeaf | null => {
  const usable = fields.filter((f) => !f.deletedAt);
  const first = usable[0];
  if (!first) return null;
  return { fieldId: first.id, op: "equals", value: "" };
};

/**
 * Opens a small dialog to pick a FormatSpec for the given field. The
 * shape of the form is type-aware: date fields get format + includeTime,
 * decimal fields get precision + thousandsSeparator, etc.
 *
 * Returns:
 *  - `undefined` on cancel (don't change anything)
 *  - `null` on "clear" (drop the format override)
 *  - a FormatSpec on save
 */
const pickFormatSpec = async (
  field: Field,
  current?: FormatSpec,
): Promise<FormatSpec | null | undefined> => {
  if (field.type === "date") {
    const result = await prompts.form({
      title: `Format: ${field.name}`,
      icon: "ti ti-settings",
      fields: {
        format: {
          type: "select",
          label: "Date format",
          options: [
            { id: "iso", label: "ISO (2026-05-03)" },
            { id: "short", label: "Short (locale)" },
            { id: "long", label: "Long (May 3, 2026)" },
            { id: "relative", label: "Relative (3d ago)" },
          ],
          default:
            current?.kind === "date" ? current.format : "short",
          required: true,
        },
        includeTime: {
          type: "boolean",
          label: "Include time",
          default: current?.kind === "date" ? Boolean(current.includeTime) : false,
        },
      },
      confirmText: "Save",
    });
    if (!result) return undefined;
    return {
      kind: "date",
      format: result.format as "iso" | "short" | "long" | "relative",
      includeTime: Boolean(result.includeTime),
    };
  }
  if (field.type === "decimal" || field.type === "number") {
    const result = await prompts.form({
      title: `Format: ${field.name}`,
      icon: "ti ti-settings",
      fields: {
        precision: {
          type: "number",
          label: "Decimal places",
          min: 0,
          max: 10,
          default:
            current?.kind === "decimal" && current.precision !== undefined
              ? current.precision
              : undefined,
        },
        thousandsSeparator: {
          type: "boolean",
          label: "Thousands separator (1,234,567)",
          default: current?.kind === "decimal" ? Boolean(current.thousandsSeparator) : false,
        },
      },
      confirmText: "Save",
    });
    if (!result) return undefined;
    return {
      kind: "decimal",
      precision: typeof result.precision === "number" ? result.precision : undefined,
      thousandsSeparator: Boolean(result.thousandsSeparator),
    };
  }
  if (field.type === "currency") {
    const result = await prompts.form({
      title: `Format: ${field.name}`,
      icon: "ti ti-settings",
      fields: {
        symbol: {
          type: "text",
          label: "Override symbol (optional)",
          default: current?.kind === "currency" ? current.symbol ?? "" : "",
          placeholder: "€ / $ / record's own code",
        },
        precision: {
          type: "number",
          label: "Decimal places",
          min: 0,
          max: 10,
          default:
            current?.kind === "currency" && current.precision !== undefined
              ? current.precision
              : undefined,
        },
      },
      confirmText: "Save",
    });
    if (!result) return undefined;
    return {
      kind: "currency",
      symbol: typeof result.symbol === "string" && result.symbol.trim() !== ""
        ? result.symbol.trim()
        : undefined,
      precision: typeof result.precision === "number" ? result.precision : undefined,
    };
  }
  if (field.type === "percent") {
    const result = await prompts.form({
      title: `Format: ${field.name}`,
      icon: "ti ti-settings",
      fields: {
        precision: {
          type: "number",
          label: "Decimal places",
          min: 0,
          max: 10,
          default:
            current?.kind === "percent" && current.precision !== undefined
              ? current.precision
              : undefined,
        },
      },
      confirmText: "Save",
    });
    if (!result) return undefined;
    return {
      kind: "percent",
      precision: typeof result.precision === "number" ? result.precision : undefined,
    };
  }
  // Other types — no format options. Tell the user.
  await prompts.alert(
    `Field type "${TYPE_LABELS[field.type] ?? field.type}" has no format options.`,
    { title: "No formats", icon: "ti ti-info-circle" },
  );
  return undefined;
};
