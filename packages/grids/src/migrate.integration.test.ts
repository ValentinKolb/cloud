import { describe, expect, test } from "bun:test";
import { SQL, sql } from "bun";
import { migrate as migrateCoreWorkflows } from "../../core/src/migrate/core/workflows";
import { migrate } from "./migrate";
import { insertTestWorkflow } from "./service/workflow-test-fixture";
import { WORKFLOW_KERNEL_SCHEMA_VERSION } from "./workflows/migrate";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const withIsolatedDatabase = async (run: (database: SQL) => Promise<void>) => {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL is required for migration integration tests");
  const databaseName = `grids_migrate_${Bun.randomUUIDv7().replaceAll("-", "")}`;
  const databaseUrl = new URL(sourceUrl);
  databaseUrl.pathname = `/${databaseName}`;

  await sql.unsafe(`CREATE DATABASE "${databaseName}"`);
  const database = new SQL(databaseUrl);
  try {
    await database`CREATE SCHEMA auth`.simple();
    await database`CREATE TABLE auth.users (id UUID PRIMARY KEY)`.simple();
    await database`CREATE TABLE auth.access (id UUID PRIMARY KEY)`.simple();
    await database`CREATE TABLE auth.service_accounts (id UUID PRIMARY KEY)`.simple();
    await run(database);
  } finally {
    await database.close({ timeout: 5 });
    await sql.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  }
};

describe("grids schema migration", () => {
  postgresTest(
    "says which container has not run yet when the kernel schema is missing",
    async () => {
      await withIsolatedDatabase(async (database) => {
        // Nothing declares an ordering between the app containers, so on an
        // empty database Grids can migrate before app-core. Postgres would
        // refuse the health view naming a table nobody would think to look for.
        await expect(migrate(database)).rejects.toThrow(/app-core has not migrated yet/);
      });
    },
    30_000,
  );

  postgresTest(
    "serializes concurrent setup and remains idempotent",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await Promise.all([migrate(database), migrate(database)]);
        await migrateCoreWorkflows(database);
        await migrate(database);

        const [row] = await database<Array<{ tableCount: number }>>`
          SELECT count(*)::int AS "tableCount"
          FROM information_schema.tables
          WHERE table_schema = 'grids'
            AND table_type = 'BASE TABLE'
        `;
        // workflow_profile and workflow_run_profile arrived; grids.workflows,
        // workflow_revisions, workflow_runs and workflow_step_runs moved into
        // the kernel, taking workflow_effect_intents with them.
        expect(row?.tableCount).toBe(34);
        const [cast] = await database<Array<{ value: number | string }>>`SELECT grids.try_numeric('12.5') AS value`;
        expect(String(cast?.value)).toBe("12.5");

        const indexes = await database<Array<{ indexName: string }>>`
          SELECT indexname AS "indexName"
          FROM pg_indexes
          WHERE schemaname = 'grids'
            AND indexname IN (
              'idx_grids_tables_live_name',
              'idx_grids_fields_live_name',
              'idx_grids_views_live_name'
            )
          ORDER BY indexname
        `;
        expect(indexes.map((index) => index.indexName)).toEqual([
          "idx_grids_fields_live_name",
          "idx_grids_tables_live_name",
          "idx_grids_views_live_name",
        ]);
        const [health] = await database<Array<{ status: string; outboxPending: number }>>`
          SELECT status, outbox_pending::int AS "outboxPending"
          FROM grids.operational_health
        `;
        expect(health).toEqual({ status: "ok", outboxPending: 0 });
      });
    },
    30_000,
  );

  /*
   * The workflow revision trigger is gone. Revisions are published versions in
   * the kernel now, not a side effect of any UPDATE — which is why renaming a
   * workflow no longer produces one.
   */

  postgresTest(
    "migrates persisted dashboard value formats",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const dashboardId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Dashboard format migration')
        `;
        await database`
          INSERT INTO grids.dashboards (id, short_id, base_id, name, config)
          VALUES (
            ${dashboardId}::uuid,
            ${shortId("D")},
            ${baseId}::uuid,
            'Overview',
            ${{
              rows: [
                {
                  id: "r",
                  kind: "row",
                  height: "sm",
                  cells: [
                    { id: "value", kind: "stat", format: "currency" },
                    { id: "count", kind: "stat", format: "integer" },
                  ],
                },
              ],
            }}::jsonb
          )
        `;

        await migrateCoreWorkflows(database);
        await migrate(database);

        const rows = await database<Array<{ id: string; configText: string }>>`
          SELECT id::text AS id, config::text AS "configText" FROM grids.dashboards
        `;
        expect(rows.map((row) => row.id)).toEqual([dashboardId]);
        const config = JSON.parse(rows[0]?.configText ?? "null") as {
          rows: Array<{ cells: Array<Record<string, unknown>> }>;
        };
        expect(config.rows[0]?.cells).toEqual([
          {
            id: "value",
            kind: "stat",
            valueFormat: { style: "number", decimalPlaces: 2, unit: "EUR", unitPosition: "suffix" },
          },
          { id: "count", kind: "stat", valueFormat: { style: "integer" } },
        ]);
      });
    },
    30_000,
  );

  postgresTest(
    "backfills legacy email preview data once without replacing later edits",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const templateId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Email preview data migration')
        `;
        await database`
          INSERT INTO grids.email_templates (id, short_id, base_id, name, subject, html)
          VALUES (
            ${templateId}::uuid,
            ${shortId("E")},
            ${baseId}::uuid,
            'Loan agreement ready',
            'Agreement ready',
            '<p>{{ data.requesterName }}</p><a href="{{ data.agreement.url }}">Download</a>'
          )
        `;
        await database`ALTER TABLE grids.email_templates ALTER COLUMN sample_data DROP NOT NULL`.simple();
        await database`UPDATE grids.email_templates SET sample_data = NULL WHERE id = ${templateId}::uuid`;

        await migrateCoreWorkflows(database);
        await migrate(database);
        const [backfilled] = await database<Array<{ sampleData: Record<string, unknown> }>>`
          SELECT sample_data AS "sampleData"
          FROM grids.email_templates
          WHERE id = ${templateId}::uuid
        `;
        expect(backfilled?.sampleData).toEqual({
          requesterName: "Alex Morgan",
          loanNumber: "LOAN-2026-0001",
          dueDate: "31 July 2026",
          agreement: { url: "https://cloud.example.org/share/grids/documents/example" },
        });

        await database`UPDATE grids.email_templates SET sample_data = '{}'::jsonb WHERE id = ${templateId}::uuid`;
        await migrateCoreWorkflows(database);
        await migrate(database);
        const [preserved] = await database<Array<{ sampleData: Record<string, unknown> }>>`
          SELECT sample_data AS "sampleData"
          FROM grids.email_templates
          WHERE id = ${templateId}::uuid
        `;
        expect(preserved?.sampleData).toEqual({});
      });
    },
    30_000,
  );

  postgresTest(
    "enforces combined table revision, source, mapping, and read-only invariants",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const storedTableId = uuid();
        const combinedTableId = uuid();
        const storedFieldId = uuid();
        const combinedFieldId = uuid();
        const revisionId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Combined schema invariants')
        `;
        await database`
          INSERT INTO grids.tables (id, short_id, base_id, kind, name, disable_direct_insert)
          VALUES
            (${storedTableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'stored', 'Stored', FALSE),
            (${combinedTableId}::uuid, ${shortId("C")}, ${baseId}::uuid, 'federated', 'Combined', TRUE)
        `;
        await database`
          INSERT INTO grids.fields (id, short_id, table_id, name, type)
          VALUES
            (${storedFieldId}::uuid, ${shortId("F")}, ${storedTableId}::uuid, 'Stored field', 'text'),
            (${combinedFieldId}::uuid, ${shortId("F")}, ${combinedTableId}::uuid, 'Canonical field', 'text')
        `;
        await database`
          INSERT INTO grids.federated_table_revisions (id, table_id, revision, status)
          VALUES (${revisionId}::uuid, ${combinedTableId}::uuid, 1, 'draft')
        `;
        await database`
          INSERT INTO grids.federated_table_sources (revision_id, source_table_id)
          VALUES (${revisionId}::uuid, ${storedTableId}::uuid)
        `;
        await database`
          INSERT INTO grids.federated_field_mappings (revision_id, target_field_id, source_table_id, source_field_id)
          VALUES (${revisionId}::uuid, ${combinedFieldId}::uuid, ${storedTableId}::uuid, ${storedFieldId}::uuid)
        `;

        await expect(
          (async () => {
            await database`
            INSERT INTO grids.federated_table_revisions (table_id, revision)
            VALUES (${storedTableId}::uuid, 1)
            `;
          })(),
        ).rejects.toThrow("revision target must be a combined table");
        await expect(
          (async () => {
            await database`
            INSERT INTO grids.federated_table_sources (revision_id, source_table_id)
            VALUES (${revisionId}::uuid, ${combinedTableId}::uuid)
            `;
          })(),
        ).rejects.toThrow("source must be a distinct stored table");
        await expect(
          (async () => {
            await database`
            INSERT INTO grids.federated_field_mappings (revision_id, target_field_id, source_table_id, source_field_id)
            VALUES (${revisionId}::uuid, ${storedFieldId}::uuid, ${storedTableId}::uuid, ${storedFieldId}::uuid)
            `;
          })(),
        ).rejects.toThrow("mapping fields must belong to their declared tables");
        await expect(
          (async () => {
            await database`
            UPDATE grids.tables
            SET disable_direct_insert = FALSE
            WHERE id = ${combinedTableId}::uuid
            `;
          })(),
        ).rejects.toThrow("tables_federated_read_only_chk");
      });
    },
    30_000,
  );

  postgresTest(
    "preserves document runs while resetting alpha workflow runs",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);

        const baseId = uuid();
        const workflowId = uuid();
        const workflowRunId = uuid();
        const snapshotId = uuid();
        const documentRunId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow reset artifacts')
        `;
        await insertTestWorkflow({ db: database, id: workflowId, baseId, name: "Old workflow", shortId: shortId("W") });
        await database`
          INSERT INTO grids.record_snapshots (id, base_id, table_id, record_id, root, graph)
          VALUES (${snapshotId}::uuid, ${baseId}::uuid, ${uuid()}::uuid, ${uuid()}::uuid, '{}'::jsonb, '{}'::jsonb)
        `;
        await database`
          INSERT INTO grids.document_runs (
            id, short_id, workflow_run_id, snapshot_id, base_id, table_id, record_id, document_number, filename,
            template_snapshot, render_data
          ) VALUES (
            ${documentRunId}::uuid, ${shortId("D")}, ${workflowRunId}::uuid, ${snapshotId}::uuid, ${baseId}::uuid,
            ${uuid()}::uuid, ${uuid()}::uuid, 'DOC-1', 'DOC-1.pdf', '{}'::jsonb, '{}'::jsonb
          )
        `;

        await database`DELETE FROM grids.workflow_kernel_migrations WHERE version = ${WORKFLOW_KERNEL_SCHEMA_VERSION}`;
        await migrateCoreWorkflows(database);
        await migrate(database);

        const [document] = await database<Array<{ workflowRunId: string | null }>>`
          SELECT workflow_run_id::text AS "workflowRunId"
          FROM grids.document_runs
          WHERE id = ${documentRunId}::uuid
        `;
        const [surviving] = await database<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM grids.document_runs WHERE id = ${documentRunId}::uuid
        `;
        // The document is real user data and survives; only its link to a run
        // that no longer exists is cleared.
        expect(document).toEqual({ workflowRunId: null });
        expect(surviving).toEqual({ count: 1 });
      });
    },
    30_000,
  );

  postgresTest(
    "derives a view base id and enforces base-wide live names",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        const firstTableId = uuid();
        const secondTableId = uuid();

        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'View names')
        `;
        await database`
          INSERT INTO grids.tables (id, short_id, base_id, name)
          VALUES
            (${firstTableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'First'),
            (${secondTableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Second')
        `;
        const [view] = await database<Array<{ baseId: string }>>`
          INSERT INTO grids.views (short_id, table_id, name, source)
          VALUES (${shortId("V")}, ${firstTableId}::uuid, 'Open items', 'from table First')
          RETURNING base_id::text AS "baseId"
        `;
        expect(view?.baseId).toBe(baseId);

        let conflict: unknown;
        try {
          await database`
            INSERT INTO grids.views (short_id, table_id, name, source)
            VALUES (${shortId("V")}, ${secondTableId}::uuid, ' open ITEMS ', 'from table Second')
          `;
        } catch (error) {
          conflict = error;
        }
        const pgError = conflict as { errno?: string; constraint?: string };
        expect(pgError.errno).toBe("23505");
        expect(pgError.constraint).toBe("idx_grids_views_live_name");
      });
    },
    30_000,
  );

  postgresTest(
    "fails clearly when legacy data already contains ambiguous names",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrateCoreWorkflows(database);
        await migrate(database);
        const baseId = uuid();
        await database`DROP INDEX grids.idx_grids_tables_live_name`.simple();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Legacy duplicates')
        `;
        await database`
          INSERT INTO grids.tables (short_id, base_id, name)
          VALUES
            ('TD001', ${baseId}::uuid, 'Orders'),
            ('TD002', ${baseId}::uuid, ' orders ')
        `;

        let migrationError: unknown;
        try {
          await migrateCoreWorkflows(database);
          await migrate(database);
        } catch (error) {
          migrationError = error;
        }
        expect((migrationError as Error).message).toContain(
          `cannot enforce unique table names: grid ${baseId} contains multiple live tables named "orders"`,
        );
      });
    },
    30_000,
  );

  postgresTest(
    "removes intentional alpha-only schema surfaces",
    async () => {
      await migrate();
      await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS query JSONB`.simple();
      await sql`ALTER TABLE grids.views ADD COLUMN IF NOT EXISTS display_config JSONB`.simple();
      await sql`CREATE TABLE IF NOT EXISTS grids.gql_queries (id UUID PRIMARY KEY)`.simple();
      await sql`ALTER TABLE grids.email_templates ADD COLUMN IF NOT EXISTS text TEXT`.simple();

      await migrate();

      const legacyColumns = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'grids'
        AND (
          (table_name = 'views' AND column_name IN ('query', 'display_config'))
          OR (table_name = 'email_templates' AND column_name = 'text')
        )
    `;
      const [legacyTable] = await sql<Array<{ tableName: string | null }>>`
      SELECT to_regclass('grids.gql_queries')::text AS "tableName"
    `;
      expect(legacyColumns).toHaveLength(0);
      expect(legacyTable?.tableName).toBeNull();
    },
    30_000,
  );

  postgresTest(
    "normalizes legacy number scale config to decimalPlaces",
    async () => {
      await migrate();

      const baseId = uuid();
      const tableId = uuid();
      const fieldId = uuid();

      try {
        await sql`
        INSERT INTO grids.bases (id, short_id, name)
        VALUES (${baseId}::uuid, ${shortId("B")}, 'Migration integration')
      `;
        await sql`
        INSERT INTO grids.tables (id, short_id, base_id, name, position)
        VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Numbers', 0)
      `;
        await sql`
        INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
        VALUES (${fieldId}::uuid, 'NUM01', ${tableId}::uuid, 'Amount', 'number', '{"scale":2}'::jsonb, 0)
      `;

        await migrate();

        const [row] = await sql<Array<{ config: { decimalPlaces?: number; scale?: number } }>>`
        SELECT config
        FROM grids.fields
        WHERE id = ${fieldId}::uuid
      `;

        expect(row?.config).toEqual({ decimalPlaces: 2 });
      } finally {
        await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
      }
    },
    30_000,
  );
});
