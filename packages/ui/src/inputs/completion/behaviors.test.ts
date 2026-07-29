import { afterEach, describe, expect, test } from "bun:test";
import { applySuggestion, resetCompletionState, tryExpand, tryRestore } from "./behaviors";
import type { Completion, QueryContext, Suggestion } from "./engine";

type FakeTextarea = HTMLTextAreaElement & {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

let active: FakeTextarea | null = null;
const originalDocument = globalThis.document;

const textarea = (value: string): FakeTextarea =>
  ({
    value,
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start: number, end: number) {
      active = this;
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  }) as FakeTextarea;

const context = (text: string): QueryContext => ({
  start: 0,
  end: text.length,
  text,
  query: text,
  completion: { suggest: () => [] },
});

const installExecCommand = (): void => {
  globalThis.document = {
    execCommand: (_command: string, _showUi: boolean, value: string) => {
      if (!active) return false;
      const start = active.selectionStart;
      active.value = active.value.slice(0, start) + value + active.value.slice(active.selectionEnd);
      active.selectionStart = start + value.length;
      active.selectionEnd = active.selectionStart;
      return true;
    },
  } as Document;
};

afterEach(() => {
  resetCompletionState();
  active = null;
  globalThis.document = originalDocument;
});

describe("completion behaviors", () => {
  test("accepted expansion participates in immediate Backspace restore", () => {
    globalThis.document = {
      execCommand: (_command: string, _showUi: boolean, value: string) => {
        if (!active) return false;
        const start = active.selectionStart;
        active.value = active.value.slice(0, start) + value + active.value.slice(active.selectionEnd);
        active.selectionStart = start + value.length;
        active.selectionEnd = active.selectionStart;
        return true;
      },
    } as Document;
    const element = textarea("Units");
    const suggestion: Suggestion = {
      text: "Units",
      expansion: "#Wf87H",
      label: "Units",
    };

    expect(applySuggestion(element, context("Units"), suggestion)).toBe(true);
    expect(element.value).toBe("#Wf87H ");
    expect(tryRestore(element)).toBe(true);
    expect(element.value).toBe("Units ");
  });

  test("accepted expansion can opt out of Backspace restore tracking", () => {
    installExecCommand();
    const element = textarea("Units");
    const suggestion: Suggestion = { text: "Units", expansion: "#Wf87H", label: "Units" };

    expect(applySuggestion(element, context("Units"), suggestion, { trackExpansion: false })).toBe(true);
    expect(element.value).toBe("#Wf87H ");
    expect(tryRestore(element)).toBe(false);
    expect(element.value).toBe("#Wf87H ");
  });

  test("validates explicit text edit ranges", () => {
    globalThis.document = { execCommand: () => true } as unknown as Document;
    const element = textarea("abc");
    expect(
      applySuggestion(element, context("abc"), {
        text: "x",
        textEdit: { start: -1, end: 2, text: "x" },
      }),
    ).toBe(false);
  });

  test("applies explicit suggestion text edits over the requested range", () => {
    installExecCommand();
    const element = textarea("from table Ord\nselect Amount");

    expect(
      applySuggestion(element, context("Ord"), {
        text: "Orders",
        textEdit: { start: "from table ".length, end: "from table Ord".length, text: "Orders" },
      }),
    ).toBe(true);
    expect(element.value).toBe("from table Orders\nselect Amount");
  });

  test("expands an abbreviation on a word boundary and suppresses the re-entrant input", () => {
    installExecCommand();
    const completions: Completion[] = [{ suggest: () => [{ text: "brb", expansion: "be right back" }] }];
    const element = textarea("brb ");
    element.selectionStart = 4;
    element.selectionEnd = 4;

    expect(tryExpand(element, completions)).toBe(true);
    expect(element.value).toBe("be right back ");
    // The execCommand above dispatches a synchronous input event in a real
    // browser; the next call must not cascade into another expansion.
    expect(tryExpand(element, completions)).toBe(false);
  });

  test("never expands where the host marks the position as excluded", () => {
    installExecCommand();
    const completions: Completion[] = [{ suggest: () => [{ text: "brb", expansion: "be right back" }] }];
    const element = textarea("`brb `");
    element.selectionStart = 5;
    element.selectionEnd = 5;

    expect(tryExpand(element, completions, { isExcluded: () => true })).toBe(false);
    expect(element.value).toBe("`brb `");
  });
});
