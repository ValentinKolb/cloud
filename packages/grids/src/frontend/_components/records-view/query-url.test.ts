import { test, expect, describe } from "bun:test";
import {
  parseRecordsState,
  buildRecordsUrl,
  type RecordsState,
  type UrlPathContext,
} from "./query-url";

// =============================================================================
// query-url tests — URL ↔ RecordsState round-trip + path-based emit.
// =============================================================================
// The path segments (`/table/<short>` / `/view/<short>`) come from Hono
// route params, not URL search params, so parseRecordsState only deals
// with the query-param subset. buildRecordsUrl emits the full path-based
// shape; we check both pieces here.

const params = (s: string) => new URLSearchParams(s);

const path: UrlPathContext = {
  baseShortId: "BASE0",
  tableShortId: "TBL00",
  viewShortId: null,
};

const empty: RecordsState = {
  query: {},
  cursor: null,
  selectedRecordId: null,
  search: { q: "", fieldIds: [] },
};

describe("parseRecordsState", () => {
  test("empty params → empty state", () => {
    expect(parseRecordsState(params(""))).toEqual(empty);
  });

  test("filter param parsed", () => {
    const url = params(
      "filter=" + encodeURIComponent('{"op":"AND","filters":[]}'),
    );
    const r = parseRecordsState(url);
    expect(r.query.filter).toEqual({ op: "AND", filters: [] });
  });

  test("malformed filter → silently dropped (no throw)", () => {
    const r = parseRecordsState(params("filter=not-json"));
    expect(r.query.filter).toBeUndefined();
  });

  test("sort param parsed (array shape)", () => {
    const url = params(
      "sort=" + encodeURIComponent('[{"fieldId":"f1","direction":"asc"}]'),
    );
    const r = parseRecordsState(url);
    expect(r.query.sort).toEqual([{ fieldId: "f1", direction: "asc" }]);
  });

  test("trash=1 → includeDeleted: true", () => {
    expect(parseRecordsState(params("trash=1")).query.includeDeleted).toBe(true);
  });

  test("q + qFields parsed into search", () => {
    const r = parseRecordsState(params("q=hello&qFields=f1,f2"));
    expect(r.search).toEqual({ q: "hello", fieldIds: ["f1", "f2"] });
  });

  test("table / view / dashboard NOT read from query (path-based now)", () => {
    // These would resolve via c.req.param() at the SSR handler; the URL
    // parser is purely UI state on top of the resource the path identifies.
    const r = parseRecordsState(
      params("table=foo&view=bar&dashboard=baz"),
    );
    expect(r).toEqual(empty);
  });
});

describe("buildRecordsUrl", () => {
  test("table-only path", () => {
    expect(buildRecordsUrl(path, empty)).toBe(
      "/app/grids/BASE0/table/TBL00",
    );
  });

  test("view path when viewShortId is set", () => {
    expect(
      buildRecordsUrl({ ...path, viewShortId: "VW000" }, empty),
    ).toBe("/app/grids/BASE0/table/TBL00/view/VW000");
  });

  test("filter serialized as query param on top of the path", () => {
    const state: RecordsState = {
      ...empty,
      query: { filter: { op: "AND", filters: [] } },
    };
    const url = buildRecordsUrl(path, state);
    expect(url).toContain("/app/grids/BASE0/table/TBL00?");
    expect(url).toContain(
      "filter=" + encodeURIComponent('{"op":"AND","filters":[]}'),
    );
  });

  test("view-matching fields are suppressed from the URL", () => {
    // Active view has a stored filter; state carries the SAME filter
    // (e.g. just-loaded URL). The output URL should omit it so the
    // view's stored value can flow through next render.
    const filter = { op: "AND" as const, filters: [] };
    const state: RecordsState = { ...empty, query: { filter } };
    const url = buildRecordsUrl(
      { ...path, viewShortId: "VW000" },
      state,
      { filter },
    );
    expect(url).toBe("/app/grids/BASE0/table/TBL00/view/VW000");
    expect(url).not.toContain("filter=");
  });

  test("trash=1 emitted when includeDeleted is true", () => {
    const state: RecordsState = { ...empty, query: { includeDeleted: true } };
    const url = buildRecordsUrl(path, state);
    expect(url).toContain("trash=1");
  });

  test("record param emitted from selectedRecordId (detail panel)", () => {
    const state: RecordsState = { ...empty, selectedRecordId: "rec-123" };
    const url = buildRecordsUrl(path, state);
    expect(url).toContain("record=rec-123");
  });
});
