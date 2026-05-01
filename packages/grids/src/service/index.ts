import * as bases from "./bases";
import * as tables from "./tables";
import * as fields from "./fields";
import * as records from "./records";
import * as audit from "./audit";

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
  },
  audit: {
    log: audit.logAudit,
    list: audit.listAudit,
  },
};

export { bases, tables, fields, records, audit };
export type { Base, Table, Field, GridRecord, AuditEntry, AuditAction } from "./types";
