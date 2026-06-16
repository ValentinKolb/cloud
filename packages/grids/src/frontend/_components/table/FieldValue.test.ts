import { describe, expect, test } from "bun:test";
import type { Field, GridRecord } from "../../../service";
import { fieldDisplayFormat, formatFieldValueText, relationIds } from "./field-value-format";

const field = (overrides: Partial<Field> & Pick<Field, "id" | "name" | "type">): Field => ({
  shortId: overrides.id.slice(0, 5),
  tableId: "tbl",
  description: null,
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const record = (data: Record<string, unknown>, expanded?: GridRecord["expanded"]): GridRecord =>
  ({
    id: "rec",
    tableId: "tbl",
    data,
    expanded,
    version: 1,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as GridRecord;

describe("FieldValue helpers", () => {
  test("normalizes relation ids from scalar and multi-value storage", () => {
    expect(relationIds("r1")).toEqual(["r1"]);
    expect(relationIds(["r1", "", 42, "r2"])).toEqual(["r1", "r2"]);
    expect(relationIds(null)).toEqual([]);
  });

  test("formats relation labels from explicit labels before expanded record data", () => {
    const relation = field({ id: "rel", name: "Author", type: "relation" });
    const rec = record({ rel: ["a1", "a2"] }, { a1: { Name: "Expanded author" }, a2: { Name: "Second author" } });

    expect(
      formatFieldValueText({
        field: relation,
        value: rec.data.rel,
        record: rec,
        relationLabels: { a1: "Cached author" },
      }),
    ).toBe("Cached author, Second author");
  });

  test("formats select values with configured labels", () => {
    const status = field({
      id: "status",
      name: "Status",
      type: "select",
      config: { options: [{ id: "ready", label: "Ready" }] },
    });

    expect(formatFieldValueText({ field: status, value: "ready" })).toBe("Ready");
  });

  test("formats lookup values with the target field metadata", () => {
    const relation = field({ id: "rel", name: "Book", type: "relation", config: { targetTableId: "books" } });
    const lookup = field({
      id: "price_lookup",
      name: "Price",
      type: "lookup",
      config: { relationFieldId: "rel", targetFieldId: "price" },
    });
    const price = field({ id: "price", tableId: "books", name: "Price", type: "number", config: { unit: "EUR" } });

    expect(formatFieldValueText({ field: lookup, value: "12", fieldsByTable: { tbl: [relation, lookup], books: [price] } })).toBe("12 EUR");
  });

  test("prefers explicit view format over field config format", () => {
    const amount = field({
      id: "amount",
      name: "Amount",
      type: "number",
      config: { format: { kind: "decimal", precision: 0, thousandsSeparator: false } },
    });

    expect(fieldDisplayFormat(amount, { kind: "decimal", precision: 2, thousandsSeparator: true })).toEqual({
      kind: "decimal",
      precision: 2,
      thousandsSeparator: true,
    });
  });
});
