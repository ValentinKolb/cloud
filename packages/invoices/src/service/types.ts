import type { PermissionLevel } from "@valentinkolb/cloud/server";
import type { JsonRecord } from "./shared";
import type { TaxRule } from "./tax";

export type InvoiceActor = {
  userId: string | null;
  userGroups: string[];
};

export type InvoiceWorkspace = {
  id: string;
  name: string;
  slug: string;
  defaultCurrency: string;
  locale: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type InvoicePostalAddress = JsonRecord & {
  line1: string;
  postalCode: string;
  city: string;
  country: string;
  line2?: string | null;
  region?: string | null;
};

export type CreateInvoiceWorkspaceInput = {
  name: string;
  slug?: string;
  defaultCurrency?: string;
  locale?: string;
};

export type InvoiceIssuerProfile = {
  id: string;
  workspaceId: string;
  name: string;
  address: JsonRecord;
  country: string;
  taxNumber: string | null;
  vatId: string | null;
  email: string | null;
  phone: string | null;
  bankName: string | null;
  iban: string | null;
  bic: string | null;
  defaultPaymentTermsDays: number;
  defaultCurrency: string;
  locale: string;
  taxRegime: string;
  eInvoiceProfile: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateInvoiceIssuerProfileInput = {
  name: string;
  address?: InvoicePostalAddress;
  country?: string;
  taxNumber?: string | null;
  vatId?: string | null;
  email?: string | null;
  phone?: string | null;
  bankName?: string | null;
  iban?: string | null;
  bic?: string | null;
  defaultPaymentTermsDays?: number;
  defaultCurrency?: string;
  locale?: string;
  taxRegime?: string;
  eInvoiceProfile?: string;
};

export type InvoiceSequence = {
  id: string;
  workspaceId: string;
  issuerProfileId: string;
  documentType: string;
  name: string;
  prefix: string;
  period: string | null;
  nextNumber: number;
  padding: number;
  lastAllocatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateInvoiceSequenceInput = {
  issuerProfileId: string;
  documentType?: string;
  name: string;
  prefix?: string;
  period?: string | null;
  nextNumber?: number;
  padding?: number;
};

export type AllocatedInvoiceNumber = {
  sequenceId: string;
  value: number;
  formatted: string;
};

export type InvoiceTemplate = {
  id: string;
  workspaceId: string;
  issuerProfileId: string;
  name: string;
  status: "draft" | "active" | "deprecated" | "archived";
  activeVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CreateInvoiceTemplateInput = {
  issuerProfileId: string;
  name: string;
};

export type UpdateInvoiceTemplateInput = {
  name?: string;
  status?: "draft" | "active" | "deprecated" | "archived";
};

export type InvoiceTemplateVersion = {
  id: string;
  templateId: string;
  version: number;
  nameSnapshot: string;
  issuerProfileId: string;
  numberSequenceId: string;
  paymentTermsDays: number;
  currency: string;
  taxDefaults: JsonRecord;
  layoutSettings: JsonRecord;
  eInvoiceDefaults: JsonRecord;
  createdBy: string | null;
  createdAt: string;
  activatedAt: string | null;
};

export type CreateInvoiceTemplateVersionInput = {
  issuerProfileId: string;
  numberSequenceId: string;
  nameSnapshot?: string;
  paymentTermsDays?: number;
  currency?: string;
  taxDefaults?: JsonRecord;
  layoutSettings?: JsonRecord;
  eInvoiceDefaults?: JsonRecord;
};

export type PrincipalAccess = {
  permission: PermissionLevel;
};

export type InvoiceDocumentType = "invoice" | "correction" | "cancellation";

export type InvoiceStatus = "draft" | "issued";

export type InvoicePaymentStatus = "untracked" | "open" | "paid" | "overdue" | "written_off";

export type InvoicePartyRole = "seller" | "buyer" | "bill_to" | "ship_to";

export type InvoiceRecipientKind = "business" | "consumer" | "public_sector";

export type InvoiceSupplyType = "goods" | "service" | "mixed";

export type InvoicePartyInput = {
  role?: InvoicePartyRole;
  contactId?: string | null;
  name: string;
  address?: InvoicePostalAddress;
  country?: string;
  vatId?: string | null;
  taxNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  recipientKind?: InvoiceRecipientKind | null;
  supplyType?: InvoiceSupplyType | null;
  buyerReference?: string | null;
  leitwegId?: string | null;
};

export type InvoicePartySnapshot = {
  id: string;
  invoiceId: string;
  role: InvoicePartyRole;
  contactId: string | null;
  name: string;
  address: JsonRecord;
  country: string;
  vatId: string | null;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  recipientKind: InvoiceRecipientKind | null;
  supplyType: InvoiceSupplyType | null;
  buyerReference: string | null;
  leitwegId: string | null;
  createdAt: string;
};

export type InvoiceLineInput = {
  title: string;
  description?: string | null;
  quantity: number;
  unit?: string;
  unitPriceNetCents: number;
  discountCents?: number;
  taxCode: string;
  externalLineId?: string | null;
  articleId?: string | null;
  articleSku?: string | null;
  metadata?: JsonRecord;
};

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  position: number;
  kind: string;
  externalLineId: string | null;
  articleId: string | null;
  articleSku: string | null;
  title: string;
  description: string | null;
  quantity: number;
  unit: string;
  unitPriceNetCents: number;
  discountCents: number;
  taxCode: string;
  taxCategory: string;
  taxRateBps: number;
  taxCountry: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
  totalNetCents: number;
  totalTaxCents: number;
  totalGrossCents: number;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceTaxBreakdown = {
  id: string;
  invoiceId: string;
  taxCode: string;
  taxCategory: string;
  taxRateBps: number;
  taxCountry: string;
  eInvoiceCategoryCode: string;
  legalReasonCode: string | null;
  legalReasonText: string | null;
  taxableAmountCents: number;
  taxAmountCents: number;
  createdAt: string;
};

export type InvoiceArtifactType = "xrechnung_xml" | "zugferd_pdf" | "pdf_preview";

export type InvoiceArtifactValidationStatus = "generated" | "valid" | "invalid";

export type InvoiceArtifact = {
  id: string;
  invoiceId: string;
  artifactType: InvoiceArtifactType;
  profile: string;
  profileVersion: string | null;
  syntax: string | null;
  mimeType: string;
  storageRef: string | null;
  sha256: string | null;
  byteSize: number | null;
  validationStatus: InvoiceArtifactValidationStatus;
  validationReport: JsonRecord;
  validatorBundleVersion: string | null;
  validatedAt: string | null;
  buyerReference: string | null;
  leitwegId: string | null;
  templateVersionId: string | null;
  invoiceVersion: number;
  supersedesArtifactId: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type RegisterInvoiceArtifactInput = {
  invoiceId: string;
  artifactType: InvoiceArtifactType;
  profile: string;
  profileVersion?: string | null;
  syntax?: string | null;
  mimeType: string;
  storageRef: string;
  sha256: string;
  byteSize: number;
  validationStatus: InvoiceArtifactValidationStatus;
  validationReport?: JsonRecord;
  validatorBundleVersion?: string | null;
  validatedAt?: string | null;
  buyerReference?: string | null;
  leitwegId?: string | null;
  supersedesArtifactId?: string | null;
};

export type RegisterTrustedInvoiceArtifactInput = Omit<
  RegisterInvoiceArtifactInput,
  "validationStatus" | "validationReport" | "validatorBundleVersion" | "validatedAt"
> & {
  validationReport: JsonRecord;
  validatorBundleVersion: string;
  validatedAt?: string | null;
};

export type InvoiceArtifactDeliverability = {
  invoiceId: string;
  deliverable: boolean;
  required: InvoiceArtifactType[];
  missing: InvoiceArtifactType[];
  artifacts: InvoiceArtifact[];
  blockers: InvoiceIssueReadinessItem[];
};

export type InvoiceExportType = "pdf_zip" | "summary_csv" | "datev_csv";

export type InvoiceExportBatchStatus = "completed" | "failed";

export type InvoiceExportItemStatus = "included" | "skipped" | "failed";

export type InvoiceExportBatch = {
  id: string;
  workspaceId: string;
  exportType: InvoiceExportType;
  status: InvoiceExportBatchStatus;
  filterSnapshot: JsonRecord;
  selectedInvoiceIds: string[];
  formatVersion: string;
  generatorVersion: string;
  manifest: JsonRecord;
  fileSha256: string | null;
  fileSize: number | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type InvoiceExportItem = {
  id: string;
  batchId: string;
  workspaceId: string;
  invoiceId: string;
  artifactId: string | null;
  rowNumber: number;
  rowHash: string;
  amountSnapshot: JsonRecord;
  taxSnapshot: JsonRecord;
  accountingSnapshot: JsonRecord;
  status: InvoiceExportItemStatus;
  error: string | null;
  createdAt: string;
};

export type InvoiceExportBatchDetail = InvoiceExportBatch & {
  items: InvoiceExportItem[];
};

export type RegisterInvoiceExportItemInput = {
  invoiceId: string;
  artifactId?: string | null;
  rowNumber: number;
  rowHash?: string;
  amountSnapshot?: JsonRecord;
  taxSnapshot?: JsonRecord;
  accountingSnapshot?: JsonRecord;
  status?: InvoiceExportItemStatus;
  error?: string | null;
};

export type RegisterInvoiceExportBatchInput = {
  exportType: InvoiceExportType;
  status?: InvoiceExportBatchStatus;
  filterSnapshot?: JsonRecord;
  selectedInvoiceIds?: string[];
  formatVersion: string;
  generatorVersion: string;
  manifest?: JsonRecord;
  fileSha256?: string | null;
  fileSize?: number | null;
  completedAt?: string | null;
  items: RegisterInvoiceExportItemInput[];
};

export type InvoiceExternalRefInput = {
  sourceApp: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string | null;
  payloadHash?: string;
  metadata?: JsonRecord;
};

export type InvoiceExternalRefLookupInput = Pick<InvoiceExternalRefInput, "sourceApp" | "sourceType" | "sourceId">;

export type CreateInvoiceDraftFromExternalRefInput = Omit<CreateInvoiceDraftInput, "externalRefs"> & {
  externalRef: InvoiceExternalRefInput;
};

export type Invoice = {
  id: string;
  workspaceId: string;
  documentType: InvoiceDocumentType;
  status: InvoiceStatus;
  templateId: string;
  templateVersionId: string | null;
  issuerProfileId: string;
  sequenceId: string | null;
  invoiceNumber: string | null;
  contactId: string | null;
  source: string;
  issueDate: string | null;
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  currency: string;
  subtotalNetCents: number;
  taxTotalCents: number;
  totalGrossCents: number;
  roundingDeltaCents: number;
  paymentStatus: InvoicePaymentStatus;
  complianceSnapshot: JsonRecord;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  issuedBy: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
};

export type InvoiceDetail = Invoice & {
  lines: InvoiceLine[];
  parties: InvoicePartySnapshot[];
  taxBreakdowns: InvoiceTaxBreakdown[];
};

export type InvoiceWorkspaceCapabilities = {
  canRead: boolean;
  canCreate: boolean;
  canAdmin: boolean;
};

export type InvoiceSetupItem = {
  code: string;
  label: string;
  complete: boolean;
  severity: "blocker" | "warning";
};

export type InvoiceSummary = Invoice & {
  buyerName: string | null;
  artifactStatus: "not_required" | "pending" | "deliverable" | "blocked";
};

export type InvoiceHomeWorkspaceState = {
  workspace: InvoiceWorkspace;
  capabilities: InvoiceWorkspaceCapabilities;
  setup: InvoiceSetupItem[];
  recentDrafts: InvoiceSummary[];
  recentIssued: InvoiceSummary[];
};

export type InvoiceHomeState = {
  workspaces: InvoiceHomeWorkspaceState[];
};

export type InvoiceWorkspaceState = {
  workspace: InvoiceWorkspace;
  capabilities: InvoiceWorkspaceCapabilities;
  setup: InvoiceSetupItem[];
  issuerProfiles: InvoiceIssuerProfile[];
  sequences: InvoiceSequence[];
  templates: InvoiceTemplate[];
  counts: {
    drafts: number;
    issued: number;
    failedArtifacts: number;
    pendingArtifacts: number;
  };
};

export type InvoiceComposerState = {
  workspace: InvoiceWorkspace;
  capabilities: InvoiceWorkspaceCapabilities;
  setup: InvoiceSetupItem[];
  templates: InvoiceTemplate[];
  issuerProfiles: InvoiceIssuerProfile[];
  sequences: InvoiceSequence[];
  taxRules: TaxRule[];
  draft: InvoiceDetail | null;
  readiness: InvoiceIssueReadiness | null;
};

export type InvoiceDetailState = {
  invoice: InvoiceDetail;
  capabilities: {
    canRead: boolean;
    canEditDraft: boolean;
    canIssue: boolean;
    canRegisterArtifact: boolean;
  };
  readiness: InvoiceIssueReadiness | null;
  deliverability: InvoiceArtifactDeliverability | null;
  artifacts: InvoiceArtifact[];
};

export type InvoiceOperationsState = {
  workspace: InvoiceWorkspace;
  capabilities: InvoiceWorkspaceCapabilities;
  pendingArtifacts: InvoiceArtifact[];
  invalidArtifacts: InvoiceArtifact[];
  recentIssuedWithoutDeliverableArtifacts: InvoiceSummary[];
};

export type InvoiceSettingsState = {
  workspace: InvoiceWorkspace;
  capabilities: InvoiceWorkspaceCapabilities;
  issuerProfiles: InvoiceIssuerProfile[];
  sequences: InvoiceSequence[];
  templates: InvoiceTemplate[];
  access: {
    workspaceEntries: number;
  };
};

export type InvoiceIssueReadinessSeverity = "blocker" | "warning";

export type InvoiceIssueReadinessItem = {
  severity: InvoiceIssueReadinessSeverity;
  code: string;
  message: string;
  path?: string;
};

export type InvoiceIssueReadiness = {
  ready: boolean;
  blockers: InvoiceIssueReadinessItem[];
  warnings: InvoiceIssueReadinessItem[];
  items: InvoiceIssueReadinessItem[];
};

export type CreateInvoiceDraftInput = {
  workspaceId: string;
  templateId: string;
  recipient: InvoicePartyInput;
  lines: InvoiceLineInput[];
  source?: string;
  documentType?: InvoiceDocumentType;
  issueDate?: string | null;
  dueDate?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
  externalRefs?: InvoiceExternalRefInput[];
  idempotencyKey?: string;
};

export type UpdateInvoiceDraftInput = {
  workspaceId: string;
  invoiceId: string;
  expectedVersion: number;
  recipient?: InvoicePartyInput;
  lines?: InvoiceLineInput[];
  issueDate?: string | null;
  dueDate?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
};

export type IssueInvoiceDraftInput = {
  workspaceId: string;
  invoiceId: string;
  expectedVersion: number;
  idempotencyKey?: string;
};

export type CreateInvoiceCorrectionInput = {
  workspaceId: string;
  originalInvoiceId: string;
  kind: Extract<InvoiceDocumentType, "correction" | "cancellation">;
  reason?: string | null;
  idempotencyKey?: string;
};
