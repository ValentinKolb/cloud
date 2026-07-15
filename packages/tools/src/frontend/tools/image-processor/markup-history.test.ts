import { describe, expect, test } from "bun:test";
import { commitMarkupHistory, type MarkupHistoryState, redoMarkupHistory, undoMarkupHistory } from "./markup-history";
import type { MarkupElement } from "./types";

const element = (id: string): MarkupElement => ({
  id,
  kind: "stroke",
  points: [{ x: 0.5, y: 0.5 }],
  color: "#000",
  size: 0.01,
  opacity: 1,
});

const empty = (): MarkupHistoryState => ({ markup: [], markupUndo: [], markupRedo: [] });

describe("markup history", () => {
  test("undoes and redoes create, update, and delete snapshots", () => {
    const first = commitMarkupHistory(empty(), [element("first")]);
    const original = first.markup[0]!;
    if (original.kind !== "stroke") throw new Error("Expected a stroke fixture");
    const moved = commitMarkupHistory(first, [{ ...original, points: [{ x: 0.7, y: 0.7 }] }]);
    const deleted = commitMarkupHistory(moved, []);

    const restoredMove = undoMarkupHistory(deleted);
    expect(restoredMove.markup[0]?.id).toBe("first");
    expect(restoredMove.markup[0]?.kind === "stroke" ? restoredMove.markup[0].points[0] : null).toEqual({ x: 0.7, y: 0.7 });
    const restoredCreate = undoMarkupHistory(restoredMove);
    expect(restoredCreate.markup[0]?.kind === "stroke" ? restoredCreate.markup[0].points[0] : null).toEqual({ x: 0.5, y: 0.5 });
    const redone = redoMarkupHistory(restoredCreate).markup[0];
    expect(redone?.kind === "stroke" ? redone.points[0] : null).toEqual({
      x: 0.7,
      y: 0.7,
    });
  });

  test("clears redo after a new mutation", () => {
    const first = commitMarkupHistory(empty(), [element("first")]);
    const undone = undoMarkupHistory(first);
    const replacement = commitMarkupHistory(undone, [element("replacement")]);
    expect(replacement.markupRedo).toEqual([]);
    expect(redoMarkupHistory(replacement)).toBe(replacement);
  });

  test("does not record the current snapshot as a new mutation", () => {
    const state = commitMarkupHistory(empty(), [element("first")]);
    expect(commitMarkupHistory(state, state.markup)).toBe(state);
  });

  test("caps retained snapshots", () => {
    let state = empty();
    for (let index = 0; index < 5; index++) state = commitMarkupHistory(state, [element(String(index))], 3);
    expect(state.markupUndo).toHaveLength(3);
    expect(state.markupUndo.map((snapshot) => snapshot[0]?.id ?? "empty")).toEqual(["1", "2", "3"]);
  });

  test("keeps histories isolated when entries are updated by id", () => {
    const entries = [
      { id: "one", ...empty() },
      { id: "two", ...empty() },
    ];
    const updated = entries.map((entry) => (entry.id === "one" ? { ...entry, ...commitMarkupHistory(entry, [element("mark")]) } : entry));
    expect(updated[0]?.markup.map((item) => item.id)).toEqual(["mark"]);
    expect(updated[1]).toBe(entries[1]);
    expect(updated[1]?.markup).toEqual([]);
  });
});
