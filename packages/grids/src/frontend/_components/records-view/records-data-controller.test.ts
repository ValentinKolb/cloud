import { describe, expect, test } from "bun:test";
import type { RecordQuery, TableQueryResult } from "../../../contracts";
import type { GridRecord } from "../../../service";
import { fetchVisibleFlatRecords, reconcileFlatRecordsPage } from "./records-data-controller";

const record = (id: string): GridRecord => ({
  id,
  tableId: "table-1",
  data: {},
  version: 1,
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
});

describe("reconcileFlatRecordsPage", () => {
  test("replaces stale rows and previews with a new first page", () => {
    expect(
      reconcileFlatRecordsPage(
        { items: [record("old")], nextCursor: "old-cursor", filePreviews: { old: {} } },
        { items: [record("new")], nextCursor: "next", filePreviews: { new: {} } } as TableQueryResult,
        false,
      ),
    ).toEqual({ items: [record("new")], nextCursor: "next", filePreviews: { new: {} } });
  });

  test("appends unique rows and merges previews for pagination", () => {
    expect(
      reconcileFlatRecordsPage(
        { items: [record("a")], nextCursor: "page-2", filePreviews: { a: {} } },
        { items: [record("a"), record("b")], nextCursor: null, filePreviews: { b: {} } } as TableQueryResult,
        true,
      ),
    ).toEqual({ items: [record("a"), record("b")], nextCursor: null, filePreviews: { a: {}, b: {} } });
  });
});

describe("fetchVisibleFlatRecords", () => {
  test("loads enough cursor pages to preserve the visible slice", async () => {
    const cursors: Array<string | null> = [];
    const result = await fetchVisibleFlatRecords({
      source: {
        tableId: "table-1",
        query: {} as RecordQuery,
        cursor: null,
        filePreviewFieldIds: ["cover"],
        calendar: { view: "month", date: "2026-07-01" },
      },
      targetCount: 2,
      signal: new AbortController().signal,
      fetchRecords: async (args) => {
        cursors.push(args.cursor);
        return args.cursor
          ? ({ items: [record("b")], nextCursor: null, filePreviews: { b: {} } } as TableQueryResult)
          : ({ items: [record("a")], nextCursor: "page-2", filePreviews: { a: {} } } as TableQueryResult);
      },
    });

    expect(cursors).toEqual([null, "page-2"]);
    expect(result.items).toEqual([record("a"), record("b")]);
    expect(result.filePreviews).toEqual({ a: {}, b: {} });
  });
});
