import { describe, expect, test } from "bun:test";
import { buildBackendWorkflowCompletions, toSuggestion, type WorkflowAutocompleteRequest } from "./workflow-autocomplete";

describe("backend workflow autocomplete adapter", () => {
  test("maps server completion items to editor text edits", () => {
    expect(
      toSuggestion({
        kind: "keyword",
        label: "triggers",
        detail: "Declare how this workflow starts",
        insertText: "triggers:\n  ",
        textEdit: { start: 0, end: 3, text: "triggers:\n  " },
      }),
    ).toEqual({
      text: "triggers:\n  ",
      label: "triggers",
      hint: "Declare how this workflow starts",
      appendSpace: false,
      textEdit: { start: 0, end: 3, text: "triggers:\n  " },
    });
  });

  test("asks the backend with full YAML source and caret", async () => {
    const seen: WorkflowAutocompleteRequest[] = [];
    const diagnostics = [{ message: "define at least one trigger" }];
    const completions = buildBackendWorkflowCompletions({
      fetchAutocomplete: async (request) => {
        seen.push(request);
        return {
          ok: true,
          diagnostics,
          items: [
            {
              kind: "keyword",
              label: "form",
              insertText: "form: {}",
              textEdit: { start: 10, end: 10, text: "form: {}" },
            },
          ],
        };
      },
      onDiagnostics: (response) => {
        expect(response.diagnostics).toEqual(diagnostics);
      },
    });

    const suggestions = await completions[0]!.suggest("", { fullText: "triggers:\n", caret: 10, tokenStart: 10 }, new AbortController().signal);

    expect(seen).toEqual([{ source: "triggers:\n", caret: 10 }]);
    expect(suggestions).toEqual([
      {
        text: "form: {}",
        label: "form",
        hint: "keyword",
        appendSpace: false,
        textEdit: { start: 10, end: 10, text: "form: {}" },
      },
    ]);
  });

  test("does not call the backend during known-label scans", () => {
    let calls = 0;
    const completions = buildBackendWorkflowCompletions({
      fetchAutocomplete: async () => {
        calls += 1;
        return { ok: true, diagnostics: [], items: [] };
      },
    });

    const suggestions = completions[0]!.suggest("", { fullText: "", caret: 0, tokenStart: 0 }, new AbortController().signal);

    expect(suggestions).toEqual([]);
    expect(calls).toBe(0);
  });
});
