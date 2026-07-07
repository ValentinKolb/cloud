import { describe, expect, test } from "bun:test";
import { bulkSelectionRunPayload, bulkWorkflowActionLabel, pruneBulkSelection, sameBulkSelection } from "./bulk-selection";

describe("records bulk selection helpers", () => {
  test("sends explicit record ids when the user selected rows", () => {
    expect(bulkSelectionRunPayload(["rec-a", "rec-b", "rec-a"], { limit: 50 })).toEqual({
      recordIds: ["rec-a", "rec-b"],
    });
  });

  test("falls back to the current query when no rows are selected", () => {
    const query = { limit: 50, search: { q: "audio", fieldIds: [] } };
    expect(bulkSelectionRunPayload([], query)).toEqual({ query });
  });

  test("prunes selections to the visible loaded records", () => {
    const pruned = pruneBulkSelection(new Set(["rec-a", "rec-b", "rec-c"]), new Set(["rec-b", "rec-c", "rec-d"]));
    expect([...pruned]).toEqual(["rec-b", "rec-c"]);
  });

  test("compares selection sets independent of insertion order", () => {
    expect(sameBulkSelection(new Set(["rec-a", "rec-b"]), new Set(["rec-b", "rec-a"]))).toBe(true);
    expect(sameBulkSelection(new Set(["rec-a"]), new Set(["rec-a", "rec-b"]))).toBe(false);
  });

  test("labels workflow actions by the active run scope", () => {
    expect(bulkWorkflowActionLabel("Print labels", 0)).toBe("Run Print labels for current query");
    expect(bulkWorkflowActionLabel("Print labels", 3)).toBe("Run Print labels for 3 selected");
  });
});
