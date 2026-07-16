import { AutocompleteEditor, type AutocompleteEditorProps } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { createMemo, splitProps } from "solid-js";
import { aggregateKindPattern } from "../../../aggregate-catalog";
import { apiClient } from "../../../api/client";
import { errorMessage } from "../utils/api-helpers";
import { buildBackendGqlCompletions, type GqlCurrentSource } from "./query-autocomplete";

const gqlHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|as|on|where|formula|group|by|aggregate|having|sort|search|include|deleted|only|nulls|first|last|limit|offset|asc|desc|and|or|not)\b/i,
    },
    { kind: "function", match: aggregateKindPattern() },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

type Props = Omit<AutocompleteEditorProps, "completions" | "highlight"> & {
  baseId: string;
  currentSource?: GqlCurrentSource;
};

export function GqlSourceEditor(props: Props) {
  const [scope, editorProps] = splitProps(props, ["baseId", "currentSource"]);
  const completions = createMemo(() =>
    buildBackendGqlCompletions({
      currentSource: scope.currentSource,
      fetchAutocomplete: async (request, signal) => {
        const response = await apiClient.gql["by-base"][":baseId"].autocomplete.$post(
          { param: { baseId: scope.baseId }, json: request },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await errorMessage(response, "Could not load query suggestions."));
        return response.json();
      },
    }),
  );

  return <AutocompleteEditor {...editorProps} completions={completions()} highlight={gqlHighlight} />;
}
