import * as bases from "./bases";
import * as tables from "./tables";
import * as fields from "./fields";
import * as records from "./records";
import * as audit from "./audit";
import * as access from "./access";
import * as views from "./views";
import * as forms from "./forms";
import * as exporter from "./export";
import * as maintenance from "./maintenance";
import * as relationsModule from "./relations";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import { resolveEffectivePermission, loadGrantsForUser, hasAtLeast } from "./permission-resolver";

export const gridsService = {
  base: {
    list: bases.list,
    get: bases.get,
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
    create: tables.create,
    update: tables.update,
    remove: tables.remove,
    restore: tables.restore,
  },
  field: {
    listByTable: fields.listByTable,
    listTrashedByBase: fields.listTrashedByBase,
    get: fields.get,
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
    updateLevel: access.updateAccessLevel,
    revoke: access.revokeAccess,
    resolveBinding: access.resolveAccessBinding,
  },
  view: {
    listForTable: views.listForTable,
    get: views.get,
    create: views.create,
    update: views.update,
    remove: views.remove,
    restore: views.restore,
  },
  form: {
    listForTable: forms.listForTable,
    listTrashedByBase: forms.listTrashedByBase,
    get: forms.get,
    getByPublicToken: forms.getByPublicToken,
    create: forms.create,
    update: forms.update,
    remove: forms.remove,
    restore: forms.restore,
    buildDefault: forms.buildDefaultForm,
  },
  exporter: {
    exportRecords: exporter.exportRecords,
  },
  maintenance: {
    purgeSoftDeleted: maintenance.purgeSoftDeleted,
  },
  relations: {
    buildLabelCache: relationsModule.buildRelationLabelCache,
    lookup: relationsModule.lookupRecords,
  },
};

export { bases, tables, fields, records, audit, access, views, forms, exporter, maintenance };
export type { View, ViewQuery, ColumnSpec, FormatSpec } from "./views";
export type { Form, FormConfig, FormFieldEntry } from "./forms";
export type { Base, Table, Field, GridRecord, AuditEntry, AuditAction } from "./types";
export type { FieldDependent } from "./field-dependents";
export type { Grant, ResourceType, ResolveTarget } from "./permission-resolver";
export type { FilterTree, FilterLeaf, FilterGroup } from "./filter-compiler";
export type { SortSpec } from "./sort-compiler";
export type { AggregateRequest, AggKind } from "./aggregate-compiler";
