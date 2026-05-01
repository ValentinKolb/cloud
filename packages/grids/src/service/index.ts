import * as bases from "./bases";
import * as tables from "./tables";
import * as fields from "./fields";
import * as records from "./records";
import * as audit from "./audit";
import * as access from "./access";
import { getFieldDependents, hasBlockingDependents } from "./field-dependents";
import { resolveEffectivePermission, loadGrantsForUser, hasAtLeast } from "./permission-resolver";

export const gridsService = {
  base: {
    list: bases.list,
    get: bases.get,
    create: bases.create,
    update: bases.update,
    remove: bases.remove,
  },
  table: {
    listByBase: tables.listByBase,
    get: tables.get,
    create: tables.create,
    update: tables.update,
    remove: tables.remove,
  },
  field: {
    listByTable: fields.listByTable,
    get: fields.get,
    create: fields.create,
    update: fields.update,
    softDelete: fields.softDelete,
  },
  record: {
    list: records.list,
    get: records.get,
    create: records.create,
    update: records.update,
    softDelete: records.softDelete,
    restore: records.restore,
    aggregate: records.aggregate,
  },
  audit: {
    log: audit.logAudit,
    list: audit.listAudit,
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
    updateLevel: access.updateAccessLevel,
    revoke: access.revokeAccess,
    resolveBinding: access.resolveAccessBinding,
  },
};

export { bases, tables, fields, records, audit, access };
export type { Base, Table, Field, GridRecord, AuditEntry, AuditAction } from "./types";
export type { FieldDependent } from "./field-dependents";
export type { Grant, ResourceType, ResolveTarget } from "./permission-resolver";
export type { FilterTree, FilterLeaf, FilterGroup } from "./filter-compiler";
export type { SortSpec } from "./sort-compiler";
export type { AggregateRequest, AggKind } from "./aggregate-compiler";
