import type { WorkflowJsonValue } from "@valentinkolb/cloud/workflows";
import { type RemoteMessagePrecondition, remoteMessagePreconditionSchema } from "../contracts";

const object = (value: WorkflowJsonValue | undefined): Record<string, WorkflowJsonValue> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;

export const mailWorkflowMessagePrecondition = (
  context: Record<string, WorkflowJsonValue> | undefined,
  remoteMessageRefId: string,
): RemoteMessagePrecondition => {
  const sourceMessage = object(object(context?.source)?.message);
  const preconditions = object(context?.preconditions);
  const parsed = remoteMessagePreconditionSchema.safeParse(preconditions?.remoteState);
  if (sourceMessage?.remoteMessageRefId !== remoteMessageRefId || !parsed.success) {
    throw Object.assign(new Error("Frozen remote message preconditions are unavailable"), {
      code: "MAIL_WORKFLOW_PRECONDITION_MISSING",
    });
  }
  return parsed.data;
};
