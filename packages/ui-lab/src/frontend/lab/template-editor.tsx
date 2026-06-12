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

export type TemplatePaper = "fluid" | "a4" | "a5";
export type TemplateOrientation = "portrait" | "landscape";

export type TemplatePreviewProps = {
  title?: string;
  description?: string;
  class?: string;
  iframeClass?: string;
  chrome?: boolean;
  paper?: TemplatePaper;
  orientation?: TemplateOrientation;
  defaultZoom?: number;
  minZoom?: number;
  maxZoom?: number;
  showPrintButton?: boolean;
  paginate?: boolean;
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
  "<p>Your {{APP_NAME}} invoice is ready.</p>",
  "",
  "{{#ITEMS}}",
  "<p>{{name}} - <strong>{{price}}</strong></p>",
  "{{/ITEMS}}",
  "",
  "{{#CONTACT_EMAIL}}",
  '<p>Questions? <a href="mailto:{{CONTACT_EMAIL}}">{{CONTACT_EMAIL}}</a></p>',
  "{{/CONTACT_EMAIL}}",
].join("\n");

const DEFAULT_CSS = [
  "@page {",
  "  size: A4 portrait;",
  "  margin: 0;",
  "}",
  "",
  ".template-page {",
  "  padding: 18mm;",
  "}",
  "",
  "body {",
  "  font-family: system-ui, sans-serif;",
  "  font-size: 11pt;",
  "  line-height: 1.45;",
  "  color: #18181b;",
  "}",
  "",
  "p {",
  "  margin: 0 0 4mm;",
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
      { name: "Membership", price: "12.00 EUR" },
      { name: "Storage", price: "3.50 EUR" },
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

const INVOICE_ITEMS = Array.from({ length: 42 }, (_, index) => {
  const quantity = (index % 4) + 1;
  const unitPrice = 24 + (index % 7) * 8;
  return {
    position: String(index + 1).padStart(2, "0"),
    name: `Consulting package ${index + 1}`,
    description: "Implementation, review, and project coordination.",
    quantity,
    unitPrice: `${unitPrice.toFixed(2)} EUR`,
    total: `${(quantity * unitPrice).toFixed(2)} EUR`,
  };
});

const INVOICE_TEMPLATE = [
  '<section data-print-header class="invoice-header">',
  "  <div>",
  "    <strong>{{COMPANY_NAME}}</strong>",
  "    <div>{{COMPANY_ADDRESS}}</div>",
  "  </div>",
  "  <div>",
  "    <strong>Invoice {{INVOICE_NUMBER}}</strong>",
  "    <div>{{INVOICE_DATE}}</div>",
  "  </div>",
  "</section>",
  "",
  '<section class="invoice-recipient">',
  "  <span>Bill to</span>",
  "  <strong>{{CUSTOMER_NAME}}</strong>",
  "  <div>{{CUSTOMER_ADDRESS}}</div>",
  "</section>",
  "",
  '<table class="invoice-table">',
  "  <thead>",
  "    <tr>",
  "      <th>Pos.</th>",
  "      <th>Description</th>",
  "      <th>Qty</th>",
  "      <th>Unit</th>",
  "      <th>Total</th>",
  "    </tr>",
  "  </thead>",
  "  <tbody>",
  "    {{#ITEMS}}",
  "    <tr>",
  "      <td>{{position}}</td>",
  "      <td><strong>{{name}}</strong><br><span>{{description}}</span></td>",
  "      <td>{{quantity}}</td>",
  "      <td>{{unitPrice}}</td>",
  "      <td>{{total}}</td>",
  "    </tr>",
  "    {{/ITEMS}}",
  "  </tbody>",
  "</table>",
  "",
  '<section data-print-footer class="invoice-footer">',
  "  <span>{{COMPANY_NAME}} · {{COMPANY_EMAIL}}</span>",
  "  <span>Page <span data-page-number></span> / <span data-page-count></span></span>",
  "</section>",
].join("\n");

const INVOICE_CSS = [
  "@page {",
  "  size: A4 portrait;",
  "  margin: 0;",
  "}",
  "",
  ".template-page {",
  "  padding: 18mm 16mm 18mm;",
  "}",
  "",
  "body {",
  "  font-family: Inter, system-ui, sans-serif;",
  "  font-size: 9.5pt;",
  "  color: #18181b;",
  "}",
  "",
  ".invoice-header,",
  ".invoice-footer {",
  "  display: flex;",
  "  justify-content: space-between;",
  "  gap: 12mm;",
  "}",
  "",
  ".invoice-header {",
  "  border-bottom: 0.3mm solid #18181b;",
  "  padding-bottom: 4mm;",
  "  margin-bottom: 12mm;",
  "}",
  "",
  ".invoice-footer {",
  "  border-top: 0.2mm solid #d4d4d8;",
  "  padding-top: 3mm;",
  "  margin-top: 10mm;",
  "  color: #71717a;",
  "  font-size: 8pt;",
  "}",
  "",
  ".invoice-recipient {",
  "  margin-bottom: 10mm;",
  "}",
  "",
  ".invoice-recipient span {",
  "  display: block;",
  "  color: #71717a;",
  "  font-size: 8pt;",
  "  text-transform: uppercase;",
  "  letter-spacing: 0.04em;",
  "}",
  "",
  ".invoice-table {",
  "  width: 100%;",
  "  border-collapse: collapse;",
  "}",
  "",
  ".invoice-table th,",
  ".invoice-table td {",
  "  border-bottom: 0.2mm solid #e4e4e7;",
  "  padding: 3mm 2mm;",
  "  text-align: left;",
  "  vertical-align: top;",
  "}",
  "",
  ".invoice-table th {",
  "  background: #f4f4f5;",
  "  font-size: 8pt;",
  "  text-transform: uppercase;",
  "}",
  "",
  ".invoice-table td:nth-child(3),",
  ".invoice-table td:nth-child(4),",
  ".invoice-table td:nth-child(5) {",
  "  text-align: right;",
  "}",
  "",
  "@media print {",
  "  .template-page {",
  "    padding: 18mm 16mm 18mm;",
  "  }",
  "",
  "  thead {",
  "    display: table-header-group;",
  "  }",
  "",
  "  tr {",
  "    break-inside: avoid;",
  "  }",
  "}",
].join("\n");

const INVOICE_VARIABLES: TemplateVariable[] = [
  {
    name: "COMPANY_NAME",
    label: "Company name",
    description: "Shown in the repeated print header and footer.",
    defaultValue: "Stuve Cloud GmbH",
  },
  {
    name: "COMPANY_ADDRESS",
    label: "Company address",
    description: "Sender address in the invoice header.",
    defaultValue: "Cloudstrasse 12 · 10115 Berlin",
  },
  {
    name: "COMPANY_EMAIL",
    label: "Company email",
    description: "Footer contact address.",
    kind: "email",
    defaultValue: "billing@example.com",
  },
  {
    name: "CUSTOMER_NAME",
    label: "Customer name",
    description: "Recipient block.",
    defaultValue: "Example Customer AG",
  },
  {
    name: "CUSTOMER_ADDRESS",
    label: "Customer address",
    description: "Recipient address.",
    defaultValue: "Main Street 4 · 80331 Munich",
  },
  {
    name: "INVOICE_NUMBER",
    label: "Invoice number",
    description: "Shown in the header.",
    defaultValue: "RE-2026-0042",
  },
  {
    name: "INVOICE_DATE",
    label: "Invoice date",
    description: "Shown in the header.",
    defaultValue: "11.06.2026",
  },
  {
    name: "ITEMS",
    label: "Invoice items",
    description: "Long JSON array used by the table loop.",
    kind: "array",
    defaultValue: INVOICE_ITEMS,
  },
];

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
  { name: "@page", snippet: "@page {\n  size: A4 portrait;\n  margin: 0;\n}", hint: "print page" },
  { name: ".template-page", snippet: ".template-page {\n  padding: 18mm;\n}", hint: "paper content" },
  { name: "body", snippet: "body {\n  font-family: system-ui, sans-serif;\n}", hint: "selector" },
  { name: "p", snippet: "p {\n  margin: 0 0 4mm;\n}", hint: "selector" },
  { name: "table", snippet: "table {\n  width: 100%;\n  border-collapse: collapse;\n}", hint: "selector" },
  { name: "color", snippet: "color: #18181b;", hint: "property" },
  { name: "font-size", snippet: "font-size: 11pt;", hint: "property" },
  { name: "line-height", snippet: "line-height: 1.45;", hint: "property" },
  { name: "margin", snippet: "margin: 0 0 4mm;", hint: "property" },
  { name: "padding", snippet: "padding: 4mm;", hint: "property" },
  { name: "border", snippet: "border: 0.25mm solid #d4d4d8;", hint: "property" },
];

const PAPER_SIZES: Record<Exclude<TemplatePaper, "fluid">, { widthMm: number; heightMm: number; label: string }> = {
  a4: { widthMm: 210, heightMm: 297, label: "DIN A4" },
  a5: { widthMm: 148, heightMm: 210, label: "DIN A5" },
};

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

const clampZoom = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const paperSizeCss = (paper: TemplatePaper, orientation: TemplateOrientation, zoom: number): string => {
  if (paper === "fluid") {
    return `
      :root {
        --template-preview-zoom: ${zoom};
      }`;
  }
  const size = PAPER_SIZES[paper];
  const width = orientation === "portrait" ? size.widthMm : size.heightMm;
  const height = orientation === "portrait" ? size.heightMm : size.widthMm;
  return `
      :root {
        --template-paper-width: ${width}mm;
        --template-paper-height: ${height}mm;
        --template-paper-display-width: ${width * zoom}mm;
        --template-paper-display-height: ${height * zoom}mm;
        --template-preview-zoom: ${zoom};
      }`;
};

const escapeStyleText = (value: string): string => value.replace(/<\/style/gi, "<\\/style");

const paginationScript = (): string => `
(() => {
  const source = document.querySelector("[data-template-source]");
  const pages = document.querySelector("[data-template-pages]");
  if (!source || !pages) return;

  const header = source.querySelector("[data-print-header]");
  const footer = source.querySelector("[data-print-footer]");
  const table = source.querySelector("table");
  if (!header || !footer || !table) {
    const frame = document.createElement("div");
    frame.className = "template-page-frame";
    const page = document.createElement("main");
    page.className = "template-page";
    page.innerHTML = source.innerHTML;
    frame.append(page);
    pages.append(frame);
    source.remove();
    return;
  }

  const beforeTable = [];
  const afterTable = [];
  let seenTable = false;
  for (const node of Array.from(source.childNodes)) {
    if (node === table) {
      seenTable = true;
      continue;
    }
    if (node === header || node === footer) continue;
    if (seenTable) afterTable.push(node.cloneNode(true));
    else beforeTable.push(node.cloneNode(true));
  }

  const tableClasses = table.getAttribute("class") || "";
  const tableHead = table.querySelector("thead");
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  let currentBody = null;
  let currentTbody = null;

  const makeTable = () => {
    const nextTable = document.createElement("table");
    if (tableClasses) nextTable.setAttribute("class", tableClasses);
    if (tableHead) nextTable.append(tableHead.cloneNode(true));
    const tbody = document.createElement("tbody");
    nextTable.append(tbody);
    return { table: nextTable, tbody };
  };

  const makePage = (includeIntro) => {
    const frame = document.createElement("div");
    frame.className = "template-page-frame";
    const page = document.createElement("main");
    page.className = "template-page";
    page.append(header.cloneNode(true));
    const body = document.createElement("section");
    body.className = "template-page-body";
    if (includeIntro) for (const node of beforeTable) body.append(node.cloneNode(true));
    const next = makeTable();
    body.append(next.table);
    page.append(body);
    page.append(footer.cloneNode(true));
    frame.append(page);
    pages.append(frame);
    currentBody = body;
    currentTbody = next.tbody;
  };

  const overflows = () => currentBody && currentBody.scrollHeight > currentBody.clientHeight + 1;

  makePage(true);
  for (const row of rows) {
    const nextRow = row.cloneNode(true);
    currentTbody.append(nextRow);
    if (overflows() && currentTbody.children.length > 1) {
      nextRow.remove();
      makePage(false);
      currentTbody.append(nextRow);
    }
  }

  if (afterTable.length > 0) {
    for (const node of afterTable) currentBody.append(node.cloneNode(true));
    if (overflows()) {
      for (const node of afterTable) currentBody.lastChild?.remove();
      makePage(false);
      currentBody.append(...afterTable.map((node) => node.cloneNode(true)));
    }
  }

  const frames = Array.from(pages.querySelectorAll(".template-page-frame"));
  const total = String(frames.length);
  frames.forEach((frame, index) => {
    for (const node of frame.querySelectorAll("[data-page-number]")) node.textContent = String(index + 1);
    for (const node of frame.querySelectorAll("[data-page-count]")) node.textContent = total;
    const page = frame.querySelector(".template-page");
    if (page) frame.style.height = page.getBoundingClientRect().height + "px";
  });
  source.remove();
})();
`;

const buildPreviewSrcdoc = (
  html: string,
  css: string,
  paper: TemplatePaper,
  orientation: TemplateOrientation,
  zoom: number,
  paginate: boolean,
): string => {
  const isPaper = paper !== "fluid";
  const pageCss = isPaper
    ? `
      @page {
        size: ${paper.toUpperCase()} ${orientation};
        margin: 0;
      }
      html {
        background: #f4f4f5;
      }
      body {
        min-height: 100%;
        margin: 0;
        padding: 16mm;
        background: #f4f4f5;
      }
      .template-page-frame {
        width: var(--template-paper-display-width);
        height: var(--template-paper-display-height);
        margin: 0 auto;
        break-after: page;
        page-break-after: always;
      }
      .template-page-frame:last-child {
        break-after: auto;
        page-break-after: auto;
      }
      .template-page {
        width: var(--template-paper-width);
        height: var(--template-paper-height);
        box-sizing: border-box;
        margin: 0;
        overflow: hidden;
        background: #fff;
        box-shadow: 0 8px 28px rgba(24, 24, 27, 0.16), 0 0 0 1px rgba(24, 24, 27, 0.08);
        transform: scale(var(--template-preview-zoom));
        transform-origin: top left;
      }
      .template-pages {
        display: flex;
        flex-direction: column;
        gap: 8mm;
      }
      .template-page {
        display: flex;
        flex-direction: column;
      }
      .template-page-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }
      @media print {
        html,
        body {
          width: var(--template-paper-width);
          min-height: auto;
          padding: 0;
          background: #fff;
        }
        .template-pages {
          display: block;
          gap: 0;
        }
        .template-page-frame,
        .template-page {
          width: var(--template-paper-width);
          height: var(--template-paper-height);
          margin: 0;
        }
        .template-page {
          box-shadow: none;
          transform: none;
        }
      }`
    : `
      body {
        margin: 0;
        padding: 18px;
        background: #fff;
        zoom: var(--template-preview-zoom);
      }
      .template-page {
        min-height: 100%;
      }`;

  const body = paginate
    ? `<body><div data-template-source hidden>${html}</div><div class="template-pages" data-template-pages></div><script>${paginationScript()}</script></body>`
    : `<body><div class="template-page-frame"><main class="template-page">${html}</main></div></body>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      ${paperSizeCss(paper, orientation, zoom)}
      ${pageCss}
      body {
        color: #18181b;
        font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      a { color: #2563eb; }
      table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid #e4e4e7; padding: 6px 8px; }
      ${escapeStyleText(css)}
    </style>
  </head>
  ${body}
</html>`;
};

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
      placeholder={props.placeholder ?? "Write print CSS..."}
      highlight={highlightCss}
      completions={template.cssCompletions()}
    />
  );
};

const TemplatePreview = (props: TemplatePreviewProps) => {
  let iframeEl: HTMLIFrameElement | undefined;
  const template = useTemplateContext();
  const chrome = props.chrome ?? true;
  const minZoom = createMemo(() => props.minZoom ?? 0.5);
  const maxZoom = createMemo(() => props.maxZoom ?? 1.4);
  const [zoom, setZoom] = createSignal(clampZoom(props.defaultZoom ?? 0.72, minZoom(), maxZoom()));
  const paper = createMemo(() => props.paper ?? "fluid");
  const orientation = createMemo(() => props.orientation ?? "portrait");
  const paperLabel = createMemo(() => {
    const currentPaper = paper();
    return currentPaper === "fluid" ? "Fluid" : `${PAPER_SIZES[currentPaper].label} ${orientation()}`;
  });
  const zoomLabel = createMemo(() => `${Math.round(zoom() * 100)}%`);
  const adjustZoom = (delta: number) => {
    setZoom((current) => clampZoom(Number((current + delta).toFixed(2)), minZoom(), maxZoom()));
  };
  const printPreview = () => {
    iframeEl?.contentWindow?.focus();
    iframeEl?.contentWindow?.print();
  };
  const iframe = () => (
    <iframe
      ref={iframeEl}
      title="Template preview"
      class={props.iframeClass ?? "w-full h-[720px] bg-white"}
      sandbox={props.paginate ? "allow-modals allow-same-origin allow-scripts" : "allow-modals allow-same-origin"}
      srcdoc={buildPreviewSrcdoc(template.renderedHtml(), template.css(), paper(), orientation(), zoom(), props.paginate ?? false)}
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
        <div class="flex items-center gap-1.5">
          <span class="badge badge-muted">{paperLabel()}</span>
          {props.showPrintButton && (
            <button type="button" class="btn btn-secondary btn-sm" onClick={printPreview} title="Open browser print dialog">
              <i class="ti ti-printer text-sm" />
              Save as PDF
            </button>
          )}
          <div class="inline-flex items-center gap-1 rounded border border-default bg-subtle px-1 py-0.5">
            <button
              type="button"
              class="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40"
              onClick={() => adjustZoom(-0.1)}
              disabled={zoom() <= minZoom()}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <i class="ti ti-minus text-sm" />
            </button>
            <span class="min-w-10 text-center text-xs tabular-nums text-dimmed">{zoomLabel()}</span>
            <button
              type="button"
              class="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40"
              onClick={() => adjustZoom(0.1)}
              disabled={zoom() >= maxZoom()}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <i class="ti ti-plus text-sm" />
            </button>
          </div>
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
  const [paper, setPaper] = createSignal<TemplatePaper>("a4");
  const [orientation, setOrientation] = createSignal<TemplateOrientation>("portrait");
  const [panes, setPanes] = createSignal<PanesValue>(createTemplateEditorPanesValue());
  const optionClass = (active: boolean): string => ["btn btn-sm", active ? "btn-primary" : "btn-secondary"].join(" ");

  return (
    <DemoCard
      id="template-editor"
      chip={{ kind: "component", name: "TemplateEditor", from: FROM_UI_LAB }}
      variant="compound API + print preview"
      description="UI-Lab-only prototype for email and invoice templates. Template.Root owns the SSR-safe HTML, CSS, sample-data, and Mustache render state; Template.Editor, Template.CssEditor, Template.Preview, and Template.SampleData can be arranged by the consuming app in columns, tabs, or omitted entirely."
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
      <Template.Preview paper="a4" orientation="portrait" />
    </Panes.Element>
    <Panes.Element id="sample-data" title="Sample data" icon="ti ti-database">
      <Template.SampleData />
    </Panes.Element>
  </Panes.Root>
</Template.Root>`}
    >
      <Template.Root value={value} onInput={setValue} css={css} onCssInput={setCss} variables={TEMPLATE_VARIABLES}>
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs text-dimmed">
              Type {"{{"} for values, {"<"} for HTML snippets, or edit CSS for print styling.
            </p>
            <div class="flex flex-wrap items-center gap-1.5">
              <button type="button" class={optionClass(paper() === "fluid")} onClick={() => setPaper("fluid")}>
                Fluid
              </button>
              <button type="button" class={optionClass(paper() === "a4")} onClick={() => setPaper("a4")}>
                DIN A4
              </button>
              <button type="button" class={optionClass(paper() === "a5")} onClick={() => setPaper("a5")}>
                DIN A5
              </button>
              <button type="button" class={optionClass(orientation() === "portrait")} onClick={() => setOrientation("portrait")}>
                Portrait
              </button>
              <button type="button" class={optionClass(orientation() === "landscape")} onClick={() => setOrientation("landscape")}>
                Landscape
              </button>
            </div>
          </div>
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
                <Template.Preview
                  paper={paper()}
                  orientation={orientation()}
                  class="paper flex h-full min-h-0 flex-col overflow-hidden"
                  iframeClass="min-h-0 flex-1 w-full bg-white"
                />
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

export const TemplateInvoicePrintShowcaseDemo = () => {
  const [value, setValue] = createSignal(INVOICE_TEMPLATE);
  const [css, setCss] = createSignal(INVOICE_CSS);

  return (
    <DemoCard
      id="template-invoice-print"
      chip={{ kind: "component", name: "Template.Preview", from: FROM_UI_LAB }}
      variant="single template invoice print"
      description="Quick showcase for invoices: the user writes one HTML template, marks header and footer with data-print-header/data-print-footer, loops a long table with Mustache, and uses browser print to save as PDF. Header/footer repetition is handled by print CSS, not by separate template fields."
      code={`<Template.Root value={html} onInput={setHtml} css={css} onCssInput={setCss} variables={invoiceVariables}>
  <Template.Editor lines={18} />
  <Template.CssEditor lines={12} />
  <Template.Preview paper="a4" orientation="portrait" showPrintButton />
</Template.Root>`}
    >
      <Template.Root value={value} onInput={setValue} css={css} onCssInput={setCss} variables={INVOICE_VARIABLES}>
        <div class="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
          <div class="min-w-0 grid gap-3">
            <Template.Editor lines={18} />
            <Template.CssEditor lines={14} />
          </div>
          <div class="min-w-0">
            <Template.Preview
              paper="a4"
              orientation="portrait"
              defaultZoom={0.62}
              paginate
              showPrintButton
              description="A4 print preview with browser Save as PDF."
            />
          </div>
        </div>
      </Template.Root>
    </DemoCard>
  );
};
