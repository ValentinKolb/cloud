import { CodeDisplay, type CodeDisplayLanguage } from "@valentinkolb/cloud/ui";
import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { type JSX } from "solid-js";

type ApiMethodProps = {
  name: string;
  signature: string;
  returns: string;
  children: JSX.Element;
};

type FormulaItem = {
  name: string;
  signature: string;
  example: string;
  result: string;
  notes?: string;
};

type FormulaGroup = {
  title: string;
  intro: string;
  items: FormulaItem[];
};

type SyntaxToken = {
  text: string;
  class: string;
};

const code = (...lines: string[]) => lines.join("\n");

const signatureTokenClass = (token: string): string => {
  if (/^(await|async|void|boolean|string|number|object|null|undefined)$/.test(token)) return "text-red-600 dark:text-red-400";
  if (/^(current|nb|ui|std)$/.test(token)) return "text-blue-700 dark:text-blue-300";
  if (/^["'`]/.test(token)) return "text-emerald-700 dark:text-emerald-300";
  if (/^\.[A-Za-z_$]/.test(token)) return "text-violet-700 dark:text-violet-300";
  if (/^[A-Za-z_$][\w$]*(?=\()/.test(token)) return "text-violet-700 dark:text-violet-300";
  if (/^[(){}[\],.?/|]$|^\.\.\.$/.test(token)) return "text-zinc-500 dark:text-zinc-500";
  return "";
};

const tokenizeSignature = (source: string): SyntaxToken[] => {
  const tokens: SyntaxToken[] = [];
  const pattern =
    /(\.\.\.|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b(?:await|async|void|boolean|string|number|object|null|undefined|current|nb|ui|std)\b|\.[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*(?=\()|[(){}[\],.?/|])/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: source.slice(last, index), class: "" });
    const text = match[0];
    tokens.push({ text, class: signatureTokenClass(text) });
    last = index + text.length;
  }
  if (last < source.length) tokens.push({ text: source.slice(last), class: "" });
  return tokens;
};

const formulaTokenClass = (token: string): string => {
  if (/^=|^[(),+\-*/<>!]+$/.test(token)) return "text-zinc-500 dark:text-zinc-500";
  if (/^["'`]/.test(token)) return "text-emerald-700 dark:text-emerald-300";
  if (/^\d/.test(token)) return "text-amber-700 dark:text-amber-300";
  if (/^[A-Z][A-Z0-9_]*(?=\()/.test(token)) return "text-blue-700 dark:text-blue-300";
  return "";
};

const tokenizeFormula = (source: string): SyntaxToken[] => {
  const tokens: SyntaxToken[] = [];
  const pattern = /(=|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b[A-Z][A-Z0-9_]*(?=\()|\d+(?:\.\d+)?|==|!=|<=|>=|[(),+\-*/<>])/g;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: source.slice(last, index), class: "" });
    const text = match[0];
    tokens.push({ text, class: formulaTokenClass(text) });
    last = index + text.length;
  }
  if (last < source.length) tokens.push({ text: source.slice(last), class: "" });
  return tokens;
};

const HighlightedCode = (props: { code: string; kind: "signature" | "formula" }) => {
  const tokens = () => (props.kind === "formula" ? tokenizeFormula(props.code) : tokenizeSignature(props.code));
  return (
    <>
      {tokens().map((token) => (
        <span class={token.class}>{token.text}</span>
      ))}
    </>
  );
};

const Info = (props: { children: JSX.Element }) => (
  <div class="info-block-info my-3 flex items-start gap-2 text-xs">
    <i class="ti ti-info-circle mt-0.5 shrink-0" />
    <div>{props.children}</div>
  </div>
);

const Tip = (props: { children: JSX.Element }) => (
  <div class="info-block-success my-3 flex items-start gap-2 text-xs">
    <i class="ti ti-bulb mt-0.5 shrink-0" />
    <div>{props.children}</div>
  </div>
);

const Warning = (props: { children: JSX.Element }) => (
  <div class="info-block-warning my-3 flex items-start gap-2 text-xs">
    <i class="ti ti-alert-triangle mt-0.5 shrink-0" />
    <div>{props.children}</div>
  </div>
);

const Section = (props: { title: string; icon: string; children: JSX.Element }) => (
  <section class="space-y-3">
    <h4 class="mt-7 flex items-center gap-2 text-sm font-semibold text-primary first:mt-0">
      <i class={`ti ${props.icon} text-blue-500`} />
      {props.title}
    </h4>
    {props.children}
  </section>
);

const InlineCode = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
    {props.children}
  </code>
);

const Snippet = (props: { title: string; code: string; language?: CodeDisplayLanguage }) => (
  <CodeDisplay title={props.title} code={props.code} language={props.language ?? "markdown"} copy lineNumbers />
);

const MiniGrid = (props: { children: JSX.Element }) => <div class="grid gap-2 text-xs sm:grid-cols-2">{props.children}</div>;

const MiniCard = (props: { title: string; children: JSX.Element }) => (
  <div class="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/60">
    <p class="font-semibold text-primary">{props.title}</p>
    <p class="mt-1 text-dimmed">{props.children}</p>
  </div>
);

const ApiMethod = (props: ApiMethodProps) => (
  <article class="rounded-lg border border-zinc-200/70 bg-zinc-50/80 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/45">
    <p class="font-semibold text-primary">{props.name}</p>
    <div class="mt-2 space-y-2">
      <code class="block whitespace-pre-wrap rounded-md bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-200">
        <HighlightedCode code={props.signature} kind="signature" />
      </code>
      <p class="text-dimmed">
        <span class="font-medium text-zinc-600 dark:text-zinc-300">Returns:</span> {props.returns}
      </p>
      <div class="space-y-1 text-dimmed">{props.children}</div>
    </div>
  </article>
);

const ApiCardGrid = (props: { children: JSX.Element }) => <div class="grid gap-3">{props.children}</div>;

const FormulaRow = (props: FormulaItem) => (
  <div class="grid gap-2 px-3 py-3 text-xs md:grid-cols-[minmax(10rem,0.9fr)_minmax(12rem,1.1fr)_minmax(10rem,1fr)]">
    <div>
      <code class="font-mono text-[11px] font-semibold text-blue-700 dark:text-blue-300">{props.signature}</code>
      {props.name !== props.signature && <p class="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">{props.name}</p>}
    </div>
    <code class="block whitespace-pre-wrap rounded-md bg-zinc-100 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-200">
      <HighlightedCode code={props.example} kind="formula" />
    </code>
    <div class="space-y-1 text-dimmed">
      <p>
        <span class="font-medium text-zinc-600 dark:text-zinc-300">Returns:</span> {props.result}
      </p>
      {props.notes && <p>{props.notes}</p>}
    </div>
  </div>
);

const FormulaReferenceGroup = (props: FormulaGroup) => (
  <section class="overflow-hidden rounded-lg border border-zinc-200/70 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/35">
    <header class="border-b border-zinc-200/70 px-3 py-2 dark:border-zinc-800">
      <h5 class="text-xs font-semibold text-primary">{props.title}</h5>
      <p class="mt-0.5 text-xs text-dimmed">{props.intro}</p>
    </header>
    <div class="divide-y divide-zinc-200/70 dark:divide-zinc-800">
      {props.items.map((item) => (
        <FormulaRow {...item} />
      ))}
    </div>
  </section>
);

const FormulaReference = () => (
  <div class="space-y-3">
    <MiniGrid>
      <MiniCard title="Start a formula">
        A formula cell starts with <InlineCode>=</InlineCode>. Example: <InlineCode>=SUM(Hours)</InlineCode>.
      </MiniCard>
      <MiniCard title="Use columns">
        Use the column name directly. For spaces, wrap it in backticks: <InlineCode>{"=SUM(`Total Cost`)"}</InlineCode>.
      </MiniCard>
      <MiniCard title="Comparisons">
        <InlineCode>{">"}</InlineCode>, <InlineCode>{"<"}</InlineCode>, <InlineCode>{"=="}</InlineCode>, and friends return{" "}
        <InlineCode>1</InlineCode> or <InlineCode>0</InlineCode>.
      </MiniCard>
      <MiniCard title="Totals">
        Column totals skip their own formula cell, so <InlineCode>=SUM(Hours)</InlineCode> does not count itself.
      </MiniCard>
    </MiniGrid>
    {formulaGroups.map((group) => (
      <FormulaReferenceGroup {...group} />
    ))}
  </div>
);

const markdownStarter = code(
  "# Trip notes",
  "",
  "Use short paragraphs. Keep one idea per section.",
  "",
  "## Packing",
  "- [x] Passport",
  "- [ ] Charger",
  "- [ ] Rain jacket",
  "",
  "## Ideas",
  "- Visit the old town early",
  "- Keep one evening open",
);

const calloutStarter = code(
  "# Project brief",
  "",
  ":::info",
  "Use this box for context that readers should notice.",
  ":::",
  "",
  ":::success",
  "Decision: keep the first version small.",
  ":::",
  "",
  ":::warning",
  "Risk: waiting for final prices.",
  ":::",
);

const organizeStarter = code(
  "# Garden hub",
  "",
  "#garden #spring #planning",
  "",
  "Use /note to insert links. You do not need to find note ids by hand.",
  "",
  "- [Plant list](note://aB12Cd)",
  "- [Bed plan](note://xY98Qr)",
  "- [Seed order.pdf](attach://pQ45Rt)",
);

const attachmentStarter = code(
  "# Receipt",
  "",
  "Drag a file into the editor, paste an image, or type /file.",
  "",
  "Images render inline:",
  "",
  "![Tomato seedlings](attach://img123)",
  "",
  "Other files render as links:",
  "",
  "[Soil test.pdf](attach://pdf123)",
);

const tableStarter = code(
  "@plants",
  "| Plant | Bed | Status | Progress | Notes |",
  "|---|---|---|---|---|",
  "| Tomato Harzfeuer | Bed A | planted | =PROGRESS(2,4) | keep rain off leaves |",
  "| Bush bean | Bed B | next | =PROGRESS(0.25) | sow into warm soil |",
  "| Chives | Bed C | harvest | =PROGRESS(1) | leave some flowers |",
);

const formulaGroups: FormulaGroup[] = [
  {
    title: "Progress and percentages",
    intro: "Use these when a cell should show completion or a percent.",
    items: [
      {
        name: "PROGRESS",
        signature: "PROGRESS(ratio)",
        example: "=PROGRESS(0.4)",
        result: "40% progress bar",
        notes: "The visual bar is clamped between 0% and 100%.",
      },
      {
        name: "PROGRESS",
        signature: "PROGRESS(done, total)",
        example: "=PROGRESS(2, 10)",
        result: "2/10 progress bar",
        notes: "total must not be 0.",
      },
      {
        name: "PERCENT",
        signature: "PERCENT(part, total)",
        example: "=PERCENT(Done, Total)",
        result: "percent number",
        notes: "Returns 40 for 40%, not 0.4.",
      },
    ],
  },
  {
    title: "Column aggregates",
    intro: "Read one whole column. Empty or non-numeric cells are ignored for numeric functions.",
    items: [
      { name: "SUM", signature: "SUM(column)", example: "=SUM(Hours)", result: "sum of numeric cells" },
      { name: "AVG", signature: "AVG(column)", example: "=AVG(Rating)", result: "average; 0 when empty" },
      { name: "MEAN", signature: "MEAN(column)", example: "=MEAN(Rating)", result: "same as AVG(column)" },
      { name: "MIN", signature: "MIN(column)", example: "=MIN(Price)", result: "smallest number; 0 when empty" },
      { name: "MAX", signature: "MAX(column)", example: "=MAX(Price)", result: "largest number; 0 when empty" },
      { name: "COUNT", signature: "COUNT(column)", example: "=COUNT(Name)", result: "non-empty cell count", notes: "Text counts too." },
      { name: "MEDIAN", signature: "MEDIAN(column)", example: "=MEDIAN(Score)", result: "middle number; 0 when empty" },
      { name: "UNIQUE", signature: "UNIQUE(column)", example: "=UNIQUE(Status)", result: "distinct non-empty value count" },
      {
        name: "STDEV",
        signature: "STDEV(column)",
        example: "=STDEV(Weight)",
        result: "sample standard deviation",
        notes: "Returns 0 for fewer than 2 numbers.",
      },
      {
        name: "COUNTIF",
        signature: "COUNTIF(column, value)",
        example: '=COUNTIF(Status, "done")',
        result: "matching cell count",
        notes: "Exact string match.",
      },
      {
        name: "SUMIF",
        signature: "SUMIF(sumColumn, conditionColumn, value)",
        example: '=SUMIF(Hours, Status, "done")',
        result: "conditional sum",
      },
    ],
  },
  {
    title: "Row aggregates",
    intro: "Read the current row. The cell containing the formula is skipped.",
    items: [
      { name: "ROWSUM", signature: "ROWSUM()", example: "=ROWSUM()", result: "sum of numeric cells in this row" },
      { name: "ROWAVG", signature: "ROWAVG()", example: "=ROWAVG()", result: "average of numeric cells in this row" },
      { name: "ROWMEAN", signature: "ROWMEAN()", example: "=ROWMEAN()", result: "same as ROWAVG()" },
    ],
  },
  {
    title: "Logic and conditions",
    intro: "Build simple decisions. Truthy means non-zero number or non-empty text.",
    items: [
      { name: "IF", signature: "IF(condition, then, else)", example: '=IF(Hours > 2, "long", "short")', result: "then or else value" },
      {
        name: "IFEMPTY",
        signature: "IFEMPTY(value, fallback)",
        example: '=IFEMPTY(Owner, "unassigned")',
        result: "fallback for empty cells",
      },
      {
        name: "IFERROR",
        signature: "IFERROR(value, fallback)",
        example: "=IFERROR(SUM(Missing), 0)",
        result: "fallback when value errors",
      },
      { name: "AND", signature: "AND(a, b, ...)", example: '=AND(Status == "done", Hours > 0)', result: "1 when all are truthy, else 0" },
      {
        name: "OR",
        signature: "OR(a, b, ...)",
        example: '=OR(Status == "done", Status == "shipped")',
        result: "1 when any value is truthy, else 0",
      },
      { name: "NOT", signature: "NOT(value)", example: '=NOT(Status == "done")', result: "1 or 0" },
      {
        name: "CONTAINS",
        signature: "CONTAINS(text, search)",
        example: '=CONTAINS(Notes, "urgent")',
        result: "1 when text contains search, else 0",
      },
    ],
  },
  {
    title: "Text",
    intro: "Clean and combine text values.",
    items: [
      { name: "CONCAT", signature: "CONCAT(...parts)", example: '=CONCAT(First, " ", Last)', result: "joined text" },
      { name: "UPPER", signature: "UPPER(text)", example: "=UPPER(Name)", result: "uppercase text" },
      { name: "LOWER", signature: "LOWER(text)", example: "=LOWER(Tag)", result: "lowercase text" },
      { name: "TRIM", signature: "TRIM(text)", example: "=TRIM(Name)", result: "text without leading/trailing spaces" },
      { name: "LEFT", signature: "LEFT(text, n)", example: "=LEFT(Code, 3)", result: "first n characters" },
      { name: "RIGHT", signature: "RIGHT(text, n)", example: "=RIGHT(Code, 2)", result: "last n characters" },
      { name: "LEN", signature: "LEN(text)", example: "=LEN(Notes)", result: "character count" },
      {
        name: "SUBSTRING",
        signature: "SUBSTRING(text, start, length)",
        example: "=SUBSTRING(Code, 2, 4)",
        result: "text slice",
        notes: "start is 0-based. length is how many characters to take.",
      },
      {
        name: "REPLACE",
        signature: "REPLACE(text, search, replacement)",
        example: '=REPLACE(Name, "old", "new")',
        result: "text with all matches replaced",
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
        result: "number",
        notes: "Division by 0 shows a formula error.",
      },
      { name: "Comparisons", signature: "==  !=  <  <=  >  >=", example: "=Hours >= 8", result: "1 or 0" },
      { name: "ROUND", signature: "ROUND(number, digits)", example: "=ROUND(Price * Qty, 2)", result: "rounded number" },
      { name: "ABS", signature: "ABS(number)", example: "=ABS(Balance)", result: "absolute value" },
      { name: "SQRT", signature: "SQRT(number)", example: "=SQRT(Area)", result: "square root" },
      { name: "POW", signature: "POW(base, exponent)", example: "=POW(2, 8)", result: "power" },
      { name: "MOD", signature: "MOD(a, b)", example: "=MOD(Row, 2)", result: "remainder" },
    ],
  },
  {
    title: "Date and time",
    intro: "Return simple date strings or compare dates.",
    items: [
      { name: "TODAY", signature: "TODAY()", example: "=TODAY()", result: "YYYY-MM-DD" },
      { name: "NOW", signature: "NOW()", example: "=NOW()", result: "YYYY-MM-DD HH:MM:SS" },
      {
        name: "DATEDIFF",
        signature: "DATEDIFF(start, end, unit?)",
        example: '=DATEDIFF(Start, Due, "d")',
        result: "difference as number",
        notes: "Units: ms, s, m, h, d. Full names work too.",
      },
    ],
  },
];

const dataStarter = code(
  "@recipe",
  ":::data",
  "servings: 4",
  "time: 35 min",
  "tags:",
  "  - bavarian",
  "  - weeknight",
  ":::",
  "",
  "@shopping",
  "- flour",
  "- eggs",
  "- mountain cheese",
  "",
  "@tasks",
  "- [ ] Grate cheese",
  "- [x] Slice onions",
);

const scriptDashboard = code(
  "```script",
  'ui.render(ui.heading("Garden dashboard", 2));',
  "",
  "ui.live(() => {",
  '  const plants = current.table("plants")?.rows ?? [];',
  '  const tasks = current.todo("tasks")?.items ?? [];',
  "  const open = tasks.filter((task) => !task.done);",
  "",
  "  return ui.row(",
  '    ui.metric("Plants", plants.length, { icon: "ti ti-plant-2", tone: "success" }),',
  '    ui.metric("Open tasks", open.length, { icon: "ti ti-checkbox", tone: "warning" }),',
  "  );",
  "}).show();",
  "```",
);

const scriptCreate = code(
  "```script",
  "ui.render(",
  '  ui.live(() => ui.table(current.table("ideas")?.rows ?? [], { emptyText: "No ideas yet." })),',
  '  ui.button("Add idea", async () => {',
  '    const title = await ui.prompt.text("Idea title", "", { title: "New idea" });',
  "    if (!title) return;",
  "",
  '    const note = await nb.create({ title, content: "# " + title + "\\n\\n#idea" });',
  '    await current.table("ideas")?.add(title, note, ["#idea"], "new");',
  '    ui.toast("Idea added", { variant: "success" });',
  "  }),",
  ");",
  "```",
);

const fullFormExample = code(
  "const values = await ui.prompt.form({",
  '  title: "Add plant",',
  '  submitText: "Add",',
  "  fields: {",
  '    name: { type: "text", label: "Plant name", required: true, placeholder: "Tomato" },',
  '    notes: { type: "textarea", label: "Notes", rows: 3 },',
  '    count: { type: "number", label: "Seedlings", min: 0, default: 1 },',
  '    perennial: { type: "boolean", label: "Perennial", default: false },',
  '    status: { type: "select", label: "Status", options: ["planned", "sown", "planted"], default: "planned" },',
  "  },",
  "});",
  "",
  "if (!values) return;",
  'await current.table("plants")?.add(values.name, values.status, values.count, values.notes);',
  'ui.toast("Plant added", { variant: "success" });',
);

const liveTableExample = code(
  "ui.render(",
  '  ui.live(() => ui.table(current.table("ideas")?.rows ?? [], { emptyText: "No ideas yet." })),',
  '  ui.button("Add idea", async () => {',
  '    const title = await ui.prompt.text("Idea title");',
  "    if (!title) return;",
  '    await current.table("ideas")?.add(title, "new", "=PROGRESS(0,1)");',
  "  }),",
  ");",
);

const tableActionExample = code(
  "ui.render(",
  "  ui.live(() => {",
  '    const tasks = current.todo("tasks")?.items ?? [];',
  "",
  "    return ui.table(tasks.map((task) => ({",
  "      Task: task.content,",
  '      Done: task.done ? "yes" : "open",',
  '      Action: task.done ? "" : ui.button("Done", async () => {',
  '        await current.replaceLine(task.line, "- [x] " + task.content);',
  "      }),",
  '    })), { emptyText: "No @tasks list found." });',
  "  }),",
  ");",
);

const searchExample = code(
  'const notes = await nb.search("#garden");',
  "",
  "ui.table(notes.map((note) => ({",
  "  note,",
  "  tags: note.tags,",
  "  openTasks: note.todos().flatMap((list) => list.items).filter((todo) => !todo.done).length,",
  "  updated: note.updatedAt,",
  "}))).show();",
);

const noteMetadataExample = code(
  "ui.render(",
  "  ui.heading(current.title, 2),",
  '  ui.text("Note id: " + current.id),',
  '  ui.text("Tags: " + (current.tags.join(", ") || "none")),',
  '  ui.button("Add log line", async () => {',
  '    await current.appendContent("\\n- Updated " + new Date().toISOString());',
  "  }),",
  ");",
);

const kvExample = code(
  "const slot = ui.col();",
  "slot.show();",
  "",
  "const render = () => {",
  '  const value = current.kv.get("counter") ?? 0;',
  "  slot.replaceChildren(",
  "    ui.row(",
  '      ui.text("Shared counter: " + value),',
  '      ui.button("+1", () => current.kv.set("counter", (current = 0) => current + 1)),',
  '      ui.button("Reset", () => current.kv.delete("counter")),',
  "    ),",
  "  );",
  "};",
  "",
  "render();",
  'current.kv.observe("counter", render);',
);

const localKVExample = code(
  "const slot = ui.col();",
  "slot.show();",
  "",
  "const render = async () => {",
  '  const clicks = (await nb.localKV.get("clicks")) ?? 0;',
  "  slot.replaceChildren(",
  "    ui.row(",
  '      ui.text("Personal clicks: " + clicks),',
  '      ui.button("+1", async () => {',
  '        await nb.localKV.set("clicks", (current = 0) => current + 1);',
  "        await render();",
  "      }),",
  "    ),",
  "  );",
  "};",
  "",
  "await render();",
);

const attachmentExample = code(
  'const files = await nb.attachments.uploadFromPicker({ accept: "image/*", multiple: true });',
  "",
  "for (const file of files) {",
  "  await nb.attachments.insertIntoContent(file.id);",
  "}",
  "",
  'ui.toast(files.length + " file(s) inserted", { variant: "success" });',
);

const chartExample = code(
  'const harvest = current.table("harvest")?.rows ?? [];',
  "",
  'ui.chart("bar", {',
  "  height: 220,",
  "  showValues: true,",
  "  data: harvest.map((row) => ({",
  "    label: row.Plant,",
  "    value: Number(row.Grams ?? 0),",
  "  })),",
  "}).show();",
);

const MarkdownTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Start with plain Markdown. Markdown is normal text with small marks for structure. It stays readable even before the editor renders
      it.
    </p>
    <Section title="Write a useful note" icon="ti-markdown">
      <p>
        Use <InlineCode>#</InlineCode> for headings, <InlineCode>-</InlineCode> for lists, and <InlineCode>- [ ]</InlineCode> for tasks.
        Keep notes short and split details into their own notes later.
      </p>
      <Snippet title="A normal note" code={markdownStarter} />
      <Tip>Good first goal: write a note that is useful even without scripts. You can add links, tables, and dashboards later.</Tip>
    </Section>
    <Section title="Make important text stand out" icon="ti-message-circle">
      <p>Use boxes for context, decisions, and warnings. They are still plain Markdown, so they are easy to edit and copy.</p>
      <Snippet title="Readable boxes" code={calloutStarter} />
    </Section>
    <Section title="Common marks" icon="ti-list-details">
      <MiniGrid>
        <MiniCard title="Headings">
          <InlineCode># Title</InlineCode>, <InlineCode>## Section</InlineCode>, <InlineCode>### Detail</InlineCode>
        </MiniCard>
        <MiniCard title="Emphasis">
          <InlineCode>**bold**</InlineCode>, <InlineCode>*italic*</InlineCode>, <InlineCode>~~done~~</InlineCode>
        </MiniCard>
        <MiniCard title="Tasks">
          <InlineCode>- [ ] todo</InlineCode> and <InlineCode>- [x] done</InlineCode>
        </MiniCard>
        <MiniCard title="Insert menu">
          Type <InlineCode>/</InlineCode> on an empty line when you do not remember the syntax.
        </MiniCard>
      </MiniGrid>
    </Section>
  </div>
);

const OrganizeTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>After plain Markdown, add links, tags, and attachments. These are the features most users need before scripts.</p>
    <Section title="Note links" icon="ti-link">
      <p>
        Note links connect one note to another note in the same notebook. They look like <InlineCode>[Label](note://abc123)</InlineCode>,
        but you usually do not type that by hand.
      </p>
      <Info>
        Type <InlineCode>/note</InlineCode>, search for the target note, and pick it. The editor inserts the correct short id.
      </Info>
      <Snippet title="Hub note with links" code={organizeStarter} />
      <Tip>Use links instead of copying the same details into many places. Keep one source note and link to it.</Tip>
    </Section>
    <Section title="Tags" icon="ti-tags">
      <p>
        Tags are labels like <InlineCode>#garden</InlineCode>, <InlineCode>#waiting</InlineCode>, or <InlineCode>#recipe</InlineCode>. They
        work across the note tree: one note can have many tags.
      </p>
      <MiniGrid>
        <MiniCard title="Search">
          Search for <InlineCode>#garden</InlineCode> to find all garden notes.
        </MiniCard>
        <MiniCard title="Autocomplete">
          Type <InlineCode>#</InlineCode> or start a tag like <InlineCode>#gar</InlineCode> to get known tags.
        </MiniCard>
      </MiniGrid>
      <Warning>
        Keep tag names boring and consistent. <InlineCode>#garden</InlineCode> and <InlineCode>#gardening</InlineCode> are different tags.
      </Warning>
    </Section>
    <Section title="Attachments" icon="ti-paperclip">
      <p>
        Attachments belong to the notebook. Images can render inline, and other files render as links. Use drag-and-drop, paste, or the{" "}
        <InlineCode>/file</InlineCode> command.
      </p>
      <Snippet title="Attachment references" code={attachmentStarter} />
    </Section>
  </div>
);

const TablesTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Tables and named blocks are the bridge from notes to small apps. You still edit simple Markdown, but scripts can read the structure.
    </p>
    <Section title="Markdown tables" icon="ti-table">
      <p>
        Tables are good for small structured lists: books, plants, recipes, contacts, tasks, or expenses. Put an{" "}
        <InlineCode>@ref</InlineCode> line above a table when a script should find it.
      </p>
      <Snippet title="Named table with progress formulas" code={tableStarter} />
      <MiniGrid>
        <MiniCard title="Progress">
          <InlineCode>=PROGRESS(0.4)</InlineCode> or <InlineCode>=PROGRESS(2,10)</InlineCode>
        </MiniCard>
        <MiniCard title="Sum">
          <InlineCode>=SUM(Hours)</InlineCode> sums numeric cells and ignores its own formula cell.
        </MiniCard>
      </MiniGrid>
    </Section>
    <Section title="Formula reference" icon="ti-math-function">
      <p>
        Formula names are case-insensitive. A formula can reference another formula cell; circular references show an error instead of
        guessing.
      </p>
      <FormulaReference />
    </Section>
    <Section title="Named blocks" icon="ti-components">
      <p>
        The same <InlineCode>@ref</InlineCode> pattern works for simple lists, todo lists, data blocks, and sections. Scripts can read them
        by name.
      </p>
      <Snippet title="Data sources for scripts" code={dataStarter} />
      <MiniGrid>
        <MiniCard title="Table">
          <InlineCode>current.table("plants")</InlineCode>
        </MiniCard>
        <MiniCard title="List">
          <InlineCode>current.list("shopping")</InlineCode>
        </MiniCard>
        <MiniCard title="Todo">
          <InlineCode>current.todo("tasks")</InlineCode>
        </MiniCard>
        <MiniCard title="Data">
          <InlineCode>current.data("recipe")</InlineCode>
        </MiniCard>
        <MiniCard title="Section">
          <InlineCode>current.section("notes")</InlineCode>
        </MiniCard>
        <MiniCard title="All blocks">
          Use plural helpers like <InlineCode>current.tables()</InlineCode> to read every table.
        </MiniCard>
      </MiniGrid>
    </Section>
  </div>
);

const ScriptsTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Scripts turn notebook data into dashboards and workflows. Use them when a table, tag search, or todo list should be summarized or
      updated with a button.
    </p>
    <Info>
      Script blocks are JavaScript. Normal globals like <InlineCode>Date</InlineCode>, <InlineCode>Math</InlineCode>,{" "}
      <InlineCode>JSON</InlineCode>, <InlineCode>Promise</InlineCode>, <InlineCode>Array</InlineCode>, and <InlineCode>console</InlineCode>{" "}
      are available.
    </Info>
    <Section title="Render a small dashboard" icon="ti-layout-dashboard">
      <p>
        Use <InlineCode>ui.live</InlineCode> when output should update after current-note edits, button clicks, or table changes.
      </p>
      <Snippet title="Live dashboard from current-note data" code={scriptDashboard} language="markdown" />
    </Section>
    <Section title="Create notes and update tables" icon="ti-pencil-plus">
      <p>
        Scripts can create notes, show prompts, add table rows, append sections, and render charts. Keep source data visible in Markdown.
      </p>
      <Snippet title="Button workflow" code={scriptCreate} language="markdown" />
      <Warning>Use scripts for derived views and helpful actions. Do not hide all important information behind code.</Warning>
    </Section>
    <Section title="Charts" icon="ti-chart-bar">
      <p>Charts use the same data you put in tables and data blocks. Start with one chart that answers one real question.</p>
      <Snippet title="Chart from a table" code={chartExample} language="script" />
    </Section>
  </div>
);

const ApiTab = () => (
  <div class="space-y-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
    <p>
      Script blocks expose four namespaces: <InlineCode>current</InlineCode>, <InlineCode>nb</InlineCode>, <InlineCode>ui</InlineCode>, and{" "}
      <InlineCode>std</InlineCode>. Type a namespace and a dot to use autocomplete.
    </p>
    <Section title="Quick map" icon="ti-api">
      <MiniGrid>
        <MiniCard title="current">Read and update the note that contains the script.</MiniCard>
        <MiniCard title="nb">Search, create, update, and remove notes in the current notebook.</MiniCard>
        <MiniCard title="ui">Render text, tables, charts, buttons, prompts, cards, and toasts.</MiniCard>
        <MiniCard title="std">Curated stdlib helpers: text, dates, fuzzy search, crypto, charts, QR, files, images, timing.</MiniCard>
      </MiniGrid>
    </Section>

    <Section title="current" icon="ti-note">
      <ApiCardGrid>
        <ApiMethod
          name="Metadata"
          signature="current.id / title / content / tags / notebook / createdAt / updatedAt / lockedAt"
          returns="plain values"
        >
          <p>
            <InlineCode>id</InlineCode> is the short id. <InlineCode>tags</InlineCode> are strings without <InlineCode>#</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod
          name="Content writes"
          signature="await current.setTitle/setContent/appendContent/prependContent/insertContentAt/replaceLine(...)"
          returns="void"
        >
          <p>These write to the note that hosts the script. Other-note body writes are intentionally not exposed.</p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Read metadata and append content" code={noteMetadataExample} language="script" />
    </Section>

    <Section title="Named blocks on current" icon="ti-blockquote">
      <p>
        Singular helpers return the first match or <InlineCode>undefined</InlineCode>. Plural helpers return an array. Omit the name on
        plural helpers to read all blocks of that type.
      </p>
      <ApiCardGrid>
        <ApiMethod name="Tables" signature='current.table("ideas"), current.tables(name?)' returns="table | undefined, or table[]">
          <p>
            A table has <InlineCode>columns</InlineCode>, <InlineCode>rows</InlineCode>, and writable tables have{" "}
            <InlineCode>add(...cells)</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="Lists" signature='current.list("shopping"), current.lists(name?)' returns="list | undefined, or list[]">
          <p>
            A list has <InlineCode>items</InlineCode> and writable lists have <InlineCode>add(...items)</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="Todos" signature='current.todo("tasks"), current.todos(name?)' returns="todo | undefined, or todo[]">
          <p>
            Todo items are <InlineCode>{"{ done, content, line }"}</InlineCode>. Writable todos have <InlineCode>add(...items)</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="Data blocks" signature='current.data("recipe"), current.dataBlocks(name?)' returns="data | undefined, or data[]">
          <p>
            Data blocks read <InlineCode>:::data</InlineCode> as objects. Writable data blocks have <InlineCode>set(object)</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="Sections" signature='current.section("log"), current.sections(name?)' returns="section | undefined, or section[]">
          <p>
            Sections expose <InlineCode>markdown</InlineCode> and writable sections have <InlineCode>append(markdown)</InlineCode>.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Reactive table workflow" code={liveTableExample} language="script" />
    </Section>

    <Section title="nb" icon="ti-notebook">
      <p>
        <InlineCode>nb</InlineCode> is scoped to the current notebook. Note ids are short ids.
      </p>
      <ApiCardGrid>
        <ApiMethod name="List and fetch" signature="await nb.list(), await nb.get(shortId)" returns="note[] or note | null">
          <p>
            Returned notes can read named blocks too: <InlineCode>note.table("plants")</InlineCode>,{" "}
            <InlineCode>note.data("book")</InlineCode>, <InlineCode>note.todos()</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="Search" signature="await nb.search(query), await nb.searchTags(tags, options?)" returns="note[]">
          <p>
            Search text or tags. <InlineCode>await nb.search("#garden")</InlineCode> is the common tag search shortcut.
          </p>
        </ApiMethod>
        <ApiMethod name="Create" signature="await nb.create({ title, parentId?, content? })" returns="created note">
          <p>
            <InlineCode>parentId</InlineCode> is a note short id. <InlineCode>content</InlineCode> seeds the new note body.
          </p>
        </ApiMethod>
        <ApiMethod name="Update and remove" signature="await nb.update(shortId, patch), await nb.remove(shortId)" returns="note or void">
          <p>Update metadata such as title or parent. Removing a note deletes it from the notebook.</p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Search notes and render a table" code={searchExample} language="script" />
    </Section>

    <Section title="ui" icon="ti-layout-dashboard">
      <ApiCardGrid>
        <ApiMethod name="Layout" signature="ui.row / ui.col / ui.card / ui.metric / ui.divider" returns="UI element">
          <p>
            Compose output elements. Use <InlineCode>ui.metric</InlineCode> for dashboard numbers.
          </p>
        </ApiMethod>
        <ApiMethod name="Content" signature="ui.text / ui.heading / ui.md / ui.html" returns="UI element">
          <p>
            <InlineCode>ui.md</InlineCode> renders Markdown. <InlineCode>ui.html</InlineCode> is trusted-script-only.
          </p>
        </ApiMethod>
        <ApiMethod name="Data views" signature="ui.table / ui.chart / ui.noteLink / ui.noteList" returns="UI element">
          <p>
            Tables understand note objects, tags, ISO dates, arrays, formulas, progress values, plain objects, and direct{" "}
            <InlineCode>ui.*</InlineCode> elements for action cells.
          </p>
        </ApiMethod>
        <ApiMethod name="Actions" signature="ui.button / ui.toast / ui.live / ui.render" returns="UI element or void">
          <p>
            <InlineCode>ui.live</InlineCode> reruns when the current note body changes in edit mode.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Table with row actions" code={tableActionExample} language="script" />
    </Section>

    <Section title="ui.prompt" icon="ti-forms">
      <p>
        Prompts open modal dialogs. <InlineCode>alert</InlineCode> returns when closed, <InlineCode>confirm</InlineCode> returns a boolean,
        and text/form prompts return <InlineCode>null</InlineCode> when cancelled.
      </p>
      <ApiCardGrid>
        <ApiMethod name="Simple prompts" signature="await ui.prompt.alert/confirm/text(...)" returns="void, boolean, or string | null">
          <p>Use these for one message, one decision, or one text value.</p>
        </ApiMethod>
        <ApiMethod name="Forms" signature="await ui.prompt.form(spec)" returns="object | null">
          <p>
            Script forms support <InlineCode>text</InlineCode>, <InlineCode>textarea</InlineCode>, <InlineCode>number</InlineCode>,{" "}
            <InlineCode>boolean</InlineCode>, and <InlineCode>select</InlineCode>.
          </p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Full form example" code={fullFormExample} language="script" />
    </Section>

    <Section title="State, attachments, tags, and std" icon="ti-tool">
      <ApiCardGrid>
        <ApiMethod name="current.kv" signature="get / set / delete / keys / observe" returns="collaborative per-note state">
          <p>
            Use setter functions for counters and derived updates: <InlineCode>{'current.kv.set("x", (v = 0) => v + 1)'}</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod name="nb.localKV" signature="await get/set/delete/keys, observe" returns="private per-user notebook state">
          <p>Use it for personal UI state. It is async because it uses browser storage.</p>
        </ApiMethod>
        <ApiMethod
          name="nb.attachments"
          signature="list / listInNote / get / upload / uploadFromPicker / insertIntoContent / remove"
          returns="attachment data"
        >
          <p>Uploads and file insertions are scoped to the current notebook.</p>
        </ApiMethod>
        <ApiMethod name="nb.tags" signature="await nb.tags.list(), await nb.tags.notesForTag(tag)" returns="tag summaries or notes">
          <p>
            Pass tags with or without <InlineCode>#</InlineCode>.
          </p>
        </ApiMethod>
        <ApiMethod
          name="std"
          signature="std.text / dates / fuzzy / crypto / encoding / charts / qr / password / timing / files / images / clipboard"
          returns="utility namespaces"
        >
          <p>These are thin pass-throughs to curated stdlib modules. Use autocomplete for available functions.</p>
        </ApiMethod>
      </ApiCardGrid>
      <Snippet title="Shared current.kv" code={kvExample} language="script" />
      <Snippet title="Personal nb.localKV" code={localKVExample} language="script" />
      <Snippet title="Upload and insert attachments" code={attachmentExample} language="script" />
    </Section>
  </div>
);

export default function NotebookLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="notebooks-markdown"
        title="Start: Markdown"
        icon="ti ti-markdown"
        description="Write useful notes with plain Markdown, lists, tasks, and boxes."
        order={100}
      >
        <MarkdownTab />
      </Layout.Help>
      <Layout.Help
        id="notebooks-organize"
        title="Organize"
        icon="ti ti-link"
        description="Connect notes with /note, tags, attachments, and search."
        order={110}
      >
        <OrganizeTab />
      </Layout.Help>
      <Layout.Help
        id="notebooks-tables-data"
        title="Tables & Data"
        icon="ti ti-table"
        description="Use tables, formulas, refs, data blocks, todos, lists, and sections."
        order={120}
      >
        <TablesTab />
      </Layout.Help>
      <Layout.Help
        id="notebooks-scripts"
        title="Scripts"
        icon="ti ti-code"
        description="Build dashboards, buttons, charts, and small workflows from notebook data."
        order={130}
      >
        <ScriptsTab />
      </Layout.Help>
      <Layout.Help
        id="notebooks-script-api"
        title="Script API"
        icon="ti ti-api"
        description="Reference for current, nb, ui, std, KV, tags, and attachments."
        order={140}
      >
        <ApiTab />
      </Layout.Help>
    </>
  );
}
