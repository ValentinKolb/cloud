import { describe, expect, test } from "bun:test";
import {
  activatePanesElement,
  applyPanesIntent,
  createPanesValue,
  normalizePanesValue,
  resizePanesSplit,
  type PanesValue,
} from "./panes-state";

const splitValue = (): PanesValue => ({
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
      elementId: "one",
      splitId: "root",
      index: 0,
      direction: "horizontal",
    });
    expect(inserted.root.type).toBe("split");
    if (inserted.root.type !== "split") throw new Error("Expected split");
    expect(inserted.root.children).toMatchObject([
      { id: "left", elementIds: ["two"] },
      { id: "leaf-one", elementIds: ["one"] },
      { id: "right", elementIds: ["three"] },
    ]);
    expect(inserted.root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100);
  });

  /**
   * Both of these gestures ask for the arrangement that already exists. Before
   * the fix the insert path tore the leaf down and rebuilt it under a new node
   * id with renormalized sizes, and the move path pushed the dragged tab to the
   * end of its own strip — so a released drag silently reordered the tabs.
   */
  test("treats a drop onto a pane's own position as a no-op", () => {
    const value = splitValue();

    // "three" is the solo occupant of child index 1; gaps 0 and 1 are its own.
    for (const index of [0, 1]) {
      expect(
        applyPanesIntent(value, { kind: "insert", elementId: "three", splitId: "root", index, direction: "horizontal" }),
      ).toBe(value);
    }

    // No `beforeElementId` means the pointer was released over the pane body.
    expect(applyPanesIntent(value, { kind: "move", elementId: "one", leafId: "left" })).toBe(value);
    expect(applyPanesIntent(value, { kind: "move", elementId: "two", leafId: "left" })).toBe(value);

    // A real reorder inside the same leaf still applies.
    const reordered = applyPanesIntent(value, { kind: "move", elementId: "two", leafId: "left", beforeElementId: "one" });
    expect(reordered).not.toBe(value);
    expect(reordered.root.type === "split" && reordered.root.children[0]).toMatchObject({ elementIds: ["two", "one"] });
  });

  test("rejects a persisted layout stamped with a different schema version", () => {
    const stored = { ...splitValue(), version: 2 };

    expect(normalizePanesValue(stored, ["one", "two", "three"])).toEqual(
      createPanesValue(["one", "two", "three"], "tabs"),
    );
    // An unversioned payload predates the field and is still trusted.
    expect(normalizePanesValue({ root: splitValue().root }, ["one", "two", "three"]).root.type).toBe("split");
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
