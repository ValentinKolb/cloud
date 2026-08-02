import { describe, expect, test } from "bun:test";
import {
  type CapabilityExecutionContext,
  type CapabilityQueryDefinition,
  capabilityResultSchema,
  type User,
  UniversalSearchDataSchema,
  UniversalSearchInputSchema,
} from "@valentinkolb/cloud/contracts";
import { sql } from "bun";
import { pulseCapabilities } from "./capabilities";

const userContext = (user: User): CapabilityExecutionContext => ({
  actor: { kind: "user", user },
  accessSubject: { type: "user", userId: user.id },
  user,
  signal: new AbortController().signal,
});

const testUser = (id: string, suffix: string): User => ({
  id,
  uid: `pulse-capability-${suffix}`,
  roles: ["user", "local", "local/user"],
  provider: "local",
  profile: "user",
  givenname: "Pulse",
  sn: "Capability",
  displayName: "Pulse Capability",
  mail: `pulse-capability-${suffix}@example.test`,
  avatarHash: null,
  accountExpires: null,
  lastLoginLocal: null,
  memberofGroup: [],
  memberofGroupIds: [],
  manages: [],
  managesGroupIds: [],
  ipa: null,
});

const invoke = (localId: string, input: unknown, context: CapabilityExecutionContext) => {
  const operation = (pulseCapabilities.queries as unknown as Readonly<Record<string, CapabilityQueryDefinition>>)[localId];
  if (!operation) throw new Error(`Missing Pulse capability ${localId}`);
  const parsed = operation.input.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid test input for ${localId}: ${parsed.error.message}`);
  return Promise.resolve(operation.run(parsed.data, context)).then((result) => {
    if (result.ok) {
      const validated = capabilityResultSchema(operation.data).safeParse(result.data);
      if (!validated.success) throw new Error(`Invalid test result for ${localId}: ${validated.error.message}`);
    }
    return result;
  });
};

const canUseDatabase = async (): Promise<boolean> => {
  try {
    const [row] = await sql<{ bases: string | null; users: string | null }[]>`
      SELECT to_regclass('pulse.bases')::text AS bases, to_regclass('auth.users')::text AS users
    `;
    return Boolean(row?.bases && row.users);
  } catch {
    return false;
  }
};

const postgresTest = (await canUseDatabase()) ? test : test.skip;

describe("Pulse capabilities", () => {
  test("declares and compiles the curated read-only v1 surface", () => {
    expect(pulseCapabilities.version).toBe(1);
    expect(Object.keys(pulseCapabilities.types ?? {}).sort()).toEqual(["base", "resource", "saved_query", "source"]);
    expect(Object.keys(pulseCapabilities.queries ?? {}).sort()).toEqual([
      "base.list",
      "base.search",
      "field.search",
      "metric.search",
      "query.compile",
      "query.execute",
      "resource.search",
      "saved_query.execute",
      "saved_query.list",
      "source.list",
    ]);
    expect("actions" in pulseCapabilities).toBe(false);

    expect(pulseCapabilities.queries?.["base.search"]?.input).toBe(UniversalSearchInputSchema);
    expect(pulseCapabilities.queries?.["base.search"]?.data).toBe(UniversalSearchDataSchema);
    expect(pulseCapabilities.queries?.["resource.search"]?.input).toBe(UniversalSearchInputSchema);
    expect(pulseCapabilities.queries?.["resource.search"]?.data).toBe(UniversalSearchDataSchema);
    expect(
      pulseCapabilities.queries?.["query.execute"]?.input.safeParse({ baseId: crypto.randomUUID(), query: "states *", extra: true })
        .success,
    ).toBe(false);
  });

  postgresTest("discovers and executes only data visible to the current access subject", async () => {
    const suffix = crypto.randomUUID();
    const baseId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const metricId = crypto.randomUUID();
    const seriesId = crypto.randomUUID();
    const savedQueryId = crypto.randomUUID();
    const resourceKey = `service:agent-${suffix}`;
    const [userRow] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail)
      VALUES (${`pulse-capability-${suffix}`}, 'local', 'user', 'Pulse capability test', ${`pulse-capability-${suffix}@example.test`})
      RETURNING id
    `;
    const [otherUserRow] = await sql<{ id: string }[]>`
      INSERT INTO auth.users (uid, provider, profile, display_name, mail)
      VALUES (${`pulse-capability-other-${suffix}`}, 'local', 'user', 'Pulse capability other', ${`pulse-capability-other-${suffix}@example.test`})
      RETURNING id
    `;
    if (!userRow || !otherUserRow) throw new Error("Failed to create Pulse capability users");
    const user = testUser(userRow.id, suffix);
    const context = userContext(user);
    const otherContext = userContext(testUser(otherUserRow.id, `other-${suffix}`));
    let accessId: string | null = null;

    try {
      await sql`INSERT INTO pulse.bases (id, name, description) VALUES (${baseId}::uuid, 'Agent telemetry', 'Capability fixture')`;
      const [access] = await sql<{ id: string }[]>`
        INSERT INTO auth.access (user_id, permission) VALUES (${user.id}::uuid, 'admin') RETURNING id
      `;
      if (!access) throw new Error("Failed to create Pulse capability access");
      accessId = access.id;
      await sql`INSERT INTO pulse.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${access.id}::uuid)`;
      await sql`
        INSERT INTO pulse.sources (id, base_id, kind, name, last_seen_at)
        VALUES (${sourceId}::uuid, ${baseId}::uuid, 'http_ingest'::pulse.source_kind, 'Agent source', now())
      `;
      await sql`
        INSERT INTO pulse.metric_defs (id, base_id, name, unit, type)
        VALUES (${metricId}::uuid, ${baseId}::uuid, 'agent.cpu', 'percent', 'gauge'::pulse.metric_type)
      `;
      await sql`
        INSERT INTO pulse.metric_series (
          id, base_id, metric_id, source_id, entity_id, entity_type, series_key, dimensions_hash, dimensions,
          resource_key, resource_id, resource_type, resource_label, last_seen_at
        ) VALUES (
          ${seriesId}::uuid, ${baseId}::uuid, ${metricId}::uuid, ${sourceId}::uuid, 'agent-1', 'service', ${suffix}, ${suffix},
          (${JSON.stringify({ env: "test" })}::jsonb #>> '{}')::jsonb,
          ${resourceKey}, 'agent-1', 'service', 'Agent service', now()
        )
      `;
      await sql`
        INSERT INTO pulse.metric_samples (base_id, series_id, ts, value)
        VALUES (${baseId}::uuid, ${seriesId}::uuid, now() - interval '1 minute', 42)
      `;
      await sql`
        INSERT INTO pulse.events (
          id, base_id, source_id, ts, kind, entity_id, entity_type, dimensions_hash, dimensions, attributes, payload
        )
        SELECT
          gen_random_uuid(), ${baseId}::uuid, ${sourceId}::uuid, now() - make_interval(secs => item), 'agent.event',
          'agent-1', 'service', item::text, '{}'::jsonb, '{"internal":"hidden"}'::jsonb, '{"raw":"hidden"}'::jsonb
        FROM generate_series(1, 101) AS item
      `;
      await sql`
        INSERT INTO pulse.signal_fields (base_id, source_id, scope, signal_name, role, key, value_type, observed_count, first_seen_at, last_seen_at)
        VALUES (${baseId}::uuid, ${sourceId}::uuid, 'metric', 'agent.cpu', 'dimension', 'env', 'string', 1, now(), now())
      `;
      await sql`
        INSERT INTO pulse.observed_resources (base_id, resource_key, resource_id, resource_type, label, source_ids, dimensions)
        VALUES (
          ${baseId}::uuid, ${resourceKey}, 'agent-1', 'service', 'Agent service', ARRAY[${sourceId}::uuid],
          (${JSON.stringify({ env: "test" })}::jsonb #>> '{}')::jsonb
        )
      `;
      const query = "metric agent.cpu avg every 1h since 1h";
      await sql`
        INSERT INTO pulse.saved_queries (id, base_id, name, description, query, created_by)
        VALUES (${savedQueryId}::uuid, ${baseId}::uuid, 'Agent CPU', 'Capability fixture', ${query}, ${user.id}::uuid)
      `;

      const bases = await invoke("base.list", { query: "Agent", limit: 25 }, context);
      expect(bases.ok && bases.data.data).toEqual([expect.objectContaining({ id: baseId, name: "Agent telemetry" })]);
      const hiddenBases = await invoke("base.list", { limit: 25 }, otherContext);
      expect(hiddenBases.ok && hiddenBases.data.data).toEqual([]);

      const sources = await invoke("source.list", { baseId, limit: 25 }, context);
      expect(sources.ok && sources.data.data).toEqual([expect.objectContaining({ id: sourceId, name: "Agent source" })]);
      const resources = await invoke("resource.search", { query: "Agent service", tags: [], limit: 10 }, context);
      expect(resources.ok && resources.data.data).toEqual([
        expect.objectContaining({ title: "Agent service", metadata: expect.arrayContaining([{ label: "Base ID", value: baseId }]) }),
      ]);
      const metrics = await invoke("metric.search", { baseId, query: "agent", limit: 25 }, context);
      expect(metrics.ok && metrics.data.data).toEqual([expect.objectContaining({ name: "agent.cpu", seriesCount: 1 })]);
      const fields = await invoke("field.search", { baseId, query: "env", role: "dimension", limit: 25 }, context);
      expect(fields.ok && fields.data.data).toEqual([expect.objectContaining({ signalName: "agent.cpu", key: "env" })]);

      const compiled = await invoke("query.compile", { baseId, query }, context);
      expect(compiled.ok && compiled.data.data).toMatchObject({ valid: true, kind: "metric" });
      const executed = await invoke("query.execute", { baseId, query }, context);
      expect(executed.ok && executed.data.data).toMatchObject({ kind: "metric", points: [expect.objectContaining({ value: 42 })] });
      const tooBroad = await invoke("query.execute", { baseId, query: "metric agent.cpu avg every 1m since 1d" }, context);
      expect(tooBroad.ok).toBe(false);
      if (!tooBroad.ok) expect(tooBroad.error.message).toContain("too many grouped points");
      const events = await invoke("query.execute", { baseId, query: "events agent.event since 1h limit 1000" }, context);
      expect(events.ok && events.data.data.events).toHaveLength(100);
      if (events.ok) {
        expect(events.data.data.limitApplied).toBe(100);
        expect(events.data.data.truncated).toBe(true);
        expect(events.data.data.events[0]).not.toHaveProperty("payload");
        expect(events.data.data.events[0]).not.toHaveProperty("attributes");
      }
      const saved = await invoke("saved_query.list", { baseId, limit: 25 }, context);
      expect(saved.ok && saved.data.data).toEqual([expect.objectContaining({ id: savedQueryId, query })]);
      const savedExecution = await invoke("saved_query.execute", { baseId, queryId: savedQueryId }, context);
      expect(savedExecution.ok && savedExecution.data.data).toMatchObject({
        kind: "metric",
        points: [expect.objectContaining({ value: 42 })],
      });
    } finally {
      await sql`DELETE FROM pulse.bases WHERE id = ${baseId}::uuid`;
      if (accessId) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id IN (${user.id}::uuid, ${otherUserRow.id}::uuid)`;
    }
  });
});
