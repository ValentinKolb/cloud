import { describe, expect, test } from "bun:test";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { Field, GridRecord } from "../../../service";
import "../ssr-test-plugin";

const { FieldValue } = await import("./FieldValue");

const field = (overrides: Partial<Field> & Pick<Field, "id" | "name" | "type">): Field => ({
  shortId: overrides.id.slice(0, 5),
  tableId: "table",
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
    id: "record",
    tableId: "table",
    data,
    expanded,
    version: 1,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as GridRecord;

describe("FieldValue rendering", () => {
  test("renders relation links and label-only relation values", () => {
    const relation = field({ id: "author", name: "Author", type: "relation", config: { targetTableId: "authors" } });
    const linked = renderToString(() =>
      createComponent(FieldValue, {
        field: relation,
        value: "author-1",
        relationLabels: { "author-1": "Ada Lovelace" },
        baseId: "base",
        tableShortIds: { authors: "auth" },
      }),
    );
    const labels = renderToString(() =>
      createComponent(FieldValue, { field: relation, value: "Ada Lovelace", relationValueMode: "labels" }),
    );

    expect(linked).toContain("/app/grids/base/table/auth?record=author-1");
    expect(linked).toContain("Ada Lovelace");
    expect(labels).not.toContain("<a");
    expect(labels).toContain("Ada Lovelace");
  });

  test("renders select badges, markdown, and empty detail values", () => {
    const status = field({
      id: "status",
      name: "Status",
      type: "select",
      config: { options: [{ id: "ready", label: "Ready", color: "#16a34a" }] },
    });
    const notes = field({ id: "notes", name: "Notes", type: "longtext", config: { markdown: true } });

    expect(renderToString(() => createComponent(FieldValue, { field: status, value: "ready" }))).toContain("Ready");
    expect(renderToString(() => createComponent(FieldValue, { field: notes, value: "**Important**" }))).toContain(
      "<strong>Important</strong>",
    );
    expect(renderToString(() => createComponent(FieldValue, { field: notes, value: null, mode: "detail" }))).toContain("—");
  });

  test("renders lookup links, barcodes, and progress displays from shared intents", () => {
    const relation = field({ id: "author", name: "Author", type: "relation", config: { targetTableId: "authors" } });
    const lookup = field({
      id: "author_name",
      name: "Author name",
      type: "lookup",
      config: { relationFieldId: relation.id, targetFieldId: "name" },
    });
    const target = field({ id: "name", tableId: "authors", name: "Name", type: "text" });
    const itemCode = field({ id: "code", name: "Code", type: "text" });
    const completion = field({ id: "completion", name: "Completion", type: "percent" });
    const row = record({ author: ["author-1"], author_name: "Ada Lovelace" });

    const lookupHtml = renderToString(() =>
      createComponent(FieldValue, {
        field: lookup,
        value: "Ada Lovelace",
        record: row,
        allFields: [relation, lookup],
        fieldsByTable: { table: [relation, lookup], authors: [target] },
        baseId: "base",
        tableShortIds: { authors: "auth" },
        linkLookup: true,
      }),
    );
    const barcodeHtml = renderToString(() =>
      createComponent(FieldValue, { field: itemCode, value: "ITEM-42", format: { kind: "barcode", bcid: "code128" } }),
    );
    const progressHtml = renderToString(() =>
      createComponent(FieldValue, { field: completion, value: 75, format: { kind: "progress", label: "percent" } }),
    );

    expect(lookupHtml).toContain("/app/grids/base/table/auth?record=author-1");
    expect(lookupHtml).toContain("Ada Lovelace");
    expect(barcodeHtml).toContain("grids-code-display--linear");
    expect(barcodeHtml).toContain("ITEM-42");
    expect(progressHtml).toContain("75%");
  });
});
