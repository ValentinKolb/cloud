import type { WorkflowActionResult, WorkflowJsonValue } from "@valentinkolb/cloud/workflows";

type ActionFailure = Extract<WorkflowActionResult<WorkflowJsonValue>, { state: "failed" }>;
type ErrorShape = { code?: unknown; errno?: unknown; retryable?: unknown };

const retryableCodes = new Set(["40001", "40P01", "53300", "57P01", "57P03", "COMMAND_JOB_LEASE_LOST", "WORKFLOW_LEASE_LOST"]);
const shape = (error: unknown): ErrorShape =>
  error !== null && typeof error === "object" && !Array.isArray(error) ? (error as ErrorShape) : {};

export const mailWorkflowActionFailure = (error: unknown, fallbackCode = "MAIL_WORKFLOW_ACTION_FAILED"): ActionFailure => {
  const details = shape(error);
  const code = typeof details.code === "string" ? details.code : fallbackCode;
  const databaseCode = typeof details.errno === "string" ? details.errno : code;
  return {
    state: "failed",
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: details.retryable === true || databaseCode.startsWith("08") || retryableCodes.has(databaseCode),
  };
};
