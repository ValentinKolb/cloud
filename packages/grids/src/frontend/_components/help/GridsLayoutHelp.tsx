import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { For, type JSX } from "solid-js";

type HelpCardProps = {
  title: string;
  icon: string;
  children: JSX.Element;
};

type HelpListProps = {
  items: string[];
};

type RuleProps = {
  title: string;
  children: JSX.Element;
};

type Recipe = {
  problem: string;
  use: string;
  avoid?: string;
};

type Step = {
  title: string;
  text: string;
};

const HelpCard = (props: HelpCardProps) => (
  <section class="rounded-lg bg-zinc-50/80 p-3 text-sm leading-relaxed text-zinc-700 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/45 dark:text-zinc-300 dark:ring-zinc-800">
    <h4 class="flex items-center gap-2 text-sm font-semibold text-primary">
      <i class={`ti ${props.icon} text-blue-500`} aria-hidden="true" />
      {props.title}
    </h4>
    <div class="mt-2 text-sm text-dimmed">{props.children}</div>
  </section>
);

const HelpGrid = (props: { children: JSX.Element }) => <div class="grid gap-3 md:grid-cols-2">{props.children}</div>;

const Rule = (props: RuleProps) => (
  <div class="rounded-md border border-zinc-200/70 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-950/35">
    <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{props.title}</p>
    <div class="mt-1.5 text-sm leading-relaxed text-dimmed">{props.children}</div>
  </div>
);

const RuleStack = (props: { children: JSX.Element }) => <div class="flex flex-col gap-2">{props.children}</div>;

const HelpList = (props: HelpListProps) => (
  <ul class="space-y-1.5">
    <For each={props.items}>
      {(item) => (
        <li class="flex gap-2">
          <i class="ti ti-check mt-0.5 text-sm text-emerald-500" aria-hidden="true" />
          <span>{item}</span>
        </li>
      )}
    </For>
  </ul>
);

const WarningList = (props: HelpListProps) => (
  <ul class="space-y-1.5">
    <For each={props.items}>
      {(item) => (
        <li class="flex gap-2">
          <i class="ti ti-minus mt-0.5 text-sm text-zinc-400" aria-hidden="true" />
          <span>{item}</span>
        </li>
      )}
    </For>
  </ul>
);

const RecipeList = (props: { items: Recipe[] }) => (
  <div class="overflow-hidden rounded-lg border border-zinc-200/70 dark:border-zinc-800">
    <For each={props.items}>
      {(item) => (
        <div class="grid gap-2 border-b border-zinc-200/70 p-3 text-sm last:border-b-0 dark:border-zinc-800 md:grid-cols-[12rem_1fr]">
          <p class="font-semibold text-primary">{item.problem}</p>
          <div class="space-y-1 text-dimmed">
            <p>{item.use}</p>
            {item.avoid && <p class="text-xs text-zinc-500 dark:text-zinc-400">Avoid: {item.avoid}</p>}
          </div>
        </div>
      )}
    </For>
  </div>
);

const StepList = (props: { items: Step[] }) => (
  <ol class="space-y-2">
    <For each={props.items}>
      {(item, index) => (
        <li class="grid gap-2 rounded-md border border-zinc-200/70 bg-white/70 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950/35 md:grid-cols-[2rem_1fr]">
          <span class="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            {index() + 1}
          </span>
          <div>
            <p class="font-semibold text-primary">{item.title}</p>
            <p class="mt-1 text-dimmed">{item.text}</p>
          </div>
        </li>
      )}
    </For>
  </ol>
);

const InlineCode = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
    {props.children}
  </code>
);

const StartTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Grids is a database app for structured work: a base contains tables, tables contain records, and fields describe what each record can
      store. Views, forms, dashboards, exports, and automations all work from that saved table data.
    </p>
    <HelpGrid>
      <HelpCard title="Database" icon="ti-database">
        A database is organized information you can trust, search, filter, and report on. In Grids, that information lives in bases,
        tables, records, and fields.
      </HelpCard>
      <HelpCard title="Base" icon="ti-database">
        A base is one workspace for one subject, such as invoices, hiring, inventory, or projects. Keep unrelated work in separate bases
        when permissions, dashboards, or automations would not overlap.
      </HelpCard>
      <HelpCard title="Table" icon="ti-table">
        A table is one kind of thing. Customers, invoices, tasks, and products are usually separate tables. A row is one record.
      </HelpCard>
      <HelpCard title="Field" icon="ti-columns">
        A field is one fact about a record: status, amount, due date, owner, file, or relation. Choose the field type by how users must
        filter, validate, calculate, and display that fact.
      </HelpCard>
      <HelpCard title="View" icon="ti-filter">
        A view is a saved way to look at a table. It can choose table, card, or calendar display, then define columns, filters, sort,
        group, aggregate, and report sources.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Mental model">
        Tables store data. Views summarize it. Forms collect it. Dashboards present it. Automations react to it.
      </Rule>
      <Rule title="First build path">
        Create the main table, add only the fields users need today, enter a few real records, then add views, forms, dashboards, and
        automations from that working table.
      </Rule>
      <Rule title="Keep rules in settings">
        If a rule must be enforced, model it as a field setting, permission, form setting, or automation. If it only explains context, use a
        description or Markdown widget.
      </Rule>
    </RuleStack>
  </div>
);

const BuildTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Start with the user problem, then pick the smallest Grids feature that makes the work clear and repeatable.
    </p>
    <StepList
      items={[
        {
          title: "Create the base",
          text: "Open Grids from the app list and create a base for one topic, such as invoices, hiring, or inventory.",
        },
        {
          title: "Add the first table",
          text: "Use Add table in the sidebar. Name the table after the records it stores, for example Invoices or Customers.",
        },
        {
          title: "Turn on edit mode",
          text: "Use Edit table when you need to add fields, reorder columns, change field settings, create forms, or adjust sharing.",
        },
        {
          title: "Enter real sample records",
          text: "Add a few real records before building views. Real data shows whether field names, select options, and formulas make sense.",
        },
        {
          title: "Add views, forms, and dashboards",
          text: "Use views for saved subsets, forms for guided entry, and dashboards for summaries or team-facing pages.",
        },
      ]}
    />
    <RecipeList
      items={[
        {
          problem: "Collect data",
          use: "Create a table for the data, then a form for guided entry. Put helper text on form fields when users need examples.",
          avoid: "Using a dashboard note as the only place where required input rules are explained.",
        },
        {
          problem: "Track work",
          use: "Use status select, owner relation or user field, due date, and filtered views such as Open, Waiting, and Done.",
        },
        {
          problem: "Report numbers",
          use: "Create a view with filters, Group by, and Aggregation. Use that view for stats, charts, exports, or dashboard summaries.",
          avoid: "Building charts from raw ungrouped records.",
        },
        {
          problem: "Connect tables",
          use: "Use relation fields. Mark one short field on the linked table as the record label, for example Customer name. Grids uses that label wherever the relation is shown.",
        },
        {
          problem: "Explain a dashboard",
          use: "Add a Markdown widget for instructions, definitions, links, and ownership notes.",
        },
        {
          problem: "Notify another system",
          use: "Create an automation with a record trigger, optional filter, and webhook action. The receiving system should handle the same message twice without creating duplicates.",
        },
      ]}
    />
    <RuleStack>
      <Rule title="Good table boundary">
        Make a new table when records have their own lifecycle, permissions, forms, or dashboard reports. Use a field when it is only a
        property of the same record.
      </Rule>
      <Rule title="Good view boundary">
        Make a view when users need to revisit the same subset or report. Use toolbar filters for temporary inspection.
      </Rule>
    </RuleStack>
  </div>
);

const FieldsTab = () => (
  <div class="space-y-4">
    <HelpGrid>
      <HelpCard title="Text and long text" icon="ti-text-size">
        Use text for short labels and identifiers. Use long text for notes. Turn on Markdown when the content needs headings, links, lists,
        or rich instructions.
      </HelpCard>
      <HelpCard title="Number, decimal, percent" icon="ti-123">
        Use decimal for money and exact arithmetic. Percent values are stored as ratios, where <InlineCode>0.75</InlineCode> displays as
        75%. Progress display clamps values below 0 to 0% and above 1 to 100%.
      </HelpCard>
      <HelpCard title="Date and time" icon="ti-calendar">
        Date values represent a day. Date-time values represent an exact moment, such as a meeting start or created-at time. Use the
        current-time default only when creation time is the right rule.
      </HelpCard>
      <HelpCard title="Select" icon="ti-tags">
        Use select when values must come from a known list. Option colors help scanning; descriptions explain the choice in forms and
        editors.
      </HelpCard>
      <HelpCard title="Relation" icon="ti-link">
        A relation links records across tables. It does not copy the linked text. The visible text comes from the linked table's record
        label.
      </HelpCard>
      <HelpCard title="Formula" icon="ti-function">
        Formula fields calculate when records are shown. Pick fields from suggestions. The formula saves a short reference like{" "}
        <InlineCode>#price</InlineCode>, so renaming a field does not break saved formulas.
      </HelpCard>
    </HelpGrid>
    <HelpCard title="Formula examples" icon="ti-function">
      <HelpList
        items={[
          "Total: #price * #quantity",
          "Label: CONCAT(#customer, \" - \", #status)",
          "Fallback: IFEMPTY(#notes, \"No notes\")",
          "Date age: DATEDIFF(#dueDate, TODAY(), \"days\")",
          "Error handling: IFERROR(#total / #quantity, 0)",
        ]}
      />
    </HelpCard>
    <RuleStack>
      <Rule title="Record label">
        Pick a short readable field as the record label. Do not use long Markdown text; it makes relation labels and detail titles noisy.
      </Rule>
      <Rule title="Required and default">
        Required means a value must exist. Default only fills create requests that omit the field. It does not repair existing records.
      </Rule>
      <Rule title="Unique">
        Unique is enforced when records are saved. Use it for identifiers such as invoice number, SKU, or email. Do not use it for labels that can
        repeat.
      </Rule>
      <Rule title="Index">
        Index fields that users filter, sort, search, or connect through often. Do not index every field; each index adds work when records
        are saved.
      </Rule>
      <Rule title="Money values">
        Decimal fields keep exact decimal values for calculations. Add currency formatting for display; do rounding intentionally in the
        field or formula settings.
      </Rule>
    </RuleStack>
  </div>
);

const ViewsTab = () => (
  <div class="space-y-4">
    <div class="info-block-info flex items-start gap-2 text-xs">
      <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
      <span>Filter, sort, group, aggregate, export, and dashboard reads use the saved data result, not a browser-only copy.</span>
    </div>
    <HelpGrid>
      <HelpCard title="Filter" icon="ti-filter">
        Filters are exact rules. Use them for reporting, permissions review, exports, and saved workflows. Empty checks are available for
        fields where missing data matters.
      </HelpCard>
      <HelpCard title="Sort" icon="ti-sort-ascending">
        Sort decides the order after search and filters apply. Add the most important sort first, then tie-breakers such as created time or
        name.
      </HelpCard>
      <HelpCard title="Group" icon="ti-category">
        Group turns many records into one row per category. After grouping, rows are summaries, not editable source records.
      </HelpCard>
      <HelpCard title="Aggregate" icon="ti-sum">
        Aggregations calculate count, unique count, sum, min, max, latest, earliest, or average per group. Footers use the same formatting
        as the field where possible.
      </HelpCard>
      <HelpCard title="Display mode" icon="ti-layout-cards">
        Table is best for dense editing. Cards are best when a few fields and an image should be scanned quickly. Calendar is best when one
        date field drives the work.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Card and calendar setup">
        Admins choose the display mode in table or view settings. Cards should show only the fields people need at a glance. Calendar needs
        one date or date-time field for placement.
      </Rule>
      <Rule title="Chart-ready view">
        A chart source needs Group by for labels and at least one Aggregation for values. Donut shows parts of one total. Bar compares
        categories. Line works best for ordered categories such as months. Scatter needs two numeric values.
      </Rule>
      <Rule title="Toolbar overrides">
        Toolbar search, filters, sorts, groups, and aggregates refine the current table or view. Saved views keep their own saved rules.
      </Rule>
      <Rule title="Exports">
        Export from the table for the broad result. Export from a filtered view when the saved subset is the report.
      </Rule>
    </RuleStack>
  </div>
);

const SearchTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Search is broad and forgiving. It finds records by displayed values. Use filters when the rule must be exact or reusable.
    </p>
    <HelpGrid>
      <HelpCard title="Included in search" icon="ti-search">
        <HelpList
          items={[
            "text and long text values",
            "numbers, decimals, dates, times, and booleans as displayed text",
            "select option labels",
            "relation labels when the current user can read the linked table",
          ]}
        />
      </HelpCard>
      <HelpCard title="Not searched yet" icon="ti-search-off">
        <WarningList items={["files", "raw JSON values", "formula values", "lookup values", "rollup totals"]} />
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Example">
        Searching <InlineCode>paid</InlineCode> can match a select label. Searching <InlineCode>100</InlineCode> can match a displayed
        amount. Use Amount equals 100 when the number must be exact.
      </Rule>
      <Rule title="Relations">
        Relation search uses the linked record label only when the current user can read the linked table. Hidden relation targets do not
        leak labels through search.
      </Rule>
      <Rule title="Views">
        Search respects the current view. If the view filters records out, search will not bring them back.
      </Rule>
    </RuleStack>
  </div>
);

const DashboardFormsTab = () => (
  <div class="space-y-4">
    <HelpGrid>
      <HelpCard title="Forms" icon="ti-forms">
        Forms are guided create flows for a table. They can rename fields, hide fields, set required rules, and open from dashboards or
        links.
      </HelpCard>
      <HelpCard title="Stats" icon="ti-number">
        Stat widgets show one value from one table or view. Use neutral colors for counts. Use thresholds only when higher or lower is
        meaningful.
      </HelpCard>
      <HelpCard title="Charts" icon="ti-chart-bar">
        Chart widgets read grouped views. The view decides the categories and values; the widget decides chart type, labels, and display
        format.
      </HelpCard>
      <HelpCard title="Embedded views" icon="ti-window">
        Embedded views show saved table results inside a dashboard. They stay table-based so dashboards remain compact and predictable.
      </HelpCard>
      <HelpCard title="Markdown" icon="ti-markdown">
        Markdown widgets are for instructions, definitions, links, and owner notes directly on the dashboard.
      </HelpCard>
      <HelpCard title="Link widgets" icon="ti-external-link">
        Links can target a table, view, form, dashboard, or external URL. External URLs open in a new tab. Internal targets keep normal
        Grids permissions.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Dashboard permissions">
        Dashboard access controls data included directly on the dashboard. Opening a linked table or view, submitting a form, and writing a
        record check the linked item again.
      </Rule>
      <Rule title="Form submit">
        Embedded forms use the same submit rules as normal forms. A user who cannot submit the form or write to its table cannot bypass that
        through a dashboard.
      </Rule>
    </RuleStack>
  </div>
);

const OperationsTab = () => (
  <div class="space-y-4">
    <HelpGrid>
      <HelpCard title="Automations" icon="ti-bolt">
        Automations run after configured record events and can call webhooks. Use filters so actions only run for the records that matter.
      </HelpCard>
      <HelpCard title="Webhooks" icon="ti-webhook">
        Webhooks send a structured request to another system with the event, record, and changed fields. The receiving system should handle
        the same request twice without creating duplicates.
      </HelpCard>
      <HelpCard title="Files" icon="ti-paperclip">
        File fields attach files to records. Put searchable metadata in normal fields when users need to filter, aggregate, or export it.
      </HelpCard>
      <HelpCard title="Live refresh" icon="ti-refresh">
        Tables and dashboards can refresh after record changes. The current view rules still decide whether a changed record should appear.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Automation trigger">
        Record created, updated, deleted, or restored events are table events. Manual and scheduled runs are useful for admin checks and
        external sync jobs.
      </Rule>
      <Rule title="Retries">
        When a webhook creates something outside Grids, send a unique request id if that system supports it. A repeated send must not create
        duplicate invoices, messages, or orders.
      </Rule>
      <Rule title="Edit mode">
        Edit mode changes structure: fields, views, forms, dashboards, widgets, sharing, and automations. Normal mode is for reading and
        entering records.
      </Rule>
    </RuleStack>
  </div>
);

const TroubleshootingTab = () => (
  <div class="space-y-4">
    <RecipeList
      items={[
        {
          problem: "A chart source is missing",
          use: "Open the source table, create or edit a view, add Group by, and add at least one Aggregation. Then select that view in the chart widget.",
        },
        {
          problem: "A record edit fails",
          use: "Reload the record and try again. If Grids says the record version does not match, another user or browser tab may have changed it first.",
        },
        {
          problem: "Search misses a value",
          use: "Check whether the value is searchable. Use a filter for formula output, files, values copied from another table, and exact numeric or date rules.",
        },
        {
          problem: "A form on a dashboard will not submit",
          use: "Check the form permission and the target table write permission. Dashboard access alone is not enough to write records.",
        },
        {
          problem: "A dashboard number looks stale",
          use: "Check the widget source table or view. If the source is grouped or filtered, those saved rules decide what the widget reads.",
        },
        {
          problem: "A relation looks wrong",
          use: "Check which field is marked as the linked table's record label. Relations show that label instead of copying text into the source table.",
        },
      ]}
    />
    <RuleStack>
      <Rule title="When to ask an admin">
        Ask an admin when you cannot see a table, view, form, dashboard, automation, or linked record that the workflow expects.
      </Rule>
      <Rule title="When to change the model">
        If users keep adding the same text note to explain a value, add a field or option description. If users keep exporting and editing
        spreadsheets, create the missing view or dashboard.
      </Rule>
    </RuleStack>
  </div>
);

const PermissionsTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Permissions are set on Grids items: base, table, view, form, and dashboard. Higher access on a base can allow work inside it, but
      explicit access on a specific item can narrow what a user sees.
    </p>
    <HelpGrid>
      <HelpCard title="Read" icon="ti-eye">
        Read access lets a user see the item and the data included by that item. For dashboards, this can include embedded stats, charts,
        views, and forms.
      </HelpCard>
      <HelpCard title="Write" icon="ti-pencil">
        Write access lets a user add or change records where the item supports writing, such as tables and forms.
      </HelpCard>
      <HelpCard title="Admin" icon="ti-tool">
        Admin access lets a user change structure and sharing. Use it for people who can edit fields, views, forms, dashboards, and
        automations.
      </HelpCard>
      <HelpCard title="Linked items" icon="ti-link">
        A dashboard link does not grant access to its target. The target table, view, form, or dashboard checks permissions when opened.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Included vs linked">
        Data shown inside a dashboard follows dashboard access. Opening the original table, opening a view in full, or submitting a form
        checks the original item.
      </Rule>
      <Rule title="Edit mode">
        If you cannot see edit controls, you probably do not have admin access for that item or its base.
      </Rule>
    </RuleStack>
  </div>
);

const ExampleTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Example: build an invoice base that collects invoices, tracks payment, reports monthly income, and sends a webhook when an invoice is
      paid.
    </p>
    <StepList
      items={[
        {
          title: "Create tables",
          text: "Create Customers and Invoices. In Customers, mark Customer name as the record label. In Invoices, add a relation field named Customer that links to Customers.",
        },
        {
          title: "Add invoice fields",
          text: "Add Invoice date (date), Due date (date), Status (select), Subtotal (decimal), Tax (decimal), Total (formula), Paid (boolean), and Receipt (file).",
        },
        {
          title: "Add the total formula",
          text: "In Total, reference Subtotal and Tax from the suggestion list. Use a formula like #subtotal + #tax. Preview the first rows before saving.",
        },
        {
          title: "Create work views",
          text: "Create Open invoices with Status is not Paid. Create Overdue invoices with Due date before today and Paid is false. Create Paid invoices with Paid is true.",
        },
        {
          title: "Create monthly income",
          text: "Create a view that groups Invoice date by month and aggregates Total with Sum. Use this view for a line or bar chart.",
        },
        {
          title: "Create a form",
          text: "Create New invoice form. Hide fields that should be calculated or filled later, such as total and paid.",
        },
        {
          title: "Create a dashboard",
          text: "Add stats for open count and income, a chart from Monthly income, an embedded Overdue invoices view, and Markdown instructions.",
        },
        {
          title: "Add automation",
          text: "Trigger on invoice update, filter to Paid is true, and send a webhook to the accounting or notification system. Ask a technical owner for the target URL.",
        },
      ]}
    />
  </div>
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
