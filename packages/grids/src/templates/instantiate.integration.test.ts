import { describe, expect, test } from "bun:test";
import { sql } from "bun";
import { DashboardConfigSchema, type Widget } from "../contracts";
import { migrate } from "../migrate";
import { previewDslQuery } from "../query-dsl/preview";
import { resolveWidgetData } from "../service/dashboard-widget-data";
import { compileDashboardWidgetQuery } from "../service/dashboard-widget-query";
import { buildLiveRenderData, renderDocumentHtml } from "../service/document-rendering";
import { getTemplate as getDocumentTemplate } from "../service/document-templates";
import { get as getRecord } from "../service/records";
import { get as getTable } from "../service/tables";
import { instantiate } from "../service/templates";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;

type DashboardRow = { config: unknown };
type ViewRow = { table_id: string; name: string; source: string };
type DocumentTemplateRow = { id: string; table_id: string; name: string };

const widgetsOf = (config: unknown): Widget[] => DashboardConfigSchema.parse(config).rows.flatMap((row) => row.cells);

const verifyRuntimeSurfaces = async (baseId: string, withSampleData: boolean) => {
  const [dashboard] = await sql<DashboardRow[]>`
    SELECT config
    FROM grids.dashboards
    WHERE base_id = ${baseId}::uuid AND deleted_at IS NULL
  `;
  expect(dashboard).toBeDefined();

  for (const widget of widgetsOf(dashboard?.config ?? { rows: [] })) {
    const data = await resolveWidgetData(widget, { userId: null, userGroups: [], isAdmin: true }, { baseId });
    expect(data.kind, `dashboard widget ${widget.id}`).not.toBe("error");
    if (!withSampleData) {
      if (data.kind === "view") expect(data.queryResult.rows).toHaveLength(0);
      if (data.kind === "chart") expect(data.buckets).toHaveLength(0);
    }
  }

  const views = await sql<ViewRow[]>`
    SELECT v.table_id::text AS table_id, v.name, v.source
    FROM grids.views v
    JOIN grids.tables t ON t.id = v.table_id AND t.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND v.deleted_at IS NULL
    ORDER BY v.created_at, v.id
  `;
  for (const view of views) {
    const compiled = await compileDashboardWidgetQuery({
      baseId,
      currentTableId: view.table_id,
      source: view.source,
    });
    expect(compiled.ok, `compile view ${view.name}`).toBe(true);
    if (!compiled.ok) continue;
    const preview = await previewDslQuery(compiled.data.plan, {
      fieldsByTableId: compiled.data.fieldsByTableId,
      maxRows: 100,
      viewer: { userId: null, userGroups: [], isAdmin: true },
    });
    expect(preview.ok, `preview view ${view.name}`).toBe(true);
    if (preview.ok && !withSampleData) expect(preview.data.rows).toHaveLength(0);
  }

  if (!withSampleData) return;
  const [documentRow] = await sql<DocumentTemplateRow[]>`
    SELECT dt.id::text AS id, dt.table_id::text AS table_id, dt.name
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND dt.deleted_at IS NULL
    ORDER BY dt.created_at, dt.id
    LIMIT 1
  `;
  expect(documentRow).toBeDefined();
  if (!documentRow) return;

  const [recordRow] = await sql<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM grids.records
    WHERE table_id = ${documentRow.table_id}::uuid AND deleted_at IS NULL
    ORDER BY created_at, id
    LIMIT 1
  `;
  expect(recordRow).toBeDefined();
  if (!recordRow) return;

  const [documentTemplate, table, record] = await Promise.all([
    getDocumentTemplate(documentRow.id),
    getTable(documentRow.table_id),
    getRecord(documentRow.table_id, recordRow.id),
  ]);
  expect(documentTemplate, `${documentRow.name} template`).toBeDefined();
  expect(table, `${documentRow.name} table`).toBeDefined();
  expect(record, `${documentRow.name} record`).toBeDefined();
  if (!documentTemplate || !table || !record) return;

  const live = await buildLiveRenderData({ template: documentTemplate, table, record });
  expect(live.ok, `${documentRow.name} render data`).toBe(true);
  if (!live.ok) return;
  const html = await renderDocumentHtml(documentTemplate, live.data.data);
  expect(html.ok, `${documentRow.name} HTML`).toBe(true);
  if (html.ok) expect(html.data.length).toBeGreaterThan(1_000);
  if (documentRow.name === "Order invoice") expect(live.data.rows.length).toBeGreaterThan(1);
};

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
          workflowSteps: 9,
        },
        {
          templateId: "finance",
          documentName: "Transaction receipt",
          emailName: "Transaction receipt ready",
          workflowName: "Clear and send receipt",
          launcherName: "Scan transaction to send receipt",
          workflowSteps: 9,
        },
        {
          templateId: "inventory",
          documentName: "Loan agreement",
          emailName: "Loan agreement ready",
          workflowName: "Send approved loan agreement",
          launcherName: "Scan loan to send agreement",
          workflowSteps: 11,
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
          await verifyRuntimeSurfaces(created.data.id, true);
        } finally {
          await sql`DELETE FROM grids.bases WHERE id = ${created.data.id}::uuid`;
        }

        const empty = await instantiate(
          expected.templateId,
          { name: `${expected.templateId} empty integration ${Bun.randomUUIDv7()}`, withSampleData: false },
          null,
        );
        expect(empty.ok, `${expected.templateId} empty instantiation`).toBe(true);
        if (!empty.ok) throw new Error(empty.error.message);
        try {
          await verifyRuntimeSurfaces(empty.data.id, false);
        } finally {
          await sql`DELETE FROM grids.bases WHERE id = ${empty.data.id}::uuid`;
        }
      }
    },
    90_000,
  );
});
