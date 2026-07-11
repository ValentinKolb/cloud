import { DocCode, DocInlineCode, DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import { BARCODE_SYMBOL_IDS, CURATED_BARCODE_OPTIONS } from "../table/barcode-options";
import { GridsTemplateDataReference } from "./GridsTemplateDataReference";
import { GridsDocPage, QuerySnippet, RecipeRows, StepList, TemplateSnippet } from "./grids-help-content";

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

      <DocSection title="How templates work">
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

      <GridsTemplateDataReference />

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

          <DocSection title="Numbers and filenames">
            <p class="text-dimmed">
              A generated document has a stable <DocInlineCode>document.number</DocInlineCode> and a PDF filename. The number pattern is
              rendered first. The filename pattern can then use <DocInlineCode>{"{{ document.number }}"}</DocInlineCode>. This keeps
              business identifiers separate from the downloadable file name.
            </p>
            <p class="mt-3 text-dimmed">
              The default number pattern is non-sequential and collision-resistant:{" "}
              <DocInlineCode>{"{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}"}</DocInlineCode>. It avoids internal UUIDs and
              avoids app-wide prefixes. If a business process needs legally consecutive invoice numbers, model that as a dedicated
              generated-id field or a later sequence-backed numbering mode instead of hand-writing counters in Liquid.
            </p>
            <div class="mt-3 grid gap-3 xl:grid-cols-2">
              <TemplateSnippet title="Default number" code={`{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}`} />
              <TemplateSnippet title="Default filename" code={`{{ document.number }}.pdf`} />
              <TemplateSnippet title="Business-style number" code={`INV-{{ date.yyyy }}-{{ run.shortId }}`} />
              <TemplateSnippet
                title="Readable filename"
                code={`invoice-{{ record.data.Name | default: document.number }}-{{ document.number }}.pdf`}
              />
            </div>
            <DocRows
              items={[
                {
                  title: "Number pattern context",
                  icon: "ti-hash",
                  text: (
                    <>
                      May use <DocInlineCode>record</DocInlineCode>, <DocInlineCode>table</DocInlineCode>,{" "}
                      <DocInlineCode>template</DocInlineCode>, <DocInlineCode>run</DocInlineCode>, <DocInlineCode>date</DocInlineCode>,{" "}
                      <DocInlineCode>app</DocInlineCode>, and <DocInlineCode>business</DocInlineCode>. It may not use{" "}
                      <DocInlineCode>document</DocInlineCode>, because the document number does not exist yet.
                    </>
                  ),
                },
                {
                  title: "Filename pattern context",
                  icon: "ti-file-text",
                  text: (
                    <>
                      May use the full rendered data tree, including <DocInlineCode>{"{{ document.number }}"}</DocInlineCode>. The final
                      filename is cleaned for filesystem-safe PDF downloads.
                    </>
                  ),
                },
                {
                  title: "Validation",
                  icon: "ti-shield-check",
                  text: "Unknown top-level Liquid variables, invalid tags, unsupported filters, empty patterns, and oversized patterns fail when the template is saved.",
                },
              ]}
            />
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
                code={`{% if rows.size > 0 and columns.size > 0 %}
  {% assign first = rows[0] %}
  {% assign codeColumn = columns[0] %}
  {% assign codeValue = first[codeColumn.key] | default: table.name %}
{% else %}
  {% assign codeValue = table.name %}
{% endif %}
<img src='{{ codeValue | barcode_data_url: "code128", true }}' alt="Asset barcode">`}
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
                code={`{% if rows.size > 0 and columns.size > 0 %}
  {% assign first = rows[0] %}
  {% assign codeColumn = columns[0] %}
  {% assign codeValue = first[codeColumn.key] | default: table.name %}
{% else %}
  {% assign codeValue = table.name %}
{% endif %}
<img alt="Asset barcode" src='{{ codeValue | barcode_data_url: "code128", true }}'>`}
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
              text: "Each run receives a stable document number from the template's number pattern. The number is unique across generated documents.",
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
