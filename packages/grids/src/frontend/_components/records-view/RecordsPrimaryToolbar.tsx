import { Dropdown, Tooltip } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import type { Field } from "../../../service";
import { CardSizeDropdown } from "../toolbar/CardSizeDropdown";
import SearchBar from "../toolbar/SearchBar";
import type { WorkspaceBulkLauncher } from "../workspace/workspace-state-model";
import { bulkWorkflowActionLabel } from "./bulk-selection";
import type { CardSize, RecordsState } from "./query-url";

type Props = {
  searchableFields: Field[];
  search: RecordsState["search"];
  trashMode: boolean;
  canReadTable: boolean;
  tableKind: "stored" | "federated";
  baseShortId: string;
  tableShortId: string;
  recordCountText: string;
  livePending: boolean;
  liveRefreshing: boolean;
  cardsMode: boolean;
  viewMode: boolean;
  cardSize: CardSize;
  recordMetaCount: number;
  bulkSelectionEnabled: boolean;
  selectedBulkCount: number;
  bulkLaunchers: WorkspaceBulkLauncher[];
  queryHref: string;
  onSearchChange: (next: { q: string; fieldIds: string[] }) => void;
  onRefresh: () => void;
  onCardSizeChange: (size: CardSize) => void;
  onOpenRecordMetadata: () => void;
  onClearBulkSelection: () => void;
  onQueueBulkWorkflow: (launcher: WorkspaceBulkLauncher) => void;
  onExport: () => void;
  onOpenCombinedAudit: () => void;
};

export default function RecordsPrimaryToolbar(props: Props) {
  return (
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <Show when={props.searchableFields.length > 0}>
        <div class="flex-1 min-w-0">
          <SearchBar
            fields={props.searchableFields}
            initialQ={props.search.q}
            initialQFields={props.search.fieldIds}
            onSearchChange={props.onSearchChange}
          />
        </div>
      </Show>

      <span class="text-xs text-dimmed whitespace-nowrap">
        {props.trashMode && "Deleted: "}
        {props.recordCountText}
      </span>
      <Show when={props.livePending || props.liveRefreshing}>
        <Tooltip content="Refresh records">
          <button type="button" class="btn-input btn-input-sm app-accent-text" disabled={props.liveRefreshing} onClick={props.onRefresh}>
            <i class={`ti ${props.liveRefreshing ? "ti-loader-2 animate-spin" : "ti-refresh"}`} />
            Updates available
          </button>
        </Tooltip>
      </Show>
      <Show when={props.cardsMode && (props.viewMode || props.trashMode)}>
        <CardSizeDropdown value={props.cardSize} onChange={props.onCardSizeChange} />
      </Show>

      <Show
        when={!props.trashMode}
        fallback={
          <Show when={props.canReadTable}>
            <a href={`/app/grids/${props.baseShortId}/table/${props.tableShortId}`} class="btn-input btn-input-sm">
              <i class="ti ti-arrow-back" />
              Back to live records
            </a>
          </Show>
        }
      >
        <Show when={props.recordMetaCount > 0}>
          <button type="button" class="btn-input btn-input-active btn-input-sm" onClick={props.onOpenRecordMetadata}>
            <i class="ti ti-user-search" />
            Record info · {props.recordMetaCount}
          </button>
        </Show>
        <Show when={props.bulkSelectionEnabled && props.selectedBulkCount > 0}>
          <button type="button" class="btn-input btn-input-active btn-input-sm" onClick={props.onClearBulkSelection}>
            <i class="ti ti-checklist" />
            {props.selectedBulkCount} selected
            <i class="ti ti-x text-[10px] opacity-60" />
          </button>
        </Show>
        <Dropdown
          position="bottom-left"
          trigger={
            <span class="btn-input btn-input-sm">
              Actions
              <i class="ti ti-chevron-down text-[10px] opacity-60" />
            </span>
          }
          elements={[
            { icon: "ti ti-user-search", label: "Record metadata", action: props.onOpenRecordMetadata },
            { icon: "ti ti-download", label: "Export records", action: props.onExport },
            ...props.bulkLaunchers.map((launcher) => ({
              icon: "ti ti-route",
              label: bulkWorkflowActionLabel(launcher.name, props.selectedBulkCount),
              action: () => props.onQueueBulkWorkflow(launcher),
            })),
            { icon: "ti ti-code", label: "Open query", href: props.queryHref },
            ...(props.tableKind === "federated" && props.canReadTable
              ? [{ icon: "ti ti-history", label: "Audit trail", action: props.onOpenCombinedAudit }]
              : []),
            ...(props.canReadTable
              ? [
                  {
                    icon: "ti ti-archive",
                    label: "Show deleted",
                    href: `/app/grids/${props.baseShortId}/table/${props.tableShortId}?trash=1`,
                  },
                ]
              : []),
          ]}
        />
      </Show>
    </div>
  );
}
