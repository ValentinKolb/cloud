import { DocInlineCode, DocRows, DocSection } from "@valentinkolb/cloud/ui";
import { For } from "solid-js";
import { BARCODE_SYMBOL_IDS, CURATED_BARCODE_OPTIONS } from "../table/barcode-options";
import { TemplateSnippet } from "./grids-help-content";

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

export const GridsTemplateLanguageReference = () => (
  <>
    <DocSection title="Liquid reference">
      <p class="text-dimmed">
        Template parts use LiquidJS with Grids restrictions: strict variables, strict filters, escaped output, no layouts, no dynamic
        partials, and only the tags listed below. Unknown filters, invalid tags, and oversized output fail instead of rendering a partial
        document.
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
                Pipe values through filters, for example <DocInlineCode>{"{{ row.Name | default: '-' }}"}</DocInlineCode>. Unknown filters
                fail.
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
                Use <DocInlineCode>{"{% for row in rows %}"}</DocInlineCode> and <DocInlineCode>{"{% endfor %}"}</DocInlineCode>. Break and
                continue are allowed.
              </span>
            ),
          },
          {
            title: "Temporary values",
            icon: "ti-variable",
            text: (
              <span>
                Use <DocInlineCode>assign</DocInlineCode> for short values and <DocInlineCode>capture</DocInlineCode> for longer rendered
                fragments.
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
        Use the <DocInlineCode>barcode_data_url</DocInlineCode> filter in an <DocInlineCode>{"<img>"}</DocInlineCode> tag. Barcode ids are
        lowercase symbols. The optional third argument controls human-readable text for barcode formats that support it.
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
);
