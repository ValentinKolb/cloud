import { describe, expect, test } from "bun:test";
import { resolveEffectiveQuery } from "./effective-query";
import type { View } from "../../../service";
import type { RecordsState } from "./query-url";

const fieldId = "11111111-1111-4111-8111-111111111111";
const columns = [{ fieldId }, { kind: "computed" as const, id: "computed_total1", label: "Total", expression: "#price * #qty" }];

const state = (overrides: Partial<RecordsState> = {}): RecordsState => ({
  query: {},
  cursor: null,
  selectedRecordId: null,
  search: { q: "", fieldIds: [], override: false },
  ...overrides,
});

const view = (query: View["query"]): View => ({
  id: "22222222-2222-4222-8222-222222222222",
  shortId: "VW000",
  tableId: "33333333-3333-4333-8333-333333333333",
  name: "Saved",
  query,
  ownerUserId: null,
  position: 0,
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("resolveEffectiveQuery", () => {
  test("inherits saved view search when URL has no search override", () => {
    const effective = resolveEffectiveQuery(state(), view({ search: { q: "needle", fieldIds: [fieldId] } }));
    expect(effective.search).toEqual({ q: "needle", fieldIds: [fieldId] });
    expect(effective.source).toBe("view");
  });

  test("URL search overrides saved view search", () => {
    const effective = resolveEffectiveQuery(
      state({ search: { q: "other", fieldIds: [], override: true } }),
      view({ search: { q: "needle", fieldIds: [fieldId] } }),
    );
    expect(effective.search).toEqual({ q: "other", fieldIds: [] });
    expect(effective.source).toBe("view-customized");
  });

  test("empty URL search override clears saved view search", () => {
    const effective = resolveEffectiveQuery(
      state({ search: { q: "", fieldIds: [], override: true } }),
      view({ search: { q: "needle", fieldIds: [fieldId] } }),
    );
    expect(effective.search).toBeUndefined();
    expect(effective.source).toBe("view-customized");
  });

  test("inherits saved view groupSort", () => {
    const effective = resolveEffectiveQuery(
      state(),
      view({
        groupBy: [{ fieldId }],
        groupSort: [{ fieldId: "*", agg: "count", direction: "desc" }],
      }),
    );
    expect(effective.groupSort).toEqual([{ fieldId: "*", agg: "count", direction: "desc" }]);
    expect(effective.source).toBe("view");
  });

  test("URL groupSort overrides saved view groupSort", () => {
    const effective = resolveEffectiveQuery(
      state({ query: { groupSort: [{ fieldId, agg: "sum", direction: "asc" }] } }),
      view({ groupSort: [{ fieldId: "*", agg: "count", direction: "desc" }] }),
    );
    expect(effective.groupSort).toEqual([{ fieldId, agg: "sum", direction: "asc" }]);
    expect(effective.source).toBe("view-customized");
  });

  test("URL columns override saved view columns", () => {
    const effective = resolveEffectiveQuery(state({ query: { columns } }), view({ columns: [{ fieldId }] }));
    expect(effective.columns).toEqual(columns);
    expect(effective.source).toBe("view-customized");
  });
});
