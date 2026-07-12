import { toPgUuidArray } from "@valentinkolb/cloud/services";
import { err } from "@valentinkolb/stdlib";
import { sql } from "bun";
import type { WorkflowEmailDelivery } from "../contracts";
import type { SqlClient } from "./audit";

type DeliveryStatus = "sent" | "failed";

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
  const workflowIdClause = params.workflowId ? sql`AND workflow_id = ${params.workflowId}::uuid` : sql``;
  const cursorClause = params.cursor
    ? sql`AND (created_at, id) < (${params.cursor.createdAt}::timestamptz, ${params.cursor.id}::uuid)`
    : sql``;
  const rows = await sql<DeliveryRow[]>`
    SELECT id, workflow_id, workflow_run_id, template_id, recipient_kind, recipient_summary,
           notification_id, provider_status, status, subject, error, created_at,
           (created_at::text || '|' || id::text) AS cursor_token
    FROM grids.workflow_email_deliveries
    WHERE base_id = ${params.baseId}::uuid
      AND workflow_id = ANY(${workflowIds}::uuid[])
      ${workflowIdClause}
      ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${params.limit}
  `;
  return rows.map((row) => ({ delivery: mapDelivery(row), cursor: row.cursor_token }));
};
