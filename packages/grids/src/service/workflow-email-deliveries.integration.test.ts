import { beforeAll, describe, expect } from "bun:test";
import { sql } from "bun";
import { postgresTest, testShortId, testUuid } from "../integration-test-utils";
import { migrate } from "../migrate";
import {
  finishWorkflowEmailDeliveryIntent,
  getOrCreateWorkflowEmailDeliveryIntent,
  getWorkflowEmailDeliveryIntent,
} from "./workflow-email-deliveries";

type Fixture = {
  baseId: string;
  workflowId: string;
  runId: string;
  stepRunId: string;
  templateId: string;
};

beforeAll(async () => {
  if (process.env.GRIDS_DB_TEST === "1") await migrate();
});

const insertFixture = async (): Promise<Fixture> => {
  const baseId = testUuid();
  const workflowId = testUuid();
  const runId = testUuid();
  const stepRunId = testUuid();
  const templateId = testUuid();

  await sql`INSERT INTO grids.bases (id, short_id, name) VALUES (${baseId}::uuid, ${testShortId("B")}, 'Email delivery')`;
  await sql`
    INSERT INTO grids.workflows (id, short_id, base_id, name, source, plan)
    VALUES (${workflowId}::uuid, ${testShortId("W")}, ${baseId}::uuid, 'Notify', 'steps: []', '{}'::jsonb)
  `;
  await sql`
    INSERT INTO grids.workflow_runs (
      id, workflow_id, base_id, workflow_revision, mode, channel, idempotency_key,
      request_fingerprint, workflow_plan, status, occurred_at
    ) VALUES (
      ${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 1, 'execute', 'api', ${`run-${runId}`},
      'fingerprint', '{}'::jsonb, 'running', now()
    )
  `;
  await sql`
    INSERT INTO grids.workflow_step_runs (
      id, run_id, step_key, source_path, kind, action, mode, status, execution_generation
    ) VALUES (${stepRunId}::uuid, ${runId}::uuid, 'notify', '[]'::jsonb, 'action', 'sendEmail', 'execute', 'running', 0)
  `;
  await sql`
    INSERT INTO grids.email_templates (id, short_id, base_id, name, subject, html)
    VALUES (${templateId}::uuid, ${testShortId("E")}, ${baseId}::uuid, 'Notice', 'Subject', '<p>Private</p>')
  `;
  return { baseId, workflowId, runId, stepRunId, templateId };
};

const intentInput = (fixture: Fixture, overrides: Partial<{ recipientIndex: number; idempotencyKey: string; subject: string }> = {}) => ({
  baseId: fixture.baseId,
  workflowId: fixture.workflowId,
  workflowRunId: fixture.runId,
  workflowStepRunId: fixture.stepRunId,
  templateId: fixture.templateId,
  recipientIndex: overrides.recipientIndex ?? 1,
  recipientKind: "email" as const,
  recipientValue: "private@example.test",
  recipientSummary: "p…@example.test",
  idempotencyKey: overrides.idempotencyKey ?? `delivery-${fixture.runId}`,
  subject: overrides.subject ?? "Private subject",
  renderedHtml: "<p>Private body</p>",
});

describe("workflow email delivery intents integration", () => {
  postgresTest("replays identical intent creation and rejects conflicting reuse", async () => {
    const fixture = await insertFixture();
    try {
      const input = intentInput(fixture);
      const created = await getOrCreateWorkflowEmailDeliveryIntent(input);
      const replayed = await getOrCreateWorkflowEmailDeliveryIntent(input);
      expect(replayed).toEqual(created);
      expect(created).toMatchObject({ status: "pending", recipientValue: "private@example.test", renderedHtml: "<p>Private body</p>" });
      expect(await getWorkflowEmailDeliveryIntent(fixture.stepRunId, 1)).toEqual(created);
      expect(await getWorkflowEmailDeliveryIntent(fixture.stepRunId, 2)).toBeNull();

      await expect(getOrCreateWorkflowEmailDeliveryIntent(intentInput(fixture, { subject: "Changed subject" }))).rejects.toThrow(
        "does not match the interrupted step",
      );
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
    }
  });

  postgresTest("allows only one terminal transition and scrubs rendered recipient data", async () => {
    const fixture = await insertFixture();
    try {
      const created = await getOrCreateWorkflowEmailDeliveryIntent(intentInput(fixture));
      const finished = await finishWorkflowEmailDeliveryIntent(created.id, {
        notificationId: null,
        providerStatus: "accepted",
        status: "sent",
      });
      expect(finished.transitioned).toBe(true);
      expect(finished.delivery).toMatchObject({ status: "sent", recipientValue: null, renderedHtml: null, providerStatus: "accepted" });

      const repeated = await finishWorkflowEmailDeliveryIntent(created.id, {
        notificationId: null,
        providerStatus: "rejected",
        status: "failed",
        error: "must not replace terminal state",
      });
      expect(repeated.transitioned).toBe(false);
      expect(repeated.delivery).toMatchObject({ status: "sent", providerStatus: "accepted", error: null });

      const [stored] = await sql<Array<{ recipient_value: string | null; rendered_html: string | null }>>`
        SELECT recipient_value, rendered_html FROM grids.workflow_email_deliveries WHERE id = ${created.id}::uuid
      `;
      expect(stored).toEqual({ recipient_value: null, rendered_html: null });
      await expect(
        finishWorkflowEmailDeliveryIntent(testUuid(), { notificationId: null, providerStatus: "missing", status: "failed" }),
      ).rejects.toThrow("not found");
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
    }
  });

  postgresTest("deduplicates concurrent creates by idempotency key", async () => {
    const fixture = await insertFixture();
    try {
      const input = intentInput(fixture);
      const deliveries = await Promise.all([getOrCreateWorkflowEmailDeliveryIntent(input), getOrCreateWorkflowEmailDeliveryIntent(input)]);
      expect(deliveries[0]?.id).toBe(deliveries[1]?.id);
      const [{ count } = { count: 0 }] = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM grids.workflow_email_deliveries WHERE idempotency_key = ${input.idempotencyKey}
      `;
      expect(count).toBe(1);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
    }
  });
});
