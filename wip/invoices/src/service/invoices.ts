import { createHash } from "node:crypto";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { requireInvoiceUser, requireTemplatePermission } from "./authz";
import { calculateLineTax, resolveTaxRule, summarizeTaxBreakdowns, type InvoiceLineTaxResult, type TaxCategory } from "./tax";
import {
  emptyToNull,
  isUuid,
  normalizeCountry,
  normalizeCurrency,
  parseJsonRecord,
  toDateOnly,
  toJsonb,
  type JsonRecord,
} from "./shared";
import type {
  CreateInvoiceCorrectionInput,
  CreateInvoiceDraftInput,
  CreateInvoiceDraftFromExternalRefInput,
  InvoiceActor,
  Invoice,
  InvoiceArtifact,
  InvoiceArtifactDeliverability,
  InvoiceArtifactType,
  InvoiceArtifactValidationStatus,
  InvoiceDetail,
  InvoiceDocumentType,
  InvoiceExternalRefInput,
  InvoiceExternalRefLookupInput,
  InvoiceIssueReadiness,
  InvoiceIssueReadinessItem,
  InvoiceLine,
  InvoiceLineInput,
  InvoicePartyInput,
  InvoicePartyRole,
  InvoicePartySnapshot,
  InvoiceRecipientKind,
  InvoiceStatus,
  InvoiceSupplyType,
  InvoiceTaxBreakdown,
  RegisterInvoiceArtifactInput,
  RegisterTrustedInvoiceArtifactInput,
  IssueInvoiceDraftInput,
  UpdateInvoiceDraftInput,
} from "./types";

type SqlClient = typeof sql;

type DbInvoice = {
  id: string;
  workspace_id: string;
  document_type: InvoiceDocumentType;
  status: InvoiceStatus;
  template_id: string;
  template_version_id: string | null;
  issuer_profile_id: string;
  sequence_id: string | null;
  invoice_number: string | null;
  contact_id: string | null;
  source: string;
  issue_date: Date | string | null;
  due_date: Date | string | null;
  service_period_start: Date | string | null;
  service_period_end: Date | string | null;
  currency: string;
  subtotal_net_cents: number | string;
  tax_total_cents: number | string;
  total_gross_cents: number | string;
  rounding_delta_cents: number | string;
  payment_status: Invoice["paymentStatus"];
  compliance_snapshot: unknown;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  issued_by: string | null;
  created_at: Date;
  updated_at: Date;
  issued_at: Date | null;
};

type DbLine = {
  id: string;
  invoice_id: string;
  position: number;
  kind: string;
  external_line_id: string | null;
  article_id: string | null;
  article_sku: string | null;
  title: string;
  description: string | null;
  quantity: number | string;
  unit: string;
  unit_price_net_cents: number | string;
  discount_cents: number | string;
  tax_code: string;
  tax_category: string;
  tax_rate_bps: number;
  tax_country: string;
  legal_reason_code: string | null;
  legal_reason_text: string | null;
  total_net_cents: number | string;
  total_tax_cents: number | string;
  total_gross_cents: number | string;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
};

type DbParty = {
  id: string;
  invoice_id: string;
  role: InvoicePartyRole;
  contact_id: string | null;
  name: string;
  address: unknown;
  country: string;
  vat_id: string | null;
  tax_number: string | null;
  email: string | null;
  phone: string | null;
  recipient_kind: InvoiceRecipientKind | null;
  supply_type: InvoiceSupplyType | null;
  buyer_reference: string | null;
  leitweg_id: string | null;
  created_at: Date;
};

type DbBreakdown = {
  id: string;
  invoice_id: string;
  tax_code: string;
  tax_category: string;
  tax_rate_bps: number;
  tax_country: string;
  e_invoice_category_code: string;
  legal_reason_code: string | null;
  legal_reason_text: string | null;
  taxable_amount_cents: number | string;
  tax_amount_cents: number | string;
  created_at: Date;
};

type DbArtifact = {
  id: string;
  invoice_id: string;
  artifact_type: InvoiceArtifactType;
  profile: string;
  profile_version: string | null;
  syntax: string | null;
  mime_type: string;
  storage_ref: string | null;
  sha256: string | null;
  byte_size: number | string | null;
  validation_status: InvoiceArtifactValidationStatus;
  validation_report: unknown;
  validator_bundle_version: string | null;
  validated_at: Date | null;
  buyer_reference: string | null;
  leitweg_id: string | null;
  template_version_id: string | null;
  invoice_version: number;
  supersedes_artifact_id: string | null;
  created_by: string | null;
  created_at: Date;
};

type TemplateForDraft = {
  template_id: string;
  template_version_id: string;
  issuer_profile_id: string;
  number_sequence_id: string;
  sequence_document_type: InvoiceDocumentType;
  payment_terms_days: number;
  currency: string;
};

type DbIssuerSnapshot = {
  id: string;
  name: string;
  address: unknown;
  country: string;
  tax_number: string | null;
  vat_id: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  iban: string | null;
  bic: string | null;
  default_payment_terms_days: number;
  default_currency: string;
  locale: string;
  tax_regime: string;
  e_invoice_profile: string;
};

type DbIssueDefaults = {
  payment_terms_days: number;
  currency: string;
  layout_settings: unknown;
  e_invoice_defaults: unknown;
};

type IdempotencyRow = {
  id: string;
  request_hash: string;
  result_ref: string | null;
  status: "started" | "completed" | "failed";
};

type IdempotencyReservation = {
  replayResultRef: string | null;
};

type DbExternalRef = {
  invoice_id: string;
  payload_hash: string;
};

type PreparedLine = InvoiceLineInput & {
  position: number;
  taxCategory: TaxCategory;
  taxRateBps: number;
  taxCountry: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
  totalNetCents: number;
  totalTaxCents: number;
  totalGrossCents: number;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const hashRequest = (value: unknown): string => createHash("sha256").update(stableStringify(value)).digest("hex");

class StringResultRollback extends Error {
  constructor(readonly result: Result<string>) {
    super("Rollback result");
  }
}

const rollbackStringResult = (result: Result<string>): never => {
  throw new StringResultRollback(result);
};

const stringResultTransaction = async (run: (client: SqlClient) => Promise<Result<string>>): Promise<Result<string>> => {
  try {
    return await sql.begin(run);
  } catch (error: unknown) {
    if (error instanceof StringResultRollback) return error.result;
    throw error;
  }
};

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const mapInvoice = (row: DbInvoice): Invoice => ({
  id: row.id,
  workspaceId: row.workspace_id,
  documentType: row.document_type,
  status: row.status,
  templateId: row.template_id,
  templateVersionId: row.template_version_id,
  issuerProfileId: row.issuer_profile_id,
  sequenceId: row.sequence_id,
  invoiceNumber: row.invoice_number,
  contactId: row.contact_id,
  source: row.source,
  issueDate: toDateOnly(row.issue_date),
  dueDate: toDateOnly(row.due_date),
  servicePeriodStart: toDateOnly(row.service_period_start),
  servicePeriodEnd: toDateOnly(row.service_period_end),
  currency: row.currency,
  subtotalNetCents: Number(row.subtotal_net_cents),
  taxTotalCents: Number(row.tax_total_cents),
  totalGrossCents: Number(row.total_gross_cents),
  roundingDeltaCents: Number(row.rounding_delta_cents),
  paymentStatus: row.payment_status,
  complianceSnapshot: parseJsonRecord(row.compliance_snapshot),
  version: row.version,
  createdBy: row.created_by,
  updatedBy: row.updated_by,
  issuedBy: row.issued_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  issuedAt: row.issued_at?.toISOString() ?? null,
});

const mapLine = (row: DbLine): InvoiceLine => ({
  id: row.id,
  invoiceId: row.invoice_id,
  position: row.position,
  kind: row.kind,
  externalLineId: row.external_line_id,
  articleId: row.article_id,
  articleSku: row.article_sku,
  title: row.title,
  description: row.description,
  quantity: Number(row.quantity),
  unit: row.unit,
  unitPriceNetCents: Number(row.unit_price_net_cents),
  discountCents: Number(row.discount_cents),
  taxCode: row.tax_code,
  taxCategory: row.tax_category,
  taxRateBps: row.tax_rate_bps,
  taxCountry: row.tax_country,
  legalReasonCode: row.legal_reason_code,
  legalReasonText: row.legal_reason_text,
  totalNetCents: Number(row.total_net_cents),
  totalTaxCents: Number(row.total_tax_cents),
  totalGrossCents: Number(row.total_gross_cents),
  metadata: parseJsonRecord(row.metadata),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const mapParty = (row: DbParty): InvoicePartySnapshot => ({
  id: row.id,
  invoiceId: row.invoice_id,
  role: row.role,
  contactId: row.contact_id,
  name: row.name,
  address: parseJsonRecord(row.address),
  country: row.country,
  vatId: row.vat_id,
  taxNumber: row.tax_number,
  email: row.email,
  phone: row.phone,
  recipientKind: row.recipient_kind,
  supplyType: row.supply_type,
  buyerReference: row.buyer_reference,
  leitwegId: row.leitweg_id,
  createdAt: row.created_at.toISOString(),
});

const mapBreakdown = (row: DbBreakdown): InvoiceTaxBreakdown => ({
  id: row.id,
  invoiceId: row.invoice_id,
  taxCode: row.tax_code,
  taxCategory: row.tax_category,
  taxRateBps: row.tax_rate_bps,
  taxCountry: row.tax_country,
  eInvoiceCategoryCode: row.e_invoice_category_code,
  legalReasonCode: row.legal_reason_code,
  legalReasonText: row.legal_reason_text,
  taxableAmountCents: Number(row.taxable_amount_cents),
  taxAmountCents: Number(row.tax_amount_cents),
  createdAt: row.created_at.toISOString(),
});

const mapArtifact = (row: DbArtifact): InvoiceArtifact => ({
  id: row.id,
  invoiceId: row.invoice_id,
  artifactType: row.artifact_type,
  profile: row.profile,
  profileVersion: row.profile_version,
  syntax: row.syntax,
  mimeType: row.mime_type,
  storageRef: row.storage_ref,
  sha256: row.sha256,
  byteSize: row.byte_size == null ? null : Number(row.byte_size),
  validationStatus: row.validation_status,
  validationReport: parseJsonRecord(row.validation_report),
  validatorBundleVersion: row.validator_bundle_version,
  validatedAt: row.validated_at?.toISOString() ?? null,
  buyerReference: row.buyer_reference,
  leitwegId: row.leitweg_id,
  templateVersionId: row.template_version_id,
  invoiceVersion: row.invoice_version,
  supersedesArtifactId: row.supersedes_artifact_id,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const stringFromRecord = (record: JsonRecord, key: string): string | null => {
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const eInvoiceProfileFromComplianceSnapshot = (snapshot: JsonRecord): string | null => {
  const issuer = parseJsonRecord(snapshot.issuer);
  return stringFromRecord(issuer, "eInvoiceProfile");
};

type EInvoiceRequirement = {
  profile: string;
  profileVersion: string;
  requiredArtifacts: InvoiceArtifactType[];
  sellerCountry: string;
  buyerCountry: string | null;
  recipientKind: InvoiceRecipientKind | null;
  domesticB2B: boolean;
  publicSector: boolean;
  buyerReferenceRequired: boolean;
};

const isInvoiceArtifactType = (value: unknown): value is InvoiceArtifactType =>
  value === "xrechnung_xml" || value === "zugferd_pdf" || value === "pdf_preview";

const requiredFinalArtifactTypesForProfile = (profile: string): Result<InvoiceArtifactType[]> => {
  const normalized = profile.trim().toLowerCase();
  if (["xrechnung", "xml"].includes(normalized)) return ok(["xrechnung_xml"]);
  if (["zugferd", "factur-x", "facturx", "pdf-a-3"].includes(normalized)) return ok(["zugferd_pdf"]);
  if (["both", "xrechnung+zugferd", "xrechnung_zugferd"].includes(normalized)) return ok(["xrechnung_xml", "zugferd_pdf"]);
  return fail(err.badInput(`Unsupported e-invoice profile: ${profile || "empty"}`));
};

const normalizeEInvoiceProfile = (profile: string): string => profile.trim().toLowerCase();

const buildEInvoiceRequirement = (config: { issuer: DbIssuerSnapshot; buyer: InvoicePartySnapshot | null }): Result<EInvoiceRequirement> => {
  const required = requiredFinalArtifactTypesForProfile(config.issuer.e_invoice_profile);
  if (!required.ok) return required;

  const sellerCountry = normalizeCountry(config.issuer.country);
  const buyerCountry = config.buyer?.country ? normalizeCountry(config.buyer.country) : null;
  const recipientKind = config.buyer?.recipientKind ?? null;
  const publicSector = recipientKind === "public_sector";
  if (publicSector && !required.data.includes("xrechnung_xml")) {
    return fail(err.badInput("Public-sector recipients require XRechnung XML in V1"));
  }
  const requiredArtifacts = publicSector ? (["xrechnung_xml"] satisfies InvoiceArtifactType[]) : required.data;

  return ok({
    profile: normalizeEInvoiceProfile(config.issuer.e_invoice_profile),
    profileVersion: "EN16931",
    requiredArtifacts,
    sellerCountry,
    buyerCountry,
    recipientKind,
    domesticB2B: recipientKind === "business" && buyerCountry === sellerCountry,
    publicSector,
    buyerReferenceRequired: publicSector,
  });
};

const eInvoiceRequirementFromComplianceSnapshot = (snapshot: JsonRecord): EInvoiceRequirement | null => {
  const record = parseJsonRecord(snapshot.eInvoiceRequirement);
  const profile = stringFromRecord(record, "profile");
  const profileVersion = stringFromRecord(record, "profileVersion");
  const requiredArtifacts = record.requiredArtifacts;
  const sellerCountry = stringFromRecord(record, "sellerCountry");
  if (!profile || !profileVersion || !sellerCountry || !Array.isArray(requiredArtifacts)) return null;
  if (!requiredArtifacts.every(isInvoiceArtifactType)) return null;

  const buyerCountry = stringFromRecord(record, "buyerCountry");
  const recipientKindValue = stringFromRecord(record, "recipientKind");
  const recipientKind =
    recipientKindValue === "business" || recipientKindValue === "consumer" || recipientKindValue === "public_sector" ? recipientKindValue : null;

  return {
    profile,
    profileVersion,
    requiredArtifacts,
    sellerCountry,
    buyerCountry,
    recipientKind,
    domesticB2B: record.domesticB2B === true,
    publicSector: record.publicSector === true,
    buyerReferenceRequired: record.buyerReferenceRequired === true,
  };
};

const buildComplianceSnapshot = (config: {
  issuer: DbIssuerSnapshot;
  template: DbIssueDefaults;
  templateVersionId: string;
  buyer: InvoicePartySnapshot | null;
}): Result<JsonRecord> => {
  const eInvoiceRequirement = buildEInvoiceRequirement({ issuer: config.issuer, buyer: config.buyer });
  if (!eInvoiceRequirement.ok) return eInvoiceRequirement;

  return ok({
    issuer: {
      name: config.issuer.name,
      country: config.issuer.country,
      taxNumber: config.issuer.tax_number,
      vatId: config.issuer.vat_id,
      email: config.issuer.email,
      phone: config.issuer.phone,
      bankName: config.issuer.bank_name,
      iban: config.issuer.iban,
      bic: config.issuer.bic,
      taxRegime: config.issuer.tax_regime,
      eInvoiceProfile: config.issuer.e_invoice_profile,
      defaultPaymentTermsDays: config.issuer.default_payment_terms_days,
      defaultCurrency: config.issuer.default_currency,
      locale: config.issuer.locale,
    },
    eInvoiceRequirement: eInvoiceRequirement.data,
    template: {
      versionId: config.templateVersionId,
      paymentTermsDays: config.template.payment_terms_days,
      currency: config.template.currency,
      layoutSettings: parseJsonRecord(config.template.layout_settings),
      eInvoiceDefaults: parseJsonRecord(config.template.e_invoice_defaults),
    },
  });
};

const prepareLines = (lines: InvoiceLineInput[]): Result<PreparedLine[]> => {
  if (lines.length === 0) return fail(err.badInput("At least one invoice line is required"));

  const prepared: PreparedLine[] = [];
  for (const [index, line] of lines.entries()) {
    const title = line.title.trim();
    if (!title) return fail(err.badInput("Invoice line title is required"));

    const calculated = calculateLineTax({
      quantity: line.quantity,
      unitPriceNetCents: line.unitPriceNetCents,
      discountCents: line.discountCents,
      taxCode: line.taxCode,
    });
    if (!calculated.ok) return calculated;

    prepared.push({
      ...line,
      title,
      position: index + 1,
      unit: line.unit ?? "piece",
      discountCents: line.discountCents ?? 0,
      taxCategory: calculated.data.taxCategory,
      taxRateBps: calculated.data.taxRateBps,
      taxCountry: calculated.data.taxCountry,
      legalReasonCode: calculated.data.legalReasonCode,
      legalReasonText: calculated.data.legalReasonText,
      totalNetCents: calculated.data.totalNetCents,
      totalTaxCents: calculated.data.totalTaxCents,
      totalGrossCents: calculated.data.totalGrossCents,
    });
  }

  return ok(prepared);
};

const totalsFor = (lines: PreparedLine[]) => ({
  subtotalNetCents: lines.reduce((sum, line) => sum + line.totalNetCents, 0),
  taxTotalCents: lines.reduce((sum, line) => sum + line.totalTaxCents, 0),
  totalGrossCents: lines.reduce((sum, line) => sum + line.totalGrossCents, 0),
});

const stringField = (record: JsonRecord, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const withAddressCountry = (address: JsonRecord | null | undefined, country: string | null | undefined): JsonRecord => {
  const record = parseJsonRecord(address);
  return stringField(record, "country") ? record : { ...record, country: normalizeCountry(country) };
};

const hasCompletePostalAddress = (value: JsonRecord, fallbackCountry?: string | null): boolean => {
  const address = withAddressCountry(value, fallbackCountry);
  return Boolean(
    stringField(address, "line1") &&
      stringField(address, "postalCode") &&
      stringField(address, "city") &&
      stringField(address, "country"),
  );
};

const normalizeRecipientKind = (value: InvoiceRecipientKind | null | undefined): InvoiceRecipientKind | null => {
  if (value === "business" || value === "consumer" || value === "public_sector") return value;
  return null;
};

const normalizeSupplyType = (value: InvoiceSupplyType | null | undefined): InvoiceSupplyType | null => {
  if (value === "goods" || value === "service" || value === "mixed") return value;
  return null;
};

const parseDateOnlyTime = (value: string | null): number | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) ? time : null;
};

const breakdownKey = (breakdown: {
  taxCode: string;
  taxCategory: string;
  taxRateBps: number;
  taxCountry: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
}): string =>
  [
    breakdown.taxCode,
    breakdown.taxCategory,
    breakdown.taxRateBps,
    breakdown.taxCountry,
    breakdown.legalReasonCode ?? "",
    breakdown.legalReasonText ?? "",
  ].join("|");

const buildReadiness = (items: InvoiceIssueReadinessItem[]): InvoiceIssueReadiness => {
  const blockers = items.filter((item) => item.severity === "blocker");
  const warnings = items.filter((item) => item.severity === "warning");
  return { ready: blockers.length === 0, blockers, warnings, items };
};

const validateIssueReadinessData = (config: { invoice: InvoiceDetail; issuer: DbIssuerSnapshot | null }): InvoiceIssueReadiness => {
  const items: InvoiceIssueReadinessItem[] = [];
  const addBlocker = (code: string, message: string, path?: string): void => {
    items.push({ severity: "blocker", code, message, path });
  };
  const addWarning = (code: string, message: string, path?: string): void => {
    items.push({ severity: "warning", code, message, path });
  };

  const { invoice, issuer } = config;
  const buyer = invoice.parties.find((party) => party.role === "buyer") ?? null;

  if (invoice.status !== "draft") addBlocker("invoice.not_draft", "Only draft invoices can be issued.", "status");
  if (!invoice.templateVersionId) addBlocker("invoice.missing_template_version", "Invoice draft has no active template version.", "templateVersionId");
  if (!invoice.sequenceId) addBlocker("invoice.missing_sequence", "Invoice draft has no invoice sequence.", "sequenceId");
  if (invoice.lines.length === 0) addBlocker("invoice.missing_lines", "At least one invoice line is required.", "lines");

  if (!buyer) {
    addBlocker("buyer.missing", "Invoice recipient is required.", "parties.buyer");
  } else {
    if (!buyer.name.trim()) addBlocker("buyer.name_missing", "Recipient name is required.", "parties.buyer.name");
    if (!buyer.country.trim()) addBlocker("buyer.country_missing", "Recipient country is required.", "parties.buyer.country");
    if (!hasCompletePostalAddress(buyer.address, buyer.country)) {
      addBlocker("buyer.address_incomplete", "Recipient address requires line1, postalCode, city, and country.", "parties.buyer.address");
    }
    if (buyer.recipientKind === "public_sector" && !buyer.buyerReference?.trim() && !buyer.leitwegId?.trim()) {
      addBlocker("buyer.routing_reference_missing", "Public-sector recipients require a buyer reference or Leitweg-ID.", "parties.buyer.buyerReference");
    }
  }

  if (!issuer) {
    addBlocker("seller.missing", "Issuer profile is required.", "issuerProfileId");
  } else {
    if (!issuer.name.trim()) addBlocker("seller.name_missing", "Issuer name is required.", "issuer.name");
    if (!issuer.country.trim()) addBlocker("seller.country_missing", "Issuer country is required.", "issuer.country");
    if (!hasCompletePostalAddress(parseJsonRecord(issuer.address), issuer.country)) {
      addBlocker("seller.address_incomplete", "Issuer address requires line1, postalCode, city, and country.", "issuer.address");
    }
    if (!issuer.tax_number && !issuer.vat_id) {
      addBlocker("seller.tax_id_missing", "Issuer tax number or VAT ID is required.", "issuer.taxNumber");
    }
    const requirement = buildEInvoiceRequirement({ issuer, buyer });
    if (!requirement.ok) {
      addBlocker("e_invoice.profile_unsupported", requirement.error.message, "issuer.eInvoiceProfile");
    }
  }

  const issueDateTime = parseDateOnlyTime(invoice.issueDate) ?? parseDateOnlyTime(new Date().toISOString().slice(0, 10));
  if (invoice.issueDate && issueDateTime === null) addBlocker("dates.issue_date_invalid", "Issue date must use YYYY-MM-DD.", "issueDate");
  const dueDateTime = parseDateOnlyTime(invoice.dueDate);
  if (invoice.dueDate && dueDateTime === null) addBlocker("dates.due_date_invalid", "Due date must use YYYY-MM-DD.", "dueDate");
  if (dueDateTime !== null && issueDateTime !== null && dueDateTime < issueDateTime) {
    addBlocker("dates.due_before_issue", "Due date cannot be before the issue date.", "dueDate");
  }
  const serviceStartTime = parseDateOnlyTime(invoice.servicePeriodStart);
  const serviceEndTime = parseDateOnlyTime(invoice.servicePeriodEnd);
  if (invoice.servicePeriodStart && serviceStartTime === null) {
    addBlocker("dates.service_start_invalid", "Service period start must use YYYY-MM-DD.", "servicePeriodStart");
  }
  if (invoice.servicePeriodEnd && serviceEndTime === null) {
    addBlocker("dates.service_end_invalid", "Service period end must use YYYY-MM-DD.", "servicePeriodEnd");
  }
  if (serviceStartTime !== null && serviceEndTime !== null && serviceEndTime < serviceStartTime) {
    addBlocker("dates.service_end_before_start", "Service period end cannot be before the start.", "servicePeriodEnd");
  }

  const recalculatedLines: InvoiceLineTaxResult[] = [];
  for (const [index, line] of invoice.lines.entries()) {
    const path = `lines.${index}`;
    if (!line.title.trim()) addBlocker("line.title_missing", "Line title is required.", `${path}.title`);
    const calculated = calculateLineTax({
      quantity: line.quantity,
      unitPriceNetCents: line.unitPriceNetCents,
      discountCents: line.discountCents,
      taxCode: line.taxCode,
    });
    if (!calculated.ok) {
      addBlocker("line.tax_code_invalid", calculated.error.message, `${path}.taxCode`);
      continue;
    }

    recalculatedLines.push(calculated.data);
    if (line.taxCategory !== calculated.data.taxCategory) addBlocker("line.tax_category_mismatch", "Line tax category does not match its tax code.", `${path}.taxCategory`);
    if (line.taxRateBps !== calculated.data.taxRateBps) addBlocker("line.tax_rate_mismatch", "Line tax rate does not match its tax code.", `${path}.taxRateBps`);
    if (line.taxCountry !== calculated.data.taxCountry) addBlocker("line.tax_country_mismatch", "Line tax country does not match its tax code.", `${path}.taxCountry`);
    if (line.totalNetCents !== calculated.data.totalNetCents) addBlocker("line.net_total_mismatch", "Line net total is inconsistent.", `${path}.totalNetCents`);
    if (line.totalTaxCents !== calculated.data.totalTaxCents) addBlocker("line.tax_total_mismatch", "Line tax total is inconsistent.", `${path}.totalTaxCents`);
    if (line.totalGrossCents !== calculated.data.totalGrossCents) addBlocker("line.gross_total_mismatch", "Line gross total is inconsistent.", `${path}.totalGrossCents`);

    const rule = resolveTaxRule(line.taxCode);
    if (rule.ok && rule.data.requiresLegalReasonText && !line.legalReasonText?.trim()) {
      addBlocker("line.legal_reason_missing", "Line tax exemption reason text is required.", `${path}.legalReasonText`);
    }
  }

  const lineTotals = {
    subtotalNetCents: recalculatedLines.reduce((sum, line) => sum + line.totalNetCents, 0),
    taxTotalCents: recalculatedLines.reduce((sum, line) => sum + line.totalTaxCents, 0),
    totalGrossCents: recalculatedLines.reduce((sum, line) => sum + line.totalGrossCents, 0),
  };
  if (invoice.subtotalNetCents !== lineTotals.subtotalNetCents) addBlocker("totals.net_mismatch", "Invoice net total does not match its lines.", "subtotalNetCents");
  if (invoice.taxTotalCents !== lineTotals.taxTotalCents) addBlocker("totals.tax_mismatch", "Invoice tax total does not match its lines.", "taxTotalCents");
  if (invoice.totalGrossCents !== lineTotals.totalGrossCents) addBlocker("totals.gross_mismatch", "Invoice gross total does not match its lines.", "totalGrossCents");

  const expectedBreakdowns = summarizeTaxBreakdowns(recalculatedLines);
  if (invoice.lines.length > 0 && invoice.taxBreakdowns.length === 0) {
    addBlocker("tax_breakdowns.missing", "Tax breakdowns are required.", "taxBreakdowns");
  }
  const actualBreakdowns = new Map(invoice.taxBreakdowns.map((breakdown) => [breakdownKey(breakdown), breakdown]));
  for (const expected of expectedBreakdowns) {
    const actual = actualBreakdowns.get(breakdownKey(expected));
    if (!actual) {
      addBlocker("tax_breakdowns.missing_expected", `Missing tax breakdown for ${expected.taxCode}.`, "taxBreakdowns");
      continue;
    }
    if (actual.taxableAmountCents !== expected.taxableAmountCents) {
      addBlocker("tax_breakdowns.taxable_mismatch", `Taxable amount mismatch for ${expected.taxCode}.`, "taxBreakdowns");
    }
    if (actual.taxAmountCents !== expected.taxAmountCents) {
      addBlocker("tax_breakdowns.tax_mismatch", `Tax amount mismatch for ${expected.taxCode}.`, "taxBreakdowns");
    }
    const rule = resolveTaxRule(expected.taxCode);
    if (rule.ok && rule.data.requiresLegalReasonText && !actual.legalReasonText?.trim()) {
      addBlocker("tax_breakdowns.legal_reason_missing", `Tax exemption reason text is required for ${expected.taxCode}.`, "taxBreakdowns");
    }
  }

  const categories = new Set(recalculatedLines.map((line) => line.taxCategory));
  const taxRegime = issuer?.tax_regime?.trim() || "standard";
  if (taxRegime === "small_business") {
    if ([...categories].some((category) => category !== "small_business")) {
      addBlocker("tax_regime.small_business_mismatch", "Small-business issuers can only issue §19 UStG tax lines.", "issuer.taxRegime");
    }
  } else if (categories.has("small_business")) {
    addBlocker("tax_regime.small_business_not_allowed", "§19 UStG tax lines require a small-business issuer profile.", "issuer.taxRegime");
  } else if (taxRegime !== "standard") {
    addWarning("tax_regime.unknown", `Unknown issuer tax regime: ${taxRegime}.`, "issuer.taxRegime");
  }

  if (categories.has("reverse_charge") || categories.has("intra_eu")) {
    if (!issuer?.vat_id) addBlocker("tax_registration.seller_vat_missing", "Reverse-charge or intra-EU invoices require the issuer VAT ID.", "issuer.vatId");
    if (!buyer?.vatId) addBlocker("tax_registration.buyer_vat_missing", "Reverse-charge or intra-EU invoices require the recipient VAT ID.", "parties.buyer.vatId");
    if (buyer?.recipientKind !== "business") {
      addBlocker("tax_registration.business_recipient_required", "Reverse-charge or intra-EU invoices require a business recipient.", "parties.buyer.recipientKind");
    }
    if (!buyer?.supplyType) {
      addBlocker("tax_registration.supply_type_missing", "Reverse-charge or intra-EU invoices require a supply type.", "parties.buyer.supplyType");
    }
  }
  if (categories.has("intra_eu") && buyer && issuer && buyer.country === issuer.country) {
    addBlocker("tax_registration.intra_eu_country_mismatch", "Intra-EU supply requires buyer and seller countries to differ.", "parties.buyer.country");
  }
  if (categories.has("margin_scheme")) {
    addBlocker("tax_regime.margin_scheme_disabled", "Margin scheme support is not enabled in V1.", "lines");
  }

  return buildReadiness(items);
};

const reserveIdempotency = async (
  client: SqlClient,
  config: {
    workspaceId: string;
    operation: string;
    key: string | undefined;
    requestHash: string;
    actorId?: string;
  },
): Promise<Result<IdempotencyReservation>> => {
  if (!config.key) return ok({ replayResultRef: null });

  await client`
    DELETE FROM invoices.invoice_idempotency_keys
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND operation = ${config.operation}
      AND idempotency_key = ${config.key}
      AND status IN ('started', 'failed')
      AND (
        expires_at <= now()
        OR (expires_at IS NULL AND created_at < now() - INTERVAL '24 hours')
      )
  `;

  const inserted = await client`
    INSERT INTO invoices.invoice_idempotency_keys (
      workspace_id,
      operation,
      idempotency_key,
      request_hash,
      status,
      created_by,
      expires_at
    )
    VALUES (
      ${config.workspaceId}::uuid,
      ${config.operation},
      ${config.key},
      ${config.requestHash},
      'started',
      ${config.actorId ?? null}::uuid,
      now() + INTERVAL '24 hours'
    )
    ON CONFLICT (workspace_id, operation, idempotency_key) DO NOTHING
  `;

  if (inserted.count === 1) return ok({ replayResultRef: null });

  const [row] = await client<IdempotencyRow[]>`
    SELECT id, request_hash, result_ref, status
    FROM invoices.invoice_idempotency_keys
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND operation = ${config.operation}
      AND idempotency_key = ${config.key}
    FOR UPDATE
  `;

  if (!row) return fail(err.internal("Failed to reserve idempotency key"));
  if (row.request_hash !== config.requestHash) return fail(err.conflict("Idempotency key request mismatch"));
  if (row.status === "completed" && row.result_ref) return ok({ replayResultRef: row.result_ref });
  return fail(err.conflict("Idempotency request is already in progress"));
};

const completeIdempotency = async (
  client: SqlClient,
  config: {
  workspaceId: string;
  operation: string;
  key: string | undefined;
  requestHash: string;
  resultRef: string;
  },
): Promise<void> => {
  if (!config.key) return;
  const updated = await client`
    UPDATE invoices.invoice_idempotency_keys
    SET result_ref = ${config.resultRef}, status = 'completed'
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND operation = ${config.operation}
      AND idempotency_key = ${config.key}
      AND request_hash = ${config.requestHash}
  `;
  if (updated.count !== 1) throw new Error("Failed to complete idempotency key");
};

const releaseStartedIdempotency = async (
  client: SqlClient,
  config: {
    workspaceId: string;
    operation: string;
    key: string | undefined;
    requestHash: string;
  },
): Promise<void> => {
  if (!config.key) return;
  await client`
    DELETE FROM invoices.invoice_idempotency_keys
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND operation = ${config.operation}
      AND idempotency_key = ${config.key}
      AND request_hash = ${config.requestHash}
      AND status = 'started'
  `;
};

const releaseStartedStringResult = async (
  client: SqlClient,
  config: {
    workspaceId: string;
    operation: string;
    key: string | undefined;
    requestHash: string;
  },
  result: Result<string>,
): Promise<Result<string>> => {
  if (!result.ok) await releaseStartedIdempotency(client, config);
  return result;
};

const loadTemplateForDraft = async (config: { workspaceId: string; templateId: string; client?: SqlClient }): Promise<TemplateForDraft | null> => {
  const client = config.client ?? sql;
  const [row] = await client<TemplateForDraft[]>`
    SELECT
      t.id AS template_id,
      v.id AS template_version_id,
      v.issuer_profile_id,
      v.number_sequence_id,
      s.document_type AS sequence_document_type,
      v.payment_terms_days,
      v.currency
    FROM invoices.invoice_templates t
    JOIN invoices.invoice_template_versions v ON v.id = t.active_version_id
    JOIN invoices.invoice_sequences s
      ON s.id = v.number_sequence_id
     AND s.workspace_id = t.workspace_id
     AND s.archived_at IS NULL
    WHERE t.workspace_id = ${config.workspaceId}::uuid
      AND t.id = ${config.templateId}::uuid
      AND t.status = 'active'
      AND t.archived_at IS NULL
  `;
  return row ?? null;
};

const loadIssuerForReadiness = async (config: { workspaceId: string; issuerProfileId: string; client?: SqlClient }): Promise<DbIssuerSnapshot | null> => {
  const client = config.client ?? sql;
  const [issuer] = await client<DbIssuerSnapshot[]>`
    SELECT
      id,
      name,
      address,
      country,
      tax_number,
      vat_id,
      email,
      phone,
      bank_name,
      iban,
      bic,
      default_payment_terms_days,
      default_currency,
      locale,
      tax_regime,
      e_invoice_profile
    FROM invoices.invoice_issuer_profiles
    WHERE id = ${config.issuerProfileId}::uuid
      AND workspace_id = ${config.workspaceId}::uuid
      AND archived_at IS NULL
  `;
  return issuer ?? null;
};

const writeLinesAndBreakdowns = async (config: { invoiceId: string; lines: PreparedLine[]; client?: SqlClient }): Promise<void> => {
  const client = config.client ?? sql;
  await client`DELETE FROM invoices.invoice_lines WHERE invoice_id = ${config.invoiceId}::uuid`;
  await client`DELETE FROM invoices.invoice_tax_breakdowns WHERE invoice_id = ${config.invoiceId}::uuid`;

  for (const line of config.lines) {
    await client`
      INSERT INTO invoices.invoice_lines (
        invoice_id,
        position,
        kind,
        external_line_id,
        article_id,
        article_sku,
        title,
        description,
        quantity,
        unit,
        unit_price_net_cents,
        discount_cents,
        tax_code,
        tax_category,
        tax_rate_bps,
        tax_country,
        legal_reason_code,
        legal_reason_text,
        total_net_cents,
        total_tax_cents,
        total_gross_cents,
        metadata
      )
      VALUES (
        ${config.invoiceId}::uuid,
        ${line.position},
        'item',
        ${emptyToNull(line.externalLineId)},
        ${emptyToNull(line.articleId)},
        ${emptyToNull(line.articleSku)},
        ${line.title},
        ${emptyToNull(line.description)},
        ${line.quantity},
        ${line.unit},
        ${line.unitPriceNetCents},
        ${line.discountCents ?? 0},
        ${line.taxCode},
        ${line.taxCategory},
        ${line.taxRateBps},
        ${line.taxCountry},
        ${line.legalReasonCode},
        ${line.legalReasonText},
        ${line.totalNetCents},
        ${line.totalTaxCents},
        ${line.totalGrossCents},
        (${toJsonb(line.metadata)}::text)::jsonb
      )
    `;
  }

  for (const breakdown of summarizeTaxBreakdowns(config.lines)) {
    await client`
      INSERT INTO invoices.invoice_tax_breakdowns (
        invoice_id,
        tax_code,
        tax_category,
        tax_rate_bps,
        tax_country,
        e_invoice_category_code,
        legal_reason_code,
        legal_reason_text,
        taxable_amount_cents,
        tax_amount_cents
      )
      VALUES (
        ${config.invoiceId}::uuid,
        ${breakdown.taxCode},
        ${breakdown.taxCategory},
        ${breakdown.taxRateBps},
        ${breakdown.taxCountry},
        ${breakdown.eInvoiceCategoryCode},
        ${breakdown.legalReasonCode},
        ${breakdown.legalReasonText},
        ${breakdown.taxableAmountCents},
        ${breakdown.taxAmountCents}
      )
    `;
  }
};

const writeParty = async (config: { invoiceId: string; party: InvoicePartyInput; role: InvoicePartyRole; client?: SqlClient }): Promise<void> => {
  const client = config.client ?? sql;
  const name = config.party.name.trim();
  if (!name) throw new Error(`Invoice ${config.role} name is required`);
  const country = normalizeCountry(config.party.country);
  const address = withAddressCountry(config.party.address, country);

  await client`
    INSERT INTO invoices.invoice_party_snapshots (
      invoice_id,
      role,
      contact_id,
      name,
      address,
      country,
      vat_id,
      tax_number,
      email,
      phone,
      recipient_kind,
      supply_type,
      buyer_reference,
      leitweg_id
    )
    VALUES (
      ${config.invoiceId}::uuid,
      ${config.role},
      ${config.party.contactId ?? null}::uuid,
      ${name},
      (${toJsonb(address)}::text)::jsonb,
      ${country},
      ${emptyToNull(config.party.vatId)},
      ${emptyToNull(config.party.taxNumber)},
      ${emptyToNull(config.party.email)},
      ${emptyToNull(config.party.phone)},
      ${normalizeRecipientKind(config.party.recipientKind)},
      ${normalizeSupplyType(config.party.supplyType)},
      ${emptyToNull(config.party.buyerReference)},
      ${emptyToNull(config.party.leitwegId)}
    )
    ON CONFLICT (invoice_id, role)
    DO UPDATE SET
      contact_id = EXCLUDED.contact_id,
      name = EXCLUDED.name,
      address = EXCLUDED.address,
      country = EXCLUDED.country,
      vat_id = EXCLUDED.vat_id,
      tax_number = EXCLUDED.tax_number,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      recipient_kind = EXCLUDED.recipient_kind,
      supply_type = EXCLUDED.supply_type,
      buyer_reference = EXCLUDED.buyer_reference,
      leitweg_id = EXCLUDED.leitweg_id
  `;
};

const writeEvent = async (config: {
  workspaceId: string;
  invoiceId?: string;
  eventType: string;
  actorId?: string;
  sourceApp?: string;
  idempotencyKey?: string;
  previousStatus?: string | null;
  nextStatus?: string | null;
  metadata?: JsonRecord;
  client?: SqlClient;
}): Promise<void> => {
  const client = config.client ?? sql;
  await client`
    INSERT INTO invoices.invoice_events (
      workspace_id,
      invoice_id,
      event_type,
      actor_id,
      source_app,
      idempotency_key,
      previous_status,
      next_status,
      metadata
    )
    VALUES (
      ${config.workspaceId}::uuid,
      ${config.invoiceId ?? null}::uuid,
      ${config.eventType},
      ${config.actorId ?? null}::uuid,
      ${config.sourceApp ?? null},
      ${config.idempotencyKey ?? null},
      ${config.previousStatus ?? null},
      ${config.nextStatus ?? null},
      (${toJsonb(config.metadata)}::text)::jsonb
    )
  `;
};

const normalizeExternalRefLookup = (input: InvoiceExternalRefLookupInput): Result<InvoiceExternalRefLookupInput> => {
  const sourceApp = input.sourceApp.trim();
  const sourceType = input.sourceType.trim();
  const sourceId = input.sourceId.trim();
  if (!sourceApp || !sourceType || !sourceId) return fail(err.badInput("External reference source fields are required"));
  return ok({ sourceApp, sourceType, sourceId });
};

const externalPayloadHash = (input: CreateInvoiceDraftFromExternalRefInput): string =>
  input.externalRef.payloadHash ??
  hashRequest({
    externalRef: {
      sourceApp: input.externalRef.sourceApp.trim(),
      sourceType: input.externalRef.sourceType.trim(),
      sourceId: input.externalRef.sourceId.trim(),
      sourceVersion: input.externalRef.sourceVersion ?? null,
      metadata: input.externalRef.metadata ?? {},
    },
    draft: {
      templateId: input.templateId,
      recipient: input.recipient,
      lines: input.lines,
      documentType: input.documentType ?? "invoice",
      issueDate: input.issueDate ?? null,
      dueDate: input.dueDate ?? null,
      servicePeriodStart: input.servicePeriodStart ?? null,
      servicePeriodEnd: input.servicePeriodEnd ?? null,
      source: input.source ?? input.externalRef.sourceApp.trim(),
    },
  });

const writeExternalRefs = async (config: { workspaceId: string; invoiceId: string; refs: InvoiceExternalRefInput[]; client?: SqlClient }): Promise<Result<void>> => {
  const client = config.client ?? sql;
  for (const ref of config.refs) {
    const normalized = normalizeExternalRefLookup(ref);
    if (!normalized.ok) return normalized;
    const payloadHash = ref.payloadHash ?? hashRequest(ref);

    const inserted = await client`
      INSERT INTO invoices.invoice_external_refs (
        workspace_id,
        invoice_id,
        source_app,
        source_type,
        source_id,
        source_version,
        payload_hash,
        metadata
      )
      VALUES (
        ${config.workspaceId}::uuid,
        ${config.invoiceId}::uuid,
        ${normalized.data.sourceApp},
        ${normalized.data.sourceType},
        ${normalized.data.sourceId},
        ${emptyToNull(ref.sourceVersion)},
        ${payloadHash},
        (${toJsonb(ref.metadata)}::text)::jsonb
      )
      ON CONFLICT (workspace_id, source_app, source_type, source_id) DO NOTHING
    `;
    if (inserted.count === 1) continue;

    const [existing] = await client<DbExternalRef[]>`
      SELECT invoice_id, payload_hash
      FROM invoices.invoice_external_refs
      WHERE workspace_id = ${config.workspaceId}::uuid
        AND source_app = ${normalized.data.sourceApp}
        AND source_type = ${normalized.data.sourceType}
        AND source_id = ${normalized.data.sourceId}
    `;
    if (existing?.payload_hash === payloadHash && existing.invoice_id === config.invoiceId) continue;
    return fail(err.conflict("External invoice reference already exists"));
  }
  return ok();
};

const loadDetail = async (config: { workspaceId: string; id: string }): Promise<InvoiceDetail | null> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.id)) return null;

  const [invoiceRow] = await sql<DbInvoice[]>`
    SELECT *
    FROM invoices.invoices
    WHERE workspace_id = ${config.workspaceId}::uuid
      AND id = ${config.id}::uuid
  `;
  if (!invoiceRow) return null;

  const [lineRows, partyRows, breakdownRows] = await Promise.all([
    sql<DbLine[]>`SELECT * FROM invoices.invoice_lines WHERE invoice_id = ${config.id}::uuid ORDER BY position ASC`,
    sql<DbParty[]>`SELECT * FROM invoices.invoice_party_snapshots WHERE invoice_id = ${config.id}::uuid ORDER BY role ASC`,
    sql<DbBreakdown[]>`SELECT * FROM invoices.invoice_tax_breakdowns WHERE invoice_id = ${config.id}::uuid ORDER BY tax_code ASC`,
  ]);

  return {
    ...mapInvoice(invoiceRow),
    lines: lineRows.map(mapLine),
    parties: partyRows.map(mapParty),
    taxBreakdowns: breakdownRows.map(mapBreakdown),
  };
};

export const get = async (config: { workspaceId: string; id: string; actor: InvoiceActor }): Promise<InvoiceDetail | null> => {
  const invoice = await loadDetail({ workspaceId: config.workspaceId, id: config.id });
  if (!invoice) return null;

  const access = await requireTemplatePermission({
    workspaceId: config.workspaceId,
    templateId: invoice.templateId,
    actor: config.actor,
    requiredLevel: invoice.status === "draft" ? "write" : "read",
  });
  if (!access.ok) return null;

  return invoice;
};

export const validateIssueReadiness = async (config: {
  workspaceId: string;
  invoiceId: string;
  actor: InvoiceActor;
}): Promise<Result<InvoiceIssueReadiness>> => {
  if (!isUuid(config.workspaceId) || !isUuid(config.invoiceId)) return fail(err.notFound("Invoice draft"));

  const invoice = await loadDetail({ workspaceId: config.workspaceId, id: config.invoiceId });
  if (!invoice) return fail(err.notFound("Invoice draft"));

  const access = await requireTemplatePermission({
    workspaceId: config.workspaceId,
    templateId: invoice.templateId,
    actor: config.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);

  const issuer = await loadIssuerForReadiness({ workspaceId: config.workspaceId, issuerProfileId: invoice.issuerProfileId });
  return ok(validateIssueReadinessData({ invoice, issuer }));
};

export const findByExternalRef = async (input: {
  workspaceId: string;
  actor: InvoiceActor;
  externalRef: InvoiceExternalRefLookupInput;
}): Promise<Result<InvoiceDetail | null>> => {
  if (!isUuid(input.workspaceId)) return fail(err.notFound("Invoice workspace"));
  const normalized = normalizeExternalRefLookup(input.externalRef);
  if (!normalized.ok) return normalized;

  const [row] = await sql<DbExternalRef[]>`
    SELECT invoice_id, payload_hash
    FROM invoices.invoice_external_refs
    WHERE workspace_id = ${input.workspaceId}::uuid
      AND source_app = ${normalized.data.sourceApp}
      AND source_type = ${normalized.data.sourceType}
      AND source_id = ${normalized.data.sourceId}
  `;
  if (!row) return ok(null);

  const invoice = await get({ workspaceId: input.workspaceId, id: row.invoice_id, actor: input.actor });
  if (!invoice) return fail(err.notFound("Invoice"));
  return ok(invoice);
};

export const createDraftFromExternalRef = async (input: CreateInvoiceDraftFromExternalRefInput & { actor: InvoiceActor }): Promise<Result<InvoiceDetail>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.templateId)) return fail(err.notFound("Workspace or template"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);
  const access = await requireTemplatePermission({
    workspaceId: input.workspaceId,
    templateId: input.templateId,
    actor: input.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);

  const normalized = normalizeExternalRefLookup(input.externalRef);
  if (!normalized.ok) return normalized;
  const { actor: _actor, ...requestInput } = input;
  void _actor;
  const requestHash = hashRequest(requestInput);
  const payloadHash = externalPayloadHash(input);
  const prepared = prepareLines(input.lines);
  if (!prepared.ok) return prepared;

  const result = await stringResultTransaction(async (tx): Promise<Result<string>> => {
    const reserved = await reserveIdempotency(tx, {
      workspaceId: input.workspaceId,
      operation: "createDraftFromExternalRef",
      key: input.idempotencyKey,
      requestHash,
      actorId: userId.data,
    });
    if (!reserved.ok) return reserved;
    if (reserved.data.replayResultRef) return ok(reserved.data.replayResultRef);

    const [existingRef] = await tx<DbExternalRef[]>`
      SELECT invoice_id, payload_hash
      FROM invoices.invoice_external_refs
      WHERE workspace_id = ${input.workspaceId}::uuid
        AND source_app = ${normalized.data.sourceApp}
        AND source_type = ${normalized.data.sourceType}
        AND source_id = ${normalized.data.sourceId}
      FOR UPDATE
    `;
    if (existingRef) {
      if (existingRef.payload_hash !== payloadHash) {
        return releaseStartedStringResult(
          tx,
          {
            workspaceId: input.workspaceId,
            operation: "createDraftFromExternalRef",
            key: input.idempotencyKey,
            requestHash,
          },
          fail(err.conflict("External invoice reference payload mismatch")),
        );
      }
      await completeIdempotency(tx, {
        workspaceId: input.workspaceId,
        operation: "createDraftFromExternalRef",
        key: input.idempotencyKey,
        requestHash,
        resultRef: existingRef.invoice_id,
      });
      return ok(existingRef.invoice_id);
    }

    const template = await loadTemplateForDraft({ workspaceId: input.workspaceId, templateId: input.templateId, client: tx });
    if (!template) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraftFromExternalRef",
          key: input.idempotencyKey,
          requestHash,
        },
        fail(err.notFound("Active invoice template")),
      );
    }

    const totals = totalsFor(prepared.data);
    const documentType = input.documentType ?? "invoice";
    const supportedDocumentType = requireSupportedDraftDocumentType(documentType);
    if (!supportedDocumentType.ok) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraftFromExternalRef",
          key: input.idempotencyKey,
          requestHash,
        },
        supportedDocumentType,
      );
    }
    if (template.sequence_document_type !== documentType) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraftFromExternalRef",
          key: input.idempotencyKey,
          requestHash,
        },
        fail(err.badInput("Invoice template sequence does not match the document type")),
      );
    }
    const dueDate = input.dueDate ?? (input.issueDate ? addDays(input.issueDate, template.payment_terms_days) : null);

    const [row] = await tx<DbInvoice[]>`
      INSERT INTO invoices.invoices (
        workspace_id,
        document_type,
        status,
        template_id,
        template_version_id,
        issuer_profile_id,
        sequence_id,
        contact_id,
        source,
        issue_date,
        due_date,
        service_period_start,
        service_period_end,
        currency,
        subtotal_net_cents,
        tax_total_cents,
        total_gross_cents,
        created_by,
        updated_by
      )
      VALUES (
        ${input.workspaceId}::uuid,
        ${documentType},
        'draft',
        ${template.template_id}::uuid,
        ${template.template_version_id}::uuid,
        ${template.issuer_profile_id}::uuid,
        ${template.number_sequence_id}::uuid,
        ${input.recipient.contactId ?? null}::uuid,
        ${input.source ?? normalized.data.sourceApp},
        ${input.issueDate ?? null}::date,
        ${dueDate}::date,
        ${input.servicePeriodStart ?? null}::date,
        ${input.servicePeriodEnd ?? null}::date,
        ${normalizeCurrency(template.currency)},
        ${totals.subtotalNetCents},
        ${totals.taxTotalCents},
        ${totals.totalGrossCents},
        ${userId.data}::uuid,
        ${userId.data}::uuid
      )
      RETURNING *
    `;
    const draftRow: DbInvoice = row ?? rollbackStringResult(fail(err.internal("Failed to create invoice draft")));

    await writeLinesAndBreakdowns({ invoiceId: draftRow.id, lines: prepared.data, client: tx });
    await writeParty({ invoiceId: draftRow.id, party: input.recipient, role: "buyer", client: tx });

    const inserted = await tx`
      INSERT INTO invoices.invoice_external_refs (
        workspace_id,
        invoice_id,
        source_app,
        source_type,
        source_id,
        source_version,
        payload_hash,
        metadata
      )
      VALUES (
        ${input.workspaceId}::uuid,
        ${draftRow.id}::uuid,
        ${normalized.data.sourceApp},
        ${normalized.data.sourceType},
        ${normalized.data.sourceId},
        ${emptyToNull(input.externalRef.sourceVersion)},
        ${payloadHash},
        (${toJsonb(input.externalRef.metadata)}::text)::jsonb
      )
      ON CONFLICT (workspace_id, source_app, source_type, source_id) DO NOTHING
    `;
    if (inserted.count !== 1) {
      const [conflict] = await tx<DbExternalRef[]>`
        SELECT invoice_id, payload_hash
        FROM invoices.invoice_external_refs
        WHERE workspace_id = ${input.workspaceId}::uuid
          AND source_app = ${normalized.data.sourceApp}
          AND source_type = ${normalized.data.sourceType}
          AND source_id = ${normalized.data.sourceId}
      `;
      if (conflict?.payload_hash === payloadHash) rollbackStringResult(ok(conflict.invoice_id));
      rollbackStringResult(fail(err.conflict("External invoice reference payload mismatch")));
    }

    await writeEvent({
      workspaceId: input.workspaceId,
      invoiceId: draftRow.id,
      eventType: "invoice.draft.created_from_external_ref",
      actorId: userId.data,
      sourceApp: normalized.data.sourceApp,
      idempotencyKey: input.idempotencyKey,
      nextStatus: "draft",
      metadata: {
        sourceApp: normalized.data.sourceApp,
        sourceType: normalized.data.sourceType,
        sourceId: normalized.data.sourceId,
        sourceVersion: input.externalRef.sourceVersion ?? null,
        payloadHash,
      },
      client: tx,
    });
    await completeIdempotency(tx, {
      workspaceId: input.workspaceId,
      operation: "createDraftFromExternalRef",
      key: input.idempotencyKey,
      requestHash,
      resultRef: draftRow.id,
    });

    return ok(draftRow.id);
  });
  if (!result.ok) return result;

  const draft = await get({ workspaceId: input.workspaceId, id: result.data, actor: input.actor });
  return draft ? ok(draft) : fail(err.internal("Failed to load invoice draft"));
};

export const listArtifacts = async (config: {
  workspaceId: string;
  invoiceId: string;
  actor: InvoiceActor;
}): Promise<Result<InvoiceArtifact[]>> => {
  const invoice = await get({ workspaceId: config.workspaceId, id: config.invoiceId, actor: config.actor });
  if (!invoice) return fail(err.notFound("Invoice"));

  const rows = await sql<DbArtifact[]>`
    SELECT *
    FROM invoices.invoice_artifacts
    WHERE invoice_id = ${config.invoiceId}::uuid
    ORDER BY artifact_type ASC, created_at DESC
  `;

  return ok(rows.map(mapArtifact));
};

const requireSupportedDraftDocumentType = (documentType: InvoiceDocumentType): Result<InvoiceDocumentType> => {
  if (documentType === "invoice") return ok(documentType);
  return fail(err.badInput("Correction and cancellation drafts require explicit reversal semantics before they can be created"));
};

const normalizedArtifactProfile = (artifact: InvoiceArtifact): string => artifact.profile.trim().toLowerCase();

const artifactProfileMatchesType = (artifactType: InvoiceArtifactType, profile: string): boolean => {
  const normalized = profile.trim().toLowerCase();
  if (artifactType === "xrechnung_xml") return ["xrechnung", "xml"].includes(normalized);
  if (artifactType === "zugferd_pdf") return ["zugferd", "factur-x", "facturx", "pdf-a-3"].includes(normalized);
  return false;
};

const artifactMatchesRequirement = (artifact: InvoiceArtifact, requirement: EInvoiceRequirement | null): boolean => {
  if (!requirement) return true;
  return requirement.requiredArtifacts.includes(artifact.artifactType) && artifactProfileMatchesType(artifact.artifactType, normalizedArtifactProfile(artifact));
};

const isDeliverableArtifact = (artifact: InvoiceArtifact, requirement: EInvoiceRequirement | null): boolean =>
  artifact.validationStatus === "valid" &&
  artifactMatchesRequirement(artifact, requirement) &&
  artifact.storageRef !== null &&
  artifact.sha256 !== null &&
  artifact.byteSize !== null &&
  artifact.byteSize > 0;

export const getArtifactDeliverability = async (config: {
  workspaceId: string;
  invoiceId: string;
  actor: InvoiceActor;
}): Promise<Result<InvoiceArtifactDeliverability>> => {
  const invoice = await get({ workspaceId: config.workspaceId, id: config.invoiceId, actor: config.actor });
  if (!invoice) return fail(err.notFound("Invoice"));
  const frozenRequirement = eInvoiceRequirementFromComplianceSnapshot(invoice.complianceSnapshot);
  const eInvoiceProfile = frozenRequirement?.profile ?? eInvoiceProfileFromComplianceSnapshot(invoice.complianceSnapshot);
  if (!eInvoiceProfile) return fail(err.badInput("Issued invoice has no frozen e-invoice requirement"));
  const requiredFromProfile = frozenRequirement ? ok(frozenRequirement.requiredArtifacts) : requiredFinalArtifactTypesForProfile(eInvoiceProfile);
  if (!requiredFromProfile.ok) return requiredFromProfile;

  const artifactsResult = await listArtifacts(config);
  if (!artifactsResult.ok) return artifactsResult;

  const artifacts = artifactsResult.data;
  const required = requiredFromProfile.data;
  const missing = required.filter(
    (artifactType) =>
      !artifacts.some((artifact) => artifact.artifactType === artifactType && isDeliverableArtifact(artifact, frozenRequirement)),
  );
  const blockers = missing.map((artifactType): InvoiceIssueReadinessItem => ({
    severity: "blocker",
    code: `artifact.${artifactType}.missing_valid`,
    message: `${artifactType} artifact is required for ${eInvoiceProfile} and is not generated and valid yet.`,
    path: "artifacts",
  }));

  return ok({
    invoiceId: invoice.id,
    deliverable: invoice.status === "issued" && missing.length === 0,
    required,
    missing,
    artifacts,
    blockers,
  });
};

const expectedMimeType = (artifactType: InvoiceArtifactType): string => (artifactType === "xrechnung_xml" ? "application/xml" : "application/pdf");

const validateArtifactContent = (data: RegisterInvoiceArtifactInput): Result<void> => {
  if (data.mimeType !== expectedMimeType(data.artifactType)) {
    return fail(err.badInput("Artifact MIME type does not match artifact type"));
  }
  if (!data.profile.trim()) return fail(err.badInput("Artifact profile is required"));
  if (!data.storageRef.trim()) return fail(err.badInput("Artifact storage ref is required"));
  if (!/^[a-f0-9]{64}$/i.test(data.sha256)) return fail(err.badInput("Artifact sha256 must be a hex SHA-256 hash"));
  if (!Number.isInteger(data.byteSize) || data.byteSize <= 0) return fail(err.badInput("Artifact byte size must be positive"));
  if (data.supersedesArtifactId && !isUuid(data.supersedesArtifactId)) {
    return fail(err.notFound("Superseded artifact"));
  }
  return ok();
};

const artifactRowMatchesData = (row: DbArtifact, data: RegisterInvoiceArtifactInput): boolean =>
  row.profile === data.profile.trim() &&
  row.profile_version === (emptyToNull(data.profileVersion) ?? null) &&
  row.syntax === (emptyToNull(data.syntax) ?? null) &&
  row.mime_type === data.mimeType &&
  row.storage_ref === data.storageRef.trim() &&
  row.sha256 === data.sha256.toLowerCase() &&
  Number(row.byte_size) === data.byteSize &&
  row.validation_status === data.validationStatus &&
  stableStringify(parseJsonRecord(row.validation_report)) === stableStringify(data.validationReport ?? {}) &&
  row.validator_bundle_version === (emptyToNull(data.validatorBundleVersion) ?? null) &&
  row.buyer_reference === (emptyToNull(data.buyerReference) ?? null) &&
  row.leitweg_id === (emptyToNull(data.leitwegId) ?? null) &&
  row.supersedes_artifact_id === (data.supersedesArtifactId ?? null);

const insertArtifact = async (input: {
  workspaceId: string;
  actorId: string;
  invoice: InvoiceDetail;
  data: RegisterInvoiceArtifactInput;
}): Promise<Result<InvoiceArtifact>> =>
  sql.begin(async (tx): Promise<Result<InvoiceArtifact>> => {
    if (input.data.supersedesArtifactId) {
      const [superseded] = await tx<{ id: string }[]>`
        SELECT id
        FROM invoices.invoice_artifacts
        WHERE id = ${input.data.supersedesArtifactId}::uuid
          AND invoice_id = ${input.invoice.id}::uuid
          AND artifact_type = ${input.data.artifactType}
        FOR UPDATE
      `;
      if (!superseded) return fail(err.notFound("Superseded artifact"));
    }

    const [row] = await tx<DbArtifact[]>`
      INSERT INTO invoices.invoice_artifacts (
        invoice_id,
        artifact_type,
        profile,
        profile_version,
        syntax,
        mime_type,
        storage_ref,
        sha256,
        byte_size,
        validation_status,
        validation_report,
        validator_bundle_version,
        validated_at,
        buyer_reference,
        leitweg_id,
        template_version_id,
        invoice_version,
        supersedes_artifact_id,
        created_by
      )
      VALUES (
        ${input.invoice.id}::uuid,
        ${input.data.artifactType},
        ${input.data.profile.trim()},
        ${emptyToNull(input.data.profileVersion)},
        ${emptyToNull(input.data.syntax)},
        ${input.data.mimeType},
        ${input.data.storageRef.trim()},
        ${input.data.sha256.toLowerCase()},
        ${input.data.byteSize},
        ${input.data.validationStatus},
        (${toJsonb(input.data.validationReport)}::text)::jsonb,
        ${emptyToNull(input.data.validatorBundleVersion)},
        ${input.data.validatedAt ?? null}::timestamptz,
        ${emptyToNull(input.data.buyerReference)},
        ${emptyToNull(input.data.leitwegId)},
        ${input.invoice.templateVersionId ?? null}::uuid,
        ${input.invoice.version},
        ${input.data.supersedesArtifactId ?? null}::uuid,
        ${input.actorId}::uuid
      )
      ON CONFLICT (invoice_id, artifact_type, sha256, validation_status) WHERE sha256 IS NOT NULL DO NOTHING
      RETURNING *
    `;
    const artifactRow =
      row ??
      (await tx<DbArtifact[]>`
        SELECT *
        FROM invoices.invoice_artifacts
        WHERE invoice_id = ${input.invoice.id}::uuid
          AND artifact_type = ${input.data.artifactType}
          AND sha256 = ${input.data.sha256.toLowerCase()}
          AND validation_status = ${input.data.validationStatus}
      `)[0];
    if (!artifactRow) return fail(err.internal("Failed to register invoice artifact"));
    if (!row && !artifactRowMatchesData(artifactRow, input.data)) {
      return fail(err.conflict("Invoice artifact hash already exists with different metadata"));
    }

    await writeEvent({
      workspaceId: input.workspaceId,
      invoiceId: input.invoice.id,
      eventType: "invoice.artifact.registered",
      actorId: input.actorId,
      metadata: {
        artifactId: artifactRow.id,
        artifactType: artifactRow.artifact_type,
        validationStatus: artifactRow.validation_status,
        sha256: artifactRow.sha256,
        replayed: !row,
      },
      client: tx,
    });

    return ok(mapArtifact(artifactRow));
  });

export const registerArtifact = async (input: {
  workspaceId: string;
  actor: InvoiceActor;
  data: RegisterInvoiceArtifactInput;
}): Promise<Result<InvoiceArtifact>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.data.invoiceId)) return fail(err.notFound("Invoice"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);

  const invoice = await get({ workspaceId: input.workspaceId, id: input.data.invoiceId, actor: input.actor });
  if (!invoice) return fail(err.notFound("Invoice"));
  const access = await requireTemplatePermission({
    workspaceId: input.workspaceId,
    templateId: invoice.templateId,
    actor: input.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);
  if (invoice.status !== "issued") return fail(err.badInput("Artifacts can only be registered for issued invoices"));
  const content = validateArtifactContent(input.data);
  if (!content.ok) return content;
  if (input.data.validationStatus === "valid") {
    return fail(err.badInput("Generic artifact registration cannot mark artifacts as valid; use the trusted e-invoice validator adapter"));
  }
  if (input.data.validationStatus === "invalid" && Object.keys(input.data.validationReport ?? {}).length === 0) {
    return fail(err.badInput("Invalid artifacts require a validation report"));
  }

  return insertArtifact({ workspaceId: input.workspaceId, actorId: userId.data, invoice, data: input.data });
};

export const registerTrustedValidatedArtifact = async (input: {
  workspaceId: string;
  actor: InvoiceActor;
  data: RegisterTrustedInvoiceArtifactInput;
}): Promise<Result<InvoiceArtifact>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.data.invoiceId)) return fail(err.notFound("Invoice"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);

  const data: RegisterInvoiceArtifactInput = {
    ...input.data,
    validationStatus: "valid",
    validatorBundleVersion: input.data.validatorBundleVersion.trim(),
    validatedAt: input.data.validatedAt ?? new Date().toISOString(),
  };
  const content = validateArtifactContent(data);
  if (!content.ok) return content;
  if (data.artifactType === "pdf_preview") return fail(err.badInput("PDF previews cannot satisfy trusted e-invoice validation"));
  if (!data.validatorBundleVersion) return fail(err.badInput("Trusted artifacts require a validator bundle version"));
  if (Object.keys(data.validationReport ?? {}).length === 0) return fail(err.badInput("Trusted artifacts require a validation report"));

  const invoice = await get({ workspaceId: input.workspaceId, id: data.invoiceId, actor: input.actor });
  if (!invoice) return fail(err.notFound("Invoice"));
  const access = await requireTemplatePermission({
    workspaceId: input.workspaceId,
    templateId: invoice.templateId,
    actor: input.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);
  if (invoice.status !== "issued") return fail(err.badInput("Artifacts can only be registered for issued invoices"));

  const frozenRequirement = eInvoiceRequirementFromComplianceSnapshot(invoice.complianceSnapshot);
  if (!frozenRequirement) return fail(err.badInput("Issued invoice has no frozen e-invoice requirement"));
  if (!frozenRequirement.requiredArtifacts.includes(data.artifactType) || !artifactProfileMatchesType(data.artifactType, data.profile)) {
    return fail(err.badInput("Trusted artifact does not match the frozen e-invoice requirement"));
  }

  return insertArtifact({ workspaceId: input.workspaceId, actorId: userId.data, invoice, data });
};

export const createDraft = async (input: CreateInvoiceDraftInput & { actor: InvoiceActor }): Promise<Result<InvoiceDetail>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.templateId)) return fail(err.notFound("Workspace or template"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);
  const access = await requireTemplatePermission({
    workspaceId: input.workspaceId,
    templateId: input.templateId,
    actor: input.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);

  const { actor: _actor, ...requestInput } = input;
  void _actor;
  const requestHash = hashRequest(requestInput);
  const prepared = prepareLines(input.lines);
  if (!prepared.ok) return prepared;

  const result = await stringResultTransaction(async (tx): Promise<Result<string>> => {
    const reserved = await reserveIdempotency(tx, {
      workspaceId: input.workspaceId,
      operation: "createDraft",
      key: input.idempotencyKey,
      requestHash,
      actorId: userId.data,
    });
    if (!reserved.ok) return reserved;
    if (reserved.data.replayResultRef) return ok(reserved.data.replayResultRef);

    const template = await loadTemplateForDraft({ workspaceId: input.workspaceId, templateId: input.templateId, client: tx });
    if (!template) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraft",
          key: input.idempotencyKey,
          requestHash,
        },
        fail(err.notFound("Active invoice template")),
      );
    }

    const totals = totalsFor(prepared.data);
    const documentType = input.documentType ?? "invoice";
    const supportedDocumentType = requireSupportedDraftDocumentType(documentType);
    if (!supportedDocumentType.ok) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraft",
          key: input.idempotencyKey,
          requestHash,
        },
        supportedDocumentType,
      );
    }
    if (template.sequence_document_type !== documentType) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraft",
          key: input.idempotencyKey,
          requestHash,
        },
        fail(err.badInput("Invoice template sequence does not match the document type")),
      );
    }
    const dueDate = input.dueDate ?? (input.issueDate ? addDays(input.issueDate, template.payment_terms_days) : null);

    const [row] = await tx<DbInvoice[]>`
      INSERT INTO invoices.invoices (
        workspace_id,
        document_type,
        status,
        template_id,
        template_version_id,
        issuer_profile_id,
        sequence_id,
        contact_id,
        source,
        issue_date,
        due_date,
        service_period_start,
        service_period_end,
        currency,
        subtotal_net_cents,
        tax_total_cents,
        total_gross_cents,
        created_by,
        updated_by
      )
      VALUES (
        ${input.workspaceId}::uuid,
        ${documentType},
        'draft',
        ${template.template_id}::uuid,
        ${template.template_version_id}::uuid,
        ${template.issuer_profile_id}::uuid,
        ${template.number_sequence_id}::uuid,
        ${input.recipient.contactId ?? null}::uuid,
        ${input.source ?? "manual"},
        ${input.issueDate ?? null}::date,
        ${dueDate}::date,
        ${input.servicePeriodStart ?? null}::date,
        ${input.servicePeriodEnd ?? null}::date,
        ${normalizeCurrency(template.currency)},
        ${totals.subtotalNetCents},
        ${totals.taxTotalCents},
        ${totals.totalGrossCents},
        ${userId.data}::uuid,
        ${userId.data}::uuid
      )
      RETURNING *
    `;
    if (!row) {
      return releaseStartedStringResult(
        tx,
        {
          workspaceId: input.workspaceId,
          operation: "createDraft",
          key: input.idempotencyKey,
          requestHash,
        },
        fail(err.internal("Failed to create invoice draft")),
      );
    }

    await writeLinesAndBreakdowns({ invoiceId: row.id, lines: prepared.data, client: tx });
    await writeParty({ invoiceId: row.id, party: input.recipient, role: "buyer", client: tx });
    const refs = await writeExternalRefs({ workspaceId: input.workspaceId, invoiceId: row.id, refs: input.externalRefs ?? [], client: tx });
    if (!refs.ok) rollbackStringResult(refs);
    await writeEvent({
      workspaceId: input.workspaceId,
      invoiceId: row.id,
      eventType: "invoice.draft.created",
      actorId: userId.data,
      sourceApp: input.source,
      idempotencyKey: input.idempotencyKey,
      nextStatus: "draft",
      client: tx,
    });
    await completeIdempotency(tx, {
      workspaceId: input.workspaceId,
      operation: "createDraft",
      key: input.idempotencyKey,
      requestHash,
      resultRef: row.id,
    });

    return ok(row.id);
  });
  if (!result.ok) return result;

  const draft = await loadDetail({ workspaceId: input.workspaceId, id: result.data });
  return draft ? ok(draft) : fail(err.internal("Failed to load invoice draft"));
};

export const updateDraft = async (input: UpdateInvoiceDraftInput & { actor: InvoiceActor }): Promise<Result<InvoiceDetail>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.invoiceId)) return fail(err.notFound("Invoice draft"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);

  const prepared = input.lines ? prepareLines(input.lines) : null;
  if (prepared && !prepared.ok) return prepared;
  const totals = prepared ? totalsFor(prepared.data) : null;

  const [draftForAccess] = await sql<{ template_id: string }[]>`
    SELECT template_id
    FROM invoices.invoices
    WHERE workspace_id = ${input.workspaceId}::uuid
      AND id = ${input.invoiceId}::uuid
      AND status = 'draft'
  `;
  if (!draftForAccess) return fail(err.notFound("Invoice draft"));
  const access = await requireTemplatePermission({
    workspaceId: input.workspaceId,
    templateId: draftForAccess.template_id,
    actor: input.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);

  const result = await sql.begin(async (tx): Promise<Result<string>> => {
    const [row] = await tx<DbInvoice[]>`
      UPDATE invoices.invoices
      SET
        issue_date = COALESCE(${input.issueDate ?? null}::date, issue_date),
        due_date = COALESCE(${input.dueDate ?? null}::date, due_date),
        service_period_start = COALESCE(${input.servicePeriodStart ?? null}::date, service_period_start),
        service_period_end = COALESCE(${input.servicePeriodEnd ?? null}::date, service_period_end),
        subtotal_net_cents = COALESCE(${totals?.subtotalNetCents ?? null}::bigint, subtotal_net_cents),
        tax_total_cents = COALESCE(${totals?.taxTotalCents ?? null}::bigint, tax_total_cents),
        total_gross_cents = COALESCE(${totals?.totalGrossCents ?? null}::bigint, total_gross_cents),
        updated_by = ${userId.data}::uuid,
        updated_at = now(),
        version = version + 1
      WHERE workspace_id = ${input.workspaceId}::uuid
        AND id = ${input.invoiceId}::uuid
        AND status = 'draft'
        AND version = ${input.expectedVersion}
      RETURNING *
    `;
    if (!row) return fail(err.conflict("Invoice draft version mismatch or immutable invoice"));

    if (prepared) {
      await writeLinesAndBreakdowns({ invoiceId: input.invoiceId, lines: prepared.data, client: tx });
    }
    if (input.recipient) {
      await writeParty({ invoiceId: input.invoiceId, party: input.recipient, role: "buyer", client: tx });
    }
    await writeEvent({
      workspaceId: input.workspaceId,
      invoiceId: input.invoiceId,
      eventType: "invoice.draft.updated",
      actorId: userId.data,
      previousStatus: "draft",
      nextStatus: "draft",
      metadata: { expectedVersion: input.expectedVersion, version: row.version },
      client: tx,
    });

    return ok(row.id);
  });
  if (!result.ok) return result;

  const draft = await loadDetail({ workspaceId: input.workspaceId, id: result.data });
  return draft ? ok(draft) : fail(err.internal("Failed to load updated invoice draft"));
};

export const issueDraft = async (input: IssueInvoiceDraftInput & { actor: InvoiceActor }): Promise<Result<InvoiceDetail>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.invoiceId)) return fail(err.notFound("Invoice draft"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);

  const [draftForAccess] = await sql<{ template_id: string }[]>`
    SELECT template_id
    FROM invoices.invoices
    WHERE workspace_id = ${input.workspaceId}::uuid
      AND id = ${input.invoiceId}::uuid
  `;
  if (!draftForAccess) return fail(err.notFound("Invoice draft"));
  const access = await requireTemplatePermission({
    workspaceId: input.workspaceId,
    templateId: draftForAccess.template_id,
    actor: input.actor,
    requiredLevel: "write",
  });
  if (!access.ok) return fail(access.error);

  const { actor: _actor, ...requestInput } = input;
  void _actor;
  const requestHash = hashRequest(requestInput);

  const result = await sql.begin(async (tx): Promise<Result<string>> => {
    const reserved = await reserveIdempotency(tx, {
      workspaceId: input.workspaceId,
      operation: "issueDraft",
      key: input.idempotencyKey,
      requestHash,
      actorId: userId.data,
    });
    if (!reserved.ok) return reserved;
    if (reserved.data.replayResultRef) return ok(reserved.data.replayResultRef);
    const startedIdempotency = {
      workspaceId: input.workspaceId,
      operation: "issueDraft",
      key: input.idempotencyKey,
      requestHash,
    };

    const [draft] = await tx<DbInvoice[]>`
      SELECT *
      FROM invoices.invoices
      WHERE workspace_id = ${input.workspaceId}::uuid
        AND id = ${input.invoiceId}::uuid
      FOR UPDATE
    `;
    if (!draft) return releaseStartedStringResult(tx, startedIdempotency, fail(err.notFound("Invoice draft")));
    if (draft.status !== "draft") return releaseStartedStringResult(tx, startedIdempotency, fail(err.conflict("Issued invoices are immutable")));
    if (draft.version !== input.expectedVersion) return releaseStartedStringResult(tx, startedIdempotency, fail(err.conflict("Invoice draft version mismatch")));
    if (!draft.sequence_id || !draft.template_version_id) {
      return releaseStartedStringResult(tx, startedIdempotency, fail(err.badInput("Invoice draft has no active template version or sequence")));
    }

    const lineRows = await tx<DbLine[]>`SELECT * FROM invoices.invoice_lines WHERE invoice_id = ${input.invoiceId}::uuid ORDER BY position ASC`;
    const partyRows = await tx<DbParty[]>`SELECT * FROM invoices.invoice_party_snapshots WHERE invoice_id = ${input.invoiceId}::uuid ORDER BY role ASC`;
    const breakdownRows = await tx<DbBreakdown[]>`SELECT * FROM invoices.invoice_tax_breakdowns WHERE invoice_id = ${input.invoiceId}::uuid ORDER BY tax_code ASC`;

    const issuer = await loadIssuerForReadiness({ workspaceId: input.workspaceId, issuerProfileId: draft.issuer_profile_id, client: tx });
    const readiness = validateIssueReadinessData({
      invoice: {
        ...mapInvoice(draft),
        lines: lineRows.map(mapLine),
        parties: partyRows.map(mapParty),
        taxBreakdowns: breakdownRows.map(mapBreakdown),
      },
      issuer,
    });
    if (!readiness.ready) {
      return releaseStartedStringResult(
        tx,
        startedIdempotency,
        fail(err.badInput(`Invoice is not ready to issue: ${readiness.blockers[0]?.message ?? "Unknown blocker"}`)),
      );
    }
    if (!issuer) return releaseStartedStringResult(tx, startedIdempotency, fail(err.badInput("Issuer profile is required")));

    const [issueDefaults] = await tx<DbIssueDefaults[]>`
      SELECT payment_terms_days, currency, layout_settings, e_invoice_defaults
      FROM invoices.invoice_template_versions
      WHERE id = ${draft.template_version_id}::uuid
    `;
    if (!issueDefaults) return releaseStartedStringResult(tx, startedIdempotency, fail(err.badInput("Invoice template version is required")));

    const [sequence] = await tx<{ id: string; prefix: string; next_number: number; padding: number }[]>`
      SELECT id, prefix, next_number, padding
      FROM invoices.invoice_sequences
      WHERE id = ${draft.sequence_id}::uuid
        AND workspace_id = ${input.workspaceId}::uuid
        AND document_type = ${draft.document_type}
        AND archived_at IS NULL
      FOR UPDATE
    `;
    if (!sequence) return releaseStartedStringResult(tx, startedIdempotency, fail(err.badInput("Invoice sequence is required for this document type")));

    const invoiceNumber = `${sequence.prefix}${String(sequence.next_number).padStart(sequence.padding, "0")}`;
    const buyerSnapshot = partyRows.map(mapParty).find((party) => party.role === "buyer") ?? null;
    const complianceSnapshot = buildComplianceSnapshot({
      issuer,
      template: issueDefaults,
      templateVersionId: draft.template_version_id,
      buyer: buyerSnapshot,
    });
    if (!complianceSnapshot.ok) {
      return releaseStartedStringResult(tx, startedIdempotency, complianceSnapshot);
    }
    await tx`
      DELETE FROM invoices.invoice_party_snapshots
      WHERE invoice_id = ${input.invoiceId}::uuid
        AND role = 'seller'
    `;
    await tx`
      INSERT INTO invoices.invoice_party_snapshots (invoice_id, role, name, address, country, vat_id, tax_number, email, phone)
      VALUES (
        ${input.invoiceId}::uuid,
        'seller',
        ${issuer.name},
        (${toJsonb(withAddressCountry(parseJsonRecord(issuer.address), issuer.country))}::text)::jsonb,
        ${issuer.country},
        ${issuer.vat_id},
        ${issuer.tax_number},
        ${issuer.email},
        ${issuer.phone}
      )
    `;

    const [updated] = await tx<DbInvoice[]>`
      UPDATE invoices.invoices
      SET
        status = 'issued',
        invoice_number = ${invoiceNumber},
        issue_date = COALESCE(issue_date, CURRENT_DATE),
        due_date = COALESCE(due_date, CURRENT_DATE + (${issueDefaults.payment_terms_days}::int * INTERVAL '1 day')),
        service_period_start = COALESCE(service_period_start, service_period_end, issue_date, CURRENT_DATE),
        service_period_end = COALESCE(service_period_end, service_period_start, issue_date, CURRENT_DATE),
        compliance_snapshot = (${toJsonb(complianceSnapshot.data)}::text)::jsonb,
        issued_by = ${userId.data}::uuid,
        issued_at = now(),
        updated_by = ${userId.data}::uuid,
        updated_at = now(),
        version = version + 1
      WHERE id = ${input.invoiceId}::uuid
      RETURNING *
    `;
    if (!updated) return releaseStartedStringResult(tx, startedIdempotency, fail(err.internal("Failed to issue invoice draft")));

    await tx`
      UPDATE invoices.invoice_sequences
      SET next_number = next_number + 1, last_allocated_at = now(), updated_at = now()
      WHERE id = ${draft.sequence_id}::uuid
    `;
    await writeEvent({
      workspaceId: input.workspaceId,
      invoiceId: input.invoiceId,
      eventType: "invoice.issued",
      actorId: userId.data,
      idempotencyKey: input.idempotencyKey,
      previousStatus: "draft",
      nextStatus: "issued",
      metadata: { artifactStatus: "missing" },
      client: tx,
    });
    await completeIdempotency(tx, {
      workspaceId: input.workspaceId,
      operation: "issueDraft",
      key: input.idempotencyKey,
      requestHash,
      resultRef: input.invoiceId,
    });

    return ok(updated.id);
  });

  if (!result.ok) return result;

  const issued = await loadDetail({ workspaceId: input.workspaceId, id: result.data });
  return issued ? ok(issued) : fail(err.internal("Failed to load issued invoice"));
};

export const createCorrectionDraft = async (input: CreateInvoiceCorrectionInput & { actor: InvoiceActor }): Promise<Result<InvoiceDetail>> => {
  if (!isUuid(input.workspaceId) || !isUuid(input.originalInvoiceId)) return fail(err.notFound("Original invoice"));
  const userId = requireInvoiceUser(input.actor);
  if (!userId.ok) return fail(userId.error);

  const original = await get({ workspaceId: input.workspaceId, id: input.originalInvoiceId, actor: input.actor });
  if (!original || original.status !== "issued") return fail(err.notFound("Issued original invoice"));
  return fail(err.badInput("Correction and cancellation drafts require explicit reversal semantics before they can be created"));
};
