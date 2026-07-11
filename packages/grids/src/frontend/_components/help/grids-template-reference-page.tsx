import { DocCode, DocInlineCode, DocLead, DocNote, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For, Show } from "solid-js";
import { GridsTemplateDataReference } from "./GridsTemplateDataReference";
import { GridsTemplateLanguageReference } from "./GridsTemplateLanguageReference";
import { GridsTemplateQueryReference } from "./GridsTemplateQueryReference";
import { GridsDocPage, RecipeRows, StepList } from "./grids-help-content";

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
          <GridsTemplateQueryReference />
          <GridsTemplateLanguageReference />
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
