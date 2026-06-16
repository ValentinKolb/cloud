import { describe, expect, test } from "bun:test";
import { extractXml } from "@stackforge-eu/factur-x";
import { PDFDocument } from "pdf-lib";
import { buildXRechnungInput, embedZugferdPdf, generateXRechnungXml } from "./e-invoice";
import type { InvoiceDetail, InvoiceLine, InvoicePartySnapshot, InvoiceTaxBreakdown } from "./types";

const now = "2026-06-04T00:00:00.000Z";

const seller: InvoicePartySnapshot = {
  id: "seller",
  invoiceId: "invoice",
  role: "seller",
  contactId: null,
  name: "Example Seller GmbH",
  address: { line1: "Seller Street 1", postalCode: "10115", city: "Berlin", country: "DE" },
  country: "DE",
  vatId: "DE123456789",
  taxNumber: null,
  email: "billing@example-seller.test",
  phone: null,
  recipientKind: null,
  supplyType: null,
  buyerReference: null,
  leitwegId: null,
  createdAt: now,
};

const buyer: InvoicePartySnapshot = {
  id: "buyer",
  invoiceId: "invoice",
  role: "buyer",
  contactId: null,
  name: "Example Buyer AG",
  address: { line1: "Buyer Street 2", postalCode: "20095", city: "Hamburg", country: "DE" },
  country: "DE",
  vatId: "DE987654321",
  taxNumber: null,
  email: "ap@example-buyer.test",
  phone: null,
  recipientKind: "public_sector",
  supplyType: "service",
  buyerReference: "BUYER-REF-1",
  leitwegId: "04011000-12345-67",
  createdAt: now,
};

const line: InvoiceLine = {
  id: "line",
  invoiceId: "invoice",
  position: 1,
  kind: "item",
  externalLineId: null,
  articleId: null,
  articleSku: "CONSULTING",
  title: "Consulting Service",
  description: "Implementation support",
  quantity: 2,
  unit: "hour",
  unitPriceNetCents: 10000,
  discountCents: 0,
  taxCode: "vat_de_standard_19",
  taxCategory: "standard",
  taxRateBps: 1900,
  taxCountry: "DE",
  legalReasonCode: null,
  legalReasonText: null,
  totalNetCents: 20000,
  totalTaxCents: 3800,
  totalGrossCents: 23800,
  metadata: {},
  createdAt: now,
  updatedAt: now,
};

const breakdown: InvoiceTaxBreakdown = {
  id: "breakdown",
  invoiceId: "invoice",
  taxCode: "vat_de_standard_19",
  taxCategory: "standard",
  taxRateBps: 1900,
  taxCountry: "DE",
  eInvoiceCategoryCode: "S",
  legalReasonCode: null,
  legalReasonText: null,
  taxableAmountCents: 20000,
  taxAmountCents: 3800,
  createdAt: now,
};

const invoice: InvoiceDetail = {
  id: "invoice",
  workspaceId: "workspace",
  documentType: "invoice",
  status: "issued",
  templateId: "template",
  templateVersionId: "template-version",
  issuerProfileId: "issuer-profile",
  sequenceId: "sequence",
  invoiceNumber: "INV-2026-0001",
  contactId: null,
  source: "manual",
  issueDate: "2026-06-04",
  dueDate: "2026-06-18",
  servicePeriodStart: "2026-06-01",
  servicePeriodEnd: "2026-06-04",
  currency: "EUR",
  subtotalNetCents: 20000,
  taxTotalCents: 3800,
  totalGrossCents: 23800,
  roundingDeltaCents: 0,
  paymentStatus: "untracked",
  complianceSnapshot: {
    issuer: {
      bankName: "Example Bank",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      taxRegime: "standard",
      eInvoiceProfile: "xrechnung",
    },
    template: {
      versionId: "template-version",
      paymentTermsDays: 14,
      currency: "EUR",
      layoutSettings: {},
      eInvoiceDefaults: {},
    },
  },
  version: 2,
  createdBy: null,
  updatedBy: null,
  issuedBy: null,
  createdAt: now,
  updatedAt: now,
  issuedAt: now,
  lines: [line],
  parties: [seller, buyer],
  taxBreakdowns: [breakdown],
};

describe("e-invoice generation", () => {
  test("maps issued invoice details to Factur-X/XRechnung input", () => {
    const input = buildXRechnungInput(invoice);
    if (!input.ok) throw new Error(input.error.message);
    expect(input.ok).toBe(true);

    expect(input.data.document.id).toBe("INV-2026-0001");
    expect(input.data.document.buyerReference).toBe("04011000-12345-67");
    expect(input.data.seller.name).toBe("Example Seller GmbH");
    expect(input.data.buyer.name).toBe("Example Buyer AG");
    expect(input.data.lines?.[0]?.name).toBe("Consulting Service");
    expect(input.data.lines?.[0]?.unitPrice).toBe(100);
    expect(input.data.vatBreakdown?.[0]?.categoryCode).toBe("S");
    expect(input.data.totals.grandTotal).toBe(238);
    expect(input.data.payment?.iban).toBe("DE89370400440532013000");
    expect(input.data.payment?.bic).toBe("COBADEFFXXX");
  });

  test("generates XRechnung XML with required structured fields", async () => {
    const generated = await generateXRechnungXml(invoice);
    if (!generated.ok) throw new Error(generated.error.message);
    expect(generated.ok).toBe(true);

    expect(generated.data.xml).toContain("INV-2026-0001");
    expect(generated.data.xml).toContain("Example Seller GmbH");
    expect(generated.data.xml).toContain("Example Buyer AG");
    expect(generated.data.xml).toContain("04011000-12345-67");
    expect(generated.data.xml).toContain("Consulting Service");
    expect(generated.data.xml).toContain("238.00");
    expect(generated.data.validationReport.xsdValid).toBe(true);
  });

  test("embeds ZUGFeRD XML into an existing PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 200]);
    const sourcePdf = await pdf.save();

    const embedded = await embedZugferdPdf({ invoice, pdf: sourcePdf });
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) throw new Error(embedded.error.message);

    expect(embedded.data.byteSize).toBeGreaterThan(sourcePdf.byteLength);
    expect(embedded.data.xml).toContain("INV-2026-0001");
    const extracted = await extractXml(embedded.data.pdf);
    expect(extracted.xml).toContain("INV-2026-0001");
    expect(extracted.xml).toContain("Consulting Service");
  });
});
