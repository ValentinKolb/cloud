import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { WorkflowEmailDelivery } from "../contracts";
import type { SqlClient } from "./audit";

type DeliveryStatus = "pending" | "sent" | "failed";

type RecordDeliveryInput = {
  baseId: string;
  workflowId: string;
  workflowRunId: string;
  templateId: string;
  recipientKind: "email" | "user";
  recipientSummary: string;
  notificationId?: string | null;
  providerStatus?: string | null;
  status: DeliveryStatus;
  subject: string;
  error?: string | null;
};

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

type ListDeliveriesParams = {
  baseId: string;
  workflowIds: string[];
  workflowId?: string | null;
  cursor?: { createdAt: string; id: string } | null;
  limit: number;
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

type WorkflowEmailDeliveryRow = {
  delivery: WorkflowEmailDelivery;
  cursor: string;
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
    throw err.conflict("workflow email delivery intent does not match the interrupted step");
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

export const recordWorkflowEmailDelivery = async (input: RecordDeliveryInput, client: SqlClient = sql): Promise<WorkflowEmailDelivery> => {
  const [row] = await client<DeliveryRow[]>`
    INSERT INTO grids.workflow_email_deliveries (
      base_id, workflow_id, workflow_run_id, template_id, recipient_kind, recipient_summary,
      notification_id, provider_status, status, subject, error
    )
    VALUES (
      ${input.baseId}::uuid, ${input.workflowId}::uuid, ${input.workflowRunId}::uuid, ${input.templateId}::uuid,
      ${input.recipientKind}, ${input.recipientSummary}, ${input.notificationId ?? null}::uuid,
      ${input.providerStatus ?? null}, ${input.status}, ${input.subject}, ${input.error ?? null}
    )
    RETURNING id, workflow_id, workflow_run_id, template_id, recipient_kind, recipient_summary,
              notification_id, provider_status, status, subject, error, created_at,
              (created_at::text || '|' || id::text) AS cursor_token
  `;
  if (!row) throw err.internal("workflow email delivery insert failed");
  return mapDelivery(row);
};

export const listWorkflowEmailDeliveries = async (params: ListDeliveriesParams): Promise<WorkflowEmailDeliveryRow[]> => {
  const workflowIds = toPgUuidArray(params.workflowIds);
  const workflowIdClause = params.workflowId ? sql`AND delivery.workflow_id = ${params.workflowId}::uuid` : sql``;
  const cursorClause = params.cursor
    ? sql`AND (delivery.created_at, delivery.id) < (${params.cursor.createdAt}::timestamptz, ${params.cursor.id}::uuid)`
    : sql``;
  const rows = await sql<DeliveryRow[]>`
    SELECT delivery.id, delivery.workflow_id, delivery.workflow_run_id, delivery.template_id,
           delivery.recipient_kind, delivery.recipient_summary, delivery.notification_id,
           COALESCE(notification_state.provider_status, delivery.provider_status) AS provider_status,
           CASE
             WHEN delivery.status = 'failed' THEN 'failed'
             WHEN notification_state.current_status IS NOT NULL THEN notification_state.current_status
             ELSE delivery.status
           END AS status,
           delivery.subject,
           COALESCE(delivery.error, notification_state.error) AS error,
           delivery.created_at,
           (delivery.created_at::text || '|' || delivery.id::text) AS cursor_token
    FROM grids.workflow_email_deliveries delivery
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN bool_or(required AND status IN ('failed', 'suppressed')) THEN 'failed'
          WHEN bool_or(required AND status IN ('deferred', 'pending', 'sending')) THEN 'pending'
          ELSE 'sent'
        END AS current_status,
        string_agg(DISTINCT status, ', ' ORDER BY status) AS provider_status,
        max(CASE WHEN required AND status IN ('failed', 'suppressed') THEN COALESCE(error_message, error_code) END) AS error
      FROM notifications.deliveries
      WHERE event_id = delivery.notification_id
    ) notification_state ON delivery.notification_id IS NOT NULL
    WHERE delivery.base_id = ${params.baseId}::uuid
      AND delivery.workflow_id = ANY(${workflowIds}::uuid[])
      ${workflowIdClause}
      ${cursorClause}
    ORDER BY delivery.created_at DESC, delivery.id DESC
    LIMIT ${params.limit}
  `;
  return rows.map((row) => ({ delivery: mapDelivery(row), cursor: row.cursor_token }));
};
