import { sql } from "bun";

export const backfillWorkflowEmailDeliveries = async (): Promise<void> => {
  await sql`
    WITH legacy AS (
      SELECT
        audit.id AS audit_id,
        audit.base_id,
        audit.action,
        audit.created_at,
        audit.diff #> '{workflowEmail,new}' AS payload
      FROM grids.audit_log AS audit
      JOIN grids.bases AS base ON base.id = audit.base_id
      WHERE audit.action IN ('workflow.email.sent', 'workflow.email.failed')
        AND audit.base_id IS NOT NULL
        AND audit.diff #>> '{workflowEmail,new,deliveryId}' IS NULL
        AND NOT ((audit.diff #> '{workflowEmail,new}') @? '$.recipients[*].deliveryId')
        AND NOT EXISTS (
          SELECT 1
          FROM grids.workflow_email_deliveries AS delivery
          WHERE delivery.source_audit_id = audit.id
        )
      FOR KEY SHARE OF base
    ), expanded AS (
      SELECT
        legacy.*,
        recipient.value AS recipient,
        recipient.ordinality::int AS recipient_index
      FROM legacy
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN legacy.action = 'workflow.email.sent' AND jsonb_typeof(legacy.payload->'recipients') = 'array'
            THEN legacy.payload->'recipients'
          WHEN legacy.action = 'workflow.email.failed'
            THEN jsonb_build_array(jsonb_build_object(
              'kind', CASE WHEN legacy.payload->>'recipient' LIKE 'user:%' THEN 'user' ELSE 'email' END,
              'recipient', COALESCE(legacy.payload->>'recipient', '***'),
              'status', 'error'
            ))
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY AS recipient(value, ordinality)
      WHERE legacy.payload IS NOT NULL
        AND legacy.payload->>'deliveryId' IS NULL
        AND recipient.value->>'deliveryId' IS NULL
    ), normalized AS (
      SELECT
        expanded.*,
        CASE WHEN expanded.payload->>'workflowId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (expanded.payload->>'workflowId')::uuid END AS workflow_ref,
        CASE WHEN expanded.payload->>'workflowRunId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (expanded.payload->>'workflowRunId')::uuid END AS run_ref,
        CASE WHEN expanded.payload->>'templateId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (expanded.payload->>'templateId')::uuid END AS template_ref,
        CASE WHEN expanded.recipient->>'notificationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (expanded.recipient->>'notificationId')::uuid END AS notification_ref
      FROM expanded
    )
    INSERT INTO grids.workflow_email_deliveries (
      base_id, workflow_id, workflow_run_id, template_id, recipient_kind, recipient_summary,
      notification_id, provider_status, status, subject, error, source_audit_id, recipient_index, created_at
    )
    SELECT
      normalized.base_id,
      workflow.id,
      run.id,
      template.id,
      CASE WHEN normalized.recipient->>'kind' = 'user' THEN 'user' ELSE 'email' END,
      COALESCE(NULLIF(normalized.recipient->>'recipient', ''), '***'),
      normalized.notification_ref,
      NULLIF(normalized.recipient->>'status', ''),
      CASE WHEN normalized.action = 'workflow.email.failed' THEN 'failed' ELSE 'sent' END,
      NULLIF(normalized.payload->>'subject', ''),
      CASE WHEN normalized.action = 'workflow.email.failed' THEN NULLIF(normalized.payload->>'error', '') ELSE NULL END,
      normalized.audit_id,
      normalized.recipient_index,
      normalized.created_at
    FROM normalized
    LEFT JOIN grids.workflows AS workflow ON workflow.id = normalized.workflow_ref AND workflow.base_id = normalized.base_id
    LEFT JOIN grids.workflow_runs AS run ON run.id = normalized.run_ref AND run.base_id = normalized.base_id
    LEFT JOIN grids.email_templates AS template ON template.id = normalized.template_ref AND template.base_id = normalized.base_id
    ON CONFLICT (source_audit_id, recipient_index)
      WHERE source_audit_id IS NOT NULL AND recipient_index IS NOT NULL
      DO NOTHING
  `.simple();
};
