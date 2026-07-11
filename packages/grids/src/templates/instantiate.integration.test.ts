import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { instantiate } from "../service/templates";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("built-in template instantiation", () => {
  postgresTest(
    "creates Inventory document, email, and workflow resources through production services",
    async () => {
      await migrate();
      const created = await instantiate("inventory", { name: `Inventory integration ${Bun.randomUUIDv7()}`, withSampleData: false }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.message);

      try {
        const [documentTemplate] = await sql<Array<{ name: string; source: string }>>`
        SELECT dt.name, dt.source
        FROM grids.document_templates dt
        JOIN grids.tables t ON t.id = dt.table_id
        WHERE t.base_id = ${created.data.id}::uuid AND dt.deleted_at IS NULL
      `;
        const [emailTemplate] = await sql<Array<{ name: string; subject: string }>>`
        SELECT name, subject
        FROM grids.email_templates
        WHERE base_id = ${created.data.id}::uuid AND deleted_at IS NULL
      `;
        const [workflow] = await sql<Array<{ name: string; enabled: boolean; compiled: { steps?: unknown[] } }>>`
        SELECT name, enabled, compiled
        FROM grids.workflows
        WHERE base_id = ${created.data.id}::uuid AND deleted_at IS NULL
      `;
        const [documentAudit] = await sql<Array<{ action: string }>>`
          SELECT action
          FROM grids.audit_log
          WHERE base_id = ${created.data.id}::uuid AND action = 'document_template.created'
        `;

        expect(documentTemplate?.name).toBe("Loan agreement");
        expect(documentTemplate?.source).toContain("from table Loans");
        expect(documentTemplate?.source).not.toMatch(/\{[0-9a-f-]{36}\}/i);
        expect(emailTemplate).toMatchObject({ name: "Loan agreement ready" });
        expect(emailTemplate?.subject).toContain("data.loanNumber");
        expect(workflow).toMatchObject({ name: "Send loan agreement", enabled: true });
        expect(workflow?.compiled.steps).toHaveLength(4);
        expect(documentAudit?.action).toBe("document_template.created");
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${created.data.id}::uuid`;
      }
    },
    10_000,
  );
});
