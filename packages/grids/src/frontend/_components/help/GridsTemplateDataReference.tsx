import { DocInlineCode, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export function GridsTemplateDataReference() {
  return (
    <DocSection title="Use data in Liquid">
      <p class="text-dimmed">
        The Data tab is the source of truth for the current preview record. It shows the exact shape Liquid receives after the GQL source
        has run. Copy paths from this tree instead of guessing object shapes.
      </p>
      <p class="mt-3 text-dimmed">
        Think of the data in layers: <DocInlineCode>record</DocInlineCode> is the selected record, <DocInlineCode>rows</DocInlineCode> and{" "}
        <DocInlineCode>columns</DocInlineCode> are the GQL result, and <DocInlineCode>document</DocInlineCode> describes a saved run.{" "}
        <DocInlineCode>template</DocInlineCode>, <DocInlineCode>run</DocInlineCode>, and <DocInlineCode>date</DocInlineCode> provide stable
        metadata for numbers and filenames. <DocInlineCode>app</DocInlineCode> contains public platform branding.{" "}
        <DocInlineCode>business</DocInlineCode> contains the base's document profile. Rows also expose GQL output labels, so readable
        aliases make templates easier to maintain.
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
            title: "template, run, date",
            icon: "ti-hash",
            text: (
              <>
                Stable metadata for patterns and document copy: <DocInlineCode>{"{{ template.name }}"}</DocInlineCode>,{" "}
                <DocInlineCode>{"{{ template.shortId }}"}</DocInlineCode>, <DocInlineCode>{"{{ run.shortId }}"}</DocInlineCode>,{" "}
                <DocInlineCode>{"{{ date.iso }}"}</DocInlineCode>, and <DocInlineCode>{"{{ date.yyyyMMdd }}"}</DocInlineCode>. Draft
                previews use draft run values until a saved run exists.
              </>
            ),
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
                <DocInlineCode>{"{{ business.paymentTerms }}"}</DocInlineCode>, <DocInlineCode>{"{{ business.iban }}"}</DocInlineCode>, and
                footer/contact fields. Edit them in Base settings → Documents.
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
                <DocInlineCode>{"{{ document.generatedAt }}"}</DocInlineCode>. Use it in filenames and body/header/footer HTML after the
                number pattern has rendered. Draft previews may not have final values yet.
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
  );
}
