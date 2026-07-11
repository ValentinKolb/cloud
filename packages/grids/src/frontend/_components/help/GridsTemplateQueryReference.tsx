import { DocInlineCode, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { QuerySnippet, TemplateSnippet } from "./grids-help-content";

export function GridsTemplateQueryReference() {
  return (
    <>
      <DocSection title="GQL source patterns">
        <p class="text-dimmed">
          Keep filtering, sorting, joins, grouping, and limits in GQL so the database does the work. Keep Liquid focused on presentation.
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
          rendered first. The filename pattern can then use <DocInlineCode>{"{{ document.number }}"}</DocInlineCode>. This keeps business
          identifiers separate from the downloadable file name.
        </p>
        <p class="mt-3 text-dimmed">
          The default number pattern is non-sequential and collision-resistant:{" "}
          <DocInlineCode>{"{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}"}</DocInlineCode>. It avoids internal UUIDs and
          avoids app-wide prefixes. If a business process needs legally consecutive invoice numbers, model that as a dedicated generated-id
          field or a later sequence-backed numbering mode instead of hand-writing counters in Liquid.
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
    </>
  );
}
