import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import type { WorkflowDefinition } from "../contracts";
import { migrate } from "../migrate";
import { executeBulkSelection, executePreparedRun, executeRecordEvent, executeScanner, prepareBulkSelection } from "./workflow-runtime";
import {
  claimStaleQueuedRuns,
  createStepRun,
  createWorkflowRun,
  failQueuedRunAttempt,
  finishStepRun,
  getOrCreateRecordScanCode,
  listRecordEventBaseIds,
  listRecordEventEnabled,
  update as updateWorkflow,
} from "./workflows";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type RuntimeFixture = {
  baseId: string;
  tableId: string;
  workflowId: string;
  scannerWorkflowId: string;
  fieldScannerWorkflowId: string;
  nameFieldId: string;
  statusFieldId: string;
  skuFieldId: string;
  recordAId: string;
  recordBId: string;
  recordCId: string;
  recordDId: string;
  accessIds: string[];
};

const publicAccess = async (permission: "read" | "write"): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (permission)
    VALUES (${permission}::auth.permission_level)
    RETURNING id::text AS id
  `;
  if (!row) throw new Error("Failed to create access row");
  return row.id;
};

const groupAccess = async (groupId: string, permission: "read" | "write"): Promise<string> => {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO auth.access (group_id, permission)
    VALUES (${groupId}::uuid, ${permission}::auth.permission_level)
    RETURNING id::text AS id
  `;
  if (!row) throw new Error("Failed to create group access row");
  return row.id;
};

const cleanupFixture = async (fixture: Pick<RuntimeFixture, "baseId" | "accessIds">): Promise<void> => {
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  for (const accessId of fixture.accessIds) {
    await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
  }
};

const bulkWorkflowDefinition = (): WorkflowDefinition => ({
  inputs: {
    records: { type: "recordList", table: "Items" },
  },
  triggers: {
    bulkSelection: { input: "records" },
  },
  steps: [
    {
      forEach: "inputs.records",
      as: "item",
      do: [
        {
          updateRecord: {
            record: "item",
            set: { Status: "item.Name" },
          },
        },
      ],
    },
  ],
});

const scannerWorkflowDefinition = (resolve?: { by: "field"; field: string }): WorkflowDefinition => ({
  inputs: {
    item: { type: "record", table: "Items" },
  },
  triggers: {
    scanner: { input: "item", ...(resolve ? { resolve } : {}) },
  },
  steps: [{ setVariable: { name: "seen", value: "inputs.item.Name" } }],
});

const recordEventWorkflowDefinition = (): WorkflowDefinition => ({
  inputs: {
    item: { type: "record", table: "Items" },
  },
  triggers: {
    recordEvent: { event: "updated", input: "item" },
  },
  steps: [
    {
      updateRecord: {
        record: "inputs.item",
        set: { Status: "inputs.item.Name" },
      },
    },
  ],
});

const insertWorkflow = async (
  baseId: string,
  name: string,
  definition: WorkflowDefinition,
  ownerUserId: string | null = null,
): Promise<string> => {
  const workflowId = uuid();
  await sql`
    INSERT INTO grids.workflows (
      id, short_id, base_id, name, source, compiled, enabled, position, owner_user_id, record_event_active_since
    )
    VALUES (
      ${workflowId}::uuid, ${shortId("W")}, ${baseId}::uuid, ${name}, ${name}, ${definition}::jsonb, TRUE, 0,
      ${ownerUserId}::uuid, CASE WHEN ${Boolean(definition.triggers.recordEvent)} THEN now() ELSE NULL END
    )
  `;
  return workflowId;
};

const insertFixture = async (permission: "read" | "write" = "write"): Promise<RuntimeFixture> => {
  const baseId = uuid();
  const tableId = uuid();
  const nameFieldId = uuid();
  const statusFieldId = uuid();
  const skuFieldId = uuid();
  const recordAId = uuid();
  const recordBId = uuid();
  const recordCId = uuid();
  const recordDId = uuid();
  const accessId = await publicAccess(permission);

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow runtime integration')
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${tableId}::uuid, ${shortId("T")}, ${baseId}::uuid, 'Items', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${nameFieldId}::uuid, 'NAME1', ${tableId}::uuid, 'Name', 'text', '{}'::jsonb, 0),
      (${statusFieldId}::uuid, 'STAT1', ${tableId}::uuid, 'Status', 'text', '{}'::jsonb, 1),
      (${skuFieldId}::uuid, 'SKU01', ${tableId}::uuid, 'Sku', 'text', '{}'::jsonb, 2)
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data)
    VALUES
      (${recordAId}::uuid, ${tableId}::uuid, ${{ [nameFieldId]: "Alpha", [statusFieldId]: "new", [skuFieldId]: "SKU-A" }}::jsonb),
      (${recordBId}::uuid, ${tableId}::uuid, ${{ [nameFieldId]: "Beta", [statusFieldId]: "new", [skuFieldId]: "SKU-B" }}::jsonb),
      (${recordCId}::uuid, ${tableId}::uuid, ${{ [nameFieldId]: "Gamma", [statusFieldId]: "new", [skuFieldId]: "SKU-DUP" }}::jsonb),
      (${recordDId}::uuid, ${tableId}::uuid, ${{ [nameFieldId]: "Delta", [statusFieldId]: "new", [skuFieldId]: "SKU-DUP" }}::jsonb)
  `;
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${baseId}::uuid, ${accessId}::uuid)`;

  const workflowId = await insertWorkflow(baseId, "Bulk update", bulkWorkflowDefinition());
  const scannerWorkflowId = await insertWorkflow(baseId, "Scan code", scannerWorkflowDefinition());
  const fieldScannerWorkflowId = await insertWorkflow(baseId, "Scan sku", scannerWorkflowDefinition({ by: "field", field: "Sku" }));

  return {
    baseId,
    tableId,
    workflowId,
    scannerWorkflowId,
    fieldScannerWorkflowId,
    nameFieldId,
    statusFieldId,
    skuFieldId,
    recordAId,
    recordBId,
    recordCId,
    recordDId,
    accessIds: [accessId],
  };
};

const recordStatuses = async (fixture: RuntimeFixture): Promise<Record<string, string | null>> => {
  const rows = await sql<Array<{ id: string; value: string | null }>>`
    SELECT id::text AS id, data ->> ${fixture.statusFieldId} AS value
    FROM grids.records
    WHERE id = ANY(${sql.array([fixture.recordAId, fixture.recordBId, fixture.recordCId, fixture.recordDId], "UUID")})
  `;
  return Object.fromEntries(rows.map((row) => [row.id, row.value]));
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("workflow runtime integration", () => {
  postgresTest("discovers only bases with enabled recordEvent workflows", async () => {
    const fixture = await insertFixture();
    try {
      expect(await listRecordEventBaseIds()).not.toContain(fixture.baseId);

      const recordEventWorkflowId = await insertWorkflow(fixture.baseId, "On update", recordEventWorkflowDefinition());
      expect(await listRecordEventBaseIds()).toContain(fixture.baseId);
      const oldEvent = {
        v: 1 as const,
        type: "record.updated" as const,
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordAId,
        version: 1,
        changedFieldIds: [],
        actorId: null,
        occurredAt: "2020-01-01T00:00:00.000Z",
      };
      expect(await listRecordEventEnabled(oldEvent)).toHaveLength(0);
      expect(await listRecordEventEnabled({ ...oldEvent, occurredAt: new Date(Date.now() + 1000).toISOString() })).toHaveLength(1);

      expect((await updateWorkflow(recordEventWorkflowId, { enabled: false }, null)).ok).toBe(true);
      expect(await listRecordEventBaseIds()).not.toContain(fixture.baseId);
      const disabledEventAt = new Date().toISOString();
      expect((await updateWorkflow(recordEventWorkflowId, { enabled: true }, null)).ok).toBe(true);
      expect(await listRecordEventEnabled({ ...oldEvent, occurredAt: disabledEventAt })).toHaveLength(0);
      expect(await listRecordEventEnabled({ ...oldEvent, occurredAt: new Date(Date.now() + 1000).toISOString() })).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("leases an orphaned queued run to only one reconciler", async () => {
    const fixture = await insertFixture();
    try {
      const actorGroupId = uuid();
      const run = await createWorkflowRun({
        workflowId: fixture.workflowId,
        baseId: fixture.baseId,
        triggerKind: "form",
        triggerInput: { source: "original" },
        resolvedInput: { source: "resolved" },
        actorGroupIds: [actorGroupId],
        authorization: {
          kind: "dashboard-widget",
          dashboardId: uuid(),
          dashboardWidgetId: "widget-1",
        },
      });
      await sql`
        UPDATE grids.workflow_runs
        SET created_at = now() - interval '2 days'
        WHERE id = ${run.id}::uuid
      `;

      const claims = (await Promise.all([claimStaleQueuedRuns(24 * 60 * 60 * 1000), claimStaleQueuedRuns(24 * 60 * 60 * 1000)])).flat();
      const claimed = claims.filter((candidate) => candidate.id === run.id);

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        triggerInput: { source: "original" },
        resolvedInput: { source: "resolved" },
        actorGroupIds: [actorGroupId],
        authorization: { kind: "dashboard-widget", dashboardWidgetId: "widget-1" },
        queueAttempts: 1,
      });
      expect((await claimStaleQueuedRuns(24 * 60 * 60 * 1000)).some((candidate) => candidate.id === run.id)).toBe(false);

      await sql`UPDATE grids.workflow_runs SET status = 'running' WHERE id = ${run.id}::uuid`;
      expect(await failQueuedRunAttempt(run.id, 1, "late submit failure")).toBeNull();
      const [current] = await sql<Array<{ status: string }>>`
        SELECT status FROM grids.workflow_runs WHERE id = ${run.id}::uuid
      `;
      expect(current?.status).toBe("running");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("bulk selection executes explicit record ids through native record actions", async () => {
    const fixture = await insertFixture("write");
    try {
      const run = await executeBulkSelection({
        workflowId: fixture.workflowId,
        recordIds: [fixture.recordAId, fixture.recordBId],
      });
      expect(run.ok).toBe(true);
      if (!run.ok) throw new Error(run.error.message);

      const statuses = await recordStatuses(fixture);
      expect(statuses[fixture.recordAId]).toBe("Alpha");
      expect(statuses[fixture.recordBId]).toBe("Beta");
      expect(statuses[fixture.recordCId]).toBe("new");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("bulk selection resumes completed loop steps by record path", async () => {
    const fixture = await insertFixture("write");
    try {
      const triggerInput = { input: "records", recordIds: [fixture.recordAId, fixture.recordBId] };
      const resolvedInput = { records: [fixture.recordAId, fixture.recordBId] };
      const run = await createWorkflowRun({
        workflowId: fixture.workflowId,
        baseId: fixture.baseId,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
      });
      const completed = await createStepRun({
        runId: run.id,
        stepIndex: 0,
        stepPath: `steps.0.do.${fixture.recordAId}.0`,
        kind: "updateRecord",
        input: { kind: "updateRecord" },
      });
      await finishStepRun(completed.id, {
        status: "succeeded",
        output: { ok: true, value: { kind: "record", tableId: fixture.tableId, recordId: fixture.recordAId } },
      });

      const executed = await executePreparedRun({
        workflowId: fixture.workflowId,
        runId: run.id,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
        authorization: { kind: "workflow" },
      });
      expect(executed.ok).toBe(true);
      if (!executed.ok) throw new Error(executed.error.message);

      const statuses = await recordStatuses(fixture);
      expect(statuses[fixture.recordAId]).toBe("new");
      expect(statuses[fixture.recordBId]).toBe("Beta");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("prepared workflow runs reclaim expired running leases", async () => {
    const fixture = await insertFixture("write");
    try {
      const triggerInput = { input: "records", recordIds: [fixture.recordAId] };
      const resolvedInput = { records: [fixture.recordAId] };
      const run = await createWorkflowRun({
        workflowId: fixture.workflowId,
        baseId: fixture.baseId,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
      });
      await sql`
        UPDATE grids.workflow_runs
        SET status = 'running',
            started_at = now() - interval '5 minutes',
            heartbeat_at = now() - interval '5 minutes',
            lease_expires_at = now() - interval '1 minute'
        WHERE id = ${run.id}::uuid
      `;

      const executed = await executePreparedRun({
        workflowId: fixture.workflowId,
        runId: run.id,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
        authorization: { kind: "workflow" },
      });
      expect(executed.ok).toBe(true);
      if (!executed.ok) throw new Error(executed.error.message);

      const statuses = await recordStatuses(fixture);
      expect(statuses[fixture.recordAId]).toBe("Alpha");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("prepared workflow runs leave active running leases untouched", async () => {
    const fixture = await insertFixture("write");
    try {
      const triggerInput = { input: "records", recordIds: [fixture.recordAId] };
      const resolvedInput = { records: [fixture.recordAId] };
      const run = await createWorkflowRun({
        workflowId: fixture.workflowId,
        baseId: fixture.baseId,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
      });
      await sql`
        UPDATE grids.workflow_runs
        SET status = 'running',
            started_at = now(),
            heartbeat_at = now(),
            lease_expires_at = now() + interval '5 minutes'
        WHERE id = ${run.id}::uuid
      `;
      await sql`UPDATE grids.workflows SET enabled = FALSE WHERE id = ${fixture.workflowId}::uuid`;

      const executed = await executePreparedRun({
        workflowId: fixture.workflowId,
        runId: run.id,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
        authorization: { kind: "workflow" },
      });
      expect(executed.ok).toBe(true);
      if (!executed.ok) throw new Error(executed.error.message);
      expect(executed.data.status).toBe("running");

      const statuses = await recordStatuses(fixture);
      expect(statuses[fixture.recordAId]).toBe("new");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("bulk selection refuses to retry interrupted side-effect steps", async () => {
    const fixture = await insertFixture("write");
    try {
      const triggerInput = { input: "records", recordIds: [fixture.recordAId, fixture.recordBId] };
      const resolvedInput = { records: [fixture.recordAId, fixture.recordBId] };
      const run = await createWorkflowRun({
        workflowId: fixture.workflowId,
        baseId: fixture.baseId,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
      });
      await createStepRun({
        runId: run.id,
        stepIndex: 0,
        stepPath: `steps.0.do.${fixture.recordAId}.0`,
        kind: "updateRecord",
        input: { kind: "updateRecord" },
      });

      const executed = await executePreparedRun({
        workflowId: fixture.workflowId,
        runId: run.id,
        triggerKind: "bulkSelection",
        triggerInput,
        resolvedInput,
        authorization: { kind: "workflow" },
      });
      expect(executed.ok).toBe(false);
      if (executed.ok) throw new Error("Expected interrupted step failure");
      expect(executed.error.message).toContain("cannot be retried safely");

      const statuses = await recordStatuses(fixture);
      expect(statuses[fixture.recordAId]).toBe("new");
      expect(statuses[fixture.recordBId]).toBe("new");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("bulk selection resolves current-query selections server-side", async () => {
    const fixture = await insertFixture("write");
    try {
      const prepared = await prepareBulkSelection({
        workflowId: fixture.workflowId,
        query: { limit: 2 },
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.error.message);
      expect((prepared.data.resolvedInput.records as string[]).length).toBe(2);
      expect(prepared.data.triggerInput).toEqual({ input: "records", query: { limit: 2 } });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("bulk selection refuses actors without workflow write permission", async () => {
    const fixture = await insertFixture("read");
    try {
      const prepared = await prepareBulkSelection({
        workflowId: fixture.workflowId,
        recordIds: [fixture.recordAId],
      });
      expect(prepared.ok).toBe(false);
      if (prepared.ok) throw new Error("Expected permission denial");
      expect(prepared.error.message).toContain("cannot run this workflow");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("record events run as the workflow owner principal and retain the event actor as metadata", async () => {
    const fixture = await insertFixture("write");
    const ownerUserId = uuid();
    const eventActorUserId = uuid();
    const ownerGroupId = uuid();
    const accessIds: string[] = [];
    try {
      await sql`DELETE FROM grids.base_access WHERE access_id = ${fixture.accessIds[0]}::uuid`;
      await sql`DELETE FROM auth.access WHERE id = ${fixture.accessIds[0]}::uuid`;
      fixture.accessIds.length = 0;

      await sql`
        INSERT INTO auth.users (id, uid, provider, profile, display_name, mail, given_name, sn)
        VALUES
          (${ownerUserId}::uuid, ${`owner-${ownerUserId}`}, 'local', 'user', 'Workflow Owner', 'owner@example.test', 'Workflow', 'Owner'),
          (${eventActorUserId}::uuid, ${`actor-${eventActorUserId}`}, 'local', 'user', 'Event Actor', 'actor@example.test', 'Event', 'Actor')
      `;
      await sql`
        INSERT INTO auth.groups (id, cn, provider, name, description)
        VALUES (${ownerGroupId}::uuid, ${`workflow-owner-${ownerGroupId}`}, 'local', 'Workflow owners', 'Workflow owner integration test')
      `;
      await sql`INSERT INTO auth.user_groups_v2 (user_id, group_id) VALUES (${ownerUserId}::uuid, ${ownerGroupId}::uuid)`;

      const tableAccessId = await groupAccess(ownerGroupId, "write");
      accessIds.push(tableAccessId);
      await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${fixture.tableId}::uuid, ${tableAccessId}::uuid)`;

      const workflowId = await insertWorkflow(fixture.baseId, "Record event owner run", recordEventWorkflowDefinition(), ownerUserId);
      const workflowAccessId = await groupAccess(ownerGroupId, "write");
      accessIds.push(workflowAccessId);
      await sql`INSERT INTO grids.workflow_access (workflow_id, access_id) VALUES (${workflowId}::uuid, ${workflowAccessId}::uuid)`;

      const run = await executeRecordEvent({
        workflowId,
        event: {
          v: 1,
          type: "record.updated",
          baseId: fixture.baseId,
          tableId: fixture.tableId,
          recordId: fixture.recordAId,
          version: 2,
          changedFieldIds: [fixture.nameFieldId],
          actorId: eventActorUserId,
          occurredAt: "2026-07-08T00:00:00.000Z",
        },
      });
      expect(run.ok).toBe(true);
      if (!run.ok) throw new Error(run.error.message);

      const statuses = await recordStatuses(fixture);
      expect(statuses[fixture.recordAId]).toBe("Alpha");

      const [runRow] = await sql<Array<{ actor_user_id: string | null; trigger_input: Record<string, unknown> }>>`
        SELECT actor_user_id::text AS actor_user_id, trigger_input
        FROM grids.workflow_runs
        WHERE id = ${run.data.id}::uuid
      `;
      expect(runRow?.actor_user_id).toBe(ownerUserId);
      expect(runRow?.trigger_input.eventActorUserId).toBe(eventActorUserId);
    } finally {
      await cleanupFixture(fixture);
      for (const accessId of accessIds) await sql`DELETE FROM auth.access WHERE id = ${accessId}::uuid`;
      await sql`DELETE FROM auth.user_groups_v2 WHERE user_id = ${ownerUserId}::uuid OR group_id = ${ownerGroupId}::uuid`;
      await sql`DELETE FROM auth.groups WHERE id = ${ownerGroupId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${ownerUserId}::uuid OR id = ${eventActorUserId}::uuid`;
    }
  });

  postgresTest("scanner workflows resolve opaque scan codes and configured fields", async () => {
    const fixture = await insertFixture("write");
    try {
      const scan = await getOrCreateRecordScanCode({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordAId,
        code: "gsc_test_alpha_code",
      });
      const byCode = await executeScanner({ workflowId: fixture.scannerWorkflowId, scannedText: scan.code });
      expect(byCode.ok).toBe(true);
      if (!byCode.ok) throw new Error(byCode.error.message);

      const byField = await executeScanner({ workflowId: fixture.fieldScannerWorkflowId, scannedText: "SKU-B" });
      expect(byField.ok).toBe(true);
      if (!byField.ok) throw new Error(byField.error.message);

      const duplicate = await executeScanner({ workflowId: fixture.fieldScannerWorkflowId, scannedText: "SKU-DUP" });
      expect(duplicate.ok).toBe(false);
      if (duplicate.ok) throw new Error("Expected duplicate scanner field failure");
      expect(duplicate.error.message).toContain("matched more than one record");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("scan code creation is idempotent per active record", async () => {
    const fixture = await insertFixture("write");
    try {
      const first = await getOrCreateRecordScanCode({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordAId,
        code: "gsc_stable_first",
      });
      const second = await getOrCreateRecordScanCode({
        baseId: fixture.baseId,
        tableId: fixture.tableId,
        recordId: fixture.recordAId,
        code: "gsc_stable_second",
      });
      expect(second.id).toBe(first.id);
      expect(second.code).toBe(first.code);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
