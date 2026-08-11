import { describe, expect, test } from "bun:test";
import type { GridRecord } from "../contracts";
import type { CustomAppPage } from "./contracts";
import { customAppBindingRecordTableId, resolveCustomAppValueBinding } from "./value-bindings";

const uuid = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const page: CustomAppPage = {
  id: "detail",
  title: "Detail",
  navigation: { visible: false, order: 0 },
  parameters: { loan_id: { type: "record", tableId: uuid(1), required: true } },
  record: { tableId: uuid(1), id: { source: "PARAMS", path: "loan_id" } },
  rows: [
    { id: "main", columns: [{ id: "content", span: 12, blocks: [{ id: "record", type: "record", fieldIds: [], editableFieldIds: [] }] }] },
  ],
};
const record = { id: uuid(10), tableId: uuid(1) } as GridRecord;

describe("Grids App value bindings", () => {
  test("resolves literals, parameters, the page record, and a selected row", () => {
    const context = { parameterRecords: new Map([["loan_id", record]]), pageRecord: record, rowRecordId: uuid(11) };
    expect(resolveCustomAppValueBinding({ source: "LITERAL", value: "draft" }, context)).toEqual({ ok: true, value: "draft" });
    expect(resolveCustomAppValueBinding({ source: "PARAMS", path: "loan_id" }, context)).toEqual({ ok: true, value: record.id });
    expect(resolveCustomAppValueBinding({ source: "RECORD", path: "id" }, context)).toEqual({ ok: true, value: record.id });
    expect(resolveCustomAppValueBinding({ source: "ROW", path: "id" }, context)).toEqual({ ok: true, value: uuid(11) });
  });

  test("fails closed for missing runtime records and reports source tables", () => {
    expect(resolveCustomAppValueBinding({ source: "PARAMS", path: "loan_id" }, { parameterRecords: new Map() })).toEqual({ ok: false });
    expect(customAppBindingRecordTableId({ source: "PARAMS", path: "loan_id" }, page)).toBe(uuid(1));
    expect(customAppBindingRecordTableId({ source: "RECORD", path: "id" }, page)).toBe(uuid(1));
    expect(customAppBindingRecordTableId({ source: "ROW", path: "id" }, page, uuid(2))).toBe(uuid(2));
    expect(customAppBindingRecordTableId({ source: "LITERAL", value: null }, page)).toBeNull();
  });
});
