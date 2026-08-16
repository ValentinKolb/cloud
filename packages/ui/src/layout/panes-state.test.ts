import { describe, expect, test } from "bun:test";
import {
  activatePanesElement,
  applyPanesIntent,
  createPanesValue,
  getPanesDropTargets,
  normalizePanesValue,
  type PanesValue,
  resizePanesSplit,
  resolvePanesDropIntent,
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
    expect(normalized.root.children.map((node) => node.id)).toEqual(["duplicate", "duplicate-2", "leaf-three"]);
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

    const movedToEnd = applyPanesIntent(reordered, {
      kind: "move",
      elementId: "two",
      leafId: "left",
      beforeElementId: null,
    });
    expect(movedToEnd.root.type === "split" && movedToEnd.root.children[0]).toMatchObject({
      elementIds: ["one", "two"],
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

  test("reorders every slot in a three-tab strip", () => {
    const value = createPanesValue(["one", "two", "three"]);
    const movedToStart = applyPanesIntent(value, {
      kind: "move",
      elementId: "three",
      leafId: "root",
      beforeElementId: "one",
    });
    expect(movedToStart.root).toMatchObject({ elementIds: ["three", "one", "two"] });

    const movedToEnd = applyPanesIntent(value, {
      kind: "move",
      elementId: "one",
      leafId: "root",
      beforeElementId: null,
    });
    expect(movedToEnd.root).toMatchObject({ elementIds: ["two", "three", "one"] });

    const movedBetween = applyPanesIntent(value, {
      kind: "move",
      elementId: "three",
      leafId: "root",
      beforeElementId: "two",
    });
    expect(movedBetween.root).toMatchObject({ elementIds: ["one", "three", "two"] });
  });

  test("creates deterministic splits and preserves every element", () => {
    const intent = {
      kind: "split",
      elementId: "two",
      leafId: "left",
      zone: "right",
    } as const;
    const first = applyPanesIntent(splitValue(), intent);
    const second = applyPanesIntent(splitValue(), intent);
    expect(first).toEqual(second);
    expect(first.root.type === "split" && first.root.children).toMatchObject([
      { id: "left", elementIds: ["one"] },
      { id: "leaf-two", elementIds: ["two"] },
      { id: "right", elementIds: ["three"] },
    ]);
  });

  test("resolves equivalent pane edges to one meaningful drop target", () => {
    const flat: PanesValue = {
      root: {
        type: "split",
        id: "root",
        direction: "horizontal",
        sizes: [33, 34, 33],
        children: [
          { type: "leaf", id: "source", elementIds: ["source"], activeElementId: "source" },
          { type: "leaf", id: "preview", elementIds: ["preview"], activeElementId: "preview" },
          { type: "leaf", id: "data", elementIds: ["data"], activeElementId: "data" },
        ],
      },
    };
    const middle = { kind: "insert", elementId: "data", splitId: "root", index: 0, direction: "horizontal" } as const;

    expect(resolvePanesDropIntent(flat, { kind: "split", elementId: "data", leafId: "source", zone: "right" })).toEqual(middle);
    expect(resolvePanesDropIntent(flat, middle)).toEqual(middle);
    expect(resolvePanesDropIntent(flat, { kind: "split", elementId: "data", leafId: "preview", zone: "left" })).toEqual(middle);

    const nested: PanesValue = {
      root: {
        type: "split",
        id: "root",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          {
            type: "split",
            id: "left",
            direction: "vertical",
            sizes: [50, 50],
            children: [
              { type: "leaf", id: "source", elementIds: ["source"], activeElementId: "source" },
              { type: "leaf", id: "preview", elementIds: ["preview"], activeElementId: "preview" },
            ],
          },
          { type: "leaf", id: "data", elementIds: ["data"], activeElementId: "data" },
        ],
      },
    };

    expect(resolvePanesDropIntent(nested, { kind: "split", elementId: "data", leafId: "source", zone: "right" })).toEqual({
      kind: "split",
      elementId: "data",
      leafId: "source",
      zone: "right",
    });
    expect(resolvePanesDropIntent(nested, middle)).toBeNull();
    expect(resolvePanesDropIntent(nested, { kind: "split", elementId: "data", leafId: "data", zone: "left" })).toBeNull();
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
      expect(applyPanesIntent(value, { kind: "insert", elementId: "three", splitId: "root", index, direction: "horizontal" })).toBe(value);
    }

    // No `beforeElementId` means the pointer was released over the pane body.
    expect(applyPanesIntent(value, { kind: "move", elementId: "one", leafId: "left" })).toBe(value);
    expect(applyPanesIntent(value, { kind: "move", elementId: "two", leafId: "left" })).toBe(value);
    expect(applyPanesIntent(value, { kind: "move", elementId: "two", leafId: "left", beforeElementId: null })).toBe(value);

    // A real reorder inside the same leaf still applies.
    const reordered = applyPanesIntent(value, { kind: "move", elementId: "two", leafId: "left", beforeElementId: "one" });
    expect(reordered).not.toBe(value);
    expect(reordered.root.type === "split" && reordered.root.children[0]).toMatchObject({ elementIds: ["two", "one"] });
    const movedToEnd = applyPanesIntent(value, { kind: "move", elementId: "one", leafId: "left", beforeElementId: null });
    expect(movedToEnd.root.type === "split" && movedToEnd.root.children[0]).toMatchObject({ elementIds: ["two", "one"] });
  });

  test("enumerates valid explicit tab, group, and split targets", () => {
    const value = splitValue();
    const targets = getPanesDropTargets(value, "two", {
      allowMove: true,
      allowReorder: true,
      allowHorizontalSplit: true,
      allowVerticalSplit: true,
    });

    expect(new Set(targets.map((target) => target.kind))).toEqual(new Set(["tab", "group", "split"]));
    expect(targets.some((target) => target.kind === "tab" && target.leafId === "left" && target.beforeElementId === "one")).toBe(true);
    expect(targets.some((target) => target.kind === "tab" && target.leafId === "left" && target.beforeElementId === "two")).toBe(false);
    expect(targets.some((target) => target.kind === "tab" && target.leafId === "left" && target.beforeElementId === null)).toBe(false);
    expect(targets.some((target) => target.kind === "group" && target.leafId === "right")).toBe(true);
    expect(
      getPanesDropTargets(value, "two", {
        allowMove: false,
        allowReorder: true,
        allowHorizontalSplit: true,
        allowVerticalSplit: true,
      }),
    ).toEqual([]);

    const disabled = targets.filter((target) => target.disabled);
    expect(disabled.every((target) => target.kind === "split")).toBe(true);

    const enabled = targets.filter((target) => !target.disabled);
    const results = enabled.map((target) => applyPanesIntent(value, target.intent));
    expect(results.every((result) => result !== value)).toBe(true);
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(results.length);
  });

  test("honors operation flags and deduplicates nested equivalent edges", () => {
    const flat: PanesValue = {
      root: {
        type: "split",
        id: "root",
        direction: "horizontal",
        sizes: [33, 34, 33],
        children: [
          { type: "leaf", id: "source", elementIds: ["source"], activeElementId: "source" },
          { type: "leaf", id: "preview", elementIds: ["preview"], activeElementId: "preview" },
          { type: "leaf", id: "data", elementIds: ["data"], activeElementId: "data" },
        ],
      },
    };
    const targets = getPanesDropTargets(flat, "data", {
      allowMove: true,
      allowReorder: false,
      allowHorizontalSplit: true,
      allowVerticalSplit: false,
    });

    expect(targets.every((target) => target.kind === "split" && (target.zone === "left" || target.zone === "right"))).toBe(true);
    expect(
      targets.filter(
        (target) => !target.disabled && target.intent.kind === "insert" && target.intent.splitId === "root" && target.intent.index === 0,
      ),
    ).toHaveLength(1);
    expect(targets.filter((target) => target.leafId === "data")).toEqual([
      expect.objectContaining({ kind: "split", zone: "left", disabled: true }),
      expect.objectContaining({ kind: "split", zone: "right", disabled: true }),
    ]);

    const verticalOnly = getPanesDropTargets(splitValue(), "two", {
      allowMove: true,
      allowReorder: false,
      allowHorizontalSplit: false,
      allowVerticalSplit: true,
    });
    expect(verticalOnly.every((target) => target.kind === "split" && (target.zone === "top" || target.zone === "bottom"))).toBe(true);
  });

  test("rejects a persisted layout stamped with a different schema version", () => {
    const stored = { ...splitValue(), version: 2 };

    expect(normalizePanesValue(stored, ["one", "two", "three"])).toEqual(createPanesValue(["one", "two", "three"], "tabs"));
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
    expect(
      applyPanesIntent(value, {
        kind: "move",
        elementId: "one",
        leafId: "left",
        beforeElementId: "gone",
      }),
    ).toBe(value);
  });
});
