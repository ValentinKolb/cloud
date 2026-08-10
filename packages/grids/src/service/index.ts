import * as access from "./access";
import * as audit from "./audit";
import * as baseCatalog from "./base-catalog";
import * as bases from "./bases";
import * as combinedAudit from "./combined-audit";
import * as customApps from "./custom-apps";
import * as documents from "./documents";
import * as emailTemplates from "./email-templates";
import * as exporter from "./export";
import * as federatedTables from "./federated-tables";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import * as fields from "./fields";
import * as files from "./files";
import { submitForm } from "./form-submission";
import * as forms from "./forms";
import * as formulaPreview from "./formula-preview";
import * as metadataEvents from "./metadata-events";
import { getOperationalHealth } from "./operational-health";
import {
  hasAtLeast,
  hasGrantsForResource,
  loadBaseTableGrantsForSubject,
  loadBaseWorkflowGrantsForSubject,
  loadGrantsForSubject,
  loadGrantsForUser,
  resolveAuthorizedRecordAccess,
  resolveEffectivePermission,
} from "./permission-resolver";
import { listDeadRecordEventDeliveryFailures } from "./record-event-delivery-failures";
import * as recordHistory from "./record-history";
import * as recordComments from "./record-comments";
import * as records from "./records";
import * as relationsModule from "./relations";
import * as tables from "./tables";
import * as templates from "./templates";
import * as views from "./views";
import {
  createWorkflow,
  getWorkflow,
  getWorkflowByIdOrShortId,
  listRecordEventBaseIds,
  listRecordEventWorkflows,
  listScheduledWorkflows,
  listWorkflowScopes,
  listWorkflows,
  removeWorkflow,
  updateWorkflow,
  validateWorkflowSource,
} from "./workflow-definitions";
import { invokeBulkLauncher, invokeCustomAppLauncher, invokeScannerLauncher } from "./workflow-launcher-invocations";
import { createLauncher, getLauncher, listLaunchers, removeLauncher, updateLauncher } from "./workflow-launchers";
import { replayWorkflowRecordEventDeliveryFailure } from "./workflow-record-events";
import { getWorkflowRun } from "./workflow-runs";
import { invokeGridsWorkflow, reconcileWorkflowRuntime, startWorkflowRuntime, stopWorkflowRuntime } from "./workflow-runtime";

export const gridsService = {
  operations: {
    health: getOperationalHealth,
  },
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
    federation: {
      getDraft: federatedTables.getDraft,
      getCurrent: federatedTables.getCurrent,
      getActive: federatedTables.getActive,
      captureRevisionScope: federatedTables.captureRevisionScope,
      validateDraft: federatedTables.validateDraft,
      sourceIdsRequiringAuthorization: federatedTables.sourceIdsRequiringAuthorization,
      listSourceCandidates: federatedTables.listSourceCandidates,
      updateDraft: federatedTables.updateDraft,
      publishDraft: federatedTables.publishDraft,
      revokeSource: federatedTables.revokeSource,
      listPublicationsForSource: federatedTables.listPublicationsForSource,
      refreshForField: federatedTables.refreshForField,
      refreshForSourceTable: federatedTables.refreshForSourceTable,
      refreshForSourceBase: federatedTables.refreshForSourceBase,
    },
  },
  field: {
    listByTable: fields.listByTable,
    listByTables: fields.listByTables,
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
    countAccessibleByTable: records.countAccessibleByTable,
    get: records.get,
    create: records.create,
    createMany: records.createMany,
    eventOutboxStats: records.recordEventOutboxStats,
    redriveEventOutbox: records.redriveRecordEventOutbox,
    update: records.update,
    softDelete: records.softDelete,
    restore: records.restore,
    listActors: records.listActors,
    aggregate: records.aggregate,
    group: records.group,
    comments: {
      list: recordComments.list,
      create: recordComments.create,
      update: recordComments.update,
      remove: recordComments.remove,
    },
  },
  audit: {
    log: audit.logAudit,
    list: audit.listAudit,
    listByRecord: recordHistory.listByRecord,
    combined: {
      describeRecord: combinedAudit.describeRecord,
      list: combinedAudit.list,
    },
  },
  permission: {
    resolve: resolveEffectivePermission,
    resolveRecordAccess: resolveAuthorizedRecordAccess,
    loadGrants: loadGrantsForUser,
    loadGrantsForSubject,
    loadBaseTableGrantsForSubject,
    loadBaseWorkflowGrantsForSubject,
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
    listForCustomApp: access.listCustomAppAccess,
    listForWorkflow: access.listWorkflowAccess,
    updateLevel: access.updateAccessLevel,
    revoke: access.revokeAccess,
    resolveBinding: access.resolveAccessBinding,
    resolveResource: access.resolveResourceBinding,
  },
  customApp: {
    compile: customApps.compile,
    plan: customApps.plan,
    apply: customApps.apply,
    saveDraft: customApps.saveDraft,
    restoreDraft: customApps.restoreDraft,
    createBlank: customApps.createBlank,
    publish: customApps.publish,
    unpublish: customApps.unpublish,
    remove: customApps.remove,
    get: customApps.get,
    getByIdOrShortId: customApps.getByIdOrShortId,
    getPublishedByShortId: customApps.getPublishedByShortId,
    listByBase: customApps.listByBase,
    listSummariesByBase: customApps.listSummariesByBase,
  },
  view: {
    listForTable: views.listForTable,
    listForTables: views.listForTables,
    get: views.get,
    getByShortId: views.getByShortId,
    getByIdOrShortId: views.getByIdOrShortId,
    create: views.create,
    update: views.update,
    remove: views.remove,
    restore: views.restore,
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
    listRunSummariesForRecordByTemplates: documents.listRunSummariesForRecordByTemplates,
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
    listDependenciesForBase: emailTemplates.listDependenciesForBase,
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
    listForRecord: files.listForRecord,
    listForRecordField: files.listForRecordField,
    listFirstImagePreviews: files.listFirstImagePreviews,
    upload: files.upload,
    getContent: files.getContent,
    remove: files.remove,
  },
  workflow: {
    listForBase: listWorkflows,
    listScopesForBase: listWorkflowScopes,
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
      invokeCustomApp: invokeCustomAppLauncher,
    },
    runtime: {
      start: startWorkflowRuntime,
      stop: stopWorkflowRuntime,
      reconcile: reconcileWorkflowRuntime,
      listDeadRecordEvents: listDeadRecordEventDeliveryFailures,
      replayDeadRecordEvent: replayWorkflowRecordEventDeliveryFailure,
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
  GroupBySpec,
  View,
} from "../contracts";
export type { GridsWorkflow as Workflow } from "../workflows/contracts";
export type { CombinedAuditEntry, CombinedAuditPage, CombinedRecordOrigin } from "./combined-audit";
export type { CustomApp, CustomAppSummary } from "./custom-apps";
export type { Form, FormFieldEntry } from "./forms";
export type { Grant, ResolveTarget, ResourceType } from "./permission-resolver";
export type { RecordHistoryEntry } from "./record-history";
export type {
  Base,
  Field,
  GridFile,
  GridFilePreview,
  GridRecord,
  RecordList,
  Table,
} from "./types";
