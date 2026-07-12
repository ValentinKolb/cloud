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
    "creates an empty Grids schema and remains idempotent",
    async () => {
      await withIsolatedDatabase(async (database) => {
        await migrate(database);
        await migrate(database);

        const [row] = await database<Array<{ tableCount: number }>>`
          SELECT count(*)::int AS "tableCount"
          FROM information_schema.tables
          WHERE table_schema = 'grids'
        `;
        expect(row?.tableCount).toBe(28);
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
