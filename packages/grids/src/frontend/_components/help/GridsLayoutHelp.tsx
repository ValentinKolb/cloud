import { DocCode, DocConceptGrid, DocInlineCode, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { highlight } from "@valentinkolb/stdlib";
import { For } from "solid-js";

type Step = {
  title: string;
  text: string;
};

type Recipe = {
  problem: string;
  use: string;
  avoid?: string;
};

const gridsFormulaHighlight = highlight.compile(
  [
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"/ },
    {
      kind: "function",
      match:
        /\b(?:ABS|AND|AVG|CEIL|CONCAT|CONTAINS|COUNT|DATEDIFF|FLOOR|IF|IFEMPTY|IFERROR|LEFT|LEN|LOWER|MAX|MEDIAN|MIN|NOT|OR|POW|RIGHT|ROUND|SQRT|SUBSTRING|SUM|TODAY|UPPER)\b/,
    },
    { kind: "placeholder", match: /#[A-Za-z0-9_-]+/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
    { kind: "identifier", match: /[A-Za-z_][A-Za-z0-9_]*/ },
  ],
  { classPrefix: "doc-token-" },
);

const gridsQueryHighlight = highlight.compile(
  [
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|inner|as|on|where|formula|group|by|aggregate|having|sort|limit|offset|skip|asc|ascending|desc|descending)\b/i,
    },
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
    { kind: "placeholder", match: /#[A-Za-z0-9_-]+/ },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const FormulaSnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={gridsFormulaHighlight} copy />
);

const QuerySnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={gridsQueryHighlight} copy />
);

const StepList = (props: { items: Step[] }) => (
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

const RecipeRows = (props: { items: Recipe[] }) => (
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

const StartTab = () => (
  <DocPage>
    <DocLead>
      Grids is a flexible database app for structured work. A base contains tables, tables contain records, and fields describe the facts
      each record can store. Views, forms, dashboards, exports, search, aggregations, and automations all read from that saved table data.
    </DocLead>

    <DocSection title="Mental model" eyebrow="Start here">
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
            title: "Field",
            icon: "ti-columns",
            text: "One fact about a record: status, amount, due date, owner, file, relation, formula, or ID.",
          },
          {
            title: "View",
            icon: "ti-filter",
            text: "A saved way to inspect a table. Views can be table, card, or calendar based.",
          },
          {
            title: "Form",
            icon: "ti-forms",
            text: "A guided create flow for a table, useful for dashboards, public intake, and repeatable internal entry.",
          },
          {
            title: "Dashboard",
            icon: "ti-layout-dashboard",
            text: "A working page with stats, charts, forms, Markdown, links, and embedded views.",
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
            title: "Automate only stable workflows",
            text: "Add webhook automations once the table and view rules are clear enough to be trusted.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Source of truth">
      Tables store data. Views shape queries. Forms create records. Dashboards present included data. Automations react to record events.
    </DocNote>
  </DocPage>
);

const BuildTab = () => (
  <DocPage>
    <DocLead>
      Pick the smallest Grids feature that makes the workflow clear. Add structure when it removes repeated manual work, not just because it
      is available.
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
            problem: "Explain a dashboard",
            use: "Use a Markdown widget for instructions, links, definitions, and owner notes.",
          },
          {
            problem: "Notify another system",
            use: "Create a record-triggered automation with a filter and a webhook action.",
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
            text: "Use a table when records have their own lifecycle, permissions, forms, dashboards, or relations.",
          },
          {
            title: "Make a field",
            icon: "ti-columns",
            text: "Use a field when the value is just one property of the same record.",
          },
          {
            title: "Make a view",
            icon: "ti-filter",
            text: "Use a view when people need to revisit the same subset, display mode, or report.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const FieldsTab = () => (
  <DocPage>
    <DocLead>
      Field type is a product decision. It controls validation, search, filtering, display, forms, relations, formulas, and dashboard
      behavior.
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
            text: "Formulas recalculate when records are read. Suggestions show names, but saved expressions store stable #refs.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Formula examples">
      <div class="space-y-3">
        <FormulaSnippet title="Total" code="#price * #quantity" />
        <FormulaSnippet title="Fallback text" code={'IFEMPTY(#notes, "No notes")'} />
        <FormulaSnippet title="Conditional" code={'IF(#inStock, "Available", "Out of stock")'} />
        <FormulaSnippet title="Date age" code={'DATEDIFF(#dueDate, TODAY(), "days")'} />
        <FormulaSnippet title="Error fallback" code="IFERROR(#total / #quantity, 0)" />
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
  </DocPage>
);

const ViewsTab = () => (
  <DocPage>
    <DocLead>
      Views define how people inspect records. They can filter, sort, group, aggregate, and choose a display mode without duplicating data.
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
            text: "Aggregations calculate count, unique count, sum, min, max, latest, earliest, or average per group.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Display modes">
      <DocRows
        items={[
          {
            title: "Table",
            icon: "ti-table",
            text: "Best for dense editing, scanning many columns, and operational work.",
          },
          {
            title: "Cards",
            icon: "ti-layout-cards",
            text: "Best when a few fields, a title, and optional image should be read at a glance.",
          },
          {
            title: "Calendar",
            icon: "ti-calendar-event",
            text: "Best when one date or date-time field places each record on a calendar.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Query DSL">
      <p class="text-dimmed">
        The Query workspace is a power-user layer over the same SQL-backed view engine. Use it when the click UI is too slow for a precise
        report, formula predicate, join, or server-side preview. The normal table and view controls can stay simpler.
      </p>
      <p class="mt-3 text-dimmed">
        References use stable slugs such as <DocInlineCode>#amount</DocInlineCode>. The source list shows table, view, and field refs so
        renaming a field does not break the query.
      </p>
      <div class="space-y-3">
        <QuerySnippet
          title="Rows"
          code={'from table #orders\nselect #customer, #amount\nwhere #status = "Open"\nsort #due_date ascending\nlimit 50'}
        />
        <QuerySnippet
          title="Formula predicate"
          code={
            "from table #products\nselect #name, formula(#price - #cost) as margin\nwhere #price <= formula(#cost * 1.10)\nsort margin desc"
          }
        />
        <QuerySnippet
          title="Monthly chart source"
          code={
            "from table #orders\ngroup by #ordered_at by month\naggregate sum(#line_total) as revenue, count(*) as rows\nhaving #revenue > 0\nsort revenue desc"
          }
        />
        <QuerySnippet
          title="Join"
          code={
            "from table #orders\njoin table #customers as customer on #customer = customer.#id\nselect customer.#name as customer_name, #line_total\nlimit 25"
          }
        />
      </div>
    </DocSection>

    <DocNote title="Saving DSL queries">
      Simple row queries and regular grouped queries can be saved as normal views. SQL-only features such as joins, formula predicates,
      computed alias sorts, <DocInlineCode>having</DocInlineCode>, and non-zero <DocInlineCode>skip</DocInlineCode> are available for
      preview first.
    </DocNote>

    <DocNote title="Chart-ready views">
      A chart source needs <DocInlineCode>Group by</DocInlineCode> for labels and at least one <DocInlineCode>Aggregation</DocInlineCode>{" "}
      for values. Donut shows parts of a total, bar compares categories, line works best for ordered categories, and scatter needs two
      numeric values.
    </DocNote>
  </DocPage>
);

const SearchTab = () => (
  <DocPage>
    <DocLead>
      Search finds records by displayed values. Use it for exploration. Use filters when the rule must be exact, saved, exported, or reused
      by a dashboard.
    </DocLead>

    <DocSection title="Search scope">
      <DocConceptGrid
        items={[
          {
            title: "Included",
            icon: "ti-search",
            text: "Text, long text, numbers, dates, booleans, select labels, and relation labels the user may read.",
          },
          {
            title: "Not included",
            icon: "ti-search-off",
            text: "Files, raw JSON, formula output, lookup values, and rollup totals are not currently searched.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Practical rules">
      <DocRows
        items={[
          {
            title: "Relation labels",
            icon: "ti-link",
            text: "Relation search uses the linked record label only when the current user can read the linked table.",
          },
          {
            title: "Current view",
            icon: "ti-filter",
            text: "Search respects the current view. If the view filters records out, search will not bring them back.",
          },
          {
            title: "Exact values",
            icon: "ti-equal",
            text: "Use a filter for exact numeric, date, select, empty, or permission-sensitive rules.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const DashboardFormsTab = () => (
  <DocPage>
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
            title: "Manual automation",
            icon: "ti-player-play",
            text: "Let dashboard users run a configured manual automation when the dashboard grants that action.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Permission rule">
      Data included directly on a dashboard follows dashboard access. Opening the original table or view, submitting a form, and writing a
      record check the original resource.
    </DocNote>
  </DocPage>
);

const OperationsTab = () => (
  <DocPage>
    <DocLead>
      Operational features should make stable workflows repeatable: attach files, send webhooks, refresh live views, and keep record events
      connected to dashboards.
    </DocLead>

    <DocSection title="Operations">
      <DocRows
        items={[
          {
            title: "Automations",
            icon: "ti-bolt",
            text: "Run after configured record events or manual triggers. Add filters so actions only run for relevant records.",
          },
          {
            title: "Webhooks",
            icon: "ti-webhook",
            text: "Send structured event data to another system. Receivers should handle duplicate sends safely.",
          },
          {
            title: "Files",
            icon: "ti-paperclip",
            text: "Attach files to records. Store searchable metadata in normal fields when users need filters or exports.",
          },
          {
            title: "Live refresh",
            icon: "ti-refresh",
            text: "Tables, views, and dashboards can refresh after record changes. Current filters still decide what appears.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Webhook payload idea">
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
  </DocPage>
);

const PermissionsTab = () => (
  <DocPage>
    <DocLead>
      Grids permissions are resource-based. A user can have access to a dashboard without automatically receiving open access to every
      linked table, view, or form.
    </DocLead>

    <DocSection title="Access levels">
      <DocRows
        items={[
          {
            title: "Read",
            icon: "ti-eye",
            text: "Lets a user see the item and included data for that item.",
          },
          {
            title: "Write",
            icon: "ti-pencil",
            text: "Lets a user add or change records where the resource supports writing.",
          },
          {
            title: "Admin",
            icon: "ti-tool",
            text: "Lets a user change structure, sharing, views, forms, dashboards, and automations.",
          },
          {
            title: "Linked resources",
            icon: "ti-link",
            text: "A dashboard link does not grant access to its target. The target checks permissions when opened.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Included vs linked">
      Data shown inside a dashboard follows dashboard access. Opening the original table, opening a full view, or submitting a form checks
      the original resource.
    </DocNote>
  </DocPage>
);

const TroubleshootingTab = () => (
  <DocPage>
    <DocLead>
      Most Grids issues are caused by a mismatch between the current view, the source table, permissions, or a field setting. Check those
      first before changing the data model.
    </DocLead>

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
            problem: "Relation label looks wrong",
            use: "Check the linked table's record label field. Relations show that label instead of copying arbitrary text.",
          },
        ]}
      />
    </DocSection>
  </DocPage>
);

const ExampleTab = () => (
  <DocPage>
    <DocLead>
      This example builds an invoice base that collects invoices, tracks payment, reports monthly income, and notifies another system when
      an invoice is paid.
    </DocLead>

    <DocSection title="Invoice base recipe">
      <StepList
        items={[
          {
            title: "Create tables",
            text: "Create Customers and Invoices. In Customers, mark Customer name as the record label.",
          },
          {
            title: "Add invoice fields",
            text: "Add Invoice date, Due date, Status, Subtotal, Tax, Total, Paid, and Receipt.",
          },
          {
            title: "Add the total formula",
            text: "Reference Subtotal and Tax from the suggestion list, then preview the first rows before saving.",
          },
          {
            title: "Create work views",
            text: "Create Open invoices, Overdue invoices, Paid invoices, and Monthly income.",
          },
          {
            title: "Create a dashboard",
            text: "Add open count, income stats, a monthly income line chart, overdue invoices, and Markdown instructions.",
          },
          {
            title: "Add automation",
            text: "Trigger when an invoice updates, filter to Paid is true, and send a webhook to accounting or notifications.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Formula">
      <FormulaSnippet code="#subtotal + #tax" />
    </DocSection>
  </DocPage>
);

export default function GridsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="grids-start"
        title="Start: Grids"
        icon="ti ti-layout-grid"
        description="Core concepts and the first build path."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="grids-build"
        title="Build workflows"
        icon="ti ti-route"
        description="Map common problems to the right Grids feature."
        order={105}
      >
        <BuildTab />
      </Layout.Help>
      <Layout.Help
        id="grids-example"
        title="Example: invoices"
        icon="ti ti-receipt"
        description="A full base from tables to dashboard and automation."
        order={106}
      >
        <ExampleTab />
      </Layout.Help>
      <Layout.Help
        id="grids-tables-fields"
        title="Tables & Fields"
        icon="ti ti-table"
        description="Records, field types, relations, selects, Markdown, and formulas."
        order={110}
      >
        <FieldsTab />
      </Layout.Help>
      <Layout.Help
        id="grids-views-query"
        title="Views & Query"
        icon="ti ti-filter"
        description="Display modes, columns, filters, sort, group, aggregate, charts, and exports."
        order={120}
      >
        <ViewsTab />
      </Layout.Help>
      <Layout.Help id="grids-search" title="Search" icon="ti ti-search" description="Search scope and exact filters." order={130}>
        <SearchTab />
      </Layout.Help>
      <Layout.Help
        id="grids-dashboards-forms"
        title="Dashboards & Forms"
        icon="ti ti-layout-dashboard"
        description="Forms, widgets, embedded views, links, and dashboard permissions."
        order={140}
      >
        <DashboardFormsTab />
      </Layout.Help>
      <Layout.Help
        id="grids-permissions"
        title="Permissions"
        icon="ti ti-lock"
        description="Read, write, admin, included data, and linked items."
        order={145}
      >
        <PermissionsTab />
      </Layout.Help>
      <Layout.Help
        id="grids-operations"
        title="Operations"
        icon="ti ti-bolt"
        description="Automations, webhooks, files, live refresh, and edit mode."
        order={150}
      >
        <OperationsTab />
      </Layout.Help>
      <Layout.Help
        id="grids-troubleshooting"
        title="Troubleshooting"
        icon="ti ti-lifebuoy"
        description="Common symptoms and what to check first."
        order={160}
      >
        <TroubleshootingTab />
      </Layout.Help>
    </>
  );
}
