import { describe, expect, test } from "bun:test";
import { focusMailComposerEditorAtStart } from "./mail-composer-editor-focus";

describe("Mail composer initial focus", () => {
  test("focuses the body and places the caret before signature content", () => {
    const calls: unknown[][] = [];
    const editor = {
      focus: () => calls.push(["focus"]),
      setSelectionRange: (start: number, end: number) => calls.push(["selection", start, end]),
    } as unknown as HTMLTextAreaElement;

    focusMailComposerEditorAtStart(editor);

    expect(calls).toEqual([["focus"], ["selection", 0, 0]]);
  });
});
