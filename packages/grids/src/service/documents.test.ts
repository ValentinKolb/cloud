import { describe, expect, test } from "bun:test";
import { DOCUMENT_TEMPLATE_STARTERS } from "../document-template-starters";
import {
  buildRenderData,
  buildTemplateAppData,
  buildTemplateInputContext,
  documentNumberFor,
  renderDocumentHtml,
  renderDocumentSource,
  renderLiquidText,
  rowsWithColumnLabels,
  validateLiquidTemplate,
} from "./documents";

describe("document rendering", () => {
  test("exposes stable public app data to document templates", async () => {
    const app = await buildTemplateAppData({
      app: {
        name: "Operations Cloud",
        url: "cloud.example.test",
        contact_email: "support@example.test",
        copyright: "Example GmbH",
        timezone: "Europe/Berlin",
        logo: "data:image/png;base64,abc",
      },
    });

    expect(app).toMatchObject({
      name: "Operations Cloud",
      url: "https://cloud.example.test",
      contactEmail: "support@example.test",
      copyright: "Example GmbH",
      timezone: "Europe/Berlin",
      logoDataUri: "data:image/png;base64,abc",
    });

    const table = { id: "table-1", shortId: "tbl1", name: "Items" };
    const record = {
      id: "record-1",
      tableId: "table-1",
      version: 1,
      data: { name: "Camera" },
      createdAt: "2026-06-28T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    };

    expect(buildTemplateInputContext(record, table, app).app).toEqual(app);
    expect(buildRenderData({ record, table, columns: [], rows: [], app }).app).toEqual(app);
  });

  test("renders Liquid templates with escaped output by default", async () => {
    const result = await renderDocumentHtml({ html: "<p>{{ record.data.name }}</p>" }, { record: { data: { name: "<b>Ada</b>" } } });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("<p>&lt;b&gt;Ada&lt;&#x2F;b&gt;</p>");
  });

  test("allows explicit raw output for trusted template authors", async () => {
    const result = await renderLiquidText("{{ value | raw }}", { value: "<strong>OK</strong>" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("<strong>OK</strong>");
  });

  test("renders barcode data URLs through the document Liquid filter", async () => {
    const result = await renderLiquidText(`<img src="{{ value | barcode_data_url: "code128", true }}">`, { value: "ITEM-0001" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toContain("data:image&#x2F;svg+xml;base64,");
  });

  test("reports invalid barcode filters as template errors", async () => {
    const result = await renderLiquidText(`{{ value | barcode_data_url: "Code 128" }}`, { value: "ITEM-0001" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('invalid barcode type "Code 128"');
  });

  test("rejects partial-style tags that could load external template content", () => {
    const result = validateLiquidTemplate("{% include 'other' %}");

    expect(result.ok).toBe(false);
  });

  test("all document template starters use valid Liquid", () => {
    for (const starter of DOCUMENT_TEMPLATE_STARTERS) {
      const parts = [
        ["source", starter.source("11111111-1111-4111-8111-111111111111")],
        ["html", starter.html],
        ["headerHtml", starter.headerHtml],
        ["footerHtml", starter.footerHtml],
        ["pageCss", starter.pageCss],
      ] as const;

      for (const [part, value] of parts) {
        if (!value) continue;
        const result = validateLiquidTemplate(value);
        expect(result.ok, `${starter.id} ${part}: ${result.ok ? "" : result.error.message}`).toBe(true);
      }
    }
  });

  test("document template starters can render app branding", async () => {
    const app = await buildTemplateAppData({
      app: {
        name: "Operations Cloud",
        url: "https://cloud.example.test",
        contact_email: "support@example.test",
        logo: "data:image/png;base64,abc",
      },
    });
    const invoice = DOCUMENT_TEMPLATE_STARTERS.find((starter) => starter.id === "invoice");
    expect(invoice?.headerHtml).toBeTruthy();
    if (!invoice?.headerHtml) throw new Error("invoice starter header is missing");

    const result = await renderLiquidText(invoice.headerHtml, { app });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("Operations Cloud");
      expect(result.data).toContain("support@example.test");
      expect(result.data).toContain("data:image&#x2F;png;base64,abc");
    }
  });

  test("renders GQL source templates with the same constrained Liquid context", async () => {
    const result = await renderDocumentSource(
      { source: "from table Invoices\nwhere record.id = '{{ record.id }}'" },
      { record: { id: "11111111-1111-4111-8111-111111111111" } },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toContain("11111111-1111-4111-8111-111111111111");
  });

  test("document number is stable for a run and contains the record id prefix", () => {
    expect(
      documentNumberFor({
        runId: "11111111-2222-7333-8444-aaaaaaaaaaaa",
        recordId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        generatedAt: new Date("2026-06-26T12:00:00.000Z"),
      }),
    ).toBe("GRID-20260626-BBBBBBBB-AAAAAAAAAAAA");
  });

  test("rows expose GQL output labels for ergonomic Liquid templates", () => {
    expect(rowsWithColumnLabels([{ key: "field_id", label: "Name" }], [{ field_id: "Sony A7 body" }])).toEqual([
      { field_id: "Sony A7 body", Name: "Sony A7 body" },
    ]);
  });
});
