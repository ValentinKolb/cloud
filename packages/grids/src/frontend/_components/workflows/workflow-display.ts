import type { GridsWorkflowChannel, GridsWorkflowRun } from "../../../workflows/contracts";

export const channelLabels: Record<GridsWorkflowChannel, string> = {
  api: "API",
  dashboard: "Dashboard",
  scanner: "Scanner",
  bulk: "Bulk",
  schedule: "Schedule",
  recordEvent: "Record event",
};

export const workflowRunStatusClass = (status: GridsWorkflowRun["status"] | string) =>
  status === "succeeded"
    ? "badge-success"
    : status === "failed" || status === "canceled" || status === "needs_attention"
      ? "badge-danger"
      : "badge-neutral";

export const isTerminalWorkflowRunStatus = (status: GridsWorkflowRun["status"]): boolean =>
  status === "succeeded" || status === "failed" || status === "canceled" || status === "needs_attention";

export const formatWorkflowRunDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "-");

export const formatWorkflowRunDuration = (run: Pick<GridsWorkflowRun, "startedAt" | "finishedAt">): string => {
  if (!run.startedAt || !run.finishedAt) return "-";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
};

export const workflowStepErrorMessage = (outcome: unknown): string | null => {
  if (!outcome || typeof outcome !== "object" || !("error" in outcome)) return null;
  const error = (outcome as { error?: unknown }).error;
  if (typeof error === "string") return error.trim() || "Step failed";
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Step failed";
};

type JsonRecord = Record<string, unknown>;

const objectValue = (value: unknown): JsonRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;

export const workflowStepOutcomeSummary = (outcome: unknown): string | null => {
  const value = objectValue(outcome);
  if (!value || typeof value.state !== "string") return null;
  const stateSummary = workflowStateSummary(value);
  if (stateSummary) return stateSummary;
  const control = objectValue(value.control);
  if (control && typeof control.kind === "string" && Array.isArray(control.branches)) {
    return `${control.kind}: ${control.branches.map(String).join(", ")}`;
  }
  return null;
};

const workflowStateSummary = (value: JsonRecord): string | null => {
  if (value.state === "unsupported" || value.state === "indeterminate") {
    return typeof value.reason === "string" ? value.reason : String(value.state).replaceAll("_", " ");
  }
  if (value.state !== "waiting") return null;
  const dependency = objectValue(value.dependency);
  return dependency && typeof dependency.kind === "string" ? `Waiting for ${dependency.kind}` : "Waiting";
};

type WorkflowPlannedEffect = { title: string; detail: string | null };

const shortId = (value: unknown): string | null => (typeof value === "string" && value ? value.slice(0, 8) : null);

const fieldCount = (item: JsonRecord): string => {
  const count = Array.isArray(item.fieldIds) ? item.fieldIds.length : 0;
  return `${count} field${count === 1 ? "" : "s"}`;
};

const plannedEffectDetails: Record<string, (item: JsonRecord) => string> = {
  updateRecord: (item) => {
    const count = Array.isArray(item.fieldIds) ? item.fieldIds.length : 0;
    return `Record ${shortId(item.recordId) ?? "selected"} · ${count} field${count === 1 ? "" : "s"}`;
  },
  createRecord: fieldCount,
  generateDocument: (item) =>
    [typeof item.templateName === "string" ? item.templateName : "Document", typeof item.filename === "string" ? item.filename : null]
      .filter(Boolean)
      .join(" · "),
  createDocumentLink: (item) => `${String(item.expiresIn ?? "30d")} expiry${item.hasComment ? " · with comment" : ""}`,
  sendEmail: (item) => {
    const count = typeof item.recipientCount === "number" ? item.recipientCount : 0;
    return `${typeof item.templateName === "string" ? item.templateName : "Email"} · ${count} recipient${count === 1 ? "" : "s"}`;
  },
  httpRequest: (item) => `${String(item.method ?? "POST")} ${String(item.host ?? "")}`.trim(),
};

const plannedEffectDetail = (action: string, item: JsonRecord): string | null => {
  const format = plannedEffectDetails[action];
  return format ? format(item) : typeof item.effect === "string" ? item.effect.replaceAll("-", " ") : null;
};

export const workflowStepPlannedEffects = (outcome: unknown): WorkflowPlannedEffect[] => {
  const value = objectValue(outcome);
  if (!value || !Array.isArray(value.effects)) return [];
  return value.effects.map((effect) => {
    const item = objectValue(effect);
    if (!item) {
      return {
        title: typeof effect === "string" && effect.trim() ? effect : "Planned effect",
        detail: null,
      };
    }
    const action = typeof item.action === "string" ? item.action : "Workflow effect";
    const words = action === "httpRequest" ? "HTTP request" : action.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return {
      title: action === "httpRequest" ? words : `${words.charAt(0).toUpperCase()}${words.slice(1)}`,
      detail: plannedEffectDetail(action, item),
    };
  });
};
