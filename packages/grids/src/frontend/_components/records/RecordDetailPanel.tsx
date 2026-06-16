import { Placeholder, prompts } from "@valentinkolb/cloud/ui";
import { type DateContext, text } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createResource, createSignal, For, type JSX, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { ColumnSpec, FormatSpec } from "../../../contracts";
import { effectiveDisplayField } from "../../../lookup-display";
import type { AuditEntry, Field, GridFile, GridRecord } from "../../../service";
import { isUserEditable } from "../fields/field-prompt-schema";
import { barcodeValueText, canRenderBarcode } from "../table/BarcodeCell";
import { FieldValue, fieldDisplayFormat, formatFieldValueText } from "../table/FieldValue";
import { errorMessage } from "../utils/api-helpers";
import { openRecordUpsertDialog } from "./RecordUpsertDialog";

type Props = {
  baseId: string;
  baseShortId?: string;
  tableId: string;
  tableName: string;
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
  tableShortIds?: Record<string, string>;
  fieldsByTable?: Record<string, Field[]>;
  viewColumns?: ColumnSpec[];
  dateConfig?: DateContext;
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
  const titleField = () => {
    const fields = visibleFields();
    return (
      fields.find((f) => f.presentable && !["longtext", "json", "file", "relation"].includes(f.type)) ??
      fields.find((f) => f.type === "text")
    );
  };
  const bodyFields = () => {
    const titleId = titleField()?.id;
    return visibleFields().filter((f) => f.id !== titleId);
  };
  const fieldFormat = (field: Field): FormatSpec | undefined => {
    const column = props.viewColumns?.find((item) => !("kind" in item) && item.fieldId === field.id);
    return fieldDisplayFormat(field, column?.format);
  };
  const fieldBarcodeFormat = (field: Field): Extract<FormatSpec, { kind: "barcode" }> | undefined => {
    const format = fieldFormat(field);
    return format?.kind === "barcode" ? format : undefined;
  };
  const isBarcodeDisplayField = (field: Field, rec: GridRecord) => {
    const format = fieldBarcodeFormat(field);
    if (!format) return false;
    if (!canRenderBarcode(effectiveDisplayField(field, props.fieldsByTable).type)) return false;
    return barcodeValueText(rec.data[field.id]).trim().length > 0;
  };
  const barcodeFields = (rec: GridRecord) => bodyFields().filter((field) => isBarcodeDisplayField(field, rec));
  const barcodeFieldIds = (rec: GridRecord) => new Set(barcodeFields(rec).map((field) => field.id));
  const detailsFields = (rec: GridRecord) =>
    bodyFields().filter((f) => !barcodeFieldIds(rec).has(f.id) && !["longtext", "json", "file", "relation"].includes(f.type));
  const relationFields = () => bodyFields().filter((f) => f.type === "relation");
  const textBlockFields = () => bodyFields().filter((f) => ["longtext", "json"].includes(f.type));
  const fileFields = () => bodyFields().filter((f) => f.type === "file");
  const hasBodyFields = (rec: GridRecord) =>
    barcodeFields(rec).length > 0 ||
    detailsFields(rec).length > 0 ||
    relationFields().length > 0 ||
    textBlockFields().length > 0 ||
    fileFields().length > 0;

  // ---- Mutations ---------------------------------------------------------
  const updateMut = mutations.create<GridRecord, { rec: GridRecord; payload: Record<string, unknown> }>({
    mutation: async ({ rec, payload }) => {
      const res = await apiClient.records[":tableId"][":recordId"].$patch(
        {
          param: { tableId: props.tableId, recordId: rec.id },
          json: payload,
        },
        { headers: { "If-Match": String(rec.version) } },
      );
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to update record"));
      return res.json();
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
    const usable = visibleFields().filter((f) => isUserEditable(f.type) || f.type === "relation");
    if (usable.length === 0) {
      prompts.error("No editable fields. Add a field first.");
      return;
    }
    const result = await openRecordUpsertDialog({
      mode: "edit",
      fields: visibleFields(),
      baseId: props.baseId,
      tableName: props.tableName,
      record: rec,
      relationLabels: props.relationLabels,
      dateConfig: props.dateConfig,
    });
    if (!result) return;
    updateMut.mutate({ rec, payload: result });
  };

  const handleDelete = async (rec: GridRecord) => {
    const confirmed = await prompts.confirm(
      `${recordTitle(rec)}\n${props.tableName}\n\nThis record is moved to trash and can be restored.`,
      { title: "Delete record?", variant: "danger", confirmText: "Delete" },
    );
    if (!confirmed) return;
    deleteMut.mutate(rec);
  };

  const handleRestore = (rec: GridRecord) => restoreMut.mutate(rec);

  /** Type-aware field renderer. Returns JSX for relation/lookup cells
   *  (with cross-record links) and a string for everything else. The
   *  detail panel is read-first: relation edits happen through the
   *  explicit Edit action / RecordUpsertDialog, not inline dropdowns. */
  const renderField = (field: Field, rec: GridRecord) => {
    if (field.type === "file") {
      return <FileFieldCell tableId={props.tableId} recordId={rec.id} field={field} canWrite={props.canWrite && mode() === "live"} />;
    }
    return (
      <FieldValue
        field={field}
        value={rec.data[field.id]}
        record={rec}
        allFields={props.fields}
        baseId={props.baseShortId ?? props.baseId}
        tableShortIds={props.tableShortIds}
        fieldsByTable={props.fieldsByTable}
        relationLabels={props.relationLabels}
        dateConfig={props.dateConfig}
        format={fieldFormat(field)}
        mode="detail"
        empty="—"
        linkLookup
        showBarcodeOpenAction
      />
    );
  };

  // ---- Pick the "title" of the record for the panel header --------------
  const recordTitle = (rec: GridRecord) => {
    const tf = titleField();
    if (tf) {
      const v = rec.data[tf.id];
      if (typeof v === "string" && v.length > 0) return v;
      const formatted = formatFieldValueText({
        field: tf,
        value: v,
        record: rec,
        fieldsByTable: props.fieldsByTable,
        relationLabels: props.relationLabels,
        dateConfig: props.dateConfig,
        format: fieldFormat(tf),
      });
      if (formatted) return formatted;
    }
    return "Untitled record";
  };
  const renderFieldValue = (field: Field, rec: GridRecord, variant: "compact" | "full") => {
    const description = field.description;
    return (
      <div class="min-w-0">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-dimmed">{field.name}</p>
        <Show when={description}>
          <p class="mt-0.5 text-[11px] text-dimmed leading-snug">{description}</p>
        </Show>
        <div
          class={
            variant === "compact"
              ? "mt-1 min-w-0 break-words text-sm font-medium text-secondary"
              : "mt-1 min-w-0 break-words text-sm text-secondary"
          }
        >
          {renderField(field, rec)}
        </div>
      </div>
    );
  };
  const detailIcon = (field: Field) => {
    if (field.icon) return field.icon;
    if (isComputedField(field)) return "ti ti-math-function";
    const name = field.name.toLowerCase();
    if (name.includes("price")) return "ti ti-currency-euro";
    if (name.includes("discount")) return "ti ti-percentage";
    if (name.includes("published") || field.type === "date" || field.type === "datetime") return "ti ti-calendar";
    if (name.includes("stock") || field.type === "boolean") return "ti ti-check";
    if (name.includes("tag") || field.type.includes("select")) return "ti ti-tags";
    if (name.includes("sku")) return "ti ti-barcode";
    if (field.type === "number" || field.type === "percent") return "ti ti-hash";
    return "ti ti-info-circle";
  };
  const isComputedField = (field: Field) => ["formula", "lookup", "rollup"].includes(field.type);
  const renderDetailsPaperTile = (field: Field, rec: GridRecord) => (
    <div class="paper min-w-0 p-3">
      <div
        class={`flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide ${
          isComputedField(field) ? "text-blue-500" : "text-dimmed"
        }`}
      >
        <i class={`${detailIcon(field)} shrink-0`} />
        {field.name}
      </div>
      <div class="mt-1 min-w-0 break-words text-sm font-semibold leading-5 text-primary">{renderField(field, rec)}</div>
    </div>
  );
  const Section = (sectionProps: { title: string; children: JSX.Element }) => (
    <section class="paper p-4 flex flex-col gap-3">
      <h3 class="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary">{sectionProps.title}</h3>
      {sectionProps.children}
    </section>
  );
  const renderBarcodePaper = (field: Field, rec: GridRecord) => {
    const format = fieldBarcodeFormat(field);
    if (!format) return null;
    return (
      <section class="paper p-4 flex flex-col gap-3">
        <div class="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wide text-dimmed">
          <i class={`${detailIcon(field)} shrink-0`} />
          {field.name}
        </div>
        <FieldValue
          field={field}
          value={rec.data[field.id]}
          record={rec}
          allFields={props.fields}
          baseId={props.baseShortId ?? props.baseId}
          tableShortIds={props.tableShortIds}
          fieldsByTable={props.fieldsByTable}
          relationLabels={props.relationLabels}
          dateConfig={props.dateConfig}
          format={format}
          mode="detail"
          empty="—"
          linkLookup
          showBarcodeOpenAction
        />
      </section>
    );
  };

  return (
    <Show when={record()} fallback={null} keyed>
      {(rec) => (
        <div class="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
          <section class="paper p-4">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-lg font-semibold leading-tight text-primary">{recordTitle(rec)}</h2>
                <div class="mt-1 flex items-center gap-1.5 text-[11px] text-dimmed">
                  <Show when={mode() === "trash"}>
                    <span class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <i class="ti ti-trash" /> deleted
                    </span>
                    <span>·</span>
                  </Show>
                  <span class="truncate">{props.tableName}</span>
                  <span>·</span>
                  <span>v{rec.version}</span>
                  <span>·</span>
                  <span class="font-mono">{rec.id.slice(0, 8)}</span>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-0.5">
                <Show when={props.canWrite && mode() === "live"}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-primary"
                    aria-label="Edit record"
                    title="Edit"
                    onClick={() => handleEdit(rec)}
                  >
                    <i class="ti ti-pencil" />
                  </button>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-red-500"
                    aria-label="Delete record"
                    title="Delete"
                    onClick={() => handleDelete(rec)}
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
                    onClick={() => handleRestore(rec)}
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
          </section>

          <Show
            when={hasBodyFields(rec)}
            fallback={
              <Placeholder surface="paper" align="left">
                No fields to show.
              </Placeholder>
            }
          >
            <For each={barcodeFields(rec)}>{(field) => renderBarcodePaper(field, rec)}</For>

            <Show when={detailsFields(rec).length > 0}>
              <div class="grid grid-cols-2 gap-2">
                <For each={detailsFields(rec)}>{(field) => renderDetailsPaperTile(field, rec)}</For>
              </div>
            </Show>

            <Show when={relationFields().length > 0}>
              <Section title="Relations">
                <div class="flex flex-col gap-3">
                  <For each={relationFields()}>{(field) => renderFieldValue(field, rec, "full")}</For>
                </div>
              </Section>
            </Show>

            <For each={textBlockFields()}>
              {(field) => (
                <Section title={field.name}>
                  <div class="text-sm text-secondary break-words">{renderField(field, rec)}</div>
                </Section>
              )}
            </For>

            <Show when={fileFields().length > 0}>
              <Section title="Files">
                <div class="flex flex-col gap-3">
                  <For each={fileFields()}>{(field) => renderFieldValue(field, rec, "full")}</For>
                </div>
              </Section>
            </Show>
          </Show>

          <RecordHistorySection tableId={props.tableId} recordId={rec.id} />
        </div>
      )}
    </Show>
  );
}

function FileFieldCell(props: { tableId: string; recordId: string; field: Field; canWrite: boolean }) {
  const [uploading, setUploading] = createSignal(false);
  const [files, { refetch }] = createResource(
    () => `${props.tableId}:${props.recordId}:${props.field.id}`,
    async () => {
      const res = await apiClient.records[":tableId"][":recordId"].files[":fieldId"].$get({
        param: { tableId: props.tableId, recordId: props.recordId, fieldId: props.field.id },
      });
      if (!res.ok) return { items: [] as GridFile[] };
      return res.json();
    },
  );

  const accept = () => {
    const raw = (props.field.config as { accept?: string[] }).accept;
    return Array.isArray(raw) ? raw.join(",") : undefined;
  };

  const upload = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      // FormData upload exception: the Hono client route is JSON-typed, native fetch keeps multipart exact.
      const res = await fetch(`/api/grids/records/${props.tableId}/${props.recordId}/files/${props.field.id}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to upload file"));
      await refetch();
    } catch (e) {
      prompts.error(e instanceof Error ? e.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (file: GridFile) => {
    const confirmed = await prompts.confirm(`Delete "${file.filename}"?`, {
      title: "Delete file?",
      variant: "danger",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    const res = await apiClient.records[":tableId"][":recordId"].files[":fieldId"][":fileId"].$delete({
      param: { tableId: props.tableId, recordId: props.recordId, fieldId: props.field.id, fileId: file.id },
    });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to delete file"));
      return;
    }
    await refetch();
  };

  return (
    <div class="flex flex-col gap-2">
      <Show when={!files.loading && (files()?.items.length ?? 0) === 0}>
        <span class="text-dimmed">—</span>
      </Show>
      <Show when={(files()?.items.length ?? 0) > 0}>
        <div class="flex flex-col gap-1">
          <For each={files()?.items ?? []}>
            {(file) => (
              <div class="paper flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <i class="ti ti-paperclip text-dimmed" />
                <a
                  class="min-w-0 flex-1 truncate text-secondary hover:text-primary"
                  href={`/api/grids/records/${props.tableId}/${props.recordId}/files/${props.field.id}/${file.id}/content`}
                  title={file.filename}
                >
                  {file.filename}
                </a>
                <span class="shrink-0 text-[10px] text-dimmed">{text.pprintBytes(file.sizeBytes)}</span>
                <Show when={props.canWrite}>
                  <button
                    type="button"
                    class="btn-simple btn-sm text-dimmed hover:text-red-500"
                    title="Delete file"
                    onClick={() => void remove(file)}
                  >
                    <i class="ti ti-trash" />
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.canWrite}>
        <label class={`btn-input btn-input-sm w-fit ${uploading() ? "pointer-events-none opacity-60" : ""}`}>
          <i class={`ti ${uploading() ? "ti-loader-2 animate-spin" : "ti-upload"} text-sm`} />
          Upload
          <input type="file" class="sr-only" accept={accept()} onChange={(event) => void upload(event)} disabled={uploading()} />
        </label>
      </Show>
    </div>
  );
}

type AuditEntryWithUser = AuditEntry & { userDisplayName: string | null };

const ACTION_ICONS: Record<string, string> = {
  created: "ti-plus",
  updated: "ti-pencil",
  deleted: "ti-trash",
  restored: "ti-arrow-back-up",
  imported: "ti-file-import",
};

const ACTION_COLORS: Record<string, string> = {
  created: "text-emerald-600 dark:text-emerald-400",
  updated: "text-blue-600 dark:text-blue-400",
  deleted: "text-red-600 dark:text-red-400",
  restored: "text-amber-600 dark:text-amber-400",
  imported: "text-zinc-600 dark:text-zinc-400",
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86_400 * 30) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RecordHistorySection(props: { tableId: string; recordId: string }) {
  const [entries] = createResource(
    () => `${props.tableId}:${props.recordId}`,
    async () => {
      const res = await apiClient.records[":tableId"][":recordId"].audit.$get({
        param: { tableId: props.tableId, recordId: props.recordId },
      });
      if (!res.ok) return { items: [] as AuditEntryWithUser[] };
      return res.json();
    },
  );

  return (
    <details class="paper p-0 group">
      <summary class="cursor-pointer select-none flex items-center gap-2 px-3 py-2 text-xs font-medium text-secondary">
        <i class="ti ti-history text-sm" />
        History
        <Show when={!entries.loading && entries()}>
          <span class="text-[10px] text-dimmed">({entries()!.items.length})</span>
        </Show>
        <i class="ti ti-chevron-down ml-auto text-xs text-dimmed transition-transform group-open:rotate-180" />
      </summary>
      <div class="px-3 pb-3 flex flex-col gap-2">
        <Show when={entries.loading}>
          <p class="text-xs text-dimmed">Loading history…</p>
        </Show>
        <Show when={!entries.loading && entries() && entries()!.items.length === 0}>
          <Placeholder align="left" class="px-0 py-2">
            No history yet.
          </Placeholder>
        </Show>
        <For each={entries()?.items ?? []}>
          {(entry) => {
            const fieldsChanged = entry.diff ? Object.keys(entry.diff) : [];
            const summary =
              fieldsChanged.length === 0
                ? null
                : fieldsChanged.length <= 3
                  ? fieldsChanged.join(", ")
                  : `${fieldsChanged.slice(0, 3).join(", ")} +${fieldsChanged.length - 3} more`;
            return (
              <details class="text-xs">
                <summary class="cursor-pointer select-none flex items-baseline gap-2">
                  <i class={`ti ${ACTION_ICONS[entry.action] ?? "ti-circle"} ${ACTION_COLORS[entry.action] ?? "text-dimmed"} text-xs`} />
                  <span class="capitalize text-secondary">{entry.action}</span>
                  {/* Actor attribution. The audit row carries both a
                      `userId` (UUID of the actor at write time, or
                      null) and a `userDisplayName` resolved at read
                      time via JOIN to auth.users (null when the user
                      is gone OR when no user was ever associated).
                      Three states, three distinct strings:
                        - name resolved        → "by <name>"
                        - userId null          → "via public form"
                          (every null-actor audit on records comes
                          from the anonymous form-submit path; see
                          submitFormResponse in api/forms.ts)
                        - userId set, name nil → "by deleted user"
                          (italic to mark it as a phantom — the
                          actor existed but is no longer in auth.users)
                  */}
                  <Show
                    when={entry.userDisplayName}
                    fallback={
                      <Show when={entry.userId === null} fallback={<span class="text-dimmed italic">by deleted user</span>}>
                        <span class="text-dimmed inline-flex items-center gap-1">
                          <i class="ti ti-world text-[10px]" />
                          via public form
                        </span>
                      </Show>
                    }
                  >
                    {(name) => <span class="text-dimmed">by {name()}</span>}
                  </Show>
                  <span class="ml-auto text-[10px] text-dimmed shrink-0" title={entry.createdAt}>
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                </summary>
                <Show when={summary}>
                  <p class="ml-5 text-[11px] text-dimmed">changed {summary}</p>
                </Show>
                <Show when={entry.diff && fieldsChanged.length > 0}>
                  <pre class="ml-5 mt-1 max-h-40 overflow-auto rounded-md bg-zinc-50 dark:bg-zinc-800 p-2 text-[10px] font-mono text-zinc-700 dark:text-zinc-300">
                    {JSON.stringify(entry.diff, null, 2)}
                  </pre>
                </Show>
              </details>
            );
          }}
        </For>
      </div>
    </details>
  );
}
