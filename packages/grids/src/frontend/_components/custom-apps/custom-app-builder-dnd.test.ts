import { describe, expect, test } from "bun:test";
import type { CustomAppPage } from "../../../custom-apps/contracts";
import {
  applyCustomAppBlockDrop,
  type CustomAppBlockDropIntent,
  type CustomAppLayoutIds,
  customAppColumnRangeNeedsDropZone,
  normalizeCustomAppPageLayout,
  sameCustomAppBlockDropIntent,
  selectCustomAppBlockDropTarget,
} from "./custom-app-builder-dnd";

const ids: CustomAppLayoutIds = {
  rowIds: ["new-row-before", "new-row-after"],
  columnIds: ["new-column-active", "new-column-before", "new-column-after"],
};

const page = (blocks = ["A", "B", "C"]): CustomAppPage => ({
  id: "page",
  title: "Page",
  navigation: { visible: true, order: 0 },
  parameters: {},
  rows: [
    {
      id: "row",
      columns: [
        {
          id: "column",
          span: 12,
          blocks: blocks.map((id) => ({ id, type: "markdown" as const, markdown: id })),
        },
      ],
    },
  ],
});

const layout = (value: CustomAppPage) =>
  value.rows.map((row) => row.columns.map((column) => column.blocks.map((block) => block.id).join(""))).map((row) => row.join("|"));

const drop = (intent: CustomAppBlockDropIntent) => applyCustomAppBlockDrop(page(), "C", intent, ids);

const dropCandidate = (
  id: string,
  options: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    distance?: number;
    priority?: number;
    segment?: "horizontal" | "left" | "right";
  },
) => ({
  id,
  distance: options.distance ?? 100,
  rect: {
    top: options.y ?? 0,
    right: (options.x ?? 0) + (options.width ?? 100),
    bottom: (options.y ?? 0) + (options.height ?? 100),
    left: options.x ?? 0,
    width: options.width ?? 100,
    height: options.height ?? 100,
  },
  meta: { priority: options.priority ?? 1, segment: options.segment ?? "horizontal" },
});

describe("App drop target selection", () => {
  test("measures the pointer against the complete visible indicator segment", () => {
    expect(selectCustomAppBlockDropTarget([dropCandidate("row", { x: 0, y: 100, width: 300, height: 24 })], { x: 290, y: 113 }, null)).toBe(
      "row",
    );

    expect(
      selectCustomAppBlockDropTarget(
        [dropCandidate("column", { x: 100, y: 0, width: 80, height: 300, segment: "left" })],
        { x: 99, y: 290 },
        null,
      ),
    ).toBe("column");
  });

  test("does not attract remote targets", () => {
    expect(
      selectCustomAppBlockDropTarget([dropCandidate("remote-priority", { y: 100, height: 24, priority: 4 })], { x: 50, y: 165 }, null),
    ).toBeNull();
  });

  test("prefers the shorter represented range when indicators overlap", () => {
    expect(
      selectCustomAppBlockDropTarget(
        [
          dropCandidate("whole-stack", { x: 100, height: 200, segment: "left", priority: 4 }),
          dropCandidate("one-block", { x: 100, y: 80, height: 20, segment: "left", priority: 1 }),
        ],
        { x: 100, y: 90 },
        null,
      ),
    ).toBe("one-block");
  });

  test("uses hysteresis before switching between nearby indicators", () => {
    expect(
      selectCustomAppBlockDropTarget(
        [dropCandidate("previous", { y: 88, height: 24 }), dropCandidate("next", { y: 108, height: 24 })],
        { x: 50, y: 110 },
        "previous",
      ),
    ).toBe("previous");

    expect(
      selectCustomAppBlockDropTarget(
        [dropCandidate("previous", { y: 88, height: 24 }), dropCandidate("next", { y: 108, height: 24 })],
        { x: 50, y: 116 },
        "previous",
      ),
    ).toBe("next");
  });

  test("keeps keyboard selection at the droppable center", () => {
    expect(
      selectCustomAppBlockDropTarget(
        [dropCandidate("keyboard-target", { width: 100, segment: "left", distance: 0 })],
        { x: 50, y: 50 },
        null,
      ),
    ).toBe("keyboard-target");
  });
});

describe("App canonical drop zones", () => {
  test("compares semantic drop intents without serialization", () => {
    expect(sameCustomAppBlockDropIntent(null, null)).toBe(true);
    expect(
      sameCustomAppBlockDropIntent(
        { kind: "stack", targetBlockId: "A", edge: "before" },
        { kind: "stack", targetBlockId: "A", edge: "before" },
      ),
    ).toBe(true);
    expect(
      sameCustomAppBlockDropIntent(
        { kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "left" },
        { kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "right" },
      ),
    ).toBe(false);
  });

  test("uses block or pair zones when they already represent the remaining stack", () => {
    expect(customAppColumnRangeNeedsDropZone(["A"], null)).toBe(false);
    expect(customAppColumnRangeNeedsDropZone(["A", "B"], null)).toBe(false);
    expect(customAppColumnRangeNeedsDropZone(["A", "B", "C"], "C")).toBe(false);
  });

  test("keeps a whole-stack zone for a distinct or non-adjacent remaining range", () => {
    expect(customAppColumnRangeNeedsDropZone(["A", "B", "C"], null)).toBe(true);
    expect(customAppColumnRangeNeedsDropZone(["A", "B", "C"], "B")).toBe(true);
  });
});

describe("App implicit block layout", () => {
  test("moves a block before and after stable block targets", () => {
    expect(layout(drop({ kind: "stack", targetBlockId: "A", edge: "before" }))).toEqual(["CAB"]);
    expect(layout(drop({ kind: "stack", targetBlockId: "A", edge: "after" }))).toEqual(["ACB"]);
  });

  test("places C beside A, A and B, or B", () => {
    expect(layout(drop({ kind: "beside", firstBlockId: "A", lastBlockId: "A", side: "right" }))).toEqual(["A|C", "B"]);
    expect(layout(drop({ kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "right" }))).toEqual(["AB|C"]);
    expect(layout(drop({ kind: "beside", firstBlockId: "B", lastBlockId: "B", side: "right" }))).toEqual(["A", "B|C"]);
    expect(layout(drop({ kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "left" }))).toEqual(["C|AB"]);
  });

  test("prunes redundant layout when a side-by-side block returns to the stack", () => {
    const split = drop({ kind: "beside", firstBlockId: "A", lastBlockId: "A", side: "right" });
    const stacked = applyCustomAppBlockDrop(split, "C", { kind: "stack", targetBlockId: "B", edge: "after" }, ids);
    expect(layout(stacked)).toEqual(["ABC"]);
    expect(stacked.rows[0]?.columns[0]?.span).toBe(12);
  });

  test("normalization removes empty containers and merges adjacent one-column rows idempotently", () => {
    const source = page(["A"]);
    source.rows.push({
      id: "empty-row",
      columns: [{ id: "empty-column", span: 4, blocks: [] }],
    });
    source.rows.push({
      id: "second-row",
      columns: [{ id: "second-column", span: 7, blocks: [{ id: "B", type: "markdown", markdown: "B" }] }],
    });

    const normalized = normalizeCustomAppPageLayout(source);
    expect(layout(normalized)).toEqual(["AB"]);
    expect(normalized.rows[0]?.id).toBe("row");
    expect(normalized.rows[0]?.columns[0]?.id).toBe("column");
    expect(normalized.rows[0]?.columns[0]?.span).toBe(12);
    expect(normalizeCustomAppPageLayout(normalized)).toBe(normalized);
  });

  test("adds a block beside a complete column in an existing multi-column row", () => {
    const source = page(["A", "B"]);
    source.rows[0]!.columns.push({ id: "column-right", span: 6, blocks: [{ id: "C", type: "markdown", markdown: "C" }] });
    source.rows[0]!.columns[0]!.span = 6;
    const moved = applyCustomAppBlockDrop(source, "C", { kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "left" }, ids);
    expect(layout(moved)).toEqual(["C|AB"]);
    expect(moved.rows[0]?.columns.map((column) => column.span)).toEqual([6, 6]);
  });

  test("treats an unchanged visual column placement as a no-op", () => {
    const source = page(["A"]);
    source.rows[0]!.columns.push({ id: "column-right", span: 6, blocks: [{ id: "B", type: "markdown", markdown: "B" }] });
    source.rows[0]!.columns[0]!.span = 6;

    expect(applyCustomAppBlockDrop(source, "A", { kind: "beside", firstBlockId: "B", lastBlockId: "B", side: "left" }, ids)).toBe(source);
  });

  test("moves a block into a full-width row around a multi-column row", () => {
    const source = page(["A"]);
    source.rows[0]!.columns = ["A", "B", "C"].map((id) => ({
      id: `column-${id}`,
      span: 4,
      blocks: [{ id, type: "markdown" as const, markdown: id }],
    }));

    expect(layout(applyCustomAppBlockDrop(source, "C", { kind: "row", targetRowId: "row", edge: "before" }, ids))).toEqual(["C", "A|B"]);
    expect(layout(applyCustomAppBlockDrop(source, "C", { kind: "row", targetRowId: "row", edge: "after" }, ids))).toEqual(["A|B", "C"]);
  });

  test("returns the original page for invalid ranges, ID pools, and no-op intents", () => {
    const source = page();
    expect(applyCustomAppBlockDrop(source, "C", { kind: "stack", targetBlockId: "C", edge: "after" }, ids)).toBe(source);
    expect(applyCustomAppBlockDrop(source, "C", { kind: "beside", firstBlockId: "B", lastBlockId: "A", side: "right" }, ids)).toBe(source);
    expect(
      applyCustomAppBlockDrop(
        source,
        "C",
        { kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "right" },
        {
          ...ids,
          columnIds: ["column", "duplicate", "duplicate"],
        },
      ),
    ).toBe(source);
  });

  test("preserves the exact block multiset for every supported A/B/C placement", () => {
    const intents: CustomAppBlockDropIntent[] = [
      { kind: "stack", targetBlockId: "A", edge: "before" },
      { kind: "stack", targetBlockId: "A", edge: "after" },
      { kind: "stack", targetBlockId: "B", edge: "before" },
      { kind: "stack", targetBlockId: "B", edge: "after" },
      { kind: "beside", firstBlockId: "A", lastBlockId: "A", side: "left" },
      { kind: "beside", firstBlockId: "A", lastBlockId: "A", side: "right" },
      { kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "left" },
      { kind: "beside", firstBlockId: "A", lastBlockId: "B", side: "right" },
      { kind: "beside", firstBlockId: "B", lastBlockId: "B", side: "left" },
      { kind: "beside", firstBlockId: "B", lastBlockId: "B", side: "right" },
    ];

    for (const intent of intents) {
      const moved = drop(intent);
      expect(moved.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks.map((block) => block.id))).sort()).toEqual([
        "A",
        "B",
        "C",
      ]);
      expect(moved.rows.every((row) => row.columns.every((column) => column.blocks.length > 0))).toBe(true);
      expect(moved.rows.every((row) => row.columns.reduce((sum, column) => sum + column.span, 0) <= 12)).toBe(true);
    }
  });
});
