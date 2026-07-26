/**
 * The six declared Grids actions, driven the way the runtime drives them.
 *
 * Nothing here is checkable by the type system. An action names a field with
 * `ctx.binding`, writes through a service that speaks SQL, and leaves its
 * evidence in `workflows.step_outcome` — three couplings that live in string
 * keys and SQL template literals, and every one of them fails silently. So the
 * plan, the run and the grants are real, the run is carried by the worker's own
 * ports, and the assertions are about rows.
 */
import { beforeAll, describe, expect } from "bun:test";
import type { WorkflowBoundPlan, WorkflowIrStep, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { createWorkflowRun, workflowActionDescriptors } from "@valentinkolb/cloud/workflows/store";
import { sql } from "bun";
import { postgresTest, testShortId as shortId, testUuid as uuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import { GRIDS_WORKFLOW_ACTIONS } from "../workflows";
import type { GridsWorkflowPrincipal } from "../workflows/contracts";
import { dryRunGridsWorkflowRun, runGridsWorkflowRun } from "./workflow-runtime";
import { GRIDS_APP_ID, gridsAuthorizationSnapshot } from "./workflow-runs";
import { deleteTestWorkflowScope, insertTestWorkflow, publishTestWorkflowVersion } from "./workflow-test-fixture";

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
  await deleteTestWorkflowScope(fixture.baseId);
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

/**
 * A run exactly as `startWorkflowRun` leaves one, ready to claim.
 *
 * Two rows, because that is what a Grids run is now: the kernel's, pinned to a
 * published version so the plan cannot drift under it, and the profile that
 * says which base and which button it belongs to. The authorization snapshot is
 * built by the same helper the service uses — every declared action reads its
 * actor back out of it.
 */
const queueRun = async (fixture: Fixture, input: QueuedRun): Promise<string> => {
  const revision = await publishTestWorkflowVersion(fixture.workflowId, `steps: [] # ${uuid()}`, input.plan);
  const [version] = await sql<Array<{ id: string }>>`
    SELECT id::text AS id FROM workflows.version
    WHERE workflow_id = ${fixture.workflowId}::uuid AND revision = ${revision}
  `;
  if (!version) throw new Error("Workflow action fixture could not publish a version");

  const principal: GridsWorkflowPrincipal = { userId: fixture.actorId, groupIds: [], serviceAccountId: null };
  const runId = await createWorkflowRun({
    appId: GRIDS_APP_ID,
    scopeId: fixture.baseId,
    workflowId: fixture.workflowId,
    workflowVersionId: version.id,
    mode: input.mode ?? "execute",
    inputs: input.inputs ?? {},
    context: {},
    authorization: gridsAuthorizationSnapshot(principal, { kind: "workflow" }, null) as unknown as WorkflowJsonValue,
    idempotencyKey: uuid(),
    occurredAt: new Date(),
  });
  await sql`
    INSERT INTO grids.workflow_run_profile (run_id, base_id, workflow_id, channel, actor_user_id, request_fingerprint)
    VALUES (${runId}::uuid, ${fixture.baseId}::uuid, ${fixture.workflowId}::uuid, 'api', ${fixture.actorId}::uuid, ${runId})
  `;
  return runId;
};

/**
 * Carries one run to its outcome and answers with the state it settled in.
 *
 * The same two entry points the worker drives, so an action that only works
 * under a port this test invented would fail here rather than in production.
 */
const drive = async (runId: string, mode: "execute" | "dryRun" = "execute"): Promise<string> => {
  const outcome = mode === "execute" ? await runGridsWorkflowRun(runId) : await dryRunGridsWorkflowRun(runId);
  if (outcome.state !== "finished") throw new Error(`Workflow run ${runId} did not finish: ${outcome.state}`);
  return (await runRow(runId)).state;
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
  state: string;
  outcome: { state?: string; output?: WorkflowJsonValue; error?: { code?: string } } | null;
  effect_state: string | null;
  effect_output: WorkflowJsonValue;
};

// The journal stores the pair the executor hands it, so that a restored step
// knows which of the two outcome shapes it has. Every assertion below is about
// the outcome itself, which is also what a run view is given.
const stepRuns = (runId: string): Promise<StepRow[]> => sql<StepRow[]>`
  SELECT step_key, state, outcome -> 'outcome' AS outcome, effect_state, effect_output
  FROM workflows.step_outcome
  WHERE run_id = ${runId}::uuid
  ORDER BY step_key
`;

const runRow = async (runId: string): Promise<{ state: string; result: WorkflowJsonValue; error: { code?: string } | null }> => {
  const [row] = await sql<Array<{ state: string; result: WorkflowJsonValue; error: { code?: string } | null }>>`
    SELECT state, result, error FROM workflows.run WHERE id = ${runId}::uuid
  `;
  if (!row) throw new Error(`Workflow run ${runId} is missing`);
  return row;
};

/** Re-opens a finished run and its steps the way a crash-resumed attempt finds them. */
const reopenForReplay = async (runId: string): Promise<void> => {
  await sql`
    UPDATE workflows.run
    SET state = 'queued', result = NULL, error = NULL, result_message = NULL, finished_at = NULL,
        lease_owner = NULL, lease_expires_at = NULL, retry_after = NULL
    WHERE id = ${runId}::uuid
  `;
  // The effect columns stay: the journal's record of what already happened is
  // precisely what the replay has to consult instead of acting again.
  await sql`
    UPDATE workflows.step_outcome
    SET state = 'running', outcome = NULL, finished_at = NULL
    WHERE run_id = ${runId}::uuid
  `;
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

      expect(await drive(runId)).toBe("succeeded");

      const data = await recordData(fixture.recordId);
      expect(data[fixture.statusFieldId]).toBe("Approved");
      // The source wrote "Status"; publishing froze which field that was. A
      // value stored under the written name would be invisible to every reader.
      expect(data.Status).toBeUndefined();
      expect(data[fixture.nameFieldId]).toBe("Draft task");

      const [step] = await stepRuns(runId);
      expect(step).toMatchObject({ step_key: "steps.0", state: "completed", effect_state: "succeeded" });
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
      expect(await drive(runId)).toBe("succeeded");

      await reopenForReplay(runId);
      // Somebody moved the record on after the first attempt committed. A second
      // write would silently undo that edit.
      await sql`
        UPDATE grids.records
        SET data = jsonb_set(data, ARRAY[${fixture.statusFieldId}], '"Reopened by a person"'::jsonb)
        WHERE id = ${fixture.recordId}::uuid
      `;

      expect(await drive(runId)).toBe("succeeded");
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

      expect(await drive(runId)).toBe("succeeded");

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

      expect(await drive(runId)).toBe("failed");
      expect((await runRow(runId)).error).toMatchObject({ code: "FORBIDDEN" });
      expect((await recordData(fixture.recordId))[fixture.statusFieldId]).toBe("Open");

      const [step] = await stepRuns(runId);
      expect(step).toMatchObject({ state: "failed", effect_state: null });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  postgresTest("httpRequest refuses the private side of the network, and says so on the step", async () => {
    const fixture = createFixture();
    // A workflow author has the app's permissions, not the server's network
    // position. This server is reachable from inside the container and from
    // nowhere the author could reach on their own — which is the whole point.
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("{}") });
    try {
      await insertFixture(fixture);
      const runId = await queueRun(fixture, {
        plan: boundPlan([actionStep(0, "httpRequest", { url: `http://127.0.0.1:${server.port}/ok`, json: { ping: true } })], {}),
      });

      expect(await drive(runId)).toBe("failed");
      expect((await runRow(runId)).error).toMatchObject({ code: "BAD_INPUT" });

      const [step] = await stepRuns(runId);
      // An ambiguous effect is marked before the action runs — the kernel cannot
      // know when a request actually leaves the process. So the refusal settles
      // that mark as failed rather than leaving it dangling for a human.
      expect(step).toMatchObject({ state: "failed", effect_state: "failed" });
      expect(step?.outcome).toMatchObject({ error: { message: "HTTP request target is not a public address" } });
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

      expect(await drive(runId, "dryRun")).toBe("succeeded");

      const [{ records = 0 } = {}] = await sql<Array<{ records: number }>>`
        SELECT count(*)::int AS records FROM grids.records WHERE table_id = ${fixture.tableId}::uuid
      `;
      expect(records).toBe(1);
      const [{ deliveries = 0 } = {}] = await sql<Array<{ deliveries: number }>>`
        SELECT count(*)::int AS deliveries FROM grids.workflow_email_deliveries WHERE workflow_run_id = ${runId}::uuid
      `;
      expect(deliveries).toBe(0);

      const steps = await stepRuns(runId);
      expect(steps.map((step) => step.state)).toEqual(["planned", "planned"]);
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

      expect(await drive(runId, "dryRun")).toBe("succeeded");

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
