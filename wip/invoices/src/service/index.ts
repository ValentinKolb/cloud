import type { AccessEntry, PermissionLevel } from "@valentinkolb/cloud/server";
import type { PageParams } from "@valentinkolb/stdlib";
import * as eInvoice from "./e-invoice";
import * as exportLedger from "./exports";
import * as invoices from "./invoices";
import * as issuerProfiles from "./issuer-profiles";
import * as readModels from "./read-models";
import * as sequences from "./sequences";
import * as tax from "./tax";
import * as templates from "./templates";
import * as workspaces from "./workspaces";
import type { InvoiceActor } from "./types";

export const invoicesService = {
  readModel: {
    home: readModels.getHomeState,
    workspace: readModels.getWorkspaceState,
    composer: readModels.getComposerState,
    invoiceDetail: readModels.getInvoiceDetailState,
    operations: readModels.getOperationsState,
    settings: readModels.getSettingsState,
  },
  invoice: {
    get: invoices.get,
    validateIssueReadiness: invoices.validateIssueReadiness,
    findByExternalRef: invoices.findByExternalRef,
    createDraft: invoices.createDraft,
    createDraftFromExternalRef: invoices.createDraftFromExternalRef,
    updateDraft: invoices.updateDraft,
    issueDraft: invoices.issueDraft,
    createCorrectionDraft: invoices.createCorrectionDraft,
  },
  artifact: {
    list: invoices.listArtifacts,
    register: invoices.registerArtifact,
    registerTrustedValidated: invoices.registerTrustedValidatedArtifact,
    deliverability: invoices.getArtifactDeliverability,
  },
  exportLedger: {
    register: exportLedger.register,
    list: exportLedger.list,
    get: exportLedger.get,
  },
  eInvoice: {
    buildXRechnungInput: eInvoice.buildXRechnungInput,
    generateXRechnungXml: eInvoice.generateXRechnungXml,
    generateXRechnungXmlArtifact: eInvoice.generateXRechnungXmlArtifact,
    embedZugferdPdf: eInvoice.embedZugferdPdf,
    generateZugferdPdfArtifact: eInvoice.generateZugferdPdfArtifact,
  },
  workspace: {
    list: workspaces.list,
    get: workspaces.get,
    create: workspaces.create,
    permission: workspaces.permission,
    access: {
      list: (config: {
        workspaceId: string;
        actor: InvoiceActor;
        pagination?: PageParams;
        filter?: {
          query?: string;
          principalType?: AccessEntry["principal"]["type"];
        };
      }) => workspaces.access.list(config),
      grant: workspaces.access.grant,
      remove: workspaces.access.remove,
      updatePermission: workspaces.access.updatePermission,
      count: workspaces.access.count,
    },
  },
  issuerProfile: {
    list: issuerProfiles.list,
    get: issuerProfiles.get,
    create: issuerProfiles.create,
  },
  sequence: {
    list: sequences.list,
    get: sequences.get,
    create: sequences.create,
    formatInvoiceNumber: sequences.formatInvoiceNumber,
  },
  tax: {
    listRules: tax.listTaxRules,
    resolveRule: tax.resolveTaxRule,
    calculateLine: tax.calculateLineTax,
    summarizeBreakdowns: tax.summarizeTaxBreakdowns,
  },
  template: {
    list: templates.list,
    listForCreate: templates.listForCreate,
    get: templates.get,
    create: templates.create,
    update: templates.update,
    version: templates.versions,
    access: templates.access,
  },
};

export type {
  AllocatedInvoiceNumber,
  CreateInvoiceIssuerProfileInput,
  CreateInvoiceSequenceInput,
  CreateInvoiceTemplateInput,
  CreateInvoiceTemplateVersionInput,
  UpdateInvoiceTemplateInput,
  CreateInvoiceWorkspaceInput,
  CreateInvoiceCorrectionInput,
  CreateInvoiceDraftInput,
  CreateInvoiceDraftFromExternalRefInput,
  InvoiceActor,
  Invoice,
  InvoiceArtifact,
  InvoiceArtifactDeliverability,
  InvoiceArtifactType,
  InvoiceArtifactValidationStatus,
  InvoiceComposerState,
  InvoiceDetailState,
  InvoiceHomeState,
  InvoiceHomeWorkspaceState,
  InvoiceIssuerProfile,
  InvoiceLine,
  InvoiceLineInput,
  InvoiceOperationsState,
  InvoicePartyInput,
  InvoicePostalAddress,
  InvoicePartyRole,
  InvoicePartySnapshot,
  InvoiceRecipientKind,
  InvoiceSequence,
  InvoiceSettingsState,
  InvoiceSetupItem,
  InvoiceStatus,
  InvoiceSupplyType,
  InvoiceDocumentType,
  InvoiceDetail,
  InvoiceExternalRefInput,
  InvoiceExternalRefLookupInput,
  InvoiceExportBatch,
  InvoiceExportBatchDetail,
  InvoiceExportBatchStatus,
  InvoiceExportItem,
  InvoiceExportItemStatus,
  InvoiceExportType,
  InvoiceIssueReadiness,
  InvoiceIssueReadinessItem,
  InvoiceIssueReadinessSeverity,
  InvoiceTaxBreakdown,
  InvoiceTemplate,
  InvoiceTemplateVersion,
  InvoiceWorkspace,
  InvoiceWorkspaceCapabilities,
  InvoiceWorkspaceState,
  RegisterInvoiceArtifactInput,
  RegisterTrustedInvoiceArtifactInput,
  RegisterInvoiceExportBatchInput,
  RegisterInvoiceExportItemInput,
  IssueInvoiceDraftInput,
  UpdateInvoiceDraftInput,
} from "./types";
export type { EmbeddedZugferdPdf, GeneratedXRechnungArtifact, GeneratedZugferdPdfArtifact } from "./e-invoice";
export type { InvoiceLineTaxInput, InvoiceLineTaxResult, InvoiceTaxBreakdownDraft, TaxCategory, TaxRule } from "./tax";
export type { PermissionLevel };
