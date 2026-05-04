import { For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import { prompts } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Field, GridRecord } from "../../service";
import {
  fieldToPromptSchema,
  isUserEditable,
  sanitizeEditPayload,
} from "./field-prompt-schema";
import { errorMessage } from "./api-helpers";
import { formatCell } from "./format-cell";
import { RecordLink } from "./RecordLink";
import RelationPicker from "./RelationPicker";

type Props = {
  baseId: string;
  tableId: string;
  fields: Field[];
  /** Currently-displayed record. Controlled by RecordsView — when the
   *  user clicks a different row in the grid, the parent passes a new
   *  record here. null = panel renders nothing. */
  record: () => GridRecord | null;
  /** "live" = edit/delete; "trash" = restore. Driven by the URL state's
   *  trash flag, lifted up to the parent. */
  mode: () => "live" | "trash";
  /** True if the user can edit/delete records on this table. */
  canWrite: boolean;
  /** Pre-resolved labels for linked records (target id → display label).
   *  Built SSR-side; used by relation cells to render presentable
   *  values instead of raw UUIDs. */
  relationLabels?: Record<string, string>;
  /** Close the panel (delegates URL writeback to RecordsView). */
  onClose: () => void;
  /** Emitted after a successful edit. RecordsView refetches the data
   *  resource so the grid reflects the new value. */
  onUpdated: (record: GridRecord) => void;
  /** Emitted after a successful delete or restore. RecordsView closes
   *  the panel + refetches. */
  onRemoved: () => void;
};

/**
 * Detail panel for a single record. Pure controlled component:
 * RecordsView passes the record to display + close/update/remove
 * callbacks; this island handles edit / delete / restore mutations
 * and renders the form. No URL writes, no custom events.
 */
export default function RecordDetailPanel(props: Props) {
  const record = () => props.record();
  const mode = () => props.mode();

  const visibleFields = () => props.fields.filter((f) => !f.deletedAt);

  // ---- Mutations ---------------------------------------------------------
  const updateMut = mutations.create<GridRecord, { rec: GridRecord; payload: Record<string, unknown> }>({
    mutation: async ({ rec, payload }) => {
      const res = await fetch(`/api/grids/records/${props.tableId}/${rec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": String(rec.version) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update record"));
      return (await res.json()) as GridRecord;
    },
    onSuccess: (updated) => props.onUpdated(updated),
    onError: (e) => prompts.error(e.message),
  });

  const deleteMut = mutations.create<string, GridRecord>({
    mutation: async (rec) => {
      const res = await apiClient.records[":tableId"][":recordId"].$delete({
        param: { tableId: props.tableId, recordId: rec.id },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to delete record"));
      return rec.id;
    },
    onSuccess: () => props.onRemoved(),
    onError: (e) => prompts.error(e.message),
  });

  const restoreMut = mutations.create<string, GridRecord>({
    mutation: async (rec) => {
      const res = await apiClient.records[":tableId"][":recordId"].restore.$post({
        param: { tableId: props.tableId, recordId: rec.id },
      });
      if (res.status >= 400) throw new Error(await errorMessage(res, "Failed to restore record"));
      return rec.id;
    },
    onSuccess: () => props.onRemoved(),
    onError: (e) => prompts.error(e.message),
  });

  // ---- Handlers ----------------------------------------------------------
  const handleEdit = async (rec: GridRecord) => {
    const usable = visibleFields().filter((f) => isUserEditable(f.type));
    if (usable.length === 0) {
      prompts.error("No editable fields. Add a field first.");
      return;
    }
    const formFields: Record<string, any> = {};
    for (const field of usable) {
      const schema = fieldToPromptSchema(field, rec.data[field.id]);
      if (schema) formFields[field.id] = schema;
    }
    // size: "large" — the user explicitly asked for a more comfortable
    // edit modal. The cloud prompts.form supports "small" | "medium" |
    // "large"; large gives the form noticeable breathing room.
    const result = await prompts.form({
      title: "Edit record",
      icon: "ti ti-edit",
      fields: formFields,
      confirmText: "Save",
      size: "large",
    });
    if (!result) return;
    const ids = usable.map((f) => f.id);
    updateMut.mutate({ rec, payload: sanitizeEditPayload(result, ids) });
  };

  const handleDelete = async (rec: GridRecord) => {
    const confirmed = await prompts.confirm(
      "Soft-delete this record? It can be restored from the trash.",
      { title: "Delete record?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMut.mutate(rec);
  };

  const handleRestore = (rec: GridRecord) => restoreMut.mutate(rec);

  /**
   * Read-only relation cell — list of inline links to the linked
   * records. Used in trash mode and for users without write permission.
   */
  const renderRelationCellReadOnly = (field: Field, value: unknown) => {
    const ids = Array.isArray(value)
      ? (value as string[])
      : typeof value === "string" && value.length > 0
      ? [value]
      : [];
    if (ids.length === 0) return "—";
    const cache = props.relationLabels ?? {};
    const targetTableId = (field.config as { targetTableId?: string }).targetTableId;
    return (
      <span class="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {ids.map((id, i) => (
          <RecordLink
            label={cache[id] ?? id.slice(0, 8)}
            targetTableId={targetTableId}
            targetRecordId={id}
            baseId={props.baseId}
            comma={i < ids.length - 1}
          />
        ))}
      </span>
    );
  };

  /**
   * Editable relation cell — search-driven picker. Wired to the same
   * `updateMut` the edit-modal uses; PATCH includes only the relation
   * field so other cells stay untouched. RecordsView refetches via
   * `props.onUpdated` so the chip labels reflect the new linkage on
   * the next render.
   */
  const renderRelationCellEditable = (field: Field, rec: GridRecord) => {
    const cfg = field.config as { targetTableId?: string; cardinality?: "single" | "multiple" };
    const targetTableId = cfg.targetTableId;
    if (!targetTableId) {
      // Misconfigured relation — fall back to read-only so we don't
      // crash. The field-config editor flags this in the table editor.
      return renderRelationCellReadOnly(field, rec.data[field.id]);
    }
    const multi = cfg.cardinality !== "single";
    const value = () => {
      const v = rec.data[field.id];
      if (Array.isArray(v)) return v as string[];
      if (typeof v === "string" && v.length > 0) return [v];
      return [];
    };
    const labels = () => props.relationLabels ?? {};
    const onChange = (next: string[]) => {
      updateMut.mutate({ rec, payload: { [field.id]: next } });
    };
    return (
      <RelationPicker
        targetTableId={targetTableId}
        value={value}
        labels={labels}
        multi={multi}
        onChange={onChange}
        saving={() => updateMut.loading()}
      />
    );
  };

  /**
   * Renders a lookup cell — the projected value, linking back to the
   * source-relation's first target record.
   */
  const renderLookupCell = (field: Field, rec: GridRecord) => {
    const cfg = field.config as { relationFieldId?: string };
    const relationField = cfg.relationFieldId
      ? props.fields.find((f) => f.id === cfg.relationFieldId && f.type === "relation")
      : undefined;
    const value = formatCell(rec.data[field.id], field.type, field.config);
    if (!value || !relationField) return value || "—";
    const targetTableId = (relationField.config as { targetTableId?: string }).targetTableId;
    const linked = rec.data[relationField.id];
    const targetId = Array.isArray(linked)
      ? (linked[0] as string | undefined)
      : typeof linked === "string"
      ? linked
      : undefined;
    if (!targetTableId || !targetId) return value;
    return (
      <RecordLink
        label={value}
        targetTableId={targetTableId}
        targetRecordId={targetId}
        baseId={props.baseId}
      />
    );
  };

  /** Type-aware field renderer. Returns JSX for relation/lookup cells
   *  (with cross-record links) and a string for everything else.
   *  Relation cells become an inline picker when canWrite + live mode;
   *  otherwise they render as read-only links. */
  const renderField = (field: Field, rec: GridRecord) => {
    if (field.type === "relation") {
      const editable = props.canWrite && mode() === "live";
      return editable
        ? renderRelationCellEditable(field, rec)
        : renderRelationCellReadOnly(field, rec.data[field.id]);
    }
    const value = rec.data[field.id];
    if (value === null || value === undefined || value === "") return "—";
    if (field.type === "lookup") return renderLookupCell(field, rec);
    return formatCell(value, field.type, field.config) || "—";
  };

  // ---- Pick the "title" of the record for the panel header --------------
  const titleField = () => visibleFields().find((f) => f.type === "text" || f.type === "longtext");
  const recordTitle = (rec: GridRecord) => {
    const tf = titleField();
    if (tf) {
      const v = rec.data[tf.id];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return `Record ${rec.id.slice(0, 8)}`;
  };

  return (
    <Show
      when={record()}
      fallback={null}
    >
        {(rec) => (
          <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
            {/* Header — title + small action buttons (contacts pattern). */}
            <div class="flex items-start justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800 px-4 py-3">
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-sm font-semibold leading-tight text-primary">
                  {recordTitle(rec())}
                </h2>
                <div class="mt-0.5 flex items-center gap-1.5 text-[11px] text-dimmed">
                  <Show when={mode() === "trash"}>
                    <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <i class="ti ti-trash" /> deleted
                    </span>
                  </Show>
                  <span>v{rec().version}</span>
                  <span>·</span>
                  <span class="font-mono">{rec().id.slice(0, 8)}</span>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-0.5">
                <Show when={props.canWrite && mode() === "live"}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-primary"
                    aria-label="Edit record"
                    title="Edit"
                    onClick={() => handleEdit(rec())}
                  >
                    <i class="ti ti-pencil" />
                  </button>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-red-500"
                    aria-label="Delete record"
                    title="Delete"
                    onClick={() => handleDelete(rec())}
                    disabled={deleteMut.loading()}
                  >
                    <i class="ti ti-trash" />
                  </button>
                </Show>
                <Show when={props.canWrite && mode() === "trash"}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-emerald-600"
                    aria-label="Restore record"
                    title="Restore"
                    onClick={() => handleRestore(rec())}
                    disabled={restoreMut.loading()}
                  >
                    <i class="ti ti-arrow-back-up" />
                  </button>
                </Show>
                <button
                  type="button"
                  class="btn-simple btn-sm text-dimmed hover:text-primary"
                  aria-label="Close detail panel"
                  title="Close"
                  onClick={() => props.onClose()}
                >
                  <i class="ti ti-x" />
                </button>
              </div>
            </div>

            {/* Body — one row per field with name + (description) + value. */}
            <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              <For each={visibleFields()}>
                {(f) => {
                  const description = f.description;
                  return (
                    <div class="flex flex-col gap-0.5">
                      <div class="flex items-baseline gap-2">
                        <span class="text-xs font-semibold text-primary">{f.name}</span>
                        <span class="text-[10px] text-dimmed">{f.type}</span>
                      </div>
                      <Show when={description}>
                        <p class="text-[11px] text-dimmed leading-snug">{description}</p>
                      </Show>
                      <p class="text-sm text-secondary break-words">
                        {renderField(f, rec())}
                      </p>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        )}
    </Show>
  );
}
