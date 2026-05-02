import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { apiClient } from "@/api/client";
import { prompts, refreshCurrentPath } from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Field, GridRecord } from "../../service";
import {
  fieldToPromptSchema,
  isUserEditable,
  sanitizeEditPayload,
} from "./field-prompt-schema";
import { errorMessage } from "./api-helpers";
import {
  RECORD_DETAIL_EVENT,
  clearSelectedRecordInUrl,
  getSelectedRecordIdFromUrl,
  type RecordDetailPayload,
  type RecordDetailMode,
} from "./record-detail-context";

type Props = {
  tableId: string;
  fields: Field[];
  /** Initial record from SSR — may be null if no `?record=<id>` was set. */
  initialRecord: GridRecord | null;
  initialRecordId: string | null;
  /** When true, renders the row actions as "Restore" instead of edit/delete. */
  trashMode: boolean;
  /** True if the user can edit/delete records on this table. */
  canWrite: boolean;
};

/**
 * Detail panel for a single record. Mounted in the third column of the
 * app-cols layout, hidden until `?record=<id>` is set. Uses the platform's
 * detail-panel pattern: SSR-renders for the initial selection, then listens
 * for in-page selection events from RecordsGrid (no full reload on click).
 *
 * Header carries the small action row mirroring contacts' detail panel —
 * edit pencil + delete + close X (or restore + close in trash mode).
 */
export default function RecordDetailPanel(props: Props) {
  const [record, setRecord] = createSignal<GridRecord | null>(props.initialRecord);
  const [recordId, setRecordId] = createSignal<string | null>(props.initialRecordId);
  const [mode, setMode] = createSignal<RecordDetailMode>(props.trashMode ? "trash" : "live");

  // Refetch when the URL key changes but the SSR didn't ship the row (rare —
  // happens when the list is paginated and the user clicks something we
  // didn't include in `props.initialRecord`). The list dispatches the row,
  // so this is mostly a fallback.
  const fetchRecord = async (id: string) => {
    const res = await apiClient.records[":tableId"][":recordId"].$get({
      param: { tableId: props.tableId, recordId: id },
    });
    if (!res.ok) return null;
    return (await res.json()) as GridRecord;
  };

  onMount(() => {
    const onEvent = (e: Event) => {
      const payload = (e as CustomEvent<RecordDetailPayload>).detail;
      setRecordId(payload.itemKey);
      setMode(payload.mode);
      if (payload.item) {
        setRecord(() => payload.item);
      } else if (payload.itemKey) {
        // Event arrived without a payload — fetch lazily.
        fetchRecord(payload.itemKey).then((r) => setRecord(() => r));
      } else {
        setRecord(null);
      }
    };
    const onPop = () => {
      const id = getSelectedRecordIdFromUrl();
      setRecordId(id);
      if (!id) {
        setRecord(null);
        return;
      }
      fetchRecord(id).then((r) => setRecord(() => r));
    };
    window.addEventListener(RECORD_DETAIL_EVENT, onEvent);
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      window.removeEventListener(RECORD_DETAIL_EVENT, onEvent);
      window.removeEventListener("popstate", onPop);
    });
  });

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
    onSuccess: (updated) => {
      setRecord(() => updated);
      refreshCurrentPath();
    },
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
    onSuccess: () => {
      clearSelectedRecordInUrl(mode());
      refreshCurrentPath();
    },
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
    onSuccess: () => {
      clearSelectedRecordInUrl(mode());
      refreshCurrentPath();
    },
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

  // ---- Field-value formatter (mirrors RecordsGrid's formatCell) ---------
  const formatCell = (value: unknown, type: string, fieldConfig?: Record<string, unknown>): string => {
    if (value === null || value === undefined || value === "") return "—";
    if (type === "boolean") return value ? "Yes" : "No";
    if (type === "multi-select" && Array.isArray(value)) {
      const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
      const labels = value.map((id) => options.find((o) => o.id === id)?.label ?? String(id));
      return labels.join(", ");
    }
    if (type === "single-select") {
      const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
      return options.find((o) => o.id === value)?.label ?? String(value);
    }
    if (type === "currency" && typeof value === "object") {
      const obj = value as { amount?: string; currency?: string };
      if (obj.amount !== undefined) return `${obj.amount} ${obj.currency ?? ""}`.trim();
    }
    if (type === "percent" && typeof value === "number") return `${value}%`;
    if (type === "duration" && typeof value === "number") {
      const h = Math.floor(value / 3600);
      const m = Math.floor((value % 3600) / 60);
      const s = value % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    if (type === "location" && typeof value === "object") {
      const obj = value as { lat?: number; lng?: number; label?: string };
      if (obj.label) return obj.label;
      if (obj.lat !== undefined && obj.lng !== undefined) return `${obj.lat}, ${obj.lng}`;
    }
    if (type === "signature" && typeof value === "string" && value.startsWith("data:image/")) {
      return "✍ signature";
    }
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
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
      when={record() !== null || recordId() !== null}
      fallback={null}
    >
      <Show
        when={record()}
        fallback={
          <div class="paper p-4 flex items-center justify-center text-xs text-dimmed">
            <i class="ti ti-loader-2 animate-spin mr-1.5" /> Loading record…
          </div>
        }
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
                  onClick={() => clearSelectedRecordInUrl(mode())}
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
                        {formatCell(rec().data[f.id], f.type, f.config)}
                      </p>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        )}
      </Show>
    </Show>
  );
}
