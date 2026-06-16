import { AutocompleteEditor, type Completion, Panes, type PanesValue, type Suggestion, TextInput } from "@valentinkolb/cloud/ui";
import Mustache from "mustache";
import { createContext, createMemo, createSignal, For, type JSX, useContext } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI_LAB = "ui-lab prototype";

export type TemplateVariableKind = "string" | "email" | "url" | "number" | "boolean" | "array" | "object";

export type TemplateVariable = {
  name: string;
  label?: string;
  description?: string;
  kind?: TemplateVariableKind;
  defaultValue: unknown;
};

export type TemplateRootProps = {
  value: () => string;
  onInput: (value: string) => void;
  css?: () => string;
  onCssInput?: (value: string) => void;
  variables: TemplateVariable[];
  sampleData?: () => Record<string, unknown>;
  onSampleDataChange?: (data: Record<string, unknown>) => void;
  children: JSX.Element;
};

export type TemplateEditorPaneProps = {
  lines?: number;
  placeholder?: string;
};

export type TemplateCssEditorProps = {
  lines?: number;
  placeholder?: string;
};

export type TemplatePreviewProps = {
  title?: string;
  description?: string;
  class?: string;
  iframeClass?: string;
  chrome?: boolean;
};

export type TemplateSampleDataProps = {
  title?: string;
  description?: string;
  class?: string;
  showHeader?: boolean;
};

type TemplateContextValue = {
  value: () => string;
  onInput: (value: string) => void;
  css: () => string;
  onCssInput: (value: string) => void;
  variables: () => TemplateVariable[];
  variableInput: () => Record<string, string>;
  setVariableValue: (name: string, value: string) => void;
  completions: () => Completion[];
  cssCompletions: () => Completion[];
  sampleData: () => Record<string, unknown>;
  renderedHtml: () => string;
};

const DEFAULT_TEMPLATE = [
  "<p>Hello {{EMAIL}},</p>",
  "",
  "<p>Welcome to {{APP_NAME}}. Your workspace is ready.</p>",
  "",
  "{{#ITEMS}}",
  "<p><strong>{{name}}</strong><br>{{description}}</p>",
  "{{/ITEMS}}",
  "",
  "{{#CONTACT_EMAIL}}",
  '<p>Questions? <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a></p>',
  "{{/CONTACT_EMAIL}}",
].join("\n");

const DEFAULT_CSS = [
  "body {",
  "  font-family: system-ui, sans-serif;",
  "  font-size: 14px;",
  "  line-height: 1.45;",
  "  color: #18181b;",
  "  margin: 0;",
  "  padding: 24px;",
  "}",
  "",
  "p {",
  "  margin: 0 0 12px;",
  "}",
  "",
  "strong {",
  "  font-weight: 700;",
  "}",
].join("\n");

const TEMPLATE_VARIABLES: TemplateVariable[] = [
  {
    name: "APP_NAME",
    label: "App name",
    description: "Product or workspace name used in headings and intro text.",
    kind: "string",
    defaultValue: "Cloud",
  },
  {
    name: "EMAIL",
    label: "Recipient email",
    description: "Example recipient for transactional emails.",
    kind: "email",
    defaultValue: "email@example.com",
  },
  {
    name: "CONTACT_EMAIL",
    label: "Contact email",
    description: "Optional support address. The section renders only when this value is present.",
    kind: "email",
    defaultValue: "support@example.org",
  },
  {
    name: "ITEMS",
    label: "Line items",
    description: "JSON array used by the {{#ITEMS}} loop.",
    kind: "array",
    defaultValue: [
      { name: "Profile", description: "Invite teammates and complete your account settings." },
      { name: "Templates", description: "Edit HTML, CSS, and sample data in one place." },
    ],
  },
];

const createTemplateEditorPanesValue = (): PanesValue => ({
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
        elementIds: ["html", "css"],
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
  { name: "a", snippet: '<a href="{{LOGIN_URL}}">Link</a>', hint: "link" },
  { name: "strong", snippet: "<strong></strong>", hint: "bold" },
  { name: "em", snippet: "<em></em>", hint: "emphasis" },
  { name: "br", snippet: "<br>", hint: "line break" },
  { name: "ul", snippet: "<ul>\n  <li></li>\n</ul>", hint: "list" },
  { name: "table", snippet: "<table>\n  <tr><td></td></tr>\n</table>", hint: "table" },
];

const CSS_SNIPPETS = [
  { name: "body", snippet: "body {\n  font-family: system-ui, sans-serif;\n}", hint: "selector" },
  { name: "p", snippet: "p {\n  margin: 0 0 12px;\n}", hint: "selector" },
  { name: "table", snippet: "table {\n  width: 100%;\n  border-collapse: collapse;\n}", hint: "selector" },
  { name: "color", snippet: "color: #18181b;", hint: "property" },
  { name: "font-size", snippet: "font-size: 14px;", hint: "property" },
  { name: "line-height", snippet: "line-height: 1.45;", hint: "property" },
  { name: "margin", snippet: "margin: 0 0 12px;", hint: "property" },
  { name: "padding", snippet: "padding: 16px;", hint: "property" },
  { name: "border", snippet: "border: 1px solid #d4d4d8;", hint: "property" },
];

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formatDefaultValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
};

const parseVariableValue = (variable: TemplateVariable, value: string): unknown => {
  if (variable.kind === "array" || variable.kind === "object") {
    try {
      return JSON.parse(value);
    } catch {
      return variable.defaultValue;
    }
  }
  if (variable.kind === "number") return Number(value);
  if (variable.kind === "boolean") return value === "true";
  return value;
};

const buildSuggestion = (text: string, hint: string, label?: string): Suggestion => ({
  text,
  hint,
  label,
  appendSpace: false,
});

const makeCompletions = (variables: TemplateVariable[]): Completion[] => [
  {
    trigger: "{",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, ctx) => {
      const normalized = query.toLowerCase();
      const hasLeadingBrace = ctx.tokenStart > 0 && ctx.fullText[ctx.tokenStart - 1] === "{";
      const open = hasLeadingBrace ? "{" : "{{";
      const variableSuggestions = variables
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) => buildSuggestion(`${open}${variable.name}}}`, variable.kind ?? "string", variable.name));

      const sectionSuggestions = variables
        .filter((variable) => variable.kind === "array" || variable.kind === "object" || variable.kind === "boolean")
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) => buildSuggestion(`${open}#${variable.name}}}\n  \n{{/${variable.name}}}`, "section", `#${variable.name}`));

      return [...variableSuggestions, ...sectionSuggestions];
    },
  },
  {
    trigger: "#",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query) => {
      const normalized = query.toLowerCase();
      return variables
        .filter((variable) => variable.kind === "array" || variable.kind === "object" || variable.kind === "boolean")
        .filter((variable) => variable.name.toLowerCase().startsWith(normalized))
        .map((variable) => buildSuggestion(`#${variable.name}}}\n  \n{{/${variable.name}}}`, "section", `#${variable.name}`));
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

const makeCssCompletions = (): Completion[] => [
  {
    trigger: " ",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query, ctx) => {
      const before = ctx.fullText.slice(0, ctx.tokenStart);
      if (!/(^|[{\n;])\s*$/.test(before)) return [];
      const normalized = query.toLowerCase();
      return CSS_SNIPPETS.filter((snippet) => snippet.name.toLowerCase().startsWith(normalized)).map((snippet) =>
        buildSuggestion(` ${snippet.snippet}`, snippet.hint, snippet.name),
      );
    },
  },
  {
    trigger: "@",
    dropdown: true,
    allowAfterWord: true,
    suggest: (query) => {
      const normalized = query.toLowerCase();
      return CSS_SNIPPETS.filter((snippet) => snippet.name.startsWith("@"))
        .filter((snippet) => snippet.name.slice(1).toLowerCase().startsWith(normalized))
        .map((snippet) => buildSuggestion(snippet.snippet, snippet.hint, snippet.name));
    },
  },
];

const highlightMustacheToken = (token: string): string => {
  const inner = token
    .replace(/^\{\{\{?/, "")
    .replace(/\}\}\}?$/, "")
    .trim();
  const prefix = inner[0];
  const tone =
    prefix === "#"
      ? "text-emerald-600 dark:text-emerald-400"
      : prefix === "/"
        ? "text-amber-600 dark:text-amber-400"
        : prefix === "^"
          ? "text-rose-600 dark:text-rose-400"
          : token.startsWith("{{{")
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
  const escaped = escapeHtml(text).replace(/{{{?[\s\S]*?}}}?/g, (token) => {
    const marker = `\uE000${stashed.length}\uE001`;
    stashed.push(highlightMustacheToken(token));
    return marker;
  });

  const withHtml = escaped.replace(/&lt;!--[\s\S]*?--&gt;|&lt;\/?[a-zA-Z][\s\S]*?&gt;/g, (tag) => {
    if (tag.startsWith("&lt;!--")) return `<span class="text-zinc-400 dark:text-zinc-500">${tag}</span>`;
    return highlightTag(tag);
  });

  return withHtml.replace(/\uE000(\d+)\uE001/g, (_, index) => stashed[Number(index)] ?? "");
};

const highlightCss = (text: string): string => {
  const tokenPattern = /(\/\*[\s\S]*?\*\/)|(@[\w-]+)|([\w.#:-][\w\s.#:-]*?)(?=\s*\{)|([\w-]+)(?=\s*:)|(:\s*)([^;{}\n]+)(;?)|([{}])/g;
  let out = "";
  let lastIndex = 0;
  tokenPattern.lastIndex = 0;

  while (true) {
    const match = tokenPattern.exec(text);
    if (!match) break;
    if (match.index > lastIndex) out += escapeHtml(text.slice(lastIndex, match.index));

    if (match[1]) out += `<span class="text-zinc-400 dark:text-zinc-500">${escapeHtml(match[1])}</span>`;
    else if (match[2]) out += `<span class="text-violet-600 dark:text-violet-400">${escapeHtml(match[2])}</span>`;
    else if (match[3]) out += `<span class="text-blue-600 dark:text-blue-400">${escapeHtml(match[3])}</span>`;
    else if (match[4]) out += `<span class="text-sky-600 dark:text-sky-400">${escapeHtml(match[4])}</span>`;
    else if (match[5]) {
      out += `<span class="text-zinc-400">${escapeHtml(match[5])}</span>`;
      out += `<span class="text-orange-600 dark:text-orange-400">${escapeHtml(match[6] ?? "")}</span>`;
      out += `<span class="text-zinc-400">${escapeHtml(match[7] ?? "")}</span>`;
    } else if (match[8]) out += `<span class="text-zinc-400">${escapeHtml(match[8])}</span>`;

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) out += escapeHtml(text.slice(lastIndex));
  return out;
};

const escapeStyleText = (value: string): string => value.replace(/<\/style/gi, "<\\/style");

const buildPreviewSrcdoc = (html: string, css: string): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        margin: 0;
        padding: 18px;
        background: #fff;
        color: #18181b;
        font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      a { color: #2563eb; }
      table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid #e4e4e7; padding: 6px 8px; }
      ${escapeStyleText(css)}
    </style>
  </head>
  <body>${html}</body>
</html>`;

const TemplateContext = createContext<TemplateContextValue>();

const useTemplateContext = (): TemplateContextValue => {
  const context = useContext(TemplateContext);
  if (!context) throw new Error("Template compound components must be rendered inside <Template.Root>.");
  return context;
};

const normalizeKind = (variable: TemplateVariable): TemplateVariableKind => variable.kind ?? "string";

const initialVariableInput = (variables: TemplateVariable[], sampleData?: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(
    variables.map((variable) => [variable.name, formatDefaultValue(sampleData?.[variable.name] ?? variable.defaultValue)]),
  );

const parseSampleData = (variables: TemplateVariable[], input: Record<string, string>): Record<string, unknown> =>
  Object.fromEntries(
    variables.map((variable) => [
      variable.name,
      parseVariableValue(variable, input[variable.name] ?? formatDefaultValue(variable.defaultValue)),
    ]),
  );

const TemplateRoot = (props: TemplateRootProps) => {
  const [variableInput, setVariableInput] = createSignal<Record<string, string>>(
    initialVariableInput(props.variables, props.sampleData?.()),
  );

  const completions = createMemo(() => makeCompletions(props.variables));
  const cssCompletions = createMemo(() => makeCssCompletions());
  const parsedSampleData = createMemo(() => parseSampleData(props.variables, variableInput()));
  const sampleData = createMemo(() => props.sampleData?.() ?? parsedSampleData());

  const renderedHtml = createMemo(() => {
    try {
      return Mustache.render(props.value(), sampleData());
    } catch (error) {
      return `<p>${escapeHtml(error instanceof Error ? error.message : "Template render failed")}</p>`;
    }
  });

  const setVariableValue = (name: string, value: string) => {
    setVariableInput((current) => {
      const next = { ...current, [name]: value };
      props.onSampleDataChange?.(parseSampleData(props.variables, next));
      return next;
    });
  };

  const context: TemplateContextValue = {
    value: props.value,
    onInput: props.onInput,
    css: () => props.css?.() ?? "",
    onCssInput: props.onCssInput ?? (() => undefined),
    variables: () => props.variables,
    variableInput,
    setVariableValue,
    completions,
    cssCompletions,
    sampleData,
    renderedHtml,
  };

  return <TemplateContext.Provider value={context}>{props.children}</TemplateContext.Provider>;
};

const TemplateEditorPane = (props: TemplateEditorPaneProps) => {
  const template = useTemplateContext();

  return (
    <AutocompleteEditor
      value={template.value}
      onInput={template.onInput}
      lines={props.lines ?? 18}
      spellcheck={false}
      placeholder={props.placeholder ?? "Write HTML with {{MUSTACHE_VALUES}}..."}
      highlight={highlightTemplate}
      completions={template.completions()}
    />
  );
};

const TemplateCssEditor = (props: TemplateCssEditorProps) => {
  const template = useTemplateContext();

  return (
    <AutocompleteEditor
      value={template.css}
      onInput={template.onCssInput}
      lines={props.lines ?? 14}
      spellcheck={false}
      placeholder={props.placeholder ?? "Write CSS..."}
      highlight={highlightCss}
      completions={template.cssCompletions()}
    />
  );
};

const TemplatePreview = (props: TemplatePreviewProps) => {
  const template = useTemplateContext();
  const chrome = props.chrome ?? true;
  const iframe = () => (
    <iframe
      title="Template preview"
      class={props.iframeClass ?? "w-full h-[720px] bg-white"}
      sandbox="allow-modals allow-same-origin"
      srcdoc={buildPreviewSrcdoc(template.renderedHtml(), template.css())}
    />
  );

  if (!chrome) return iframe();

  return (
    <section class={props.class ?? "paper overflow-hidden"}>
      <header class="px-3 py-2 border-b border-default flex items-center justify-between gap-3">
        <div>
          <h4 class="text-sm font-semibold">{props.title ?? "Preview"}</h4>
          <p class="text-xs text-dimmed">{props.description ?? "Sandboxed HTML rendered with Mustache and template CSS."}</p>
        </div>
      </header>
      {iframe()}
    </section>
  );
};

const TemplateSampleData = (props: TemplateSampleDataProps) => {
  const template = useTemplateContext();

  return (
    <section class={props.class ?? "paper p-3 flex flex-col gap-3"}>
      {(props.showHeader ?? true) && (
        <header>
          <h4 class="text-sm font-semibold">{props.title ?? "Sample data"}</h4>
          <p class="text-xs text-dimmed">
            {props.description ?? "Defaults come from the component; local edits override them for preview."}
          </p>
        </header>
      )}
      <div class="grid gap-3">
        <For each={template.variables()}>
          {(variable) => {
            const kind = normalizeKind(variable);
            const multiline = kind === "array" || kind === "object";

            return (
              <TextInput
                label={variable.label ?? variable.name}
                description={variable.description}
                multiline={multiline}
                lines={multiline ? 5 : undefined}
                value={() => template.variableInput()[variable.name] ?? ""}
                onInput={(value) => template.setVariableValue(variable.name, value)}
              />
            );
          }}
        </For>
      </div>
    </section>
  );
};

export const Template = {
  Root: TemplateRoot,
  Editor: TemplateEditorPane,
  CssEditor: TemplateCssEditor,
  Preview: TemplatePreview,
  SampleData: TemplateSampleData,
  useContext: useTemplateContext,
};

export const TemplateEditorDemo = () => {
  const [value, setValue] = createSignal(DEFAULT_TEMPLATE);
  const [css, setCss] = createSignal(DEFAULT_CSS);
  const [panes, setPanes] = createSignal<PanesValue>(createTemplateEditorPanesValue());

  return (
    <DemoCard
      id="template-editor"
      chip={{ kind: "component", name: "TemplateEditor", from: FROM_UI_LAB }}
      variant="compound API + HTML preview"
      description="UI-Lab-only prototype for email and HTML templates. Template.Root owns the SSR-safe HTML, CSS, sample-data, and Mustache render state; Template.Editor, Template.CssEditor, Template.Preview, and Template.SampleData can be arranged by the consuming app in panes, tabs, columns, or omitted entirely."
      code={`<Template.Root
  value={template}
  onInput={setTemplate}
  css={templateCss}
  onCssInput={setTemplateCss}
  variables={variables}
>
  <Panes.Root value={panes()} onChange={setPanes} allowResize={false}>
    <Panes.Element id="html" title="HTML" icon="ti ti-code">
      <Template.Editor lines={16} />
    </Panes.Element>
    <Panes.Element id="css" title="CSS" icon="ti ti-braces">
      <Template.CssEditor lines={14} />
    </Panes.Element>
    <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
      <Template.Preview />
    </Panes.Element>
    <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
      <Template.SampleData />
    </Panes.Element>
  </Panes.Root>
</Template.Root>`}
    >
      <Template.Root value={value} onInput={setValue} css={css} onCssInput={setCss} variables={TEMPLATE_VARIABLES}>
        <div class="flex flex-col gap-3">
          <p class="text-xs text-dimmed">
            Type {"{{"} for values, {"<"} for HTML snippets, or edit CSS for preview styling.
          </p>
          <div class="h-[46rem] min-w-0 overflow-hidden rounded-lg bg-zinc-100 p-2 dark:bg-zinc-900">
            <Panes.Root value={panes()} onChange={setPanes} class="h-full w-full" allowResize={false}>
              <Panes.Element id="html" title="HTML" icon="ti ti-code">
                <div class="h-full min-h-0 overflow-auto">
                  <Template.Editor lines={22} />
                </div>
              </Panes.Element>
              <Panes.Element id="css" title="CSS" icon="ti ti-braces">
                <div class="h-full min-h-0 overflow-auto">
                  <Template.CssEditor lines={22} />
                </div>
              </Panes.Element>
              <Panes.Element id="preview" title="Preview" icon="ti ti-eye">
                <Template.Preview class="paper flex h-full min-h-0 flex-col overflow-hidden" iframeClass="min-h-0 flex-1 w-full bg-white" />
              </Panes.Element>
              <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
                <Template.SampleData class="paper h-full min-h-0 overflow-auto p-3 flex flex-col gap-3" />
              </Panes.Element>
            </Panes.Root>
          </div>
        </div>
      </Template.Root>
    </DemoCard>
  );
};
