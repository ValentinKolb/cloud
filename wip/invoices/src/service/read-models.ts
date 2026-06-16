import { hasPermission, type PermissionLevel } from "@valentinkolb/cloud/server";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import { sql } from "bun";
import { getTemplatePermission, getWorkspacePermission } from "./access";
import { listArtifacts, get as getInvoice, getArtifactDeliverability, validateIssueReadiness } from "./invoices";
import { list as listIssuerProfiles } from "./issuer-profiles";
import { list as listSequences } from "./sequences";
import { isUuid, parseJsonRecord, toDateOnly } from "./shared";
import { listTaxRules } from "./tax";
import { list as listTemplates, listForCreate as listTemplatesForCreate } from "./templates";
import { get as getWorkspace, list as listWorkspaces } from "./workspaces";
import type {
  InvoiceActor,
  InvoiceArtifact,
  InvoiceComposerState,
  InvoiceDetailState,
  InvoiceHomeState,
  InvoiceHomeWorkspaceState,
  InvoiceIssuerProfile,
  InvoiceSequence,
  InvoiceOperationsState,
  InvoiceSetupItem,
  InvoiceSettingsState,
  InvoiceTemplate,
  InvoiceSummary,
  InvoiceWorkspace,
  InvoiceWorkspaceCapabilities,
  InvoiceWorkspaceState,
} from "./types";

type DbInvoiceSummary = {
  id: string;
  workspace_id: string;
  document_type: InvoiceSummary["documentType"];
  status: InvoiceSummary["status"];
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
  payment_status: InvoiceSummary["paymentStatus"];
  compliance_snapshot: unknown;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  issued_by: string | null;
  created_at: Date;
  updated_at: Date;
  issued_at: Date | null;
  buyer_name: string | null;
  has_valid_required_artifact: boolean;
  has_required_artifact: boolean;
};

type WorkspaceCounts = {
  drafts: number;
  issued: number;
  failed_artifacts: number;
  pending_artifacts: number;
};

const capabilitiesFromPermission = (permission: PermissionLevel): InvoiceWorkspaceCapabilities => ({
  canRead: hasPermission(permission, "read"),
  canCreate: hasPermission(permission, "write"),
  canAdmin: hasPermission(permission, "admin"),
});

const capabilitiesFor = (config: {
  permission: PermissionLevel;
  hasReadableTemplates: boolean;
  hasCreatableTemplates: boolean;
}): InvoiceWorkspaceCapabilities => {
  const capabilities = capabilitiesFromPermission(config.permission);
  return {
    ...capabilities,
    canRead: capabilities.canRead || config.hasReadableTemplates,
    canCreate: capabilities.canCreate || config.hasCreatableTemplates,
  };
};

const workspacePermission = async (workspaceId: string, actor: InvoiceActor): Promise<PermissionLevel> =>
  getWorkspacePermission({ workspaceId, userId: actor.userId, userGroups: actor.userGroups });

const mapSummary = (row: DbInvoiceSummary): InvoiceSummary => ({
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
  buyerName: row.buyer_name,
  artifactStatus:
    row.status !== "issued"
      ? "not_required"
      : row.has_valid_required_artifact
        ? "deliverable"
        : row.has_required_artifact
          ? "pending"
          : "blocked",
});

const stringField = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const hasCompletePostalAddress = (address: unknown, fallbackCountry: string | null): boolean => {
  const record = parseJsonRecord(address);
  return Boolean(
    stringField(record, "line1") &&
      stringField(record, "postalCode") &&
      stringField(record, "city") &&
      (stringField(record, "country") || fallbackCountry?.trim()),
  );
};

const hasSupportedEInvoiceProfile = (value: string): boolean =>
  ["xrechnung", "xml", "zugferd", "factur-x", "facturx", "pdf-a-3", "both", "xrechnung+zugferd", "xrechnung_zugferd"].includes(
    value.trim().toLowerCase(),
  );

const issuerProfileIsComplete = (issuer: InvoiceIssuerProfile): boolean =>
  Boolean(
    issuer.name.trim() &&
      hasCompletePostalAddress(issuer.address, issuer.country) &&
      (issuer.taxNumber?.trim() || issuer.vatId?.trim()) &&
      Number.isInteger(issuer.defaultPaymentTermsDays) &&
      issuer.defaultPaymentTermsDays >= 0 &&
      issuer.defaultCurrency.trim().length === 3 &&
      hasSupportedEInvoiceProfile(issuer.eInvoiceProfile),
  );

const workspaceSetup = (config: {
  issuerProfiles: readonly InvoiceIssuerProfile[];
  sequences: readonly InvoiceSequence[];
  templates: readonly InvoiceTemplate[];
}): InvoiceSetupItem[] => {
  const hasIssuerProfile = config.issuerProfiles.length > 0;
  const hasCompleteIssuerProfile = config.issuerProfiles.some(issuerProfileIsComplete);
  const hasSequence = config.sequences.length > 0;
  const hasActiveTemplate = config.templates.some((template) => template.status === "active" && template.activeVersionId);

  return [
    {
      code: "issuer_profile",
      label: "Issuer profile",
      complete: hasIssuerProfile,
      severity: "blocker",
    },
    {
      code: "issuer_legal_identity",
      label: "Issuer legal identity",
      complete: hasCompleteIssuerProfile,
      severity: "blocker",
    },
    {
      code: "invoice_sequence",
      label: "Invoice sequence",
      complete: hasSequence,
      severity: "blocker",
    },
    {
      code: "active_template",
      label: "Active template",
      complete: hasActiveTemplate,
      severity: "blocker",
    },
  ];
};

const listSummaries = async (config: {
  actor: InvoiceActor;
  workspaceId: string;
  status?: "draft" | "issued";
  limit: number;
  includeDrafts: boolean;
  onlyIssuedWithoutDeliverableArtifact?: boolean;
}): Promise<InvoiceSummary[]> => {
  const statusFilter = config.status ?? null;
  const rows = await sql<DbInvoiceSummary[]>`
    WITH invoice_profiles AS (
      SELECT
        i.*,
        lower(COALESCE(NULLIF(i.compliance_snapshot #>> '{issuer,eInvoiceProfile}', ''), issuer.e_invoice_profile)) AS required_e_invoice_profile
      FROM invoices.invoices i
      JOIN invoices.invoice_issuer_profiles issuer ON issuer.id = i.issuer_profile_id
      WHERE i.workspace_id = ${config.workspaceId}::uuid
        AND (${statusFilter}::text IS NULL OR i.status = ${statusFilter})
        AND (${config.includeDrafts}::boolean OR i.status <> 'draft')
    )
    SELECT
      i.*,
      buyer.name AS buyer_name,
      EXISTS (
        SELECT 1
        FROM invoices.invoice_artifacts a
        WHERE a.invoice_id = i.id
          AND a.validation_status = 'valid'
          AND (
            (i.required_e_invoice_profile IN ('xrechnung', 'xml') AND a.artifact_type = 'xrechnung_xml')
            OR (i.required_e_invoice_profile IN ('zugferd', 'factur-x', 'pdf-a-3') AND a.artifact_type = 'zugferd_pdf')
            OR (i.required_e_invoice_profile = 'both' AND a.artifact_type IN ('xrechnung_xml', 'zugferd_pdf'))
          )
      ) AS has_valid_required_artifact,
      EXISTS (
        SELECT 1
        FROM invoices.invoice_artifacts a
        WHERE a.invoice_id = i.id
          AND (
            (i.required_e_invoice_profile IN ('xrechnung', 'xml') AND a.artifact_type = 'xrechnung_xml')
            OR (i.required_e_invoice_profile IN ('zugferd', 'factur-x', 'pdf-a-3') AND a.artifact_type = 'zugferd_pdf')
            OR (i.required_e_invoice_profile = 'both' AND a.artifact_type IN ('xrechnung_xml', 'zugferd_pdf'))
          )
      ) AS has_required_artifact
    FROM invoice_profiles i
    LEFT JOIN invoices.invoice_party_snapshots buyer ON buyer.invoice_id = i.id AND buyer.role = 'buyer'
    ORDER BY i.updated_at DESC
    LIMIT ${config.limit}
  `;

  const summariesWithHidden = await Promise.all(
    rows.map(async (row): Promise<InvoiceSummary | null> => {
      const visibleInvoice = await getInvoice({ workspaceId: config.workspaceId, id: row.id, actor: config.actor });
      if (!visibleInvoice) return null;

      const summary = mapSummary(row);
      if (summary.status !== "issued") return summary;

      const deliverability = await getArtifactDeliverability({
        workspaceId: config.workspaceId,
        invoiceId: summary.id,
        actor: config.actor,
      });
      if (!deliverability.ok) return { ...summary, artifactStatus: "blocked" };

      const hasRequiredArtifact = deliverability.data.required.some((artifactType) =>
        deliverability.data.artifacts.some((artifact) => artifact.artifactType === artifactType),
      );
      return {
        ...summary,
        artifactStatus: deliverability.data.deliverable ? "deliverable" : hasRequiredArtifact ? "pending" : "blocked",
      };
    }),
  );
  const summaries = summariesWithHidden.filter((summary): summary is InvoiceSummary => summary !== null);
  if (!config.onlyIssuedWithoutDeliverableArtifact) return summaries;
  return summaries.filter((summary) => summary.status === "issued" && summary.artifactStatus !== "deliverable");
};

const loadWorkspaceStateParts = async (workspace: InvoiceWorkspace, actor: InvoiceActor) => {
  const [permission, issuerProfiles, sequences, templates, creatableTemplates, counts] = await Promise.all([
    workspacePermission(workspace.id, actor),
    listIssuerProfiles({ workspaceId: workspace.id, actor }),
    listSequences({ workspaceId: workspace.id, actor }),
    listTemplates({ workspaceId: workspace.id, actor }),
    listTemplatesForCreate({ workspaceId: workspace.id, actor }),
    sql<WorkspaceCounts[]>`
      SELECT
        COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
        COUNT(*) FILTER (WHERE status = 'issued')::int AS issued,
        COUNT(a.id) FILTER (WHERE a.validation_status = 'invalid')::int AS failed_artifacts,
        COUNT(a.id) FILTER (WHERE a.validation_status = 'generated')::int AS pending_artifacts
      FROM invoices.invoices i
      LEFT JOIN invoices.invoice_artifacts a ON a.invoice_id = i.id
      WHERE i.workspace_id = ${workspace.id}::uuid
    `,
  ]);

  const setup = workspaceSetup({ issuerProfiles, sequences, templates });
  return {
    permission,
    capabilities: capabilitiesFor({
      permission,
      hasReadableTemplates: templates.length > 0,
      hasCreatableTemplates: creatableTemplates.length > 0,
    }),
    setup,
    issuerProfiles,
    sequences,
    templates,
    counts: counts[0] ?? { drafts: 0, issued: 0, failed_artifacts: 0, pending_artifacts: 0 },
  };
};

export const getHomeState = async (config: { actor: InvoiceActor }): Promise<Result<InvoiceHomeState>> => {
  const workspaces = await listWorkspaces({ actor: config.actor });
  const states: InvoiceHomeWorkspaceState[] = [];

  for (const workspace of workspaces) {
    const parts = await loadWorkspaceStateParts(workspace, config.actor);
    states.push({
      workspace,
      capabilities: parts.capabilities,
      setup: parts.setup,
      recentDrafts: parts.capabilities.canCreate
        ? await listSummaries({ actor: config.actor, workspaceId: workspace.id, status: "draft", limit: 5, includeDrafts: true })
        : [],
      recentIssued: await listSummaries({ actor: config.actor, workspaceId: workspace.id, status: "issued", limit: 5, includeDrafts: false }),
    });
  }

  return ok({ workspaces: states });
};

export const getWorkspaceState = async (config: { actor: InvoiceActor; workspaceId: string }): Promise<Result<InvoiceWorkspaceState>> => {
  if (!isUuid(config.workspaceId)) return fail(err.notFound("Invoice workspace"));
  const workspace = await getWorkspace({ id: config.workspaceId, actor: config.actor });
  if (!workspace) return fail(err.notFound("Invoice workspace"));
  const parts = await loadWorkspaceStateParts(workspace, config.actor);
  if (!parts.capabilities.canRead && !parts.capabilities.canCreate) return fail(err.forbidden("Access denied"));

  return ok({
    workspace,
    capabilities: parts.capabilities,
    setup: parts.setup,
    issuerProfiles: parts.issuerProfiles,
    sequences: parts.sequences,
    templates: parts.templates,
    counts: {
      drafts: parts.counts.drafts,
      issued: parts.counts.issued,
      failedArtifacts: parts.counts.failed_artifacts,
      pendingArtifacts: parts.counts.pending_artifacts,
    },
  });
};

export const getComposerState = async (config: {
  actor: InvoiceActor;
  workspaceId: string;
  draftId?: string | null;
}): Promise<Result<InvoiceComposerState>> => {
  const workspaceState = await getWorkspaceState({ actor: config.actor, workspaceId: config.workspaceId });
  if (!workspaceState.ok) return workspaceState;
  const creatableTemplates = await listTemplatesForCreate({ workspaceId: config.workspaceId, actor: config.actor });
  if (!workspaceState.data.capabilities.canCreate && creatableTemplates.length === 0) return fail(err.forbidden("Invoice create access required"));

  const draft = config.draftId ? await getInvoice({ workspaceId: config.workspaceId, id: config.draftId, actor: config.actor }) : null;
  if (config.draftId && !draft) return fail(err.notFound("Invoice draft"));
  if (draft && draft.status !== "draft") return fail(err.badInput("Composer can only edit draft invoices"));
  const readiness = draft
    ? await validateIssueReadiness({ workspaceId: config.workspaceId, invoiceId: draft.id, actor: config.actor })
    : null;
  if (readiness && !readiness.ok) return readiness;

  return ok({
    workspace: workspaceState.data.workspace,
    capabilities: workspaceState.data.capabilities,
    setup: workspaceState.data.setup,
    templates: creatableTemplates,
    issuerProfiles: workspaceState.data.issuerProfiles,
    sequences: workspaceState.data.sequences,
    taxRules: listTaxRules(),
    draft,
    readiness: readiness?.data ?? null,
  });
};

export const getInvoiceDetailState = async (config: {
  actor: InvoiceActor;
  workspaceId: string;
  invoiceId: string;
}): Promise<Result<InvoiceDetailState>> => {
  const invoice = await getInvoice({ workspaceId: config.workspaceId, id: config.invoiceId, actor: config.actor });
  if (!invoice) return fail(err.notFound("Invoice"));
  const templatePermission = await getTemplatePermission({
    workspaceId: invoice.workspaceId,
    templateId: invoice.templateId,
    userId: config.actor.userId,
    userGroups: config.actor.userGroups,
  });
  const canWrite = hasPermission(templatePermission, "write");
  const [artifacts, readiness, deliverability] = await Promise.all([
    listArtifacts({ workspaceId: invoice.workspaceId, invoiceId: invoice.id, actor: config.actor }),
    invoice.status === "draft" ? validateIssueReadiness({ workspaceId: invoice.workspaceId, invoiceId: invoice.id, actor: config.actor }) : null,
    invoice.status === "issued" ? getArtifactDeliverability({ workspaceId: invoice.workspaceId, invoiceId: invoice.id, actor: config.actor }) : null,
  ]);
  if (!artifacts.ok) return artifacts;
  if (readiness && !readiness.ok) return readiness;
  if (deliverability && !deliverability.ok) return deliverability;

  return ok({
    invoice,
    capabilities: {
      canRead: true,
      canEditDraft: invoice.status === "draft" && canWrite,
      canIssue: invoice.status === "draft" && canWrite,
      canRegisterArtifact: invoice.status === "issued" && canWrite,
    },
    readiness: readiness?.data ?? null,
    deliverability: deliverability?.data ?? null,
    artifacts: artifacts.data,
  });
};

export const getOperationsState = async (config: {
  actor: InvoiceActor;
  workspaceId: string;
}): Promise<Result<InvoiceOperationsState>> => {
  const workspaceState = await getWorkspaceState({ actor: config.actor, workspaceId: config.workspaceId });
  if (!workspaceState.ok) return workspaceState;

  const artifactRows = await sql<{ invoice_id: string }[]>`
    SELECT DISTINCT a.invoice_id
    FROM invoices.invoice_artifacts a
    JOIN invoices.invoices i ON i.id = a.invoice_id
    WHERE i.workspace_id = ${config.workspaceId}::uuid
      AND a.validation_status IN ('generated', 'invalid')
    LIMIT 50
  `;
  const artifacts: InvoiceArtifact[] = [];
  for (const row of artifactRows) {
    const listed = await listArtifacts({ workspaceId: config.workspaceId, invoiceId: row.invoice_id, actor: config.actor });
    if (listed.ok) artifacts.push(...listed.data.filter((artifact) => artifact.validationStatus !== "valid"));
  }

  return ok({
    workspace: workspaceState.data.workspace,
    capabilities: workspaceState.data.capabilities,
    pendingArtifacts: artifacts.filter((artifact) => artifact.validationStatus === "generated"),
    invalidArtifacts: artifacts.filter((artifact) => artifact.validationStatus === "invalid"),
    recentIssuedWithoutDeliverableArtifacts: await listSummaries({
      actor: config.actor,
      workspaceId: config.workspaceId,
      status: "issued",
      limit: 20,
      includeDrafts: false,
      onlyIssuedWithoutDeliverableArtifact: true,
    }),
  });
};

export const getSettingsState = async (config: {
  actor: InvoiceActor;
  workspaceId: string;
}): Promise<Result<InvoiceSettingsState>> => {
  const workspaceState = await getWorkspaceState({ actor: config.actor, workspaceId: config.workspaceId });
  if (!workspaceState.ok) return workspaceState;
  const workspaceEntries = workspaceState.data.capabilities.canAdmin
    ? await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM invoices.invoice_workspace_access
        WHERE workspace_id = ${config.workspaceId}::uuid
      `
    : [{ count: 0 }];

  return ok({
    workspace: workspaceState.data.workspace,
    capabilities: workspaceState.data.capabilities,
    issuerProfiles: workspaceState.data.issuerProfiles,
    sequences: workspaceState.data.sequences,
    templates: workspaceState.data.templates,
    access: {
      workspaceEntries: workspaceEntries[0]?.count ?? 0,
    },
  });
};
