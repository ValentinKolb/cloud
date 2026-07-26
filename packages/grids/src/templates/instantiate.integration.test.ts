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
import { deleteTestWorkflowScope } from "../service/workflow-test-fixture";

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
  const documentRows = await sql<DocumentTemplateRow[]>`
    SELECT dt.id::text AS id, dt.table_id::text AS table_id, dt.name
    FROM grids.document_templates dt
    JOIN grids.tables t ON t.id = dt.table_id AND t.deleted_at IS NULL
    WHERE t.base_id = ${baseId}::uuid AND dt.deleted_at IS NULL
    ORDER BY dt.created_at, dt.id
  `;
  expect(documentRows.length).toBeGreaterThan(0);

  for (const documentRow of documentRows) {
    const [recordRow] = await sql<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM grids.records
      WHERE table_id = ${documentRow.table_id}::uuid AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
    `;
    expect(recordRow, `${documentRow.name} sample record`).toBeDefined();
    if (!recordRow) continue;

    const [documentTemplate, table, record] = await Promise.all([
      getDocumentTemplate(documentRow.id),
      getTable(documentRow.table_id),
      getRecord(documentRow.table_id, recordRow.id),
    ]);
    expect(documentTemplate, `${documentRow.name} template`).toBeDefined();
    expect(table, `${documentRow.name} table`).toBeDefined();
    expect(record, `${documentRow.name} record`).toBeDefined();
    if (!documentTemplate || !table || !record) continue;

    const live = await buildLiveRenderData({ template: documentTemplate, table, record });
    expect(live.ok, `${documentRow.name} render data`).toBe(true);
    if (!live.ok) continue;
    const html = await renderDocumentHtml(documentTemplate, live.data.data);
    expect(html.ok, `${documentRow.name} HTML`).toBe(true);
    if (html.ok) expect(html.data.length).toBeGreaterThan(1_000);
    if (documentRow.name === "Order invoice") expect(live.data.rows.length).toBeGreaterThan(1);
  }
};

describe("built-in template instantiation", () => {
  postgresTest(
    "creates complete product resources through production services",
    async () => {
      await migrate();
      const expectations = [
        {
          templateId: "bookshop",
          documentNames: ["Order invoice"],
          emailName: "Order invoice ready",
          workflows: [{ name: "Send order invoice", steps: 9 }],
          launchers: ["Choose order to send invoice"],
        },
        {
          templateId: "finance",
          documentNames: ["Transaction receipt"],
          emailName: "Transaction receipt ready",
          workflows: [{ name: "Clear and send receipt", steps: 9 }],
          launchers: ["Choose transaction to process receipt"],
        },
        {
          templateId: "inventory",
          documentNames: ["Asset label", "Loan agreement"],
          emailName: "Loan agreement ready",
          workflows: [
            { name: "Send approved loan agreement", steps: 11 },
            { name: "Report damaged item", steps: 3 },
            { name: "Mark loan item as returned", steps: 6 },
          ],
          launchers: ["Choose loan to send agreement", "Scan damaged inventory item", "Return items for one loan"],
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
          const documentTemplates = await sql<Array<{ name: string; source: string }>>`
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
          const workflows = await sql<Array<{ name: string; enabled: boolean; plan: { steps?: unknown[] } }>>`
            SELECT definition.name, profile.enabled, version.plan
            FROM grids.workflow_profile AS profile
            JOIN workflows.workflow AS definition ON definition.id = profile.id
            CROSS JOIN LATERAL (
              SELECT plan FROM workflows.version WHERE workflow_id = profile.id ORDER BY revision DESC LIMIT 1
            ) AS version
            WHERE profile.base_id = ${created.data.id}::uuid AND profile.deleted_at IS NULL
          `;
          const launchers = await sql<Array<{ name: string; enabled: boolean; diagnostics: unknown[] }>>`
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
          expect(documentTemplates.map((item) => item.name).sort()).toEqual([...expected.documentNames].sort());
          for (const documentTemplate of documentTemplates) {
            expect(documentTemplate.source).toContain("from table ");
            expect(documentTemplate.source).not.toMatch(/\{[0-9a-f-]{36}\}/i);
          }
          expect(emailTemplate?.name).toBe(expected.emailName);
          expect(emailTemplate?.subject).toContain("{{");
          expect(workflows).toHaveLength(expected.workflows.length);
          for (const expectedWorkflow of expected.workflows) {
            const workflow = workflows.find((item) => item.name === expectedWorkflow.name);
            expect(workflow).toMatchObject({ name: expectedWorkflow.name, enabled: true });
            expect(workflow?.plan.steps).toHaveLength(expectedWorkflow.steps);
          }
          expect(launchers).toHaveLength(expected.launchers.length);
          for (const launcherName of expected.launchers) {
            expect(launchers.find((item) => item.name === launcherName)).toMatchObject({
              name: launcherName,
              enabled: true,
              diagnostics: [],
            });
          }
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
          await deleteTestWorkflowScope(created.data.id);
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
          await deleteTestWorkflowScope(empty.data.id);
          await sql`DELETE FROM grids.bases WHERE id = ${empty.data.id}::uuid`;
        }
      }
    },
    90_000,
  );
});
