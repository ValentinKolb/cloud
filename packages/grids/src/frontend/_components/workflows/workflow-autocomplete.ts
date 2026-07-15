import type { Completion, SuggestContext, Suggestion } from "@valentinkolb/cloud/ui";
import type { WorkflowAutocompleteResponse, WorkflowCompletionItem } from "../../../workflows/contracts";

export type WorkflowAutocompleteRequest = {
  source: string;
  caret: number;
};

type WorkflowAutocompleteFetcher = (request: WorkflowAutocompleteRequest, signal: AbortSignal) => Promise<WorkflowAutocompleteResponse>;

const WORKFLOW_TRIGGER_CHARS = [" ", "\n", "\t", ":", "-", ".", "[", "{", ",", "'"];

const isKnownLabelScan = (ctx: SuggestContext) => ctx.fullText === "" && ctx.caret === 0 && ctx.tokenStart === 0;

export const toSuggestion = (item: WorkflowCompletionItem): Suggestion => ({
  text: item.insertText,
  label: item.label,
  hint: item.detail ?? item.kind,
  appendSpace: false,
  textEdit: item.textEdit,
});

export const buildBackendWorkflowCompletions = (config: {
  fetchAutocomplete: WorkflowAutocompleteFetcher;
  onDiagnostics?: (response: WorkflowAutocompleteResponse) => void;
}): Completion[] => {
  const suggest = (_query: string, ctx: SuggestContext, signal: AbortSignal): Suggestion[] | Promise<Suggestion[]> => {
    if (signal.aborted || isKnownLabelScan(ctx)) return [];
    return config.fetchAutocomplete({ source: ctx.fullText, caret: ctx.caret }, signal).then((response) => {
      if (signal.aborted) return [];
      config.onDiagnostics?.(response);
      return response.items.map(toSuggestion);
    });
  };

  return [
    { dropdown: true, suggest },
    ...WORKFLOW_TRIGGER_CHARS.map(
      (trigger): Completion => ({
        trigger,
        dropdown: true,
        allowAfterWord: true,
        suggest,
      }),
    ),
  ];
};
