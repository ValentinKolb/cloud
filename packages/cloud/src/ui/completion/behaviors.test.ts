import { afterEach, describe, expect, test } from "bun:test";
import type { QueryContext, Suggestion } from "./engine";
import { applySuggestion, resetCompletionState, tryRestore } from "./behaviors";

type FakeTextarea = HTMLTextAreaElement & {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange: (start: number, end: number) => void;
};

let activeTextarea: FakeTextarea | null = null;
const originalDocument = globalThis.document;

const installExecCommand = () => {
  globalThis.document = {
    execCommand: (_command: string, _showUi: boolean, value: string) => {
      if (!activeTextarea) return false;
      const start = activeTextarea.selectionStart;
      const end = activeTextarea.selectionEnd;
      activeTextarea.value = `${activeTextarea.value.slice(0, start)}${value}${activeTextarea.value.slice(end)}`;
      activeTextarea.selectionStart = start + value.length;
      activeTextarea.selectionEnd = start + value.length;
      return true;
    },
  } as Document;
};

const textarea = (value: string): FakeTextarea =>
  ({
    value,
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start: number, end: number) {
      activeTextarea = this;
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  }) as FakeTextarea;

const ctx = (text: string): QueryContext => ({
  start: 0,
  end: text.length,
  text,
  query: text,
  completion: { suggest: () => [] },
});

const fieldSuggestion: Suggestion = {
  text: "Units",
  expansion: "#Wf87H",
  label: "Units",
};

afterEach(() => {
  resetCompletionState();
  activeTextarea = null;
  globalThis.document = originalDocument;
});

describe("completion behaviours", () => {
  test("accepted expansion restores to display text by default", () => {
    installExecCommand();
    const el = textarea("Units");

    expect(applySuggestion(el, ctx("Units"), fieldSuggestion)).toBe(true);
    expect(el.value).toBe("#Wf87H ");

    expect(tryRestore(el)).toBe(true);
    expect(el.value).toBe("Units ");
  });

  test("accepted expansion can opt out of Backspace restore tracking", () => {
    installExecCommand();
    const el = textarea("Units");

    expect(applySuggestion(el, ctx("Units"), fieldSuggestion, { trackExpansion: false })).toBe(true);
    expect(el.value).toBe("#Wf87H ");

    expect(tryRestore(el)).toBe(false);
    expect(el.value).toBe("#Wf87H ");
  });

  test("applies explicit suggestion text edits", () => {
    installExecCommand();
    const el = textarea("from table Ord\nselect Amount");
    const suggestion: Suggestion = {
      text: "Orders",
      textEdit: { start: "from table ".length, end: "from table Ord".length, text: "Orders" },
    };

    expect(applySuggestion(el, ctx("Ord"), suggestion)).toBe(true);
    expect(el.value).toBe("from table Orders\nselect Amount");
  });
});
