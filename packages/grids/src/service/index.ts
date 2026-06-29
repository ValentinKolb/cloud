import * as access from "./access";
import * as audit from "./audit";
import * as automations from "./automations";
import { automationRuntime } from "./automations-runtime";
import * as baseCatalog from "./base-catalog";
import * as bases from "./bases";
import * as dashboards from "./dashboards";
import * as documents from "./documents";
import * as exporter from "./export";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import * as fields from "./fields";
import * as files from "./files";
import * as forms from "./forms";
import * as formulaPreview from "./formula-preview";
import * as maintenance from "./maintenance";
import * as metadataEvents from "./metadata-events";
import { hasAtLeast, hasGrantsForResource, loadGrantsForUser, resolveEffectivePermission } from "./permission-resolver";
import * as records from "./records";
import * as relationsModule from "./relations";
import * as tables from "./tables";
import * as templates from "./templates";
import * as views from "./views";

export const gridsService = {
  base: {
    list: bases.list,
    listVisible: bases.listVisible,
    catalog: baseCatalog.listForBase,
    get: bases.get,
    getByShortId: bases.getByShortId,
    getByIdOrShortId: bases.getByIdOrShortId,
    create: bases.create,
    update: bases.update,
    remove: bases.remove,
    restore: bases.restore,
    admin: {
      list: bases.adminList,
      summary: bases.adminSummary,
    },
  },
  table: {
    listByBase: tables.listByBase,
    listTrashedByBase: tables.listTrashedByBase,
    get: tables.get,
    getByShortId: tables.getByShortId,
    getByIdOrShortId: tables.getByIdOrShortId,
    create: tables.create,
    update: tables.update,
    remove: tables.remove,
    restore: tables.restore,
  },
  field: {
    listByTable: fields.listByTable,
    listTrashedByBase: fields.listTrashedByBase,
    get: fields.get,
    getByShortId: fields.getByShortId,
    create: fields.create,
    update: fields.update,
    reorder: fields.reorder,
    softDelete: fields.softDelete,
    restore: fields.restore,
  },
  record: {
    list: records.list,
    get: records.get,
    create: records.create,
    createInTransaction: records.createInTransaction,
    emitCreatedEvent: records.emitCreatedRecordEvent,
    update: records.update,
    softDelete: records.softDelete,
    restore: records.restore,
    listActors: records.listActors,
    aggregate: records.aggregate,
    group: records.group,
  },
  audit: {
    log: audit.logAudit,
    list: audit.listAudit,
    listByRecord: audit.listByRecord,
  },
  permission: {
    resolve: resolveEffectivePermission,
    loadGrants: loadGrantsForUser,
    hasAtLeast,
    hasGrantsForResource,
  },
  fieldDependents: {
    get: getFieldDependents,
    hasBlocking: hasBlockingDependents,
  },
  access: {
    grant: access.grantAccess,
    listForBase: access.listBaseAccess,
    listForTable: access.listTableAccess,
    listForView: access.listViewAccess,
    listForForm: access.listFormAccess,
    listForDocumentTemplate: access.listDocumentTemplateAccess,
    listForDashboard: access.listDashboardAccess,
    updateLevel: access.updateAccessLevel,
    revoke: access.revokeAccess,
    resolveBinding: access.resolveAccessBinding,
  },
  view: {
    listForTable: views.listForTable,
    get: views.get,
    getByShortId: views.getByShortId,
    getByIdOrShortId: views.getByIdOrShortId,
    create: views.create,
    update: views.update,
    remove: views.remove,
    restore: views.restore,
  },
  dashboard: {
    listForBase: dashboards.listForBase,
    listTrashedByBase: dashboards.listTrashedByBase,
    get: dashboards.get,
    getByShortId: dashboards.getByShortId,
    getByIdOrShortId: dashboards.getByIdOrShortId,
    sourceTableIds: dashboards.sourceTableIds,
    create: dashboards.create,
    update: dashboards.update,
    remove: dashboards.remove,
    restore: dashboards.restore,
  },
  document: {
    listTemplatesForTable: documents.listTemplatesForTable,
    getTemplate: documents.getTemplate,
    getTemplateByShortId: documents.getTemplateByShortId,
    getTemplateByIdOrShortId: documents.getTemplateByIdOrShortId,
    summarizeTemplate: documents.summarizeTemplate,
    createTemplate: documents.createTemplate,
    updateTemplate: documents.updateTemplate,
    removeTemplate: documents.removeTemplate,
    createRecordSnapshot: documents.createRecordSnapshot,
    getSnapshot: documents.getSnapshot,
    listSnapshotsForRecord: documents.listSnapshotsForRecord,
    buildTemplateAppData: documents.buildTemplateAppData,
    buildTemplateInputContext: documents.buildTemplateInputContext,
    buildRenderData: documents.buildRenderData,
    buildLiveRenderData: documents.buildLiveRenderData,
    rowsWithColumnLabels: documents.rowsWithColumnLabels,
    renderSource: documents.renderDocumentSource,
    renderHtml: documents.renderDocumentHtml,
    renderPdfPreview: documents.renderDocumentPdfPreview,
    createRun: documents.createRun,
    createRunForRecord: documents.createRunForRecord,
    listRunsForRecord: documents.listRunsForRecord,
    summarizeRun: documents.summarizeRun,
    getRun: documents.getRun,
    renderRunPdf: documents.renderRunPdf,
  },
  form: {
    listForTable: forms.listForTable,
    listTrashedByBase: forms.listTrashedByBase,
    get: forms.get,
    getByShortId: forms.getByShortId,
    getByPublicToken: forms.getByPublicToken,
    create: forms.create,
    update: forms.update,
    remove: forms.remove,
    restore: forms.restore,
    buildDefault: forms.buildDefaultForm,
    toRenderableForm: forms.toRenderableForm,
    toPublicRenderableForm: forms.toPublicRenderableForm,
  },
  file: {
    listForRecordField: files.listForRecordField,
    upload: files.upload,
    getContent: files.getContent,
    remove: files.remove,
  },
  automation: {
    listForBase: automations.listForBase,
    listScheduledEnabled: automations.listScheduledEnabled,
    get: automations.get,
    create: automations.create,
    update: automations.update,
    remove: automations.remove,
    listRuns: automations.listRuns,
    execute: automations.execute,
    markStaleRunningRunsFailed: automations.markStaleRunningRunsFailed,
    purgeOldRuns: automations.purgeOldRuns,
  },
  automationRuntime,
  template: {
    list: templates.list,
    get: templates.get,
    instantiate: templates.instantiate,
  },
  exporter: {
    exportRecords: exporter.exportRecords,
  },
  maintenance: {
    purgeSoftDeleted: maintenance.purgeSoftDeleted,
  },
  formulaPreview: {
    check: formulaPreview.checkFormula,
  },
  relations: {
    buildLabelCache: relationsModule.buildRelationLabelCache,
    buildLabelCacheForGroupedKeys: relationsModule.buildLabelCacheForGroupedKeys,
    buildExpansionCache: relationsModule.buildRelationExpansionCache,
    lookup: relationsModule.lookupRecords,
  },
  metadataEvents,
};

export type {
  AggregationSpec,
  AutomationButtonWidget,
  ChartWidget,
  Dashboard,
  DashboardConfig,
  DashboardRow,
  FormWidget,
  GroupBySpec,
  LinkWidget,
  MarkdownWidget,
  StatTone,
  StatTrend,
  StatWidget,
  ViewStatsWidget,
  ViewWidget,
  Widget,
  WidgetFormat,
} from "../contracts";
export type { AggKind, AggregateRequest } from "./aggregate-compiler";
export type { FieldDependent } from "./field-dependents";
export type { FilterGroup, FilterLeaf, FilterTree } from "./filter-compiler";
export type { Form, FormConfig, FormFieldEntry } from "./forms";
export type { Grant, ResolveTarget, ResourceType } from "./permission-resolver";
export type { ExpansionViewer } from "./relations";
export type { SortSpec } from "./sort-compiler";
export type {
  AuditAction,
  AuditEntry,
  Automation,
  AutomationAction,
  AutomationPayloadConfig,
  AutomationRun,
  AutomationSubject,
  AutomationTrigger,
  Base,
  Field,
  GridFile,
  GridFileContent,
  GridFilePreview,
  GridRecord,
  RecordList,
  Table,
} from "./types";
export type { ColumnSpec, FormatSpec, RecordQuery, View } from "./views";
export {
  access,
  audit,
  automationRuntime,
  automations,
  bases,
  dashboards,
  documents,
  exporter,
  fields,
  files,
  forms,
  formulaPreview,
  maintenance,
  metadataEvents,
  records,
  tables,
  templates,
  views,
};
