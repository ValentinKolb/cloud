import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { auth, type AuthContext, jsonResponse, requiresAuth, respond, v } from "@valentinkolb/cloud/server";
import { ok } from "@valentinkolb/stdlib";
import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { invoicesService, type InvoiceActor } from "../service";

const JsonRecordSchema = z.record(z.string(), z.unknown());
const DateTimeStringSchema = z.string();
const DateOnlyStringSchema = z.string().nullable();
const NullableStringSchema = z.string().nullable();

const WorkspaceParamSchema = z.object({ workspaceId: z.uuid() });
const InvoiceParamSchema = z.object({ workspaceId: z.uuid(), invoiceId: z.uuid() });
const DraftParamSchema = z.object({ workspaceId: z.uuid(), draftId: z.uuid() });

const AppStatusSchema = z.object({
  app: z.literal("invoices"),
  ready: z.boolean(),
});

const InvoiceWorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  defaultCurrency: z.string(),
  locale: z.string(),
  createdBy: z.uuid().nullable(),
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
  archivedAt: NullableStringSchema,
});

const InvoiceWorkspaceCapabilitiesSchema = z.object({
  canRead: z.boolean(),
  canCreate: z.boolean(),
  canAdmin: z.boolean(),
});

const InvoiceSetupItemSchema = z.object({
  code: z.string(),
  label: z.string(),
  complete: z.boolean(),
  severity: z.enum(["blocker", "warning"]),
});

const InvoiceIssuerProfileSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  address: JsonRecordSchema,
  country: z.string(),
  taxNumber: NullableStringSchema,
  vatId: NullableStringSchema,
  email: NullableStringSchema,
  phone: NullableStringSchema,
  bankName: NullableStringSchema,
  iban: NullableStringSchema,
  bic: NullableStringSchema,
  defaultPaymentTermsDays: z.number(),
  defaultCurrency: z.string(),
  locale: z.string(),
  taxRegime: z.string(),
  eInvoiceProfile: z.string(),
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
  archivedAt: NullableStringSchema,
});

const InvoiceSequenceSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  issuerProfileId: z.uuid(),
  documentType: z.string(),
  name: z.string(),
  prefix: z.string(),
  period: NullableStringSchema,
  nextNumber: z.number(),
  padding: z.number(),
  lastAllocatedAt: NullableStringSchema,
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
  archivedAt: NullableStringSchema,
});

const InvoiceTemplateSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  issuerProfileId: z.uuid(),
  name: z.string(),
  status: z.enum(["draft", "active", "deprecated", "archived"]),
  activeVersionId: z.uuid().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
  archivedAt: NullableStringSchema,
});

const InvoiceDocumentTypeSchema = z.enum(["invoice", "correction", "cancellation"]);
const InvoiceStatusSchema = z.enum(["draft", "issued"]);
const InvoicePaymentStatusSchema = z.enum(["untracked", "open", "paid", "overdue", "written_off"]);
const InvoicePartyRoleSchema = z.enum(["seller", "buyer", "bill_to", "ship_to"]);
const InvoiceRecipientKindSchema = z.enum(["business", "consumer", "public_sector"]);
const InvoiceSupplyTypeSchema = z.enum(["goods", "service", "mixed"]);

const InvoiceLineSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  position: z.number(),
  kind: z.string(),
  externalLineId: NullableStringSchema,
  articleId: NullableStringSchema,
  articleSku: NullableStringSchema,
  title: z.string(),
  description: NullableStringSchema,
  quantity: z.number(),
  unit: z.string(),
  unitPriceNetCents: z.number(),
  discountCents: z.number(),
  taxCode: z.string(),
  taxCategory: z.string(),
  taxRateBps: z.number(),
  taxCountry: z.string(),
  legalReasonCode: NullableStringSchema,
  legalReasonText: NullableStringSchema,
  totalNetCents: z.number(),
  totalTaxCents: z.number(),
  totalGrossCents: z.number(),
  metadata: JsonRecordSchema,
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
});

const InvoicePartySnapshotSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  role: InvoicePartyRoleSchema,
  contactId: z.uuid().nullable(),
  name: z.string(),
  address: JsonRecordSchema,
  country: z.string(),
  vatId: NullableStringSchema,
  taxNumber: NullableStringSchema,
  email: NullableStringSchema,
  phone: NullableStringSchema,
  recipientKind: InvoiceRecipientKindSchema.nullable(),
  supplyType: InvoiceSupplyTypeSchema.nullable(),
  buyerReference: NullableStringSchema,
  leitwegId: NullableStringSchema,
  createdAt: DateTimeStringSchema,
});

const InvoiceTaxBreakdownSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  taxCode: z.string(),
  taxCategory: z.string(),
  taxRateBps: z.number(),
  taxCountry: z.string(),
  eInvoiceCategoryCode: z.string(),
  legalReasonCode: NullableStringSchema,
  legalReasonText: NullableStringSchema,
  taxableAmountCents: z.number(),
  taxAmountCents: z.number(),
  createdAt: DateTimeStringSchema,
});

const InvoiceSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  documentType: InvoiceDocumentTypeSchema,
  status: InvoiceStatusSchema,
  templateId: z.uuid(),
  templateVersionId: z.uuid().nullable(),
  issuerProfileId: z.uuid(),
  sequenceId: z.uuid().nullable(),
  invoiceNumber: NullableStringSchema,
  contactId: z.uuid().nullable(),
  source: z.string(),
  issueDate: DateOnlyStringSchema,
  dueDate: DateOnlyStringSchema,
  servicePeriodStart: DateOnlyStringSchema,
  servicePeriodEnd: DateOnlyStringSchema,
  currency: z.string(),
  subtotalNetCents: z.number(),
  taxTotalCents: z.number(),
  totalGrossCents: z.number(),
  roundingDeltaCents: z.number(),
  paymentStatus: InvoicePaymentStatusSchema,
  complianceSnapshot: JsonRecordSchema,
  version: z.number(),
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  issuedBy: z.uuid().nullable(),
  createdAt: DateTimeStringSchema,
  updatedAt: DateTimeStringSchema,
  issuedAt: NullableStringSchema,
});

const InvoiceDetailSchema = InvoiceSchema.extend({
  lines: z.array(InvoiceLineSchema),
  parties: z.array(InvoicePartySnapshotSchema),
  taxBreakdowns: z.array(InvoiceTaxBreakdownSchema),
});

const InvoiceSummarySchema = InvoiceSchema.extend({
  buyerName: NullableStringSchema,
  artifactStatus: z.enum(["not_required", "pending", "deliverable", "blocked"]),
});

const InvoiceIssueReadinessItemSchema = z.object({
  severity: z.enum(["blocker", "warning"]),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});

const InvoiceIssueReadinessSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(InvoiceIssueReadinessItemSchema),
  warnings: z.array(InvoiceIssueReadinessItemSchema),
  items: z.array(InvoiceIssueReadinessItemSchema),
});

const InvoiceArtifactSchema = z.object({
  id: z.uuid(),
  invoiceId: z.uuid(),
  artifactType: z.enum(["xrechnung_xml", "zugferd_pdf", "pdf_preview"]),
  profile: z.string(),
  profileVersion: NullableStringSchema,
  syntax: NullableStringSchema,
  mimeType: z.string(),
  storageRef: NullableStringSchema,
  sha256: NullableStringSchema,
  byteSize: z.number().nullable(),
  validationStatus: z.enum(["generated", "valid", "invalid"]),
  validationReport: JsonRecordSchema,
  validatorBundleVersion: NullableStringSchema,
  validatedAt: NullableStringSchema,
  buyerReference: NullableStringSchema,
  leitwegId: NullableStringSchema,
  templateVersionId: z.uuid().nullable(),
  invoiceVersion: z.number(),
  supersedesArtifactId: z.uuid().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: DateTimeStringSchema,
});

const InvoiceArtifactDeliverabilitySchema = z.object({
  invoiceId: z.uuid(),
  deliverable: z.boolean(),
  required: z.array(z.enum(["xrechnung_xml", "zugferd_pdf", "pdf_preview"])),
  missing: z.array(z.enum(["xrechnung_xml", "zugferd_pdf", "pdf_preview"])),
  artifacts: z.array(InvoiceArtifactSchema),
  blockers: z.array(InvoiceIssueReadinessItemSchema),
});

const TaxRuleSchema = z.object({
  code: z.string(),
  label: z.string(),
  category: z.enum(["standard", "reduced", "zero", "exempt", "reverse_charge", "intra_eu", "small_business", "margin_scheme"]),
  rateBps: z.number(),
  country: z.string(),
  eInvoiceCategoryCode: z.string(),
  legalReasonCode: NullableStringSchema,
  legalReasonText: NullableStringSchema,
  requiresLegalReasonText: z.boolean(),
  enabled: z.boolean(),
});

const InvoiceHomeWorkspaceStateSchema = z.object({
  workspace: InvoiceWorkspaceSchema,
  capabilities: InvoiceWorkspaceCapabilitiesSchema,
  setup: z.array(InvoiceSetupItemSchema),
  recentDrafts: z.array(InvoiceSummarySchema),
  recentIssued: z.array(InvoiceSummarySchema),
});

const InvoiceHomeStateSchema = z.object({
  workspaces: z.array(InvoiceHomeWorkspaceStateSchema),
});

const InvoiceWorkspaceStateSchema = z.object({
  workspace: InvoiceWorkspaceSchema,
  capabilities: InvoiceWorkspaceCapabilitiesSchema,
  setup: z.array(InvoiceSetupItemSchema),
  issuerProfiles: z.array(InvoiceIssuerProfileSchema),
  sequences: z.array(InvoiceSequenceSchema),
  templates: z.array(InvoiceTemplateSchema),
  counts: z.object({
    drafts: z.number(),
    issued: z.number(),
    failedArtifacts: z.number(),
    pendingArtifacts: z.number(),
  }),
});

const InvoiceComposerStateSchema = z.object({
  workspace: InvoiceWorkspaceSchema,
  capabilities: InvoiceWorkspaceCapabilitiesSchema,
  setup: z.array(InvoiceSetupItemSchema),
  templates: z.array(InvoiceTemplateSchema),
  issuerProfiles: z.array(InvoiceIssuerProfileSchema),
  sequences: z.array(InvoiceSequenceSchema),
  taxRules: z.array(TaxRuleSchema),
  draft: InvoiceDetailSchema.nullable(),
  readiness: InvoiceIssueReadinessSchema.nullable(),
});

const InvoiceDetailStateSchema = z.object({
  invoice: InvoiceDetailSchema,
  capabilities: z.object({
    canRead: z.boolean(),
    canEditDraft: z.boolean(),
    canIssue: z.boolean(),
    canRegisterArtifact: z.boolean(),
  }),
  readiness: InvoiceIssueReadinessSchema.nullable(),
  deliverability: InvoiceArtifactDeliverabilitySchema.nullable(),
  artifacts: z.array(InvoiceArtifactSchema),
});

const InvoiceOperationsStateSchema = z.object({
  workspace: InvoiceWorkspaceSchema,
  capabilities: InvoiceWorkspaceCapabilitiesSchema,
  pendingArtifacts: z.array(InvoiceArtifactSchema),
  invalidArtifacts: z.array(InvoiceArtifactSchema),
  recentIssuedWithoutDeliverableArtifacts: z.array(InvoiceSummarySchema),
});

const InvoiceSettingsStateSchema = z.object({
  workspace: InvoiceWorkspaceSchema,
  capabilities: InvoiceWorkspaceCapabilitiesSchema,
  issuerProfiles: z.array(InvoiceIssuerProfileSchema),
  sequences: z.array(InvoiceSequenceSchema),
  templates: z.array(InvoiceTemplateSchema),
  access: z.object({
    workspaceEntries: z.number(),
  }),
});

const actorFromContext = (c: Context<AuthContext>): InvoiceActor => {
  const user = c.get("user");
  return {
    userId: user.id,
    userGroups: user.memberofGroupIds,
  };
};

const app = new Hono<AuthContext>()
  .use(auth.requireRole("authenticated"))
  .get(
    "/status",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoices app status",
      description: "Returns a minimal status payload for the invoices app shell.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(AppStatusSchema, "Invoices app status"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => respond(c, ok({ app: "invoices" as const, ready: false })),
  )
  .get(
    "/state/home",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoices home state",
      description: "Returns server-computed invoices home state for the current user.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceHomeStateSchema, "Invoices home state"),
        401: jsonResponse(ErrorResponseSchema, "Authentication required"),
      },
    }),
    async (c) => respond(c, invoicesService.readModel.home({ actor: actorFromContext(c) })),
  )
  .get(
    "/workspaces/:workspaceId/state",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoice workspace state",
      description: "Returns server-computed workspace state including setup, capabilities, and settings lists.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceWorkspaceStateSchema, "Invoice workspace state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Workspace not found"),
      },
    }),
    v("param", WorkspaceParamSchema),
    async (c) =>
      respond(
        c,
        invoicesService.readModel.workspace({
          actor: actorFromContext(c),
          workspaceId: c.req.valid("param").workspaceId,
        }),
      ),
  )
  .get(
    "/workspaces/:workspaceId/composer",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoice composer state",
      description: "Returns server-computed state for creating a new invoice draft.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceComposerStateSchema, "Invoice composer state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Workspace not found"),
      },
    }),
    v("param", WorkspaceParamSchema),
    async (c) =>
      respond(
        c,
        invoicesService.readModel.composer({
          actor: actorFromContext(c),
          workspaceId: c.req.valid("param").workspaceId,
        }),
      ),
  )
  .get(
    "/workspaces/:workspaceId/composer/:draftId",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoice draft composer state",
      description: "Returns server-computed state for editing a draft invoice.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceComposerStateSchema, "Invoice draft composer state"),
        400: jsonResponse(ErrorResponseSchema, "Invalid draft state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Draft not found"),
      },
    }),
    v("param", DraftParamSchema),
    async (c) => {
      const params = c.req.valid("param");
      return respond(
        c,
        invoicesService.readModel.composer({
          actor: actorFromContext(c),
          workspaceId: params.workspaceId,
          draftId: params.draftId,
        }),
      );
    },
  )
  .get(
    "/workspaces/:workspaceId/invoices/:invoiceId/state",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoice detail state",
      description: "Returns invoice detail state with server-computed capabilities, readiness, and deliverability.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceDetailStateSchema, "Invoice detail state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Invoice not found"),
      },
    }),
    v("param", InvoiceParamSchema),
    async (c) => {
      const params = c.req.valid("param");
      return respond(
        c,
        invoicesService.readModel.invoiceDetail({
          actor: actorFromContext(c),
          workspaceId: params.workspaceId,
          invoiceId: params.invoiceId,
        }),
      );
    },
  )
  .get(
    "/workspaces/:workspaceId/operations",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoice operations state",
      description: "Returns artifact and deliverability operations state for a workspace.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceOperationsStateSchema, "Invoice operations state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Workspace not found"),
      },
    }),
    v("param", WorkspaceParamSchema),
    async (c) =>
      respond(
        c,
        invoicesService.readModel.operations({
          actor: actorFromContext(c),
          workspaceId: c.req.valid("param").workspaceId,
        }),
      ),
  )
  .get(
    "/workspaces/:workspaceId/settings",
    describeRoute({
      tags: ["Invoices"],
      summary: "Get invoice settings state",
      description: "Returns settings read state for a workspace. Mutations stay on dedicated endpoints.",
      ...requiresAuth,
      responses: {
        200: jsonResponse(InvoiceSettingsStateSchema, "Invoice settings state"),
        403: jsonResponse(ErrorResponseSchema, "Access denied"),
        404: jsonResponse(ErrorResponseSchema, "Workspace not found"),
      },
    }),
    v("param", WorkspaceParamSchema),
    async (c) =>
      respond(
        c,
        invoicesService.readModel.settings({
          actor: actorFromContext(c),
          workspaceId: c.req.valid("param").workspaceId,
        }),
      ),
  );

export default app;
export type ApiType = typeof app;
