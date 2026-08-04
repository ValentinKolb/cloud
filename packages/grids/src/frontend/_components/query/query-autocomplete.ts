import type { Completion, SuggestContext, Suggestion } from "@k2b/ui";
import type { DslQueryAutocompleteResponse, DslQueryCompletionItem } from "../../../contracts";

export type GqlCurrentSource = { kind: "table"; tableId: string } | { kind: "view"; viewId: string };

export type GqlAutocompleteRequest = {
  query: string;
  caret: number;
  currentTableId?: string;
  currentSource?: GqlCurrentSource;
};

type GqlAutocompleteFetcher = (request: GqlAutocompleteRequest, signal: AbortSignal) => Promise<DslQueryAutocompleteResponse>;

const GQL_TRIGGER_CHARS = [" ", "\n", "\t", ";", "(", ",", ".", "+", "-", "*", "/", "%", "=", "<", ">"];

export const toSuggestion = (item: DslQueryCompletionItem): Suggestion => ({
  text: item.insertText,
  label: item.label,
  hint: item.detail ?? item.kind,
  appendSpace: false,
  textEdit: item.textEdit,
});

export const buildBackendGqlCompletions = (config: {
  currentSource?: GqlCurrentSource;
  fetchAutocomplete: GqlAutocompleteFetcher;
}): Completion[] => {
  const suggest = (_query: string, ctx: SuggestContext, signal: AbortSignal): Suggestion[] | Promise<Suggestion[]> => {
    if (signal.aborted) return [];
    return config
      .fetchAutocomplete(
        {
          query: ctx.fullText,
          caret: ctx.caret,
          ...(config.currentSource?.kind === "table" ? { currentTableId: config.currentSource.tableId } : {}),
          ...(config.currentSource ? { currentSource: config.currentSource } : {}),
        },
        signal,
      )
      .then((response) => (signal.aborted ? [] : response.items.map(toSuggestion)));
  };

  return [
    { dropdown: true, suggest },
    ...GQL_TRIGGER_CHARS.map(
      (trigger): Completion => ({
        trigger,
        dropdown: true,
        allowAfterWord: true,
        suggest,
      }),
    ),
  ];
};
