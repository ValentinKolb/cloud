import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { prepareIngestBatch, writePreparedIngestBatch } from "./ingest-bulk";

const runDbSmoke = process.env.PULSE_FIELD_CATALOG_DB_TEST === "1";
const postgresTest = runDbSmoke ? test : test.skip;

beforeAll(async () => {
  if (!runDbSmoke) return;
  const { migrate } = await import("../migrate");
  await migrate();
}, 30_000);

describe("Pulse field catalog Postgres smoke", () => {
  postgresTest("stores field definitions and counts without field values", async () => {
    const baseId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    await sql`INSERT INTO pulse.bases (id, name) VALUES (${baseId}::uuid, 'Field catalog smoke')`;
    await sql`
      INSERT INTO pulse.sources (id, base_id, kind, name)
      VALUES (${sourceId}::uuid, ${baseId}::uuid, 'http_ingest'::pulse.source_kind, 'Field catalog source')
    `;

    try {
      const batch = prepareIngestBatch(
        {
          events: [
            {
              kind: "page.viewed",
              dimensions: { campaign: "summer" },
              attributes: { request_id: "request-secret-1", result: 200 },
            },
            {
              kind: "page.viewed",
              dimensions: { campaign: "winter" },
              attributes: { request_id: "request-secret-2", result: "cached" },
            },
          ],
        },
        sourceId,
      );
      await writePreparedIngestBatch({ baseId, sourceId, batch, db: sql });

      const rows = await sql<
        Array<{ role: string; key: string; value_type: string; observed_count: number }>
      >`
        SELECT role, key, value_type, observed_count::int
        FROM pulse.signal_fields
        WHERE base_id = ${baseId}::uuid
        ORDER BY role, key
      `;
      expect(rows).toEqual([
        { role: "attribute", key: "request_id", value_type: "string", observed_count: 2 },
        { role: "attribute", key: "result", value_type: "mixed", observed_count: 2 },
        { role: "dimension", key: "campaign", value_type: "string", observed_count: 2 },
      ]);

      const [containsValues] = await sql<{ contains_values: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pulse.signal_fields
          WHERE base_id = ${baseId}::uuid
            AND row_to_json(signal_fields)::text LIKE '%request-secret%'
        ) AS contains_values
      `;
      expect(containsValues?.contains_values).toBe(false);
    } finally {
      await sql`DELETE FROM pulse.bases WHERE id = ${baseId}::uuid`;
    }
  });
});
