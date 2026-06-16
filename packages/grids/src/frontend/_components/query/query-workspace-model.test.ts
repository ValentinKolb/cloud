import { describe, expect, test } from "bun:test";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { Field, Table, View } from "../../../service";
import {
  currentSourceForApi,
  previewSummary,
  queryTextStats,
  sourceCatalogSummary,
  visibleFields,
  visibleViews,
} from "./query-workspace-model";

const table = (id: string, deletedAt: string | null = null): Table => ({
  id,
  shortId: id,
  baseId: "base",
  name: id,
  description: null,
  icon: null,
  columns: [],
  displayConfig: { mode: "table" },
  position: 0,
  disableDirectInsert: false,
  deletedAt,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const field = (id: string, tableId: string, deletedAt: string | null = null): Field => ({
  id,
  shortId: id,
  tableId,
  name: id,
  description: null,
  icon: null,
  type: "text",
  config: {},
  position: 0,
  required: false,
  presentable: false,
  hideInTable: false,
  defaultValue: null,
  indexed: false,
  uniqueConstraint: false,
  deletedAt,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const view = (id: string, tableId: string, deletedAt: string | null = null): View => ({
  id,
  shortId: id,
  tableId,
  name: id,
  description: null,
  icon: null,
  source: `from table {${tableId}}`,
  ui: {},
  ownerUserId: null,
  position: 0,
  deletedAt,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("query workspace model", () => {
  test("sanitizes UI current source for API requests", () => {
    expect(currentSourceForApi({ kind: "table", tableId: "table-id", label: "Orders", ref: "Orders" })).toEqual({
      kind: "table",
      tableId: "table-id",
    });
    expect(currentSourceForApi({ kind: "view", viewId: "view-id", label: "Open", ref: "Open" })).toEqual({
      kind: "view",
      viewId: "view-id",
    });
  });

  test("summarizes query text without treating empty input as zero-height", () => {
    expect(queryTextStats("")).toEqual({ chars: 0, lines: 1, nonEmptyLines: 0, clauses: 0 });
    expect(queryTextStats("from table Orders\nselect Amount; sort Amount desc")).toEqual({
      chars: 49,
      lines: 2,
      nonEmptyLines: 2,
      clauses: 3,
    });
  });

  test("summarizes preview states", () => {
    expect(previewSummary(null, false)).toMatchObject({ kind: "idle", label: "No result" });
    expect(previewSummary(null, true)).toMatchObject({ kind: "checking", label: "Checking" });
    expect(previewSummary({ ok: false, diagnostics: [{ message: "bad" }, { message: "worse" }] }, false)).toMatchObject({
      kind: "issues",
      diagnostics: 2,
    });

    const ready: DslQueryPreviewResponse = {
      ok: true,
      mode: "groups",
      columns: [{ key: "total", label: "Total", type: "number", sqlType: "number" }],
      rows: [{ values: { total: 10 } }],
      truncated: true,
      limit: 1,
      explode: true,
    };
    expect(previewSummary(ready, false)).toMatchObject({
      kind: "ready",
      rows: 1,
      columns: 1,
      mode: "groups",
      truncated: true,
      explode: true,
      limit: 1,
    });
  });

  test("counts only visible source catalog entries", () => {
    const active = table("active");
    const deleted = table("deleted", "2026-01-01T00:00:00.000Z");

    expect(visibleFields([field("name", active.id), field("old", active.id, "2026-01-01T00:00:00.000Z")]).map((item) => item.id)).toEqual([
      "name",
    ]);
    expect(visibleViews([view("open", active.id), view("old", active.id, "2026-01-01T00:00:00.000Z")]).map((item) => item.id)).toEqual([
      "open",
    ]);
    expect(
      sourceCatalogSummary(
        [active, deleted],
        { [active.id]: [field("name", active.id)], [deleted.id]: [field("secret", deleted.id)] },
        { [active.id]: [view("open", active.id)], [deleted.id]: [view("old", deleted.id)] },
      ),
    ).toEqual({ tables: 1, fields: 1, views: 1 });
  });
});
