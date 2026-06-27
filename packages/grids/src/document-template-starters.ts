import { CLOUD_LOGO_SVG } from "@valentinkolb/cloud/shared";

export type DocumentTemplateStarter = {
  id: string;
  name: string;
  description: string;
  icon: string;
  source: (tableId: string) => string;
  html: string;
  headerHtml?: string;
  footerHtml?: string;
  pageCss?: string;
};

const recordSource = (tableId: string) => `from table {${tableId}}\nwhere record.id = '{{ record.id }}'\nlimit 1`;
const overviewSource = (tableId: string) => `from table {${tableId}}\nlimit 100`;

const primaryValue = `{% assign first = rows[0] %}{% if columns.size > 0 %}{% assign firstColumn = columns[0] %}{{ first[firstColumn.key] | default: table.name }}{% else %}{{ table.name }}{% endif %}`;

const businessHeader = `<style>
  html, body { margin: 0; }
  body { font-family: Inter, Arial, sans-serif; color: #334155; font-size: 8pt; }
  .header { box-sizing: border-box; width: 100%; padding: 7mm 14mm 5mm; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8mm; }
  .brand-lockup { display: flex; align-items: center; gap: 3.2mm; min-width: 0; }
  .cloud-logo { width: 12mm; height: 12mm; flex: 0 0 auto; display: block; }
  .brand { color: #0f172a; font-weight: 850; font-size: 10.5pt; letter-spacing: .08em; text-transform: uppercase; }
  .line { margin-top: .8mm; color: #64748b; }
  .meta { text-align: right; white-space: nowrap; line-height: 1.35; }
  .meta strong { color: #0f172a; }
</style>
<div class="header">
  <div class="brand-lockup">
    ${CLOUD_LOGO_SVG}
    <div>
      <div class="brand">ACME Operations GmbH</div>
      <div class="line">Friedrichstrasse 120 | 10117 Berlin | Germany</div>
    </div>
  </div>
  <div class="meta">
    <strong>Finance &amp; Operations</strong><br>
    finance@example.com<br>
    +49 30 000000-0
  </div>
</div>`;

const businessFooter = `<style>
  html, body { margin: 0; }
  body { font-family: Inter, Arial, sans-serif; color: #64748b; font-size: 7.2pt; }
  .footer { box-sizing: border-box; width: 100%; border-top: 1px solid #d6dee8; padding: 2.4mm 14mm 0; display: grid; grid-template-columns: 1.2fr 1fr auto; gap: 6mm; line-height: 1.35; }
  .center { text-align: center; }
  .right { text-align: right; }
</style>
<div class="footer">
  <span>ACME Operations GmbH | Managing Director Jane Miller | VAT DE000000000</span>
  <span class="center">IBAN DE00 0000 0000 0000 0000 00 | BIC EXAMPLEXXX</span>
  <span class="right">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
</div>`;

const standardPageCss = `@page { size: A4; margin: 34mm 14mm 22mm; }
* { box-sizing: border-box; }
body { font-family: Inter, Arial, sans-serif; color: #111827; font-size: 10pt; line-height: 1.45; }
h1 { margin: 0; font-size: 22pt; line-height: 1.1; letter-spacing: 0; }
h2 { margin: 7mm 0 2.5mm; font-size: 11pt; color: #0f172a; }
p { margin: 0 0 3mm; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr, .avoid-break { break-inside: avoid; page-break-inside: avoid; }
th, td { border-bottom: 1px solid #e2e8f0; padding: 7px 6px; text-align: left; vertical-align: top; }
th { color: #475569; font-size: 8pt; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
.document-title { display: grid; grid-template-columns: 1fr auto; gap: 12mm; align-items: start; margin-bottom: 9mm; }
.document-kicker { margin-bottom: 2mm; color: #64748b; font-size: 8pt; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.document-meta { min-width: 56mm; color: #334155; }
.meta-row { display: flex; justify-content: space-between; gap: 8mm; padding: 1.2mm 0; }
.muted { color: #64748b; }
.strong { font-weight: 800; color: #0f172a; }
.right { text-align: right; }
.box { border: 1px solid #d1d5db; border-radius: 4px; padding: 5mm; }
.soft-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 5mm; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
.address { min-height: 34mm; }
.small { font-size: 8.5pt; }
.checkbox { display: inline-block; width: 4.2mm; height: 4.2mm; border: 1.4px solid #0f172a; border-radius: 1px; vertical-align: middle; }
.signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 18mm; }
.signature { min-height: 18mm; border-top: 1.2px solid #0f172a; padding-top: 2mm; color: #334155; }
.summary-card { margin-left: auto; width: 74mm; }
.summary-row { display: flex; justify-content: space-between; gap: 8mm; padding: 1.5mm 0; }
.summary-row:last-child { border-top: 1px solid #cbd5e1; margin-top: 1.5mm; padding-top: 2.5mm; }
.letter-sender { color: #64748b; font-size: 8pt; margin-bottom: 4mm; }
.recipient-window { min-height: 38mm; padding-top: 1mm; }
.letter-layout { display: grid; grid-template-columns: 1fr 68mm; gap: 14mm; align-items: start; margin-bottom: 11mm; }
.letter-contact { background: #f8fafc; border-left: 3px solid #0f172a; padding: 4mm 5mm; color: #334155; }
.document-band { padding: 0; margin: 12mm 0 9mm; display: grid; grid-template-columns: 1fr auto; gap: 10mm; align-items: end; }
.document-band h1 { font-size: 22pt; }
.document-number { color: #334155; font-size: 10pt; text-align: right; }
.section-title { margin-top: 7mm; margin-bottom: 2.5mm; color: #0f172a; font-size: 8.5pt; font-weight: 850; letter-spacing: .06em; text-transform: uppercase; }
.clause { margin-top: 6mm; }
.clause h2 { margin: 0 0 2mm; font-size: 11pt; }
.compact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; }
.stamp-box { border: 1px solid #0f172a; padding: 4mm; text-align: center; font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; color: #334155; }
.fine-print { color: #64748b; font-size: 8pt; }
.form-line { display: inline-block; min-width: 28mm; height: 1em; border-bottom: 1px solid #94a3b8; vertical-align: baseline; }`;

const rowsTable = `<table>
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
</table>`;

const detailTable = `<table>
  <tbody>
    {% for row in rows %}
      {% for column in columns %}
        <tr>
          <th style="width: 32%;">{{ column.label }}</th>
          <td>{{ row[column.key] | default: "-" }}</td>
        </tr>
      {% endfor %}
    {% endfor %}
  </tbody>
</table>`;

export const DOCUMENT_TEMPLATE_STARTERS: DocumentTemplateStarter[] = [
  {
    id: "invoice",
    name: "Invoice",
    description: "Professional invoice starter with sender, recipient, item table, payment terms, and totals block.",
    icon: "ti ti-receipt",
    source: recordSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: `${standardPageCss}
.invoice-table { margin-top: 7mm; }
.invoice-table tbody tr:nth-child(even) { background: #f8fafc; }
.payment-note { margin-top: 8mm; }
.total-due { font-size: 14pt; font-weight: 900; color: #0f172a; }`,
    html: `<main>
  <section class="letter-layout avoid-break">
    <div>
      <div class="letter-sender">ACME Operations GmbH | Friedrichstrasse 120 | 10117 Berlin | Germany</div>
      <div class="recipient-window">
        <p class="strong">Customer Company</p>
        <p>Accounts Payable<br>Customer Street 8<br>20095 Hamburg<br>Germany</p>
      </div>
    </div>
    <aside class="letter-contact">
      <p class="strong">ACME Operations GmbH</p>
      <p>Friedrichstrasse 120<br>10117 Berlin<br>Germany</p>
      <p class="small muted">finance@example.com<br>+49 30 000000-0<br>www.example.com</p>
    </aside>
  </section>

  <section class="document-band avoid-break">
    <div>
      <div class="document-kicker">Commercial document</div>
      <h1>Invoice</h1>
      <p class="fine-print" style="margin-top: 2mm;">Services and goods according to the itemized statement below.</p>
    </div>
    <div class="document-number">
      <strong>{{ document.number | default: "INV-0001" }}</strong><br>
      {% if document.generatedAt %}{{ document.generatedAt }}{% else %}<span>Issue date <span class="form-line"></span></span>{% endif %}
    </div>
  </section>

  <section class="compact-grid avoid-break">
    <div class="soft-box">
      <div class="document-kicker">Customer no.</div>
      <p class="strong">C-00001</p>
    </div>
    <div class="soft-box">
      <div class="document-kicker">Payment terms</div>
      <p class="strong">14 days net</p>
    </div>
    <div class="soft-box">
      <div class="document-kicker">Currency</div>
      <p class="strong">EUR</p>
    </div>
  </section>

  <div class="invoice-table">${rowsTable}</div>

  <section class="summary-card soft-box avoid-break">
    <div class="summary-row"><span>Subtotal</span><strong>0.00 EUR</strong></div>
    <div class="summary-row"><span>VAT</span><strong>0.00 EUR</strong></div>
    <div class="summary-row"><span>Total due</span><span class="total-due">0.00 EUR</span></div>
  </section>

  <section class="grid-2 payment-note avoid-break">
    <div>
      <div class="section-title">Payment instructions</div>
      <p>Please transfer the total amount to the bank account stated in the footer and include the invoice number as payment reference.</p>
    </div>
    <div>
      <div class="section-title">Notes</div>
      <p class="fine-print">This invoice was generated from approved operational records. Please quote the invoice number on all payment references and correspondence.</p>
    </div>
  </section>
</main>`,
  },
  {
    id: "loan-agreement",
    name: "Loan agreement",
    description: "Business-ready loan agreement with parties, item list, terms, and signature blocks.",
    icon: "ti ti-file-certificate",
    source: recordSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: `${standardPageCss}
.agreement-intro { margin-bottom: 8mm; }
.agreement-table { margin-top: 4mm; }
.condition-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm 8mm; margin-top: 3mm; }
.condition-item { display: flex; align-items: center; gap: 2.5mm; }
.initial-box { border: 1px solid #94a3b8; min-height: 12mm; padding: 2.5mm; }`,
    html: `<main>
  <section class="letter-layout avoid-break">
    <div>
      <div class="letter-sender">ACME Operations GmbH | Friedrichstrasse 120 | 10117 Berlin | Germany</div>
      <div class="recipient-window">
        <p class="strong">Borrower name / organization</p>
        <p>Borrower address<br>Contact person<br>City, country</p>
      </div>
    </div>
    <aside class="stamp-box">Internal loan document<br>Return required</aside>
  </section>

  <section class="document-band avoid-break">
    <div>
      <div class="document-kicker">Agreement</div>
      <h1>Equipment loan agreement</h1>
    </div>
    <div class="document-number">
      <strong>Loan ref. {{ document.number | default: "LN-0001" }}</strong><br>
      Prepared for signature
    </div>
  </section>

  <section class="grid-2 agreement-intro avoid-break">
    <div class="box">
      <div class="document-kicker">Lender</div>
      <p class="strong">ACME Operations GmbH</p>
      <p>Friedrichstrasse 120<br>10117 Berlin<br>Germany</p>
      <p class="small muted">Represented by authorized staff.</p>
    </div>
    <div class="box">
      <div class="document-kicker">Borrower</div>
      <p class="strong">Borrower name / organization</p>
      <p>Borrower address<br>Contact details</p>
      <p class="small muted">Identification checked before handover.</p>
    </div>
  </section>

  <section class="compact-grid avoid-break">
    <div class="soft-box"><div class="document-kicker">Loan starts</div><p class="strong"><span class="form-line"></span></p></div>
    <div class="soft-box"><div class="document-kicker">Return due</div><p class="strong"><span class="form-line"></span></p></div>
    <div class="soft-box"><div class="document-kicker">Return condition</div><p class="strong">As issued</p></div>
  </section>

  <div class="section-title">Loaned equipment</div>
  <div class="agreement-table">${rowsTable}</div>

  <section class="clause avoid-break">
    <h2>1. Handover and responsibility</h2>
    <p>The borrower confirms receipt of the listed equipment in the condition documented at handover. The borrower is responsible for careful handling, secure storage, and timely return.</p>
  </section>

  <section class="clause avoid-break">
    <h2>2. Condition checklist</h2>
    <div class="condition-grid">
      <div class="condition-item"><span class="checkbox"></span><span>Equipment complete</span></div>
      <div class="condition-item"><span class="checkbox"></span><span>Accessories included</span></div>
      <div class="condition-item"><span class="checkbox"></span><span>Visible damage documented</span></div>
      <div class="condition-item"><span class="checkbox"></span><span>Return date explained</span></div>
    </div>
  </section>

  <section class="clause avoid-break">
    <h2>3. Loss, damage, and late return</h2>
    <p>Loss, damage, missing accessories, or late return may be charged according to replacement value, repair cost, or the applicable internal policy.</p>
  </section>

  <section class="signature-grid avoid-break">
    <div>
      <div class="initial-box small muted">Internal notes / handover initials</div>
      <div class="signature">Place, date, lender signature</div>
    </div>
    <div>
      <div class="initial-box small muted">Borrower initials</div>
      <div class="signature">Place, date, borrower signature</div>
    </div>
  </section>
</main>`,
  },
  {
    id: "label",
    name: "Label",
    description: "Clean 90mm x 54mm operational label without internal identifiers.",
    icon: "ti ti-tag",
    source: recordSource,
    pageCss: `@page { size: 90mm 54mm; margin: 0; }
* { box-sizing: border-box; }
html, body { width: 90mm; height: 54mm; margin: 0; }
body { font-family: Inter, Arial, sans-serif; color: #0f172a; padding: 6mm; }
.label { width: 78mm; height: 42mm; border: 1.6px solid #0f172a; border-radius: 5px; padding: 5mm; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
.kicker { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: #64748b; font-weight: 800; }
.name { margin-top: 3mm; font-size: 20pt; line-height: 1.05; font-weight: 850; }`,
    html: `<section class="label">
  <div class="kicker">{{ table.name }}</div>
  <div class="name">${primaryValue}</div>
</section>`,
  },
  {
    id: "overview",
    name: "Overview report",
    description: "Multipage business report over many records.",
    icon: "ti ti-table",
    source: overviewSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: standardPageCss,
    html: `<main>
  <section class="document-title avoid-break">
    <div>
      <div class="document-kicker">Report</div>
      <h1>{{ table.name }} overview</h1>
    </div>
    <div class="document-meta">
      <div class="meta-row"><span>Scope</span><strong>Current GQL source</strong></div>
      <div class="meta-row"><span>Rows</span><strong>{{ rows.size }}</strong></div>
    </div>
  </section>
  ${rowsTable}
</main>`,
  },
  {
    id: "record-detail",
    name: "Record detail",
    description: "One-record business detail sheet with optional image header and full-width detail table.",
    icon: "ti ti-id",
    source: recordSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: `${standardPageCss}
.record-title { padding: 0; margin: 2mm 0 9mm; }
.record-image { width: 36mm; height: 36mm; object-fit: cover; border-radius: 4px; border: 1px solid #d1d5db; }
.record-details { width: 100%; }
.record-details table { width: 100%; }`,
    html: `<main>
  <section class="document-title record-title avoid-break">
    <div>
      <div class="document-kicker">Record detail</div>
      <h1>${primaryValue}</h1>
      <p class="fine-print" style="margin-top: 3mm;">Source: {{ table.name }}</p>
    </div>
    {% if primaryImage %}
      <img class="record-image" src="{{ primaryImage.url }}" alt="{{ primaryImage.label | default: 'Record image' }}">
    {% endif %}
  </section>
  <section class="record-details">
    ${detailTable}
  </section>
</main>`,
  },
  {
    id: "delivery-note",
    name: "Delivery note",
    description: "Delivery note with sender, recipient, delivery metadata, and item table.",
    icon: "ti ti-truck-delivery",
    source: recordSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: standardPageCss,
    html: `<main>
  <section class="document-title avoid-break">
    <div>
      <div class="document-kicker">Logistics</div>
      <h1>Delivery note</h1>
    </div>
    <div class="document-meta">
      <div class="meta-row"><span>Delivery no.</span><strong>{{ document.number | default: "DN-0001" }}</strong></div>
      <div class="meta-row"><span>Carrier</span><strong>Internal delivery</strong></div>
    </div>
  </section>
  <section class="grid-2 avoid-break">
    <div class="address box"><div class="document-kicker">Ship from</div><p class="strong">ACME Operations GmbH</p><p>Friedrichstrasse 120<br>10117 Berlin<br>Loading dock</p></div>
    <div class="address box"><div class="document-kicker">Ship to</div><p class="strong">Recipient</p><p>Delivery address<br>Contact person</p></div>
  </section>
  <h2>Delivered items</h2>
  ${rowsTable}
  <section class="signature-grid avoid-break">
    <div class="signature">Delivered by</div>
    <div class="signature">Received by</div>
  </section>
</main>`,
  },
  {
    id: "quote",
    name: "Quote",
    description: "Offer starter with customer block, line items, validity, and commercial terms.",
    icon: "ti ti-file-dollar",
    source: recordSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: standardPageCss,
    html: `<main>
  <section class="document-title avoid-break">
    <div>
      <div class="document-kicker">Commercial offer</div>
      <h1>Quote</h1>
    </div>
    <div class="document-meta">
      <div class="meta-row"><span>Quote no.</span><strong>{{ document.number | default: "Q-0001" }}</strong></div>
      <div class="meta-row"><span>Valid until</span><strong>30 days</strong></div>
    </div>
  </section>
  <section class="grid-2 avoid-break">
    <div class="address box"><div class="document-kicker">Supplier</div><p class="strong">ACME Operations GmbH</p><p>Friedrichstrasse 120<br>10117 Berlin</p></div>
    <div class="address box"><div class="document-kicker">Customer</div><p class="strong">Customer Company</p><p>Customer address<br>Procurement contact</p></div>
  </section>
  <h2>Offer positions</h2>
  ${rowsTable}
  <section class="soft-box avoid-break" style="margin-top: 8mm;">
    <p class="strong">Terms</p>
    <p class="muted">Prices are net prices unless stated otherwise. Delivery, payment, and availability are subject to written confirmation.</p>
  </section>
</main>`,
  },
  {
    id: "packing-list",
    name: "Packing list",
    description: "Operational packing list with real printed checkbox boxes and multipage-safe rows.",
    icon: "ti ti-package",
    source: overviewSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: `${standardPageCss}
.check-col { width: 12mm; text-align: center; }
.packed-table td.check-col { padding-top: 8px; }`,
    html: `<main>
  <section class="document-title avoid-break">
    <div>
      <div class="document-kicker">Warehouse</div>
      <h1>Packing list</h1>
    </div>
    <div class="document-meta">
      <div class="meta-row"><span>Prepared by</span><strong>Operations</strong></div>
      <div class="meta-row"><span>Rows</span><strong>{{ rows.size }}</strong></div>
    </div>
  </section>
  <table class="packed-table">
    <thead><tr><th class="check-col">Packed</th>{% for column in columns %}<th>{{ column.label }}</th>{% endfor %}</tr></thead>
    <tbody>
      {% for row in rows %}
        <tr><td class="check-col"><span class="checkbox"></span></td>{% for column in columns %}<td>{{ row[column.key] | default: "-" }}</td>{% endfor %}</tr>
      {% endfor %}
    </tbody>
  </table>
</main>`,
  },
  {
    id: "certificate",
    name: "Certificate",
    description: "Formal certificate or confirmation for one selected record.",
    icon: "ti ti-certificate",
    source: recordSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: `${standardPageCss}
.certificate { min-height: 185mm; border: 2px solid #0f172a; padding: 18mm; text-align: center; }
.certificate h1 { font-size: 24pt; margin-top: 18mm; }
.certificate-detail { margin: 16mm auto 0; max-width: 130mm; text-align: left; }`,
    html: `<main class="certificate">
  <div class="document-kicker">{{ table.name }}</div>
  <h1>Certificate</h1>
  <p>This document confirms the following record information.</p>
  <p class="strong" style="font-size: 14pt; margin-top: 6mm;">${primaryValue}</p>
  <div class="certificate-detail">${detailTable}</div>
  <section class="signature-grid avoid-break">
    <div class="signature">Place, date</div>
    <div class="signature">Authorized signature</div>
  </section>
</main>`,
  },
  {
    id: "checklist",
    name: "Checklist",
    description: "Printable checklist with real checkbox boxes and detail lines.",
    icon: "ti ti-list-check",
    source: overviewSource,
    headerHtml: businessHeader,
    footerHtml: businessFooter,
    pageCss: `${standardPageCss}
.task-col { width: 13mm; text-align: center; }
.details { color: #334155; }`,
    html: `<main>
  <section class="document-title avoid-break">
    <div>
      <div class="document-kicker">Checklist</div>
      <h1>{{ table.name }}</h1>
    </div>
    <div class="document-meta">
      <div class="meta-row"><span>Owner</span><strong>Operations</strong></div>
      <div class="meta-row"><span>Items</span><strong>{{ rows.size }}</strong></div>
    </div>
  </section>
  <table>
    <thead><tr><th class="task-col">Done</th><th>Task</th><th>Details</th></tr></thead>
    <tbody>
      {% for row in rows %}
        {% assign firstColumn = columns[0] %}
        <tr>
          <td class="task-col"><span class="checkbox"></span></td>
          <td class="strong">{{ row[firstColumn.key] | default: "Item" }}</td>
          <td class="details">{% for column in columns %}<strong>{{ column.label }}:</strong> {{ row[column.key] | default: "-" }}<br>{% endfor %}</td>
        </tr>
      {% endfor %}
    </tbody>
  </table>
</main>`,
  },
  {
    id: "badge",
    name: "Badge / name tag",
    description: "Simple professional badge without internal identifiers.",
    icon: "ti ti-badge",
    source: recordSource,
    pageCss: `@page { size: 85mm 55mm; margin: 0; }
* { box-sizing: border-box; }
body { width: 85mm; height: 55mm; margin: 0; padding: 6mm; font-family: Inter, Arial, sans-serif; color: #0f172a; }
.badge { height: 43mm; border-radius: 6px; border: 1px solid #cbd5e1; padding: 6mm; text-align: center; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
.name { font-size: 21pt; font-weight: 850; line-height: 1.05; }
.meta { margin-top: 3mm; color: #64748b; font-size: 9pt; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; }`,
    html: `<section class="badge">
  <div class="name">${primaryValue}</div>
  <div class="meta">{{ table.name }}</div>
</section>`,
  },
];

export const documentTemplateStarterById = (id: string): DocumentTemplateStarter | undefined =>
  DOCUMENT_TEMPLATE_STARTERS.find((starter) => starter.id === id);
