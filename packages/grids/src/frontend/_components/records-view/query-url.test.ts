import { test, expect, describe } from "bun:test";
import {
  parseRecordsState,
  buildRecordsUrl,
  recordsStatesEqual,
  type RecordsState,
} from "./query-url";

const params = (s: string) => new URLSearchParams(s);

const baseRef = { baseId: "BASE", tableId: "TBL" };

const empty: RecordsState = {
  query: {},
  cursor: null,
  selectedRecordId: null,
  activeViewId: null,
  search: { q: "", fieldIds: [] },
};

describe("parseRecordsState", () => {
  test("empty params → empty state", () => {
    expect(parseRecordsState(params(""))).toEqual(empty);
  });

  test("filter param parsed", () => {
    const filter = { op: "AND" as const, filters: [{ fieldId: "f1", op: "equals", value: "x" }] };
    const sp = params(`filter=${encodeURIComponent(JSON.stringify(filter))}`);
    const s = parseRecordsState(sp);
    expect(s.query.filter).toEqual(filter);
  });

  test("sort param parsed", () => {
    const sort = [{ fieldId: "f1", direction: "asc" as const }];
    const sp = params(`sort=${encodeURIComponent(JSON.stringify(sort))}`);
    const s = parseRecordsState(sp);
    expect(s.query.sort).toEqual(sort);
  });

  test("groupBy + aggregations parsed", () => {
    const groupBy = [{ fieldId: "f1", direction: "desc" as const }];
    const aggregations = [{ fieldId: "*", agg: "count" as const }];
    const sp = params(
      `groupBy=${encodeURIComponent(JSON.stringify(groupBy))}` +
        `&aggregations=${encodeURIComponent(JSON.stringify(aggregations))}`,
    );
    const s = parseRecordsState(sp);
    expect(s.query.groupBy).toEqual(groupBy);
    expect(s.query.aggregations).toEqual(aggregations);
  });

  test("trash=1 sets includeDeleted", () => {
    const s = parseRecordsState(params("trash=1"));
    expect(s.query.includeDeleted).toBe(true);
  });

  test("cursor / record / view passed through", () => {
    const s = parseRecordsState(params("cursor=abc&record=REC&view=V"));
    expect(s.cursor).toBe("abc");
    expect(s.selectedRecordId).toBe("REC");
    expect(s.activeViewId).toBe("V");
  });

  test("free-text search parsed", () => {
    const s = parseRecordsState(params("q=hello&qFields=f1,f2"));
    expect(s.search).toEqual({ q: "hello", fieldIds: ["f1", "f2"] });
  });

  test("malformed JSON falls back to empty fragments", () => {
    const s = parseRecordsState(params("filter=not-json&sort={broken&groupBy=42"));
    // No filter set, sort empty, groupBy empty — all because parsing failed
    // gracefully. Stale URL doesn't crash the page.
    expect(s.query.filter).toBeUndefined();
    expect(s.query.sort).toBeUndefined();
    expect(s.query.groupBy).toBeUndefined();
  });

  test("invalid array entries (missing required keys) get filtered out", () => {
    const sort = [{ fieldId: "f1", direction: "asc" }, { fieldId: "f2" /* missing direction */ }];
    const sp = params(`sort=${encodeURIComponent(JSON.stringify(sort))}`);
    const s = parseRecordsState(sp);
    expect(s.query.sort).toHaveLength(1);
    expect(s.query.sort?.[0]?.fieldId).toBe("f1");
  });
});

describe("buildRecordsUrl", () => {
  test("empty state → just /app/grids/<base>?table=<tbl>", () => {
    expect(buildRecordsUrl(baseRef, empty)).toBe("/app/grids/BASE?table=TBL");
  });

  test("filter encoded", () => {
    const filter = { op: "AND" as const, filters: [{ fieldId: "f1", op: "equals", value: "x" }] };
    const url = buildRecordsUrl(baseRef, { ...empty, query: { filter } });
    expect(url).toContain("filter=");
    expect(url).toContain(encodeURIComponent("f1"));
  });

  test("trash flag emits ?trash=1", () => {
    const url = buildRecordsUrl(baseRef, { ...empty, query: { includeDeleted: true } });
    expect(url).toContain("trash=1");
  });

  test("cursor + record + view all serialised", () => {
    const url = buildRecordsUrl(baseRef, {
      ...empty,
      cursor: "tok",
      selectedRecordId: "REC",
      activeViewId: "V",
    });
    expect(url).toContain("cursor=tok");
    expect(url).toContain("record=REC");
    expect(url).toContain("view=V");
  });

  test("search params encoded", () => {
    const url = buildRecordsUrl(baseRef, {
      ...empty,
      search: { q: "hello world", fieldIds: ["f1", "f2"] },
    });
    expect(url).toContain("q=hello+world");
    expect(url).toContain("qFields=f1%2Cf2");
  });
});

describe("parse / build round-trip", () => {
  const samples: RecordsState[] = [
    empty,
    { ...empty, query: { sort: [{ fieldId: "f1", direction: "asc" }] } },
    {
      ...empty,
      query: {
        filter: { op: "AND", filters: [{ fieldId: "f1", op: "equals", value: 5 }] },
        sort: [{ fieldId: "f2", direction: "desc" }],
      },
    },
    {
      ...empty,
      query: {
        groupBy: [{ fieldId: "f1", direction: "asc", granularity: "month" }],
        aggregations: [{ fieldId: "*", agg: "count" }, { fieldId: "f2", agg: "sum" }],
      },
    },
    {
      query: { includeDeleted: true },
      cursor: "next-page",
      selectedRecordId: "REC-1",
      activeViewId: "VIEW-1",
      search: { q: "needle", fieldIds: ["f1"] },
    },
  ];

  for (const [i, s] of samples.entries()) {
    test(`sample ${i} round-trips`, () => {
      const url = buildRecordsUrl(baseRef, s);
      const sp = new URL(url, "http://x").searchParams;
      const parsed = parseRecordsState(sp);
      expect(parsed).toEqual(s);
    });
  }
});

describe("recordsStatesEqual", () => {
  test("structurally equal returns true", () => {
    expect(recordsStatesEqual(empty, { ...empty })).toBe(true);
  });
  test("any field different returns false", () => {
    expect(recordsStatesEqual(empty, { ...empty, cursor: "x" })).toBe(false);
  });
});
