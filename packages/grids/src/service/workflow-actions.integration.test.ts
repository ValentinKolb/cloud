/**
 * The six declared Grids actions, driven the way the runtime drives them.
 *
 * Nothing here is checkable by the type system. An action names a field with
 * `ctx.binding`, writes through a service that speaks SQL, and leaves its
 * evidence in `grids.workflow_step_runs` — three couplings that live in string
 * keys and SQL template literals, and every one of them fails silently. So the
 * plan, the run row and the grants are real, `processWorkflowRun` is the same
 * entry point the job uses, and the assertions are about rows.
 */
import { beforeAll, describe, expect } from "bun:test";
import type { WorkflowBoundPlan, WorkflowIrStep, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { workflowActionDescriptors } from "@valentinkolb/cloud/workflows/store";
import { redis, sql } from "bun";
import { postgresTest, testShortId as shortId, testUuid as uuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { GRIDS_WORKFLOW_ACTIONS } from "../workflows";
import { processWorkflowRun } from "./workflow-kernel-runtime";
import { insertTestWorkflow } from "./workflow-test-fixture";

type Fixture = {
  actorId: string;
  baseId: string;
  tableId: string;
  nameFieldId: string;
  statusFieldId: string;
  recordId: string;
  emailTemplateId: string;
  documentTemplateId: string;
  workflowId: string;
};

const createFixture = (): Fixture => ({
  actorId: uuid(),
  baseId: uuid(),
  tableId: uuid(),
  nameFieldId: uuid(),
  statusFieldId: uuid(),
  recordId: uuid(),
  emailTemplateId: uuid(),
  documentTemplateId: uuid(),
  workflowId: uuid(),
});

const insertFixture = async (fixture: Fixture): Promise<void> => {
  await sql`
    INSERT INTO auth.users (id, uid, provider, profile, display_name, given_name, sn)
    VALUES (${fixture.actorId}::uuid, ${`workflow-action-${fixture.actorId}`}, 'local', 'user', 'Workflow Actor', 'Workflow', 'Actor')
  `;
  await sql`
    INSERT INTO grids.bases (id, short_id, name, created_by)
    VALUES (${fixture.baseId}::uuid, ${shortId("B")}, 'Workflow actions integration', ${fixture.actorId}::uuid)
  `;
  await sql`
    INSERT INTO grids.tables (id, short_id, base_id, name, position)
    VALUES (${fixture.tableId}::uuid, ${shortId("T")}, ${fixture.baseId}::uuid, 'Tasks', 0)
  `;
  await sql`
    INSERT INTO grids.fields (id, short_id, table_id, name, type, config, position)
    VALUES
      (${fixture.nameFieldId}::uuid, ${shortId("F")}, ${fixture.tableId}::uuid, 'Name', 'text', '{}'::jsonb, 0),
      (${fixture.statusFieldId}::uuid, ${shortId("F")}, ${fixture.tableId}::uuid, 'Status', 'text', '{}'::jsonb, 1)
  `;
  await sql`
    INSERT INTO grids.records (id, table_id, data, created_by, updated_by)
    VALUES (
      ${fixture.recordId}::uuid,
      ${fixture.tableId}::uuid,
      ${{ [fixture.nameFieldId]: "Draft task", [fixture.statusFieldId]: "Open" }}::jsonb,
      ${fixture.actorId}::uuid,
      ${fixture.actorId}::uuid
    )
  `;
  await sql`
    INSERT INTO grids.email_templates (id, short_id, base_id, name, subject, html, created_by, updated_by)
    VALUES (
      ${fixture.emailTemplateId}::uuid, ${shortId("E")}, ${fixture.baseId}::uuid, 'Task notice',
      'Task update', '<p>A task changed.</p>', ${fixture.actorId}::uuid, ${fixture.actorId}::uuid
    )
  `;
  await sql`
    INSERT INTO grids.document_templates (id, short_id, table_id, name, source, html, created_by, updated_by)
    VALUES (
      ${fixture.documentTemplateId}::uuid, ${shortId("D")}, ${fixture.tableId}::uuid, 'Task sheet',
      ${`from table {${fixture.tableId}} limit 1`}, '<p>Task</p>', ${fixture.actorId}::uuid, ${fixture.actorId}::uuid
    )
  `;
  // Without this the actions are all correct to refuse, and every assertion
  // below would pass for the wrong reason.
  const [access] = await sql<Array<{ id: string }>>`
    INSERT INTO auth.access (user_id, permission) VALUES (${fixture.actorId}::uuid, 'write') RETURNING id::text AS id
  `;
  if (!access) throw new Error("Workflow action fixture could not grant base access");
  await sql`INSERT INTO grids.base_access (base_id, access_id) VALUES (${fixture.baseId}::uuid, ${access.id}::uuid)`;
  await insertTestWorkflow({
    id: fixture.workflowId,
    shortId: shortId("W"),
    baseId: fixture.baseId,
    name: "Task workflow",
    source: "steps: []",
    enabled: true,
    ownerUserId: fixture.actorId,
  });
};

const cleanupFixture = async (fixture: Fixture): Promise<void> => {
  await sql`DELETE FROM grids.audit_log WHERE base_id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
  await sql`DELETE FROM workflows.workflow WHERE id = ${fixture.workflowId}::uuid`;
  await sql`DELETE FROM auth.access WHERE user_id = ${fixture.actorId}::uuid`;
  await sql`DELETE FROM auth.users WHERE id = ${fixture.actorId}::uuid`;
};

const hash = (seed: string): string => new Bun.CryptoHasher("sha256").update(seed).digest("hex");

/**
 * The policies the compiler would bind, derived from the declarations rather
 * than restated — a plan whose policy disagrees with the action's effect class
 * would test a runtime nobody ships.
 */
const ACTION_POLICIES = Object.fromEntries(
  workflowActionDescriptors(GRIDS_WORKFLOW_ACTIONS).map((descriptor) => [
    descriptor.kind,
    { effect: descriptor.effect, dryRun: descriptor.dryRun },
  ]),
);

const actionStep = (index: number, action: string, config: Record<string, WorkflowJsonValue>): WorkflowIrStep => ({
  kind: "action",
  action,
  config,
  sourcePath: ["steps", index],
});

const boundPlan = (steps: WorkflowIrStep[], bindings: Record<string, WorkflowJsonValue>): WorkflowBoundPlan => ({
  schemaVersion: 2,
  languageId: "grids",
  languageVersion: 1,
  sourceHash: hash("workflow-actions-integration"),
  manifestHash: hash("workflow-actions-manifest"),
  catalogHash: hash("workflow-actions-catalog"),
  actionPolicies: ACTION_POLICIES,
  inputs: [],
  triggers: [],
  steps,
  bindings,
});

type QueuedRun = {
  plan: WorkflowBoundPlan;
  mode?: "execute" | "dryRun";
  inputs?: Record<string, WorkflowJsonValue>;
};

/** A run row exactly as `materializeWorkflowInvocation` leaves one, ready to claim. */
const queueRun = async (fixture: Fixture, input: QueuedRun): Promise<string> => {
  const runId = uuid();
  await sql`
    INSERT INTO grids.workflow_runs (
      id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key, request_fingerprint,
      actor_user_id, authorization_snapshot, inputs, context, workflow_plan, status, occurred_at
    ) VALUES (
      ${runId}::uuid, ${fixture.workflowId}::uuid, ${fixture.baseId}::uuid, 1, ${input.mode ?? "execute"}, 'api',
      ${runId}, ${runId}, ${fixture.actorId}::uuid, '{"kind":"workflow"}'::jsonb,
      ${input.inputs ?? {}}::jsonb, '{}'::jsonb, ${input.plan}::jsonb, 'queued', now()
    )
  `;
  return runId;
};

const recordData = async (recordId: string): Promise<Record<string, unknown>> => {
  const [row] = await sql<Array<{ data: Record<string, unknown> }>>`
    SELECT data FROM grids.records WHERE id = ${recordId}::uuid
  `;
  if (!row) throw new Error(`Record ${recordId} is missing`);
  return row.data;
};

type StepRow = {
  step_key: string;
  status: string;
  outcome: { state?: string; output?: WorkflowJsonValue; error?: { code?: string } } | null;
  effect_state: string | null;
  effect_output: WorkflowJsonValue;
};

const stepRuns = (runId: string): Promise<StepRow[]> => sql<StepRow[]>`
  SELECT step_key, status, outcome, effect_state, effect_output
  FROM grids.workflow_step_runs
  WHERE run_id = ${runId}::uuid
  ORDER BY step_key
`;

const runRow = async (runId: string): Promise<{ status: string; result: WorkflowJsonValue; error: { code?: string } | null }> => {
  const [row] = await sql<Array<{ status: string; result: WorkflowJsonValue; error: { code?: string } | null }>>`
    SELECT status, result, error FROM grids.workflow_runs WHERE id = ${runId}::uuid
  `;
  if (!row) throw new Error(`Workflow run ${runId} is missing`);
  return row;
};

/** Re-opens a finished run and its steps the way a crash-resumed attempt finds them. */
const reopenForReplay = async (runId: string): Promise<void> => {
  await sql`
    UPDATE grids.workflow_runs
    SET status = 'queued', result = NULL, error = NULL, result_message = NULL, finished_at = NULL, lease_expires_at = NULL
    WHERE id = ${runId}::uuid
  `;
  // The effect columns stay: the journal's record of what already happened is
  // precisely what the replay has to consult instead of acting again.
  await sql`
    UPDATE grids.workflow_step_runs
    SET status = 'running', outcome = NULL, finished_at = NULL
    WHERE run_id = ${runId}::uuid
  `;
};

/** The store's own cache keys, the shape `services/settings/store.ts` reads. */
const ALLOW_PRIVATE_CACHE_KEY = "settings:grids.http_request_allow_private_networks";
const ALLOWED_HOSTS_CACHE_KEY = "settings:grids.http_request_allowed_hosts";

/**
 * Lets the HTTP action reach a loopback test server.
 *
 * The client refuses loopback targets unless an operator opted in, and it reads
 * that opt-in from the shared settings store — with no injectable seam on the
 * path `httpRequest` actually takes. So the value is placed in the store's own
 * Redis cache-aside layer, which `readKey` consults first, rather than written
 * to `settings.entries`: a persisted write would silently replace whatever
 * network policy the developer configured on this machine, and encrypting one
 * would need APP_SECRET besides. Deleting the cache keys afterwards puts every
 * reader straight back on the real resolution path.
 */
const withLoopbackHttpAllowed = async <T>(host: string, body: () => Promise<T>): Promise<T> => {
  await redis.set(ALLOW_PRIVATE_CACHE_KEY, JSON.stringify(true), "EX", 60);
  await redis.set(ALLOWED_HOSTS_CACHE_KEY, JSON.stringify([host]), "EX", 60);
  try {
    return await body();
  } finally {
    await redis.del(ALLOW_PRIVATE_CACHE_KEY);
    await redis.del(ALLOWED_HOSTS_CACHE_KEY);
  }
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

describe("declared Grids workflow actions", () => {
  postgresTest("updateRecord writes under the bound field id and journals the effect it committed", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        plan: boundPlan([actionStep(0, "updateRecord", { record: "inputs.record", set: { Status: "Approved" } })], {
          "steps.0.updateRecord.set.Status": fixture.statusFieldId,
        }),
        inputs: { record: { kind: "record", tableId: fixture.tableId, recordId: fixture.recordId } },
      });

      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "succeeded" });

      const data = await recordData(fixture.recordId);
      expect(data[fixture.statusFieldId]).toBe("Approved");
      // The source wrote "Status"; publishing froze which field that was. A
      // value stored under the written name would be invisible to every reader.
      expect(data.Status).toBeUndefined();
      expect(data[fixture.nameFieldId]).toBe("Draft task");

      const [step] = await stepRuns(runId);
      expect(step).toMatchObject({ step_key: "steps.0", status: "succeeded", effect_state: "succeeded" });
      expect(step?.effect_output).toEqual({ kind: "record", tableId: fixture.tableId, recordId: fixture.recordId });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("a replay returns the recorded outcome instead of writing the record a second time", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        plan: boundPlan([actionStep(0, "updateRecord", { record: "inputs.record", set: { Status: "Approved" } })], {
          "steps.0.updateRecord.set.Status": fixture.statusFieldId,
        }),
        inputs: { record: { kind: "record", tableId: fixture.tableId, recordId: fixture.recordId } },
      });
      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "succeeded" });

      await reopenForReplay(runId);
      // Somebody moved the record on after the first attempt committed. A second
      // write would silently undo that edit.
      await sql`
        UPDATE grids.records
        SET data = jsonb_set(data, ARRAY[${fixture.statusFieldId}], '"Reopened by a person"'::jsonb)
        WHERE id = ${fixture.recordId}::uuid
      `;

      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "succeeded" });
      expect((await recordData(fixture.recordId))[fixture.statusFieldId]).toBe("Reopened by a person");

      const [step] = await stepRuns(runId);
      expect(step?.outcome).toMatchObject({
        state: "completed",
        output: { kind: "record", tableId: fixture.tableId, recordId: fixture.recordId },
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("createRecord inserts the row and leaves an audit entry naming the run and the workflow", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        plan: boundPlan([actionStep(0, "createRecord", { table: "Tasks", values: { Name: "Created by a workflow" } })], {
          "steps.0.createRecord.table": fixture.tableId,
          "steps.0.createRecord.values.Name": fixture.nameFieldId,
        }),
      });

      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "succeeded" });

      const created = await sql<Array<{ id: string; data: Record<string, unknown> }>>`
        SELECT id::text AS id, data
        FROM grids.records
        WHERE table_id = ${fixture.tableId}::uuid AND id <> ${fixture.recordId}::uuid
      `;
      expect(created).toHaveLength(1);
      expect(created[0]?.data[fixture.nameFieldId]).toBe("Created by a workflow");

      const [entry] = await sql<
        Array<{ record_id: string; user_id: string; diff: { workflowRecordCreate: { new: Record<string, unknown> } } }>
      >`
        SELECT record_id::text AS record_id, user_id::text AS user_id, diff
        FROM grids.audit_log
        WHERE base_id = ${fixture.baseId}::uuid AND action = 'workflow.record.created'
      `;
      expect(entry).toMatchObject({ record_id: created[0]?.id, user_id: fixture.actorId });
      // Provenance is the whole point of the entry: a row written by a workflow
      // has to be traceable back to which run wrote it.
      expect(entry?.diff.workflowRecordCreate.new).toMatchObject({
        workflowRunId: runId,
        workflowId: fixture.workflowId,
        fields: [fixture.nameFieldId],
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("a grant revoked while the run was queued fails the step with FORBIDDEN and leaves the record alone", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        plan: boundPlan([actionStep(0, "updateRecord", { record: "inputs.record", set: { Status: "Approved" } })], {
          "steps.0.updateRecord.set.Status": fixture.statusFieldId,
        }),
        inputs: { record: { kind: "record", tableId: fixture.tableId, recordId: fixture.recordId } },
      });
      // A deny on the table itself: the run may still execute, so the refusal
      // has to come from the check the action makes at the moment of the write.
      const [denial] = await sql<Array<{ id: string }>>`
        INSERT INTO auth.access (user_id, permission) VALUES (${fixture.actorId}::uuid, 'none') RETURNING id::text AS id
      `;
      if (!denial) throw new Error("Workflow action fixture could not revoke table access");
      await sql`INSERT INTO grids.table_access (table_id, access_id) VALUES (${fixture.tableId}::uuid, ${denial.id}::uuid)`;

      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "failed" });
      expect((await runRow(runId)).error).toMatchObject({ code: "FORBIDDEN" });
      expect((await recordData(fixture.recordId))[fixture.statusFieldId]).toBe("Open");

      const [step] = await stepRuns(runId);
      expect(step).toMatchObject({ status: "failed", effect_state: null });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("httpRequest journals a 2xx as succeeded and fails the step on any other status", async () => {
    const fixture = createFixture();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => new Response("{}", { status: new URL(request.url).pathname === "/ok" ? 200 : 503 }),
    });
    try {
      await insertFixture(fixture);
      await withLoopbackHttpAllowed("127.0.0.1", async () => {
        const accepted = await queueRun(fixture, {
          plan: boundPlan([actionStep(0, "httpRequest", { url: `http://127.0.0.1:${server.port}/ok`, json: { ping: true } })], {}),
        });
        expect(await processWorkflowRun(accepted)).toEqual({ runId: accepted, status: "succeeded" });
        const [acceptedStep] = await stepRuns(accepted);
        // An ambiguous effect is marked before it acts and settled after; the
        // settled state is the only thing that keeps a replay from re-sending.
        expect(acceptedStep).toMatchObject({ status: "succeeded", effect_state: "succeeded" });
        expect(acceptedStep?.outcome?.output).toMatchObject({ status: 200, ok: true });

        const refused = await queueRun(fixture, {
          plan: boundPlan([actionStep(0, "httpRequest", { url: `http://127.0.0.1:${server.port}/boom`, json: { ping: true } })], {}),
        });
        expect(await processWorkflowRun(refused)).toEqual({ runId: refused, status: "failed" });
        expect((await runRow(refused)).error).toMatchObject({ code: "WORKFLOW_HTTP_FAILED" });
        const [refusedStep] = await stepRuns(refused);
        expect(refusedStep).toMatchObject({ status: "failed", effect_state: "failed" });
      });
    } finally {
      server.stop(true);
      await cleanupFixture(fixture);
    }
  });

  postgresTest("a dry run plans a create-then-send without inserting a record or queuing a delivery", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        mode: "dryRun",
        plan: boundPlan(
          [
            actionStep(0, "createRecord", { table: "Tasks", values: { Name: "Planned only" } }),
            actionStep(1, "sendEmail", { template: "Task notice", to: [{ email: "someone@example.com" }] }),
          ],
          {
            "steps.0.createRecord.table": fixture.tableId,
            "steps.0.createRecord.values.Name": fixture.nameFieldId,
            "steps.1.sendEmail.template": fixture.emailTemplateId,
          },
        ),
      });

      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "succeeded" });

      const [{ records = 0 } = {}] = await sql<Array<{ records: number }>>`
        SELECT count(*)::int AS records FROM grids.records WHERE table_id = ${fixture.tableId}::uuid
      `;
      expect(records).toBe(1);
      const [{ deliveries = 0 } = {}] = await sql<Array<{ deliveries: number }>>`
        SELECT count(*)::int AS deliveries FROM grids.workflow_email_deliveries WHERE workflow_run_id = ${runId}::uuid
      `;
      expect(deliveries).toBe(0);

      const steps = await stepRuns(runId);
      expect(steps.map((step) => step.status)).toEqual(["succeeded", "succeeded"]);
      // Marked planned so a later step can tell this from a real record. Without
      // the flag the next action would act on a row id that has no row.
      expect(steps[0]?.outcome).toMatchObject({
        state: "planned",
        output: { kind: "record", tableId: fixture.tableId, recordId: "dry-run:steps.0", planned: true },
      });
      expect(JSON.stringify((await runRow(runId)).result)).toContain('Send \\"Task notice\\" to 1 recipient(s)');
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("a dry run links a document that only exists as a plan, without generating or persisting one", async () => {
    const fixture = createFixture();
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        mode: "dryRun",
        plan: boundPlan(
          [
            actionStep(0, "generateDocument", { template: "Task sheet", record: "inputs.record", saveAs: "sheet" }),
            actionStep(1, "createDocumentLink", { document: "sheet", expiresIn: "7d" }),
          ],
          // `document` is a reference to an earlier step's output, not a name
          // the compiler pinned — so only the template is bound.
          { "steps.0.generateDocument.template": fixture.documentTemplateId },
        ),
        inputs: { record: { kind: "record", tableId: fixture.tableId, recordId: fixture.recordId } },
      });

      expect(await processWorkflowRun(runId)).toEqual({ runId, status: "succeeded" });

      const [{ runs = 0 } = {}] = await sql<Array<{ runs: number }>>`
        SELECT count(*)::int AS runs FROM grids.document_runs WHERE base_id = ${fixture.baseId}::uuid
      `;
      expect(runs).toBe(0);

      const steps = await stepRuns(runId);
      // "Generate then link" has to stay a plannable pair: the second step
      // resolves the placeholder the first one planned, so a dry run does not
      // dead-end at the first step that has not really run.
      expect(steps[0]?.outcome).toMatchObject({ state: "planned", output: { kind: "documentRun", planned: true } });
      expect(steps[1]?.outcome).toMatchObject({ state: "planned", output: { kind: "documentLink", expiresIn: "7d", planned: true } });
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
