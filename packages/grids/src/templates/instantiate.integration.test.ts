import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { instantiate } from "../service/templates";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

describe("built-in template instantiation", () => {
  postgresTest(
    "creates complete product resources through production services",
    async () => {
      await migrate();
      const expectations = [
        {
          templateId: "bookshop",
          documentName: "Order invoice",
          emailName: "Order invoice ready",
          workflowName: "Send order invoice",
          launcherName: "Scan order to send invoice",
          workflowSteps: 4,
        },
        {
          templateId: "finance",
          documentName: "Transaction receipt",
          emailName: "Transaction receipt ready",
          workflowName: "Clear and send receipt",
          launcherName: "Scan transaction to send receipt",
          workflowSteps: 5,
        },
        {
          templateId: "inventory",
          documentName: "Loan agreement",
          emailName: "Loan agreement ready",
          workflowName: "Approve and send loan agreement",
          launcherName: "Scan loan to approve",
          workflowSteps: 5,
        },
      ];

      for (const expected of expectations) {
        const created = await instantiate(
          expected.templateId,
          { name: `${expected.templateId} integration ${Bun.randomUUIDv7()}`, withSampleData: true },
          null,
        );
        expect(created.ok, `${expected.templateId} instantiation`).toBe(true);
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
          const [workflow] = await sql<Array<{ name: string; enabled: boolean; plan: { steps?: unknown[] } }>>`
            SELECT name, enabled, plan
            FROM grids.workflows
            WHERE base_id = ${created.data.id}::uuid AND deleted_at IS NULL
          `;
          const [launcher] = await sql<Array<{ name: string; enabled: boolean; diagnostics: unknown[] }>>`
            SELECT name, enabled, diagnostics
            FROM grids.workflow_launchers
            WHERE base_id = ${created.data.id}::uuid AND deleted_at IS NULL
          `;
          const [dashboard] = await sql<
            Array<{ config: { rows?: Array<{ cells?: Array<{ kind?: string; source?: { kind?: string } }> }> } }>
          >`
            SELECT config
            FROM grids.dashboards
            WHERE base_id = ${created.data.id}::uuid AND deleted_at IS NULL
          `;
          const [documentAudit] = await sql<Array<{ action: string }>>`
            SELECT action
            FROM grids.audit_log
            WHERE base_id = ${created.data.id}::uuid AND action = 'document_template.created'
          `;
          const [sampleData] = await sql<Array<{ record_count: number }>>`
            SELECT COUNT(*)::int AS record_count
            FROM grids.records r
            JOIN grids.tables t ON t.id = r.table_id
            WHERE t.base_id = ${created.data.id}::uuid AND r.deleted_at IS NULL
          `;

          const widgets = dashboard?.config.rows?.flatMap((row) => row.cells ?? []) ?? [];
          expect(sampleData?.record_count).toBeGreaterThan(0);
          expect(documentTemplate?.name).toBe(expected.documentName);
          expect(documentTemplate?.source).toContain("from table ");
          expect(documentTemplate?.source).not.toMatch(/\{[0-9a-f-]{36}\}/i);
          expect(emailTemplate?.name).toBe(expected.emailName);
          expect(emailTemplate?.subject).toContain("{{");
          expect(workflow).toMatchObject({ name: expected.workflowName, enabled: true });
          expect(workflow?.plan.steps).toHaveLength(expected.workflowSteps);
          expect(launcher).toMatchObject({ name: expected.launcherName, enabled: true, diagnostics: [] });
          expect(
            widgets.some((widget) => widget.source?.kind === "gql"),
            `${expected.templateId} direct GQL widget`,
          ).toBe(true);
          expect(
            widgets.some((widget) => widget.kind === "workflow-button"),
            `${expected.templateId} workflow widget`,
          ).toBe(true);
          expect(documentAudit?.action).toBe("document_template.created");
        } finally {
          await sql`DELETE FROM grids.bases WHERE id = ${created.data.id}::uuid`;
        }
      }
    },
    90_000,
  );
});
