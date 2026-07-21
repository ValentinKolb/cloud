import { Placeholder } from "@valentinkolb/cloud/ui";
import type { DateContext } from "@valentinkolb/stdlib";
import { Show } from "solid-js";
import type { AggregationSpec, ColumnSpec, DocumentTemplateSummary, GroupBySpec, RecordQuery, TableAuditPolicy } from "../../../contracts";
import type { Field, GridRecord } from "../../../service";
import RecordDetailPanel from "../records/RecordDetailPanel";
import GroupDetailPanel from "../table/GroupDetailPanel";
import type { GroupBucket } from "../table/GroupedTable";
import type { WorkspaceRecordDetail } from "../workspace/workspace-state-model";

type Props = {
  baseId: string;
  baseShortId: string;
  tableId: string;
  tableName: string;
  fields: Field[];
  auditPolicy: TableAuditPolicy;
  record: () => GridRecord | null;
  detail: () => WorkspaceRecordDetail | null;
  recordFailure: Error | null;
  selectedGroup: GroupBucket | null;
  query: RecordQuery;
  groupBy: GroupBySpec[];
  aggregations: AggregationSpec[];
  documentTemplates: DocumentTemplateSummary[];
  mode: () => "live" | "trash";
  canWrite: boolean;
  relationLabels: Record<string, string>;
  tableShortIds: Record<string, string>;
  fieldsByTable: Record<string, Field[]>;
  viewColumns: ColumnSpec[] | undefined;
  dateConfig?: DateContext;
  onCloseRecord: () => void;
  onRetryRecord: () => void;
  onRecordUpdated: (record: GridRecord) => void;
  onRecordRemoved: () => void;
  onCloseGroup: () => void;
  onOpenGroupedRecord: (record: GridRecord) => void;
};

export default function RecordsDetailSurface(props: Props) {
  const fieldsByTable = () => ({ ...props.fieldsByTable, [props.tableId]: props.fields });

  return (
    <Show
      when={props.selectedGroup}
      fallback={
        <Show
          when={!props.recordFailure}
          fallback={
            <Placeholder
              state="error"
              surface="paper"
              title="Could not load record"
              description={props.recordFailure?.message}
              class="h-full"
              action={
                <div class="flex items-center gap-1">
                  <button type="button" class="btn-input btn-input-sm" onClick={props.onCloseRecord}>
                    Close
                  </button>
                  <button type="button" class="btn-input btn-input-sm" onClick={props.onRetryRecord}>
                    <i class="ti ti-refresh" aria-hidden="true" /> Retry
                  </button>
                </div>
              }
            />
          }
        >
          <RecordDetailPanel
            baseId={props.baseId}
            baseShortId={props.baseShortId}
            tableId={props.tableId}
            tableName={props.tableName}
            fields={props.fields}
            auditPolicy={props.auditPolicy}
            record={props.record}
            detail={props.detail}
            documentTemplates={props.documentTemplates}
            mode={props.mode}
            canWrite={props.canWrite}
            relationLabels={props.relationLabels}
            tableShortIds={props.tableShortIds}
            fieldsByTable={fieldsByTable()}
            viewColumns={props.viewColumns}
            onClose={props.onCloseRecord}
            onUpdated={props.onRecordUpdated}
            onRemoved={props.onRecordRemoved}
            dateConfig={props.dateConfig}
          />
        </Show>
      }
    >
      {(bucket) => (
        <GroupDetailPanel
          tableId={props.tableId}
          fields={props.fields}
          query={props.query}
          groupBy={props.groupBy}
          aggregations={props.aggregations}
          bucket={bucket()}
          relationLabels={props.relationLabels}
          onClose={props.onCloseGroup}
          onOpenRecord={props.onOpenGroupedRecord}
          dateConfig={props.dateConfig}
        />
      )}
    </Show>
  );
}
