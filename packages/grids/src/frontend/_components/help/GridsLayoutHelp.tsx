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

const InlineCode = (props: { children: JSX.Element }) => (
  <code class="rounded bg-zinc-100 px-1 py-px font-mono text-[11px] text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
    {props.children}
  </code>
);

const StartTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Grids manages structured records. Tables store the data. Views, forms, dashboards, exports, and automations read from or write to
      those tables.
    </p>
    <HelpGrid>
      <HelpCard title="Source of truth" icon="ti-database">
        Results are recalculated from saved data. Filters, sorting, grouping, aggregation, search, exports, and dashboard stats use the
        current server result.
      </HelpCard>
      <HelpCard title="When to use what" icon="ti-route">
        Use a table for records, a view for a saved slice, a form for guided input, a dashboard for reporting, and an automation for a
        repeatable external action.
      </HelpCard>
      <HelpCard title="Permissions are resource based" icon="ti-lock">
        Dashboard access can show embedded data. Opening the source table, opening a linked view, or submitting a form still checks that
        target resource.
      </HelpCard>
      <HelpCard title="Edit mode changes structure" icon="ti-tool">
        Edit mode is for tables, fields, views, forms, dashboards, widgets, and sharing. Normal mode is for reading and entering records.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Practical rule">
        If a value must work in filters, formulas, exports, or dashboards, make it a field. If it only explains context, use a field
        description or a dashboard Markdown widget.
      </Rule>
      <Rule title="Avoid hidden workflows">
        Use automations for clear background actions. Do not hide rules there when users need those rules before editing records.
      </Rule>
    </RuleStack>
  </div>
);

const TablesTab = () => (
  <div class="space-y-4">
    <HelpCard title="Field settings" icon="ti-adjustments">
      Field settings define storage, validation, default values, display, and record behavior. Views only decide how a table is shown.
    </HelpCard>
    <HelpGrid>
      <HelpCard title="Select fields" icon="ti-tags">
        Use select when users should choose from known labels. Option colors are display only. Option descriptions explain choices in forms
        and editors.
      </HelpCard>
      <HelpCard title="Relations" icon="ti-link">
        Relations store links to records, not copied text. The visible label comes from the linked table. If the label changes, relation
        displays update.
      </HelpCard>
      <HelpCard title="Long text" icon="ti-markdown">
        Use Markdown long text for instructions, notes, or rich descriptions. Tables clamp long content; record details render the full
        HTML.
      </HelpCard>
      <HelpCard title="Formulas" icon="ti-function">
        Formulas store stable refs like <InlineCode>#price</InlineCode>. The editor shows field names, and the saved formula survives
        renames.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Required vs default">
        Required means the record must have a value. Default only fills a value when a create request omits the field. A default does not
        repair older records.
      </Rule>
      <Rule title="Unique values">
        Unique is enforced by the backend. Use it for identifiers such as invoice number, SKU, or email. Do not use it for labels that may
        repeat.
      </Rule>
      <Rule title="Formula values">
        Formulas recompute when records are read. Decimal math stays precise for money-like values. Invalid results show a formula error
        instead of silently changing data.
      </Rule>
      <Rule title="Record label field">
        Pick a short readable field as the record label. Avoid long Markdown text as the label; it makes relations and detail titles noisy.
      </Rule>
    </RuleStack>
  </div>
);

const ViewsTab = () => (
  <div class="space-y-4">
    <div class="info-block-info flex items-start gap-2 text-xs">
      <i class="ti ti-info-circle mt-0.5 shrink-0" aria-hidden="true" />
      <span>Filter, sort, group, aggregate, export, and search use the same saved data on the server.</span>
    </div>
    <HelpGrid>
      <HelpCard title="Filter and sort" icon="ti-sort-ascending">
        Filters are exact rules, such as Status is Open or Amount is greater than 100. Sort decides order after filters and search apply.
      </HelpCard>
      <HelpCard title="Group and aggregate" icon="ti-sum">
        Group turns many records into categories. Aggregations calculate one value per category: count, unique count, sum, min, max, or
        average.
      </HelpCard>
      <HelpCard title="Chart-ready views" icon="ti-chart-bar">
        Charts need a grouped source view with at least one aggregation. Group is the label. Aggregation is the number.
      </HelpCard>
      <HelpCard title="Embedded views" icon="ti-window">
        Embedded views show the saved result inside a dashboard. Directly opening the source view still needs that view/table permission.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Order of operations">
        Grids applies saved view rules, then toolbar overrides, then pagination. Exports and dashboard widgets use the same server-side
        query path.
      </Rule>
      <Rule title="Use filters for numbers and dates">
        Search for <InlineCode>May</InlineCode> can find displayed dates. Use a filter such as Date is after 2026-05-01 when the rule must
        be exact.
      </Rule>
      <Rule title="Grouped views are summaries">
        After grouping, each row is a group, not an original record. Use an ungrouped view when users need to open or edit individual
        records.
      </Rule>
    </RuleStack>
  </div>
);

const SearchTab = () => (
  <div class="space-y-4">
    <p class="text-sm leading-relaxed text-dimmed">
      Search is broad and forgiving. It finds records by displayed values. Use filters for exact rules, saved views, exports, and reports.
    </p>
    <HelpGrid>
      <HelpCard title="Included in search" icon="ti-search">
        <HelpList
          items={[
            "text and long text values",
            "numbers, decimals, dates, and booleans as stored text",
            "select option labels",
            "relation labels when you can read the linked table",
          ]}
        />
      </HelpCard>
      <HelpCard title="Not searched yet" icon="ti-search-off">
        <WarningList items={["files", "JSON values", "formula values", "lookup and rollup values"]} />
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
      <Rule title="Views">Search respects the current view. If the view filters records out, search will not bring them back.</Rule>
    </RuleStack>
  </div>
);

const DashboardTab = () => (
  <div class="space-y-4">
    <HelpGrid>
      <HelpCard title="Widgets" icon="ti-layout-grid">
        Stat widgets show one number. Chart widgets need a grouped view. Embedded views show records. Markdown explains what users see.
      </HelpCard>
      <HelpCard title="Links" icon="ti-external-link">
        Links can target a table, view, form, dashboard, or external URL. Internal links open in Grids. External URLs open in a new tab.
      </HelpCard>
      <HelpCard title="Forms on dashboards" icon="ti-forms">
        Embedded forms are still real forms. The dashboard can show the widget, but submit checks the form and target table permissions.
      </HelpCard>
      <HelpCard title="Permissions" icon="ti-lock">
        Dashboard access controls what is included on the dashboard. Links, full view opens, form submits, and record writes use the target
        resource access.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Choosing a chart">
        Donut shows parts of one total. Bar compares categories. Line shows a value over an ordered category, such as month. Scatter needs
        two numeric fields.
      </Rule>
      <Rule title="Chart source">
        Build the source view first. Add Group by for labels and Aggregation for values. If a view is not chart-ready, it should not appear
        as a chart source.
      </Rule>
      <Rule title="Dashboard notes">
        Use Markdown widgets for instructions, data definitions, and owner notes. If the backend must enforce a rule, model it as field
        validation, permissions, or automation.
      </Rule>
    </RuleStack>
  </div>
);

const OperationsTab = () => (
  <div class="space-y-4">
    <HelpGrid>
      <HelpCard title="Exports" icon="ti-download">
        Export uses the same server-side query as the current table or view. It matches the current result, not stale browser state.
      </HelpCard>
      <HelpCard title="Automations" icon="ti-bolt">
        Automations run after configured record events and can call webhooks. Keep each one focused so retries and failures stay readable.
      </HelpCard>
      <HelpCard title="Files" icon="ti-paperclip">
        File fields attach files to records. Metadata belongs in fields when users need to filter, search, aggregate, or export it.
      </HelpCard>
      <HelpCard title="Edit mode" icon="ti-tool">
        Edit mode exposes structural controls. Leave it when entering records, reviewing dashboards, or sharing links with non-admin users.
      </HelpCard>
    </HelpGrid>
    <RuleStack>
      <Rule title="Export scope">
        Export from a filtered view when you want that saved subset. Export from the table when you want the broader table result.
      </Rule>
      <Rule title="Automation safety">
        Webhooks should be safe to retry when possible. A retry must not create duplicate invoices, messages, or external records.
      </Rule>
      <Rule title="After structural edits">
        If a dashboard or chart depends on a view, changing grouping or aggregation can change the widget output immediately.
      </Rule>
    </RuleStack>
  </div>
);

export default function GridsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="grids-start"
        title="Start: Grids"
        icon="ti ti-layout-grid"
        description="Bases, tables, views, forms, and dashboards."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="grids-tables-fields"
        title="Tables & Fields"
        icon="ti ti-table"
        description="Records, fields, relations, selects, Markdown, and formulas."
        order={110}
      >
        <TablesTab />
      </Layout.Help>
      <Layout.Help
        id="grids-views-query"
        title="Views & Query"
        icon="ti ti-filter"
        description="Columns, filters, sort, group, aggregate, and chart-ready views."
        order={120}
      >
        <ViewsTab />
      </Layout.Help>
      <Layout.Help id="grids-search" title="Search" icon="ti ti-search" description="What record search includes and excludes." order={130}>
        <SearchTab />
      </Layout.Help>
      <Layout.Help
        id="grids-dashboards-forms"
        title="Dashboards & Forms"
        icon="ti ti-layout-dashboard"
        description="Widgets, links, embedded forms, and permissions."
        order={140}
      >
        <DashboardTab />
      </Layout.Help>
      <Layout.Help
        id="grids-operations"
        title="Operations"
        icon="ti ti-bolt"
        description="Exports, automations, files, and edit mode."
        order={150}
      >
        <OperationsTab />
      </Layout.Help>
    </>
  );
}
