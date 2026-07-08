import { DocCode, DocConceptGrid, DocInlineCode, type DocRow, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For } from "solid-js";

type FormulaItem = {
  name: string;
  signature: string;
  example: string;
  returns: string;
  notes?: string;
};

type FormulaGroup = {
  title: string;
  intro: string;
  items: FormulaItem[];
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const span = (className: string, value: string): string => `<span class="${className}">${escapeHtml(value)}</span>`;

export const highlightFormula = (source: string): string => {
  const pattern = /(=|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b[A-Z][A-Z0-9_]*(?=\()|\d+(?:\.\d+)?|==|!=|<=|>=|[(),+\-*/<>])/g;
  let output = "";
  let last = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) output += escapeHtml(source.slice(last, index));
    const token = match[0];
    if (/^=|^[(),+\-*/<>!]+$/.test(token)) output += span("text-zinc-500 dark:text-zinc-500", token);
    else if (/^["'`]/.test(token)) output += span("text-emerald-700 dark:text-emerald-300", token);
    else if (/^\d/.test(token)) output += span("text-amber-700 dark:text-amber-300", token);
    else if (/^[A-Z][A-Z0-9_]*(?=\()/.test(token)) output += span("text-blue-700 dark:text-blue-300", token);
    else output += escapeHtml(token);
    last = index + token.length;
  }

  return output + escapeHtml(source.slice(last));
};

const formulaGroups: FormulaGroup[] = [
  {
    title: "Progress and percentages",
    intro: "Use these when a cell should show completion or a percent.",
    items: [
      {
        name: "PROGRESS",
        signature: "PROGRESS(ratio)",
        example: "=PROGRESS(0.4)",
        returns: "40% progress bar",
        notes: "The visual bar is clamped between 0% and 100%.",
      },
      {
        name: "PROGRESS",
        signature: "PROGRESS(done, total)",
        example: "=PROGRESS(2, 10)",
        returns: "2/10 progress bar",
        notes: "total must not be 0.",
      },
      {
        name: "PERCENT",
        signature: "PERCENT(part, total)",
        example: "=PERCENT(Done, Total)",
        returns: "percent number",
        notes: "Returns 40 for 40%, not 0.4.",
      },
    ],
  },
  {
    title: "Column aggregates",
    intro: "Read one whole column. Empty or non-numeric cells are ignored for numeric functions.",
    items: [
      { name: "SUM", signature: "SUM(column)", example: "=SUM(Hours)", returns: "sum of numeric cells" },
      { name: "AVG", signature: "AVG(column)", example: "=AVG(Rating)", returns: "average; 0 when empty" },
      { name: "MEAN", signature: "MEAN(column)", example: "=MEAN(Rating)", returns: "same as AVG(column)" },
      { name: "MIN", signature: "MIN(column)", example: "=MIN(Price)", returns: "smallest number; 0 when empty" },
      { name: "MAX", signature: "MAX(column)", example: "=MAX(Price)", returns: "largest number; 0 when empty" },
      { name: "COUNT", signature: "COUNT(column)", example: "=COUNT(Name)", returns: "non-empty cell count", notes: "Text counts too." },
      { name: "MEDIAN", signature: "MEDIAN(column)", example: "=MEDIAN(Score)", returns: "middle number; 0 when empty" },
      { name: "UNIQUE", signature: "UNIQUE(column)", example: "=UNIQUE(Status)", returns: "distinct non-empty value count" },
      {
        name: "STDEV",
        signature: "STDEV(column)",
        example: "=STDEV(Weight)",
        returns: "sample standard deviation",
        notes: "Returns 0 for fewer than 2 numbers.",
      },
      {
        name: "COUNTIF",
        signature: "COUNTIF(column, value)",
        example: '=COUNTIF(Status, "done")',
        returns: "matching cell count",
        notes: "Exact string match.",
      },
      {
        name: "SUMIF",
        signature: "SUMIF(sumColumn, conditionColumn, value)",
        example: '=SUMIF(Hours, Status, "done")',
        returns: "conditional sum",
      },
    ],
  },
  {
    title: "Row aggregates",
    intro: "Read the current row. The cell containing the formula is skipped.",
    items: [
      { name: "ROWSUM", signature: "ROWSUM()", example: "=ROWSUM()", returns: "sum of numeric cells in this row" },
      { name: "ROWAVG", signature: "ROWAVG()", example: "=ROWAVG()", returns: "average of numeric cells in this row" },
      { name: "ROWMEAN", signature: "ROWMEAN()", example: "=ROWMEAN()", returns: "same as ROWAVG()" },
    ],
  },
  {
    title: "Logic and conditions",
    intro: "Build simple decisions. Truthy means non-zero number or non-empty text.",
    items: [
      { name: "IF", signature: "IF(condition, then, else)", example: '=IF(Hours > 2, "long", "short")', returns: "then or else value" },
      {
        name: "IFEMPTY",
        signature: "IFEMPTY(value, fallback)",
        example: '=IFEMPTY(Owner, "unassigned")',
        returns: "fallback for empty cells",
      },
      {
        name: "IFERROR",
        signature: "IFERROR(value, fallback)",
        example: "=IFERROR(SUM(Missing), 0)",
        returns: "fallback when value errors",
      },
      { name: "AND", signature: "AND(a, b, ...)", example: '=AND(Status == "done", Hours > 0)', returns: "1 when all are truthy, else 0" },
      {
        name: "OR",
        signature: "OR(a, b, ...)",
        example: '=OR(Status == "done", Status == "shipped")',
        returns: "1 when any value is truthy, else 0",
      },
      { name: "NOT", signature: "NOT(value)", example: '=NOT(Status == "done")', returns: "1 or 0" },
      {
        name: "CONTAINS",
        signature: "CONTAINS(text, search)",
        example: '=CONTAINS(Notes, "urgent")',
        returns: "1 when text contains search, else 0",
      },
    ],
  },
  {
    title: "Text",
    intro: "Clean and combine text values.",
    items: [
      { name: "CONCAT", signature: "CONCAT(...parts)", example: '=CONCAT(First, " ", Last)', returns: "joined text" },
      { name: "UPPER", signature: "UPPER(text)", example: "=UPPER(Name)", returns: "uppercase text" },
      { name: "LOWER", signature: "LOWER(text)", example: "=LOWER(Tag)", returns: "lowercase text" },
      { name: "TRIM", signature: "TRIM(text)", example: "=TRIM(Name)", returns: "text without leading/trailing spaces" },
      { name: "LEFT", signature: "LEFT(text, n)", example: "=LEFT(Code, 3)", returns: "first n characters" },
      { name: "RIGHT", signature: "RIGHT(text, n)", example: "=RIGHT(Code, 2)", returns: "last n characters" },
      { name: "LEN", signature: "LEN(text)", example: "=LEN(Notes)", returns: "character count" },
      {
        name: "SUBSTRING",
        signature: "SUBSTRING(text, start, length)",
        example: "=SUBSTRING(Code, 2, 4)",
        returns: "text slice",
        notes: "start is 0-based. length is how many characters to take.",
      },
      {
        name: "REPLACE",
        signature: "REPLACE(text, search, replacement)",
        example: '=REPLACE(Name, "old", "new")',
        returns: "text with all matches replaced",
      },
    ],
  },
  {
    title: "Math",
    intro: "Use arithmetic directly, or call helpers when a cell needs formatting.",
    items: [
      {
        name: "Arithmetic",
        signature: "+  -  *  /",
        example: "=Price * Qty",
        returns: "number",
        notes: "Division by 0 shows a formula error.",
      },
      { name: "Comparisons", signature: "==  !=  <  <=  >  >=", example: "=Hours >= 8", returns: "1 or 0" },
      { name: "ROUND", signature: "ROUND(number, digits)", example: "=ROUND(Price * Qty, 2)", returns: "rounded number" },
      { name: "ABS", signature: "ABS(number)", example: "=ABS(Balance)", returns: "absolute value" },
      { name: "SQRT", signature: "SQRT(number)", example: "=SQRT(Area)", returns: "square root" },
      { name: "POW", signature: "POW(base, exponent)", example: "=POW(2, 8)", returns: "power" },
      { name: "MOD", signature: "MOD(a, b)", example: "=MOD(Row, 2)", returns: "remainder" },
    ],
  },
  {
    title: "Date and time",
    intro: "Return simple date strings or compare dates.",
    items: [
      { name: "TODAY", signature: "TODAY()", example: "=TODAY()", returns: "YYYY-MM-DD" },
      { name: "NOW", signature: "NOW()", example: "=NOW()", returns: "YYYY-MM-DD HH:MM:SS" },
      {
        name: "DATEDIFF",
        signature: "DATEDIFF(start, end, unit?)",
        example: '=DATEDIFF(Start, Due, "d")',
        returns: "difference as number",
        notes: "Units: ms, s, m, h, d. Full names work too.",
      },
    ],
  },
];

const formulaRules: DocRow[] = [
  {
    title: "Start with =",
    icon: "ti-equal",
    text: (
      <>
        A table formula cell starts with <DocInlineCode>=</DocInlineCode>, for example <DocInlineCode>=SUM(Hours)</DocInlineCode>.
      </>
    ),
  },
  {
    title: "Reference columns by name",
    icon: "ti-columns",
    text: (
      <>
        Use the column name directly. Wrap names with spaces in backticks, for example <DocInlineCode>{"=SUM(`Total Cost`)"}</DocInlineCode>
        .
      </>
    ),
  },
  {
    title: "Comparisons return numbers",
    icon: "ti-git-compare",
    text: (
      <>
        <DocInlineCode>{">"}</DocInlineCode>, <DocInlineCode>{"<"}</DocInlineCode>, <DocInlineCode>{"=="}</DocInlineCode>, and related
        operators return <DocInlineCode>1</DocInlineCode> or <DocInlineCode>0</DocInlineCode>.
      </>
    ),
  },
  {
    title: "Formula cells do not count themselves",
    icon: "ti-refresh",
    text: (
      <>
        Column totals skip their own formula cell, so <DocInlineCode>=SUM(Hours)</DocInlineCode> does not include the total cell.
      </>
    ),
  },
];

const FormulaTable = (props: FormulaGroup) => (
  <section class="overflow-hidden rounded-md bg-zinc-50/60 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/25 dark:ring-zinc-800">
    <header class="px-3 py-3">
      <p class="font-semibold text-primary">{props.title}</p>
      <p class="mt-1 text-sm text-dimmed">{props.intro}</p>
    </header>
    <div class="divide-y divide-zinc-200/70 dark:divide-zinc-800">
      <For each={props.items}>
        {(item) => (
          <article class="grid gap-3 px-3 py-3 text-sm lg:grid-cols-[minmax(10rem,0.8fr)_minmax(12rem,1fr)_minmax(12rem,1fr)]">
            <div>
              <p class="font-semibold text-primary">{item.name}</p>
              <DocCode code={item.signature} highlight={highlightFormula} class="mt-2" />
            </div>
            <DocCode code={item.example} highlight={highlightFormula} />
            <div>
              <p class="text-primary">{item.returns}</p>
              {item.notes && <p class="mt-1 text-dimmed">{item.notes}</p>}
            </div>
          </article>
        )}
      </For>
    </div>
  </section>
);

export const NotebookFormulaReference = () => (
  <div class="space-y-6">
    <DocSection title="Formula rules" eyebrow="Syntax">
      <DocRows items={formulaRules} />
    </DocSection>

    <DocSection title="Function catalog" eyebrow="Reference">
      <DocConceptGrid
        items={[
          {
            title: "Autocomplete and rendering use this surface",
            icon: "ti-wand",
            text: "The same function names are used by table autocomplete, edit preview, and read-mode rendering.",
          },
          {
            title: "Names are case-insensitive",
            icon: "ti-letter-case",
            text: "Use uppercase for readability, but the formula evaluator accepts lower-case function names too.",
          },
        ]}
      />
      <div class="mt-4 space-y-4">
        <For each={formulaGroups}>{(group) => <FormulaTable {...group} />}</For>
      </div>
    </DocSection>
  </div>
);
