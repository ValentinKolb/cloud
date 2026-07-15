import * as access from "./access";
import * as audit from "./audit";
import * as baseCatalog from "./base-catalog";
import * as bases from "./bases";
import * as dashboards from "./dashboards";
import * as documents from "./documents";
import * as emailTemplates from "./email-templates";
import * as exporter from "./export";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import * as fields from "./fields";
import * as files from "./files";
import { submitForm } from "./form-submission";
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
import { invokeBulkLauncher, invokeDashboardLauncher, invokeScannerLauncher } from "./workflow-kernel-launchers";
import { getWorkflowRun } from "./workflow-kernel-runs";
import {
  invokeGridsWorkflow,
  reconcileWorkflowKernelRuntime,
  startWorkflowKernelRuntime,
  stopWorkflowKernelRuntime,
} from "./workflow-kernel-runtime";
import {
  createWorkflow,
  getWorkflow,
  getWorkflowByIdOrShortId,
  listRecordEventBaseIds,
  listRecordEventWorkflows,
  listScheduledWorkflows,
  listWorkflows,
  removeWorkflow,
  updateWorkflow,
  validateWorkflowSource,
} from "./workflow-kernel-store";
import { createLauncher, getLauncher, listLaunchers, removeLauncher, updateLauncher } from "./workflow-launchers";

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
    createMany: records.createMany,
    eventOutboxStats: records.recordEventOutboxStats,
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
    listForBaseTree: access.listAccessForBaseTree,
    listForTable: access.listTableAccess,
    listForView: access.listViewAccess,
    listForForm: access.listFormAccess,
    listForDocumentTemplate: access.listDocumentTemplateAccess,
    listForDashboard: access.listDashboardAccess,
    listForWorkflow: access.listWorkflowAccess,
    updateLevel: access.updateAccessLevel,
    revoke: access.revokeAccess,
    resolveBinding: access.resolveAccessBinding,
    resolveResource: access.resolveResourceBinding,
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
    reorderTemplates: documents.reorderTemplates,
    removeTemplate: documents.removeTemplate,
    createRecordSnapshot: documents.createRecordSnapshot,
    createRecordSnapshotDraft: documents.createRecordSnapshotDraft,
    filterSnapshotRelatedRecords: documents.filterSnapshotRelatedRecords,
    getSnapshot: documents.getSnapshot,
    listSnapshotsForRecord: documents.listSnapshotsForRecord,
    buildTemplateAppData: documents.buildTemplateAppData,
    buildTemplateInputContext: documents.buildTemplateInputContext,
    buildRenderData: documents.buildRenderData,
    buildDocumentRunRenderData: documents.buildDocumentRunRenderData,
    buildLiveRenderData: documents.buildLiveRenderData,
    rowsWithColumnLabels: documents.rowsWithColumnLabels,
    renderSource: documents.renderDocumentSource,
    renderHtml: documents.renderDocumentHtml,
    renderPdfPreview: documents.renderDocumentPdfPreview,
    createRun: documents.createDocumentRun,
    createRenderedRun: documents.createRenderedDocumentRun,
    createRunForRecord: documents.createRunForRecord,
    listRunsForRecord: documents.listRunsForRecord,
    listRunsForWorkflowRun: documents.listRunsForWorkflowRun,
    listRunsForTemplate: documents.listRunsForTemplate,
    browseRunsForTemplate: documents.browseRunsForTemplate,
    summarizeRun: documents.summarizeRun,
    getRun: documents.getDocumentRun,
    updateRunMetadata: documents.updateRunMetadata,
    listDocumentLinksForRun: documents.listDocumentLinksForRun,
    getDocumentLink: documents.getDocumentLink,
    createDocumentLink: documents.createDocumentLink,
    revokeDocumentLink: documents.revokeDocumentLink,
    resolveDocumentLinkDownload: documents.resolveDocumentLinkDownload,
    recordDocumentLinkAccess: documents.recordDocumentLinkAccess,
    publicDocumentLinkPath: documents.publicDocumentLinkPath,
    publicDocumentLinkUrl: documents.publicDocumentLinkUrl,
    renderRunPdf: documents.renderRunPdf,
    renderWorkflowRunPdf: documents.renderWorkflowRunPdf,
  },
  emailTemplate: {
    listForBase: emailTemplates.listForBase,
    get: emailTemplates.get,
    getByShortId: emailTemplates.getByShortId,
    getByIdOrShortId: emailTemplates.getByIdOrShortId,
    getByRef: emailTemplates.getByRef,
    create: emailTemplates.create,
    update: emailTemplates.update,
    remove: emailTemplates.remove,
    render: emailTemplates.renderEmailTemplate,
    validateWrite: emailTemplates.validateEmailTemplateWrite,
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
    submit: submitForm,
  },
  file: {
    listForRecordField: files.listForRecordField,
    upload: files.upload,
    getContent: files.getContent,
    remove: files.remove,
  },
  workflow: {
    listForBase: listWorkflows,
    listEnabledForBase: (baseId: string) => listWorkflows(baseId, true),
    listScheduledEnabled: listScheduledWorkflows,
    listRecordEventBaseIds,
    listRecordEventEnabled: listRecordEventWorkflows,
    get: getWorkflow,
    getByIdOrShortId: getWorkflowByIdOrShortId,
    create: createWorkflow,
    update: updateWorkflow,
    remove: removeWorkflow,
    validate: validateWorkflowSource,
    getRun: getWorkflowRun,
    invoke: invokeGridsWorkflow,
    launcher: {
      get: getLauncher,
      list: listLaunchers,
      create: createLauncher,
      update: updateLauncher,
      remove: removeLauncher,
      invokeScanner: invokeScannerLauncher,
      invokeBulk: invokeBulkLauncher,
      invokeDashboard: invokeDashboardLauncher,
    },
    runtime: {
      start: startWorkflowKernelRuntime,
      stop: stopWorkflowKernelRuntime,
      reconcile: reconcileWorkflowKernelRuntime,
    },
  },
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
  ChartWidget,
  Dashboard,
  DashboardConfig,
  DashboardRow,
  FormWidget,
  GroupBySpec,
  LinkWidget,
  MarkdownWidget,
  StatWidget,
  View,
  ViewStatsWidget,
  ViewWidget,
  Widget,
  WidgetFormat,
  WorkflowButtonWidget,
} from "../contracts";
export type { GridsWorkflow as Workflow, GridsWorkflowRun as WorkflowRun } from "../workflows/contracts";
export type { Form, FormFieldEntry } from "./forms";
export type { Grant, ResolveTarget, ResourceType } from "./permission-resolver";
export type {
  AuditEntry,
  Base,
  Field,
  GridFile,
  GridFilePreview,
  GridRecord,
  RecordList,
  Table,
} from "./types";
