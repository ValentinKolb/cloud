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
import { GRID_FORMULA_FUNCTIONS } from "../../../formula/function-catalog";

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
    {
      kind: "function",
      match:
        /\b(?:ABS|AND|AVG|CEIL|CONCAT|CONTAINS|COUNT|DATEDIFF|FLOOR|IF|IFEMPTY|IFERROR|LEFT|LEN|LOWER|MAX|MEDIAN|MIN|NOT|OR|POW|RIGHT|ROUND|SQRT|SUBSTRING|SUM|TODAY|UPPER)\b/,
    },
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
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
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
    {
      kind: "keyword",
      match:
        /\b(?:name|description|inputs|type|table|required|options|triggers|form|api|scanner|bulkSelection|dashboardButton|schedule|recordEvent|steps|updateRecord|createRecord|generateDocument|createDocumentLink|sendEmail|httpRequest|setVariable|succeed|fail|if|then|else|switch|cases|default|forEach|as|do|set|values|record|template|document|expiresIn|comment|to|email|user|data|method|url|headers|json|saveAs)\b/,
    },
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/ },
    { kind: "placeholder", match: /\b(?:inputs|variables)\.[A-Za-z_][A-Za-z0-9_.]*\b/ },
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
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
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
            text: "Use workflows for repeatable operations started from forms, API requests, scanners, bulk selection, dashboards, schedules, or record events.",
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
      selected records. Workflows react to records, scanners, bulk selections, schedules, or dashboard buttons.
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
            text: "Use workflow YAML for executable inputs, triggers, and steps. Keep the workflow name and description in the editor fields.",
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
            text: "Let dashboard users run a dashboardButton workflow or open a scanner workflow session. Users also need permission to run the workflow.",
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
      history; the YAML source stores only the executable definition: inputs, triggers, and steps.
    </DocLead>

    <DocSection title="How workflows work">
      <p class="text-dimmed">
        A workflow is a saved action surface. It can be started from a form, authenticated API request, scanner, table bulk selection,
        dashboard button, schedule, or record event. Each run records who started it, which trigger was used, the resolved input, every
        step, generated documents, errors, and timing.
      </p>
      <p class="mt-3 text-dimmed">
        Scanner workflows are workflow-scoped sessions. A user starts one workflow first, then scans any matching item labels for that
        operation. The label stays generic for the record; the workflow decides whether the scan means return, checkout, inventory check, or
        another action.
      </p>
      <p class="mt-3 text-dimmed">
        Keep display metadata out of YAML. Write the name and description in the normal fields at the top of the editor. Write only behavior
        in YAML, so the compiled runtime definition, permissions, and visible label cannot drift apart.
      </p>
      <WorkflowSnippet
        title="YAML shape"
        code={`inputs:
  item:
    type: record
    table: Items
triggers:
  form: {}
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
            text: "Typed values the trigger or runner provides. Record inputs resolve to real Grids records before steps execute.",
          },
          {
            title: "Triggers",
            icon: "ti-player-play",
            text: "The allowed ways to start the workflow. A workflow must declare at least one trigger.",
          },
          {
            title: "Steps",
            icon: "ti-list-check",
            text: "Actions and control flow executed in order. Failed steps stop the run and write diagnostics to the run history.",
          },
          {
            title: "Audit",
            icon: "ti-history",
            text: "Record updates, record creates, document generation, HTTP failures, and run state are auditable.",
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
                <DocInlineCode>description</DocInlineCode>, and <DocInlineCode>required</DocInlineCode> when the generated form should guide
                a user.
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
        title="Inputs"
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

    <DocSection title="Trigger reference">
      <DocRows
        items={[
          { title: "form", icon: "ti-forms", text: "Starts from an autogenerated form. Optional field: enabled." },
          { title: "api", icon: "ti-api", text: "Starts from an authenticated API or service-account call. Optional field: enabled." },
          {
            title: "scanner",
            icon: "ti-scan",
            text: "Opens a scanner session for one workflow and resolves each scanned value into one record input. Resolve by opaque scanCode by default or by a configured unique field.",
          },
          {
            title: "bulkSelection",
            icon: "ti-list-check",
            text: "Runs for a table selection or current query. The input must be a recordList.",
          },
          {
            title: "dashboardButton",
            icon: "ti-click",
            text: "Runs directly from a dashboard action. Scanner workflows can also be placed on dashboards without this trigger.",
          },
          {
            title: "schedule",
            icon: "ti-clock",
            text: "Runs from a five-field cron expression. Optional field: timezone. Scheduled workflows cannot require interactive inputs.",
          },
          {
            title: "recordEvent",
            icon: "ti-activity",
            text: "Runs when a record is created, updated, or deleted. Use table or a record input; filters require one of them.",
          },
        ]}
      />
      <WorkflowSnippet
        title="Triggers"
        code={`triggers:
  form: {}
  api:
    enabled: true
  scanner:
    input: item
    resolve:
      by: field
      field: Label code
  bulkSelection:
    input: labels
  dashboardButton:
    label: Print labels
  schedule:
    cron: '0 9 * * 1-5'
    timezone: Europe/Berlin
  recordEvent:
    event: updated
    input: item`}
      />
      <DocNote title="Required inputs">
        Every active trigger must be able to provide every required input. Forms and APIs can provide all input types. A scanner provides
        only its configured record input, bulk selection provides only its configured recordList input, and schedules or dashboard buttons
        provide no required inputs.
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
                <DocInlineCode>batch</DocInlineCode>, <DocInlineCode>filename</DocInlineCode>, <DocInlineCode>tags</DocInlineCode>, and{" "}
                <DocInlineCode>saveAs</DocInlineCode>.
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
        code={`steps:
  - updateRecord:
      record: inputs.item
      set:
        Status: Available
        Last scanned at: now()
  - createRecord:
      table: Movements
      values:
        Item: inputs.item
        Type: Check-in
      saveAs: movement
  - generateDocument:
      template: Item label
      record: inputs.item
      filename: inputs.item.Name
      tags: [label, inputs.priority]
      saveAs: labelRun
  - createDocumentLink:
      document: labelRun
      expiresIn: 30d
      comment: Workflow email link
      saveAs: labelLink
  - sendEmail:
      template: Label ready email
      to:
        - email: inputs.recipientEmail
      data:
        link: labelLink
        document: labelRun
      saveAs: emailResult
  - httpRequest:
      method: POST
      url: https://example.com/hooks/grids
      headers:
        X-App: Grids
      json:
        event: item.checked_in
        item: inputs.item
      timeoutMs: 15000
      saveAs: hook
  - setVariable:
      name: finishedAt
      value: now()
  - succeed:
      message: "{{ inputs.item.Name }} checked in."`}
      />
    </DocSection>

    <DocSection title="Control flow">
      <p class="text-dimmed">
        Control flow is still a normal step. That keeps nested behavior explicit and makes diagnostics point at the failing branch instead
        of guessing what the workflow meant.
      </p>
      <WorkflowSnippet
        title="Branches and loops"
        code={`steps:
  - if:
      equals: [inputs.item.Status, Loaned]
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
    else:
      - fail:
          message: Item is not currently loaned out.
  - switch: inputs.priority
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
          record: item
          batch: true`}
      />
    </DocSection>

    <DocSection title="Values and references">
      <DocRows
        items={[
          {
            title: "Inputs",
            icon: "ti-input-search",
            text: (
              <>
                Use <DocInlineCode>inputs.name</DocInlineCode> to read an input. For record inputs, append a field name such as{" "}
                <DocInlineCode>inputs.item.Status</DocInlineCode>.
              </>
            ),
          },
          {
            title: "Local records",
            icon: "ti-repeat",
            text: (
              <>
                A <DocInlineCode>forEach</DocInlineCode> step exposes the loop variable declared with <DocInlineCode>as</DocInlineCode>. Use
                it like any other record reference.
              </>
            ),
          },
          {
            title: "Saved outputs",
            icon: "ti-variable",
            text: (
              <>
                <DocInlineCode>saveAs</DocInlineCode> and <DocInlineCode>setVariable</DocInlineCode> store values for later steps.
                Identifier names use letters, numbers, and underscores, and must not start with a number.
              </>
            ),
          },
          {
            title: "now()",
            icon: "ti-clock",
            text: "Use now() as a value when a step should write the current timestamp at execution time.",
          },
        ]}
      />
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
        code={`steps:
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
        - email: inputs.recipientEmail
      data:
        link: invoiceLink
        document: invoicePdf`}
      />
      <TemplateSnippet
        title="Email HTML"
        code={`<p>Hello,</p>
<p>Your document is ready.</p>
<p><a href="{{ data.link.url }}">Download PDF</a></p>
<p>{{ business.legalName | default: app.name }}</p>`}
      />
    </DocSection>

    <DocSection title="Permissions and limits">
      <DocRows
        items={[
          {
            title: "Run permission",
            icon: "ti-lock",
            text: "Starting a workflow requires write access to that workflow. Service account calls use the existing Cloud service-account pattern.",
          },
          {
            title: "Interactive run identity",
            icon: "ti-user-check",
            text: "Forms, API requests, scanners, bulk selections, and dashboard buttons run as the user or service account that starts them, including that principal's current groups.",
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
        code={`inputs:
  item:
    type: record
    table: Items
    required: true
triggers:
  scanner:
    input: item
    resolve:
      by: field
      field: Label code
steps:
  - if:
      equals: [inputs.item.Status, Loaned]
    then:
      - updateRecord:
          record: inputs.item
          set:
            Status: Available
            Last scanned at: now()
      - succeed:
          message: "{{ inputs.item.Name }} returned."
    else:
      - fail:
          message: "{{ inputs.item.Name }} is not currently loaned out."`}
      />
    </DocSection>

    <DocSection title="Bulk document example">
      <WorkflowSnippet
        code={`inputs:
  items:
    type: recordList
    table: Items
triggers:
  bulkSelection:
    input: items
steps:
  - forEach: inputs.items
    as: item
    do:
      - generateDocument:
          template: Item label
          record: item
          batch: true`}
      />
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
            text: "Run from scanners, bulk selections, record events, schedules, and dashboard buttons. Add filters so actions only run for relevant records.",
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
