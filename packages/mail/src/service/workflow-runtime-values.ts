import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import type { WorkflowValueResolverPort } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import { enqueueMessageHydration } from "./sync-runtime";

type JsonObject = Record<string, WorkflowJsonValue>;
type HydratedMessageValue = { state: "resolved"; value: WorkflowJsonValue } | { state: "pending" } | { state: "unavailable" };

const isObject = (value: WorkflowJsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const messageForReference = (
  reference: string,
  inputs: Record<string, WorkflowJsonValue>,
): { message: JsonObject; field: string } | null => {
  const parts = reference.split(".");
  if (parts[0] !== "inputs" || !parts[1] || !parts[2]) return null;
  const input = inputs[parts[1]];
  return isObject(input) ? { message: input, field: parts[2] } : null;
};

const hydratedMessageValue = async (messageId: string, field: string): Promise<HydratedMessageValue> => {
  const [message] = await sql<
    { hydration_status: string; hydration_attempt: number; plain_text: string | null; sanitized_html: string | null }[]
  >`
    SELECT hydration_status, hydration_attempt, plain_text, sanitized_html
    FROM mail.message_contents
    WHERE id = ${messageId}::uuid
  `;
  if (!message || (message.hydration_status === "failed" && message.hydration_attempt >= 5)) return { state: "unavailable" };
  if (field === "body" || field === "bodyText") {
    return message.hydration_status === "body" || message.hydration_status === "complete"
      ? { state: "resolved", value: message.plain_text ?? "" }
      : { state: "pending" };
  }
  if (field === "bodyHtml") {
    return message.hydration_status === "body" || message.hydration_status === "complete"
      ? { state: "resolved", value: message.sanitized_html ?? "" }
      : { state: "pending" };
  }
  if (field !== "attachments" || message.hydration_status !== "complete") return { state: "pending" };
  const rows = await sql<
    { id: string; filename: string | null; content_type: string; disposition: string | null; size_bytes: string | number }[]
  >`
    SELECT id, filename, content_type, disposition, size_bytes
    FROM mail.attachments
    WHERE message_id = ${messageId}::uuid
    ORDER BY part_path, id
  `;
  return {
    state: "resolved",
    value: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      disposition: row.disposition,
      sizeBytes: Number(row.size_bytes),
    })),
  };
};

export const createMailWorkflowValueResolver = (params: {
  targetId: string;
  inputs: Record<string, WorkflowJsonValue>;
}): WorkflowValueResolverPort => ({
  resolve: async ({ reference, fallback }) => {
    const candidate = messageForReference(reference, params.inputs);
    if (!candidate || !["body", "bodyText", "bodyHtml", "attachments"].includes(candidate.field)) {
      const value = fallback();
      return value === undefined ? { state: "missing" } : { state: "resolved", value };
    }
    const messageId = candidate.message.messageId;
    if (typeof messageId !== "string") return { state: "missing" };
    const hydrated = await hydratedMessageValue(messageId, candidate.field);
    if (hydrated.state === "resolved") return hydrated;
    if (hydrated.state === "unavailable") return { state: "missing" };
    await enqueueMessageHydration(messageId);
    return {
      state: "waiting",
      dependency: { kind: "mail.hydration", key: messageId, data: { targetId: params.targetId } },
    };
  },
});
