import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";
import { isPointerSelectionTransaction, selectionIntersectsRange } from "./cursor-zone-field";

describe("selectionIntersectsRange", () => {
  test("keeps empty cursor containment semantics", () => {
    expect(selectionIntersectsRange(EditorSelection.cursor(5), 3, 8)).toBe(true);
    expect(selectionIntersectsRange(EditorSelection.cursor(9), 3, 8)).toBe(false);
  });

  test("matches non-empty selections that overlap a range", () => {
    expect(selectionIntersectsRange(EditorSelection.range(0, 20), 3, 8)).toBe(true);
    expect(selectionIntersectsRange(EditorSelection.range(0, 3), 3, 8)).toBe(false);
    expect(selectionIntersectsRange(EditorSelection.range(8, 12), 3, 8)).toBe(false);
  });
});

describe("isPointerSelectionTransaction", () => {
  test("matches pointer-only selection transactions", () => {
    const state = EditorState.create({ doc: "hello" });

    expect(isPointerSelectionTransaction(state.update({ selection: { anchor: 1, head: 4 }, userEvent: "select.pointer" }))).toBe(true);
    expect(isPointerSelectionTransaction(state.update({ selection: { anchor: 1, head: 4 }, userEvent: "select" }))).toBe(false);
    expect(
      isPointerSelectionTransaction(
        state.update({ changes: { from: 1, insert: "!" }, selection: { anchor: 2 }, userEvent: "select.pointer" }),
      ),
    ).toBe(false);
  });
});
