import * as bases from "./bases";
import * as tables from "./tables";
import * as fields from "./fields";
import * as records from "./records";
import * as audit from "./audit";
import * as access from "./access";
import * as views from "./views";
import * as dashboards from "./dashboards";
import * as forms from "./forms";
import * as files from "./files";
import * as exporter from "./export";
import * as maintenance from "./maintenance";
import * as relationsModule from "./relations";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import { resolveEffectivePermission, loadGrantsForUser, hasAtLeast, hasGrantsForResource } from "./permission-resolver";

export const gridsService = {
  base: {
    list: bases.list,
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
    get: dashboards.get,
    getByShortId: dashboards.getByShortId,
    getByIdOrShortId: dashboards.getByIdOrShortId,
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
  },
  file: {
    listForRecordField: files.listForRecordField,
    upload: files.upload,
    getContent: files.getContent,
    remove: files.remove,
  },
  exporter: {
    exportRecords: exporter.exportRecords,
  },
  maintenance: {
    purgeSoftDeleted: maintenance.purgeSoftDeleted,
  },
  relations: {
    buildLabelCache: relationsModule.buildRelationLabelCache,
    buildLabelCacheForGroupedKeys: relationsModule.buildLabelCacheForGroupedKeys,
    buildExpansionCache: relationsModule.buildRelationExpansionCache,
    lookup: relationsModule.lookupRecords,
  },
};

export { bases, tables, fields, records, audit, access, views, dashboards, forms, files, exporter, maintenance };
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
  ViewWidgetSource,
  StatSource,
  StatTrend,
  WidgetSource,
  WidgetFormat,
  AggregationSpec,
  GroupBySpec,
} from "../contracts";
export type { Form, FormConfig, FormFieldEntry } from "./forms";
export type { Base, Table, Field, GridRecord, RecordList, AuditEntry, AuditAction, GridFile, GridFileContent } from "./types";
export type { ExpansionViewer } from "./relations";
export type { FieldDependent } from "./field-dependents";
export type { Grant, ResourceType, ResolveTarget } from "./permission-resolver";
export type { FilterTree, FilterLeaf, FilterGroup } from "./filter-compiler";
export type { SortSpec } from "./sort-compiler";
export type { AggregateRequest, AggKind } from "./aggregate-compiler";
