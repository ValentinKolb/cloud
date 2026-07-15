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
        expect(row?.tableCount).toBe(33);
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
    "increments workflow revisions",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrate(database);

        const baseId = uuid();
        await database`
          INSERT INTO grids.bases (id, short_id, name)
          VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow revision migration')
        `;
        const [created] = await database<Array<{ id: string; revision: number }>>`
          INSERT INTO grids.workflows (short_id, base_id, name, source, plan)
          VALUES (${shortId("W")}, ${baseId}::uuid, 'Revision test', 'inputs: {}\nsteps: []', '{"inputs":{},"steps":[]}'::jsonb)
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
    "preserves document runs while resetting alpha workflow runs",
    async () => {
      await withIsolatedDatabase(async (database) => {
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
        await database`
          INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan)
          VALUES (${workflowId}::uuid, ${shortId("W")}, ${baseId}::uuid, 'Old workflow', 'steps: []', '{}'::jsonb)
        `;
        await database`
          INSERT INTO grids.workflow_runs (
            id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
            inputs, context, workflow_plan, status, occurred_at
          ) VALUES (
            ${workflowRunId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', 'old-run', 'old',
            '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'succeeded', now()
          )
        `;
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

        await database`DELETE FROM grids.workflow_kernel_migrations WHERE version = 1`;
        await migrate(database);

        const [document] = await database<Array<{ workflowRunId: string | null }>>`
          SELECT workflow_run_id::text AS "workflowRunId"
          FROM grids.document_runs
          WHERE id = ${documentRunId}::uuid
        `;
        expect(document).toEqual({ workflowRunId: null });
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
