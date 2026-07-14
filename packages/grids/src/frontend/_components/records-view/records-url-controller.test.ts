import { describe, expect, test } from "bun:test";
import type { RecordQuery } from "../../../contracts";
import { applyRecordsHistoryUrl, recordsHistoryStateFromUrl } from "./records-url-controller";

const fieldId = "11111111-1111-4111-8111-111111111111";
const savedQuery: RecordQuery = {
  filter: { fieldId, op: "equals", value: "Open" },
  search: { q: "camera", fieldIds: [fieldId] },
  sort: [{ fieldId, direction: "asc" }],
  groupSort: [{ fieldId: "*", agg: "count", direction: "desc" }],
  limit: 25,
};

describe("recordsHistoryStateFromUrl", () => {
  test("restores query, selection, density, and edit mode from browser history", () => {
    const restored = recordsHistoryStateFromUrl(
      "/app/grids/base/table/items?q=camera&qFields=name&record=record-1&cardSize=large&edit=true",
      true,
    );

    expect(restored.state.search).toEqual({ q: "camera", fieldIds: ["name"], override: true });
    expect(restored.state.selectedRecordId).toBe("record-1");
    expect(restored.state.cardSize).toBe("large");
    expect(restored.adminMode).toBe(true);
  });

  test("never restores edit mode without permission", () => {
    expect(recordsHistoryStateFromUrl("/app/grids/base/table/items?edit=true", false).adminMode).toBe(false);
  });

  test("restores the stored query behind a clean saved-view URL", () => {
    const restored = recordsHistoryStateFromUrl("/app/grids/base/table/items/view/open", true, savedQuery);

    expect(restored.state.query.filter).toEqual(savedQuery.filter);
    expect(restored.state.query.sort).toEqual(savedQuery.sort);
    expect(restored.state.query.groupSort).toEqual(savedQuery.groupSort);
    expect(restored.state.query.limit).toBe(25);
    expect(restored.state.search).toEqual({ q: "camera", fieldIds: [fieldId], override: false });
  });

  test("layers URL overrides over the stored saved-view query", () => {
    const restored = recordsHistoryStateFromUrl(
      `/app/grids/base/table/items/view/open?sort=${encodeURIComponent(JSON.stringify([{ fieldId, direction: "desc" }]))}&q=`,
      true,
      savedQuery,
    );

    expect(restored.state.query.filter).toEqual(savedQuery.filter);
    expect(restored.state.query.sort).toEqual([{ fieldId, direction: "desc" }]);
    expect(restored.state.query.groupSort).toEqual(savedQuery.groupSort);
    expect(restored.state.query.limit).toBe(25);
    expect(restored.state.search).toEqual({ q: "", fieldIds: [], override: true });
  });
});

describe("applyRecordsHistoryUrl", () => {
  test("applies one state transition for its owned records path", () => {
    const calls: string[] = [];
    const applied = applyRecordsHistoryUrl({
      href: "/app/grids/base/table/items?q=camera",
      ownedPathname: "/app/grids/base/table/items",
      canUseEditMode: true,
      activeRecordQuery: null,
      beforeApply: () => calls.push("before"),
      apply: () => calls.push("apply"),
    });

    expect(applied).toBe(true);
    expect(calls).toEqual(["before", "apply"]);
  });

  test("ignores popstate events owned by another workspace route", () => {
    const calls: string[] = [];
    const applied = applyRecordsHistoryUrl({
      href: "/app/grids/base/table/other?q=camera",
      ownedPathname: "/app/grids/base/table/items",
      canUseEditMode: true,
      activeRecordQuery: null,
      beforeApply: () => calls.push("before"),
      apply: () => calls.push("apply"),
    });

    expect(applied).toBe(false);
    expect(calls).toEqual([]);
  });
});
