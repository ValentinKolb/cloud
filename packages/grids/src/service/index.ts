import * as bases from "./bases";
import * as baseCatalog from "./base-catalog";
import * as tables from "./tables";
import * as fields from "./fields";
import * as records from "./records";
import * as audit from "./audit";
import * as access from "./access";
import * as views from "./views";
import * as dashboards from "./dashboards";
import * as forms from "./forms";
import * as files from "./files";
import * as automations from "./automations";
import * as templates from "./templates";
import * as exporter from "./export";
import * as maintenance from "./maintenance";
import * as formulaPreview from "./formula-preview";
import * as relationsModule from "./relations";
import * as metadataEvents from "./metadata-events";
import { automationRuntime } from "./automations-runtime";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import { resolveEffectivePermission, loadGrantsForUser, hasAtLeast, hasGrantsForResource } from "./permission-resolver";

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

export { bases, tables, fields, records, audit, access, views, dashboards, forms, files, automations, templates, automationRuntime, exporter, maintenance, formulaPreview, metadataEvents };
export type { View, ViewQuery, ColumnSpec, FormatSpec } from "./views";
export type {
  Dashboard,
  DashboardConfig,
  DashboardRow,
  Widget,
  StatWidget,
  ChartWidget,
  ViewWidget,
  ViewStatsWidget,
  FormWidget,
  MarkdownWidget,
  LinkWidget,
  AutomationButtonWidget,
  ViewWidgetSource,
  StatSource,
  StatTrend,
  StatTone,
  WidgetFormat,
  AggregationSpec,
  GroupBySpec,
} from "../contracts";
export type { Form, FormConfig, FormFieldEntry } from "./forms";
export type {
  Base,
  Table,
  Field,
  GridRecord,
  RecordList,
  AuditEntry,
  AuditAction,
  GridFile,
  GridFileContent,
  Automation,
  AutomationTrigger,
  AutomationAction,
  AutomationPayloadConfig,
  AutomationSubject,
  AutomationRun,
} from "./types";
export type { ExpansionViewer } from "./relations";
export type { FieldDependent } from "./field-dependents";
export type { Grant, ResourceType, ResolveTarget } from "./permission-resolver";
export type { FilterTree, FilterLeaf, FilterGroup } from "./filter-compiler";
export type { SortSpec } from "./sort-compiler";
export type { AggregateRequest, AggKind } from "./aggregate-compiler";
