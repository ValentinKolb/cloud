import { describe, expect, test } from "bun:test";
import { PANES_LAYOUT_VERSION, type PanesLayout } from "@k2b/ui";
import {
  createQueryExplorerPanesLayout,
  initialPulsePanesLayout,
  QUERY_EXPLORER_ITEM_IDS,
  QUERY_EXPLORER_PANES_KEY,
  readPulsePanesLayoutCookie,
} from "./panes-state";

describe("Pulse panes state", () => {
  test("reads a valid version 2 layout", () => {
    const layout = createQueryExplorerPanesLayout();
    const cookie = `pulse_panes_pulse_query-explorer=${encodeURIComponent(JSON.stringify(layout))}`;
    expect(readPulsePanesLayoutCookie(cookie, QUERY_EXPLORER_PANES_KEY)).toEqual(layout);
  });

  test("rejects malformed and version 1 layouts", () => {
    const malformed = `pulse_panes_pulse_query-explorer=${encodeURIComponent(JSON.stringify({ version: 2, root: { type: "split" } }))}`;
    const versionOne = `pulse_panes_pulse_query-explorer=${encodeURIComponent(
      JSON.stringify({ root: { type: "leaf", id: "old", elementIds: ["editor"] } }),
    )}`;
    expect(readPulsePanesLayoutCookie(malformed, QUERY_EXPLORER_PANES_KEY)).toBeNull();
    expect(readPulsePanesLayoutCookie(versionOne, QUERY_EXPLORER_PANES_KEY)).toBeNull();
  });

  test("reconciles persisted items with the available workspace items", () => {
    const persisted: PanesLayout = {
      version: PANES_LAYOUT_VERSION,
      root: { type: "group", items: ["editor", "removed"], active: "removed" },
    };
    const result = initialPulsePanesLayout(persisted, createQueryExplorerPanesLayout(), QUERY_EXPLORER_ITEM_IDS);
    expect(result.root).toEqual({
      type: "group",
      items: ["editor", "result", "browse", "saved", "history"],
      active: "editor",
    });
  });
});
