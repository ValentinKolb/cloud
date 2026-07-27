---
title: PDF and templates
navTitle: PDF and templates
section: Platform services
order: 590
description: Render documents from application data with shared template and PDF services.
tags: [pdf, templates, gotenberg]
updated: 2026-07-27
---

# PDF and templates

Cloud can render HTML as PDF through the deployment's Gotenberg service.

The application owns the document data and HTML. Cloud owns connection
settings, authentication, timeouts, and size limits.

## Render HTML

```ts
import { renderHtmlToPdf } from "@valentinkolb/cloud/services";

const result = await renderHtmlToPdf({
  html: "<!doctype html><html><body><h1>Stock report</h1></body></html>",
  headerHtml: null,
  footerHtml: "<p>Inventory</p>",
});

return new Response(result.pdf, {
  headers: {
    "Content-Type": result.contentType,
    "Content-Disposition": 'attachment; filename="stock-report.pdf"',
  },
});
```

`html` is required. `headerHtml` and `footerHtml` are optional.

Cloud sends the HTML to Gotenberg with background printing and CSS page sizes
enabled. The result contains PDF bytes and the returned content type.

## Render a Liquid template

Use `renderTemplatePdfPreview()` when an operator edits a Liquid template and
needs one structured result for both template and PDF errors:

```ts
const preview = await renderTemplatePdfPreview({
  htmlTemplate: "<h1>{{ item.name }}</h1>",
  pageCssTemplate: "@page { size: A4; margin: 20mm; }",
  data: { item },
});

if (!preview.ok) {
  return c.json(preview.error, preview.error.status);
}

return new Response(preview.pdf.pdf, {
  headers: { "Content-Type": preview.pdf.contentType },
});
```

The input may include header, footer, and page CSS templates. It also accepts
custom Liquid filters.

The result separates the `template` phase from the `pdf` phase. Do not expose
template stack traces to end users.

## Merge PDFs

`mergePdfs()` accepts one or more `Uint8Array` PDF files and returns one PDF.
Cloud preserves input order.

An empty file list fails with `bad_input`.

## Handle renderer errors

`GotenbergRenderError.code` is one of:

| Code | Meaning |
| --- | --- |
| `bad_input` | A PDF merge request has no files |
| `not_configured` | The renderer URL or limits are invalid |
| `html_too_large` | HTML exceeds the deployment limit |
| `pdf_too_large` | Output exceeds the deployment limit |
| `request_failed` | The renderer could not be reached |
| `bad_response` | The renderer returned an unsuccessful response |
| `timeout` | The request exceeded its timeout |

Treat configuration and availability failures as operational errors. See
[Runtime configuration](/docs/en/operations/runtime-configuration) and
[Troubleshooting](/docs/en/operations/troubleshooting).

Authorize access to the document data before rendering. Avoid remote assets
whose availability or credentials are outside the document request.
