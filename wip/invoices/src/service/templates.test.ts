import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { invoicesService } from ".";
import type { InvoiceActor } from "./types";

type TestUsers = {
  admin: string;
  writer: string;
  reader: string;
  outsider: string;
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
    VALUES (${`invoice-template-${label}-${suffix}`}, 'local', 'user', ${`Invoice Template ${label}`}, ${`${label}.${suffix}@example.test`})
    RETURNING id
  `;
  if (!row) throw new Error("Failed to create test user");
  return row.id;
};

const createUsers = async (): Promise<TestUsers> => {
  const suffix = crypto.randomUUID();
  return {
    admin: await insertUser(suffix, "admin"),
    writer: await insertUser(suffix, "writer"),
    reader: await insertUser(suffix, "reader"),
    outsider: await insertUser(suffix, "outsider"),
  };
};

const cleanup = async (config: { workspaceId: string | null; users: TestUsers | null }): Promise<void> => {
  if (config.workspaceId) {
    await sql`ALTER TABLE invoices.invoice_events DISABLE TRIGGER reject_invoice_events_mutation`;
    await sql`ALTER TABLE invoices.invoice_template_versions DISABLE TRIGGER reject_locked_template_version_mutation`;
    try {
      await sql`DELETE FROM invoices.invoice_events WHERE workspace_id = ${config.workspaceId}::uuid`;
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
      await sql`ALTER TABLE invoices.invoice_events ENABLE TRIGGER reject_invoice_events_mutation`;
    }
  }
  if (config.users) {
    for (const userId of Object.values(config.users)) {
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
  }
};

describe("invoice template access service", () => {
  test("filters templates and draft creation by template permission", async () => {
    if (!(await canUseDatabase())) {
      console.warn("Skipping invoice template access DB test: auth/invoices tables are not available.");
      return;
    }

    let users: TestUsers | null = null;
    let workspaceId: string | null = null;
    try {
      users = await createUsers();
      const workspace = await invoicesService.workspace.create({
        actor: actor(users.admin),
        data: { name: `Template Access ${crypto.randomUUID()}`, defaultCurrency: "EUR", locale: "de-DE" },
      });
      if (!workspace.ok) throw new Error(workspace.error.message);
      workspaceId = workspace.data.id;

      const issuer = await invoicesService.issuerProfile.create({
        workspaceId,
        actor: actor(users.admin),
        data: {
          name: "Example Seller GmbH",
          address: { line1: "Seller Street 1", postalCode: "10115", city: "Berlin", country: "DE" },
          taxNumber: "12/345/67890",
          defaultPaymentTermsDays: 14,
          eInvoiceProfile: "xrechnung",
        },
      });
      if (!issuer.ok) throw new Error(issuer.error.message);

      const sequence = await invoicesService.sequence.create({
        workspaceId,
        actor: actor(users.admin),
        data: {
          issuerProfileId: issuer.data.id,
          documentType: "invoice",
          name: "Default invoices",
          prefix: "INV-TEST-",
          nextNumber: 1,
          padding: 4,
        },
      });
      if (!sequence.ok) throw new Error(sequence.error.message);

      const template = await invoicesService.template.create({
        workspaceId,
        actor: actor(users.admin),
        data: { issuerProfileId: issuer.data.id, name: "Consulting invoice" },
      });
      if (!template.ok) throw new Error(template.error.message);

      const version = await invoicesService.template.version.create({
        workspaceId,
        templateId: template.data.id,
        actor: actor(users.admin),
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
        actor: actor(users.admin),
      });
      if (!activeTemplate.ok) throw new Error(activeTemplate.error.message);

      const writerAccess = await invoicesService.template.access.grant({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.admin),
        principal: { type: "user", userId: users.writer },
        permission: "write",
      });
      if (!writerAccess.ok) throw new Error(writerAccess.error.message);

      const readerAccess = await invoicesService.template.access.grant({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.admin),
        principal: { type: "user", userId: users.reader },
        permission: "read",
      });
      if (!readerAccess.ok) throw new Error(readerAccess.error.message);

      expect((await invoicesService.template.list({ workspaceId, actor: actor(users.outsider) })).map((item) => item.id)).toEqual([]);
      expect((await invoicesService.template.list({ workspaceId, actor: actor(users.reader) })).map((item) => item.id)).toEqual([activeTemplate.data.id]);
      expect((await invoicesService.template.listForCreate({ workspaceId, actor: actor(users.reader) })).map((item) => item.id)).toEqual([]);
      expect((await invoicesService.template.listForCreate({ workspaceId, actor: actor(users.writer) })).map((item) => item.id)).toEqual([
        activeTemplate.data.id,
      ]);

      const readerWorkspaceState = await invoicesService.readModel.workspace({ workspaceId, actor: actor(users.reader) });
      expect(readerWorkspaceState.ok).toBe(true);
      if (readerWorkspaceState.ok) {
        expect(readerWorkspaceState.data.capabilities).toMatchObject({ canRead: true, canCreate: false, canAdmin: false });
      }

      const writerWorkspaceState = await invoicesService.readModel.workspace({ workspaceId, actor: actor(users.writer) });
      expect(writerWorkspaceState.ok).toBe(true);
      if (writerWorkspaceState.ok) {
        expect(writerWorkspaceState.data.capabilities).toMatchObject({ canRead: true, canCreate: true, canAdmin: false });
      }

      const writerComposer = await invoicesService.readModel.composer({ workspaceId, actor: actor(users.writer) });
      expect(writerComposer.ok).toBe(true);
      if (writerComposer.ok) expect(writerComposer.data.templates.map((item) => item.id)).toEqual([activeTemplate.data.id]);

      const readerComposer = await invoicesService.readModel.composer({ workspaceId, actor: actor(users.reader) });
      expect(readerComposer.ok).toBe(false);
      if (!readerComposer.ok) expect(readerComposer.error.status).toBe(403);

      const readerDraft = await invoicesService.invoice.createDraft({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.reader),
        recipient: {
          name: "Example Buyer AG",
          address: { line1: "Buyer Street 2", postalCode: "20095", city: "Hamburg", country: "DE" },
          country: "DE",
          recipientKind: "business",
          supplyType: "service",
        },
        lines: [{ title: "Consulting", quantity: 1, unitPriceNetCents: 10000, taxCode: "vat_de_standard_19" }],
      });
      expect(readerDraft.ok).toBe(false);
      if (!readerDraft.ok) expect(readerDraft.error.status).toBe(403);

      const writerDraft = await invoicesService.invoice.createDraft({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.writer),
        recipient: {
          name: "Example Buyer AG",
          address: { line1: "Buyer Street 2", postalCode: "20095", city: "Hamburg", country: "DE" },
          country: "DE",
          recipientKind: "business",
          supplyType: "service",
        },
        lines: [{ title: "Consulting", quantity: 1, unitPriceNetCents: 10000, taxCode: "vat_de_standard_19" }],
      });
      expect(writerDraft.ok).toBe(true);
      if (writerDraft.ok) {
        const writerDraftState = await invoicesService.readModel.invoiceDetail({
          workspaceId,
          invoiceId: writerDraft.data.id,
          actor: actor(users.writer),
        });
        expect(writerDraftState.ok).toBe(true);
        if (writerDraftState.ok) expect(writerDraftState.data.capabilities).toMatchObject({ canEditDraft: true, canIssue: true });

        const readerDraftState = await invoicesService.readModel.invoiceDetail({
          workspaceId,
          invoiceId: writerDraft.data.id,
          actor: actor(users.reader),
        });
        expect(readerDraftState.ok).toBe(false);
      }

      const readerUpdate = await invoicesService.template.update({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.reader),
        data: { name: "Reader rename" },
      });
      expect(readerUpdate.ok).toBe(false);
      if (!readerUpdate.ok) expect(readerUpdate.error.status).toBe(403);

      const adminUpdate = await invoicesService.template.update({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.admin),
        data: { name: "Consulting invoice updated" },
      });
      expect(adminUpdate.ok).toBe(true);
      if (adminUpdate.ok) expect(adminUpdate.data.name).toBe("Consulting invoice updated");

      const promoted = await invoicesService.template.access.updatePermission({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.admin),
        accessId: readerAccess.data.id,
        permission: "write",
      });
      expect(promoted.ok).toBe(true);
      expect((await invoicesService.template.listForCreate({ workspaceId, actor: actor(users.reader) })).map((item) => item.id)).toEqual([
        activeTemplate.data.id,
      ]);

      const removed = await invoicesService.template.access.remove({
        workspaceId,
        templateId: activeTemplate.data.id,
        actor: actor(users.admin),
        accessId: writerAccess.data.id,
      });
      expect(removed.ok).toBe(true);
      expect((await invoicesService.template.list({ workspaceId, actor: actor(users.writer) })).map((item) => item.id)).toEqual([]);
    } finally {
      await cleanup({ workspaceId, users });
    }
  });
});
