import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { invoicesService } from ".";
import { migrate } from "../migrate";
import type { InvoiceActor } from "./types";

type TestUsers = {
  admin: string;
  reader: string;
};

const canUseDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ users: string | null; access: string | null; workspaces: string | null }[]>`
      SELECT
        to_regclass('auth.users')::text AS users,
        to_regclass('auth.access')::text AS access,
        to_regclass('invoices.invoice_workspaces')::text AS workspaces
    `;
    return Boolean(row?.users && row.access && row.workspaces);
  } catch {
    return false;
  }
};

const actor = (userId: string): InvoiceActor => ({ userId, userGroups: [] });

const insertUser = async (suffix: string, label: string): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.users (uid, provider, profile, display_name, mail)
    VALUES (${`invoice-invariants-${label}-${suffix}`}, 'local', 'user', ${`Invoice Invariants ${label}`}, ${`${label}.${suffix}@example.test`})
    RETURNING id
  `;
  if (!row) throw new Error("Failed to create test user");
  return row.id;
};

const createUsers = async (): Promise<TestUsers> => {
  const suffix = crypto.randomUUID();
  return {
    admin: await insertUser(suffix, "admin"),
    reader: await insertUser(suffix, "reader"),
  };
};

const cleanup = async (config: { workspaceId: string | null; users: TestUsers | null }): Promise<void> => {
  if (config.workspaceId) {
    await sql`ALTER TABLE invoices.invoice_events DISABLE TRIGGER reject_invoice_events_mutation`;
    await sql`ALTER TABLE invoices.invoice_artifacts DISABLE TRIGGER reject_invoice_artifacts_mutation`;
    await sql`ALTER TABLE invoices.invoice_export_batches DISABLE TRIGGER reject_invoice_export_batches_mutation`;
    await sql`ALTER TABLE invoices.invoice_export_items DISABLE TRIGGER reject_invoice_export_items_mutation`;
    await sql`ALTER TABLE invoices.invoices DISABLE TRIGGER reject_issued_invoice_header_mutation`;
    await sql`ALTER TABLE invoices.invoice_lines DISABLE TRIGGER reject_issued_invoice_lines_mutation`;
    await sql`ALTER TABLE invoices.invoice_party_snapshots DISABLE TRIGGER reject_issued_invoice_party_mutation`;
    await sql`ALTER TABLE invoices.invoice_tax_breakdowns DISABLE TRIGGER reject_issued_invoice_tax_mutation`;
    await sql`ALTER TABLE invoices.invoice_template_versions DISABLE TRIGGER reject_locked_template_version_mutation`;
    try {
      await sql`DELETE FROM invoices.invoice_events WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`DELETE FROM invoices.invoice_export_items WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`DELETE FROM invoices.invoice_export_batches WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`
        DELETE FROM invoices.invoice_artifacts a
        USING invoices.invoices i
        WHERE i.id = a.invoice_id
          AND i.workspace_id = ${config.workspaceId}::uuid
      `;
      await sql`DELETE FROM invoices.invoices WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`
        DELETE FROM invoices.invoice_template_access ta
        USING invoices.invoice_templates t
        WHERE t.id = ta.template_id
          AND t.workspace_id = ${config.workspaceId}::uuid
      `;
      await sql`UPDATE invoices.invoice_templates SET active_version_id = NULL WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`
        DELETE FROM invoices.invoice_template_versions v
        USING invoices.invoice_templates t
        WHERE t.id = v.template_id
          AND t.workspace_id = ${config.workspaceId}::uuid
      `;
      await sql`DELETE FROM invoices.invoice_templates WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`DELETE FROM invoices.invoice_sequences WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`DELETE FROM invoices.invoice_issuer_profiles WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`DELETE FROM invoices.invoice_workspace_access WHERE workspace_id = ${config.workspaceId}::uuid`;
      await sql`DELETE FROM invoices.invoice_workspaces WHERE id = ${config.workspaceId}::uuid`;
    } finally {
      await sql`ALTER TABLE invoices.invoice_template_versions ENABLE TRIGGER reject_locked_template_version_mutation`;
      await sql`ALTER TABLE invoices.invoice_tax_breakdowns ENABLE TRIGGER reject_issued_invoice_tax_mutation`;
      await sql`ALTER TABLE invoices.invoice_party_snapshots ENABLE TRIGGER reject_issued_invoice_party_mutation`;
      await sql`ALTER TABLE invoices.invoice_lines ENABLE TRIGGER reject_issued_invoice_lines_mutation`;
      await sql`ALTER TABLE invoices.invoices ENABLE TRIGGER reject_issued_invoice_header_mutation`;
      await sql`ALTER TABLE invoices.invoice_export_items ENABLE TRIGGER reject_invoice_export_items_mutation`;
      await sql`ALTER TABLE invoices.invoice_export_batches ENABLE TRIGGER reject_invoice_export_batches_mutation`;
      await sql`ALTER TABLE invoices.invoice_artifacts ENABLE TRIGGER reject_invoice_artifacts_mutation`;
      await sql`ALTER TABLE invoices.invoice_events ENABLE TRIGGER reject_invoice_events_mutation`;
    }
  }
  if (config.users) {
    for (const userId of Object.values(config.users)) {
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  }
};

const createIssuedInvoice = async (config: { workspaceId: string; admin: string }): Promise<string> => {
  const adminActor = actor(config.admin);
  const issuer = await invoicesService.issuerProfile.create({
    workspaceId: config.workspaceId,
    actor: adminActor,
    data: {
      name: "Invariant Seller GmbH",
      address: { line1: "Seller Street 1", postalCode: "10115", city: "Berlin", country: "DE" },
      taxNumber: "12/345/67890",
      defaultPaymentTermsDays: 14,
      eInvoiceProfile: "xrechnung",
    },
  });
  if (!issuer.ok) throw new Error(issuer.error.message);

  const sequence = await invoicesService.sequence.create({
    workspaceId: config.workspaceId,
    actor: adminActor,
    data: {
      issuerProfileId: issuer.data.id,
      documentType: "invoice",
      name: "Invariant invoices",
      prefix: "INV-INVARIANT-",
      nextNumber: 1,
      padding: 4,
    },
  });
  if (!sequence.ok) throw new Error(sequence.error.message);

  const template = await invoicesService.template.create({
    workspaceId: config.workspaceId,
    actor: adminActor,
    data: { issuerProfileId: issuer.data.id, name: "Invariant invoice" },
  });
  if (!template.ok) throw new Error(template.error.message);

  const version = await invoicesService.template.version.create({
    workspaceId: config.workspaceId,
    templateId: template.data.id,
    actor: adminActor,
    data: {
      issuerProfileId: issuer.data.id,
      numberSequenceId: sequence.data.id,
      paymentTermsDays: 14,
      currency: "EUR",
    },
  });
  if (!version.ok) throw new Error(version.error.message);

  const activeTemplate = await invoicesService.template.version.activate({
    workspaceId: config.workspaceId,
    templateId: template.data.id,
    versionId: version.data.id,
    actor: adminActor,
  });
  if (!activeTemplate.ok) throw new Error(activeTemplate.error.message);

  const draft = await invoicesService.invoice.createDraft({
    workspaceId: config.workspaceId,
    templateId: activeTemplate.data.id,
    actor: adminActor,
    recipient: {
      name: "Invariant Buyer AG",
      address: { line1: "Buyer Street 2", postalCode: "20095", city: "Hamburg", country: "DE" },
      country: "DE",
      recipientKind: "business",
      supplyType: "service",
    },
    lines: [{ title: "Consulting", quantity: 1, unitPriceNetCents: 10000, taxCode: "vat_de_standard_19" }],
  });
  if (!draft.ok) throw new Error(draft.error.message);

  const issued = await invoicesService.invoice.issueDraft({
    workspaceId: config.workspaceId,
    invoiceId: draft.data.id,
    expectedVersion: draft.data.version,
    actor: adminActor,
  });
  if (!issued.ok) throw new Error(issued.error.message);
  return issued.data.id;
};

describe("invoice service invariants", () => {
  test("hides unsupported generic V1 tax rules", () => {
    const visibleTaxCodes = invoicesService.tax.listRules().map((rule) => rule.code);
    expect(visibleTaxCodes).toContain("vat_de_standard_19");
    expect(visibleTaxCodes).toContain("vat_de_reduced_7");
    expect(visibleTaxCodes).toContain("vat_de_small_business_19_ustg");
    expect(visibleTaxCodes).not.toContain("vat_de_zero_0");
    expect(visibleTaxCodes).not.toContain("vat_exempt");
    expect(invoicesService.tax.resolveRule("vat_de_zero_0").ok).toBe(false);
    expect(invoicesService.tax.resolveRule("vat_exempt").ok).toBe(false);
  });

  test("protects workspace access, export evidence writes, and issued payment state", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping invoice service invariant DB test: auth/invoices tables are not available.");
      return;
    }
    await migrate();

    let users: TestUsers | null = null;
    let workspaceId: string | null = null;
    try {
      users = await createUsers();
      const workspace = await invoicesService.workspace.create({
        actor: actor(users.admin),
        data: { name: `Service Invariants ${crypto.randomUUID()}`, defaultCurrency: "EUR", locale: "de-DE" },
      });
      if (!workspace.ok) throw new Error(workspace.error.message);
      workspaceId = workspace.data.id;

      const emptySetup = await invoicesService.readModel.workspace({ workspaceId, actor: actor(users.admin) });
      expect(emptySetup.ok).toBe(true);
      if (emptySetup.ok) {
        expect(emptySetup.data.setup.map((item) => [item.code, item.complete])).toEqual([
          ["issuer_profile", false],
          ["issuer_legal_identity", false],
          ["invoice_sequence", false],
          ["active_template", false],
        ]);
      }

      const readerAccess = await invoicesService.workspace.access.grant({
        workspaceId,
        actor: actor(users.admin),
        principal: { type: "user", userId: users.reader },
        permission: "read",
      });
      if (!readerAccess.ok) throw new Error(readerAccess.error.message);

      const readerList = await invoicesService.workspace.access.list({ workspaceId, actor: actor(users.reader) });
      expect(readerList.ok).toBe(false);
      if (!readerList.ok) expect(readerList.error.status).toBe(403);

      const readerGrant = await invoicesService.workspace.access.grant({
        workspaceId,
        actor: actor(users.reader),
        principal: { type: "authenticated" },
        permission: "read",
        allowBroadAccess: true,
      });
      expect(readerGrant.ok).toBe(false);
      if (!readerGrant.ok) expect(readerGrant.error.status).toBe(403);

      const adminList = await invoicesService.workspace.access.list({ workspaceId, actor: actor(users.admin) });
      expect(adminList.ok).toBe(true);
      if (adminList.ok) expect(adminList.data.items.length).toBe(2);

      const invoiceId = await createIssuedInvoice({ workspaceId, admin: users.admin });
      const completeSetup = await invoicesService.readModel.workspace({ workspaceId, actor: actor(users.admin) });
      expect(completeSetup.ok).toBe(true);
      if (completeSetup.ok) {
        expect(completeSetup.data.setup.every((item) => item.complete)).toBe(true);
      }

      const genericValidArtifact = await invoicesService.artifact.register({
        workspaceId,
        actor: actor(users.admin),
        data: {
          invoiceId,
          artifactType: "xrechnung_xml",
          profile: "xrechnung",
          profileVersion: "EN16931",
          syntax: "cii",
          mimeType: "application/xml",
          storageRef: `test://${invoiceId}/valid.xml`,
          sha256: "c".repeat(64),
          byteSize: 123,
          validationStatus: "valid",
          validationReport: { validator: "test" },
          validatorBundleVersion: "test-validator",
          validatedAt: new Date().toISOString(),
        },
      });
      expect(genericValidArtifact.ok).toBe(false);
      if (!genericValidArtifact.ok) expect(genericValidArtifact.error.status).toBe(400);

      await sql`
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
          invoice_version,
          created_by
        )
        VALUES (
          ${invoiceId}::uuid,
          'xrechnung_xml',
          'zugferd',
          'EN16931',
          'cii',
          'application/xml',
          ${`test://${invoiceId}/wrong-profile.xml`},
          ${"d".repeat(64)},
          123,
          'valid',
          '{"validator":"trusted-test"}'::jsonb,
          'trusted-test',
          now(),
          2,
          ${users.admin}::uuid
        )
      `;
      const deliverability = await invoicesService.artifact.deliverability({
        workspaceId,
        invoiceId,
        actor: actor(users.admin),
      });
      expect(deliverability.ok).toBe(true);
      if (deliverability.ok) {
        expect(deliverability.data.deliverable).toBe(false);
        expect(deliverability.data.missing).toEqual(["xrechnung_xml"]);
      }

      const generatedArtifact = await invoicesService.artifact.register({
        workspaceId,
        actor: actor(users.admin),
        data: {
          invoiceId,
          artifactType: "xrechnung_xml",
          profile: "xrechnung",
          profileVersion: "EN16931",
          syntax: "cii",
          mimeType: "application/xml",
          storageRef: `test://${invoiceId}/generated.xml`,
          sha256: "e".repeat(64),
          byteSize: 456,
          validationStatus: "generated",
          validationReport: { validator: "generator-xsd" },
        },
      });
      expect(generatedArtifact.ok).toBe(true);

      const generatedOnlyDeliverability = await invoicesService.artifact.deliverability({
        workspaceId,
        invoiceId,
        actor: actor(users.admin),
      });
      expect(generatedOnlyDeliverability.ok).toBe(true);
      if (generatedOnlyDeliverability.ok) expect(generatedOnlyDeliverability.data.deliverable).toBe(false);

      const trustedArtifact = await invoicesService.artifact.registerTrustedValidated({
        workspaceId,
        actor: actor(users.admin),
        data: {
          invoiceId,
          artifactType: "xrechnung_xml",
          profile: "xrechnung",
          profileVersion: "EN16931",
          syntax: "cii",
          mimeType: "application/xml",
          storageRef: `test://${invoiceId}/generated.xml`,
          sha256: "e".repeat(64),
          byteSize: 456,
          validationReport: { validator: "trusted-test", valid: true },
          validatorBundleVersion: "trusted-test-2026.1",
        },
      });
      expect(trustedArtifact.ok).toBe(true);
      if (trustedArtifact.ok) expect(trustedArtifact.data.validationStatus).toBe("valid");

      const trustedReplay = await invoicesService.artifact.registerTrustedValidated({
        workspaceId,
        actor: actor(users.admin),
        data: {
          invoiceId,
          artifactType: "xrechnung_xml",
          profile: "xrechnung",
          profileVersion: "EN16931",
          syntax: "cii",
          mimeType: "application/xml",
          storageRef: `test://${invoiceId}/generated.xml`,
          sha256: "e".repeat(64),
          byteSize: 456,
          validationReport: { validator: "trusted-test", valid: true },
          validatorBundleVersion: "trusted-test-2026.1",
        },
      });
      expect(trustedReplay.ok).toBe(true);
      if (trustedReplay.ok && trustedArtifact.ok) expect(trustedReplay.data.id).toBe(trustedArtifact.data.id);

      const trustedConflict = await invoicesService.artifact.registerTrustedValidated({
        workspaceId,
        actor: actor(users.admin),
        data: {
          invoiceId,
          artifactType: "xrechnung_xml",
          profile: "xrechnung",
          profileVersion: "EN16931",
          syntax: "cii",
          mimeType: "application/xml",
          storageRef: `test://${invoiceId}/other-generated.xml`,
          sha256: "e".repeat(64),
          byteSize: 456,
          validationReport: { validator: "trusted-test", valid: true },
          validatorBundleVersion: "trusted-test-2026.1",
        },
      });
      expect(trustedConflict.ok).toBe(false);
      if (!trustedConflict.ok) expect(trustedConflict.error.status).toBe(409);

      const trustedDeliverability = await invoicesService.artifact.deliverability({
        workspaceId,
        invoiceId,
        actor: actor(users.admin),
      });
      expect(trustedDeliverability.ok).toBe(true);
      if (trustedDeliverability.ok) {
        expect(trustedDeliverability.data.deliverable).toBe(true);
        expect(trustedDeliverability.data.missing).toEqual([]);
      }

      const readerExport = await invoicesService.exportLedger.register({
        workspaceId,
        actor: actor(users.reader),
        data: {
          exportType: "summary_csv",
          formatVersion: "test-v1",
          generatorVersion: "test",
          fileSha256: "a".repeat(64),
          fileSize: 123,
          items: [{ invoiceId, rowNumber: 1 }],
        },
      });
      expect(readerExport.ok).toBe(false);
      if (!readerExport.ok) expect(readerExport.error.status).toBe(403);

      let paymentUpdateRejected = false;
      try {
        await sql`UPDATE invoices.invoices SET payment_status = 'paid' WHERE id = ${invoiceId}::uuid`;
      } catch {
        paymentUpdateRejected = true;
      }
      expect(paymentUpdateRejected).toBe(true);

      const adminExport = await invoicesService.exportLedger.register({
        workspaceId,
        actor: actor(users.admin),
        data: {
          exportType: "summary_csv",
          formatVersion: "test-v1",
          generatorVersion: "test",
          fileSha256: "b".repeat(64),
          fileSize: 123,
          items: [{ invoiceId, rowNumber: 1 }],
        },
      });
      expect(adminExport.ok).toBe(true);
      if (adminExport.ok) expect(adminExport.data.items.length).toBe(1);
    } finally {
      await cleanup({ workspaceId, users });
    }
  }, 60_000);

  test("requires XRechnung XML for public-sector recipients in V1", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping public-sector e-invoice invariant DB test: auth/invoices tables are not available.");
      return;
    }
    await migrate();

    let users: TestUsers | null = null;
    let workspaceId: string | null = null;
    try {
      users = await createUsers();
      const adminActor = actor(users.admin);
      const workspace = await invoicesService.workspace.create({
        actor: adminActor,
        data: { name: `Public Sector Gate ${crypto.randomUUID()}`, defaultCurrency: "EUR", locale: "de-DE" },
      });
      if (!workspace.ok) throw new Error(workspace.error.message);
      workspaceId = workspace.data.id;

      const issuer = await invoicesService.issuerProfile.create({
        workspaceId,
        actor: adminActor,
        data: {
          name: "Public Sector Seller GmbH",
          address: { line1: "Seller Street 1", postalCode: "10115", city: "Berlin", country: "DE" },
          taxNumber: "12/345/67890",
          defaultPaymentTermsDays: 14,
          eInvoiceProfile: "zugferd",
        },
      });
      if (!issuer.ok) throw new Error(issuer.error.message);

      const sequence = await invoicesService.sequence.create({
        workspaceId,
        actor: adminActor,
        data: {
          issuerProfileId: issuer.data.id,
          documentType: "invoice",
          name: "Public sector invoices",
          prefix: "INV-B2G-",
          nextNumber: 1,
          padding: 4,
        },
      });
      if (!sequence.ok) throw new Error(sequence.error.message);

      const template = await invoicesService.template.create({
        workspaceId,
        actor: adminActor,
        data: { issuerProfileId: issuer.data.id, name: "Public sector invoice" },
      });
      if (!template.ok) throw new Error(template.error.message);

      const version = await invoicesService.template.version.create({
        workspaceId,
        templateId: template.data.id,
        actor: adminActor,
        data: {
          issuerProfileId: issuer.data.id,
          numberSequenceId: sequence.data.id,
          paymentTermsDays: 14,
          currency: "EUR",
        },
      });
      if (!version.ok) throw new Error(version.error.message);

      const activeTemplate = await invoicesService.template.version.activate({
        workspaceId,
        templateId: template.data.id,
        versionId: version.data.id,
        actor: adminActor,
      });
      if (!activeTemplate.ok) throw new Error(activeTemplate.error.message);

      const draft = await invoicesService.invoice.createDraft({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: adminActor,
        recipient: {
          name: "Public Buyer",
          address: { line1: "Public Street 2", postalCode: "53113", city: "Bonn", country: "DE" },
          country: "DE",
          recipientKind: "public_sector",
          supplyType: "service",
          buyerReference: "991-12345-67",
        },
        lines: [{ title: "Consulting", quantity: 1, unitPriceNetCents: 10000, taxCode: "vat_de_standard_19" }],
      });
      if (!draft.ok) throw new Error(draft.error.message);

      const readiness = await invoicesService.invoice.validateIssueReadiness({
        workspaceId,
        invoiceId: draft.data.id,
        actor: adminActor,
      });
      expect(readiness.ok).toBe(true);
      if (readiness.ok) {
        expect(readiness.data.ready).toBe(false);
        expect(readiness.data.blockers.some((item) => item.message.includes("Public-sector recipients require XRechnung XML"))).toBe(true);
      }

      const issued = await invoicesService.invoice.issueDraft({
        workspaceId,
        invoiceId: draft.data.id,
        expectedVersion: draft.data.version,
        actor: adminActor,
      });
      expect(issued.ok).toBe(false);
      if (!issued.ok) expect(issued.error.message).toContain("Public-sector recipients require XRechnung XML");
    } finally {
      await cleanup({ workspaceId, users });
    }
  }, 60_000);
});
