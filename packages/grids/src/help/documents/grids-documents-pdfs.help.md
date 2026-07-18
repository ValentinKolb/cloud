---
id: grids-documents-pdfs
title: Documents & PDFs
icon: ti ti-file-type-pdf
description: GQL sources, Liquid HTML, snapshots, and generated documents.
order: 135
---
Document templates turn table records into repeatable PDFs. Use them for invoices, contracts, labels, certificates, delivery notes, quotes, packing lists, checklists, and record summaries.

### How templates work

A template belongs to one table and describes one document family for records in that table. The selected preview record gives the template its current-record context. GQL decides which rows and columns the document can use. Liquid decides how those values become HTML. Gotenberg turns that HTML into a PDF.

Use a template when the output must be generated from saved record data, redownloaded later, or backed by a snapshot. Use a normal export when you only need a data file.

The useful split is data first, layout second. If the document needs fewer rows, related rows, totals, or a defined sort order, express that in GQL. If the document needs different wording, tables, page breaks, letterheads, labels, barcodes, or conditions, express that in Liquid HTML and CSS.

### How generation works

Generation starts from a selected record. Grids renders the template's GQL source with Liquid, runs that GQL on the server, renders the body, header, footer, and page CSS with the returned data, then sends the HTML to Gotenberg for PDF rendering. A saved generation creates a bounded record snapshot and a document run with a stable document number.

**Pipeline**

```text
selected record
  -> render Liquid in the GQL source
  -> run GQL in SQL
  -> render body/header/footer/page CSS with Liquid
  -> Gotenberg HTML-to-PDF
  -> store snapshot + document run metadata
```

### Create and preview

Most templates start from a starter, then get narrowed to the record and related data the document should print. Use the preview record as an anchor: it lets the editor show the exact rendered GQL, the exact data tree, and the PDF output for the same record.

1. **Open templates:** Open the table in edit mode and choose Templates. Templates belong to the table they generate documents for.
2. **Start from a starter:** Pick a starter such as Invoice, Loan agreement, Label, QR label, Overview, Record detail, Quote, Packing list, or Checklist.
3. **Choose a preview record:** The preview record supplies the current record context. The Data tab then shows the exact variables available to Liquid.
4. **Adjust the GQL source:** Keep the default source for single-record PDFs. Add joins, selects, grouping, or broader sources when the document needs related or batch data.
5. **Edit the HTML parts:** Body, header, footer, and page CSS are separate so multipage business documents can keep stable letterheads and page numbers.
6. **Render before saving:** Use the PDF preview and open-in-new-tab action for layout checks. New templates start disabled, and enabling a draft without a successful preview asks for confirmation.

### Starters

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

### Editable parts

A template has one data part and up to four layout parts. The GQL source is rendered with Liquid first, so it can use the selected `record`, public `app`, and base `business` values before the query is parsed.

| Part       | Language      | Purpose                                                                                          | Common use                                                                |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| GQL source | Liquid + GQL  | Selects the rows and columns available to the document. Liquid is rendered before GQL is parsed. | Current record, joined rows, item lists, grouped summaries.               |
| Body       | Liquid + HTML | The main printable document content. This part is required.                                      | Invoice body, contract clauses, label layout, record detail tables.       |
| Header     | Liquid + HTML | Optional Gotenberg header rendered on each page.                                                 | Letterhead, sender identity, document class, contact block.               |
| Footer     | Liquid + HTML | Optional Gotenberg footer rendered on each page.                                                 | Legal footer, bank data, page numbers with `pageNumber` and `totalPages`. |
| Page CSS   | Liquid + CSS  | Optional CSS injected into the PDF body document.                                                | @page size/margins, table headers, page breaks, print typography.         |

### Use data in Liquid

The Data tab is the source of truth for the current preview record. It shows the exact shape Liquid receives after the GQL source has run. Copy paths from this tree instead of guessing object shapes.

Think of the data in layers: `record` is the selected record, `rows` and `columns` are the GQL result, and `document` describes a saved run. `template`, `run`, and `date` provide stable metadata for numbers and filenames. `app` contains public platform branding. `business` contains the base's document profile. Rows also expose GQL output labels, so readable aliases make templates easier to maintain.

- **record:** The current record: `record.id`, `record.tableId`, `record.version`, `record.data`, created and updated timestamps.
- **rows and columns:** The rows and columns returned by the GQL source. Use column.key for row access and column.label for human-readable headers.
- **template, run, date:** Stable metadata for patterns and document copy: `{{ template.name }}`, `{{ template.shortId }}`, `{{ run.shortId }}`, `{{ date.iso }}`, and `{{ date.yyyyMMdd }}`. Draft previews use draft run values until a saved run exists.
- **app:** Public platform values for document branding: `{{ app.name }}`, `{{ app.contactEmail }}`, `{{ app.url }}`, `{{ app.logoDataUri }}`, and `{{ app.timezone }}`.
- **business:** Base-level document profile values such as `{{ business.legalName }}`, `{{ business.senderLine }}`, `{{ business.address }}`, `{{ business.paymentTerms }}`, `{{ business.iban }}`, and footer/contact fields. Edit them in Base settings → Documents.
- **images:** Image files attached to file fields on the selected record. Use `{{ primaryImage.url }}` for the first supported image or loop over `images`. Oversized and unsupported files are omitted.
- **document:** Generated document metadata such as `{{ document.number }}` and `{{ document.generatedAt }}`. Use it in filenames and body/header/footer HTML after the number pattern has rendered. Draft previews may not have final values yet.
- **snapshot:** The captured record graph for generated runs. It is null in live draft previews before a run exists.
- **barcode_data_url:** A Grids Liquid filter for labels and badges. It returns an SVG data URL for QR codes and supported BWIP barcode symbols.

### GQL source patterns

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

### Numbers and filenames

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

```css
INV-{{ date.yyyy }}-{{ run.shortId }}
```

**Readable filename**

```css
invoice-{{ record.data.Name | default: document.number }}-{{ document.number }}.pdf
```

- **Number pattern context:** May use `record`, `table`, `template`, `run`, `date`, `app`, and `business`. It may not use `document`, because the document number does not exist yet.
- **Filename pattern context:** May use the full rendered data tree, including `{{ document.number }}`. The final filename is cleaned for filesystem-safe PDF downloads.
- **Validation:** Unknown top-level Liquid variables, invalid tags, unsupported filters, empty patterns, and oversized patterns fail when the template is saved.

### Liquid reference

Template parts use LiquidJS with Grids restrictions: strict variables, strict filters, escaped output, no layouts, no dynamic partials, and only the tags listed below. Unknown filters, invalid tags, and oversized output fail instead of rendering a partial document.

- **Output:** Use `{{ value }}` to print a value. Output is HTML-escaped by default. Use `| raw` only when a trusted template intentionally prints HTML.
- **Filters:** Pipe values through filters, for example `{{ row.Name | default: '-' }}`. Unknown filters fail.
- **Conditions:** Use `{% if row.Status == 'Open' %}`, `elsif`, `else`, and `endif`.
- **Loops:** Use `{% for row in rows %}` and `{% endfor %}`. Break and continue are allowed.
- **Temporary values:** Use `assign` for short values and `capture` for longer rendered fragments.
- **No external partials:** Include, render, layout, and external partial tags are not allowed. A template must be self-contained.

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

### Barcodes and QR codes

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

### Liquid patterns

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

### Preview, data, source

- **Preview:** Renders the current unsaved draft as a PDF. Use Open preview for full-screen inspection.
- **Data:** Shows the exact Liquid paths for the selected preview record. Copy paths from here instead of guessing object shapes.
- **Source:** Shows the rendered GQL source after Liquid variables have been substituted. Use it to debug current-record filters.

### Snapshots and runs

Generating a PDF creates a recursive snapshot of the root record and related records reached through relation fields. Snapshot traversal is bounded to depth 4 and 500 records. The run stores the template snapshot, render data, stable document number, and generation timestamp. PDF bytes are regenerated on download from the stored run data.

- **Document numbers:** Each run receives a stable document number from the template's number pattern. The number is unique across generated documents.
- **Template edits:** Changing a template affects future generations. Existing runs redownload from the template snapshot and data captured for that run.
- **Manual snapshots:** The record detail panel also has a Snapshot button for capturing a record state without generating a PDF.
- **Deleted templates:** Deleting a template removes it from the active list, but existing generated documents remain available through their runs.

### Common issues

- **Invalid GQL source:** Open the Source tab. It shows the GQL after Liquid variables were substituted.
- **Missing Liquid variable:** Choose a preview record, open Data, then copy the exact path from the tree.
- **Empty document rows:** Check the GQL source filter and confirm the selected preview record matches it.
- **Barcode does not render:** Check the barcode type and input value. Empty input returns an empty data URL.
- **Multipage layout breaks:** Move repeated content to header/footer, set @page margins, and preview with enough rows.

:::note Use GQL for data, Liquid for layout
Keep filtering, sorting, joins, and grouping in GQL. Keep Liquid focused on loops, conditions, text, tables, images, barcodes, headers, footers, and CSS.
:::
