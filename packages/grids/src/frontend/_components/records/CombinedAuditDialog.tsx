import { DatePicker, dialogCore, PanelDialog, panelDialogOptions, prompts, Select } from "@valentinkolb/cloud/ui";
import { createSignal, onMount, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { CombinedAuditEntry, CombinedAuditPage, Field } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { RecordHistoryList } from "./RecordHistorySection";
import RecordPicker from "./RecordPicker";

const COMBINED_AUDIT_DIALOG_OPTIONS = {
  ...panelDialogOptions,
  panelClassName: panelDialogOptions.panelClassName.replace("w-[min(96vw,48rem)]", "w-[min(98vw,76rem)]"),
};

const ACTION_OPTIONS = [
  { id: "", label: "All record actions" },
  { id: "created", label: "Created" },
  { id: "updated", label: "Updated" },
  { id: "deleted", label: "Deleted" },
  { id: "restored", label: "Restored" },
  { id: "imported", label: "Imported" },
];

const dateStart = (value: string) => (value ? new Date(`${value}T00:00:00`).toISOString() : undefined);
const dayAfter = (value: string) => {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
};

type Props = {
  tableId: string;
  tableName: string;
  fields: Field[];
  initialRecordId?: string;
  onOpenRecord: (recordId: string, deleted: boolean) => void;
  close: () => void;
};

function CombinedAuditDialog(props: Props) {
  const [items, setItems] = createSignal<CombinedAuditEntry[]>([]);
  const [sources, setSources] = createSignal<CombinedAuditPage["sources"]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [recordId, setRecordId] = createSignal(props.initialRecordId ?? "");
  const [sourceRef, setSourceRef] = createSignal("");
  const [action, setAction] = createSignal("");
  const [from, setFrom] = createSignal("");
  const [through, setThrough] = createSignal("");

  const load = async (append: boolean) => {
    if (loading()) return;
    setLoading(true);
    try {
      const response = await apiClient.records["by-table"][":tableId"].audit.$get({
        param: { tableId: props.tableId },
        query: {
          ...(recordId() ? { recordId: recordId() } : {}),
          ...(sourceRef() ? { sourceRef: sourceRef() } : {}),
          ...(action() ? { action: action() as "created" | "updated" | "deleted" | "restored" | "imported" } : {}),
          ...(dateStart(from()) ? { from: dateStart(from()) } : {}),
          ...(dayAfter(through()) ? { to: dayAfter(through()) } : {}),
          ...(append && cursor() ? { cursor: cursor()! } : {}),
          limit: "50",
        },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not load Combined audit"));
      const page = (await response.json()) as CombinedAuditPage;
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setSources(page.sources);
      setCursor(page.nextCursor);
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not load Combined audit");
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => void load(false);
  const clearFilters = () => {
    setRecordId("");
    setSourceRef("");
    setAction("");
    setFrom("");
    setThrough("");
    queueMicrotask(() => void load(false));
  };
  const openRecord = (id: string, deleted: boolean) => {
    props.close();
    props.onOpenRecord(id, deleted);
  };

  onMount(() => void load(false));

  return (
    <PanelDialog>
      <PanelDialog.Header title="Audit trail" subtitle={props.tableName} icon="ti ti-history" close={props.close} />
      <PanelDialog.Body scrollPreserveKey={`grids-combined-audit-${props.tableId}`}>
        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <RecordPicker
            tableId={props.tableId}
            value={recordId}
            onChange={setRecordId}
            label="Record"
            placeholder="All records"
            clearable
            includeDeleted
          />
          <Select
            label="Source"
            value={sourceRef}
            onChange={setSourceRef}
            options={[
              { id: "", label: "All published sources" },
              ...sources().map((source) => ({
                id: source.ref,
                label: `${source.baseName} · ${source.tableName}`,
              })),
            ]}
          />
          <Select label="Action" value={action} onChange={setAction} options={ACTION_OPTIONS} />
          <DatePicker label="From" value={() => from() || null} onChange={(value) => setFrom(value ?? "")} clearable />
          <DatePicker label="Through" value={() => through() || null} onChange={(value) => setThrough(value ?? "")} clearable />
        </div>
        <div class="mt-2 flex items-center gap-2">
          <button type="button" class="btn-primary btn-sm" onClick={applyFilters} disabled={loading()}>
            <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-filter"}`} aria-hidden="true" />
            Apply
          </button>
          <button type="button" class="btn-simple btn-sm" onClick={clearFilters} disabled={loading()}>
            Clear
          </button>
          <span class="ml-auto text-xs text-dimmed">{items().length} events loaded</span>
        </div>

        <PanelDialog.Section
          title="Published record history"
          subtitle="Only fields and audit answers published by the active Combined mapping are shown."
          icon="ti ti-list-details"
        >
          <RecordHistoryList entries={items()} fields={props.fields} onOpenRecord={openRecord} />
          <Show when={cursor()}>
            <button type="button" class="btn-input btn-sm mt-2 self-start" disabled={loading()} onClick={() => void load(true)}>
              <i class={`ti ${loading() ? "ti-loader-2 animate-spin" : "ti-chevron-down"}`} aria-hidden="true" />
              Load older events
            </button>
          </Show>
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <span />
        <button type="button" class="btn-simple btn-sm" onClick={props.close}>
          Done
        </button>
      </PanelDialog.Footer>
    </PanelDialog>
  );
}

export const openCombinedAuditDialog = (params: Omit<Props, "close">) =>
  dialogCore.open<void>((close) => <CombinedAuditDialog {...params} close={() => close()} />, COMBINED_AUDIT_DIALOG_OPTIONS);
