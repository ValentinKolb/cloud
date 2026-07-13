import { describe, expect, test } from "bun:test";
import { insertTextAtEditorSelection, queryEditorForScope } from "./QueryWorkspace";

const editor = (selectionStart: number, selectionEnd = selectionStart) => ({ selectionEnd, selectionStart }) as HTMLTextAreaElement;

const scope = (ownedEditor: HTMLTextAreaElement) => ({ querySelector: () => ownedEditor }) as unknown as ParentNode;

describe("QueryWorkspace editor insertion", () => {
  test("resolves the editor only from its workspace scope", () => {
    const firstEditor = editor(5);
    const secondEditor = editor(17);

    expect(queryEditorForScope(scope(firstEditor))).toBe(firstEditor);
    expect(queryEditorForScope(scope(secondEditor))).toBe(secondEditor);
    expect(queryEditorForScope(undefined)).toBeNull();
  });

  test("keeps insertions independent across multiple editors", () => {
    const secondSource = "from Orders\nselect Total";
    const first = insertTextAtEditorSelection("from Items", ' "Name"', queryEditorForScope(scope(editor(4))));
    const second = insertTextAtEditorSelection(secondSource, ' "Status"', queryEditorForScope(scope(editor(secondSource.length))));

    expect(first).toEqual({ value: 'from "Name" Items', caret: 11 });
    expect(second).toEqual({ value: 'from Orders\nselect Total "Status"', caret: 33 });
  });

  test("replaces the active selection and appends without an editor", () => {
    expect(insertTextAtEditorSelection("select Old", '"New"', editor(7, 10))).toEqual({ value: 'select "New"', caret: 12 });
    expect(insertTextAtEditorSelection("from Items", "\nlimit 10", null)).toEqual({
      value: "from Items\nlimit 10",
      caret: 19,
    });
  });
});
