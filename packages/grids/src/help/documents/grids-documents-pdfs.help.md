---
id: grids-documents-pdfs
title: Documents & PDFs
icon: ti ti-file-type-pdf
description: Create, generate, organize, and share PDFs from saved records.
order: 135
---
Document templates turn table records into repeatable PDFs. Use them for invoices, contracts, labels, certificates, delivery notes, quotes, packing lists, checklists, and record summaries.

Each template belongs to one table and defines one document family. A generated document belongs to one selected record, receives a stable number and filename, and keeps a snapshot so it can be reproduced after the live records change.

Use a document template when output must be formatted for people, printed, shared by an expiring link, or redownloaded later. Use CSV or JSON export when you only need data for another system.

## From record to PDF {icon="table"}

The template separates data selection from page layout. **GQL** loads the rows and columns the document may use. **Liquid HTML and CSS** turn those values into wording, tables, conditions, loops, images, barcodes, page breaks, headers, and footers. **Gotenberg** renders the resulting HTML as PDF.

**Pipeline**

```text
selected record
  -> render Liquid in the GQL source
  -> run GQL in SQL
  -> render body/header/footer/page CSS with Liquid
  -> Gotenberg HTML-to-PDF
  -> store snapshot + document run metadata
```

Keep filtering, sorting, joins, grouping, and totals in GQL so they run in the database. Keep Liquid focused on presentation.

## Create your first template {icon="file-description"}

:::steps
1. **Open templates:** Open the table in edit mode and choose Templates. Templates belong to the table they generate documents for.
2. **Choose a starter:** Pick the structure closest to the output you need. Every starter remains fully editable.
3. **Select a preview record:** The same record anchors the rendered GQL, Data tree, and PDF preview.
4. **Inspect before editing:** Source shows the GQL after record values are inserted. Data shows the exact Liquid paths. Preview shows the PDF.
5. **Change one layer at a time:** Adjust GQL when data is wrong; adjust Body, Header, Footer, or Page CSS when layout is wrong.
6. **Preview representative data:** Test long text, missing values, many rows, and page breaks. New templates start disabled.
7. **Enable and share access:** Users with template Write access can then select a record and generate a saved document.
:::

The selected preview record is only test context. Generating later prompts the user to select the actual record and can override the filename or add tags.

## Starters {icon="square-plus"}

Starters are editable templates, not fixed document types. Pick the closest structure, then change the GQL source and Liquid parts until the generated PDF matches the records in the table.

- `Invoice`
- `Loan agreement`
- `Label`
- `QR label`
- `Overview report`
- `Record detail`
- `Delivery note`
- `Quote`
- `Packing list`
- `Certificate`
- `Checklist`
- `Badge / name tag`

## Editable parts {icon="table"}

A template has one data part and up to four layout parts. The GQL source is rendered with Liquid first, so it can use the selected `record`, public `app`, and base `business` values before the query is parsed.

| Part       | Language      | Purpose                                                                                          | Common use                                                                |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| GQL source | Liquid + GQL  | Selects the rows and columns available to the document. Liquid is rendered before GQL is parsed. | Current record, joined rows, item lists, grouped summaries.               |
| Body       | Liquid + HTML | The main printable document content. This part is required.                                      | Invoice body, contract clauses, label layout, record detail tables.       |
| Header     | Liquid + HTML | Optional Gotenberg header rendered on each page.                                                 | Letterhead, sender identity, document class, contact block.               |
| Footer     | Liquid + HTML | Optional Gotenberg footer rendered on each page.                                                 | Legal footer, bank data, page numbers with `pageNumber` and `totalPages`. |
| Page CSS   | Liquid + CSS  | Optional CSS injected into the PDF body document.                                                | @page size/margins, table headers, page breaks, print typography.         |

## Understand the available data {icon="layout-grid"}

The Data tab is the source of truth for the current preview record. It shows the exact shape Liquid receives after the GQL source has run. Copy paths from this tree instead of guessing object shapes.

Think of the data in layers: `record` is the selected record, `rows` and `columns` are the GQL result, and `document` describes a saved run. `template`, `run`, and `date` provide stable metadata for numbers and filenames. `app` contains public platform branding. `business` contains the base's document profile. Rows also expose GQL output labels, so readable aliases make templates easier to maintain.

:::reference
- **record:** The current record: `record.id`, `record.tableId`, `record.version`, `record.data`, created and updated timestamps.
- **rows and columns:** The rows and columns returned by the GQL source. Use column.key for row access and column.label for human-readable headers.
- **template, run, date:** Stable metadata for patterns and document copy: `{{ template.name }}`, `{{ template.shortId }}`, `{{ run.shortId }}`, `{{ date.iso }}`, and `{{ date.yyyyMMdd }}`. Draft previews use draft run values until a saved run exists.
- **app:** Public platform values for document branding: `{{ app.name }}`, `{{ app.contactEmail }}`, `{{ app.url }}`, `{{ app.logoDataUri }}`, and `{{ app.timezone }}`.
- **business:** Base-level document profile values such as `{{ business.legalName }}`, `{{ business.senderLine }}`, `{{ business.address }}`, `{{ business.paymentTerms }}`, `{{ business.iban }}`, and footer/contact fields. Edit them in Base settings → Documents.
- **images:** Image files attached to file fields on the selected record. Use `{{ primaryImage.url }}` for the first supported image or loop over `images`. Oversized and unsupported files are omitted.
- **document:** Generated document metadata such as `{{ document.number }}` and `{{ document.generatedAt }}`. Use it in filenames and body/header/footer HTML after the number pattern has rendered. Draft previews may not have final values yet.
- **snapshot:** The captured record graph for generated runs. It is null in live draft previews before a run exists.
- **barcode_data_url:** A Grids Liquid filter for labels and badges. It returns an SVG data URL for QR codes and supported BWIP barcode symbols.
:::

## GQL source patterns {icon="code"}

Keep filtering, sorting, joins, grouping, and limits in GQL so the database does the work. Keep Liquid focused on presentation.

**Current record only**

```gql
from table Invoices
where record.id = '{{ record.id }}'
limit 1
```

**Current record with related item names**

```gql
from table Loans
left join table Items as item on Items = item.id
select "Loan number", Borrower, item.Name as item_name, item.Condition as item_condition
where record.id = '{{ record.id }}'
sort item.Name asc
```

**Batch or checklist**

```gql
from table Items
select Name, Status, Location
where Status = 'Ready'
sort Name asc
limit 100
```

## Numbers and filenames {icon="paperclip"}

A generated document has a stable `document.number` and a PDF filename. The number pattern is rendered first. The filename pattern can then use `{{ document.number }}`. This keeps business identifiers separate from the downloadable file name.

The default number pattern is non-sequential and collision-resistant: `{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}`. It avoids internal UUIDs and avoids app-wide prefixes. If a business process needs legally consecutive invoice numbers, model that as a dedicated generated-id field or a later sequence-backed numbering mode instead of hand-writing counters in Liquid.

**Default number**

```text
{{ template.shortId }}-{{ date.yyyyMMdd }}-{{ run.shortId }}
```

**Default filename**

```text
{{ document.number }}.pdf
```

**Business-style number**

```text
INV-{{ date.yyyy }}-{{ run.shortId }}
```

**Readable filename**

```text
invoice-{{ record.data.Name | default: document.number }}-{{ document.number }}.pdf
```

:::reference
- **Number pattern context:** May use `record`, `table`, `template`, `run`, `date`, `app`, and `business`. It may not use `document`, because the document number does not exist yet.
- **Filename pattern context:** May use the full rendered data tree, including `{{ document.number }}`. The final filename is cleaned for filesystem-safe PDF downloads.
- **Validation:** Unknown top-level Liquid variables, invalid tags, unsupported filters, empty patterns, and oversized patterns fail when the template is saved.
:::

## Liquid reference {icon="book-2"}

Template parts use LiquidJS with Grids restrictions: strict variables, strict filters, escaped output, no layouts, no dynamic partials, and only the tags listed below. Unknown filters, invalid tags, and oversized output fail instead of rendering a partial document.

:::reference
- **Output:** Use `{{ value }}` to print a value. Output is HTML-escaped by default. Use `| raw` only when a trusted template intentionally prints HTML.
- **Filters:** Pipe values through filters, for example `{{ row.Name | default: '-' }}`. Unknown filters fail.
- **Conditions:** Use `{% if row.Status == 'Open' %}`, `elsif`, `else`, and `endif`.
- **Loops:** Use `{% for row in rows %}` and `{% endfor %}`. Break and continue are allowed.
- **Temporary values:** Use `assign` for short values and `capture` for longer rendered fragments.
- **No external partials:** Include, render, layout, and external partial tags are not allowed. A template must be self-contained.
:::

Allowed tags

- `if`
- `elsif`
- `else`
- `endif`
- `unless`
- `endunless`
- `for`
- `break`
- `continue`
- `endfor`
- `case`
- `when`
- `endcase`
- `assign`
- `capture`
- `endcapture`
- `comment`
- `endcomment`
- `raw`
- `endraw`

## Barcodes and QR codes {icon="code"}

Use the `barcode_data_url` filter in an `<img>` tag. Barcode ids are lowercase symbols. The optional third argument controls human-readable text for barcode formats that support it.

**Code 128 with text**

```text
{% if rows.size > 0 and columns.size > 0 %}
  {% assign first = rows[0] %}
  {% assign codeColumn = columns[0] %}
  {% assign codeValue = first[codeColumn.key] | default: table.name %}
{% else %}
  {% assign codeValue = table.name %}
{% endif %}
<img src='{{ codeValue | barcode_data_url: "code128", true }}' alt="Asset barcode">
```

**QR code**

```html
<img src='{{ document.number | default: table.name | barcode_data_url: "qrcode" }}' alt="Document QR code">
```

| Type id           | Label              | Use                               |
| ----------------- | ------------------ | --------------------------------- |
| `code128`         | Code 128           | General-purpose linear barcode.   |
| `qrcode`          | QR Code            | Compact 2D code for phones.       |
| `datamatrix`      | Data Matrix        | Small 2D code for labels.         |
| `pdf417`          | PDF417             | Stacked 2D code for documents.    |
| `azteccode`       | Aztec Code         | Dense 2D code without quiet zone. |
| `ean13`           | EAN-13             | Retail product code, 13 digits.   |
| `ean8`            | EAN-8              | Short retail product code.        |
| `upca`            | UPC-A              | US retail product code.           |
| `upce`            | UPC-E              | Compressed UPC code.              |
| `itf14`           | ITF-14             | Carton and package code.          |
| `gs1datamatrix`   | GS1 Data Matrix    | GS1 2D code with application IDs. |
| `sscc18`          | SSCC-18            | Shipping container code.          |
| `isbn`            | ISBN               | Book identifier barcode.          |
| `issn`            | ISSN               | Serial publication barcode.       |
| `ismn`            | ISMN               | Printed music barcode.            |
| `code39`          | Code 39            | Simple alphanumeric barcode.      |
| `code93`          | Code 93            | Compact alphanumeric barcode.     |
| `interleaved2of5` | Interleaved 2 of 5 | Numeric warehouse barcode.        |
| `micropdf417`     | MicroPDF417        | Compact stacked 2D code.          |
| `microqrcode`     | Micro QR Code      | Tiny QR variant.                  |
| `maxicode`        | MaxiCode           | Parcel and logistics 2D code.     |
| `dotcode`         | DotCode            | Dot-based production code.        |

Additional BWIP symbol ids

- `auspost`
- `azteccodecompact`
- `aztecrune`
- `bc412`
- `channelcode`
- `codablockf`
- `code11`
- `code16k`
- `code2of5`
- `code32`
- `code39ext`
- `code49`
- `code93ext`
- `codeone`
- `coop2of5`
- `d3aqr`
- `daft`
- `databarexpanded`
- `databarexpandedcomposite`
- `databarexpandedstacked`
- `databarexpandedstackedcomposite`
- `databarlimited`
- `databarlimitedcomposite`
- `databaromni`
- `databaromnicomposite`
- `databarstacked`
- `databarstackedcomposite`
- `databarstackedomni`
- `databarstackedomnicomposite`
- `databartruncated`
- `databartruncatedcomposite`
- `datalogic2of5`
- `datamatrixrectangular`
- `datamatrixrectangularextension`
- `ean13composite`
- `ean14`
- `ean2`
- `ean5`
- `ean8composite`
- `flattermarken`
- `gs1datamatrixrectangular`
- `gs1dldatamatrix`
- `gs1dlqrcode`
- `gs1dotcode`
- `gs1northamericancoupon`
- `gs1qrcode`
- `hanxin`
- `hibcazteccode`
- `hibccodablockf`
- `hibccode128`
- `hibccode39`
- `hibcdatamatrix`
- `hibcdatamatrixrectangular`
- `hibcmicropdf417`
- `hibcpdf417`
- `hibcqrcode`
- `iata2of5`
- `identcode`
- `industrial2of5`
- `japanpost`
- `kix`
- `leitcode`
- `mailmark`
- `mands`
- `matrix2of5`
- `msi`
- `onecode`
- `pdf417compact`
- `pharmacode2`
- `pharmacode`
- `planet`
- `plessey`
- `posicode`
- `postnet`
- `pzn`
- `rectangularmicroqrcode`
- `royalmail`
- `swissqrcode`
- `symbol`
- `telepen`
- `telepennumeric`
- `ultracode`
- `upcacomposite`
- `upcecomposite`

## Liquid patterns {icon="point"}

**Loop over query rows**

```html
<table>
  <tbody>
    {% for row in rows %}
      <tr>
        <td>{{ row.Name }}</td>
        <td>{{ row.Status | default: "-" }}</td>
      </tr>
    {% endfor %}
  </tbody>
</table>
```

**Generic column table**

```html
<table>
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
</table>
```

**Code 128 barcode**

```text
{% if rows.size > 0 and columns.size > 0 %}
  {% assign first = rows[0] %}
  {% assign codeColumn = columns[0] %}
  {% assign codeValue = first[codeColumn.key] | default: table.name %}
{% else %}
  {% assign codeValue = table.name %}
{% endif %}
<img alt="Asset barcode" src='{{ codeValue | barcode_data_url: "code128", true }}'>
```

**QR code**

```html
<img alt="Record QR code" src='{{ document.number | default: table.name | barcode_data_url: "qrcode" }}'>
```

## Preview, data, source {icon="layout-list"}

:::reference
- **Preview:** Renders the current unsaved draft as a PDF. Use **Open preview** for full-screen inspection.
- **Data:** Shows the exact Liquid paths for the selected preview record. Copy paths from here instead of guessing object shapes.
- **Source:** Shows the GQL after Liquid variables have been substituted. Use it to debug current-record filters.
:::

## Work with generated documents {icon="file-description"}

The document page lists every generated run for a template. Use **Table** for a searchable list or **Folders** to browse by year and month. Searching switches to the table result so matching documents are not hidden inside folders.

Before generation you can override the template filename and add tags. With template Write access, open a generated document's details to change its filename or tags later. The document number remains stable.

Template Read access allows a user to browse and redownload generated documents. Write access also allows generation and metadata changes. Admin access manages the template itself.

To share one generated PDF without a Cloud login, create a public link for 1, 7, 30, or 90 days. The link downloads only that stored document snapshot. An optional comment explains its purpose. The creator or a document editor can revoke the link before it expires.

## Snapshots and runs {icon="point"}

Generating a PDF creates a recursive snapshot of the root record and related records reached through relation fields. Snapshot traversal is bounded to depth 4 and 500 records. The run stores the template snapshot, render data, stable document number, and generation timestamp. PDF bytes are regenerated on download from the stored run data.

:::reference
- **Document numbers:** Each run receives a stable document number from the template's number pattern. The number is unique across generated documents.
- **Template edits:** Changing a template affects future generations. Existing runs redownload from the template snapshot and data captured for that run.
- **Manual snapshots:** The record detail panel also has a Snapshot button for capturing a record state without generating a PDF.
- **Deleted templates:** Deleting a template removes it from the active list, but existing generated documents remain available through their runs.
:::

## Practical limits {icon="point"}

Grids rejects templates that exceed these bounds instead of silently truncating a query or document:

| Input | Limit |
| --- | ---: |
| GQL source | 20,000 bytes |
| Body HTML | 200,000 bytes |
| Header HTML, footer HTML, or page CSS | 50,000 bytes each |
| Number or filename pattern | 5,000 bytes each |
| Rendered body HTML | 300,000 bytes |
| GQL result used by one document | 10,000 rows |
| Record images exposed to Liquid | 12 images, up to 2 MB each |
| Recursive snapshot | 4 relation levels and 500 records |

These are safety ceilings, not layout targets. For a document with thousands of rows, test page breaks and rendering time with realistic data before enabling the template.

## Common issues {icon="point"}

:::reference
- **Invalid GQL source:** Open the Source tab. It shows the GQL after Liquid variables were substituted.
- **Missing Liquid variable:** Choose a preview record, open Data, then copy the exact path from the tree.
- **Empty document rows:** Check the GQL source filter and confirm the selected preview record matches it.
- **Barcode does not render:** Check the barcode type and input value. Empty input returns an empty data URL.
- **Multipage layout breaks:** Move repeated content to header/footer, set @page margins, and preview with enough rows.
:::

:::note Use GQL for data, Liquid for layout
Keep filtering, sorting, joins, and grouping in GQL. Keep Liquid focused on loops, conditions, text, tables, images, barcodes, headers, footers, and CSS.
:::
