import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import { NumberInput, navigateTo, PermissionEditor, prompts, Select, TextInput } from "@valentinkolb/cloud/ui";
import { type DndBuildIntentContext, dnd, mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Field, View } from "../../service";
import type { ColumnSpec, FormatSpec, ViewQuery } from "../../service/views";
import { errorMessage } from "./api-helpers";
import { TYPE_LABELS } from "./field-config-editor";
import { SectionCard } from "./SectionCard";

type Props = {
  baseId: string;
  tableId: string;
  initialView: View;
  fields: Field[];
  /** Pre-fetched ACL entries for this view (server-side load). The
   *  PermissionEditor is given allowedLevels=["read"] because the API
   *  caps view-grants to read/none — write or admin on a view doesn't
   *  exist semantically (you can't "write to a saved query"). */
  initialAccessEntries: AccessEntry[];
  /** Whether the current user can mutate the view's ACL. The API gates
   *  this at table-admin; we mirror it client-side for the UI. */
  canEditAccess: boolean;
};

type DragMeta = { columnIdx: number };
type DropMeta = { kind: "col"; index: number };
type DropIntent = { insertIndex: number };

/**
 * Full-screen view editor. Sections (one SectionCard each):
 *  - General (name + shared toggle)
 *  - Filter   (FilterPanel re-mounted, persists to view.query.filter)
 *  - Sort     (SortPanel re-mounted)
 *  - Columns  (DnD-reorderable list of ColumnSpecs; toggle inherit-vs-
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
  // v3: views are FROZEN snapshots of a query — filter / sort / group /
  // aggregations get captured at "Save view" time and aren't editable
  // here. To change the query, the user clears + re-saves on the
  // records page. Only renaming / sharing / column-visibility (when
  // not grouped) / limit / deletion stay editable.
  const isGrouped = (props.initialView.query.groupBy ?? []).length > 0;
  return (
    <div class="flex flex-col gap-4 p-6">
      <header class="flex items-center justify-between gap-3">
        <h1 class="text-xl font-semibold text-primary">View settings</h1>
        <a href={`/app/grids/${props.baseId}?table=${props.tableId}&view=${props.initialView.id}`} class="btn-input btn-input-sm">
          <i class="ti ti-arrow-left" /> Back to records
        </a>
      </header>

      <div class="info-block-info text-xs">
        <i class="ti ti-snowflake" /> The view's query (filter, sort, group, aggregations) is frozen. To change it, go back to the records
        page, adjust filter/sort/group/aggregate in the toolbar, and save as a new view.
      </div>

      <GeneralSection viewId={props.initialView.id} initial={props.initialView} />

      {/* Columns editor — only when the view is in flat (non-grouped)
          mode. In grouped mode, the displayed columns are derived
          from groupBy + aggregations, so a separate column list would
          be ignored anyway. */}
      <Show when={!isGrouped}>
        <ColumnsSection viewId={props.initialView.id} fields={props.fields} initialColumns={props.initialView.query.columns} />
      </Show>

      <LimitSection viewId={props.initialView.id} initial={props.initialView.query.limit} />

      {/* Permissions section — only meaningful for shared views (a
          personal view's grants would be invisible to anyone but the
          owner anyway). The Shared toggle in General turns this on/off
          implicitly: shared = visible to everyone with table-read by
          default; specific grants here let you NARROW that to a
          subset. */}
      <SectionCard
        title="Permissions"
        subtitle="Grant read access on this view to specific users or groups. Only Read is offered — views are saved queries; there's no Write or Admin level for them."
      >
        <ViewPermissions viewId={props.initialView.id} initialEntries={props.initialAccessEntries} canEdit={props.canEditAccess} />
      </SectionCard>

      <SectionCard
        title="Danger zone"
        subtitle="Permanently delete this view. Records remain — only the saved filter / sort / columns go away."
        variant="danger"
      >
        <DeleteButton viewId={props.initialView.id} baseId={props.baseId} tableId={props.tableId} name={props.initialView.name} />
      </SectionCard>
    </div>
  );
}

// =============================================================================
// Shared helper — patch the view's query (merging into existing)
// =============================================================================

const patchViewQuery = async (viewId: string, patch: Partial<ViewQuery>): Promise<View> => {
  // Fetch current to merge — the API replaces query wholesale, so we
  // need to send everything together. (Tiny round-trip cost; this only
  // happens on Save clicks, not on every keystroke.)
  const cur = await apiClient.views[":viewId"].$get({ param: { viewId } });
  if (!cur.ok) throw new Error(await errorMessage(cur, "Failed to load view"));
  const current = (await cur.json()) as View;
  const merged = { ...current.query, ...patch } as ViewQuery;
  // Strip undefined keys so `delete view.query.foo` round-trips correctly.
  for (const k of Object.keys(merged) as (keyof ViewQuery)[]) {
    if (merged[k] === undefined) delete merged[k];
  }
  const res = await apiClient.views[":viewId"].$patch({
    param: { viewId },
    json: { query: merged },
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
      <TextInput label="Name" value={name} onInput={wrap(setName)} icon="ti ti-typography" required />
      <label class="inline-flex items-center gap-2 text-xs text-secondary">
        <input type="checkbox" checked={shared()} onChange={(e) => wrap(setShared)(e.currentTarget.checked)} />
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

function ColumnsSection(props: { viewId: string; fields: Field[]; initialColumns: ColumnSpec[] | undefined }) {
  const [columns, setColumns] = createSignal<ColumnSpec[] | undefined>(props.initialColumns);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  const fieldsById = createMemo(() => new Map(props.fields.map((f) => [f.id, f])));

  const persist = async (next: ColumnSpec[] | undefined) => {
    setColumns(next);
    try {
      await patchViewQuery(props.viewId, { columns: next });
      setSavedAt(Date.now());
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Computed lists. v3 ColumnSpec has no `kind` discriminator — every
  // entry is a field-column. Cross-table data is served by lookup/rollup
  // field types, not view-level joins.
  const visible = () => columns() ?? [];
  const usedIds = createMemo(() => new Set(visible().map((c) => c.fieldId)));
  const addable = createMemo(() => props.fields.filter((f) => !f.deletedAt && !usedIds().has(f.id)));

  // ── DnD ───────────────────────────────────────────────────────────
  const buildIntent = (ctx: DndBuildIntentContext<DragMeta, DropMeta, DropIntent>): DropIntent | null => {
    if (!ctx.over) return null;
    const insertIndex = ctx.pointer.y <= ctx.over.rect.top + ctx.over.rect.height / 2 ? ctx.over.meta.index : ctx.over.meta.index + 1;
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
    const seed: ColumnSpec[] = props.fields
      .filter((f) => !f.deletedAt && !f.hideInTable)
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ fieldId: f.id }));
    void persist(seed);
  };

  const resetToInherit = async () => {
    const ok = await prompts.confirm("Reset to table default? Custom column ordering and per-column formats will be lost.", {
      title: "Reset columns?",
      variant: "danger",
      confirmText: "Reset",
    });
    if (!ok) return;
    void persist(undefined);
  };

  const removeColumn = (idx: number) => {
    void persist(visible().filter((_, i) => i !== idx));
  };

  const addColumn = (fieldId: string) => {
    void persist([...visible(), { fieldId }]);
  };

  const editFormat = async (idx: number) => {
    const col = visible()[idx];
    if (!col) return;
    const f = fieldsById().get(col.fieldId);
    if (!f) return;
    const next = await pickFormatSpec(f, col.format);
    if (next === undefined) return; // cancelled
    const updated: ColumnSpec[] = visible().map((c, i) =>
      i === idx ? (next === null ? { fieldId: c.fieldId } : { fieldId: c.fieldId, format: next }) : c,
    );
    void persist(updated);
  };

  return (
    <SectionCard
      title="Columns"
      subtitle="Drag to reorder. Click ⚙ to set per-column format. Hidden fields can be added explicitly."
      meta={columns() === undefined ? "Inheriting" : `${visible().length} column${visible().length === 1 ? "" : "s"}`}
      action={savedAt() ? <span class="text-[10px] text-emerald-600">Saved</span> : undefined}
    >
      <Show
        when={columns() !== undefined}
        fallback={
          <div class="info-block-info text-xs flex items-start gap-2">
            <i class="ti ti-info-circle text-sm mt-0.5 shrink-0" />
            <span class="flex-1">
              Inheriting table default: every field where <code class="font-mono">!hideInTable</code> is shown in{" "}
              <code class="font-mono">position</code> order.
            </span>
            <button type="button" class="btn-input btn-input-sm shrink-0" onClick={startCustomizing}>
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
                        <span class="text-[10px] text-dimmed">{TYPE_LABELS[f()!.type] ?? f()!.type}</span>
                        <Show when={col.format}>
                          <span class="text-[10px] text-blue-600 dark:text-blue-400">format: {col.format!.kind}</span>
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

        <button type="button" class="btn-simple btn-sm text-orange-500 hover:text-orange-600 self-start" onClick={resetToInherit}>
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
  // The platform NumberInput is strictly numeric (no null/empty
  // state) — so we treat 0 as the sentinel for "no limit". The user
  // hint in the section subtitle calls that out. On save we convert
  // 0 → undefined so the contract's `limit: int().min(1)` accepts it.
  const [value, setValue] = createSignal<number>(props.initial ?? 0);
  const [dirty, setDirty] = createSignal(false);

  const mut = mutations.create<View, void>({
    mutation: async () => {
      const n = value();
      const limit = n > 0 ? n : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error("Limit must be a positive integer or 0 for unlimited");
      }
      return await patchViewQuery(props.viewId, { limit });
    },
    onSuccess: () => setDirty(false),
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard title="Limit" subtitle="Show at most N records. Use 0 for unlimited.">
      <div class="flex items-center gap-2 max-w-sm">
        <div class="flex-1">
          <NumberInput
            min={0}
            max={10000}
            value={value}
            onChange={(v) => {
              setValue(v);
              setDirty(true);
            }}
          />
        </div>
        <Show when={dirty()}>
          <button type="button" class="btn-primary btn-sm" onClick={() => mut.mutate(undefined)} disabled={mut.loading()}>
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

function DeleteButton(props: { viewId: string; baseId: string; tableId: string; name: string }) {
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
    const ok = await prompts.confirm(`Delete view "${props.name}"? Records remain — only the saved configuration goes away.`, {
      title: "Delete view?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    mut.mutate(undefined);
  };

  return (
    <button type="button" class="btn-danger btn-sm self-start" onClick={handleDelete} disabled={mut.loading()}>
      <i class="ti ti-trash" /> Delete view
    </button>
  );
}

// =============================================================================
// Helpers
// =============================================================================

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
const pickFormatSpec = async (field: Field, current?: FormatSpec): Promise<FormatSpec | null | undefined> => {
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
          default: current?.kind === "date" ? current.format : "short",
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
          default: current?.kind === "decimal" && current.precision !== undefined ? current.precision : undefined,
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
          default: current?.kind === "currency" ? (current.symbol ?? "") : "",
          placeholder: "€ / $ / record's own code",
        },
        precision: {
          type: "number",
          label: "Decimal places",
          min: 0,
          max: 10,
          default: current?.kind === "currency" && current.precision !== undefined ? current.precision : undefined,
        },
      },
      confirmText: "Save",
    });
    if (!result) return undefined;
    return {
      kind: "currency",
      symbol: typeof result.symbol === "string" && result.symbol.trim() !== "" ? result.symbol.trim() : undefined,
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
          default: current?.kind === "percent" && current.precision !== undefined ? current.precision : undefined,
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
  await prompts.alert(`Field type "${TYPE_LABELS[field.type] ?? field.type}" has no format options.`, {
    title: "No formats",
    icon: "ti ti-info-circle",
  });
  return undefined;
};

// =============================================================================
// ViewPermissions — wraps the platform PermissionEditor with view-API wires
// =============================================================================
// Mirrors TablePermissions in TableEditPage. The only difference: we pass
// `allowedLevels={["read"]}` so the editor renders as plain inline badges
// (no SegmentedControl, no chevron dropdown) — there's no Write or Admin
// for a view, the API caps every grant at "read" or "none".

function ViewPermissions(props: { viewId: string; initialEntries: AccessEntry[]; canEdit: boolean }) {
  const [entries, setEntries] = createSignal<AccessEntry[]>(props.initialEntries);
  return (
    <PermissionEditor
      initialEntries={entries()}
      canEdit={props.canEdit}
      allowedLevels={[{ level: "read", label: "View" }]}
      grantAccess={async (principal, permission) => {
        const res = await apiClient.access["by-view"][":viewId"].$post({
          param: { viewId: props.viewId },
          json: { principal, permission },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
        const created = (await res.json()) as { accessId: string };
        // Refetch the canonical list so the new entry has displayName etc.
        const listRes = await apiClient.access["by-view"][":viewId"].$get({
          param: { viewId: props.viewId },
        });
        const list = listRes.ok ? ((await listRes.json()) as AccessEntry[]) : entries();
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
        const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
        if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to revoke access"));
        setEntries(entries().filter((e) => e.id !== accessId));
      }}
    />
  );
}
