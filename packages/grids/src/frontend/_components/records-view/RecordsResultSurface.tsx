import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { type ComponentProps, Match, Switch } from "solid-js";
import type { AggregationSpec, ColumnSpec, GroupBySpec, RecordDisplayConfig } from "../../../contracts";
import type { Field, GridFilePreview, GridRecord } from "../../../service";
import DatabaseTable from "../table/DatabaseTable";
import GroupedTable, { type GroupBucket } from "../table/GroupedTable";
import type { CardSize, RecordsState } from "./query-url";
import { RecordCalendarView } from "./RecordCalendarView";
import { RecordCardsView } from "./RecordCardsView";

type DatabaseTableProps = ComponentProps<typeof DatabaseTable>;

type Props = {
  grouped: boolean;
  mode: RecordDisplayConfig["mode"];
  trashMode: boolean;
  loading: boolean;
  cursor: string | null;
  nextCursor: string | null;
  tableId: string;
  viewShortId: string | null;
  baseShortId: string;
  tableShortIds: Record<string, string>;
  fieldsByTable: Record<string, Field[]>;
  fields: Field[];
  items: GridRecord[];
  buckets: GroupBucket[];
  groupBy: GroupBySpec[];
  aggregations: AggregationSpec[];
  groupedExplode: boolean;
  relationLabels: Record<string, string>;
  selectedGroup: GroupBucket | null;
  selectedRecordId: string | null;
  highlightedRecordIds: ReadonlySet<string>;
  filePreviews: Record<string, Record<string, GridFilePreview>>;
  displayConfig: RecordDisplayConfig;
  calendarState: RecordsState["calendar"];
  cardSize: CardSize;
  viewColumns: ColumnSpec[] | undefined;
  aggregates: Record<string, unknown>;
  aggregationSpecs: AggregationSpec[];
  groupedColumnOrder: string[];
  hiddenGroupedColumnIds: string[] | undefined;
  adminMode: boolean;
  canManageTable: boolean;
  savedView: boolean;
  canEditView: boolean;
  resultNarrowed: boolean;
  onClearResultNarrowing: () => void;
  bulkSelection: DatabaseTableProps["bulkSelection"];
  dateConfig?: DateContext;
  onRecordClick: (record: GridRecord) => void;
  onCalendarChange: (next: RecordsState["calendar"]) => void;
  onGroupClick: (bucket: GroupBucket) => void;
  onLoadMore: () => void;
  onFieldSettings: NonNullable<DatabaseTableProps["onFieldSettings"]>;
  onViewColumnSettings: NonNullable<DatabaseTableProps["onViewColumnSettings"]>;
  onViewColumnMove: NonNullable<DatabaseTableProps["onViewColumnMove"]>;
  onGroupedColumnSettings: (columnId: string) => void;
  onGroupedColumnMove: (columnId: string, direction: -1 | 1) => void;
};

const groupBucketKey = (bucket: GroupBucket | null): string | null => (bucket ? JSON.stringify(bucket.keys) : null);

export default function RecordsResultSurface(props: Props) {
  const fieldsByTable = () => ({ ...props.fieldsByTable, [props.tableId]: props.fields });
  const hasMore = () => !props.trashMode && Boolean(props.nextCursor);
  const loadingMore = () => props.loading && Boolean(props.cursor);
  const emptyNarrowedResult = () =>
    props.resultNarrowed && !props.loading && (props.grouped ? props.buckets.length === 0 : props.items.length === 0);

  return (
    <div class="flex-1 min-h-0 flex flex-col gap-2">
      <Switch
        fallback={
          <DatabaseTable
            result={{ items: props.items, fields: props.fields, nextCursor: null }}
            baseId={props.baseShortId}
            tableShortIds={props.tableShortIds}
            fieldsByTable={fieldsByTable()}
            selectedId={props.selectedRecordId}
            highlightedIds={props.highlightedRecordIds}
            onRecordClick={props.onRecordClick}
            viewColumns={props.viewColumns}
            aggregates={props.trashMode ? {} : props.aggregates}
            aggregationSpecs={props.aggregationSpecs}
            hasMore={hasMore()}
            loadingMore={loadingMore()}
            onLoadMore={props.onLoadMore}
            scrollPreserveKey={`grids-records-${props.tableId}-${props.viewShortId ?? "default"}`}
            adminMode={props.adminMode}
            onFieldSettings={props.adminMode && !props.savedView && props.canManageTable ? props.onFieldSettings : undefined}
            onViewColumnSettings={props.adminMode && props.savedView && props.canEditView ? props.onViewColumnSettings : undefined}
            onViewColumnMove={
              props.adminMode && (props.savedView ? props.canEditView : props.canManageTable) ? props.onViewColumnMove : undefined
            }
            bulkSelection={props.bulkSelection}
            dateConfig={props.dateConfig}
          />
        }
      >
        <Match when={emptyNarrowedResult()}>
          <Placeholder
            variant="panel"
            icon="ti ti-search"
            title="No matching records"
            description="Clear the current search and filters to see all available records."
            class="flex-1"
            action={
              <button type="button" class="btn-input btn-input-sm" onClick={props.onClearResultNarrowing}>
                <i class="ti ti-filter-off" aria-hidden="true" />
                Clear search and filters
              </button>
            }
          />
        </Match>
        <Match when={props.grouped}>
          <GroupedTable
            baseId={props.baseShortId}
            tableShortIds={props.tableShortIds}
            fields={props.fields}
            groupBy={props.groupBy}
            aggregations={props.aggregations}
            buckets={props.buckets}
            explode={props.groupedExplode}
            relationLabels={props.relationLabels}
            selectedBucketKey={groupBucketKey(props.selectedGroup)}
            onBucketClick={props.onGroupClick}
            adminMode={props.adminMode && props.savedView && props.canEditView}
            columnOrder={props.groupedColumnOrder}
            hiddenColumnIds={props.hiddenGroupedColumnIds}
            scrollPreserveKey={`grids-groups-${props.tableId}-${props.viewShortId ?? "default"}`}
            onColumnSettings={props.onGroupedColumnSettings}
            onColumnMove={props.onGroupedColumnMove}
            dateConfig={props.dateConfig}
            hasMore={hasMore()}
            loadingMore={loadingMore()}
            onLoadMore={props.onLoadMore}
          />
        </Match>
        <Match when={props.mode === "cards"}>
          <RecordCardsView
            items={props.items}
            fields={props.fields}
            displayConfig={props.displayConfig}
            filePreviews={props.filePreviews}
            baseId={props.baseShortId}
            tableId={props.tableId}
            tableShortIds={props.tableShortIds}
            fieldsByTable={fieldsByTable()}
            selectedId={props.selectedRecordId}
            highlightedIds={props.highlightedRecordIds}
            onRecordClick={props.onRecordClick}
            cardSize={props.cardSize}
            hasMore={hasMore()}
            loadingMore={loadingMore()}
            onLoadMore={props.onLoadMore}
            dateConfig={props.dateConfig}
          />
        </Match>
        <Match when={props.mode === "calendar"}>
          <RecordCalendarView
            items={props.items}
            fields={props.fields}
            displayConfig={props.displayConfig}
            calendarState={props.calendarState}
            onCalendarChange={props.onCalendarChange}
            selectedRecordId={props.selectedRecordId}
            onRecordClick={props.onRecordClick}
            dateConfig={props.dateConfig}
            fieldsByTable={fieldsByTable()}
            hasMore={hasMore()}
            loadingMore={loadingMore()}
            onLoadMore={props.onLoadMore}
          />
        </Match>
      </Switch>
    </div>
  );
}
