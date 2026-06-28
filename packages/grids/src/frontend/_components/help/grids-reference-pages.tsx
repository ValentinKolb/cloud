import { DocCode, DocInlineCode, DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import { BARCODE_SYMBOL_IDS, CURATED_BARCODE_OPTIONS } from "../table/barcode-options";
import { GridsDocPage, QuerySnippet, RecipeRows, StepList, TemplateSnippet } from "./grids-help-content";

type Example = {
  title: string;
  description: string;
  code: string;
};

const assistantFileHref = (baseId: string, file: "SKILL.md" | "context.md") =>
  `/api/grids/gql/by-base/${encodeURIComponent(baseId)}/assistant/${file}`;
const liquidTags = [
  "if",
  "elsif",
  "else",
  "endif",
  "unless",
  "endunless",
  "for",
  "break",
  "continue",
  "endfor",
  "case",
  "when",
  "endcase",
  "assign",
  "capture",
  "endcapture",
  "comment",
  "endcomment",
  "raw",
  "endraw",
];
const curatedBarcodeIdSet = new Set(CURATED_BARCODE_OPTIONS.map((option) => option.id));
const advancedBarcodeIds = BARCODE_SYMBOL_IDS.filter((id) => !curatedBarcodeIdSet.has(id));
const templateStarters = [
  "Invoice",
  "Loan agreement",
  "Label",
  "QR label",
  "Overview report",
  "Record detail",
  "Delivery note",
  "Quote",
  "Packing list",
  "Certificate",
  "Checklist",
  "Badge / name tag",
];

export const GridsTemplatesPage = (props: { mode?: "guide" | "reference" } = {}) => {
  const showReference = () => props.mode !== "guide";

  return (
    <GridsDocPage>
      <DocLead>
        Document templates turn table records into repeatable PDFs. Use them for invoices, contracts, labels, certificates, delivery notes,
        quotes, packing lists, checklists, and record summaries.
      </DocLead>

      <DocSection title="Mental model">
        <p class="text-dimmed">
          A template belongs to one table and describes one document family for records in that table. The selected preview record gives the
          template its current-record context. GQL decides which rows and columns the document can use. Liquid decides how those values
          become HTML. Gotenberg turns that HTML into a PDF.
        </p>
        <p class="mt-3 text-dimmed">
          Use a template when the output must be generated from saved record data, redownloaded later, or backed by a snapshot. Use a normal
          export when you only need a data file.
        </p>
        <p class="mt-3 text-dimmed">
          The useful split is data first, layout second. If the document needs fewer rows, related rows, totals, or a defined sort order,
          express that in GQL. If the document needs different wording, tables, page breaks, letterheads, labels, barcodes, or conditions,
          express that in Liquid HTML and CSS.
        </p>
      </DocSection>

      <DocSection title="How generation works">
        <p class="text-dimmed">
          Generation starts from a selected record. Grids renders the template's GQL source with Liquid, runs that GQL on the server,
          renders the body, header, footer, and page CSS with the returned data, then sends the HTML to Gotenberg for PDF rendering. A saved
          generation creates a bounded record snapshot and a document run with a stable document number.
        </p>
        <DocCode
          title="Pipeline"
          code={`selected record
  -> render Liquid in the GQL source
  -> run GQL in SQL
  -> render body/header/footer/page CSS with Liquid
  -> Gotenberg HTML-to-PDF
  -> store snapshot + document run metadata`}
          copy
        />
      </DocSection>

      <DocSection title="Create and preview">
        <p class="mb-4 text-dimmed">
          Most templates start from a starter, then get narrowed to the record and related data the document should print. Use the preview
          record as an anchor: it lets the editor show the exact rendered GQL, the exact data tree, and the PDF output for the same record.
        </p>
        <StepList
          items={[
            {
              title: "Open templates",
              text: "Open the table in edit mode and choose Templates. Templates belong to the table they generate documents for.",
            },
            {
              title: "Start from a starter",
              text: "Pick a starter such as Invoice, Loan agreement, Label, QR label, Overview, Record detail, Quote, Packing list, or Checklist.",
            },
            {
              title: "Choose a preview record",
              text: "The preview record supplies the current record context. The Data tab then shows the exact variables available to Liquid.",
            },
            {
              title: "Adjust the GQL source",
              text: "Keep the default source for single-record PDFs. Add joins, selects, grouping, or broader sources when the document needs related or batch data.",
            },
            {
              title: "Edit the HTML parts",
              text: "Body, header, footer, and page CSS are separate so multipage business documents can keep stable letterheads and page numbers.",
            },
            {
              title: "Render before saving",
              text: "Use the PDF preview and open-in-new-tab action for layout checks. New templates start disabled, and enabling a draft without a successful preview asks for confirmation.",
            },
          ]}
        />
      </DocSection>

      <Show when={showReference()}>
        <>
          <DocSection title="Starters">
            <p class="text-dimmed">
              Starters are editable templates, not fixed document types. Pick the closest structure, then change the GQL source and Liquid
              parts until the generated PDF matches the records in the table.
            </p>
            <div class="paper mt-3 p-4">
              <div class="flex flex-wrap gap-2">
                <For each={templateStarters}>{(name) => <DocInlineCode>{name}</DocInlineCode>}</For>
              </div>
            </div>
          </DocSection>

          <DocSection title="Editable parts">
            <p class="mb-3 text-dimmed">
              A template has one data part and up to four layout parts. The GQL source is rendered with Liquid first, so it can use the
              selected <DocInlineCode>record</DocInlineCode>, public <DocInlineCode>app</DocInlineCode>, and base{" "}
              <DocInlineCode>business</DocInlineCode> values before the query is parsed.
            </p>
            <div class="paper overflow-auto">
              <table class="min-w-[900px] w-full table-fixed text-sm">
                <colgroup>
                  <col class="w-[16%]" />
                  <col class="w-[18%]" />
                  <col class="w-[34%]" />
                  <col class="w-[32%]" />
                </colgroup>
                <thead class="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-dimmed dark:bg-zinc-950">
                  <tr class="border-b border-zinc-100 dark:border-zinc-800">
                    <th class="px-4 py-2 text-left font-medium">Part</th>
                    <th class="px-4 py-2 text-left font-medium">Language</th>
                    <th class="px-4 py-2 text-left font-medium">Purpose</th>
                    <th class="px-4 py-2 text-left font-medium">Common use</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <tr>
                    <td class="px-4 py-3 align-top font-semibold text-primary">GQL source</td>
                    <td class="px-4 py-3 align-top text-dimmed">Liquid + GQL</td>
                    <td class="px-4 py-3 align-top text-dimmed">
                      Selects the rows and columns available to the document. Liquid is rendered before GQL is parsed.
                    </td>
                    <td class="px-4 py-3 align-top text-dimmed">Current record, joined rows, item lists, grouped summaries.</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 align-top font-semibold text-primary">Body</td>
                    <td class="px-4 py-3 align-top text-dimmed">Liquid + HTML</td>
                    <td class="px-4 py-3 align-top text-dimmed">The main printable document content. This part is required.</td>
                    <td class="px-4 py-3 align-top text-dimmed">Invoice body, contract clauses, label layout, record detail tables.</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 align-top font-semibold text-primary">Header</td>
                    <td class="px-4 py-3 align-top text-dimmed">Liquid + HTML</td>
                    <td class="px-4 py-3 align-top text-dimmed">Optional Gotenberg header rendered on each page.</td>
                    <td class="px-4 py-3 align-top text-dimmed">Letterhead, sender identity, document class, contact block.</td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 align-top font-semibold text-primary">Footer</td>
                    <td class="px-4 py-3 align-top text-dimmed">Liquid + HTML</td>
                    <td class="px-4 py-3 align-top text-dimmed">Optional Gotenberg footer rendered on each page.</td>
                    <td class="px-4 py-3 align-top text-dimmed">
                      Legal footer, bank data, page numbers with <DocInlineCode>pageNumber</DocInlineCode> and{" "}
                      <DocInlineCode>totalPages</DocInlineCode>.
                    </td>
                  </tr>
                  <tr>
                    <td class="px-4 py-3 align-top font-semibold text-primary">Page CSS</td>
                    <td class="px-4 py-3 align-top text-dimmed">Liquid + CSS</td>
                    <td class="px-4 py-3 align-top text-dimmed">Optional CSS injected into the PDF body document.</td>
                    <td class="px-4 py-3 align-top text-dimmed">@page size/margins, table headers, page breaks, print typography.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DocSection>
        </>
      </Show>

      <DocSection title="Use data in Liquid">
        <p class="text-dimmed">
          The Data tab is the source of truth for the current preview record. It shows the exact shape Liquid receives after the GQL source
          has run. Copy paths from this tree instead of guessing object shapes.
        </p>
        <p class="mt-3 text-dimmed">
          Think of the data in layers: <DocInlineCode>record</DocInlineCode> is the selected record, <DocInlineCode>rows</DocInlineCode> and{" "}
          <DocInlineCode>columns</DocInlineCode> are the GQL result, and <DocInlineCode>document</DocInlineCode> describes a saved run.{" "}
          <DocInlineCode>app</DocInlineCode> contains public platform branding. <DocInlineCode>business</DocInlineCode> contains the base's
          document profile. Rows also expose GQL output labels, so readable aliases make templates easier to maintain.
        </p>
        <DocRows
          items={[
            {
              title: "record",
              icon: "ti-record-mail",
              text: (
                <>
                  The current record: <DocInlineCode>{"record.id"}</DocInlineCode>, <DocInlineCode>{"record.tableId"}</DocInlineCode>,{" "}
                  <DocInlineCode>{"record.version"}</DocInlineCode>, <DocInlineCode>{"record.data"}</DocInlineCode>, created and updated
                  timestamps.
                </>
              ),
            },
            {
              title: "rows and columns",
              icon: "ti-list-details",
              text: "The rows and columns returned by the GQL source. Use column.key for row access and column.label for human-readable headers.",
            },
            {
              title: "app",
              icon: "ti-building",
              text: (
                <>
                  Public platform values for document branding: <DocInlineCode>{"{{ app.name }}"}</DocInlineCode>,{" "}
                  <DocInlineCode>{"{{ app.contactEmail }}"}</DocInlineCode>, <DocInlineCode>{"{{ app.url }}"}</DocInlineCode>,{" "}
                  <DocInlineCode>{"{{ app.logoDataUri }}"}</DocInlineCode>, and <DocInlineCode>{"{{ app.timezone }}"}</DocInlineCode>.
                </>
              ),
            },
            {
              title: "business",
              icon: "ti-briefcase",
              text: (
                <>
                  Base-level document profile values such as <DocInlineCode>{"{{ business.legalName }}"}</DocInlineCode>,{" "}
                  <DocInlineCode>{"{{ business.senderLine }}"}</DocInlineCode>, <DocInlineCode>{"{{ business.address }}"}</DocInlineCode>,{" "}
                  <DocInlineCode>{"{{ business.paymentTerms }}"}</DocInlineCode>, <DocInlineCode>{"{{ business.iban }}"}</DocInlineCode>,
                  and footer/contact fields. Edit them in Base settings → Documents.
                </>
              ),
            },
            {
              title: "images",
              icon: "ti-photo",
              text: (
                <>
                  Image files attached to file fields on the selected record. Use <DocInlineCode>{"{{ primaryImage.url }}"}</DocInlineCode>{" "}
                  for the first supported image or loop over <DocInlineCode>images</DocInlineCode>. Oversized and unsupported files are
                  omitted.
                </>
              ),
            },
            {
              title: "document",
              icon: "ti-file-description",
              text: (
                <>
                  Generated document metadata such as <DocInlineCode>{"{{ document.number }}"}</DocInlineCode> and{" "}
                  <DocInlineCode>{"{{ document.generatedAt }}"}</DocInlineCode>. Draft previews may not have final values yet.
                </>
              ),
            },
            {
              title: "snapshot",
              icon: "ti-camera",
              text: "The captured record graph for generated runs. It is null in live draft previews before a run exists.",
            },
            {
              title: "barcode_data_url",
              icon: "ti-barcode",
              text: "A Grids Liquid filter for labels and badges. It returns an SVG data URL for QR codes and supported BWIP barcode symbols.",
            },
          ]}
        />
      </DocSection>

      <Show when={showReference()}>
        <>
          <DocSection title="GQL source patterns">
            <p class="text-dimmed">
              Keep filtering, sorting, joins, grouping, and limits in GQL so the database does the work. Keep Liquid focused on
              presentation.
            </p>
            <div class="mt-3 space-y-3">
              <QuerySnippet
                title="Current record only"
                code={`from table Invoices
where record.id = '{{ record.id }}'
limit 1`}
              />
              <QuerySnippet
                title="Current record with related item names"
                code={`from table Loans
left join table Items as item on Items = item.id
select "Loan number", Borrower, item.Name as item_name, item.Condition as item_condition
where record.id = '{{ record.id }}'
sort item.Name asc`}
              />
              <QuerySnippet
                title="Batch or checklist"
                code={`from table Items
select Name, Status, Location
where Status = 'Ready'
sort Name asc
limit 100`}
              />
            </div>
          </DocSection>

          <DocSection title="Liquid reference">
            <p class="text-dimmed">
              Template parts use LiquidJS with Grids restrictions: strict variables, strict filters, escaped output, no layouts, no dynamic
              partials, and only the tags listed below. Unknown filters, invalid tags, and oversized output fail instead of rendering a
              partial document.
            </p>
            <DocRows
              items={[
                {
                  title: "Output",
                  icon: "ti-braces",
                  text: (
                    <span>
                      Use <DocInlineCode>{"{{ value }}"}</DocInlineCode> to print a value. Output is HTML-escaped by default. Use{" "}
                      <DocInlineCode>{"| raw"}</DocInlineCode> only when a trusted template intentionally prints HTML.
                    </span>
                  ),
                },
                {
                  title: "Filters",
                  icon: "ti-filter",
                  text: (
                    <span>
                      Pipe values through filters, for example <DocInlineCode>{"{{ row.Name | default: '-' }}"}</DocInlineCode>. Unknown
                      filters fail.
                    </span>
                  ),
                },
                {
                  title: "Conditions",
                  icon: "ti-binary-tree",
                  text: (
                    <span>
                      Use <DocInlineCode>{"{% if row.Status == 'Open' %}"}</DocInlineCode>, <DocInlineCode>elsif</DocInlineCode>,{" "}
                      <DocInlineCode>else</DocInlineCode>, and <DocInlineCode>endif</DocInlineCode>.
                    </span>
                  ),
                },
                {
                  title: "Loops",
                  icon: "ti-repeat",
                  text: (
                    <span>
                      Use <DocInlineCode>{"{% for row in rows %}"}</DocInlineCode> and <DocInlineCode>{"{% endfor %}"}</DocInlineCode>.
                      Break and continue are allowed.
                    </span>
                  ),
                },
                {
                  title: "Temporary values",
                  icon: "ti-variable",
                  text: (
                    <span>
                      Use <DocInlineCode>assign</DocInlineCode> for short values and <DocInlineCode>capture</DocInlineCode> for longer
                      rendered fragments.
                    </span>
                  ),
                },
                {
                  title: "No external partials",
                  icon: "ti-shield-lock",
                  text: "Include, render, layout, and external partial tags are not allowed. A template must be self-contained.",
                },
              ]}
            />
            <div class="paper mt-3 p-4">
              <p class="mb-3 text-sm font-semibold text-primary">Allowed tags</p>
              <div class="flex flex-wrap gap-2">
                <For each={liquidTags}>{(tag) => <DocInlineCode>{tag}</DocInlineCode>}</For>
              </div>
            </div>
          </DocSection>

          <DocSection title="Barcodes and QR codes">
            <p class="text-dimmed">
              Use the <DocInlineCode>barcode_data_url</DocInlineCode> filter in an <DocInlineCode>{"<img>"}</DocInlineCode> tag. Barcode ids
              are lowercase symbols. The optional third argument controls human-readable text for barcode formats that support it.
            </p>
            <div class="mt-3 grid gap-3 xl:grid-cols-2">
              <TemplateSnippet
                title="Code 128 with text"
                code={`{% assign first = rows[0] %}
{% assign codeColumn = columns[0] %}
<img src='{{ first[codeColumn.key] | barcode_data_url: "code128", true }}' alt="Asset barcode">`}
              />
              <TemplateSnippet
                title="QR code"
                code={`<img src='{{ document.number | default: table.name | barcode_data_url: "qrcode" }}' alt="Document QR code">`}
              />
            </div>
            <div class="paper mt-3 overflow-auto">
              <table class="min-w-[780px] w-full table-fixed text-sm">
                <colgroup>
                  <col class="w-[18%]" />
                  <col class="w-[22%]" />
                  <col />
                </colgroup>
                <thead class="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-dimmed dark:bg-zinc-950">
                  <tr class="border-b border-zinc-100 dark:border-zinc-800">
                    <th class="px-4 py-2 text-left font-medium">Type id</th>
                    <th class="px-4 py-2 text-left font-medium">Label</th>
                    <th class="px-4 py-2 text-left font-medium">Use</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <For each={CURATED_BARCODE_OPTIONS}>
                    {(option) => (
                      <tr>
                        <td class="px-4 py-3 align-top">
                          <DocInlineCode>{option.id}</DocInlineCode>
                        </td>
                        <td class="px-4 py-3 align-top font-semibold text-primary">{option.label}</td>
                        <td class="px-4 py-3 align-top text-dimmed">{option.description}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="paper mt-3 p-4">
              <p class="mb-3 text-sm font-semibold text-primary">Additional BWIP symbol ids</p>
              <div class="flex flex-wrap gap-2">
                <For each={advancedBarcodeIds}>{(id) => <DocInlineCode>{id}</DocInlineCode>}</For>
              </div>
            </div>
          </DocSection>

          <DocSection title="Liquid patterns">
            <div class="grid gap-3 xl:grid-cols-2">
              <TemplateSnippet
                title="Loop over query rows"
                code={`<table>
  <tbody>
    {% for row in rows %}
      <tr>
        <td>{{ row.Name }}</td>
        <td>{{ row.Status | default: "-" }}</td>
      </tr>
    {% endfor %}
  </tbody>
</table>`}
              />
              <TemplateSnippet
                title="Generic column table"
                code={`<table>
  <thead>
    <tr>
      {% for column in columns %}
        <th>{{ column.label }}</th>
      {% endfor %}
    </tr>
  </thead>
  <tbody>
    {% for row in rows %}
      <tr>
        {% for column in columns %}
          <td>{{ row[column.key] | default: "-" }}</td>
        {% endfor %}
      </tr>
    {% endfor %}
  </tbody>
</table>`}
              />
              <TemplateSnippet
                title="Code 128 barcode"
                code={`{% assign first = rows[0] %}
{% assign codeColumn = columns[0] %}
<img alt="Asset barcode" src='{{ first[codeColumn.key] | barcode_data_url: "code128", true }}'>`}
              />
              <TemplateSnippet
                title="QR code"
                code={`<img alt="Record QR code" src='{{ document.number | default: table.name | barcode_data_url: "qrcode" }}'>`}
              />
            </div>
          </DocSection>
        </>
      </Show>

      <DocSection title="Preview, data, source">
        <DocRows
          items={[
            {
              title: "Preview",
              icon: "ti-file-type-pdf",
              text: "Renders the current unsaved draft as a PDF. Use Open preview for full-screen inspection.",
            },
            {
              title: "Data",
              icon: "ti-list-tree",
              text: "Shows the exact Liquid paths for the selected preview record. Copy paths from here instead of guessing object shapes.",
            },
            {
              title: "Source",
              icon: "ti-code",
              text: "Shows the rendered GQL source after Liquid variables have been substituted. Use it to debug current-record filters.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Snapshots and runs">
        <p class="text-dimmed">
          Generating a PDF creates a recursive snapshot of the root record and related records reached through relation fields. Snapshot
          traversal is bounded to depth 4 and 500 records. The run stores the template snapshot, render data, stable document number, and
          generation timestamp. PDF bytes are regenerated on download from the stored run data.
        </p>
        <DocRows
          items={[
            {
              title: "Document numbers",
              icon: "ti-hash",
              text: "Each run receives a generated document number. Use it in business-facing documents instead of internal UUIDs.",
            },
            {
              title: "Template edits",
              icon: "ti-history",
              text: "Changing a template affects future generations. Existing runs redownload from the template snapshot and data captured for that run.",
            },
            {
              title: "Manual snapshots",
              icon: "ti-camera",
              text: "The record detail panel also has a Snapshot button for capturing a record state without generating a PDF.",
            },
            {
              title: "Deleted templates",
              icon: "ti-file-time",
              text: "Deleting a template removes it from the active list, but existing generated documents remain available through their runs.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Common issues">
        <RecipeRows
          items={[
            { problem: "Invalid GQL source", use: "Open the Source tab. It shows the GQL after Liquid variables were substituted." },
            { problem: "Missing Liquid variable", use: "Choose a preview record, open Data, then copy the exact path from the tree." },
            { problem: "Empty document rows", use: "Check the GQL source filter and confirm the selected preview record matches it." },
            { problem: "Barcode does not render", use: "Check the barcode type and input value. Empty input returns an empty data URL." },
            {
              problem: "Multipage layout breaks",
              use: "Move repeated content to header/footer, set @page margins, and preview with enough rows.",
            },
          ]}
        />
      </DocSection>

      <DocNote title="Use GQL for data, Liquid for layout" variant="tip">
        Keep filtering, sorting, joins, and grouping in GQL. Keep Liquid focused on loops, conditions, text, tables, images, barcodes,
        headers, footers, and CSS.
      </DocNote>
    </GridsDocPage>
  );
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
            text: "Calculate count, countEmpty, countUnique, sum, avg, min, max, median, earliest, or latest.",
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
            text: "Bound the result. Limit accepts 1..10000; offset accepts 0..10000. Sort before using offset so paging is meaningful.",
          },
          {
            title: "include deleted / deleted only",
            icon: "ti-trash",
            text: "Opt into deleted records. The two clauses are mutually exclusive.",
          },
        ]}
      />
    </DocSection>

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
