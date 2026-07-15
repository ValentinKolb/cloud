import type { DocumentTemplateSummary } from "../../../contracts";
import type { Field } from "../../../service";
import { gridsService } from "../../../service";
import type { WorkspaceCommon, WorkspaceRecordDetail } from "./workspace-state-model";

const DETAIL_PAGE_SIZE = 100;

export const writableDocumentTemplates = (common: WorkspaceCommon, tableId: string): DocumentTemplateSummary[] =>
  (common.catalog.documentTemplatesByTable[tableId] ?? []).filter(
    (template) =>
      template.enabled && gridsService.permission.hasAtLeast(common.catalog.documentTemplateLevels[template.id] ?? "none", "write"),
  );

export const loadRecordDetailData = async (params: {
  tableId: string;
  recordId: string;
  fields: Field[];
}): Promise<WorkspaceRecordDetail> => {
  const fileFieldIds = params.fields.filter((field) => field.type === "file" && !field.deletedAt).map((field) => field.id);
  const [filesByField, documentRuns, snapshots, auditEntries] = await Promise.all([
    gridsService.file.listForRecord({ tableId: params.tableId, recordId: params.recordId, fieldIds: fileFieldIds }),
    gridsService.document.listRunsForRecord(params.tableId, params.recordId, DETAIL_PAGE_SIZE),
    gridsService.document.listSnapshotsForRecord(params.tableId, params.recordId, DETAIL_PAGE_SIZE),
    gridsService.audit.listByRecord(params.tableId, params.recordId, 50),
  ]);
  return {
    recordId: params.recordId,
    filesByField,
    documentRuns: documentRuns.map(gridsService.document.summarizeRun),
    snapshots,
    auditEntries,
  };
};

export const emptyRecordDetail = (recordId: string): WorkspaceRecordDetail => ({
  recordId,
  filesByField: {},
  documentRuns: [],
  snapshots: [],
  auditEntries: [],
});
