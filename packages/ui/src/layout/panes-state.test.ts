import { describe, expect, test } from "bun:test";
import {
  activatePanesElement,
  applyPanesIntent,
  createPanesValue,
  normalizePanesValue,
  PANES_VALUE_VERSION,
  resizePanesSplit,
  type PanesValue,
} from "./panes-state";

const splitValue = (): PanesValue => ({
  version: PANES_VALUE_VERSION,
  root: {
    type: "split",
    id: "root",
    direction: "horizontal",
    sizes: [60, 40],
    children: [
      {
        type: "leaf",
        id: "left",
        elementIds: ["one", "two"],
        activeElementId: "one",
        presentation: "tabs",
      },
      {
        type: "leaf",
        id: "right",
        elementIds: ["three"],
        activeElementId: "three",
        presentation: "single",
      },
    ],
  },
});

describe("Panes state kernel", () => {
  test("creates versioned layouts and keeps single presentation coherent", () => {
    expect(createPanesValue(["one", "two"], "single")).toEqual({
      version: 1,
      root: {
        type: "leaf",
        id: "root",
        elementIds: ["one", "two"],
        activeElementId: "one",
        presentation: "tabs",
      },
    });
  });

  test("repairs persisted legacy state without trusting its structure", () => {
    const normalized = normalizePanesValue(
      {
        root: {
          type: "split",
          id: "workspace",
          direction: "horizontal",
          sizes: [Number.NaN, 25, 75],
          children: [
            {
              type: "leaf",
              id: "duplicate",
              elementIds: ["one", "missing", "one"],
              activeElementId: "missing",
              presentation: "single",
            },
            {
              type: "leaf",
              id: "duplicate",
              elementIds: ["two"],
              activeElementId: "two",
              presentation: "tabs",
            },
            { type: "unknown" },
          ],
        },
      },
      ["one", "two", "three"],
    );

    expect(normalized.version).toBe(1);
    expect(normalized.root.type).toBe("split");
    if (normalized.root.type !== "split") throw new Error("Expected split");
    expect(normalized.root.id).toBe("workspace");
    expect(normalized.root.children.map((node) => node.id)).toEqual([
      "duplicate",
      "duplicate-2",
      "leaf-three",
    ]);
    expect(normalized.root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100);
    expect(normalized.root.children[0]).toMatchObject({
      elementIds: ["one"],
      activeElementId: "one",
    });
  });

  test("activates elements without mutating the input tree", () => {
    const value = splitValue();
    const active = activatePanesElement(value, "two");
    expect(active).not.toBe(value);
    expect(value.root.type === "split" && value.root.children[0]).toMatchObject({
      activeElementId: "one",
    });
    expect(active.root.type === "split" && active.root.children[0]).toMatchObject({
      activeElementId: "two",
    });
    expect(activatePanesElement(active, "unknown")).toBe(active);
  });

  test("clamps resize to the minimum adjacent pane size", () => {
    const resized = resizePanesSplit(splitValue(), "root", 0, 90);
    expect(resized.root.type === "split" && resized.root.sizes).toEqual([92, 8]);
  });

  test("reorders tabs and moves elements between leaves", () => {
    const reordered = applyPanesIntent(splitValue(), {
      kind: "move",
      elementId: "two",
      leafId: "left",
      beforeElementId: "one",
    });
    expect(reordered.root.type === "split" && reordered.root.children[0]).toMatchObject({
      elementIds: ["two", "one"],
      activeElementId: "two",
    });

    const moved = applyPanesIntent(reordered, {
      kind: "move",
      elementId: "two",
      leafId: "right",
    });
    expect(moved.root.type === "split" && moved.root.children).toMatchObject([
      { elementIds: ["one"] },
      { elementIds: ["three", "two"], activeElementId: "two", presentation: "tabs" },
    ]);
  });

  test("creates deterministic nested splits and preserves every element", () => {
    const intent = {
      kind: "split",
      elementId: "two",
      leafId: "left",
      zone: "right",
    } as const;
    const first = applyPanesIntent(splitValue(), intent);
    const second = applyPanesIntent(splitValue(), intent);
    expect(first).toEqual(second);
    expect(first.root.type === "split" && first.root.children[0]).toMatchObject({
      type: "split",
      id: "split-left",
      direction: "horizontal",
      children: [
        { id: "left", elementIds: ["one"] },
        { id: "leaf-two", elementIds: ["two"] },
      ],
    });
  });

  test("inserts a moved leaf at an existing split gap before pruning its source", () => {
    const inserted = applyPanesIntent(splitValue(), {
      kind: "insert",
      elementId: "three",
      splitId: "root",
      index: 0,
      direction: "horizontal",
    });
    expect(inserted.root.type).toBe("split");
    if (inserted.root.type !== "split") throw new Error("Expected split");
    expect(inserted.root.children).toMatchObject([
      { id: "left", elementIds: ["one", "two"] },
      { id: "leaf-three", elementIds: ["three"] },
    ]);
    expect(inserted.root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100);
  });

  test("ignores intents whose target no longer exists", () => {
    const value = splitValue();
    expect(
      applyPanesIntent(value, {
        kind: "move",
        elementId: "one",
        leafId: "gone",
      }),
    ).toBe(value);
  });
});
