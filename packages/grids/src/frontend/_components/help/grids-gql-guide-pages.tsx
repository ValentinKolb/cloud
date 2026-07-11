import { DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import { GridsDocPage, QuerySnippet } from "./grids-help-content";

type Example = {
  title: string;
  description: string;
  code: string;
};

export const GQL_EXAMPLES: Example[] = [
  {
    title: "Open work",
    description: "A normal filtered table view.",
    code: `from table Tasks
select Name, Status, Due
where Status = 'Open'
sort Due asc
limit 50`,
  },
  {
    title: "Monthly chart source",
    description: "A grouped view that can feed a chart.",
    code: `from table Orders
group by "Ordered at" by month
aggregate sum("Line total") as revenue
sort "Ordered at" asc`,
  },
  {
    title: "Computed output",
    description: "A temporary computed column in a query result.",
    code: `from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price > 0
limit 20`,
  },
  {
    title: "Readable names",
    description: "Quote labels with spaces. Keep text values in single quotes.",
    code: `from table "Line Items"
select "Item name", "Net amount"
where "Approval status" = 'Approved'
sort "Net amount" desc`,
  },
];
export const GridsGqlExamplesPage = (props: { catalogExample?: string }) => (
  <GridsDocPage>
    <DocLead>
      These examples show common GQL shapes. Copy one, replace source and field names with the names from your base, then preview before
      saving.
    </DocLead>

    <Show when={props.catalogExample}>
      {(catalogExample) => (
        <DocSection title="For this base">
          <QuerySnippet title="Generated from the first table" code={catalogExample()} />
        </DocSection>
      )}
    </Show>

    <DocSection title="GQL patterns">
      <div class="space-y-3">
        <For each={GQL_EXAMPLES}>
          {(example) => (
            <div class="space-y-1">
              <p class="font-semibold text-primary">{example.title}</p>
              <p class="text-sm text-dimmed">{example.description}</p>
              <QuerySnippet code={example.code} />
            </div>
          )}
        </For>
      </div>
    </DocSection>

    <DocSection title="Formula patterns">
      <div class="space-y-3">
        <QuerySnippet
          title="Formula-only output"
          code={`from table Products\nselect Name, formula(Price - Cost) as margin\nsort margin desc`}
        />
        <QuerySnippet title="Formula predicate" code={`from table Products\nwhere Price - Cost > 0\nselect Name, Price, Cost`} />
      </div>
    </DocSection>
  </GridsDocPage>
);

export const GridsGqlHowItWorksPage = () => (
  <GridsDocPage>
    <DocLead>
      GQL is compiled, permission-checked, and executed on the server. This page explains the mechanics for people who need to reason about
      correctness, access, and performance.
    </DocLead>

    <DocSection title="Execution model">
      <DocRows
        items={[
          {
            title: "Parse",
            icon: "ti-code",
            text: "GQL text is parsed into a small known set of clauses. Unknown syntax fails before any data is read.",
          },
          {
            title: "Resolve",
            icon: "ti-sitemap",
            text: "Names, ids, aliases, relations, formulas, groups, and aggregations resolve against the visible base schema.",
          },
          {
            title: "Check permissions",
            icon: "ti-lock",
            text: "Sources, joins, relation targets, and view sources are checked before execution.",
          },
          {
            title: "Compile to SQL",
            icon: "ti-database",
            text: "Supported queries compile to SQL. Grids does not use browser-side aggregation to make a query work.",
          },
          {
            title: "Preview or save",
            icon: "ti-eye",
            text: "The query workspace can preview advanced shapes. Compatible row and grouped queries can be saved as views.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Limits and defaults">
      <DocRows
        items={[
          {
            title: "Omitted select",
            icon: "ti-columns",
            text: "Missing select means all source fields. Saved views are clearer when important fields are explicit.",
          },
          {
            title: "Result bounds",
            icon: "ti-list-numbers",
            text: "Limit large results. Document templates are capped so one template cannot load unbounded data.",
          },
          {
            title: "Sort before paging",
            icon: "ti-sort-ascending",
            text: "Sort first, then offset, then limit. Without sort, paging is not meaningful because source order can change.",
          },
          {
            title: "Errors",
            icon: "ti-alert-circle",
            text: "Parser, resolver, and compiler errors should be shown instead of silently falling back to a different interpretation.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="One source of truth" variant="tip">
      The visual query controls and the GQL editor are different ways to describe server-side query behavior. The database remains the place
      where filtering, sorting, grouping, joins, and aggregations happen.
    </DocNote>
  </GridsDocPage>
);
