import { describe, expect, test } from "bun:test";
import { SQL, sql } from "bun";
import { migrate } from "./migrate";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

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
    "serializes concurrent setup and remains idempotent",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await Promise.all([migrate(database), migrate(database)]);
        await migrate(database);

        const [row] = await database<Array<{ tableCount: number }>>`
          SELECT count(*)::int AS "tableCount"
          FROM information_schema.tables
          WHERE table_schema = 'grids'
        `;
        expect(row?.tableCount).toBe(30);
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
      });
    },
    30_000,
  );

  postgresTest(
    "adds workflow revisions to an existing schema",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrate(database);
        await database`DROP TRIGGER bump_workflow_revision ON grids.workflows`.simple();
        await database`DROP FUNCTION grids.bump_workflow_revision()`.simple();
        await database`ALTER TABLE grids.workflows DROP COLUMN revision`.simple();

        await migrate(database);

        const baseId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow revision migration')
        `;
        const [created] = await database<Array<{ id: string; revision: number }>>`
          INSERT INTO grids.workflows (short_id, base_id, name, source, compiled)
          VALUES (${shortId("W")}, ${baseId}::uuid, 'Revision test', 'triggers: {}\nsteps: []', '{}'::jsonb)
          RETURNING id::text AS id, revision
        `;
        const [updated] = await database<Array<{ revision: number }>>`
          UPDATE grids.workflows
          SET name = 'Revision test updated'
          WHERE id = ${created!.id}::uuid
          RETURNING revision
        `;
        const [constraint] = await database<Array<{ count: number }>>`
          SELECT count(*)::int AS count
          FROM pg_constraint
          WHERE conname = 'workflows_revision_chk'
            AND conrelid = 'grids.workflows'::regclass
        `;

        expect(created?.revision).toBe(1);
        expect(updated?.revision).toBe(2);
        expect(constraint?.count).toBe(1);
      });
    },
    30_000,
  );

  postgresTest(
    "derives a view base id and enforces base-wide live names",
    async () => {
      await withIsolatedDatabase(async (database) => {
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
    "fails legacy active workflow runs instead of attaching the current workflow revision",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrate(database);
        await database`DROP TRIGGER populate_workflow_run_snapshots ON grids.workflow_runs`.simple();
        await database`DROP FUNCTION grids.populate_workflow_run_snapshots()`.simple();
        await database`ALTER TABLE grids.workflow_runs DROP COLUMN workflow_definition`.simple();
        await database`ALTER TABLE grids.workflow_runs DROP COLUMN workflow_catalog`.simple();
        const baseId = uuid();
        const workflowId = uuid();
        const runId = uuid();
        const originalDefinition = { triggers: { form: {} }, steps: [{ succeed: { message: "original" } }] };
        const editedDefinition = { triggers: { form: {} }, steps: [{ succeed: { message: "edited" } }] };
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Legacy workflow runs')
        `;
        await database`
          INSERT INTO grids.workflows (id, short_id, base_id, name, source, compiled, enabled)
          VALUES (${workflowId}::uuid, ${shortId("W")}, ${baseId}::uuid, 'Legacy workflow', 'steps: []', ${originalDefinition}::jsonb, TRUE)
        `;
        await database`
          INSERT INTO grids.workflow_runs (id, workflow_id, base_id, trigger_kind, status)
          VALUES (${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 'form', 'queued')
        `;
        await database`UPDATE grids.workflows SET compiled = ${editedDefinition}::jsonb WHERE id = ${workflowId}::uuid`;

        await migrate(database);

        const [run] = await database<Array<{ status: string; error: string | null; definition: unknown }>>`
          SELECT status, error, workflow_definition AS definition
          FROM grids.workflow_runs
          WHERE id = ${runId}::uuid
        `;
        expect(run?.status).toBe("failed");
        expect(run?.error).toBe("Could not recover workflow run created before immutable execution snapshots were available");
        expect(run?.definition).not.toEqual(editedDefinition);
        const [audit] = await database<Array<{ action: string; runId: string }>>`
          SELECT action, diff->'workflowRun'->'new'->>'id' AS "runId"
          FROM grids.audit_log
          WHERE base_id = ${baseId}::uuid
            AND action = 'workflow.run.failed'
            AND diff->'workflowRun'->'new'->>'id' = ${runId}
        `;
        expect(audit).toEqual({ action: "workflow.run.failed", runId });

        const rollingRunId = uuid();
        await database`
          INSERT INTO grids.workflow_runs (id, workflow_id, base_id, trigger_kind, status)
          VALUES (${rollingRunId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 'form', 'queued')
        `;
        const [rollingRun] = await database<Array<{ definition: unknown; catalog: unknown }>>`
          SELECT workflow_definition AS definition, workflow_catalog AS catalog
          FROM grids.workflow_runs
          WHERE id = ${rollingRunId}::uuid
        `;
        expect(rollingRun?.definition).toEqual(editedDefinition);
        expect(rollingRun?.catalog).toEqual({ tables: [], fieldsByTable: {}, templates: [], emailTemplates: [] });
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
