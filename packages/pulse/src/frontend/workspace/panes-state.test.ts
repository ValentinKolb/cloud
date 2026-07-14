import { describe, expect, test } from "bun:test";
import {
  createQueryExplorerPanesValue,
  initialPulsePanesValue,
  QUERY_EXPLORER_ELEMENT_IDS,
  QUERY_EXPLORER_PANES_KEY,
  readPulsePanesStateCookie,
} from "./panes-state";

describe("Pulse panes state", () => {
  test("reads a valid persisted layout", () => {
    const value = createQueryExplorerPanesValue();
    const cookie = `pulse_panes_pulse_query-explorer=${encodeURIComponent(JSON.stringify(value))}`;
    expect(readPulsePanesStateCookie(cookie, QUERY_EXPLORER_PANES_KEY)).toEqual(value);
  });

  test("rejects malformed layouts", () => {
    const cookie = `pulse_panes_pulse_query-explorer=${encodeURIComponent(JSON.stringify({ root: { type: "split" } }))}`;
    expect(readPulsePanesStateCookie(cookie, QUERY_EXPLORER_PANES_KEY)).toBeNull();
  });

  test("restores missing elements from the default layout", () => {
    const persisted = { root: { type: "leaf" as const, id: "custom", elementIds: ["editor"], activeElementId: "editor" } };
    const result = initialPulsePanesValue(persisted, createQueryExplorerPanesValue(), QUERY_EXPLORER_ELEMENT_IDS);
    expect(result.root.type).toBe("leaf");
    if (result.root.type === "leaf") {
      expect(result.root.elementIds).toHaveLength(QUERY_EXPLORER_ELEMENT_IDS.length);
      expect(new Set(result.root.elementIds)).toEqual(new Set(QUERY_EXPLORER_ELEMENT_IDS));
    }
  });
});
