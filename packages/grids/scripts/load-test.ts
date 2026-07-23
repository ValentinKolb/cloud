#!/usr/bin/env bun
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { accounts, serviceAccountCredentials, serviceAccounts } from "@valentinkolb/cloud/services";
import { sql } from "bun";
import { migrate } from "../src/migrate";
import { gridsService } from "../src/service";
import { dropOrphanedFieldIndexes, ensureFieldIndex } from "../src/service/field-indexes";
import {
  buildLoadReport,
  deterministicRecordId,
  LOAD_FIXTURE_MARKER,
  type LoadHealthSnapshot,
  type LoadManifest,
  LoadManifestSchema,
  type LoadProfile,
  parsePositiveInteger,
  parseProfile,
  renderLoadReport,
} from "./load-test-support";

const BASE_URL = (process.env.GRIDS_LOAD_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DOCKER_BASE_URL = (process.env.GRIDS_LOAD_DOCKER_BASE_URL ?? "http://host.docker.internal:3000").replace(/\/$/, "");
const ADMIN_TOKEN = process.env.GRIDS_LOAD_ADMIN_TOKEN ?? "dev-admin";
const STATE_DIR = resolve(process.env.GRIDS_LOAD_STATE_DIR ?? "/tmp/grids-load");
const MANIFEST_PATH = resolve(process.env.GRIDS_LOAD_MANIFEST ?? join(STATE_DIR, "manifest.json"));
const K6_IMAGE = process.env.GRIDS_LOAD_K6_IMAGE ?? "grafana/k6:0.54.0";
const DEFAULT_ROWS = 10_000;

type Result<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

const must = <T>(result: Result<T>, label: string): T => {
  if ("error" in result) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

const readManifest = async (): Promise<LoadManifest> => {
  const raw = await readFile(MANIFEST_PATH, "utf8").catch(() => null);
  if (!raw) throw new Error(`No load fixture found at ${MANIFEST_PATH}. Run load:prepare first.`);
  return LoadManifestSchema.parse(JSON.parse(raw));
};

const writeManifest = async (manifest: LoadManifest): Promise<void> => {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true, mode: 0o700 });
  await Bun.write(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  await chmod(MANIFEST_PATH, 0o600);
};

const adminLogin = async (): Promise<{ sessionToken: string; userId: string }> => {
  const response = await fetch(`${BASE_URL}/api/auth/admin-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  if (!response.ok) throw new Error(`Admin login failed (${response.status}): ${await response.text()}`);
  const body = (await response.json()) as { session_token?: string; user?: { id?: string } };
  if (!body.session_token || !body.user?.id) throw new Error("Admin login response did not include a session and user");
  return { sessionToken: body.session_token, userId: body.user.id };
};

const fieldByName = <T extends { id: string; name: string }>(fields: T[], name: string): T => {
  const field = fields.find((candidate) => candidate.name === name);
  if (!field) throw new Error(`Inventory template is missing field ${name}`);
  return field;
};

const tableByName = <T extends { id: string; name: string }>(tables: T[], name: string): T => {
  const table = tables.find((candidate) => candidate.name === name);
  if (!table) throw new Error(`Inventory template is missing table ${name}`);
  return table;
};

const seedRecords = async (manifest: LoadManifest, categoryIds: string[], locationIds: string[]): Promise<void> => {
  const batchSize = parsePositiveInteger(process.env.GRIDS_LOAD_SEED_BATCH, 10_000, "GRIDS_LOAD_SEED_BATCH");
  const f = manifest.fields;
  for (let offset = 0; offset < manifest.rows; offset += batchSize) {
    const count = Math.min(batchSize, manifest.rows - offset);
    const first = offset + 1;
    const last = offset + count;
    await sql`
      INSERT INTO grids.records (id, table_id, data, version)
      SELECT
        (${manifest.recordIdPrefix} || '-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
        ${manifest.tables.items}::uuid,
        jsonb_build_object(
          ${f.assetId}::text, 'LOAD-' || lpad(i::text, 7, '0'),
          ${f.name}::text, 'Load item ' || i::text || CASE WHEN i % 100 = 0 THEN ' needle' ELSE '' END,
          ${f.status}::text, jsonb_build_array((ARRAY['available', 'reserved', 'in_use', 'maintenance'])[((i - 1) % 4) + 1]),
          ${f.condition}::text, jsonb_build_array((ARRAY['new', 'good', 'used', 'repair'])[((i - 1) % 4) + 1]),
          ${f.serialNumber}::text, 'SER-' || lpad(i::text, 9, '0'),
          ${f.tags}::text, jsonb_build_array(CASE WHEN i % 10 = 0 THEN 'calibrated' ELSE 'load-test' END),
          ${f.quantity}::text, ((i % 8) + 1)::text,
          ${f.replacementValue}::text, ((i % 5000) + 50)::text,
          ${f.purchaseDate}::text, to_char(date '2021-01-01' + ((i - 1) % 1825), 'YYYY-MM-DD'),
          ${f.notes}::text, 'Deterministic local load fixture row ' || i::text
        ),
        1
      FROM generate_series(${first}, ${last}) AS i
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
      SELECT
        (${manifest.recordIdPrefix} || '-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
        ${f.category}::uuid,
        (${categoryIds[0]})::uuid,
        0
      FROM generate_series(${first}, ${last}) AS i
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO grids.record_links (from_record_id, from_field_id, to_record_id, position)
      SELECT
        (${manifest.recordIdPrefix} || '-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid,
        ${f.location}::uuid,
        (${locationIds[0]})::uuid,
        0
      FROM generate_series(${first}, ${last}) AS i
      ON CONFLICT DO NOTHING
    `;
    process.stdout.write(`\rSeeded ${last.toLocaleString("en-US")}/${manifest.rows.toLocaleString("en-US")} records`);
  }
  process.stdout.write("\n");
  await sql`ANALYZE grids.records`;
  await sql`ANALYZE grids.record_links`;
};

const seed = async (): Promise<LoadManifest> => {
  const existing = await readFile(MANIFEST_PATH, "utf8").catch(() => null);
  if (existing) throw new Error(`A load fixture already exists at ${MANIFEST_PATH}. Run load:cleanup or load:prepare.`);

  const rows = parsePositiveInteger(process.env.GRIDS_LOAD_ROWS, DEFAULT_ROWS, "GRIDS_LOAD_ROWS");
  await migrate();
  const login = await adminLogin();
  const admin = await accounts.users.get({ id: login.userId });
  if (!admin) throw new Error("Admin user disappeared after login");

  const createdAt = new Date().toISOString();
  const base = must(
    await gridsService.template.instantiate(
      "inventory",
      { name: `Load Test ${createdAt.slice(0, 19).replace("T", " ")} UTC`, withSampleData: true },
      admin.id,
    ),
    "create inventory fixture",
  );
  console.log(`Created Inventory fixture ${base.id}`);

  try {
    must(
      await gridsService.base.update(
        base.id,
        { description: `${LOAD_FIXTURE_MARKER}:${createdAt}. Safe to remove with the Grids load harness.` },
        admin.id,
      ),
      "mark fixture base",
    );
    console.log("Marked fixture for safe cleanup");
    const tables = await gridsService.table.listByBase(base.id);
    const items = tableByName(tables, "Items");
    const categories = tableByName(tables, "Categories");
    const locations = tableByName(tables, "Locations");
    const fields = await gridsService.field.listByTable(items.id);
    const categoryRecords = must(await gridsService.record.list({ tableId: categories.id, limit: 1 }), "load fixture categories").items;
    const locationRecords = must(await gridsService.record.list({ tableId: locations.id, limit: 1 }), "load fixture locations").items;
    if (!categoryRecords[0] || !locationRecords[0]) throw new Error("Inventory template did not create relation targets");
    console.log("Resolved Inventory tables, fields, and relation targets");

    const workflow = must(
      await gridsService.workflow.create(
        base.id,
        {
          name: "Load test no-op",
          description: "Exercises workflow admission, persistence, execution, and live updates.",
          source: "steps:\n  - setVariable:\n      name: ok\n      value: true",
          enabled: true,
        },
        admin.id,
      ),
      "create fixture workflow",
    );
    console.log("Created load workflow");
    const serviceAccount = must(
      await serviceAccounts.createResourceBound({
        name: `Grids load ${base.shortId}`,
        appId: "grids",
        resourceType: "base",
        resourceId: base.id,
        createdBy: admin.id,
      }),
      "create fixture service account",
    );
    console.log("Created resource-bound service account");
    const access = must(
      await gridsService.access.grant({
        resourceType: "base",
        resourceId: base.id,
        principal: { type: "service_account", serviceAccountId: serviceAccount.id },
        permission: "write",
        actorId: admin.id,
      }),
      "grant fixture access",
    );
    console.log("Granted base-scoped write access");
    const credential = must(
      await serviceAccountCredentials.createResourceApiToken({
        serviceAccountId: serviceAccount.id,
        actor: admin,
        name: "Local Grids load harness",
        scopes: ["grids:write"],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
      }),
      "create fixture API token",
    );
    console.log("Created short-lived API token");
    const templates = await gridsService.document.listTemplatesForTable(items.id);
    const enabledTemplate = templates.find((template) => template.enabled);
    const prefix = base.id.slice(0, 8).toLowerCase();
    const manifest: LoadManifest = {
      version: 1,
      marker: LOAD_FIXTURE_MARKER,
      createdAt,
      baseUrl: BASE_URL,
      baseId: base.id,
      baseName: base.name,
      rows,
      recordIdPrefix: prefix,
      serviceAccountId: serviceAccount.id,
      credentialId: credential.credential.id,
      accessId: access.accessId,
      apiToken: credential.token,
      sessionToken: login.sessionToken,
      tables: { items: items.id, categories: categories.id, locations: locations.id },
      fields: {
        assetId: fieldByName(fields, "Asset ID").id,
        name: fieldByName(fields, "Name").id,
        category: fieldByName(fields, "Category").id,
        location: fieldByName(fields, "Location").id,
        status: fieldByName(fields, "Status").id,
        condition: fieldByName(fields, "Condition").id,
        serialNumber: fieldByName(fields, "Serial number").id,
        tags: fieldByName(fields, "Tags").id,
        quantity: fieldByName(fields, "Quantity").id,
        replacementValue: fieldByName(fields, "Replacement value").id,
        purchaseDate: fieldByName(fields, "Purchase date").id,
        notes: fieldByName(fields, "Notes").id,
      },
      workflowId: workflow.id,
      documentTemplateId: enabledTemplate?.id,
      documentRecordId: deterministicRecordId(prefix, 1),
    };
    await seedRecords(manifest, [categoryRecords[0].id], [locationRecords[0].id]);
    for (const name of ["Asset ID", "Name", "Status", "Quantity", "Replacement value", "Purchase date"] as const) {
      const field = fieldByName(fields, name);
      await ensureFieldIndex(field.id, field.type, items.id, field.config);
    }
    await writeManifest(manifest);
    console.log(`Fixture ready: ${base.name} (${base.id}), ${rows.toLocaleString("en-US")} load records`);
    console.log(`Manifest: ${MANIFEST_PATH}`);
    return manifest;
  } catch (error) {
    const accessIds = await gridsService.access
      .listForBaseTree(base.id)
      .then((entries) => entries.map((entry) => entry.id))
      .catch(() => []);
    await sql`DELETE FROM grids.bases WHERE id = ${base.id}::uuid`.catch(() => {});
    await dropOrphanedFieldIndexes().catch(() => {});
    if (accessIds.length > 0) await sql`DELETE FROM auth.access WHERE id = ANY(${sql.array(accessIds, "UUID")})`.catch(() => {});
    await serviceAccounts.deleteForResource({ appId: "grids", resourceType: "base", resourceId: base.id }).catch(() => {});
    await fetch(`${BASE_URL}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${login.sessionToken}` } }).catch(
      () => {},
    );
    throw error;
  }
};

const cleanup = async (allowMissing = false): Promise<void> => {
  let manifest: LoadManifest;
  try {
    manifest = await readManifest();
  } catch (error) {
    if (allowMissing && error instanceof Error && error.message.startsWith("No load fixture")) return;
    throw error;
  }
  const base = await gridsService.base.get(manifest.baseId, { includeDeleted: true });
  if (base && !base.description?.startsWith(`${LOAD_FIXTURE_MARKER}:`)) {
    throw new Error(`Refusing to delete base ${base.id}: fixture marker is missing`);
  }
  const accessIds = base ? (await gridsService.access.listForBaseTree(base.id)).map((entry) => entry.id) : [manifest.accessId];
  const admin = await accounts.users.get({ id: manifest.sessionToken.split(":", 1)[0] ?? "" });
  if (admin) await serviceAccountCredentials.revoke({ credentialId: manifest.credentialId, actor: admin }).catch(() => {});
  if (base) await sql`DELETE FROM grids.bases WHERE id = ${base.id}::uuid`;
  if (base) await dropOrphanedFieldIndexes();
  if (accessIds.length > 0) await sql`DELETE FROM auth.access WHERE id = ANY(${sql.array(accessIds, "UUID")})`;
  await serviceAccounts.delete({ id: manifest.serviceAccountId }).catch(() => {});
  await fetch(`${manifest.baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${manifest.sessionToken}` },
  }).catch(() => {});
  await rm(MANIFEST_PATH, { force: true });
  console.log(`Removed fixture ${manifest.baseId}`);
};

const dockerStats = async (): Promise<LoadHealthSnapshot["containers"]> => {
  const process = Bun.spawn(["docker", "stats", "--no-stream", "--format", "{{json .}}"], { stdout: "pipe", stderr: "ignore" });
  if ((await process.exited) !== 0) return [];
  const output = await new Response(process.stdout).text();
  return output
    .trim()
    .split("\n")
    .flatMap((line) => {
      try {
        const row = JSON.parse(line) as { Name?: string; CPUPerc?: string; MemUsage?: string };
        if (!row.Name || (row.Name !== "app-grids" && row.Name !== "gateway" && !/postgres/i.test(row.Name))) return [];
        const [used, limit] = (row.MemUsage ?? "").split("/").map((value) => parseDockerBytes(value.trim()));
        return [
          {
            name: row.Name,
            cpu: row.CPUPerc ?? "n/a",
            memory: row.MemUsage ?? "n/a",
            memoryBytes: used ?? 0,
            memoryLimitBytes: limit ?? 0,
          },
        ];
      } catch {
        return [];
      }
    });
};

const parseDockerBytes = (value: string): number => {
  const match = value.match(/^([\d.]+)\s*([kmgt]?i?b)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const powers: Record<string, number> = { b: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4 };
  const power = powers[match[2]?.toLowerCase() ?? "b"] ?? 0;
  return amount * 1024 ** power;
};

const captureHealth = async (manifest: LoadManifest): Promise<LoadHealthSnapshot> => {
  const operational = await gridsService.operations.health();
  const [postgres] = await sql<
    Array<{
      active_connections: number;
      database_bytes: number | string;
      idle_connections: number;
      max_connections: number;
      total_connections: number;
    }>
  >`
    SELECT
      COUNT(*)::int AS total_connections,
      COUNT(*) FILTER (WHERE state = 'active')::int AS active_connections,
      COUNT(*) FILTER (WHERE state = 'idle')::int AS idle_connections,
      current_setting('max_connections')::int AS max_connections,
      pg_database_size(current_database()) AS database_bytes
    FROM pg_stat_activity
    WHERE datname = current_database()
  `;
  if (!postgres) throw new Error("Could not read Postgres health");
  const [fixture] = await sql<
    Array<{
      record_events_dead: number;
      record_events_failed: number;
      record_events_pending: number;
      workflow_active: number;
      workflow_failed: number;
    }>
  >`
    SELECT
      (SELECT count(*)::int FROM grids.workflow_runs
        WHERE workflow_id = ${manifest.workflowId}::uuid AND status IN ('queued', 'running', 'waiting')) AS workflow_active,
      (SELECT count(*)::int FROM grids.workflow_runs
        WHERE workflow_id = ${manifest.workflowId}::uuid AND status IN ('failed', 'needs_attention')) AS workflow_failed,
      (SELECT count(*)::int FROM grids.record_event_outbox
        WHERE base_id = ${manifest.baseId}::uuid AND status = 'pending') AS record_events_pending,
      (SELECT count(*)::int FROM grids.record_event_outbox
        WHERE base_id = ${manifest.baseId}::uuid AND status = 'failed') AS record_events_failed,
      (SELECT count(*)::int FROM grids.record_event_outbox
        WHERE base_id = ${manifest.baseId}::uuid AND status = 'dead') AS record_events_dead
  `;
  if (!fixture) throw new Error("Could not read fixture health");
  return {
    capturedAt: new Date().toISOString(),
    operational: {
      status: operational.status,
      outbox: {
        dead: operational.outbox.dead,
        failed: operational.outbox.failed,
        pending: operational.outbox.pending,
      },
      workflows: {
        needsAttention: operational.workflows.needsAttention,
        staleRunning: operational.workflows.staleRunning,
      },
      effects: { needsAttention: operational.effects.needsAttention },
    },
    postgres: {
      activeConnections: postgres.active_connections,
      databaseBytes: Number(postgres.database_bytes),
      idleConnections: postgres.idle_connections,
      maxConnections: postgres.max_connections,
      totalConnections: postgres.total_connections,
    },
    fixture: {
      workflowActive: fixture.workflow_active,
      workflowFailed: fixture.workflow_failed,
      recordEventsPending: fixture.record_events_pending,
      recordEventsFailed: fixture.record_events_failed,
      recordEventsDead: fixture.record_events_dead,
    },
    containers: await dockerStats(),
  };
};

const waitForFixtureDrain = async (manifest: LoadManifest, timeoutSeconds: number): Promise<LoadHealthSnapshot> => {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let health = await captureHealth(manifest);
  while (health.fixture.workflowActive > 0 || health.fixture.recordEventsPending > 0) {
    if (Date.now() >= deadline) return health;
    await Bun.sleep(Math.min(2_000, Math.max(1, deadline - Date.now())));
    health = await captureHealth(manifest);
  }
  return health;
};

const run = async (profile: LoadProfile): Promise<void> => {
  const manifest = await readManifest();
  if (process.env.GRIDS_LOAD_INCLUDE_PDF === "1" && !manifest.documentTemplateId) {
    throw new Error("GRIDS_LOAD_INCLUDE_PDF=1 requires an enabled document template in the fixture");
  }
  const reportDir = resolve(process.env.GRIDS_LOAD_REPORT_DIR ?? join(STATE_DIR, "results", `${Date.now()}-${profile}`));
  await mkdir(reportDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const before = await captureHealth(manifest);
  await Bun.write(join(reportDir, "before.json"), `${JSON.stringify(before, null, 2)}\n`);

  const scriptPath = resolve(import.meta.dir, "load-test.k6.js");
  const args = [
    "docker",
    "run",
    "--rm",
    "--add-host=host.docker.internal:host-gateway",
    "-v",
    `${scriptPath}:/scripts/load-test.k6.js:ro`,
    "-v",
    `${dirname(MANIFEST_PATH)}:/state:ro`,
    "-v",
    `${reportDir}:/results`,
    "-e",
    `GRIDS_LOAD_PROFILE=${profile}`,
    "-e",
    `GRIDS_LOAD_BASE_URL=${DOCKER_BASE_URL}`,
    "-e",
    `GRIDS_LOAD_MANIFEST=/state/${MANIFEST_PATH.split("/").at(-1)}`,
    "-e",
    `GRIDS_LOAD_INCLUDE_PDF=${process.env.GRIDS_LOAD_INCLUDE_PDF ?? "0"}`,
  ];
  if (process.env.GRIDS_LOAD_DURATION) args.push("-e", `GRIDS_LOAD_DURATION=${process.env.GRIDS_LOAD_DURATION}`);
  if (process.env.GRIDS_LOAD_SCENARIOS) args.push("-e", `GRIDS_LOAD_SCENARIOS=${process.env.GRIDS_LOAD_SCENARIOS}`);
  if (process.env.GRIDS_LOAD_READ_RATE) args.push("-e", `GRIDS_LOAD_READ_RATE=${process.env.GRIDS_LOAD_READ_RATE}`);
  args.push(K6_IMAGE, "run", "/scripts/load-test.k6.js");
  console.log(`Running ${profile} profile against ${manifest.rows.toLocaleString("en-US")} fixture records`);
  const k6 = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  const k6ExitCode = await k6.exited;

  const settleSeconds = parsePositiveInteger(process.env.GRIDS_LOAD_SETTLE_SECONDS, 60, "GRIDS_LOAD_SETTLE_SECONDS");
  const after = await waitForFixtureDrain(manifest, settleSeconds);
  const summary = await readFile(join(reportDir, "k6-summary.json"), "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => ({}));
  const report = buildLoadReport({
    profile,
    k6ExitCode,
    rows: manifest.rows,
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    before,
    after,
  });
  await Bun.write(join(reportDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await Bun.write(join(reportDir, "report.md"), renderLoadReport(report));
  console.log(`Report: ${join(reportDir, "report.md")}`);
  if (k6ExitCode !== 0 || !report.passed) throw new Error(`Load profile failed (k6=${k6ExitCode}, gates=${report.passed})`);
};

const usage = (): never => {
  console.log(`Usage: bun run scripts/load-test.ts <command>

Commands:
  seed             Create an isolated Inventory fixture
  reset            Remove the previous fixture and create a fresh one
  run <profile>    Run smoke, load, soak, or stress
  cleanup          Remove the fixture, credentials, and session
`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const [command, argument] = process.argv.slice(2);
  if (command === "seed") return void (await seed());
  if (command === "reset") {
    await cleanup(true);
    return void (await seed());
  }
  if (command === "cleanup") return void (await cleanup(true));
  if (command === "run") return void (await run(parseProfile(argument)));
  usage();
};

await main();
