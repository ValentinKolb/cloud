import { DocInlineCode, DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { Show } from "solid-js";
import { AGGREGATE_KINDS } from "../../../aggregate-catalog";
import { GridsDocPage, QuerySnippet } from "./grids-help-content";

const aggregateNames = AGGREGATE_KINDS.join(", ");

const assistantFileHref = (baseId: string, file: "SKILL.md" | "context.md") =>
  `/api/grids/gql/by-base/${encodeURIComponent(baseId)}/assistant/${file}`;

export const GridsGqlReferencePage = (props: { baseId?: string }) => (
  <GridsDocPage>
    <DocLead>
      GQL, the Grids Query Language, describes records and summaries in text. Use it for filters, selected fields, sorting, grouping,
      aggregations, joins, document template sources, and reports that are clearer as code than as many dropdown settings.
    </DocLead>

    <Show when={props.baseId}>
      {(baseId) => (
        <DocSection title="AI assistant files">
          <div class="paper flex flex-wrap items-center justify-between gap-3 p-4">
            <div class="min-w-0">
              <h3 class="font-semibold text-primary">Download assistant context</h3>
              <p class="mt-1 text-sm text-dimmed">Use the skill once, then pair it with this base's permission-filtered schema context.</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <a class="btn-input btn-sm" href={assistantFileHref(baseId(), "SKILL.md")} download="SKILL.md">
                <i class="ti ti-download" /> SKILL.md
              </a>
              <a class="btn-input btn-sm" href={assistantFileHref(baseId(), "context.md")} download="context.md">
                <i class="ti ti-download" /> context.md
              </a>
            </div>
          </div>
        </DocSection>
      )}
    </Show>

    <DocSection title="Minimal query">
      <DocRows
        items={[
          {
            title: "Source",
            icon: "ti-table",
            text: (
              <>
                Start with <DocInlineCode>from table Books</DocInlineCode> or <DocInlineCode>from view "Open loans"</DocInlineCode>. On a
                table/view page the source can be implied, but saved queries are easier to review when the source is written down.
              </>
            ),
          },
          {
            title: "All fields by default",
            icon: "ti-columns",
            text: (
              <>
                Omit <DocInlineCode>select</DocInlineCode> to return all source fields. Add <DocInlineCode>select</DocInlineCode> when the
                output should be stable, narrow, or renamed.
              </>
            ),
          },
          {
            title: "Names and values",
            icon: "ti-quote",
            text: (
              <>
                Use double quotes for field names with spaces. Use single quotes for text values.{" "}
                <DocInlineCode>status = 'Open'</DocInlineCode> compares a field to text.
              </>
            ),
          },
        ]}
      />
      <QuerySnippet
        title="Minimal filtered query"
        code={`from table Books
select Title, Author, Published
where Status = 'Available'
sort Published desc
limit 25`}
      />
    </DocSection>

    <DocSection title="Defaults">
      <DocRows
        items={[
          {
            title: "No select",
            icon: "ti-columns",
            text: "All source fields are returned. This is useful while exploring; saved views are clearer when important fields are listed.",
          },
          {
            title: "No alias",
            icon: "ti-tag-off",
            text: "A selected field keeps its field name. Formulas and aggregates need aliases because they do not have a stable field name.",
          },
          {
            title: "No direction",
            icon: "ti-sort-ascending",
            text: "Sort defaults to ascending with nulls last. Write desc when newest, largest, or latest values should come first.",
          },
          { title: "No where", icon: "ti-filter-off", text: "No rows are filtered out. You see every record the source query allows." },
          {
            title: "No sort",
            icon: "ti-arrows-sort",
            text: "The source decides the order. Add sort when order matters, especially before offset.",
          },
          {
            title: "No from on a table page",
            icon: "ti-table",
            text: "The current table or view can be used as the source. Write from explicitly when the query should be portable.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Clause order">
      <p class="text-dimmed">
        GQL reads like a checklist. You do not need every line, but when several lines are present this order is easiest to understand:
      </p>
      <QuerySnippet
        code={`from table ...
join ...
select ...
where ...
search ...
group by ...
aggregate ...
having ...
sort ...
limit ...
offset ...
include deleted | deleted only`}
      />
    </DocSection>

    <DocSection title="Clause reference">
      <DocRows
        items={[
          {
            title: "from",
            icon: "ti-database",
            text: "Choose the source table or view. Add as alias when the same source is joined again or scoped refs should be shorter.",
          },
          {
            title: "join",
            icon: "ti-arrows-join",
            text: "Load related records through relation fields. Use left join for optional relations.",
          },
          {
            title: "select",
            icon: "ti-columns",
            text: "Choose output columns. Use commas for several fields and aliases for readable computed or joined values.",
          },
          {
            title: "where",
            icon: "ti-filter",
            text: "Filter records before grouping. Supports field comparisons, membership, null checks, date helpers, and formulas.",
          },
          {
            title: "search",
            icon: "ti-search",
            text: "Search all searchable source fields, or scope search to specific fields when the query should be narrow.",
          },
          {
            title: "group by",
            icon: "ti-category",
            text: "Turn records into summary rows. Date groups can use buckets such as month when supported by the field.",
          },
          {
            title: "aggregate",
            icon: "ti-sum",
            text: `Calculate ${aggregateNames}.`,
          },
          { title: "having", icon: "ti-filter-cog", text: "Filter grouped rows after aggregation." },
          {
            title: "sort",
            icon: "ti-sort-ascending",
            text: "Sort rows or summaries. Use nulls first/last when missing values need a defined position.",
          },
          {
            title: "limit and offset",
            icon: "ti-list-numbers",
            text: "limit accepts 1..10000 and caps the complete result across cursor pages. offset accepts 0..10000 and skips an initial result window.",
          },
          {
            title: "include deleted / deleted only",
            icon: "ti-trash",
            text: "Opt into deleted records. The two clauses are mutually exclusive.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Result pages" variant="tip">
      The query explorer, saved result views, dashboards, and the CLI execute the same GQL. Page cursors are opaque, signed, and tied to the
      exact query and source. Changing the query starts again at the first page. In the CLI, use <DocInlineCode>--page-size</DocInlineCode>
      for one page or <DocInlineCode>--all --max-rows N</DocInlineCode> for a bounded multi-page read. Pages are live reads, not a database
      snapshot; concurrent record changes can move rows between page requests.
    </DocNote>

    <DocSection title="Names and values">
      <DocRows
        items={[
          { title: "Readable names", icon: "ti-tag", text: "Use table and field names directly when they are unambiguous." },
          {
            title: "Quoted names",
            icon: "ti-quote",
            text: (
              <span>
                Use <DocInlineCode>"Birth year"</DocInlineCode> when a name contains spaces or punctuation.
              </span>
            ),
          },
          {
            title: "Literal text",
            icon: "ti-abc",
            text: (
              <span>
                Use single quotes: <DocInlineCode>Status = 'Open'</DocInlineCode>.
              </span>
            ),
          },
          {
            title: "IDs",
            icon: "ti-id",
            text: "Use brace-wrapped UUIDs only when a generated template or migration needs an immutable reference.",
          },
          {
            title: "Scoped refs",
            icon: "ti-baseline-density-medium",
            text: "Use source or join aliases for clarity after joins, for example customer.Name or o.Total.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Filter patterns">
      <p class="text-dimmed">
        Most filters are field comparisons. Use formulas when the condition itself is calculated. Keep literal text in single quotes so GQL
        does not treat it as another field name.
      </p>
      <div class="mt-3 space-y-3">
        <QuerySnippet
          title="Multiple conditions"
          code={`from table Inventory
where Status = 'Available' and Quantity > 0
sort Name asc`}
        />
        <QuerySnippet
          title="Formula predicate"
          code={`from table Products
where Price <= "Purchase price" * 1.10
select Name, Price, "Purchase price"`}
        />
        <QuerySnippet
          title="Computed result column"
          code={`from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price > 0
sort gross desc`}
        />
      </div>
    </DocSection>

    <DocSection title="Search">
      <p class="text-dimmed">
        Search is a broad text lookup across searchable fields. Use <DocInlineCode>where</DocInlineCode> for exact values, numeric/date
        comparisons, and rules that must not depend on display text.
      </p>
      <div class="mt-3 space-y-3">
        <QuerySnippet
          title="Search all searchable fields"
          code={`from table Books
search 'tolkien'
limit 20`}
        />
        <QuerySnippet
          title="Search selected fields"
          code={`from table Books
join table Authors as author on Author = author.id
search 'kingdom' in Title, author.Country
limit 20`}
        />
      </div>
    </DocSection>

    <DocSection title="Operators and helpers">
      <DocRows
        items={[
          {
            title: "Comparisons",
            icon: "ti-equal",
            text: (
              <span>
                Use <DocInlineCode>=</DocInlineCode>, <DocInlineCode>!=</DocInlineCode>, <DocInlineCode>&gt;</DocInlineCode>,{" "}
                <DocInlineCode>&gt;=</DocInlineCode>, <DocInlineCode>&lt;</DocInlineCode>, and <DocInlineCode>&lt;=</DocInlineCode>.
              </span>
            ),
          },
          {
            title: "Boolean logic",
            icon: "ti-binary-tree",
            text: (
              <span>
                Use <DocInlineCode>and</DocInlineCode>, <DocInlineCode>or</DocInlineCode>, <DocInlineCode>not</DocInlineCode>, and
                parentheses. Do not use <DocInlineCode>AND(...)</DocInlineCode>, <DocInlineCode>OR(...)</DocInlineCode>, or{" "}
                <DocInlineCode>NOT(...)</DocInlineCode>.
              </span>
            ),
          },
          {
            title: "Text helpers",
            icon: "ti-abc",
            text: (
              <span>
                Use <DocInlineCode>contains</DocInlineCode>, <DocInlineCode>startswith</DocInlineCode>,{" "}
                <DocInlineCode>endswith</DocInlineCode>, and their case-insensitive forms <DocInlineCode>icontains</DocInlineCode>,{" "}
                <DocInlineCode>istartswith</DocInlineCode>, and <DocInlineCode>iendswith</DocInlineCode>.
              </span>
            ),
          },
          {
            title: "Membership",
            icon: "ti-list-check",
            text: (
              <span>
                Use <DocInlineCode>oneof(Field, 'a', 'b')</DocInlineCode>, <DocInlineCode>noneof(Field, 'a', 'b')</DocInlineCode>, or{" "}
                <DocInlineCode>containsall(Field, 'a', 'b')</DocInlineCode> for select, multi-value, and relation-style membership checks.
              </span>
            ),
          },
          {
            title: "Nulls and empty values",
            icon: "ti-circle-dashed",
            text: (
              <span>
                Use <DocInlineCode>null</DocInlineCode> in expressions. Add <DocInlineCode>nulls first</DocInlineCode> or{" "}
                <DocInlineCode>nulls last</DocInlineCode> to a sort when missing values need a defined position.
              </span>
            ),
          },
        ]}
      />
    </DocSection>

    <DocSection title="Joins in plain language">
      <p class="text-dimmed">
        A join follows a relation from the source record to another table. The join condition must target the joined record id. For example,
        if Orders has a Customer relation, join Customers through that relation and compare it to <DocInlineCode>customer.id</DocInlineCode>
        {"."}
      </p>
      <QuerySnippet
        title="Join through a relation"
        code={`from table Orders
left join table Customers as customer on Customer = customer.id
select "Order number", customer.Name as customer_name, Total
limit 50`}
      />
    </DocSection>

    <DocSection title="Paging and one-line queries">
      <p class="text-dimmed">
        Line breaks are optional; they make longer queries easier to scan. Use semicolons when several clauses share one physical line. Use{" "}
        <DocInlineCode>-- comment</DocInlineCode> for comments. Always sort before using offset.
      </p>
      <div class="mt-3 space-y-3">
        <QuerySnippet
          title="Same query on one line"
          code={`from table Orders; select "Order no", "Line total"; where Status = 'Paid'; sort "Ordered at" desc; limit 10`}
        />
        <QuerySnippet
          title="Second page of newest orders"
          code={`from table Orders
sort "Ordered at" desc
limit 25
offset 25`}
        />
      </div>
    </DocSection>

    <DocSection title="Grouping and summaries">
      <p class="text-dimmed">
        Grouped queries return summary rows, not editable records. They are useful for dashboards, charts, reports, exports, and document
        templates.
      </p>
      <QuerySnippet
        title="Chart-ready grouped query"
        code={`from table Orders
group by "Ordered at" by month
aggregate sum(Total) as revenue, count(*) as orders
having revenue > 0
sort "Ordered at" asc`}
      />
    </DocSection>

    <DocSection title="Deleted records">
      <p class="text-dimmed">
        Normal queries read live records. Add one deleted-record clause only when the result explicitly needs records from the trash.
      </p>
      <div class="mt-3 space-y-3">
        <QuerySnippet
          title="Live and deleted rows"
          code={`from table Assets
include deleted
sort Name asc
limit 100`}
        />
        <QuerySnippet
          title="Deleted rows only"
          code={`from table Assets
deleted only
sort Name asc
limit 100`}
        />
      </div>
    </DocSection>

    <DocSection title="Interactions and edge cases">
      <DocRows
        items={[
          {
            title: "Permissions",
            icon: "ti-lock",
            text: "A source only runs if the user can read it. Joins and relation targets are checked instead of exposing hidden tables.",
          },
          {
            title: "View sources",
            icon: "ti-filter",
            text: "Row-shaped saved views can be queried as record sources. Summary views are summary tables, not editable record sources.",
          },
          {
            title: "No browser-side work",
            icon: "ti-server",
            text: "Filtering, sorting, joins, grouping, and aggregations must be expressed in GQL so execution stays server-side.",
          },
          {
            title: "Ambiguity",
            icon: "ti-alert-triangle",
            text: "When a source, field, or alias is ambiguous, GQL should fail instead of guessing.",
          },
          {
            title: "Not SQL",
            icon: "ti-ban",
            text: "GQL does not support SQL-style select-from order, arbitrary join predicates, subqueries, CTEs, window functions, or raw SQL expressions.",
          },
          {
            title: "Removed aliases",
            icon: "ti-eraser",
            text: "Use offset instead of skip. Use readable field names, quoted names, scoped refs, or stable ids instead of #field refs.",
          },
        ]}
      />
    </DocSection>
  </GridsDocPage>
);

export { GQL_EXAMPLES, GridsGqlExamplesPage, GridsGqlHowItWorksPage } from "./grids-gql-guide-pages";
export { GridsTemplatesPage } from "./grids-template-reference-page";
