import {
  CopyButton,
  DataTable,
  type DataTableColumn,
  DocCode,
  DocConceptGrid,
  DocInlineCode,
  DocLead,
  DocNote,
  DocPage,
  DocRows,
  DocSection,
} from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { For, type JSX } from "solid-js";
import { aggregateKindPattern } from "../../../aggregate-catalog";
import { formulaFunctionPattern, GRID_FORMULA_FUNCTIONS } from "../../../formula/function-catalog";

type Step = {
  title: string;
  text: string;
};

type Recipe = {
  problem: string;
  use: string;
  avoid?: string;
};

type FunctionRow = {
  name: string;
  category: string;
  signature: string;
  description: string;
  returnType: string;
  search: string;
};

const formulaHighlight = highlight.compile(
  [
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    { kind: "function", match: formulaFunctionPattern() },
    { kind: "identifier", match: /"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*/ },
    { kind: "placeholder", match: /#[A-Za-z0-9_-]+/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const queryHighlight = highlight.compile(
  [
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|inner|as|on|where|search|formula|group|by|aggregate|having|sort|nulls|first|last|limit|offset|skip|asc|ascending|desc|descending|include|deleted|only)\b/i,
    },
    { kind: "function", match: aggregateKindPattern() },
    { kind: "identifier", match: /"(?:[^"]|"")*"|\{[0-9a-f-]{36}\}/i },
    { kind: "placeholder", match: /#[A-Za-z0-9_-]+/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const templateHighlight = highlight.compile(
  [
    { kind: "keyword", match: /({%[\s\S]*?%})/ },
    { kind: "placeholder", match: /({{[\s\S]*?}})/ },
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
    { kind: "identifier", match: /<\/?[A-Za-z][A-Za-z0-9-]*|[A-Za-z_][A-Za-z0-9_.-]*/ },
    { kind: "operator", match: /[=|:/.<>-]/ },
  ],
  { classPrefix: "doc-token-" },
);

const workflowHighlight = highlight.compile(
  [
    { kind: "placeholder", match: /\$\{\{\s*[^{}]+?\s*\}\}/ },
    {
      kind: "keyword",
      match:
        /\b(?:inputs|type|table|label|description|required|options|triggers|schedule|recordEvent|cron|timezone|event|filter|with|steps|updateRecord|createRecord|generateDocument|createDocumentLink|sendEmail|httpRequest|setVariable|succeed|fail|if|then|else|switch|cases|default|forEach|as|do|set|values|record|template|document|expiresIn|comment|to|email|user|data|method|url|headers|json|saveAs)\b/,
    },
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
    { kind: "placeholder", match: /\binputs\.[A-Za-z_][A-Za-z0-9_.]*\b/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /[:\-[\]{}]/ },
  ],
  { classPrefix: "doc-token-" },
);

export const FormulaSnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={formulaHighlight} copy />
);

export const QuerySnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={queryHighlight} copy />
);

export const TemplateSnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={templateHighlight} copy />
);

const WorkflowSnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={workflowHighlight} copy />
);

export const GridsDocPage = (props: { children: JSX.Element }) => <DocPage class="!mx-0 !max-w-none w-full">{props.children}</DocPage>;

export const StepList = (props: { items: Step[] }) => (
  <ol class="space-y-3">
    <For each={props.items}>
      {(item, index) => (
        <li class="grid grid-cols-[1.75rem_1fr] gap-3">
          <span class="app-accent-border app-accent-text flex h-6 w-6 items-center justify-center rounded-full border bg-[var(--theme-list-active-bg)] text-xs font-semibold">
            {index() + 1}
          </span>
          <span>
            <span class="font-semibold text-primary">{item.title}</span>
            <span class="mt-0.5 block text-dimmed">{item.text}</span>
          </span>
        </li>
      )}
    </For>
  </ol>
);

export const RecipeRows = (props: { items: Recipe[] }) => (
  <div class="space-y-3">
    <For each={props.items}>
      {(item) => (
        <article>
          <p class="font-semibold text-primary">{item.problem}</p>
          <p class="mt-1 text-dimmed">{item.use}</p>
          {item.avoid && <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Avoid: {item.avoid}</p>}
        </article>
      )}
    </For>
  </div>
);

const functionCategory = (name: string, returnType: string): string => {
  if (["SUM", "AVG", "MEAN", "COUNT", "MIN", "MAX", "MEDIAN"].includes(name)) return "Aggregate";
  if (["ABS", "ROUND", "FLOOR", "CEIL", "SQRT", "POW", "MOD", "PERCENT"].includes(name)) return "Number";
  if (["IF", "IFEMPTY", "IFERROR", "AND", "OR", "NOT", "ISBLANK"].includes(name)) return "Logic";
  if (
    [
      "CONTAINS",
      "STARTSWITH",
      "ENDSWITH",
      "ICONTAINS",
      "ISTARTSWITH",
      "IENDSWITH",
      "CONCAT",
      "LEN",
      "LOWER",
      "UPPER",
      "TRIM",
      "LEFT",
      "RIGHT",
      "SUBSTRING",
      "REPLACE",
    ].includes(name)
  )
    return "Text";
  if (["TODAY", "NOW", "YEAR", "MONTH", "DAY", "DATEADD", "DATEDIFF"].includes(name)) return "Date";
  return returnType === "number" ? "Number" : "General";
};

const formulaFunctionRows: FunctionRow[] = GRID_FORMULA_FUNCTIONS.map((fn) => {
  const category = functionCategory(fn.name, fn.returnType);
  return {
    name: fn.name,
    category,
    signature: fn.signature,
    description: fn.description,
    returnType: fn.returnType,
    search: [fn.name, fn.signature, fn.description, category, fn.returnType].join(" "),
  };
});

const formulaFunctionColumns: DataTableColumn<FunctionRow>[] = [
  { id: "category", header: "Group", value: (row) => row.category },
  { id: "signature", header: "Function", value: (row) => row.signature, cellClass: "font-mono text-xs min-w-48" },
  { id: "description", header: "What it does", value: (row) => row.description, cellClass: "min-w-72" },
  { id: "returnType", header: "Returns", value: (row) => row.returnType },
  { id: "copy", header: "", value: (row) => row.name, cellClass: "w-12 text-right" },
];

const renderFormulaCopyCell = (value: unknown) => (
  <CopyButton text={String(value ?? "")} class="btn-ghost btn-sm inline-flex h-7 w-7 items-center justify-center p-0" />
);

export const GridsOverviewPage = () => (
  <GridsDocPage>
    <DocLead>
      Grids is a database app for structured office work. A base contains tables, tables contain records, and fields describe the facts each
      record stores. Views, forms, dashboards, exports, search, aggregations, document templates, and workflows all read from that saved
      table data.
    </DocLead>

    <DocSection title="What Grids is for" eyebrow="Overview">
      <DocRows
        items={[
          {
            title: "Structured records",
            icon: "ti-table",
            text: "Use tables when the data has fields, lifecycle, permissions, forms, views, dashboards, documents, or relations.",
          },
          {
            title: "Operational views",
            icon: "ti-filter",
            text: "Use views when people revisit the same subset, order, grouping, aggregation, card board, or calendar.",
          },
          {
            title: "Guided input",
            icon: "ti-forms",
            text: "Use forms when users should create records through a focused flow instead of opening the whole table.",
          },
          {
            title: "Reports and dashboards",
            icon: "ti-layout-dashboard",
            text: "Use dashboards for stats, charts, embedded views, Markdown, links, and workflow buttons.",
          },
          {
            title: "Documents",
            icon: "ti-file-type-pdf",
            text: "Use document templates to render PDFs from records with GQL data sources and Liquid HTML.",
          },
          {
            title: "Workflows",
            icon: "ti-route",
            text: "Use workflows for repeatable operations invoked directly, exposed through saved launchers, or started automatically by schedules and record events.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <StepList
        items={[
          {
            title: "Model the main table",
            text: "Add the smallest set of fields that users need today. Make the table useful before adding dashboards.",
          },
          {
            title: "Enter real sample records",
            text: "Real records reveal bad field names, missing required rules, and select options that are too vague.",
          },
          {
            title: "Add saved views",
            text: "Create views for repeated work: open work, recent records, grouped reports, cards, and calendars.",
          },
          {
            title: "Add forms and dashboards",
            text: "Use forms for data entry and dashboards for team-facing summaries or operating pages.",
          },
          {
            title: "Add documents and workflows last",
            text: "Create PDF templates and workflow actions once the table, view, and permission rules are clear enough to trust.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Source of truth">
      Tables store data. Views shape queries. Forms create records. Dashboards present included data. Document templates generate PDFs from
      selected records. Workflows define inputs and steps; automatic triggers and saved launchers decide how runs start.
    </DocNote>
  </GridsDocPage>
);

export const GridsCoreModelPage = () => (
  <GridsDocPage>
    <DocLead>
      A Grids base is a set of connected resources around saved table data. Keep the model simple first: tables store records, fields define
      record shape, and the other resources read from or write to those tables.
    </DocLead>

    <DocSection title="Core objects" eyebrow="Model">
      <DocConceptGrid
        items={[
          {
            title: "Base",
            icon: "ti-database",
            text: "One workspace for one subject, such as finance, inventory, hiring, or a bookshop.",
          },
          {
            title: "Table",
            icon: "ti-table",
            text: "One kind of record. Customers, invoices, books, items, and loans usually belong in separate tables.",
          },
          {
            title: "Record",
            icon: "ti-row-insert-bottom",
            text: "One saved item inside a table. Records are the rows that views, forms, dashboards, templates, and workflows use.",
          },
          {
            title: "Field",
            icon: "ti-columns",
            text: "One fact about a record: status, amount, due date, owner, file, relation, formula, barcode, or ID.",
          },
          {
            title: "Relation",
            icon: "ti-link",
            text: "A field that links records across tables. Relation labels come from the target table's record label field.",
          },
          {
            title: "Resource",
            icon: "ti-folder",
            text: "A shareable item such as a table, view, form, dashboard, document template, generated document, or workflow.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="How the pieces connect">
      <DocRows
        items={[
          {
            title: "Tables store data",
            icon: "ti-database",
            text: "Use tables as the source of truth. Do not encode data only in dashboards, documents, or workflow payloads.",
          },
          {
            title: "Views shape data",
            icon: "ti-filter",
            text: "Use views to filter, sort, group, aggregate, and choose a display mode without copying records.",
          },
          {
            title: "Forms write records",
            icon: "ti-forms",
            text: "Use forms to create records with guided fields. Submission still checks the target table permission.",
          },
          {
            title: "Dashboards include data",
            icon: "ti-layout-dashboard",
            text: "Use dashboards to present included data, forms, links, Markdown, and workflow buttons in one operating page.",
          },
          {
            title: "Templates render documents",
            icon: "ti-file-type-pdf",
            text: "Use GQL sources and Liquid HTML to turn selected records into generated PDFs.",
          },
          {
            title: "Workflows run actions",
            icon: "ti-route",
            text: "Use workflow YAML for inputs, optional automatic triggers, and steps. Keep launchers, the workflow name, and its description outside YAML.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Permission boundary">
      Permissions are resource-based. A dashboard, view, form, generated document, or workflow can have its own access without granting open
      access to every linked target.
    </DocNote>
  </GridsDocPage>
);

export const GridsStartPage = GridsOverviewPage;

export const GridsFormulaReferencePage = () => (
  <GridsDocPage>
    <DocLead>
      Formulas calculate values from fields in one record. The same expression model is used by formula fields, computed columns, query
      predicates, and query output, so one reference is enough for humans, CLI workflows, and future agent context.
    </DocLead>

    <DocSection title="Where formulas run" eyebrow="Reference">
      <DocRows
        items={[
          {
            title: "Formula fields",
            icon: "ti-table",
            text: "A saved table field that recalculates when records are read and can be shown in views, cards, detail panels, dashboards, and templates.",
          },
          {
            title: "Computed columns",
            icon: "ti-calculator",
            text: "A temporary output column for analysis. It does not change the table schema unless the user saves a real field.",
          },
          {
            title: "GQL predicates",
            icon: "ti-filter",
            text: "A server-side condition used by where and having. Use formulas here to filter rows by derived values.",
          },
          {
            title: "GQL output",
            icon: "ti-code-plus",
            text: "A calculated result column written as formula(expression) as alias.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Expression rules">
      <DocRows
        items={[
          {
            title: "Fields",
            icon: "ti-columns",
            text: (
              <>
                Reference fields by name. Quote names with spaces or punctuation: <DocInlineCode>"Unit price"</DocInlineCode>.
              </>
            ),
          },
          {
            title: "Text values",
            icon: "ti-quote",
            text: (
              <>
                Use single quotes for text values: <DocInlineCode>'Open'</DocInlineCode>. Double quotes mean a field name.
              </>
            ),
          },
          {
            title: "Empty values",
            icon: "ti-circle-dashed",
            text: "Empty input stays empty unless the expression handles it. Use IFEMPTY for expected fallbacks.",
          },
          {
            title: "Errors",
            icon: "ti-alert-triangle",
            text: "Formula errors render as an error value. Use IFERROR for expected divide-by-zero, missing-value, or conversion cases.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Common formulas">
      <div class="grid gap-3 xl:grid-cols-2">
        <FormulaSnippet title="Line total" code="price * quantity" />
        <FormulaSnippet title="Gross amount" code='"Unit price" * quantity * 1.19' />
        <FormulaSnippet title="Fallback text" code="IFEMPTY(notes, 'No notes')" />
        <FormulaSnippet title="Conditional label" code="IF(inStock, 'Available', 'Out of stock')" />
        <FormulaSnippet title="Days until due" code="DATEDIFF(TODAY(), dueDate, 'days')" />
        <FormulaSnippet title="Safe division" code="IFERROR(total / quantity, 0)" />
      </div>
    </DocSection>

    <DocSection title="Full function reference">
      <DataTable
        rows={formulaFunctionRows}
        columns={formulaFunctionColumns}
        getRowId={(row) => row.name}
        density="compact"
        class="paper max-h-[36rem] overflow-auto"
        renderCell={({ col, value, render }) => (col.id === "copy" ? renderFormulaCopyCell(value) : render(value))}
      />
    </DocSection>

    <DocNote title="For scripts, CLI, and agents" variant="info">
      Treat field names, formulas, GQL, templates, and workflows as public text surfaces. Prefer exact names from the reference or current
      base inventory, keep aliases readable, and quote values deliberately so generated changes are reviewable.
    </DocNote>
  </GridsDocPage>
);

export const GridsBuildBasePage = () => (
  <GridsDocPage>
    <DocLead>
      Build the smallest base that makes the work clear. Add tables, views, forms, dashboards, documents, and workflows when each one
      removes a real manual step.
    </DocLead>

    <DocSection title="Common choices">
      <RecipeRows
        items={[
          {
            problem: "Collect data",
            use: "Create a table, then a form for guided entry. Use field descriptions for examples and validation intent.",
          },
          {
            problem: "Track work",
            use: "Use status, owner, due date, and saved views such as Open, Waiting, Done, or Overdue.",
          },
          {
            problem: "Report numbers",
            use: "Create a grouped view with aggregations, then use it in stats, charts, exports, or dashboard widgets.",
            avoid: "Building charts from raw ungrouped rows.",
          },
          {
            problem: "Connect records",
            use: "Use relation fields. Mark one short field on the target table as the record label.",
          },
          {
            problem: "Generate documents",
            use: "Create a document template on the source table. Load data with GQL, lay it out with Liquid HTML, then generate PDFs from records.",
          },
          {
            problem: "Notify another system",
            use: "Create a record-triggered workflow with a filter and an httpRequest action.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Boundaries">
      <DocRows
        items={[
          {
            title: "Make a table",
            icon: "ti-table",
            text: "Use a table when records have their own lifecycle, permissions, forms, dashboards, documents, or relations.",
          },
          {
            title: "Make a field",
            icon: "ti-columns",
            text: "Use a field when the value is one property of the same record.",
          },
          {
            title: "Make a view",
            icon: "ti-filter",
            text: "Use a view when people need to revisit the same subset, display mode, or report.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="End-to-end example">
      <StepList
        items={[
          { title: "Create tables", text: "For invoices, create Customers and Invoices. Mark Customer name as the customer record label." },
          { title: "Add invoice fields", text: "Add Invoice date, Due date, Status, Subtotal, Tax, Total, Paid, and Receipt." },
          { title: "Create work views", text: "Create views such as Open invoices, Overdue invoices, Paid invoices, and Monthly income." },
          {
            title: "Add output surfaces",
            text: "Use a dashboard for operational summaries and a document template when invoices need generated PDFs.",
          },
          {
            title: "Automate after the model is stable",
            text: "Use a workflow after the table, view, permission, and document rules are clear enough to trust.",
          },
        ]}
      />
    </DocSection>
  </GridsDocPage>
);

export const GridsTablesFieldsPage = () => (
  <GridsDocPage>
    <DocLead>
      Field type is a product decision. It controls validation, search, filtering, display, forms, relations, formulas, dashboards, document
      output, and exports.
    </DocLead>

    <DocSection title="Choosing field types">
      <DocRows
        items={[
          {
            title: "Text and long text",
            icon: "ti-text-size",
            text: "Use text for short labels and identifiers. Use long text for notes. Turn on Markdown when users need headings, links, or lists.",
          },
          {
            title: "Number, decimal, percent",
            icon: "ti-123",
            text: "Use decimal for money and exact arithmetic. Percent values are stored as ratios, so 0.75 displays as 75%.",
          },
          {
            title: "Date and date-time",
            icon: "ti-calendar",
            text: "Use date for days. Use date-time for exact moments. Current-time defaults are evaluated on the server when a record is created.",
          },
          {
            title: "Select",
            icon: "ti-tags",
            text: "Use select when values must come from a known list. Colors help scanning; descriptions explain options in forms.",
          },
          {
            title: "Relation and lookup",
            icon: "ti-link",
            text: "Relations link records. Lookups display values through a relation without copying the source value.",
          },
          {
            title: "Formula",
            icon: "ti-function",
            text: "Formulas recalculate when records are read. Reference fields by name; quote names with spaces.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Formula examples">
      <div class="space-y-3">
        <FormulaSnippet title="Total" code="price * quantity" />
        <FormulaSnippet title="Fallback text" code={"IFEMPTY(notes, 'No notes')"} />
        <FormulaSnippet title="Conditional" code={"IF(inStock, 'Available', 'Out of stock')"} />
        <FormulaSnippet title="Date age" code={"DATEDIFF(dueDate, TODAY(), 'days')"} />
        <FormulaSnippet title="Quoted name" code={'"Unit price" * quantity'} />
        <FormulaSnippet title="Error fallback" code="IFERROR(total / quantity, 0)" />
      </div>
    </DocSection>

    <DocSection title="Rules that matter">
      <DocRows
        items={[
          {
            title: "Record label",
            icon: "ti-id",
            text: "Pick a short readable field. Do not use long Markdown text as the title shown in relations and detail panels.",
          },
          {
            title: "Required and default",
            icon: "ti-asterisk",
            text: "Required means a value must exist. Default only fills new create requests that omit the field.",
          },
          {
            title: "Unique",
            icon: "ti-fingerprint",
            text: "Use unique for identifiers such as invoice number, SKU, asset ID, or email. Avoid it for names that can repeat.",
          },
          {
            title: "Index",
            icon: "ti-search",
            text: "Index fields users filter, sort, search, or join often. Every index adds write cost, so do not index everything.",
          },
        ]}
      />
    </DocSection>
  </GridsDocPage>
);

export const GridsViewsReportsPage = () => (
  <GridsDocPage>
    <DocLead>
      Views define how people inspect records. They can filter, sort, group, aggregate, and choose a display mode without duplicating data.
      Use them for operational lists, card boards, calendars, grouped reports, chart sources, exports, and dashboard embeds.
    </DocLead>

    <DocSection title="Query building blocks">
      <DocRows
        items={[
          {
            title: "Filter",
            icon: "ti-filter",
            text: "Use filters for exact reusable rules. Search is broad; filters are explicit.",
          },
          {
            title: "Sort",
            icon: "ti-sort-ascending",
            text: "Sort decides the order after search and filters apply. Add tie-breakers when results need stable order.",
          },
          {
            title: "Group",
            icon: "ti-category",
            text: "Group turns many records into one row per category. Grouped rows are summaries, not editable source records.",
          },
          {
            title: "Aggregate",
            icon: "ti-sum",
            text: "Aggregations calculate count, unique count, sum, min, max, latest, earliest, median, or average per group.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Display modes">
      <DocRows
        items={[
          { title: "Table", icon: "ti-table", text: "Best for dense editing, scanning many columns, and operational work." },
          {
            title: "Cards",
            icon: "ti-layout-cards",
            text: "Best when a few fields, a title, and optional image should be read at a glance.",
          },
          { title: "Calendar", icon: "ti-calendar-event", text: "Best when one date or date-time field places each record on a calendar." },
        ]}
      />
    </DocSection>

    <DocSection title="Search and exact filters">
      <DocRows
        items={[
          {
            title: "Search",
            icon: "ti-search",
            text: "Search displayed values while exploring a table or view. It respects the current view, so filtered-out records stay hidden.",
          },
          {
            title: "Search scope",
            icon: "ti-search",
            text: "Search includes text, long text, numbers, dates, booleans, select labels, and readable relation labels.",
          },
          {
            title: "Exact filters",
            icon: "ti-equal",
            text: "Use filters for exact numeric, date, select, empty, permission-sensitive, formula, lookup, and file-related rules.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="When to use GQL">
      Use GQL when a report, document source, dashboard widget, or preview needs more precision than the click UI. The GQL section documents
      the text syntax.
    </DocNote>
  </GridsDocPage>
);

export const GridsDashboardFormsPage = () => (
  <GridsDocPage>
    <DocLead>
      Forms collect records. Dashboards combine records, summaries, charts, instructions, links, and actions into a working page.
    </DocLead>

    <DocSection title="Dashboard widgets">
      <DocRows
        items={[
          {
            title: "Stats",
            icon: "ti-number",
            text: "Show one value from a table or view. Use thresholds only when higher or lower has meaning.",
          },
          {
            title: "Charts",
            icon: "ti-chart-bar",
            text: "Read grouped views. The view decides categories and values; the widget decides chart type and labels.",
          },
          {
            title: "Embedded views",
            icon: "ti-window",
            text: "Show saved table results inside a dashboard. Dashboard embeds stay table-based for predictable density.",
          },
          {
            title: "Markdown",
            icon: "ti-markdown",
            text: "Add instructions, definitions, links, and ownership notes directly on the dashboard.",
          },
          {
            title: "Links",
            icon: "ti-external-link",
            text: "Open tables, views, forms, dashboards, or external URLs. Internal targets check their own permissions.",
          },
          {
            title: "Workflow buttons",
            icon: "ti-route",
            text: "Attach a saved dashboard launcher to let users run a workflow from a dashboard. Dashboard access and the workflow actions still enforce their applicable permissions.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Permission rule">
      Data included directly on a dashboard follows dashboard access. Opening the original table or view, submitting a form, and writing a
      record check the original resource.
    </DocNote>
  </GridsDocPage>
);

export const GridsPermissionsPage = () => (
  <GridsDocPage>
    <DocLead>
      Grids permissions are resource-based. A user can have access to a dashboard, view, or generated document without automatically
      receiving open access to every linked table, form, or original source.
    </DocLead>

    <DocSection title="Access levels">
      <DocRows
        items={[
          { title: "Read", icon: "ti-eye", text: "Lets a user see the item and included data for that item." },
          { title: "Write", icon: "ti-pencil", text: "Lets a user add or change records where the resource supports writing." },
          {
            title: "Admin",
            icon: "ti-tool",
            text: "Lets a user change structure, sharing, views, forms, dashboards, workflows, and document templates.",
          },
          {
            title: "Linked resources",
            icon: "ti-link",
            text: "A dashboard link does not grant access to its target. The target checks permissions when opened.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Documents">
      <DocRows
        items={[
          {
            title: "Template setup",
            icon: "ti-file-type-pdf",
            text: "Creating a template starts from base/table admin access. Existing templates can also be managed by users with admin access on that document template.",
          },
          {
            title: "Generate and redownload",
            icon: "ti-download",
            text: "Generating from a saved template and redownloading its runs require read access to that template or inherited table/base access.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Included vs linked">
      Data shown inside a dashboard or saved view follows that resource's access. Opening the original table, opening a linked target, or
      submitting a form checks the original resource.
    </DocNote>
  </GridsDocPage>
);

export const GridsWorkflowsPage = () => (
  <GridsDocPage>
    <DocLead>
      Workflows run repeatable operations in Grids. The UI stores the workflow name, description, enabled state, permissions, and run
      history; YAML stores the executable definition: inputs, optional automatic triggers, and steps. Scanner, bulk, and dashboard launchers
      are saved separately.
    </DocLead>

    <DocSection title="How workflows work">
      <p class="text-dimmed">
        A workflow is one saved executable definition. Start it directly from the Grids UI, authenticated API, or CLI, attach a persisted
        launcher for scanner, bulk, or dashboard use, or declare an automatic schedule or record event in YAML. These paths all create the
        same kind of run from typed inputs and the active workflow revision.
      </p>
      <p class="mt-3 text-dimmed">
        Direct invocation is generic: the caller supplies the workflow inputs, mode, and a stable idempotency key. Launchers add only the
        surface-specific input binding. A scanner resolves scanned text into one record input, bulk supplies one record-list input, and a
        dashboard launcher may bind saved input values.
      </p>
      <p class="mt-3 text-dimmed">
        Keep display metadata out of YAML. Write the name and description in the normal fields at the top of the editor. Write only behavior
        in YAML, and manage saved launchers separately, so the compiled plan and each launch surface can be validated independently.
      </p>
      <WorkflowSnippet
        title="Directly invokable YAML"
        code={`inputs:
  item:
    type: record
    table: Items
steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Checked`}
      />
    </DocSection>

    <DocSection title="Run lifecycle">
      <DocRows
        items={[
          {
            title: "Inputs",
            icon: "ti-forms",
            text: "Typed values supplied by a direct caller, launcher, or automatic trigger. Record inputs resolve before steps execute.",
          },
          {
            title: "Start",
            icon: "ti-player-play",
            text: "Invoke directly, use a persisted launcher, or declare an automatic trigger. A workflow does not need a YAML trigger.",
          },
          {
            title: "Steps",
            icon: "ti-list-check",
            text: "Actions and control flow executed in order. Failed steps stop the run and write diagnostics to the run history.",
          },
          {
            title: "Observe",
            icon: "ti-history",
            text: "Each run keeps its revision, mode, channel, inputs, status, timing, step outcomes, result or error, and generated documents.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Inputs reference">
      <DocRows
        items={[
          {
            title: "Input types",
            icon: "ti-input-search",
            text: (
              <>
                <DocInlineCode>record</DocInlineCode>, <DocInlineCode>recordList</DocInlineCode>, <DocInlineCode>text</DocInlineCode>,{" "}
                <DocInlineCode>number</DocInlineCode>, <DocInlineCode>boolean</DocInlineCode>, <DocInlineCode>date</DocInlineCode>,{" "}
                <DocInlineCode>dateTime</DocInlineCode>, and <DocInlineCode>select</DocInlineCode>.
              </>
            ),
          },
          {
            title: "Common fields",
            icon: "ti-list-details",
            text: (
              <>
                Every input has <DocInlineCode>type</DocInlineCode>. Add <DocInlineCode>label</DocInlineCode>,{" "}
                <DocInlineCode>description</DocInlineCode>, and <DocInlineCode>required</DocInlineCode> so callers and generated input
                controls can explain what the run needs.
              </>
            ),
          },
          {
            title: "Record inputs",
            icon: "ti-database",
            text: (
              <>
                <DocInlineCode>record</DocInlineCode> and <DocInlineCode>recordList</DocInlineCode> require a{" "}
                <DocInlineCode>table</DocInlineCode>. Table references may use the table name, short id, or uuid if unambiguous.
              </>
            ),
          },
          {
            title: "Select inputs",
            icon: "ti-tags",
            text: (
              <>
                <DocInlineCode>select</DocInlineCode> requires an <DocInlineCode>options</DocInlineCode> list. The submitted value must
                match one option exactly.
              </>
            ),
          },
        ]}
      />
      <WorkflowSnippet
        title="Input declarations (fragment)"
        code={`inputs:
  item:
    type: record
    table: Items
    label: Item
    required: true
  labels:
    type: recordList
    table: Items
  note:
    type: text
  priority:
    type: select
    options:
      - Low
      - Normal
      - High`}
      />
    </DocSection>

    <DocSection title="Starting a workflow">
      <DocRows
        items={[
          {
            title: "Direct invocation",
            icon: "ti-player-play",
            text: "Manual UI, API, and CLI callers invoke the same workflow directly with an input object, execute or dryRun mode, and an idempotency key.",
          },
          {
            title: "Persisted launchers",
            icon: "ti-rocket",
            text: "Scanner, bulk, and dashboard launchers are saved resources attached to a workflow. They are configured and validated outside workflow YAML.",
          },
          {
            title: "Automatic triggers",
            icon: "ti-clock-play",
            text: "Only schedule and recordEvent belong under triggers in YAML. The triggers block is optional when a workflow starts only through direct invocation or launchers.",
          },
          {
            title: "Revision and deduplication",
            icon: "ti-git-commit",
            text: "Callers may require the expected active revision. Idempotency keys reuse the same logical invocation and reject conflicting reuse.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Automatic trigger reference">
      <DocRows
        items={[
          {
            title: "schedule",
            icon: "ti-clock",
            text: "Runs future slots from a five-field cron expression. timezone is an optional IANA timezone and defaults to UTC.",
          },
          {
            title: "recordEvent",
            icon: "ti-activity",
            text: "Runs when a record is created, updated, or deleted. Add an optional table restriction and optional server-side filter.",
          },
          {
            title: "with bindings",
            icon: "ti-arrows-exchange",
            text: "Map trigger values into declared workflow inputs. Every required input must receive a compatible value before the automatic run can start.",
          },
          {
            title: "Trigger values",
            icon: "ti-braces",
            text: "Schedules expose occurredAt and slot. Record events expose record, event, and occurredAt through the trigger root.",
          },
        ]}
      />
      <WorkflowSnippet
        title="Scheduled workflow"
        code={`inputs:
  requestedAt:
    type: dateTime
    required: true
triggers:
  schedule:
    cron: '0 9 * * 1-5'
    timezone: Europe/Berlin
    with:
      requestedAt: \${{ trigger.slot }}
steps:
  - succeed:
      message: "Scheduled for \${{ inputs.requestedAt }}."`}
      />
      <WorkflowSnippet
        title="Record-event workflow"
        code={`inputs:
  item:
    type: record
    table: Items
    required: true
  eventAt:
    type: dateTime
    required: true
triggers:
  recordEvent:
    event: updated
    table: Items
    filter:
      fieldId: Name
      op: contains
      value: ready
      caseInsensitive: true
    with:
      item: \${{ trigger.record }}
      eventAt: \${{ trigger.occurredAt }}
steps:
  - updateRecord:
      record: inputs.item
      set:
        Reviewed at: \${{ inputs.eventAt }}`}
      />
      <DocRows
        items={[
          {
            title: "Filter shape",
            icon: "ti-filter",
            text: "A leaf uses fieldId, op, and value; fieldId accepts a field name, short id, or uuid. Text leaves may also set caseInsensitive. Combine leaves with a group containing op: AND or op: OR and a filters list. isEmpty, isNotEmpty, today, thisWeek, and thisMonth omit value.",
          },
          {
            title: "Text operators",
            icon: "ti-letter-case",
            text: "equals, notEquals, contains, notContains, startsWith, endsWith, regex, isEmpty, isNotEmpty.",
          },
          {
            title: "Number operators",
            icon: "ti-number",
            text: "=, !=, <, <=, >, >=, between, isEmpty, isNotEmpty. between takes a two-number [from, to] list.",
          },
          {
            title: "Date operators",
            icon: "ti-calendar",
            text: "=, notEquals, before, after, onOrBefore, onOrAfter, between, today, thisWeek, thisMonth, lastNDays, isEmpty, isNotEmpty. between takes a two-value [from, to] list. Use ISO dates, timezone-aware ISO date-times for fields with time, and a non-negative integer for lastNDays.",
          },
          {
            title: "Boolean, select, and relation operators",
            icon: "ti-list-check",
            text: "Boolean fields use =, isEmpty, isNotEmpty. Select fields use is, isNot, isAnyOf, isNoneOf, isEmpty, isNotEmpty; list operators take option-id arrays. Relation fields use containsAny, notContainsAny, isEmpty, isNotEmpty; list operators take non-empty record UUID arrays.",
          },
        ]}
      />
      <DocNote title="Required inputs">
        Direct callers can provide every declared input. Launchers provide their configured binding plus any invocation inputs. Each
        automatic trigger must use <DocInlineCode>with</DocInlineCode> to provide all required inputs from compatible trigger values.
      </DocNote>
    </DocSection>

    <DocSection title="Launcher reference">
      <DocRows
        items={[
          {
            title: "Scanner",
            icon: "ti-scan",
            text: "Binds one record input. Resolve scanned text by a generated scan code or by a configured field that enforces unique values.",
          },
          {
            title: "Bulk",
            icon: "ti-list-check",
            text: "Binds one recordList input from explicit record IDs or a row-shaped table query, with at most 10,000 records per run.",
          },
          {
            title: "Dashboard",
            icon: "ti-layout-dashboard",
            text: "Exposes the workflow as a dashboard action and may persist input bindings such as a fixed reporting range.",
          },
          {
            title: "Launcher lifecycle",
            icon: "ti-refresh",
            text: "Each launcher has its own name, enabled state, validated workflow revision, and diagnostics. Review launcher diagnostics when workflow inputs change.",
          },
        ]}
      />
      <DocNote title="Outside YAML" variant="info">
        Launcher configuration is persisted with the workflow, not copied into its source. One workflow can therefore support multiple named
        scanner, bulk, or dashboard surfaces without changing the executable definition.
      </DocNote>
    </DocSection>

    <DocSection title="Step reference">
      <DocRows
        items={[
          {
            title: "updateRecord",
            icon: "ti-database-edit",
            text: (
              <>
                Changes fields on one record. Required fields: <DocInlineCode>record</DocInlineCode> and <DocInlineCode>set</DocInlineCode>.
              </>
            ),
          },
          {
            title: "createRecord",
            icon: "ti-database-plus",
            text: (
              <>
                Inserts a record. Required fields: <DocInlineCode>table</DocInlineCode> and <DocInlineCode>values</DocInlineCode>. Optional:{" "}
                <DocInlineCode>saveAs</DocInlineCode>.
              </>
            ),
          },
          {
            title: "generateDocument",
            icon: "ti-file-type-pdf",
            text: (
              <>
                Generates a PDF for one record. Supports <DocInlineCode>template</DocInlineCode>, <DocInlineCode>record</DocInlineCode>,{" "}
                <DocInlineCode>filename</DocInlineCode>, <DocInlineCode>tags</DocInlineCode>, and <DocInlineCode>saveAs</DocInlineCode>.
              </>
            ),
          },
          {
            title: "createDocumentLink",
            icon: "ti-link",
            text: (
              <>
                Creates an expiring public download link for a document generated earlier in the run. Required field:{" "}
                <DocInlineCode>document</DocInlineCode>. Optional fields: <DocInlineCode>expiresIn</DocInlineCode>,{" "}
                <DocInlineCode>comment</DocInlineCode>, and <DocInlineCode>saveAs</DocInlineCode>.
              </>
            ),
          },
          {
            title: "sendEmail",
            icon: "ti-mail",
            text: (
              <>
                Sends one configured email template. Required fields: <DocInlineCode>template</DocInlineCode> and{" "}
                <DocInlineCode>to</DocInlineCode>. Recipients can be <DocInlineCode>email</DocInlineCode> values or Cloud{" "}
                <DocInlineCode>user</DocInlineCode> ids. Optional fields: <DocInlineCode>data</DocInlineCode> and{" "}
                <DocInlineCode>saveAs</DocInlineCode>.
              </>
            ),
          },
          {
            title: "httpRequest",
            icon: "ti-world",
            text: "Sends one JSON HTTP request. Methods: GET, POST, PUT, PATCH, DELETE. Optional fields: headers, json, timeoutMs, saveAs. Redirects are returned, not followed.",
          },
          {
            title: "setVariable, succeed, and fail",
            icon: "ti-variable",
            text: "setVariable stores a value for later steps. succeed stops the run with a visible success message; fail stops it with a visible error message.",
          },
        ]}
      />
      <WorkflowSnippet
        title="Actions"
        code={`inputs:
  item:
    type: record
    table: Items
    required: true
  priority:
    type: select
    options:
      - Low
      - Normal
      - High
  recipientEmail:
    type: text
    required: true
steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Available
        Last scanned at: \${{ now() }}
  - createRecord:
      table: Movements
      values:
        Item: \${{ inputs.item }}
        Type: Check-in
      saveAs: movement
  - generateDocument:
      template: Item label
      record: inputs.item
      filename: \${{ inputs.item.Name }}
      tags:
        - label
        - \${{ inputs.priority }}
      saveAs: labelRun
  - createDocumentLink:
      document: labelRun
      expiresIn: 30d
      comment: Workflow email link
      saveAs: labelLink
  - sendEmail:
      template: Label ready email
      to:
        - email: \${{ inputs.recipientEmail }}
      data:
        link: \${{ labelLink }}
        document: \${{ labelRun }}
      saveAs: emailResult
  - httpRequest:
      method: POST
      url: https://example.com/hooks/grids
      headers:
        X-App: Grids
      json:
        event: item.checked_in
        item: \${{ inputs.item }}
      timeoutMs: 15000
      saveAs: hook
  - setVariable:
      name: finishedAt
      value: \${{ now() }}
  - succeed:
      message: "\${{ inputs.item.Name }} checked in."`}
      />
    </DocSection>

    <DocSection title="Control flow">
      <p class="text-dimmed">
        Control flow is still a normal step. That keeps nested behavior explicit and makes diagnostics point at the failing branch instead
        of guessing what the workflow meant.
      </p>
      <WorkflowSnippet
        title="Branches and loops"
        code={`inputs:
  item:
    type: record
    table: Items
    required: true
  items:
    type: recordList
    table: Items
    required: true
  priority:
    type: select
    options:
      - Low
      - Normal
      - High
steps:
  - if:
      equals:
        - \${{ inputs.item.Status }}
        - Loaned
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
    else:
      - fail:
          message: Item is not currently loaned out.
  - switch: \${{ inputs.priority }}
    cases:
      - when: High
        do:
          - setVariable:
              name: queue
              value: urgent
    default:
      - setVariable:
          name: queue
          value: normal
  - forEach: inputs.items
    as: item
    do:
      - generateDocument:
          template: Item label
          record: item`}
      />
    </DocSection>

    <DocSection title="Values and references">
      <DocRows
        items={[
          {
            title: "Literal strings",
            icon: "ti-letter-case",
            text: (
              <>
                Plain strings are always literal values. Write <DocInlineCode>Checked</DocInlineCode>, URLs, email addresses, and dotted
                text directly when the workflow should use that exact text.
              </>
            ),
          },
          {
            title: "Dynamic values",
            icon: "ti-input-search",
            text: (
              <>
                A dynamic value must be the whole <DocInlineCode>{"${{ ... }}"}</DocInlineCode> string. Use{" "}
                <DocInlineCode>{"${{ inputs.name }}"}</DocInlineCode>, append a record field such as{" "}
                <DocInlineCode>{"${{ inputs.item.Status }}"}</DocInlineCode>, read a saved value with{" "}
                <DocInlineCode>{"${{ savedValue }}"}</DocInlineCode>, or evaluate <DocInlineCode>{"${{ now() }}"}</DocInlineCode>.
              </>
            ),
          },
          {
            title: "Dedicated references",
            icon: "ti-link",
            text: (
              <>
                Reference-only slots stay raw: <DocInlineCode>record: inputs.item</DocInlineCode>,{" "}
                <DocInlineCode>forEach: inputs.items</DocInlineCode>, <DocInlineCode>document: savedDocument</DocInlineCode>, and{" "}
                <DocInlineCode>exists: inputs.item.Field</DocInlineCode>. Do not wrap these slots in expression syntax.
              </>
            ),
          },
          {
            title: "Scope",
            icon: "ti-variable",
            text: (
              <>
                Inputs are available for the whole run. <DocInlineCode>saveAs</DocInlineCode> and <DocInlineCode>setVariable</DocInlineCode>{" "}
                names are available only after their step. A <DocInlineCode>forEach</DocInlineCode> alias exists only inside its{" "}
                <DocInlineCode>do</DocInlineCode> steps; values created inside branches and loops do not escape that scope.
              </>
            ),
          },
          {
            title: "Result messages",
            icon: "ti-message",
            text: (
              <>
                <DocInlineCode>succeed</DocInlineCode> and <DocInlineCode>fail</DocInlineCode> messages are literal text that may embed one
                or more expressions, for example <DocInlineCode>{"Processed ${{ inputs.item.Name }}"}</DocInlineCode>.
              </>
            ),
          },
        ]}
      />
      <DocNote title="Saved output paths">
        Saved outputs expose structured paths. Documents provide <DocInlineCode>id</DocInlineCode>, <DocInlineCode>shortId</DocInlineCode>,{" "}
        <DocInlineCode>templateId</DocInlineCode>, <DocInlineCode>workflowRunId</DocInlineCode>, <DocInlineCode>snapshotId</DocInlineCode>,{" "}
        <DocInlineCode>baseId</DocInlineCode>, <DocInlineCode>tableId</DocInlineCode>, <DocInlineCode>recordId</DocInlineCode>,{" "}
        <DocInlineCode>documentNumber</DocInlineCode>, <DocInlineCode>filename</DocInlineCode>, <DocInlineCode>tags</DocInlineCode>,{" "}
        <DocInlineCode>generatedBy</DocInlineCode>, and <DocInlineCode>generatedAt</DocInlineCode>. Document links provide{" "}
        <DocInlineCode>url</DocInlineCode>, <DocInlineCode>expiresAt</DocInlineCode>, and <DocInlineCode>documentRunId</DocInlineCode>.
        Email results provide <DocInlineCode>subject</DocInlineCode>, <DocInlineCode>templateId</DocInlineCode>, and{" "}
        <DocInlineCode>recipients</DocInlineCode>. HTTP results provide <DocInlineCode>status</DocInlineCode>,{" "}
        <DocInlineCode>ok</DocInlineCode>, and <DocInlineCode>body</DocInlineCode>. Read them with expressions such as{" "}
        <DocInlineCode>{"${{ link.url }}"}</DocInlineCode> or <DocInlineCode>{"${{ hook.status }}"}</DocInlineCode>.
      </DocNote>
    </DocSection>

    <DocSection title="Email templates">
      <p class="text-dimmed">
        Email templates are managed from the workflow page in edit mode. They are base-level Liquid templates with a subject and an HTML
        body. A workflow step chooses one template and passes only the data that email needs.
      </p>
      <DocRows
        items={[
          {
            title: "Template lookup",
            icon: "ti-mail",
            text: (
              <>
                <DocInlineCode>sendEmail.template</DocInlineCode> accepts an enabled email template name, short id, or uuid. Ambiguous names
                are rejected.
              </>
            ),
          },
          {
            title: "Recipients",
            icon: "ti-users",
            text: (
              <>
                Use <DocInlineCode>email</DocInlineCode> for an email address value or <DocInlineCode>user</DocInlineCode> for a Cloud user
                id. Each entry must pick one recipient type.
              </>
            ),
          },
          {
            title: "Liquid roots",
            icon: "ti-braces",
            text: (
              <>
                Templates can read <DocInlineCode>data</DocInlineCode>, <DocInlineCode>app</DocInlineCode>,{" "}
                <DocInlineCode>business</DocInlineCode>, <DocInlineCode>workflow</DocInlineCode>, <DocInlineCode>run</DocInlineCode>, and{" "}
                <DocInlineCode>date</DocInlineCode>.
              </>
            ),
          },
        ]}
      />
      <WorkflowSnippet
        title="Send a generated document link"
        code={`inputs:
  invoice:
    type: record
    table: Invoices
    required: true
  recipientEmail:
    type: text
    required: true
steps:
  - generateDocument:
      template: Invoice
      record: inputs.invoice
      saveAs: invoicePdf
  - createDocumentLink:
      document: invoicePdf
      expiresIn: 30d
      saveAs: invoiceLink
  - sendEmail:
      template: Invoice email
      to:
        - email: \${{ inputs.recipientEmail }}
      data:
        link: \${{ invoiceLink }}
        document: \${{ invoicePdf }}`}
      />
      <TemplateSnippet
        title="Email HTML"
        code={`<p>Hello,</p>
<p>Your document is ready.</p>
<p><a href="{{ data.link.url }}">Download PDF</a></p>
<p>{{ business.legalName | default: app.name }}</p>`}
      />
    </DocSection>

    <DocSection title="Run modes and observability">
      <DocRows
        items={[
          {
            title: "execute",
            icon: "ti-player-play",
            text: "Runs the active revision and performs its record changes, durable intents, and external requests.",
          },
          {
            title: "dryRun",
            icon: "ti-eye",
            text: "Plans the workflow, checks current references and permissions, and records predicted effects without applying changes or sending external requests.",
          },
          {
            title: "Channels",
            icon: "ti-direction-sign",
            text: "Direct UI, API, and CLI calls use api. Saved launchers use dashboard, scanner, or bulk. Automatic triggers use schedule or recordEvent.",
          },
          {
            title: "Run statuses",
            icon: "ti-progress-check",
            text: "A run is queued, running, waiting, succeeded, failed, canceled, or needs_attention.",
          },
          {
            title: "Step statuses",
            icon: "ti-list-details",
            text: "Step history uses the run states where applicable and can also show skipped, indeterminate, or unsupported planning outcomes.",
          },
          {
            title: "Run detail",
            icon: "ti-timeline-event",
            text: "Inspect revision, channel, mode, input, start and finish times, duration, result message or structured error, each step outcome, and generated documents.",
          },
        ]}
      />
      <DocNote title="Dry runs are recorded">
        A dry run is a normal observable run with mode <DocInlineCode>dryRun</DocInlineCode>. Review its predicted effects and step
        outcomes; it does not prove that a later execute run will see unchanged records, permissions, or external systems.
      </DocNote>
    </DocSection>

    <DocSection title="Permissions and limits">
      <DocRows
        items={[
          {
            title: "Run permission",
            icon: "ti-lock",
            text: "Direct calls and standalone launcher runs require workflow write access. Dashboard widget runs use included dashboard authorization; actions still check their target resources.",
          },
          {
            title: "Caller run identity",
            icon: "ti-user-check",
            text: "Direct UI, API, and CLI calls plus scanner, bulk, and dashboard launchers run as the user or service account that starts them. Direct calls share the api channel; authorization still records the authenticated principal.",
          },
          {
            title: "Automatic run identity",
            icon: "ti-clock-play",
            text: "Schedules and record events run as the workflow owner with the owner's current groups. A record event keeps the user who changed the record in trigger metadata, but does not inherit that user's permissions.",
          },
          {
            title: "Action permission",
            icon: "ti-database",
            text: "Record reads, record writes, document generation, document links, and email sends check the run identity against the affected table, template, or workflow.",
          },
          {
            title: "Email delivery",
            icon: "ti-mail",
            text: "Email template management requires base admin access. Workflow runs can use enabled email templates without exposing template HTML in autocomplete.",
          },
          {
            title: "HTTP guardrails",
            icon: "ti-world",
            text: "httpRequest pins the validated DNS address for the socket connection, limits request and response bodies to 64 KiB, applies the timeout to DNS and transfer, and blocks private or reserved targets by default. Administrators can restrict requests to an exact or wildcard host allowlist. Private-network requests require both the private-network setting and a matching non-empty host allowlist.",
          },
          {
            title: "Bulk size",
            icon: "ti-list-check",
            text: "Bulk selections and forEach loops are capped at 10,000 records per run.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Scanner example">
      <WorkflowSnippet
        title="Scanner workflow YAML"
        code={`inputs:
  item:
    type: record
    table: Items
    required: true
steps:
  - if:
      equals:
        - \${{ inputs.item.Status }}
        - Loaned
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
            Last scanned at: \${{ now() }}
      - succeed:
          message: "\${{ inputs.item.Name }} returned."
    else:
      - fail:
          message: "\${{ inputs.item.Name }} is not currently loaned out."`}
      />
      <DocNote title="Saved launcher">
        Add a scanner launcher for the <DocInlineCode>item</DocInlineCode> record input. Choose generated scan-code resolution or configure
        a unique field such as <DocInlineCode>Label code</DocInlineCode>. The launcher remains outside this YAML.
      </DocNote>
    </DocSection>

    <DocSection title="Bulk document example">
      <WorkflowSnippet
        title="Bulk document workflow YAML"
        code={`inputs:
  items:
    type: recordList
    table: Items
    required: true
steps:
  - forEach: inputs.items
    as: item
    do:
      - generateDocument:
          template: Item label
          record: item`}
      />
      <DocNote title="Saved launcher">
        Add a bulk launcher for the <DocInlineCode>items</DocInlineCode> record-list input. The launcher can supply an explicit selection or
        the current row-shaped query without adding a trigger to YAML.
      </DocNote>
    </DocSection>
  </GridsDocPage>
);

export const GridsOperationsTroubleshootingPage = () => (
  <GridsDocPage>
    <DocLead>
      Operate a Grids base by keeping repeated work explicit, checking the current view and permissions first, and using workflows,
      documents, files, and live refresh only where they support the table model.
    </DocLead>

    <DocSection title="Routine operations">
      <DocRows
        items={[
          {
            title: "Workflows",
            icon: "ti-route",
            text: "Use direct invocation, saved scanner, bulk, or dashboard launchers, and automatic record events or schedules. Inspect run history before retrying failures.",
          },
          {
            title: "HTTP requests",
            icon: "ti-send",
            text: "Send explicit JSON payloads to another system. Receivers should handle duplicate sends safely.",
          },
          {
            title: "Files",
            icon: "ti-paperclip",
            text: "Attach files to records. Store searchable metadata in normal fields when users need filters or exports.",
          },
          {
            title: "Documents",
            icon: "ti-file-type-pdf",
            text: "Generate PDFs from records. Grids stores document run metadata and renders the PDF bytes again when redownloaded.",
          },
          {
            title: "Live refresh",
            icon: "ti-refresh",
            text: "Tables, views, and dashboards can refresh after record changes. Current filters still decide what appears.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Common checks">
      <RecipeRows
        items={[
          {
            problem: "Chart source is missing",
            use: "Open the source table, create or edit a grouped view, add an aggregation, then select that view in the chart widget.",
          },
          {
            problem: "Record edit fails",
            use: "Reload the record and try again. A version mismatch usually means another user or tab changed it first.",
          },
          {
            problem: "Search misses a value",
            use: "Check whether the value is searchable. Use a filter for formula output, lookups, files, and exact rules.",
          },
          {
            problem: "Dashboard form will not submit",
            use: "Check the form permission and target table write permission. Dashboard access alone is not enough to write records.",
          },
          {
            problem: "Document preview fails",
            use: "Open the Source tab, check the rendered GQL, then use the Data tab to copy exact Liquid paths instead of guessing object names.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="HTTP request payload idea">
      <DocCode
        code={`{
  "event": "record.created",
  "recordId": "019e...",
  "tableId": "32b8...",
  "changedFields": ["status"]
}`}
        copy
      />
    </DocSection>
  </GridsDocPage>
);
