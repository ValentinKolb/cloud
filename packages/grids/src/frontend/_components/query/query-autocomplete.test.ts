import { describe, expect, test } from "bun:test";
import { buildBackendGqlCompletions, type GqlAutocompleteRequest, toSuggestion } from "./query-autocomplete";

describe("backend GQL autocomplete adapter", () => {
  test("maps server completion items to editor text edits", () => {
    expect(
      toSuggestion({
        kind: "source",
        label: "Orders",
        detail: "table",
        insertText: "Orders",
        textEdit: { start: 11, end: 14, text: "Orders" },
      }),
    ).toEqual({
      text: "Orders",
      label: "Orders",
      hint: "table",
      appendSpace: false,
      textEdit: { start: 11, end: 14, text: "Orders" },
    });
  });

  test("asks the backend with full query, caret, and current source", async () => {
    const seen: GqlAutocompleteRequest[] = [];
    const source = { kind: "table" as const, tableId: "8f65ee89-0b2e-4010-a177-92bdb0c21e87" };
    const completions = buildBackendGqlCompletions({
      currentSource: source,
      fetchAutocomplete: async (request) => {
        seen.push(request);
        return {
          ok: true,
          diagnostics: [],
          items: [
            {
              kind: "field",
              label: "Amount",
              insertText: "Amount",
              textEdit: { start: 7, end: 7, text: "Amount" },
            },
          ],
        };
      },
    });

    const suggestions = await completions[0]!.suggest(
      "ignored-prefix",
      { fullText: "select ", caret: 7, tokenStart: 7 },
      new AbortController().signal,
    );

    const request = seen[0];
    if (!request) throw new Error("expected autocomplete request");
    expect(request.query).toBe("select ");
    expect(request.caret).toBe(7);
    expect(request.currentSource).toEqual(source);
    expect(suggestions).toEqual([
      {
        text: "Amount",
        label: "Amount",
        hint: "field",
        appendSpace: false,
        textEdit: { start: 7, end: 7, text: "Amount" },
      },
    ]);
  });

  test("does not call the backend during known-label scans", () => {
    let calls = 0;
    const completions = buildBackendGqlCompletions({
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
