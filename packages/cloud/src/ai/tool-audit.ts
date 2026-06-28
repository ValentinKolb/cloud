import { sql } from "bun";

type AuditValueMeta =
  | { type: "null" }
  | { type: "array"; length: number }
  | { type: "object"; keys: string[]; omittedKeys: number }
  | { type: "string"; length: number }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "unknown" };

export type AiToolCallLocation = "server" | "client" | "client_view" | "client_interaction";

export type AiToolApprovalState = "not_required" | "waiting" | "approved_once" | "approved_always" | "approved_by_preference" | "rejected";

const valueMeta = (value: unknown): AuditValueMeta => {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return { type: "object", keys: keys.slice(0, 20), omittedKeys: Math.max(0, keys.length - 20) };
  }
  return { type: "unknown" };
};

export const aiToolAudit = {
  noteToolCall: async (input: {
    conversationId: string;
    turnId: string;
    callId: string;
    toolName: string;
    location: AiToolCallLocation;
    args: unknown;
    approvalState?: AiToolApprovalState;
    status?: "pending" | "waiting_for_frontend";
  }): Promise<void> => {
    await sql`
      INSERT INTO ai.tool_calls (
        turn_id,
        conversation_id,
        call_id,
        tool_name,
        location,
        status,
        approval_state,
        input_meta
      )
      VALUES (
        ${input.turnId},
        ${input.conversationId},
        ${input.callId},
        ${input.toolName},
        ${input.location},
        ${input.status ?? "pending"},
        ${input.approvalState ?? "not_required"},
        ${JSON.stringify(valueMeta(input.args))}::jsonb
      )
      ON CONFLICT (turn_id, call_id)
      DO UPDATE SET
        tool_name = EXCLUDED.tool_name,
        location = EXCLUDED.location,
        status = EXCLUDED.status,
        approval_state = EXCLUDED.approval_state,
        input_meta = EXCLUDED.input_meta
    `;
  },

  noteToolStarted: async (input: { conversationId: string; turnId: string; callId: string; toolName: string }): Promise<void> => {
    await sql`
      INSERT INTO ai.tool_calls (
        turn_id,
        conversation_id,
        call_id,
        tool_name,
        status,
        started_at
      )
      VALUES (${input.turnId}, ${input.conversationId}, ${input.callId}, ${input.toolName}, 'running', now())
      ON CONFLICT (turn_id, call_id)
      DO UPDATE SET status = 'running', started_at = COALESCE(ai.tool_calls.started_at, now())
    `;
  },

  noteApprovalRequested: async (input: {
    conversationId: string;
    turnId: string;
    callId: string;
    toolName: string;
    location: AiToolCallLocation;
    args: unknown;
  }): Promise<void> => {
    await sql`
      INSERT INTO ai.tool_calls (
        turn_id,
        conversation_id,
        call_id,
        tool_name,
        location,
        status,
        approval_state,
        input_meta,
        approval_requested_at
      )
      VALUES (
        ${input.turnId},
        ${input.conversationId},
        ${input.callId},
        ${input.toolName},
        ${input.location},
        'waiting_for_approval',
        'waiting',
        ${JSON.stringify(valueMeta(input.args))}::jsonb,
        now()
      )
      ON CONFLICT (turn_id, call_id)
      DO UPDATE SET
        location = EXCLUDED.location,
        status = 'waiting_for_approval',
        approval_state = 'waiting',
        input_meta = EXCLUDED.input_meta,
        approval_requested_at = now()
    `;
  },

  noteApprovalResolved: async (input: {
    turnId: string;
    callId: string;
    approvalState: Exclude<AiToolApprovalState, "not_required" | "waiting">;
  }): Promise<void> => {
    const approved = input.approvalState !== "rejected";
    await sql`
      UPDATE ai.tool_calls
      SET
        approval_state = ${input.approvalState},
        status = CASE WHEN ${approved} THEN status ELSE 'rejected' END,
        approved_at = CASE WHEN ${approved} THEN now() ELSE approved_at END,
        rejected_at = CASE WHEN ${approved} THEN rejected_at ELSE now() END
      WHERE turn_id = ${input.turnId}
        AND call_id = ${input.callId}
    `;
  },

  noteToolCompleted: async (input: { turnId: string; callId: string; result: unknown; isError?: boolean }): Promise<void> => {
    await sql`
      UPDATE ai.tool_calls
      SET
        status = ${input.isError ? "failed" : "completed"},
        output_meta = ${JSON.stringify(valueMeta(input.result))}::jsonb,
        error = ${input.isError ? (typeof input.result === "string" ? input.result.slice(0, 500) : "Tool execution failed") : null},
        completed_at = now()
      WHERE turn_id = ${input.turnId}
        AND call_id = ${input.callId}
    `;
  },
};
