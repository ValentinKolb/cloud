import { createMemo, For } from "solid-js";
import type { Completion, Suggestion } from "../completion";
import type { PanesValue } from "../misc/Panes";
import AutocompleteEditor from "./AutocompleteEditor";
import TextInput from "./TextInput";

export type TemplateVariableKind = "string" | "email" | "url" | "number" | "boolean" | "array" | "object";

export type TemplateVariable = {
  name: string;
  kind?: TemplateVariableKind;
};

export type TemplateEditorProps = {
  value: () => string;
  onInput: (value: string) => void;
  variables: readonly TemplateVariable[];
  lines?: number;
  fill?: boolean;
  placeholder?: string;
};

export type TemplatePreviewProps = {
  html: () => string;
};

export type TemplateSampleDataProps = {
  variables: readonly TemplateVariable[];
  values: () => Record<string, string>;
  onChange: (name: string, value: string) => void;
};

export const createTemplateEditorPanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "template-editor-root",
    direction: "horizontal",
    sizes: [50, 50],
    children: [
      {
        type: "leaf",
        id: "template-editor-source",
        presentation: "tabs",
        elementIds: ["html"],
        activeElementId: "html",
      },
      {
        type: "leaf",
        id: "template-editor-output",
        presentation: "tabs",
        elementIds: ["preview", "sample-data"],
        activeElementId: "preview",
      },
    ],
  },
});

const HTML_TAGS = [
  { name: "p", snippet: "<p></p>", hint: "paragraph" },
  { name: "a", snippet: '<a href="{{ LOGIN_URL }}">Link</a>', hint: "link" },
  { name: "strong", snippet: "<strong></strong>", hint: "bold" },
  { name: "em", snippet: "<em></em>", hint: "emphasis" },
  { name: "br", snippet: "<br>", hint: "line break" },
  { name: "ul", snippet: "<ul>\n  <li></li>\n</ul>", hint: "list" },
  { name: "table", snippet: "<table>\n  <tr><td></td></tr>\n</table>", hint: "table" },
] as const;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const buildSuggestion = (text: string, hint: string, label?: string): Suggestion => ({
  text,
  hint,
  label,
  appendSpace: false,
});

const makeCompletions = (variables: readonly TemplateVariable[]): Completion[] => [
  {
    trigger: "{",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, ctx) => {
      const normalized = query.toLowerCase();
      const hasLeadingBrace = ctx.tokenStart > 0 && ctx.fullText[ctx.tokenStart - 1] === "{";
      const open = hasLeadingBrace ? "{ " : "{{ ";
      const close = hasLeadingBrace ? " }}" : " }}";
      const variableSuggestions = variables
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) => buildSuggestion(`${open}${variable.name}${close}`, variable.kind ?? "string", variable.name));

      const sectionSuggestions = variables
        .filter((variable) => variable.kind !== "array")
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) => buildSuggestion(`{% if ${variable.name} != blank %}\n  \n{% endif %}`, "condition", `if ${variable.name}`));

      const loopSuggestions = variables
        .filter((variable) => variable.kind === "array")
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) =>
          buildSuggestion(`{% for item in ${variable.name} %}\n  {{ item }}\n{% endfor %}`, "loop", `for ${variable.name}`),
        );

      return [...variableSuggestions, ...sectionSuggestions, ...loopSuggestions];
    },
  },
  {
    trigger: "%",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query) => {
      const normalized = query.toLowerCase();
      const conditionSuggestions = variables
        .filter((variable) => variable.kind !== "array")
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) => buildSuggestion(`% if ${variable.name} != blank %}\n  \n{% endif %}`, "condition", `if ${variable.name}`));
      const loopSuggestions = variables
        .filter((variable) => variable.kind === "array")
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) =>
          buildSuggestion(`% for item in ${variable.name} %}\n  {{ item }}\n{% endfor %}`, "loop", `for ${variable.name}`),
        );
      return [...conditionSuggestions, ...loopSuggestions];
    },
  },
  {
    trigger: "<",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query) => {
      const normalized = query.toLowerCase();
      return HTML_TAGS.filter((tag) => tag.name.startsWith(normalized)).map((tag) => buildSuggestion(tag.snippet, tag.hint, tag.name));
    },
  },
];

const highlightLiquidToken = (token: string): string => {
  const inner = token.replace(/^\{\{|\}\}$|^\{%|\%}$/g, "").trim();
  const keyword = inner.split(/\s+/)[0] ?? "";
  const tone = token.startsWith("{%")
    ? keyword.startsWith("end")
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400"
    : inner.includes("| raw")
      ? "text-red-600 dark:text-red-400"
      : "text-violet-600 dark:text-violet-400";
  return `<span class="${tone}">${escapeHtml(token)}</span>`;
};

const highlightTag = (tag: string): string => {
  const match = tag.match(/^(&lt;\/?)([a-zA-Z][\w:-]*)([\s\S]*?)(&gt;)$/);
  if (!match) return `<span class="text-zinc-500 dark:text-zinc-400">${tag}</span>`;
  const open = match[1] ?? "";
  const name = match[2] ?? "";
  const attrs = match[3] ?? "";
  const close = match[4] ?? "";
  const attrHtml = attrs.replace(
    /([\w:-]+)(=)(&quot;[\s\S]*?&quot;|'[\s\S]*?'|[^\s&]+)/g,
    '<span class="text-sky-600 dark:text-sky-400">$1</span><span class="text-zinc-400">$2</span><span class="text-orange-600 dark:text-orange-400">$3</span>',
  );
  return `<span class="text-zinc-400">${open}</span><span class="text-blue-600 dark:text-blue-400">${name}</span>${attrHtml}<span class="text-zinc-400">${close}</span>`;
};

const highlightTemplate = (text: string): string => {
  const stashed: string[] = [];
  const escaped = escapeHtml(text).replace(/{{[\s\S]*?}}|{%[\s\S]*?%}/g, (token) => {
    const marker = `\uE000${stashed.length}\uE001`;
    stashed.push(highlightLiquidToken(token));
    return marker;
  });

  const withHtml = escaped.replace(/&lt;!--[\s\S]*?--&gt;|&lt;\/?[a-zA-Z][\s\S]*?&gt;/g, (tag) => {
    if (tag.startsWith("&lt;!--")) return `<span class="text-zinc-400 dark:text-zinc-500">${tag}</span>`;
    return highlightTag(tag);
  });

  return withHtml.replace(/\uE000(\d+)\uE001/g, (_, index) => stashed[Number(index)] ?? "");
};

export default function TemplateEditor(props: TemplateEditorProps) {
  const completions = createMemo(() => makeCompletions(props.variables));

  return (
    <AutocompleteEditor
      value={props.value}
      onInput={props.onInput}
      lines={props.lines ?? 22}
      fill={props.fill}
      spellcheck={false}
      placeholder={props.placeholder ?? "Write HTML with Liquid values like {{ APP_NAME }}..."}
      highlight={highlightTemplate}
      completions={completions()}
    />
  );
}

export function TemplatePreview(props: TemplatePreviewProps) {
  return (
    <section class="paper flex h-full min-h-0 flex-col overflow-hidden">
      <iframe class="min-h-0 flex-1 bg-white" sandbox="" srcdoc={props.html()} title="Template preview" />
    </section>
  );
}

export function TemplateSampleData(props: TemplateSampleDataProps) {
  return (
    <section class="paper h-full min-h-0 overflow-auto p-3">
      <div class="grid gap-3">
        <For each={props.variables}>
          {(variable) => (
            <TextInput
              label={`{{ ${variable.name} }}`}
              value={() => props.values()[variable.name] ?? ""}
              onInput={(value) => props.onChange(variable.name, value)}
            />
          )}
        </For>
      </div>
    </section>
  );
}
