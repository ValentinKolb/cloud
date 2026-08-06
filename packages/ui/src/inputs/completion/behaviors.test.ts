import { afterEach, describe, expect, test } from "bun:test";
import { createCompletionBehaviorState } from "./behaviors";
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
    focus(this: FakeTextarea) {
      active = this;
    },
    setSelectionRange(this: FakeTextarea, start: number, end: number) {
      active = this;
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    dispatchEvent() {
      return true;
    },
  }) as unknown as FakeTextarea;

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
  active = null;
  globalThis.document = originalDocument;
});

describe("completion behaviors", () => {
  test("accepted expansion participates in immediate Backspace restore", () => {
    const behavior = createCompletionBehaviorState();
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

    expect(behavior.applySuggestion(element, context("Units"), suggestion)).toBe(true);
    expect(element.value).toBe("#Wf87H ");
    expect(behavior.tryRestore(element)).toBe(true);
    expect(element.value).toBe("Units ");
  });

  test("accepted expansion can opt out of Backspace restore tracking", () => {
    const behavior = createCompletionBehaviorState();
    installExecCommand();
    const element = textarea("Units");
    const suggestion: Suggestion = { text: "Units", expansion: "#Wf87H", label: "Units" };

    expect(behavior.applySuggestion(element, context("Units"), suggestion, { trackExpansion: false })).toBe(true);
    expect(element.value).toBe("#Wf87H ");
    expect(behavior.tryRestore(element)).toBe(false);
    expect(element.value).toBe("#Wf87H ");
  });

  test("validates explicit text edit ranges", () => {
    const behavior = createCompletionBehaviorState();
    globalThis.document = { execCommand: () => true } as unknown as Document;
    const element = textarea("abc");
    expect(
      behavior.applySuggestion(element, context("abc"), {
        text: "x",
        textEdit: { start: -1, end: 2, text: "x" },
      }),
    ).toBe(false);
  });

  test("applies explicit suggestion text edits over the requested range", () => {
    const behavior = createCompletionBehaviorState();
    installExecCommand();
    const element = textarea("from table Ord\nselect Amount");

    expect(
      behavior.applySuggestion(element, context("Ord"), {
        text: "Orders",
        textEdit: { start: "from table ".length, end: "from table Ord".length, text: "Orders" },
      }),
    ).toBe(true);
    expect(element.value).toBe("from table Orders\nselect Amount");
  });

  test("expands an abbreviation on a word boundary and suppresses the re-entrant input", () => {
    const behavior = createCompletionBehaviorState();
    installExecCommand();
    const completions: Completion[] = [{ suggest: () => [{ text: "brb", expansion: "be right back" }] }];
    const element = textarea("brb ");
    element.selectionStart = 4;
    element.selectionEnd = 4;

    expect(behavior.tryExpand(element, completions)).toBe(true);
    expect(element.value).toBe("be right back ");
    // The execCommand above dispatches a synchronous input event in a real
    // browser; the next call must not cascade into another expansion.
    expect(behavior.tryExpand(element, completions)).toBe(false);
  });

  test("never expands where the host marks the position as excluded", () => {
    const behavior = createCompletionBehaviorState();
    installExecCommand();
    const completions: Completion[] = [{ suggest: () => [{ text: "brb", expansion: "be right back" }] }];
    const element = textarea("`brb `");
    element.selectionStart = 5;
    element.selectionEnd = 5;

    expect(behavior.tryExpand(element, completions, { isExcluded: () => true })).toBe(false);
    expect(element.value).toBe("`brb `");
  });

  test("keeps restoration state isolated between editor instances", () => {
    installExecCommand();
    const first = createCompletionBehaviorState();
    const second = createCompletionBehaviorState();
    const firstElement = textarea("Units");
    const secondElement = textarea("Orders");

    expect(first.applySuggestion(firstElement, context("Units"), { text: "Units", expansion: "#Wf87H" })).toBe(true);
    expect(second.applySuggestion(secondElement, context("Orders"), { text: "Orders", expansion: "#Ab12C" })).toBe(true);
    second.reset();

    expect(first.tryRestore(firstElement)).toBe(true);
    expect(firstElement.value).toBe("Units ");
    expect(second.tryRestore(secondElement)).toBe(false);
  });

  test("falls back to direct range replacement when insertText is unavailable", () => {
    const behavior = createCompletionBehaviorState();
    globalThis.document = { execCommand: () => false } as unknown as Document;
    const element = textarea("Hi @al");

    expect(
      behavior.applySuggestion(
        element,
        {
          start: 3,
          end: 6,
          text: "@al",
          query: "al",
          completion: { suggest: () => [] },
        },
        { text: "@alice", appendSpace: false },
      ),
    ).toBe(true);
    expect(element.value).toBe("Hi @alice");
  });
});
