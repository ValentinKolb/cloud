import { err } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { GridsWorkflowEmailDelivery as WorkflowEmailDelivery } from "../workflows/contracts";
import type { SqlClient } from "./audit";
import { workflowConflict } from "./workflow-errors";

type DeliveryStatus = "pending" | "sent" | "failed";

type DeliveryIntentInput = {
  baseId: string;
  workflowId: string;
  workflowRunId: string;
  workflowStepRunId: string;
  templateId: string;
  recipientIndex: number;
  recipientKind: "email" | "user";
  recipientValue: string;
  recipientSummary: string;
  idempotencyKey: string;
  subject: string;
  renderedHtml: string;
};

type DeliveryRow = {
  id: string;
  workflow_id: string | null;
  workflow_run_id: string | null;
  template_id: string | null;
  recipient_kind: "email" | "user";
  recipient_summary: string;
  notification_id: string | null;
  provider_status: string | null;
  status: DeliveryStatus;
  subject: string | null;
  error: string | null;
  created_at: Date | string;
  cursor_token: string;
};

export type WorkflowEmailDeliveryIntent = WorkflowEmailDelivery & {
  recipientValue: string | null;
  idempotencyKey: string;
  renderedHtml: string | null;
  providerStatus: string | null;
  notificationId: string | null;
};

const toIsoString = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const mapDelivery = (row: DeliveryRow): WorkflowEmailDelivery => ({
  id: row.id,
  workflowId: row.workflow_id,
  workflowRunId: row.workflow_run_id,
  templateId: row.template_id,
  subject: row.subject,
  recipients: [
    {
      kind: row.recipient_kind,
      recipient: row.recipient_summary,
      ...(row.notification_id ? { notificationId: row.notification_id } : {}),
      ...(row.provider_status ? { status: row.provider_status } : {}),
    },
  ],
  status: row.status,
  error: row.error,
  createdAt: toIsoString(row.created_at),
});

const mapIntent = (
  row: DeliveryRow & { recipient_value: string | null; idempotency_key: string; rendered_html: string | null },
): WorkflowEmailDeliveryIntent => ({
  ...mapDelivery(row),
  recipientValue: row.recipient_value,
  idempotencyKey: row.idempotency_key,
  renderedHtml: row.rendered_html,
  providerStatus: row.provider_status,
  notificationId: row.notification_id,
});

type DeliveryIntentRow = DeliveryRow & {
  recipient_value: string | null;
  idempotency_key: string;
  rendered_html: string | null;
};

const intentColumns = sql`
  id, workflow_id, workflow_run_id, template_id, recipient_kind, recipient_value, recipient_summary,
  notification_id, provider_status, status, subject, rendered_html, idempotency_key, error, created_at,
  (created_at::text || '|' || id::text) AS cursor_token
`;

export const getWorkflowEmailDeliveryIntent = async (
  workflowStepRunId: string,
  recipientIndex: number,
  client: SqlClient = sql,
): Promise<WorkflowEmailDeliveryIntent | null> => {
  const [row] = await client<DeliveryIntentRow[]>`
    SELECT ${intentColumns}
    FROM grids.workflow_email_deliveries
    WHERE workflow_step_run_id = ${workflowStepRunId}::uuid
      AND recipient_index = ${recipientIndex}
  `;
  return row ? mapIntent(row) : null;
};

export const getOrCreateWorkflowEmailDeliveryIntent = async (
  input: DeliveryIntentInput,
  client: SqlClient = sql,
): Promise<WorkflowEmailDeliveryIntent> => {
  const rows = await client<DeliveryIntentRow[]>`
    INSERT INTO grids.workflow_email_deliveries (
      base_id, workflow_id, workflow_run_id, workflow_step_run_id, template_id, recipient_index,
      recipient_kind, recipient_value, recipient_summary, idempotency_key, status, subject, rendered_html
    )
    VALUES (
      ${input.baseId}::uuid, ${input.workflowId}::uuid, ${input.workflowRunId}::uuid,
      ${input.workflowStepRunId}::uuid, ${input.templateId}::uuid, ${input.recipientIndex},
      ${input.recipientKind}, ${input.recipientValue}, ${input.recipientSummary}, ${input.idempotencyKey},
      'pending', ${input.subject}, ${input.renderedHtml}
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING ${intentColumns}
  `;
  const [row] = rows.length
    ? rows
    : await client<DeliveryIntentRow[]>`
        SELECT ${intentColumns}
        FROM grids.workflow_email_deliveries
        WHERE idempotency_key = ${input.idempotencyKey}
      `;
  if (!row) throw err.internal("workflow email delivery intent insert failed");
  if (
    row.workflow_run_id !== input.workflowRunId ||
    row.template_id !== input.templateId ||
    row.recipient_kind !== input.recipientKind ||
    row.recipient_value !== input.recipientValue ||
    row.subject !== input.subject ||
    row.rendered_html !== input.renderedHtml
  ) {
    throw workflowConflict("Workflow email delivery intent does not match the interrupted step.");
  }
  return mapIntent(row);
};

export const finishWorkflowEmailDeliveryIntent = async (
  deliveryId: string,
  input: { notificationId: string | null; providerStatus: string; status: "sent" | "failed"; error?: string | null },
  client: SqlClient = sql,
): Promise<{ delivery: WorkflowEmailDeliveryIntent; transitioned: boolean }> => {
  const [row] = await client<DeliveryIntentRow[]>`
    UPDATE grids.workflow_email_deliveries
    SET notification_id = COALESCE(notification_id, ${input.notificationId}::uuid),
        provider_status = ${input.providerStatus},
        status = ${input.status},
        error = ${input.error ?? null},
        recipient_value = NULL,
        rendered_html = NULL,
        updated_at = now()
    WHERE id = ${deliveryId}::uuid
      AND status = 'pending'
    RETURNING ${intentColumns}
  `;
  if (row) return { delivery: mapIntent(row), transitioned: true };
  const [existing] = await client<DeliveryIntentRow[]>`
    SELECT ${intentColumns}
    FROM grids.workflow_email_deliveries
    WHERE id = ${deliveryId}::uuid
  `;
  if (!existing) throw err.notFound("workflow email delivery intent");
  return { delivery: mapIntent(existing), transitioned: false };
};
