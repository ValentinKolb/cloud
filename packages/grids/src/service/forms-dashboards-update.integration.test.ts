import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { resolveWidgetData } from "./dashboard-widget-data";
import * as dashboards from "./dashboards";
import * as forms from "./forms";

const postgresTest = process.env.GRIDS_DB_TEST === "1" ? test : test.skip;
const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

const createFixture = async () => {
  const baseId = uuid();
  const tableId = uuid();
  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Concurrent metadata updates')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Orders', 0)
  `;
  return { baseId, tableId };
};

const cleanupFixture = async (baseId: string) => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${baseId}::uuid`;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("form and dashboard metadata updates", () => {
  postgresTest("creates public form tokens with 128 random bits encoded as base64url", async () => {
    const fixture = await createFixture();
    try {
      const created = await forms.create({ tableId: fixture.tableId, name: "Public intake", isPublic: true }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) throw created.error;

      expect(created.data.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("preserves concurrent disjoint form updates", async () => {
    const fixture = await createFixture();
    try {
      const created = await forms.create({ tableId: fixture.tableId, name: "Original form" }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) throw created.error;

      const results = await Promise.all([
        forms.update(created.data.id, { name: "Renamed form" }, null),
        forms.update(created.data.id, { isActive: false }, null),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);

      const updated = await forms.get(created.data.id);
      expect(updated?.name).toBe("Renamed form");
      expect(updated?.isActive).toBe(false);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("preserves concurrent disjoint dashboard updates", async () => {
    const fixture = await createFixture();
    try {
      const created = await dashboards.create({ baseId: fixture.baseId, name: "Original dashboard" }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) throw created.error;

      const results = await Promise.all([
        dashboards.update(created.data.id, { name: "Renamed dashboard" }, null),
        dashboards.update(created.data.id, { description: "Operational overview" }, null),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);

      const updated = await dashboards.get(created.data.id);
      expect(updated?.name).toBe("Renamed dashboard");
      expect(updated?.description).toBe("Operational overview");
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("stores and resolves dashboard-local GQL widget sources", async () => {
    const fixture = await createFixture();
    try {
      const created = await dashboards.create({ baseId: fixture.baseId, name: "Query dashboard" }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) throw created.error;

      const widget = {
        id: "orders-count",
        kind: "stat" as const,
        source: { kind: "gql" as const, source: "from table Orders\naggregate count(*) as orders" },
      };
      const updated = await dashboards.update(
        created.data.id,
        { config: { rows: [{ id: "summary", kind: "row", height: "sm", cells: [widget] }] } },
        null,
      );
      expect(updated.ok).toBe(true);

      const data = await resolveWidgetData(widget, { userId: null, userGroups: [], isAdmin: true }, { baseId: fixture.baseId });
      expect(data).toEqual({ kind: "stat", value: 0 });
      expect(await dashboards.sourceTableIds(created.data)).toEqual([]);
      if (updated.ok) expect(await dashboards.sourceTableIds(updated.data)).toEqual([fixture.tableId]);
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });

  postgresTest("rejects invalid dashboard-local GQL at the config boundary", async () => {
    const fixture = await createFixture();
    try {
      const created = await dashboards.create({ baseId: fixture.baseId, name: "Invalid query dashboard" }, null);
      expect(created.ok).toBe(true);
      if (!created.ok) throw created.error;

      const updated = await dashboards.update(
        created.data.id,
        {
          config: {
            rows: [
              {
                id: "summary",
                kind: "row",
                height: "sm",
                cells: [{ id: "broken", kind: "view", source: { kind: "gql", source: "from table Missing" } }],
              },
            ],
          },
        },
        null,
      );
      expect(updated.ok).toBe(false);
      if (!updated.ok) expect(updated.error.message).toContain("view widget source is invalid");
    } finally {
      await cleanupFixture(fixture.baseId);
    }
  });
});
