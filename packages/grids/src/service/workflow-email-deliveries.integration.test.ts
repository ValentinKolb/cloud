import { beforeAll, describe, expect, test } from "bun:test";
import { sql } from "bun";
import { migrate } from "../migrate";
import { backfillWorkflowEmailDeliveries } from "../workflow-email-delivery-backfill";
import { recordWorkflowEmailDelivery } from "./workflow-email-deliveries";
import { listEmailDeliveriesPage } from "./workflows";

const postgresTest = process.env.GRIDS_QUERY_DSL_DB_TEST === "1" ? test : test.skip;

const uuid = () => Bun.randomUUIDv7();
const shortId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 5);

type DeliveryFixture = {
  baseId: string;
  workflowId: string;
  otherWorkflowId: string;
  runId: string;
  otherRunId: string;
  templateId: string;
};

const insertFixture = async (): Promise<DeliveryFixture> => {
  const baseId = uuid();
  const workflowId = uuid();
  const otherWorkflowId = uuid();
  const runId = uuid();
  const otherRunId = uuid();
  const templateId = uuid();

  await sql`
    INSERT INTO grids.bases (id, short_id, name)
    VALUES (${baseId}::uuid, ${shortId("B")}, 'Workflow email delivery integration')
  `;
  await sql`
    INSERT INTO grids.workflows (id, short_id, base_id, name, source, compiled, enabled)
    VALUES
      (${workflowId}::uuid, ${shortId("W")}, ${baseId}::uuid, 'Notify customer', 'steps: []', '{}'::jsonb, TRUE),
      (${otherWorkflowId}::uuid, ${shortId("W")}, ${baseId}::uuid, 'Notify operator', 'steps: []', '{}'::jsonb, TRUE)
  `;
  await sql`
    INSERT INTO grids.workflow_runs (id, workflow_id, base_id, trigger_kind, status)
    VALUES
      (${runId}::uuid, ${workflowId}::uuid, ${baseId}::uuid, 'form', 'running'),
      (${otherRunId}::uuid, ${otherWorkflowId}::uuid, ${baseId}::uuid, 'form', 'running')
  `;
  await sql`
    INSERT INTO grids.email_templates (id, short_id, base_id, name, subject, html)
    VALUES (${templateId}::uuid, ${shortId("E")}, ${baseId}::uuid, 'Delivery status', 'Status', '<p>Status</p>')
  `;

  return { baseId, workflowId, otherWorkflowId, runId, otherRunId, templateId };
};

beforeAll(async () => {
  if (process.env.GRIDS_QUERY_DSL_DB_TEST === "1") await migrate();
});

describe("workflow email deliveries integration", () => {
  postgresTest("lists per-recipient partial delivery results with keyset pagination", async () => {
    const fixture = await insertFixture();
    try {
      const sent = await recordWorkflowEmailDelivery({
        baseId: fixture.baseId,
        workflowId: fixture.workflowId,
        workflowRunId: fixture.runId,
        templateId: fixture.templateId,
        recipientKind: "email",
        recipientSummary: "cu***@example.com",
        notificationId: uuid(),
        providerStatus: "sent",
        status: "sent",
        subject: "Your order",
      });
      const failed = await recordWorkflowEmailDelivery({
        baseId: fixture.baseId,
        workflowId: fixture.workflowId,
        workflowRunId: fixture.runId,
        templateId: fixture.templateId,
        recipientKind: "user",
        recipientSummary: `user:${uuid()}`,
        providerStatus: "error",
        status: "failed",
        subject: "Your order",
        error: "mailbox unavailable",
      });
      await sql`
        UPDATE grids.workflow_email_deliveries
        SET created_at = '2026-07-11T12:00:00.123456Z'::timestamptz
        WHERE id IN (${sent.id}::uuid, ${failed.id}::uuid)
      `;
      await recordWorkflowEmailDelivery({
        baseId: fixture.baseId,
        workflowId: fixture.otherWorkflowId,
        workflowRunId: fixture.otherRunId,
        templateId: fixture.templateId,
        recipientKind: "email",
        recipientSummary: "op***@example.com",
        providerStatus: "sent",
        status: "sent",
        subject: "Operator update",
      });

      const firstPage = await listEmailDeliveriesPage({
        baseId: fixture.baseId,
        workflowIds: [fixture.workflowId, fixture.otherWorkflowId],
        workflowId: fixture.workflowId,
        limit: 1,
      });
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).toBeTruthy();

      const secondPage = await listEmailDeliveriesPage({
        baseId: fixture.baseId,
        workflowIds: [fixture.workflowId, fixture.otherWorkflowId],
        workflowId: fixture.workflowId,
        cursor: firstPage.nextCursor,
        limit: 1,
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();

      const deliveries = [...firstPage.items, ...secondPage.items];
      expect(new Set(deliveries.map((item) => item.id))).toEqual(new Set([sent.id, failed.id]));
      expect(deliveries.map((item) => item.status).sort()).toEqual(["failed", "sent"]);
      expect(deliveries.find((item) => item.status === "failed")?.error).toBe("mailbox unavailable");
      expect(deliveries.every((item) => item.recipients.length === 1)).toBe(true);
      expect(deliveries.some((item) => item.recipients[0]?.notificationId === sent.recipients[0]?.notificationId)).toBe(true);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
    }
  });

  postgresTest("backfills legacy audit deliveries once", async () => {
    const fixture = await insertFixture();
    try {
      const sentNotificationId = uuid();
      await sql`
        INSERT INTO grids.audit_log (base_id, action, diff)
        VALUES
          (
            ${fixture.baseId}::uuid,
            'workflow.email.sent',
            ${{
              workflowEmail: {
                old: null,
                new: {
                  workflowId: fixture.workflowId,
                  workflowRunId: fixture.runId,
                  templateId: fixture.templateId,
                  subject: "Legacy notice",
                  recipients: [
                    { kind: "email", recipient: "le***@example.com", notificationId: sentNotificationId, status: "sent" },
                    { kind: "user", recipient: `user:${uuid()}`, status: "sent" },
                  ],
                },
              },
            }}::jsonb
          ),
          (
            ${fixture.baseId}::uuid,
            'workflow.email.failed',
            ${{
              workflowEmail: {
                old: null,
                new: {
                  workflowId: fixture.workflowId,
                  workflowRunId: fixture.runId,
                  templateId: fixture.templateId,
                  recipient: "fa***@example.com",
                  error: "legacy failure",
                },
              },
            }}::jsonb
          )
      `;

      await backfillWorkflowEmailDeliveries();
      await backfillWorkflowEmailDeliveries();
      const page = await listEmailDeliveriesPage({
        baseId: fixture.baseId,
        workflowIds: [fixture.workflowId],
        workflowId: fixture.workflowId,
      });
      expect(page.items).toHaveLength(3);
      expect(page.items.map((item) => item.status).sort()).toEqual(["failed", "sent", "sent"]);
      expect(page.items.find((item) => item.status === "failed")?.error).toBe("legacy failure");
      expect(page.items.some((item) => item.recipients[0]?.notificationId === sentNotificationId)).toBe(true);
    } finally {
      await sql`DELETE FROM grids.bases WHERE id = ${fixture.baseId}::uuid`;
    }
  });
});
