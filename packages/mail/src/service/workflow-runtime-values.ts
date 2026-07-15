import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { readWorkflowValuePath } from "@valentinkolb/cloud/workflows/language";
import type { WorkflowValueResolverPort } from "@valentinkolb/cloud/workflows/runtime";
import { sql } from "bun";
import { enqueueMessageHydration } from "./sync-runtime";
import { freezeMailWorkflowHydrationValue } from "./workflow-runtime-repository";

type JsonObject = Record<string, WorkflowJsonValue>;
type HydratedMessageValue = { state: "resolved"; value: WorkflowJsonValue } | { state: "pending" } | { state: "unavailable" };

const isObject = (value: WorkflowJsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const messageForReference = (
  reference: string,
  inputs: Record<string, WorkflowJsonValue>,
): { message: JsonObject; field: "body" | "bodyText" | "bodyHtml" | "attachments"; tail: string[]; frozenKey: string } | null => {
  const parts = reference.split(".");
  const field = parts[2];
  if (parts[0] !== "inputs" || !parts[1] || (field !== "body" && field !== "bodyText" && field !== "bodyHtml" && field !== "attachments")) {
    return null;
  }
  const input = inputs[parts[1]];
  return isObject(input) ? { message: input, field, tail: parts.slice(3), frozenKey: parts.slice(0, 3).join(".") } : null;
};

const hydratedMessageValue = async (
  mailboxId: string,
  messageId: string,
  field: "body" | "bodyText" | "bodyHtml" | "attachments",
): Promise<HydratedMessageValue> => {
  const [message] = await sql<
    { hydration_status: string; hydration_attempt: number; plain_text: string | null; sanitized_html: string | null }[]
  >`
    SELECT hydration_status, hydration_attempt, plain_text, sanitized_html
    FROM mail.message_contents
    WHERE id = ${messageId}::uuid
      AND mailbox_id = ${mailboxId}::uuid
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
  if (message.hydration_status !== "complete") return { state: "pending" };
  const rows = await sql<
    {
      id: string;
      filename: string | null;
      content_type: string;
      disposition: string | null;
      content_id: string | null;
      size_bytes: string | number;
    }[]
  >`
    SELECT attachment.id, attachment.filename, attachment.content_type, attachment.disposition,
      attachment.content_id, attachment.size_bytes
    FROM mail.attachments attachment
    JOIN mail.message_contents message ON message.id = attachment.message_id
    JOIN mail.message_parts part ON part.id = attachment.part_id
    WHERE attachment.message_id = ${messageId}::uuid
      AND message.mailbox_id = ${mailboxId}::uuid
    ORDER BY part.part_path, attachment.id
  `;
  return {
    state: "resolved",
    value: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      contentType: row.content_type,
      disposition: row.disposition,
      contentId: row.content_id,
      sizeBytes: Number(row.size_bytes),
    })),
  };
};

const resolvedPath = (value: WorkflowJsonValue, tail: readonly string[]): ReturnType<WorkflowValueResolverPort["resolve"]> => {
  const resolved = tail.length === 0 ? value : readWorkflowValuePath(value, tail);
  return Promise.resolve(resolved === undefined ? { state: "missing" } : { state: "resolved", value: resolved });
};

export const createMailWorkflowValueResolver = (params: {
  targetId: string;
  executionGeneration: number;
  leaseToken: string;
  mailboxId: string;
  inputs: Record<string, WorkflowJsonValue>;
  frozenHydration: Record<string, WorkflowJsonValue>;
}): WorkflowValueResolverPort => ({
  resolve: async ({ reference, fallback }) => {
    const candidate = messageForReference(reference, params.inputs);
    if (!candidate) {
      const value = fallback();
      return value === undefined ? { state: "missing" } : { state: "resolved", value };
    }

    const available =
      candidate.field === "attachments" ? candidate.message.attachmentsAvailable === true : candidate.message.bodyAvailable === true;
    if (available) {
      const value = fallback();
      return value === undefined ? { state: "missing" } : { state: "resolved", value };
    }

    if (Object.prototype.hasOwnProperty.call(params.frozenHydration, candidate.frozenKey)) {
      return resolvedPath(params.frozenHydration[candidate.frozenKey]!, candidate.tail);
    }

    const messageId = candidate.message.messageId;
    if (typeof messageId !== "string") return { state: "missing" };
    const hydrated = await hydratedMessageValue(params.mailboxId, messageId, candidate.field);
    if (hydrated.state === "unavailable") return { state: "missing" };
    if (hydrated.state === "pending") {
      await enqueueMessageHydration(messageId);
      return {
        state: "waiting",
        dependency: { kind: "mail.hydration", key: messageId, data: { targetId: params.targetId } },
      };
    }

    const frozen = await freezeMailWorkflowHydrationValue({
      targetId: params.targetId,
      executionGeneration: params.executionGeneration,
      leaseToken: params.leaseToken,
      reference: candidate.frozenKey,
      value: hydrated.value,
    });
    params.frozenHydration[candidate.frozenKey] = frozen;
    return resolvedPath(frozen, candidate.tail);
  },
});
