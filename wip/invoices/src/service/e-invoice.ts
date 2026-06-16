import { createHash } from "node:crypto";
import {
  DocumentTypeCode,
  Flavor,
  Profile,
  UnitCode,
  VatCategoryCode,
  embedFacturX,
  toXRechnung,
  validateInput,
  validateXsd,
  type FacturXInvoiceInput,
} from "@stackforge-eu/factur-x";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { get, registerArtifact } from "./invoices";
import { parseJsonRecord, type JsonRecord } from "./shared";
import { resolveTaxRule } from "./tax";
import type { InvoiceActor, InvoiceArtifact, InvoiceDetail, InvoicePartySnapshot } from "./types";

export type GeneratedXRechnungArtifact = {
  xml: string;
  sha256: string;
  byteSize: number;
  artifact: InvoiceArtifact;
};

export type EmbeddedZugferdPdf = {
  pdf: Uint8Array;
  xml: string;
  sha256: string;
  byteSize: number;
};

export type GeneratedZugferdPdfArtifact = EmbeddedZugferdPdf & {
  artifact: InvoiceArtifact;
};

const centsToDecimal = (value: number): number => Number((value / 100).toFixed(2));

const percentFromBps = (value: number): number => Number((value / 100).toFixed(2));

const stringField = (record: JsonRecord, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const paymentFromComplianceSnapshot = (invoice: InvoiceDetail): NonNullable<FacturXInvoiceInput["payment"]> => {
  const issuer = parseJsonRecord(invoice.complianceSnapshot.issuer);
  const template = parseJsonRecord(invoice.complianceSnapshot.template);
  const paymentTermsDays = template.paymentTermsDays;
  const terms =
    typeof paymentTermsDays === "number" && Number.isInteger(paymentTermsDays)
      ? `Payment due within ${paymentTermsDays} day${paymentTermsDays === 1 ? "" : "s"}.`
      : undefined;

  const iban = stringField(issuer, "iban");
  const bic = stringField(issuer, "bic");
  const bankName = stringField(issuer, "bankName");

  return {
    meansCode: iban ? "58" : undefined,
    dueDate: invoice.dueDate ?? undefined,
    paymentReference: invoice.invoiceNumber ?? undefined,
    ...(iban ? { iban } : {}),
    ...(bic ? { bic } : {}),
    ...(bankName ? { accountName: bankName } : {}),
    ...(terms ? { termsDescription: terms } : {}),
  };
};

const addressFromParty = (party: InvoicePartySnapshot): Result<NonNullable<FacturXInvoiceInput["seller"]["address"]>> => {
  const address = parseJsonRecord(party.address);
  const line1 = stringField(address, "line1");
  const city = stringField(address, "city");
  const postalCode = stringField(address, "postalCode");
  const country = stringField(address, "country") || party.country;
  if (!line1 || !city || !postalCode || !country) {
    return fail(err.badInput(`${party.role} address requires line1, postalCode, city, and country`));
  }

  const line2 = stringField(address, "line2");
  const region = stringField(address, "region");
  return ok({
    line1,
    city,
    postalCode,
    country,
    ...(line2 ? { line2 } : {}),
    ...(region ? { subdivision: region } : {}),
  });
};

const taxRegistrationsFor = (party: InvoicePartySnapshot): NonNullable<FacturXInvoiceInput["seller"]["taxRegistrations"]> => {
  const registrations: NonNullable<FacturXInvoiceInput["seller"]["taxRegistrations"]> = [];
  if (party.vatId?.trim()) registrations.push({ id: party.vatId.trim(), schemeId: "VA" });
  if (party.taxNumber?.trim()) registrations.push({ id: party.taxNumber.trim(), schemeId: "FC" });
  return registrations;
};

const tradePartyFromSnapshot = (party: InvoicePartySnapshot): Result<FacturXInvoiceInput["seller"]> => {
  const address = addressFromParty(party);
  if (!address.ok) return address;

  return ok({
    name: party.name,
    address: address.data,
    ...(party.email || party.phone
      ? {
          contact: {
            ...(party.email ? { email: party.email } : {}),
            ...(party.phone ? { phone: party.phone } : {}),
          },
        }
      : {}),
    ...(party.email ? { electronicAddress: { value: party.email, schemeID: "EM" } } : {}),
    taxRegistrations: taxRegistrationsFor(party),
  });
};

const unitCodeFor = (unit: string): UnitCode | string => {
  const normalized = unit.trim().toLowerCase();
  if (["hour", "hours", "h", "std", "stunde", "stunden"].includes(normalized)) return UnitCode.HOUR;
  if (["day", "days", "d", "tag", "tage"].includes(normalized)) return UnitCode.DAY;
  if (["month", "months", "monat", "monate"].includes(normalized)) return UnitCode.MONTH;
  if (["kg", "kilogram", "kilogramm"].includes(normalized)) return UnitCode.KILOGRAM;
  return UnitCode.UNIT;
};

const vatCategoryFor = (code: string): VatCategoryCode | string => {
  if (code === VatCategoryCode.STANDARD_RATE) return VatCategoryCode.STANDARD_RATE;
  if (code === VatCategoryCode.ZERO_RATED) return VatCategoryCode.ZERO_RATED;
  if (code === VatCategoryCode.EXEMPT) return VatCategoryCode.EXEMPT;
  if (code === VatCategoryCode.REVERSE_CHARGE) return VatCategoryCode.REVERSE_CHARGE;
  if (code === VatCategoryCode.INTRA_COMMUNITY_SUPPLY) return VatCategoryCode.INTRA_COMMUNITY_SUPPLY;
  if (code === VatCategoryCode.FREE_EXPORT) return VatCategoryCode.FREE_EXPORT;
  if (code === VatCategoryCode.OUTSIDE_SCOPE) return VatCategoryCode.OUTSIDE_SCOPE;
  if (code === VatCategoryCode.CANARY_ISLANDS_TAX) return VatCategoryCode.CANARY_ISLANDS_TAX;
  if (code === VatCategoryCode.CEUTA_MELILLA_TAX) return VatCategoryCode.CEUTA_MELILLA_TAX;
  return code;
};

const vatCategoryForTaxCode = (taxCode: string): Result<VatCategoryCode | string> => {
  const rule = resolveTaxRule(taxCode);
  if (!rule.ok) return rule;
  return ok(vatCategoryFor(rule.data.eInvoiceCategoryCode));
};

export const buildXRechnungInput = (invoice: InvoiceDetail): Result<FacturXInvoiceInput> => {
  if (invoice.status !== "issued") return fail(err.badInput("Only issued invoices can be exported as XRechnung"));
  if (invoice.documentType !== "invoice") {
    return fail(err.badInput("Correction and cancellation e-invoices require explicit correction semantics first"));
  }
  if (!invoice.invoiceNumber || !invoice.issueDate) return fail(err.badInput("Issued invoice number and issue date are required"));
  if (!invoice.servicePeriodStart || !invoice.servicePeriodEnd) return fail(err.badInput("Issued invoice service period is required"));
  if (invoice.roundingDeltaCents !== 0) return fail(err.badInput("E-invoice rounding deltas are not supported yet"));

  const sellerSnapshot = invoice.parties.find((party) => party.role === "seller") ?? null;
  const buyerSnapshot = invoice.parties.find((party) => party.role === "buyer") ?? null;
  if (!sellerSnapshot || !buyerSnapshot) return fail(err.badInput("Seller and buyer snapshots are required"));

  const seller = tradePartyFromSnapshot(sellerSnapshot);
  if (!seller.ok) return seller;
  const buyer = tradePartyFromSnapshot(buyerSnapshot);
  if (!buyer.ok) return buyer;

  const buyerReference = buyerSnapshot.leitwegId?.trim() || buyerSnapshot.buyerReference?.trim() || undefined;
  const lines: NonNullable<FacturXInvoiceInput["lines"]> = [];
  for (const line of invoice.lines) {
    const vatCategory = vatCategoryForTaxCode(line.taxCode);
    if (!vatCategory.ok) return vatCategory;
    lines.push({
      id: String(line.position),
      name: line.title,
      quantity: line.quantity,
      unitCode: unitCodeFor(line.unit),
      unitPrice: centsToDecimal(line.unitPriceNetCents),
      lineTotal: centsToDecimal(line.totalNetCents),
      vatCategoryCode: vatCategory.data,
      vatRatePercent: percentFromBps(line.taxRateBps),
      ...(line.description ? { description: line.description } : {}),
      ...(line.articleSku ? { sellerAssignedId: line.articleSku } : {}),
    });
  }

  const input: FacturXInvoiceInput = {
    document: {
      id: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      typeCode: DocumentTypeCode.COMMERCIAL_INVOICE,
      dueDate: invoice.dueDate ?? undefined,
      buyerReference,
      businessProcessId: "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0",
    },
    seller: seller.data,
    buyer: buyer.data,
    lines,
    totals: {
      lineTotal: centsToDecimal(invoice.subtotalNetCents),
      taxBasisTotal: centsToDecimal(invoice.subtotalNetCents),
      taxTotal: centsToDecimal(invoice.taxTotalCents),
      grandTotal: centsToDecimal(invoice.totalGrossCents),
      duePayableAmount: centsToDecimal(invoice.totalGrossCents),
      currency: invoice.currency,
    },
    vatBreakdown: invoice.taxBreakdowns.map((breakdown) => ({
      categoryCode: vatCategoryFor(breakdown.eInvoiceCategoryCode),
      ratePercent: percentFromBps(breakdown.taxRateBps),
      taxableAmount: centsToDecimal(breakdown.taxableAmountCents),
      taxAmount: centsToDecimal(breakdown.taxAmountCents),
      ...(breakdown.legalReasonText ? { exemptionReason: breakdown.legalReasonText } : {}),
      ...(breakdown.legalReasonCode ? { exemptionReasonCode: breakdown.legalReasonCode } : {}),
    })),
    payment: paymentFromComplianceSnapshot(invoice),
    delivery: {
      date: invoice.servicePeriodEnd,
    },
    billingPeriod: {
      startDate: invoice.servicePeriodStart,
      endDate: invoice.servicePeriodEnd,
    },
  };

  const validation = validateInput(input, Profile.EN16931, Flavor.XRECHNUNG);
  if (!validation.valid) {
    return fail(err.badInput(`XRechnung input is invalid: ${validation.errors[0]?.message ?? "Unknown validation error"}`));
  }
  return ok(input);
};

const buildZugferdInput = (invoice: InvoiceDetail): Result<FacturXInvoiceInput> => {
  const input = buildXRechnungInput(invoice);
  if (!input.ok) return input;

  const validation = validateInput(input.data, Profile.EN16931, Flavor.ZUGFERD);
  if (!validation.valid) {
    return fail(err.badInput(`ZUGFeRD input is invalid: ${validation.errors[0]?.message ?? "Unknown validation error"}`));
  }
  return input;
};

export const generateXRechnungXml = async (invoice: InvoiceDetail): Promise<Result<{ xml: string; validationReport: JsonRecord }>> => {
  const input = buildXRechnungInput(invoice);
  if (!input.ok) return input;

  const { xml } = toXRechnung(input.data, { profile: Profile.EN16931 });
  const xsd = await validateXsd(xml, Profile.EN16931);
  if (!xsd.valid) {
    return fail(err.badInput(`Generated XRechnung XML failed XSD validation: ${xsd.errors[0]?.message ?? "Unknown validation error"}`));
  }

  return ok({
    xml,
    validationReport: {
      generator: "@stackforge-eu/factur-x",
      profile: Profile.EN16931,
      flavor: Flavor.XRECHNUNG,
      xsdValid: xsd.valid,
      xsdErrors: xsd.errors,
    },
  });
};

export const generateXRechnungXmlArtifact = async (input: {
  workspaceId: string;
  invoiceId: string;
  actor: InvoiceActor;
}): Promise<Result<GeneratedXRechnungArtifact>> => {
  const invoice = await get({ workspaceId: input.workspaceId, id: input.invoiceId, actor: input.actor });
  if (!invoice) return fail(err.notFound("Invoice"));

  const generated = await generateXRechnungXml(invoice);
  if (!generated.ok) return generated;

  const sha256 = createHash("sha256").update(generated.data.xml).digest("hex");
  const byteSize = Buffer.byteLength(generated.data.xml, "utf8");
  const buyer = invoice.parties.find((party) => party.role === "buyer") ?? null;
  const artifact = await registerArtifact({
    workspaceId: input.workspaceId,
    actor: input.actor,
    data: {
      invoiceId: invoice.id,
      artifactType: "xrechnung_xml",
      profile: "XRechnung",
      profileVersion: "EN16931",
      syntax: "UN/CEFACT CII",
      mimeType: "application/xml",
      storageRef: `generated://invoices/${invoice.id}/xrechnung-${sha256}.xml`,
      sha256,
      byteSize,
      validationStatus: "generated",
      validationReport: {
        ...generated.data.validationReport,
        validationScope: "generator-input-and-xsd-only",
      },
      buyerReference: buyer?.buyerReference ?? null,
      leitwegId: buyer?.leitwegId ?? null,
    },
  });
  if (!artifact.ok) return artifact;

  return ok({
    xml: generated.data.xml,
    sha256,
    byteSize,
    artifact: artifact.data,
  });
};

export const embedZugferdPdf = async (input: {
  invoice: InvoiceDetail;
  pdf: Uint8Array;
  rgbIccProfile?: Uint8Array;
  outputIntentIdentifier?: string;
}): Promise<Result<EmbeddedZugferdPdf>> => {
  const facturXInput = buildZugferdInput(input.invoice);
  if (!facturXInput.ok) return facturXInput;

  const embedded = await embedFacturX({
    pdf: input.pdf,
    input: facturXInput.data,
    profile: Profile.EN16931,
    flavor: Flavor.ZUGFERD,
    validateBeforeEmbed: true,
    validateXsd: true,
    rgbIccProfile: input.rgbIccProfile,
    outputIntentIdentifier: input.outputIntentIdentifier,
    unembeddedFonts: "ignore",
    meta: {
      title: input.invoice.invoiceNumber ?? "Invoice",
      subject: "ZUGFeRD invoice",
      creator: "@valentinkolb/cloud-app-invoices",
    },
  });

  if (embedded.xsdValidation && !embedded.xsdValidation.valid) {
    return fail(err.badInput(`Embedded ZUGFeRD XML failed XSD validation: ${embedded.xsdValidation.errors[0]?.message ?? "Unknown validation error"}`));
  }

  const sha256 = createHash("sha256").update(embedded.pdf).digest("hex");
  return ok({
    pdf: embedded.pdf,
    xml: embedded.xml,
    sha256,
    byteSize: embedded.pdf.byteLength,
  });
};

export const generateZugferdPdfArtifact = async (input: {
  workspaceId: string;
  invoiceId: string;
  actor: InvoiceActor;
  pdf: Uint8Array;
  rgbIccProfile: Uint8Array;
  outputIntentIdentifier?: string;
}): Promise<Result<GeneratedZugferdPdfArtifact>> => {
  if (input.rgbIccProfile.byteLength === 0) return fail(err.badInput("ZUGFeRD PDF/A-3 artifacts require an RGB ICC profile"));
  const invoice = await get({ workspaceId: input.workspaceId, id: input.invoiceId, actor: input.actor });
  if (!invoice) return fail(err.notFound("Invoice"));

  const embedded = await embedZugferdPdf({
    invoice,
    pdf: input.pdf,
    rgbIccProfile: input.rgbIccProfile,
    outputIntentIdentifier: input.outputIntentIdentifier,
  });
  if (!embedded.ok) return embedded;

  const buyer = invoice.parties.find((party) => party.role === "buyer") ?? null;
  const artifact = await registerArtifact({
    workspaceId: input.workspaceId,
    actor: input.actor,
    data: {
      invoiceId: invoice.id,
      artifactType: "zugferd_pdf",
      profile: "ZUGFeRD",
      profileVersion: "EN16931",
      syntax: "PDF/A-3 + UN/CEFACT CII",
      mimeType: "application/pdf",
      storageRef: `generated://invoices/${invoice.id}/zugferd-${embedded.data.sha256}.pdf`,
      sha256: embedded.data.sha256,
      byteSize: embedded.data.byteSize,
      validationStatus: "generated",
      validationReport: {
        generator: "@stackforge-eu/factur-x",
        profile: Profile.EN16931,
        flavor: Flavor.ZUGFERD,
        embeddedXmlSha256: createHash("sha256").update(embedded.data.xml).digest("hex"),
        validationScope: "generator-input-and-xsd-only",
      },
      buyerReference: buyer?.buyerReference ?? null,
      leitwegId: buyer?.leitwegId ?? null,
    },
  });
  if (!artifact.ok) return artifact;

  return ok({
    ...embedded.data,
    artifact: artifact.data,
  });
};
